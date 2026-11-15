import express from "express";
import { buildAnalysis } from "../../../packages/core/src/analysis.js";
import { dashboardRoutes } from "./dashboard.js";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { importSchema, parseReport } from "../../../packages/core/src/index.js";
import { botCommandSchema } from "../../../packages/core/src/control.js";
import { pool, saveImport } from "./store.js";
import { captureRoutes, persistJob } from "./captures.js";
const token = process.env.API_TOKEN;
if (!token || token.length < 32)
  throw new Error("API_TOKEN must be at least 32 characters");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  const supplied = Buffer.from(req.get("Authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});
app.use(express.json({ limit: "12mb" }));
app.use(dashboardRoutes(pool));
app.use(captureRoutes(pool));
app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ready" });
});
app.post("/imports/validate", (req, res) => {
  const input = importSchema.parse(req.body);
  const report = parseReport(input);
  res.status(report.valid ? 200 : 422).json(report);
});
// Read-only analysis preview shares the exact same import validation as persistence.
app.post("/analysis/preview", (req, res) => {
  const { goal, input } = z
    .object({
      goal: z.enum(["messages", "sales", "leads"]).default("messages"),
      input: importSchema,
    })
    .parse(req.body);
  const validation = parseReport(input);
  if (!validation.valid) {
    res.status(422).json({ validation });
    return;
  }
  res.json({ validation, analysis: buildAnalysis(validation.records, goal) });
});
app.post("/imports", async (req, res) => {
  const result = await saveImport(importSchema.parse(req.body));
  res.status(result.status).json(result.body);
});
app.get("/imports", async (req, res) => {
  const account = String(req.query.account_id ?? "");
  if (!/^\d+$/.test(account)) {
    res.status(400).json({ error: "account_id required" });
    return;
  }
  const result = await pool.query(
    "SELECT j.id,j.created_at,f.filename,f.row_count,q.report FROM import_jobs j JOIN import_files f ON f.job_id=j.id JOIN data_quality_reports q ON q.job_id=j.id WHERE j.account_id=$1 ORDER BY j.created_at DESC LIMIT 100",
    [account],
  );
  res.json(result.rows);
});
app.get("/export", async (req, res) => {
  const account = String(req.query.account_id ?? "");
  if (!/^\d+$/.test(account)) {
    res.status(400).json({ error: "account_id required" });
    return;
  }
  const result = await pool.query(
    "SELECT data FROM insight_observations WHERE account_id=$1 ORDER BY date_start,entity_id LIMIT 10001",
    [account],
  );
  if (result.rows.length > 10000) {
    res
      .status(413)
      .json({ error: "Export exceeds 10000 rows; use database export" });
    return;
  }
  res.json({ coverage: "unverified", records: result.rows.map((r) => r.data) });
});
// Local single-operator bot bridge. Commands never contain arbitrary JS, selectors or URLs.
const botCommand = botCommandSchema;
app.post("/devices/:device/commands", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const command = botCommand.parse(req.body);
  const id = randomUUID();
  await pool.query(
    "INSERT INTO bot_commands(id,device_id,command) VALUES($1,$2,$3)",
    [id, device, JSON.stringify(command)],
  );
  res.status(201).json({ id });
});
app.get("/devices/:device/commands/next", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const r = await pool.query(
    "SELECT id,command FROM bot_commands WHERE device_id=$1 AND status='pending' ORDER BY created_at,id LIMIT 1",
    [device],
  );
  res.json(r.rows[0] ?? null);
});
app.post("/devices/:device/commands/:id/result", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const id = z.uuid().parse(req.params.id);
  const result = z
    .object({
      ok: z.boolean(),
      error: z.string().optional(),
      job: z.unknown().optional(),
      ui: z.unknown().optional(),
    })
    .parse(req.body);
  const r = await pool.query(
    "UPDATE bot_commands SET status=$3,result=$4,completed_at=now() WHERE id=$1 AND device_id=$2 AND status='pending' RETURNING id",
    [id, device, result.ok ? "done" : "error", JSON.stringify(result)],
  );
  res.json({ recorded: !!r.rowCount });
});
// Local extension runner records completed diagnostics; never enqueues or executes an action.
app.post('/devices/:device/report-result',async(req,res)=>{
  const device=z.uuid().parse(req.params.device);
  const body=z.object({goal:z.enum(['messages','sales','leads']),source_url:z.url(),runner_build:z.string().max(80),
    report:z.object({ok:z.boolean(),applied:z.boolean(),selected:z.array(z.string()).max(100),missing:z.array(z.string()).max(100),
      missing_required:z.array(z.string()).max(100),error:z.string().max(2000).optional(),trace:z.array(z.unknown()).max(200).optional(),input_mode:z.literal('chrome_input')})}).parse(req.body);
  const bound=await pool.query("SELECT state->>'bound_account' AS account FROM bot_devices WHERE id=$1",[device]);
  const u=new URL(body.source_url);
  if(!bound.rowCount||u.protocol!=='https:'||u.port!==''||!['adsmanager.facebook.com','business.facebook.com'].includes(u.hostname)||
    !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname)||u.searchParams.get('act')!==bound.rows[0].account){res.status(400).json({error:'Report diagnostic account/route mismatch'});return;}
  const id=randomUUID();const result={ok:body.report.ok,error:body.report.error,ui:{outcome:'report_diagnostic',report:body.report,
    source_url:body.source_url,runner_build:body.runner_build}};
  await pool.query("INSERT INTO bot_commands(id,device_id,command,status,result,completed_at) VALUES($1,$2,$3,$4,$5,now())",[id,device,JSON.stringify({command:'report.prepare',goal:body.goal}),body.report.ok?'done':'error',JSON.stringify(result)]);
  res.status(201).json({id});
});
app.post("/devices/:device/state", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const state = z
    .object({
      job: z.unknown().optional(),
      ui: z.unknown().optional(),
      control: z.unknown().optional(),
      approval: z.unknown().optional(),
      bound_account: z.string().regex(/^\d+$/),
      report_input: z.boolean().optional(),
      extension_version: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/)
        .optional(),
      enabled: z.boolean(),
    })
    .parse(req.body);
  await pool.query(
    "INSERT INTO bot_devices(id,state) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=now()",
    [device, JSON.stringify(state)],
  );
  // Every capture reported by the Extension is stored as a raw record in PostgreSQL.
  let captures: { stored: number } | { error: string } = { stored: 0 };
  if (state.job)
    try {
      captures = await persistJob(
        pool,
        device,
        state.bound_account,
        state.job,
        state.extension_version,
      );
    } catch (e) {
      console.error(
        "Capture persistence failed",
        e instanceof Error ? e.message : "Unknown",
      );
      captures = { error: "capture_persistence_failed" };
    }
  res.json({ ok: true, captures });
});
app.get("/devices/:device/state", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const r = await pool.query(
    "SELECT state,updated_at FROM bot_devices WHERE id=$1",
    [device],
  );
  res.json(r.rows[0] ?? null);
});
app.get("/devices/:device/commands/:id", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const id = z.uuid().parse(req.params.id);
  const r = await pool.query(
    "SELECT id,status,command #- '{action,base64}' AS command,result,created_at,completed_at FROM bot_commands WHERE id=$1 AND device_id=$2",
    [id, device],
  );
  res.json(r.rows[0] ?? null);
});
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof Error && err.name === "ZodError") {
      res
        .status(400)
        .json({ error: "Invalid request", details: JSON.parse(err.message) });
      return;
    }
    if (err instanceof Error && err.message === "RELATIONSHIP_CONFLICT") {
      res.status(409).json({
        error: "Entity parent conflicts with stored data; import rolled back",
      });
      return;
    }
    console.error(
      "API request failed",
      err instanceof Error ? err.name : "Unknown",
    );
    res.status(500).json({
      error: "Request failed; database transaction rolled back if active",
    });
  },
);
const port = Number(process.env.PORT ?? 4318);
const server = app.listen(port, "127.0.0.1", (error?: Error) => {
  if (error) {
    console.error(
      `Backend could not start on 127.0.0.1:${port}: ${(error as NodeJS.ErrnoException).code ?? error.name}. Stop the previous Backend before restarting.`,
    );
    process.exitCode = 1;
    void pool.end().catch(() => {});
    return;
  }
  console.log(`Collector API ready: http://127.0.0.1:${port}`);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void pool.end();
    }),
  );
