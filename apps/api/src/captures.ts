import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import {
  captureLevel,
  domSnapshotSchema,
  evaluateSnapshot,
  operatorContextSchema,
  snapshotFingerprint,
  type DomSnapshot,
  type OperatorContext,
  type RowEvaluation,
} from "../../../packages/core/src/dom-capture.js";
import { recordKey, type AdRecord } from "../../../packages/core/src/index.js";
import { analyzeCaptureJob } from "../../../packages/core/src/capture-analysis.js";

/**
 * Persistence for Extension DOM captures. Every snapshot reported by the
 * Extension is stored as a raw record. Rows are promoted into the normalized
 * entity/insight tables only when evaluateSnapshot finds every condition
 * verified; everything else stays needs_review with reasons.
 */
const jobSchema = z
  .object({
    id: z.uuid(),
    account: z.string().regex(/^\d+$/),
    levels: z.array(z.string()).max(3).default([]),
    status: z.string().max(40),
    error: z.string().max(2000).optional(),
    level_warnings: z.array(z.string().max(1000)).max(20).optional(),
    snapshots: z.array(z.unknown()).max(500).default([]),
  })
  .passthrough();

async function campaignNames(client: PoolClient, account: string) {
  const r = await client.query(
    "SELECT id,name FROM campaigns WHERE account_id=$1 AND name IS NOT NULL",
    [account],
  );
  return new Map<string, string>(r.rows.map((row) => [row.id, row.name]));
}

type Promotion = { index: number; record: AdRecord };

/** Write ready rows inside the caller's transaction. Returns per-row extra reasons. */
async function promote(
  client: PoolClient,
  snapshotId: string,
  fingerprint: string,
  page: string,
  items: Promotion[],
) {
  const blocked = new Map<number, string>();
  const promoted = new Map<number, { job: string; key: string }>();
  if (!items.length) return { blocked, promoted };
  const account = items[0].record.account_id;
  const job = randomUUID();
  await client.query(
    "INSERT INTO ad_accounts(id) VALUES($1) ON CONFLICT DO NOTHING",
    [account],
  );
  await client.query(
    "INSERT INTO import_jobs(id,account_id,fingerprint,status) VALUES($1,$2,$3,'completed')",
    [job, account, `dom-capture:${fingerprint}:${job}`],
  );
  for (const { index, record: r } of items) {
    await client.query("SAVEPOINT row_promotion");
    try {
      if (r.level === "campaign") {
        await client.query(
          "INSERT INTO campaigns(account_id,id,name,details) VALUES($1,$2,$3,'{}') ON CONFLICT(account_id,id) DO UPDATE SET name=excluded.name",
          [r.account_id, r.campaign_id, r.campaign_name],
        );
      }
      if (r.level === "adset") {
        const prior = await client.query(
          "SELECT campaign_id FROM ad_sets WHERE account_id=$1 AND id=$2",
          [r.account_id, r.ad_set_id],
        );
        if (prior.rowCount && prior.rows[0].campaign_id !== r.campaign_id)
          throw new Error("parent_relationship_conflict");
        await client.query(
          "INSERT INTO ad_sets(account_id,id,campaign_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,id) DO UPDATE SET name=COALESCE(excluded.name,ad_sets.name)",
          [r.account_id, r.ad_set_id, r.campaign_id, r.ad_set_name ?? null],
        );
      }
      if (r.level === "ad") {
        const parent = await client.query(
          "SELECT campaign_id FROM ad_sets WHERE account_id=$1 AND id=$2",
          [r.account_id, r.ad_set_id],
        );
        if (!parent.rowCount) throw new Error("parent_ad_set_not_promoted");
        if (parent.rows[0].campaign_id !== r.campaign_id)
          throw new Error("parent_relationship_conflict");
        const prior = await client.query(
          "SELECT ad_set_id FROM ads WHERE account_id=$1 AND id=$2",
          [r.account_id, r.ad_id],
        );
        if (prior.rowCount && prior.rows[0].ad_set_id !== r.ad_set_id)
          throw new Error("parent_relationship_conflict");
        await client.query(
          "INSERT INTO ads(account_id,id,ad_set_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,id) DO UPDATE SET name=COALESCE(excluded.name,ads.name)",
          [r.account_id, r.ad_id, r.ad_set_id, r.ad_name ?? null],
        );
      }
      const key = recordKey(r);
      // Never overwrite an observation that came from a validated CSV import.
      const written = await client.query(
        "INSERT INTO insight_observations(grain_key,account_id,level,entity_id,date_start,date_end,currency,timezone,attribution,result_type,data,last_job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(grain_key) DO UPDATE SET data=excluded.data,last_job_id=excluded.last_job_id,updated_at=now() WHERE insight_observations.data->'raw'->>'_source'='dom_capture' RETURNING grain_key",
        [
          key,
          r.account_id,
          r.level,
          r.ad_id ?? r.ad_set_id ?? r.campaign_id,
          r.date_start,
          r.date_end,
          r.currency,
          r.timezone,
          r.attribution,
          r.result_type,
          JSON.stringify(r),
          job,
        ],
      );
      if (!written.rowCount) throw new Error("csv_observation_exists");
      await client.query(
        "INSERT INTO insight_import_history(job_id,grain_key,data) VALUES($1,$2,$3)",
        [job, key, JSON.stringify(r)],
      );
      await client.query("RELEASE SAVEPOINT row_promotion");
      promoted.set(index, { job, key });
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT row_promotion");
      const reason =
        e instanceof Error && /^[a-z_]+$/.test(e.message)
          ? e.message
          : "promotion_failed";
      blocked.set(index, reason);
    }
  }
  if (promoted.size) {
    await client.query(
      "INSERT INTO import_files(job_id,filename,sha256,row_count) VALUES($1,$2,$3,$4)",
      [job, `dom-capture ${page}`.slice(0, 255), fingerprint, promoted.size],
    );
    await client.query(
      "INSERT INTO data_quality_reports(job_id,report) VALUES($1,$2)",
      [
        job,
        JSON.stringify({
          source: "dom_capture",
          snapshot_id: snapshotId,
          valid: true,
          errors: [],
          warnings: [
            "Rows promoted from a visible-only DOM capture with verified IDs and reporting conditions.",
            "Coverage of the entire account is unverified; rows that were not visible are not included.",
          ],
          summary: {
            rows: promoted.size,
            levels: [...new Set(items.map((i) => i.record.level))],
          },
          coverage: "visible_only",
        }),
      ],
    );
  } else {
    await client.query("DELETE FROM import_jobs WHERE id=$1", [job]);
  }
  return { blocked, promoted };
}

