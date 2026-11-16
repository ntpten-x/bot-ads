import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  parseReport,
  recordKey,
  type ImportInput,
} from "../../../packages/core/src/index.js";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function saveImport(input: ImportInput) {
  const report = parseReport(input);
  if (!report.valid) return { status: 422, body: report };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4318002)");
    const existing = await client.query(
      "SELECT id FROM import_jobs WHERE fingerprint=$1",
      [fingerprint],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return {
        status: 200,
        body: { job_id: existing.rows[0].id, duplicate: true, report },
      };
    }
    const job = randomUUID();
    await client.query(
      "INSERT INTO ad_accounts(id) VALUES($1) ON CONFLICT DO NOTHING",
      [input.expected_account_id],
    );
    await client.query(
      "INSERT INTO import_jobs(id,account_id,fingerprint,status) VALUES($1,$2,$3,'completed')",
      [job, input.expected_account_id, fingerprint],
    );
    for (const r of report.records) {
      await client.query(
        "INSERT INTO campaigns(account_id,id,name,details) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,id) DO UPDATE SET name=excluded.name,details=campaigns.details || excluded.details",
        [
          r.account_id,
          r.campaign_id,
          r.campaign_name,
          JSON.stringify({
            ...(r.status && r.level === "campaign" ? { status: r.status } : {}),
            ...(r.objective ? { objective: r.objective } : {}),
          }),
        ],
      );
      if (r.ad_set_id) {
        const prior = await client.query(
          "SELECT campaign_id FROM ad_sets WHERE account_id=$1 AND id=$2",
          [r.account_id, r.ad_set_id],
        );
        if (prior.rowCount && prior.rows[0].campaign_id !== r.campaign_id)
          throw new Error("RELATIONSHIP_CONFLICT");
        await client.query(
          "INSERT INTO ad_sets(account_id,id,campaign_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,id) DO UPDATE SET name=COALESCE(excluded.name,ad_sets.name)",
          [r.account_id, r.ad_set_id, r.campaign_id, r.ad_set_name ?? null],
        );
      }
      if (r.ad_id) {
        const prior = await client.query(
          "SELECT ad_set_id FROM ads WHERE account_id=$1 AND id=$2",
          [r.account_id, r.ad_id],
        );
        if (prior.rowCount && prior.rows[0].ad_set_id !== r.ad_set_id)
          throw new Error("RELATIONSHIP_CONFLICT");
        await client.query(
          "INSERT INTO ads(account_id,id,ad_set_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,id) DO UPDATE SET name=COALESCE(excluded.name,ads.name)",
          [r.account_id, r.ad_id, r.ad_set_id, r.ad_name ?? null],
        );
        if (r.creative)
          await client.query(
            "INSERT INTO ad_creatives(account_id,ad_id,details) VALUES($1,$2,$3) ON CONFLICT(account_id,ad_id) DO UPDATE SET details=ad_creatives.details || excluded.details,updated_at=now()",
            [r.account_id, r.ad_id, JSON.stringify(r.creative)],
          );
      }
      const key = recordKey(r);
      if (r.breakdown)
        await client.query(
          "INSERT INTO insights_breakdowns(id,job_id,dimensions,data) VALUES($1,$2,$3,$4)",
          [randomUUID(), job, JSON.stringify(r.breakdown), JSON.stringify(r)],
        );
      await client.query(
        "INSERT INTO insight_observations(grain_key,account_id,level,entity_id,date_start,date_end,currency,timezone,attribution,result_type,data,last_job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(grain_key) DO UPDATE SET data=excluded.data,last_job_id=excluded.last_job_id,updated_at=now()",
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
      await client.query(
        "INSERT INTO insight_import_history(job_id,grain_key,data) VALUES($1,$2,$3)",
        [job, key, JSON.stringify(r)],
      );
    }
    await client.query(
      "INSERT INTO import_files(job_id,filename,sha256,row_count) VALUES($1,$2,$3,$4)",
      [
        job,
        input.filename,
        createHash("sha256").update(input.csv).digest("hex"),
        report.records.length,
      ],
    );
    await client.query(
      "INSERT INTO data_quality_reports(job_id,report) VALUES($1,$2)",
      [job, JSON.stringify({ ...report, records: undefined })],
    );
    await client.query("COMMIT");
    return { status: 201, body: { job_id: job, duplicate: false, report } };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
