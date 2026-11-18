import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const LOCAL_CUSTOMER = "77a6dc50-d619-4d05-bc19-4d515e30db5b";
const SCHEDULE_RETRY_MINUTES = 10;

type AuthContext = {
  kind: "local-admin" | "client";
  id: string | null;
  customer_id: string | null;
  role: "admin" | "operator" | "viewer";
};

async function writeAudit(
  db: Pool | PoolClient,
  auth: AuthContext,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
  customerId = auth.customer_id,
) {
  await db.query(
    `INSERT INTO admin_audit_log(
       id,actor_kind,actor_client_id,customer_id,action,target,details
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      auth.kind,
      auth.kind === "client" ? auth.id : null,
      customerId,
      action,
      target,
      JSON.stringify(details),
    ],
  );
}

async function ensureManagedAccount(pool: Pool, account: string) {
  await pool.query(
    `INSERT INTO managed_accounts(account_id,customer_id)
     VALUES($1,$2)
     ON CONFLICT(account_id) DO NOTHING`,
    [account, LOCAL_CUSTOMER],
  );
}

export async function assertManagedAccountEnabled(
  pool: Pool,
  account: string,
) {
  await ensureManagedAccount(pool, account);
  const result = await pool.query(
    "SELECT enabled FROM managed_accounts WHERE account_id=$1",
    [account],
  );
  if (result.rowCount && result.rows[0].enabled === false)
    throw Object.assign(new Error("Managed account is disabled"), {
      status: 403,
      code: "account_disabled",
    });
}

function accountHealth(
  row: {
    enabled: boolean;
    latest_job_id: string | null;
    latest_job_status: string | null;
    latest_job_error: string | null;
    last_capture_at: string | null;
    analysis: unknown;
    normalized_ads: number;
    device_count: number;
    fresh_devices: number;
    target_cost_per_result: number | null;
    target_roas: number | null;
  },
) {
  if (!row.enabled) {
    return {
      status: "disabled" as const,
      issues: ["บัญชีถูกปิดใช้งาน"],
      coverage: null,
      verified_ads: 0,
      reported_ads: null,
    };
  }
  if (!row.latest_job_id) {
    return {
      status: "not_tested" as const,
      issues: [
        "ยังไม่มีงานอ่าน Ads",
        ...(row.device_count
          ? row.fresh_devices
            ? []
            : ["Device ไม่ส่ง heartbeat ภายใน 90 วินาที"]
          : ["ยังไม่มี Device ที่เชื่อมบัญชีนี้"]),
      ],
      coverage: null,
      verified_ads: 0,
      reported_ads: null,
    };
  }
  const analysis = row.analysis as
    | {
        levels?: {
          level?: string;
          coverage?: string;
          verified_unique_rows?: number;
          reported_total_rows?: number | null;
          blockers?: string[];
          context?: {
            timezone?: string | null;
            attribution?: string | null;
            breakdown?: unknown;
          };
        }[];
      }
    | null;
  const levels =
    analysis?.levels?.filter((level) => level.level === "ads") ?? [];
  const complete = levels.filter((level) => level.coverage === "complete");
  const partial = levels.filter(
    (level) => level.coverage !== "complete",
  );
  const blockers = [
    ...new Set(levels.flatMap((level) => level.blockers ?? [])),
  ];
  const scopeContexts = new Set(
    levels.map((level) =>
      JSON.stringify({
        timezone: level.context?.timezone ?? null,
        attribution: level.context?.attribution ?? null,
        breakdown: level.context?.breakdown,
      }),
    ),
  );
  const issues = [
    ...(row.latest_job_status === "running"
      ? ["งานอ่านล่าสุดกำลังทำงาน"]
      : []),
    ...(row.latest_job_error ? [`งานล่าสุด: ${row.latest_job_error}`] : []),
    ...(partial.length ? ["Coverage ของ Ads scope ยังไม่ complete"] : []),
    ...(scopeContexts.size > 1
      ? [
          "Ads แยกเป็นหลาย reporting scope จากเขตเวลา Attribution หรือ Breakdown",
        ]
      : []),
    ...blockers,
    ...(row.device_count
      ? row.fresh_devices
        ? []
        : ["Device ไม่ส่ง heartbeat ภายใน 90 วินาที"]
      : ["ยังไม่มี Device ที่เชื่อมบัญชีนี้"]),
    ...(!row.target_cost_per_result && !row.target_roas
      ? ["ยังไม่ได้ตั้ง Target CPA/ROAS"]
      : []),
  ];
  const scopeReady =
    levels.length > 0 && complete.length === levels.length;
  const liveReady = row.fresh_devices > 0;
  return {
    status: (!levels.length
      ? "not_tested"
      : scopeReady && liveReady
        ? "ready"
        : complete.length
          ? "partial"
          : "blocked") as "not_tested" | "ready" | "partial" | "blocked",
    issues,
    coverage: levels.length
      ? levels.every((level) => level.coverage === "complete")
        ? "complete"
        : complete.length
          ? "partial_with_complete_scope"
          : "partial"
      : null,
    verified_ads: Math.max(
      0,
      ...levels.map((level) => level.verified_unique_rows ?? 0),
    ),
    reported_ads: Math.max(
      0,
      ...levels.map((level) => level.reported_total_rows ?? 0),
    ),
  };
}

async function syncScheduledCommandResults(pool: Pool) {
  const pending = await pool.query(
    `SELECT s.account_id,s.consecutive_failures,
            s.next_run_at,b.id AS command_id,b.status,b.result
     FROM account_collection_schedules s
     JOIN bot_commands b ON b.id=s.last_command_id
     WHERE s.last_status='queued' AND b.status IN ('done','error')`,
  );
  for (const row of pending.rows) {
    const error =
      row.status === "error"
        ? String(row.result?.error ?? "scheduled_collection_failed").slice(0, 500)
        : null;
    const failures = error ? Number(row.consecutive_failures) + 1 : 0;
    await pool.query(
      `UPDATE account_collection_schedules
       SET last_status=$2,last_error=$3,consecutive_failures=$4,
           next_run_at=CASE
             WHEN $2='error' AND $4<3
               THEN LEAST(next_run_at,now()+interval '${SCHEDULE_RETRY_MINUTES} minutes')
             ELSE next_run_at
           END,
           updated_at=now()
       WHERE account_id=$1 AND last_command_id=$5`,
      [row.account_id, row.status, error, failures, row.command_id],
    );
  }
}

async function claimScheduledCollection(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const schedule = await client.query(
      `SELECT s.account_id,s.interval_minutes,s.next_run_at,
              ma.enabled AS account_enabled,c.enabled AS customer_enabled,
              COALESCE(p.data->>'goal','messages') AS goal
       FROM account_collection_schedules s
       JOIN managed_accounts ma ON ma.account_id=s.account_id
       JOIN customers c ON c.id=ma.customer_id
       LEFT JOIN report_preferences p ON p.account_id=s.account_id
       WHERE s.enabled=true AND s.next_run_at<=now()
       ORDER BY s.next_run_at,s.account_id
       FOR UPDATE OF s SKIP LOCKED
       LIMIT 1`,
    );
    if (!schedule.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const item = schedule.rows[0];
    if (!item.account_enabled || !item.customer_enabled) {
      await client.query(
        `UPDATE account_collection_schedules
         SET enabled=false,last_status='disabled',
             last_error='account_or_customer_disabled',updated_at=now()
         WHERE account_id=$1`,
        [item.account_id],
      );
      await client.query("COMMIT");
      return { account_id: item.account_id, status: "disabled" };
    }
    const device = await client.query(
      `SELECT id,state
       FROM bot_devices
       WHERE state->>'bound_account'=$1
         AND state->>'enabled'='true'
         AND COALESCE(state->>'report_input','false')='true'
         AND updated_at>now()-interval '90 seconds'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [item.account_id],
    );
    const selected = device.rows[0];
    const busy = selected
      ? await client.query(
          `SELECT 1 FROM bot_commands
           WHERE device_id=$1 AND status='pending'
           UNION ALL
           SELECT 1 FROM bot_devices
           WHERE id=$1 AND state->'job'->>'status' IN ('running','paused')
           LIMIT 1`,
          [selected.id],
        )
      : { rowCount: 0 };
    if (!selected || busy.rowCount) {
      await client.query(
        `UPDATE account_collection_schedules
         SET last_status='skipped',
             last_error=$2,
             next_run_at=now()+make_interval(
               mins => LEAST(interval_minutes,${SCHEDULE_RETRY_MINUTES})
             ),
             updated_at=now()
         WHERE account_id=$1`,
        [
          item.account_id,
          selected
            ? "extension_busy"
            : "no_fresh_report_input_device",
        ],
      );
      await client.query("COMMIT");
      return { account_id: item.account_id, status: "skipped" };
    }
    const commandId = randomUUID();
    const goal = ["messages", "sales", "leads"].includes(item.goal)
      ? item.goal
      : "messages";
    await client.query(
      "INSERT INTO bot_commands(id,device_id,command) VALUES($1,$2,$3)",
      [
        commandId,
        selected.id,
        JSON.stringify({
          command: "report.collect",
          goal,
          maxSteps: 20,
          scan_columns: false,
        }),
      ],
    );
    await client.query(
      `UPDATE account_collection_schedules
       SET last_run_at=now(),last_status='queued',last_error=NULL,
           last_command_id=$2,consecutive_failures=0,
           next_run_at=now()+make_interval(mins => interval_minutes),
           updated_at=now()
       WHERE account_id=$1`,
      [item.account_id, commandId],
    );
    await client.query(
      `INSERT INTO admin_audit_log(
         id,actor_kind,actor_client_id,customer_id,action,target,details
       )
       SELECT $1,'system',NULL,ma.customer_id,'collection_scheduled',$2,$3
       FROM managed_accounts ma WHERE ma.account_id=$2`,
      [
        randomUUID(),
        item.account_id,
        JSON.stringify({
          command_id: commandId,
          interval_minutes: item.interval_minutes,
          goal,
        }),
      ],
    );
    await client.query("COMMIT");
    return {
      account_id: item.account_id,
      status: "queued",
      command_id: commandId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Queue read-only report collection for due accounts. Meta is never changed. */
export async function runCollectionSchedules(pool: Pool, limit = 20) {
  await syncScheduledCommandResults(pool);
  const results: { account_id: string; status: string; command_id?: string }[] =
    [];
  for (let index = 0; index < limit; index++) {
    const result = await claimScheduledCollection(pool);
    if (!result) break;
    results.push(result);
  }
  return results;
}

export function accountManagementRoutes(pool: Pool) {
  const router = Router();

  router.get("/managed-accounts", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    const customerId = auth.customer_id;
    if (auth.kind === "local-admin")
      await pool.query(
        `INSERT INTO managed_accounts(account_id,customer_id)
         SELECT accounts.account_id,$1
         FROM (
           SELECT id AS account_id FROM ad_accounts
           UNION
           SELECT state->>'bound_account' AS account_id
           FROM bot_devices
           WHERE state->>'bound_account' IS NOT NULL
         ) accounts
         ON CONFLICT(account_id) DO NOTHING`,
        [LOCAL_CUSTOMER],
      );
    const result = await pool.query(
      `SELECT ma.account_id,ma.customer_id,c.name AS customer_name,
              ma.display_name,ma.enabled,ma.report_template,ma.updated_at,
              (SELECT count(*) FROM bot_devices d
               WHERE d.state->>'bound_account'=ma.account_id)::int AS device_count,
              (SELECT count(*) FROM bot_devices d
               WHERE d.state->>'bound_account'=ma.account_id
                 AND d.updated_at > now() - interval '90 seconds')::int AS fresh_devices,
              j.id AS latest_job_id,j.status AS latest_job_status,
              j.error AS latest_job_error,j.last_capture_at,j.analysis,
              (
                SELECT count(DISTINCT r.entity_id)::int
                FROM capture_rows r
                JOIN capture_snapshots snap ON snap.id=r.snapshot_id
                WHERE snap.job_id=j.id
                  AND r.review_status='promoted'
                  AND r.entity_id IS NOT NULL
              ) AS normalized_ads,
              p.data->>'target_cost_per_result' AS target_cost_per_result,
              p.data->>'target_roas' AS target_roas,
              COALESCE(sch.enabled,false) AS auto_enabled,
              COALESCE(sch.interval_minutes,60) AS auto_interval_minutes,
              sch.next_run_at AS auto_next_run_at,
              sch.last_run_at AS auto_last_run_at,
              sch.last_status AS auto_last_status,
              sch.last_error AS auto_last_error
       FROM managed_accounts ma
       JOIN customers c ON c.id=ma.customer_id
       LEFT JOIN report_preferences p ON p.account_id=ma.account_id
       LEFT JOIN account_collection_schedules sch ON sch.account_id=ma.account_id
       LEFT JOIN LATERAL (
         SELECT j.id,j.status,j.error,max(s.captured_at) AS last_capture_at,
                (
                  SELECT r.analysis FROM capture_job_reports r
                  WHERE r.job_id=j.id
                  ORDER BY (
                    SELECT count(*) FROM jsonb_array_elements(
                      COALESCE(r.analysis->'levels','[]'::jsonb)
                    ) scope_level
                    WHERE scope_level->>'coverage'='complete'
                  ) DESC,
                  (
                    SELECT count(*) FROM jsonb_array_elements(
                      COALESCE(r.analysis->'levels','[]'::jsonb)
                    ) scope_level
                    WHERE jsonb_array_length(
                      COALESCE(scope_level->'blockers','[]'::jsonb)
                    )=0
                  ) DESC,
                  r.updated_at DESC
                  LIMIT 1
                ) AS analysis
         FROM capture_jobs j
         LEFT JOIN capture_snapshots s ON s.job_id=j.id
         WHERE j.account_id=ma.account_id
         GROUP BY j.id
         ORDER BY max(s.captured_at) DESC NULLS LAST
         LIMIT 1
       ) j ON true
       WHERE ($1::uuid IS NULL OR ma.customer_id=$1)
         AND (
           $1::uuid IS NOT NULL
           OR ma.display_name IS NOT NULL
           OR ma.report_template<>'{}'::jsonb
           OR EXISTS(
             SELECT 1 FROM bot_devices d
             WHERE d.state->>'bound_account'=ma.account_id
           )
           OR EXISTS(
             SELECT 1 FROM capture_jobs cj
             WHERE cj.account_id=ma.account_id
           )
           OR EXISTS(
             SELECT 1 FROM insight_observations io
             WHERE io.account_id=ma.account_id
           )
         )
       ORDER BY c.name,ma.display_name NULLS LAST,ma.account_id`,
      [customerId],
    );
    res.json(
      result.rows.map((row) => {
        const targetCost = row.target_cost_per_result;
        const targetRoas = row.target_roas;
        const health = accountHealth({
          ...row,
          target_cost_per_result:
            targetCost === null || targetCost === undefined
              ? null
              : Number(targetCost),
          target_roas:
            targetRoas === null || targetRoas === undefined
              ? null
              : Number(targetRoas),
        });
        return {
          account_id: row.account_id,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          display_name: row.display_name,
          enabled: row.enabled,
          report_template: row.report_template,
          device_count: row.device_count,
          fresh_devices: row.fresh_devices,
          latest_job_id: row.latest_job_id,
          latest_job_status: row.latest_job_status,
          latest_job_error: row.latest_job_error,
          last_capture_at: row.last_capture_at,
          normalized_ads: row.normalized_ads,
          target_configured: targetCost !== null || targetRoas !== null,
          auto_enabled: row.auto_enabled,
          auto_interval_minutes: row.auto_interval_minutes,
          auto_next_run_at: row.auto_next_run_at,
          auto_last_run_at: row.auto_last_run_at,
          auto_last_status: row.auto_last_status,
          auto_last_error: row.auto_last_error,
          ...health,
        };
      }),
    );
  });

  router.get("/customers", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    const allCustomers = auth.kind === "local-admin";
    const result = await pool.query(
      allCustomers
        ? `SELECT c.id,c.name,c.enabled,c.created_at,
                  count(ma.account_id)::int AS account_count
           FROM customers c
           LEFT JOIN managed_accounts ma ON ma.customer_id=c.id
           GROUP BY c.id ORDER BY c.name`
        : `SELECT c.id,c.name,c.enabled,c.created_at,
                  count(ma.account_id)::int AS account_count
           FROM customers c
           LEFT JOIN managed_accounts ma ON ma.customer_id=c.id
           WHERE c.id=$1
           GROUP BY c.id`,
      allCustomers ? [] : [auth.customer_id],
    );
    res.json(result.rows);
  });

  router.post("/customers", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const body = z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    await pool.query("INSERT INTO customers(id,name) VALUES($1,$2)", [
      id,
      body.name,
    ]);
    await writeAudit(pool, auth, "customer_created", id, { name: body.name }, id);
    res.status(201).json({ id, name: body.name, enabled: true });
  });

  router.post("/customers/:customer", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const customer = z.uuid().parse(req.params.customer);
    const body = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const result = await pool.query(
      `UPDATE customers SET enabled=$2
       WHERE id=$1
       RETURNING id,name,enabled,created_at`,
      [customer, body.enabled],
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    if (!body.enabled)
      await pool.query(
        `UPDATE account_collection_schedules s
         SET enabled=false,last_status='disabled',
             last_error='customer_disabled',updated_at=now()
         FROM managed_accounts ma
         WHERE s.account_id=ma.account_id AND ma.customer_id=$1`,
        [customer],
      );
    await writeAudit(
      pool,
      auth,
      body.enabled ? "customer_enabled" : "customer_disabled",
      customer,
      { enabled: body.enabled },
      customer,
    );
    res.json(result.rows[0]);
  });

  router.post("/customers/:customer/accounts", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const customer = z.uuid().parse(req.params.customer);
    const body = z
      .object({
        account_id: z.string().regex(/^\d+$/),
        display_name: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .parse(req.body);
    const customerExists = await pool.query(
      "SELECT 1 FROM customers WHERE id=$1",
      [customer],
    );
    if (!customerExists.rowCount) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const result = await pool.query(
      `INSERT INTO managed_accounts(account_id,customer_id,display_name)
       VALUES($1,$2,$3)
       ON CONFLICT(account_id) DO UPDATE SET
         customer_id=excluded.customer_id,
         display_name=COALESCE(excluded.display_name,managed_accounts.display_name),
         updated_at=now()
       RETURNING account_id,customer_id,display_name,enabled`,
      [body.account_id, customer, body.display_name ?? null],
    );
    await writeAudit(
      pool,
      auth,
      "account_mapped",
      body.account_id,
      {
        customer_id: customer,
        display_name: body.display_name ?? null,
      },
      customer,
    );
    res.status(201).json(result.rows[0]);
  });

  router.post("/customers/:customer/clients", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const customer = z.uuid().parse(req.params.customer);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        role: z.enum(["admin", "operator", "viewer"]).default("operator"),
      })
      .strict()
      .parse(req.body);
    const customerExists = await pool.query(
      "SELECT 1 FROM customers WHERE id=$1 AND enabled=true",
      [customer],
    );
    if (!customerExists.rowCount) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const token = randomBytes(32).toString("hex");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO api_clients(id,customer_id,name,token_hash,role) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        customer,
        body.name,
        createHash("sha256").update(token).digest("hex"),
        body.role,
      ],
    );
    await writeAudit(
      pool,
      auth,
      "client_token_issued",
      id,
      { name: body.name, role: body.role },
      customer,
    );
    res.status(201).json({
      id,
      customer_id: customer,
      name: body.name,
      role: body.role,
      token,
      token_notice:
        "Store this token securely. It is shown once and only its SHA-256 hash is stored.",
    });
  });

  router.get("/customers/:customer/clients", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const customer = z.uuid().parse(req.params.customer);
    const result = await pool.query(
      `SELECT id,customer_id,name,role,enabled,created_at
       FROM api_clients
       WHERE customer_id=$1
       ORDER BY created_at DESC`,
      [customer],
    );
    res.json(result.rows);
  });

  router.post("/customers/:customer/clients/:client", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const customer = z.uuid().parse(req.params.customer);
    const client = z.uuid().parse(req.params.client);
    const body = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const result = await pool.query(
      `UPDATE api_clients SET enabled=$3
       WHERE id=$1 AND customer_id=$2
       RETURNING id,customer_id,name,role,enabled,created_at`,
      [client, customer, body.enabled],
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Client token not found" });
      return;
    }
    await writeAudit(
      pool,
      auth,
      body.enabled ? "client_token_enabled" : "client_token_revoked",
      client,
      { customer_id: customer, name: result.rows[0].name },
      customer,
    );
    res.json(result.rows[0]);
  });

  router.get("/managed-accounts/:account/schedule", async (req, res) => {
    const account = z.string().regex(/^\d+$/).parse(req.params.account);
    const accountExists = await pool.query(
      "SELECT 1 FROM managed_accounts WHERE account_id=$1",
      [account],
    );
    if (!accountExists.rowCount) {
      res.status(404).json({ error: "Managed account not found" });
      return;
    }
    const result = await pool.query(
      `SELECT account_id,enabled AS auto_enabled,
              interval_minutes AS auto_interval_minutes,
              next_run_at AS auto_next_run_at,
              last_run_at AS auto_last_run_at,
              last_status AS auto_last_status,
              last_error AS auto_last_error
       FROM account_collection_schedules
       WHERE account_id=$1`,
      [account],
    );
    res.json(
      result.rows[0] ?? {
        account_id: account,
        auto_enabled: false,
        auto_interval_minutes: 60,
        auto_next_run_at: null,
        auto_last_run_at: null,
        auto_last_status: null,
        auto_last_error: null,
      },
    );
  });

  router.post("/managed-accounts/:account/schedule", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const account = z.string().regex(/^\d+$/).parse(req.params.account);
    const body = z
      .object({
        enabled: z.boolean(),
        interval_minutes: z.number().int().min(15).max(10080).default(60),
      })
      .strict()
      .parse(req.body);
    const managed = await pool.query(
      `SELECT customer_id,enabled FROM managed_accounts WHERE account_id=$1`,
      [account],
    );
    if (!managed.rowCount) {
      res.status(404).json({ error: "Managed account not found" });
      return;
    }
    if (body.enabled && !managed.rows[0].enabled) {
      res.status(409).json({ error: "Enable the account before scheduling it" });
      return;
    }
    const result = await pool.query(
      `INSERT INTO account_collection_schedules(
         account_id,enabled,interval_minutes,next_run_at,last_error
       ) VALUES($1,$2,$3,now(),NULL)
       ON CONFLICT(account_id) DO UPDATE SET
         enabled=excluded.enabled,
         interval_minutes=excluded.interval_minutes,
         next_run_at=CASE
           WHEN excluded.enabled THEN now()
           ELSE account_collection_schedules.next_run_at
         END,
         last_error=NULL,
         updated_at=now()
       RETURNING account_id,enabled AS auto_enabled,
                 interval_minutes AS auto_interval_minutes,
                 next_run_at AS auto_next_run_at,
                 last_run_at AS auto_last_run_at,
                 last_status AS auto_last_status,
                 last_error AS auto_last_error`,
      [account, body.enabled, body.interval_minutes],
    );
    await writeAudit(
      pool,
      auth,
      body.enabled ? "account_schedule_enabled" : "account_schedule_disabled",
      account,
      { interval_minutes: body.interval_minutes },
      managed.rows[0].customer_id,
    );
    res.json(result.rows[0]);
  });

  router.post("/managed-accounts/:account", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const account = z.string().regex(/^\d+$/).parse(req.params.account);
    const body = z
      .object({
        enabled: z.boolean().optional(),
        display_name: z.string().trim().min(1).max(120).nullable().optional(),
        report_template: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .parse(req.body);
    await ensureManagedAccount(pool, account);
    const result = await pool.query(
      `UPDATE managed_accounts SET
         enabled=COALESCE($2,enabled),
         display_name=CASE WHEN $3::text IS NULL THEN display_name ELSE $3 END,
         report_template=COALESCE($4,report_template),
         updated_at=now()
       WHERE account_id=$1
       RETURNING account_id,customer_id,display_name,enabled,report_template,updated_at`,
      [
        account,
        body.enabled ?? null,
        body.display_name === undefined ? null : body.display_name,
        body.report_template
          ? JSON.stringify(body.report_template)
          : null,
      ],
    );
    if (body.enabled === false)
      await pool.query(
        `UPDATE account_collection_schedules
         SET enabled=false,last_status='disabled',
             last_error='account_disabled',updated_at=now()
         WHERE account_id=$1`,
        [account],
      );
    await writeAudit(
      pool,
      auth,
      body.enabled === undefined
        ? "account_updated"
        : body.enabled
          ? "account_enabled"
          : "account_disabled",
      account,
      {
        enabled: body.enabled ?? null,
        display_name: body.display_name ?? null,
      },
      result.rows[0]?.customer_id ?? auth.customer_id,
    );
    res.json(result.rows[0]);
  });

  router.get("/audit-log", async (req, res) => {
    const auth = (req as any).auth as AuthContext;
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(
      req.query.limit,
    );
    const result = await pool.query(
      `SELECT a.id,a.actor_kind,cl.name AS actor_name,
              a.customer_id,c.name AS customer_name,
              a.action,a.target,a.details,a.created_at
       FROM admin_audit_log a
       LEFT JOIN api_clients cl ON cl.id=a.actor_client_id
       LEFT JOIN customers c ON c.id=a.customer_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json(result.rows);
  });

  return router;
}