function snapshotStatus(
  rows: { review_status: string; review_reasons: string[] }[],
) {
  const promoted = rows.filter((r) => r.review_status === "promoted").length;
  const reasons = [...new Set(rows.flatMap((r) => r.review_reasons))];
  if (!rows.length)
    return { status: "needs_review", reasons: ["no_rows_separated"] };
  if (rows.every((r) => r.review_status === "rejected"))
    return { status: "rejected", reasons };
  return {
    status:
      promoted === rows.length
        ? "promoted"
        : promoted
          ? "partially_promoted"
          : "needs_review",
    reasons,
  };
}

/** Evaluate rows of a stored snapshot and promote the ready ones. Already promoted rows are kept. */
async function reviewStored(
  client: PoolClient,
  snapshotId: string,
  operator?: OperatorContext,
) {
  const s = await client.query(
    "SELECT fingerprint,bound_account,page,raw FROM capture_snapshots WHERE id=$1 FOR UPDATE",
    [snapshotId],
  );
  if (!s.rowCount) return null;
  const { fingerprint, bound_account, page, raw } = s.rows[0];
  const parsed = domSnapshotSchema.safeParse(raw);
  const existing = await client.query(
    "SELECT row_index,review_status FROM capture_rows WHERE snapshot_id=$1",
    [snapshotId],
  );
  const done = new Set(
    existing.rows
      .filter((r) => r.review_status === "promoted")
      .map((r) => r.row_index),
  );
  if (!parsed.success) {
    await client.query(
      "UPDATE capture_snapshots SET review_status='rejected',review_reasons=$2,reviewed_at=now() WHERE id=$1",
      [snapshotId, JSON.stringify(["invalid_snapshot_shape"])],
    );
    return {
      status: "rejected",
      reasons: ["invalid_snapshot_shape"],
      rows: [],
    };
  }
  const snapshot: DomSnapshot = parsed.data;
  const evaluations: RowEvaluation[] = evaluateSnapshot(snapshot, {
    bound_account,
    operator,
    campaign_names: await campaignNames(client, bound_account),
  });
  const ready = evaluations
    .map((e, index) => ({ e, index }))
    .filter(
      ({ e, index }) => e.status === "ready" && e.record && !done.has(index),
    )
    .map(({ e, index }) => ({ index, record: e.record! }));
  const { blocked, promoted } = await promote(
    client,
    snapshotId,
    fingerprint,
    page,
    ready,
  );
  const level = captureLevel(snapshot.page);
  const stored: { review_status: string; review_reasons: string[] }[] = [];
  for (const [index, row] of snapshot.row_observations.entries()) {
    if (done.has(index)) {
      stored.push({ review_status: "promoted", review_reasons: [] });
      continue;
    }
    const e = evaluations[index];
    const p = promoted.get(index);
    const reasons = blocked.has(index) ? [blocked.get(index)!] : e.reasons;
    const status = p
      ? "promoted"
      : e.status === "rejected"
        ? "rejected"
        : "needs_review";
    stored.push({ review_status: status, review_reasons: reasons });
    await client.query(
      `INSERT INTO capture_rows(id,snapshot_id,row_index,account_id,level,entity_id,identity_source,parent_ids,name,method,column_mapping,cells,warnings,review_status,review_reasons,operator_context,grain_key,promoted_job_id,reviewed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
       ON CONFLICT(snapshot_id,row_index) DO UPDATE SET review_status=excluded.review_status,review_reasons=excluded.review_reasons,operator_context=excluded.operator_context,grain_key=excluded.grain_key,promoted_job_id=excluded.promoted_job_id,reviewed_at=now()`,
      [
        randomUUID(),
        snapshotId,
        index,
        snapshot.account_id,
        level,
        e.entity_id,
        row.identity_source ?? null,
        JSON.stringify(row.parent_ids ?? {}),
        row.name,
        row.method,
        row.column_mapping ?? null,
        JSON.stringify(row.cells),
        JSON.stringify(row.warnings),
        status,
        JSON.stringify(reasons),
        operator ? JSON.stringify(operator) : null,
        p?.key ?? null,
        p?.job ?? null,
      ],
    );
  }
  const summary = snapshotStatus(stored);
  await client.query(
    "UPDATE capture_snapshots SET review_status=$2,review_reasons=$3,reviewed_at=now() WHERE id=$1",
    [snapshotId, summary.status, JSON.stringify(summary.reasons)],
  );
  return {
    ...summary,
    promoted: stored.filter((r) => r.review_status === "promoted").length,
    rows: stored.length,
  };
}

