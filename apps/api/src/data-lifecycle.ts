import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Router } from "express";
import { z } from "zod";
import {
  dataLifecyclePolicySchema,
  defaultDataLifecyclePolicy,
  lifecycleCutoffs,
  type DataLifecyclePolicy,
} from "../../../packages/core/src/data-lifecycle.js";
import { assertManagedAccountEnabled } from "./accounts.js";

type Db = Pool | PoolClient;

export async function loadDataLifecyclePolicy(db: Db) {
  const result = await db.query(
    "SELECT data FROM data_lifecycle_policy WHERE id='default'",
  );
  const parsed = dataLifecyclePolicySchema.safeParse(result.rows[0]?.data);
  return parsed.success ? parsed.data : defaultDataLifecyclePolicy;
}

export async function saveDataLifecyclePolicy(
  db: Db,
  input: Partial<DataLifecyclePolicy>,
) {
  const current = await loadDataLifecyclePolicy(db);
  const policy = dataLifecyclePolicySchema.parse({ ...current, ...input });
  await db.query(
    `INSERT INTO data_lifecycle_policy(id,data,updated_at)
     VALUES('default',$1,now())
     ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=now()`,
    [JSON.stringify(policy)],
  );
  return policy;
}

export async function dataLifecycleStats(
  db: Db,
  accountId?: string,
) {
  const policy = await loadDataLifecyclePolicy(db);
  const cutoffs = lifecycleCutoffs(policy);
  const catalog = await db.query(
        `SELECT count(*)::int AS count,
                count(*) FILTER (WHERE last_seen_at >= now() - interval '30 days')::int AS recent
         FROM ad_catalog
         WHERE ($1::text IS NULL OR account_id=$1)`,
        [accountId ?? null],
      );
  const statuses = await db.query(
        `SELECT COALESCE(delivery,'unknown') AS delivery,count(*)::int AS count
         FROM ad_catalog
         WHERE ($1::text IS NULL OR account_id=$1)
         GROUP BY COALESCE(delivery,'unknown')
         ORDER BY count(*) DESC`,
        [accountId ?? null],
      );
  const daily = await db.query(
        `SELECT count(*)::int AS count
         FROM insight_observations
         WHERE ($1::text IS NULL OR account_id=$1)
           AND date_start=date_end
           AND NOT (data ? 'breakdown')
           AND date_start < $2::date`,
        [accountId ?? null, cutoffs.daily_metrics_before],
      );
  const monthly = await db.query(
        `SELECT count(*)::int AS count
         FROM ad_performance_monthly
         WHERE ($1::text IS NULL OR account_id=$1)`,
        [accountId ?? null],
      );
  const raw = await db.query(
        `SELECT count(*)::int AS count
         FROM capture_snapshots s
         JOIN capture_jobs j ON j.id=s.job_id
         WHERE ($1::text IS NULL OR s.bound_account=$1)
           AND s.captured_at < $2::timestamptz
           AND s.review_status='promoted'
           AND j.status<>'running'`,
        [accountId ?? null, cutoffs.raw_capture_before],
      );
  const rawBytes = await db.query(
        `SELECT COALESCE(sum(pg_column_size(s.raw)),0)::bigint AS bytes
         FROM capture_snapshots s
         WHERE ($1::text IS NULL OR s.bound_account=$1)`,
        [accountId ?? null],
      );
  const versions = await db.query(
        `SELECT count(*)::int AS count
         FROM entity_versions
         WHERE ($1::text IS NULL OR account_id=$1)
           AND observed_at < $2::timestamptz`,
        [accountId ?? null, cutoffs.entity_versions_before],
      );
  return {
    policy,
    cutoffs,
    catalog: {
      ads: catalog.rows[0]?.count ?? 0,
      seen_last_30_days: catalog.rows[0]?.recent ?? 0,
      by_delivery: statuses.rows,
    },
    eligible: {
      daily_observations_to_rollup: daily.rows[0]?.count ?? 0,
      monthly_rollups: monthly.rows[0]?.count ?? 0,
      raw_snapshots_to_purge: raw.rows[0]?.count ?? 0,
      old_entity_versions: versions.rows[0]?.count ?? 0,
    },
    storage: {
      raw_capture_bytes: Number(rawBytes.rows[0]?.bytes ?? 0),
    },
    intentionally_retained: {
      creative_versions: "retain by content hash",
      recommendation_outcomes: "retain for audit and learning",
      needs_review_captures: "retain until reviewed",
    },
  };
}

