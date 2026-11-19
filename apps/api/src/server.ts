import express from "express";
import { buildAnalysis } from "../../../packages/core/src/analysis.js";
import { dashboardRoutes } from "./dashboard.js";
import {
  accountManagementRoutes,
  assertManagedAccountEnabled,
  runCollectionSchedules,
} from "./accounts.js";
import { z } from "zod";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { importSchema, parseReport } from "../../../packages/core/src/index.js";
import {
  botCommandSchema,
  commandResultSchema,
} from "../../../packages/core/src/control.js";
import {
  defaultReportPreferences,
  reportPreferencesSchema,
} from "../../../packages/core/src/report-preferences.js";
import { pool, saveImport } from "./store.js";
import { captureRoutes, persistJob } from "./captures.js";
import { optimizationRoutes } from "./optimization.js";
import { dataLifecycleRoutes } from "./data-lifecycle.js";
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
app.use(async (req, res, next) => {
  const authorization = req.get("Authorization") ?? "";
  const supplied = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${token}`);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    const raw = authorization.replace(/^Bearer\s+/i, "");
    const hash = createHash("sha256").update(raw).digest("hex");
    const client = await pool.query(
      `SELECT api.id,api.customer_id,api.role,api.all_accounts,
              c.name AS customer_name
       FROM api_clients api
       JOIN customers c ON c.id=api.customer_id
       WHERE api.token_hash=$1 AND api.enabled=true AND c.enabled=true`,
      [hash],
    );
    if (!client.rowCount) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as any).auth = {
      kind: "client",
      ...client.rows[0],
    };
  } else {
    (req as any).auth = {
      kind: "local-admin",
      id: null,
      customer_id: null,
      role: "admin",
      all_accounts: true,
      customer_name: null,
    };
  }
  next();
});
app.use(express.json({ limit: "12mb" }));
app.get("/auth/me", async (req, res) => {
  const auth = (req as any).auth;
  const accessibleAccounts =
    auth.kind === "client" && !auth.all_accounts
      ? (
          await pool.query(
            `SELECT account_id FROM api_client_accounts
             WHERE client_id=$1 ORDER BY account_id`,
            [auth.id],
          )
        ).rows.map((row) => row.account_id)
      : null;
  res.json({
    kind: auth.kind,
    role: auth.role,
    customer_id: auth.customer_id ?? null,
    customer_name: auth.customer_name ?? null,
    all_accounts: auth.all_accounts === true,
    accounts: accessibleAccounts,
  });
});
app.use(async (req, res, next) => {
  const auth = (req as any).auth as {
    kind: string;
    customer_id: string | null;
    role: string;
    id: string | null;
    all_accounts: boolean;
  };
  if (auth.kind === "local-admin") {
    next();
    return;
  }
  if (auth.role === "viewer" && req.method !== "GET") {
    res.status(403).json({ error: "Viewer role is read-only" });
    return;
  }
  const accounts = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && /^\d+$/.test(value)) accounts.add(value);
  };
  add(req.query.account_id);
  add(req.query.account);
  add(req.params.account);
  add((req.body as any)?.account_id);
  add((req.body as any)?.expected_account_id);
  add((req.body as any)?.state?.bound_account);
  if (req.params.device) {
    const device = await pool.query(
      "SELECT state->>'bound_account' AS account_id FROM bot_devices WHERE id=$1",
      [req.params.device],
    );
    add(device.rows[0]?.account_id);
  }
  if (req.params.job) {
    const job = await pool.query(
      "SELECT account_id FROM capture_jobs WHERE id=$1",
      [req.params.job],
    );
    add(job.rows[0]?.account_id);
  }
  if (req.params.id && req.path.startsWith("/captures/")) {
    const snapshot = await pool.query(
      "SELECT bound_account AS account_id FROM capture_snapshots WHERE id=$1",
      [req.params.id],
    );
    add(snapshot.rows[0]?.account_id);
  }
  for (const account of accounts) {
    const ownership = auth.all_accounts
      ? await pool.query(
          "SELECT enabled FROM managed_accounts WHERE account_id=$1 AND customer_id=$2",
          [account, auth.customer_id],
        )
      : await pool.query(
          `SELECT ma.enabled
           FROM managed_accounts ma
           JOIN api_client_accounts access
             ON access.account_id=ma.account_id AND access.client_id=$3
           WHERE ma.account_id=$1 AND ma.customer_id=$2`,
          [account, auth.customer_id, auth.id],
        );
    if (!ownership.rowCount) {
      res.status(403).json({ error: "Account is outside this customer" });
      return;
    }
    if (ownership.rows[0].enabled === false) {
      res.status(403).json({
        error: "Managed account is disabled",
        code: "account_disabled",
      });
      return;
    }
  }
  next();
});
app.use(dashboardRoutes(pool));
app.use(accountManagementRoutes(pool));
app.use(captureRoutes(pool));
app.use(optimizationRoutes(pool));
app.use(dataLifecycleRoutes(pool));
app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ready" });
});
app.get("/reports/preferences", async (req, res) => {
  const account = z.string().regex(/^\d+$/).parse(req.query.account_id);
  await assertManagedAccountEnabled(pool, account);
  const result = await pool.query(
    "SELECT data,updated_at FROM report_preferences WHERE account_id=$1",
    [account],
  );
  res.json({
    account_id: account,
    preferences: result.rowCount
      ? reportPreferencesSchema.parse(result.rows[0].data)
      : defaultReportPreferences,
    updated_at: result.rows[0]?.updated_at ?? null,
  });
});
app.post("/reports/preferences", async (req, res) => {
  const input = z
    .object({
      account_id: z.string().regex(/^\d+$/),
      preferences: reportPreferencesSchema,
    })
    .strict()
    .parse(req.body);
  await assertManagedAccountEnabled(pool, input.account_id);
  const result = await pool.query(
    `INSERT INTO report_preferences(account_id,data)
     VALUES($1,$2)
     ON CONFLICT(account_id) DO UPDATE SET data=excluded.data,updated_at=now()
     RETURNING updated_at`,
    [input.account_id, JSON.stringify(input.preferences)],
  );
  res.json({
    account_id: input.account_id,
    preferences: input.preferences,
    updated_at: result.rows[0].updated_at,
  });
});
app.post("/imports/validate", async (req, res) => {
  const input = importSchema.parse(req.body);
  await assertManagedAccountEnabled(pool, input.expected_account_id);
  const report = parseReport(input);
  res.status(report.valid ? 200 : 422).json(report);
});
// Read-only analysis preview shares the exact same import validation as persistence.
app.post("/analysis/preview", async (req, res) => {
  const { goal, input } = z
    .object({
      goal: z.enum(["messages", "sales", "leads"]).default("messages"),
      input: importSchema,
    })
    .parse(req.body);
  await assertManagedAccountEnabled(pool, input.expected_account_id);
  const validation = parseReport(input);
  if (!validation.valid) {
    res.status(422).json({ validation });
    return;
  }
  res.json({
    validation,
    analysis: buildAnalysis(validation.records, goal, {
      coverage: validation.scope_coverage,
      reconciliation: validation.reconciliation,
    }),
  });
});
app.post("/imports", async (req, res) => {
  const input = importSchema.parse(req.body);
  await assertManagedAccountEnabled(pool, input.expected_account_id);
  const result = await saveImport(input);
  res.status(result.status).json(result.body);
});
app.get("/imports", async (req, res) => {
  const account = String(req.query.account_id ?? "");
  if (!/^\d+$/.test(account)) {
    res.status(400).json({ error: "account_id required" });
    return;
  }
  await assertManagedAccountEnabled(pool, account);
  const result = await pool.query(
    "SELECT j.id,j.created_at,f.filename,f.row_count,q.report FROM import_jobs j JOIN import_files f ON f.job_id=j.id JOIN data_quality_reports q ON q.job_id=j.id WHERE j.account_id=$1 ORDER BY j.created_at DESC LIMIT 100",
    [account],
  );
  res.json(result.rows);
});
app.get("/export", async (req, res) => {
  const query = z
    .object({
      account_id: z.string().regex(/^\d+$/),
      level: z.enum(["campaign", "adset", "ad"]).optional(),
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      source: z.enum(["csv", "dom_capture", "unknown"]).optional(),
      limit: z.coerce.number().int().min(1).max(10_000).default(10_000),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query);
  await assertManagedAccountEnabled(pool, query.account_id);
  const filtered = `WITH filtered AS (
     SELECT data,
            CASE
              WHEN data->'raw' ? '_source_filename' THEN 'csv'
              WHEN data->'raw'->>'_source' = 'dom_capture' THEN 'dom_capture'
              ELSE 'unknown'
            END AS source
     FROM insight_observations
     WHERE account_id=$1
       AND ($2::text IS NULL OR level=$2)
       AND ($3::date IS NULL OR date_start >= $3::date)
       AND ($4::date IS NULL OR date_end <= $4::date)
   )`;
  const filterParams = [
    query.account_id,
    query.level ?? null,
    query.date_from ?? null,
    query.date_to ?? null,
  ];
  const [count, result] = await Promise.all([
    pool.query(
      `${filtered} SELECT count(*)::int AS total FROM filtered
       WHERE $5::text IS NULL OR source=$5`,
      [...filterParams, query.source ?? null],
    ),
    pool.query(
      `${filtered} SELECT data FROM filtered
       WHERE $5::text IS NULL OR source=$5
       ORDER BY data->>'date_start',data->>'entity_id'
       LIMIT $6 OFFSET $7`,
      [
        ...filterParams,
        query.source ?? null,
        query.limit,
        query.offset,
      ],
    ),
  ]);
  const total = count.rows[0]?.total ?? 0;
  res.json({
    coverage: "unverified",
    records: result.rows.map((r) => r.data),
    page: {
      limit: query.limit,
      offset: query.offset,
      total,
      has_more: query.offset + result.rows.length < total,
      next_offset:
        query.offset + result.rows.length < total
          ? query.offset + result.rows.length
          : null,
    },
  });
});
// Daily trend is aggregated in PostgreSQL so large accounts never need to send
// every normalized observation to the browser.
app.get("/insights/trend", async (req, res) => {
  const query = z
    .object({
      account_id: z.string().regex(/^\d+$/),
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      source: z.enum(["csv", "dom_capture", "unknown"]).optional(),
    })
    .parse(req.query);
  await assertManagedAccountEnabled(pool, query.account_id);
  const rows = await pool.query(
    `WITH scoped AS (
       SELECT date_end,currency,timezone,attribution,result_type,
              COALESCE(data->'breakdown','{}'::jsonb) AS breakdown,
              CASE
                WHEN data->'raw' ? '_source_filename' THEN 'csv'
                WHEN data->'raw'->>'_source' = 'dom_capture' THEN 'dom_capture'
                ELSE 'unknown'
              END AS source,
              data
       FROM insight_observations
       WHERE account_id=$1
         AND level='ad'
         AND date_start=date_end
         AND ($2::date IS NULL OR date_start >= $2::date)
         AND ($3::date IS NULL OR date_end <= $3::date)
     )
     SELECT date_end::text AS date,currency,timezone,attribution,result_type,
            breakdown,source,count(*)::int AS records,
            sum((data->>'spend')::numeric)::float8 AS spend,
            sum((data->>'impressions')::numeric)::float8 AS impressions,
            CASE WHEN bool_and(data ? 'results')
                 THEN sum((data->>'results')::numeric)::float8
                 ELSE NULL END AS results
     FROM scoped
     WHERE $4::text IS NULL OR source=$4
     GROUP BY date_end,currency,timezone,attribution,result_type,breakdown,source
     ORDER BY date_end,source`,
    [
      query.account_id,
      query.date_from ?? null,
      query.date_to ?? null,
      query.source ?? null,
    ],
  );
  const groups = new Map<
    string,
    {
      key: string;
      source: string;
      currency: string;
      timezone: string;
      attribution: string;
      result_type: string;
      breakdown: Record<string, string>;
      points: {
        date: string;
        records: number;
        spend: number;
        impressions: number;
        results: number | null;
        cost_per_result: number | null;
        cpm: number | null;
      }[];
    }
  >();
  for (const row of rows.rows) {
    const breakdown = row.breakdown as Record<string, string>;
    const key = JSON.stringify([
      query.account_id,
      row.source,
      row.currency,
      row.timezone,
      row.attribution,
      row.result_type,
      breakdown,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        source: row.source,
        currency: row.currency,
        timezone: row.timezone,
        attribution: row.attribution,
        result_type: row.result_type,
        breakdown,
        points: [],
      };
      groups.set(key, group);
    }
    const results = row.results === null ? null : Number(row.results);
    const spend = Number(row.spend);
    const impressions = Number(row.impressions);
    group.points.push({
      date: row.date,
      records: row.records,
      spend,
      impressions,
      results,
      cost_per_result:
        results !== null && results > 0 ? spend / results : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    });
  }
  res.json({
    groups: [...groups.values()]
      .map((group) => ({
        ...group,
        duplicate_grains: 0,
        date_start: group.points[0]?.date ?? null,
        date_end: group.points.at(-1)?.date ?? null,
      }))
      .filter((group) => group.points.length >= 2),
  });
});
// Local single-operator bot bridge. Commands never contain arbitrary JS, selectors or URLs.
const botCommand = botCommandSchema;
app.post("/devices/:device/commands", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const command = botCommand.parse(req.body);
  const deviceState = await pool.query(
    "SELECT state->>'bound_account' AS account_id FROM bot_devices WHERE id=$1",
    [device],
  );
  const account = deviceState.rows[0]?.account_id;
  if (account) await assertManagedAccountEnabled(pool, account);
  const id = randomUUID();
  await pool.query(
    "INSERT INTO bot_commands(id,device_id,command) VALUES($1,$2,$3)",
    [id, device, JSON.stringify(command)],
  );
  res.status(201).json({ id });
});
app.get("/devices/:device/commands/next", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const state = await pool.query(
    "SELECT state->>'bound_account' AS account_id FROM bot_devices WHERE id=$1",
    [device],
  );
  if (state.rows[0]?.account_id)
    await assertManagedAccountEnabled(pool, state.rows[0].account_id);
  const r = await pool.query(
    "SELECT id,command FROM bot_commands WHERE device_id=$1 AND status='pending' ORDER BY created_at,id LIMIT 1",
    [device],
  );
  res.json(r.rows[0] ?? null);
});
app.post("/devices/:device/commands/:id/result", async (req, res) => {
  const device = z.uuid().parse(req.params.device);
  const id = z.uuid().parse(req.params.id);
  const result = commandResultSchema.parse(req.body);
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
  await assertManagedAccountEnabled(pool,bound.rows[0].account);
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
  await assertManagedAccountEnabled(pool, state.bound_account);
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
    const status = Number((err as { status?: unknown } | null)?.status);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      res.status(status).json({
        error: err instanceof Error ? err.message : "Request rejected",
        ...((err as { code?: unknown }).code
          ? { code: (err as { code?: unknown }).code }
          : {}),
      });
      return;
    }
    console.error(
      "API request failed",
      err instanceof Error ? err.message : "Unknown",
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
const scheduleTimer = setInterval(() => {
  void runCollectionSchedules(pool).catch((error) =>
    console.error(
      "Scheduled collection check failed",
      error instanceof Error ? error.message : "Unknown",
    ),
  );
}, 60_000);
scheduleTimer.unref();
void runCollectionSchedules(pool).catch((error) =>
  console.error(
    "Initial scheduled collection check failed",
    error instanceof Error ? error.message : "Unknown",
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      clearInterval(scheduleTimer);
      void pool.end();
    }),
  );