/** Store every snapshot of an Extension job. Idempotent: identical snapshots are stored once. */
export async function persistJob(
  pool: Pool,
  device: string,
  boundAccount: string,
  rawJob: unknown,
  extensionVersion?: string,
) {
  const job = jobSchema.safeParse(rawJob);
  if (!job.success || job.data.account !== boundAccount) return { stored: 0 };
  const client = await pool.connect();
  let stored = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4318003)");
    await client.query(
      `INSERT INTO capture_jobs(id,device_id,account_id,levels,status,error,level_warnings,extension_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status,error=excluded.error,level_warnings=excluded.level_warnings,extension_version=COALESCE(excluded.extension_version,capture_jobs.extension_version),updated_at=now()
       WHERE capture_jobs.device_id=excluded.device_id`,
      [
        job.data.id,
        device,
        boundAccount,
        JSON.stringify(job.data.levels),
        job.data.status,
        job.data.error ?? null,
        JSON.stringify(job.data.level_warnings ?? []),
        extensionVersion ?? null,
      ],
    );
    for (const raw of job.data.snapshots) {
      const fingerprint = snapshotFingerprint(raw);
      const parsed = domSnapshotSchema.safeParse(raw);
      const s = parsed.success ? parsed.data : null;
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO capture_snapshots(id,fingerprint,job_id,device_id,bound_account,account_id,page,level,captured_at,reader_version,format,coverage,column_alignment,reporting_context,warnings,row_count,review_status,review_reasons,raw)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,
        [
          id,
          fingerprint,
          job.data.id,
          device,
          boundAccount,
          s?.account_id ?? null,
          (s?.page ?? "unknown").slice(0, 300),
          s ? captureLevel(s.page) : null,
          s?.captured_at ?? new Date().toISOString(),
          s?.reader_version ?? null,
          s?.format ?? null,
          s?.coverage ?? null,
          s?.column_alignment ?? null,
          JSON.stringify(s?.reporting_context ?? {}),
          JSON.stringify(s?.warnings ?? []),
          s?.row_observations.length ?? 0,
          s ? "needs_review" : "rejected",
          JSON.stringify(s ? [] : ["invalid_snapshot_shape"]),
          JSON.stringify(raw),
        ],
      );
      if (!inserted.rowCount) continue;
      stored++;
      if (s) await reviewStored(client, id);
    }
    await client.query("COMMIT");
    return { stored };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function captureRoutes(pool: Pool) {
  const router = Router();
  // Performance analysis of one capture job (latest by default). Visible-only and
  // labelled as unverified; registered before /captures/:id so "analysis" is not an id.
  router.get("/captures/analysis", async (req, res) => {
    const account = z.string().regex(/^\d+$/).parse(req.query.account_id);
    const requested = z
      .uuid()
      .optional()
      .parse(req.query.job_id || undefined);
    const job = requested
      ? requested
      : (
          await pool.query(
            "SELECT job_id FROM capture_snapshots WHERE bound_account=$1 AND job_id IS NOT NULL GROUP BY job_id ORDER BY max(captured_at) DESC LIMIT 1",
            [account],
          )
        ).rows[0]?.job_id;
    if (!job) {
      res.status(404).json({ error: "No Extension captures for this account" });
      return;
    }
    const meta = await pool.query(
      "SELECT id,status,levels,error,level_warnings,extension_version,first_seen_at,updated_at FROM capture_jobs WHERE id=$1 AND account_id=$2",
      [job, account],
    );
    if (!meta.rowCount) {
      res.status(404).json({ error: "Capture job not found for this account" });
      return;
    }
    const s = await pool.query(
      "SELECT raw FROM capture_snapshots WHERE bound_account=$1 AND job_id=$2 AND review_status<>'rejected' ORDER BY captured_at",
      [account, job],
    );
    const snapshots = s.rows
      .map((r) => domSnapshotSchema.safeParse(r.raw))
      .filter((p) => p.success && p.data.account_id === account)
      .map((p) => p.data!);
    const jobs = await pool.query(
      "SELECT job_id,max(captured_at) AS captured_at,count(*)::int AS snapshots FROM capture_snapshots WHERE bound_account=$1 AND job_id IS NOT NULL GROUP BY job_id ORDER BY max(captured_at) DESC LIMIT 20",
      [account],
    );
    const confirm = (value: unknown) =>
      value === "true" ? (true as const) : undefined;
    const operator = operatorContextSchema.parse({
      ...(typeof req.query.timezone === "string"
        ? { timezone: req.query.timezone }
        : {}),
      ...(typeof req.query.attribution === "string"
        ? { attribution: req.query.attribution }
        : {}),
      ...(typeof req.query.result_type === "string"
        ? { result_type: req.query.result_type }
        : {}),
      ...(confirm(req.query.confirm_no_breakdown)
        ? { confirm_no_breakdown: true }
        : {}),
      ...(confirm(req.query.confirm_no_filters)
        ? { confirm_no_filters: true }
        : {}),
    });
    res.json({
      job: meta.rows[0],
      jobs: jobs.rows,
      ...analyzeCaptureJob(snapshots, { operator }),
    });
  });
  router.get("/captures", async (req, res) => {
    const account = z.string().regex(/^\d+$/).parse(req.query.account_id);
    const status = z
      .enum(["needs_review", "partially_promoted", "promoted", "rejected"])
      .optional()
      .parse(req.query.status || undefined);
    const r = await pool.query(
      `SELECT s.id,s.job_id,s.device_id,s.account_id,s.page,s.level,s.captured_at,s.reader_version,s.format,s.coverage,s.column_alignment,
              s.reporting_context,s.warnings,s.row_count,s.review_status,s.review_reasons,s.created_at,s.reviewed_at,
              (SELECT count(*) FROM capture_rows r WHERE r.snapshot_id=s.id AND r.review_status='promoted')::int AS promoted_rows,
              (SELECT count(*) FROM capture_rows r WHERE r.snapshot_id=s.id AND r.entity_id IS NOT NULL)::int AS rows_with_id
         FROM capture_snapshots s WHERE s.bound_account=$1 AND ($2::text IS NULL OR s.review_status=$2)
         ORDER BY s.captured_at DESC LIMIT 200`,
      [account, status ?? null],
    );
    res.json(r.rows);
  });
  router.get("/captures/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const s = await pool.query(
      "SELECT id,job_id,device_id,bound_account,account_id,page,level,captured_at,reader_version,format,coverage,column_alignment,reporting_context,warnings,row_count,review_status,review_reasons,created_at,reviewed_at FROM capture_snapshots WHERE id=$1",
      [id],
    );
    if (!s.rowCount) {
      res.status(404).json({ error: "Capture not found" });
      return;
    }
    const rows = await pool.query(
      "SELECT row_index,entity_id,identity_source,parent_ids,name,method,column_mapping,cells,warnings,review_status,review_reasons,operator_context,grain_key,reviewed_at FROM capture_rows WHERE snapshot_id=$1 ORDER BY row_index",
      [id],
    );
    res.json({ ...s.rows[0], rows: rows.rows });
  });
  // Re-evaluate a capture. The operator may confirm timezone/attribution/result type
  // exactly like the CSV import context; IDs, dates and currency must come from the page.
  router.post("/captures/:id/review", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z
      .object({ context: operatorContextSchema.optional() })
      .strict()
      .parse(req.body ?? {});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(4318003)");
      const result = await reviewStored(client, id, body.context);
      await client.query("COMMIT");
      if (!result) {
        res.status(404).json({ error: "Capture not found" });
        return;
      }
      res.json(result);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
  return router;
}