export async function runDataLifecycle(
  pool: Pool,
  options: { apply: boolean; accountId?: string },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4318014)");
    const policy = await loadDataLifecyclePolicy(client);
    const cutoffs = lifecycleCutoffs(policy);
    const before = await dataLifecycleStats(client, options.accountId);
    if (!options.apply) {
      await client.query(
        `INSERT INTO data_lifecycle_runs(id,mode,account_id,policy,stats)
         VALUES($1,'dry_run',$2,$3,$4)`,
        [
          randomUUID(),
          options.accountId ?? null,
          JSON.stringify(policy),
          JSON.stringify(before),
        ],
      );
      await client.query("COMMIT");
      return { mode: "dry_run" as const, ...before };
    }

    await client.query(
      `INSERT INTO ad_performance_monthly(
         account_id,level,entity_id,month_start,currency,timezone,attribution,
         result_type,spend,impressions,results,observations,updated_at
       )
       SELECT
         account_id,level,entity_id,date_trunc('month',date_start)::date,
         currency,timezone,attribution,result_type,
         sum((data->>'spend')::numeric) FILTER (WHERE data ? 'spend'),
         sum((data->>'impressions')::numeric) FILTER (WHERE data ? 'impressions'),
         sum((data->>'results')::numeric) FILTER (WHERE data ? 'results'),
         count(*)::int,now()
       FROM insight_observations
       WHERE ($1::text IS NULL OR account_id=$1)
         AND date_start=date_end
         AND NOT (data ? 'breakdown')
         AND date_start < $2::date
       GROUP BY
         account_id,level,entity_id,date_trunc('month',date_start)::date,
         currency,timezone,attribution,result_type
       ON CONFLICT(
         account_id,level,entity_id,month_start,currency,timezone,attribution,
         result_type
       ) DO UPDATE SET
         spend=excluded.spend,
         impressions=excluded.impressions,
         results=excluded.results,
         observations=excluded.observations,
         updated_at=now()`,
      [options.accountId ?? null, cutoffs.daily_metrics_before],
    );
    await client.query(
      `DELETE FROM insight_import_history h
       USING insight_observations o
       WHERE h.grain_key=o.grain_key
         AND ($1::text IS NULL OR o.account_id=$1)
         AND o.date_start=o.date_end
         AND NOT (o.data ? 'breakdown')
         AND o.date_start < $2::date`,
      [options.accountId ?? null, cutoffs.daily_metrics_before],
    );
    const deletedDaily = await client.query(
      `DELETE FROM insight_observations
       WHERE ($1::text IS NULL OR account_id=$1)
         AND date_start=date_end
         AND NOT (data ? 'breakdown')
         AND date_start < $2::date`,
      [options.accountId ?? null, cutoffs.daily_metrics_before],
    );
    const deletedRaw = await client.query(
      `DELETE FROM capture_snapshots s
       USING capture_jobs j
       WHERE s.job_id=j.id
         AND ($1::text IS NULL OR s.bound_account=$1)
         AND s.captured_at < $2::timestamptz
         AND s.review_status='promoted'
         AND j.status<>'running'`,
      [options.accountId ?? null, cutoffs.raw_capture_before],
    );
    const deletedVersions = await client.query(
      `WITH ranked AS (
         SELECT id,row_number() OVER (
           PARTITION BY account_id,level,entity_id
           ORDER BY observed_at DESC,id DESC
         ) AS ordinal
         FROM entity_versions
         WHERE ($1::text IS NULL OR account_id=$1)
           AND observed_at < $2::timestamptz
       )
       DELETE FROM entity_versions e
       USING ranked r
       WHERE e.id=r.id AND r.ordinal>1`,
      [options.accountId ?? null, cutoffs.entity_versions_before],
    );
    const result = {
      mode: "apply" as const,
      policy,
      cutoffs,
      before,
      deleted: {
        daily_observations: deletedDaily.rowCount ?? 0,
        raw_snapshots: deletedRaw.rowCount ?? 0,
        entity_versions: deletedVersions.rowCount ?? 0,
      },
    };
    await client.query(
      `INSERT INTO data_lifecycle_runs(id,mode,account_id,policy,stats)
       VALUES($1,'apply',$2,$3,$4)`,
      [
        randomUUID(),
        options.accountId ?? null,
        JSON.stringify(policy),
        JSON.stringify(result),
      ],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function dataLifecycleRoutes(pool: Pool) {
  const router = Router();
  const account = z.string().regex(/^\d+$/).optional();

  router.get("/data-lifecycle", async (req, res) => {
    const accountId = account.parse(req.query.account_id || undefined);
    const auth = (req as any).auth as { kind?: string };
    if (auth.kind !== "local-admin" && !accountId) {
      res.status(400).json({ error: "account_id is required for client tokens" });
      return;
    }
    if (accountId) await assertManagedAccountEnabled(pool, accountId);
    res.json(await dataLifecycleStats(pool, accountId));
  });

  router.post("/data-lifecycle/policy", async (req, res) => {
    const auth = (req as any).auth as { kind?: string };
    if (auth.kind !== "local-admin") {
      res.status(403).json({ error: "Local admin role required" });
      return;
    }
    const policy = await saveDataLifecyclePolicy(pool, req.body);
    res.json({ policy });
  });

  router.post("/data-lifecycle/preview", async (req, res) => {
    const body = z
      .object({ account_id: account })
      .strict()
      .parse(req.body ?? {});
    const auth = (req as any).auth as { kind?: string };
    if (auth.kind !== "local-admin" && !body.account_id) {
      res.status(400).json({ error: "account_id is required for client tokens" });
      return;
    }
    if (body.account_id)
      await assertManagedAccountEnabled(pool, body.account_id);
    res.json(
      await runDataLifecycle(pool, {
        apply: false,
        accountId: body.account_id,
      }),
    );
  });

  return router;
}
