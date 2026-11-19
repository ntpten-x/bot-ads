import type { Pool } from "pg";
import {
  domSnapshotSchema,
  operatorContextSchema,
  type OperatorContext,
} from "../../../packages/core/src/dom-capture.js";
import {
  analyzeCaptureJob,
  captureAnalysisVersion,
} from "../../../packages/core/src/capture-analysis.js";

export const operatorContextKey = (operator: OperatorContext) =>
  JSON.stringify(
    Object.entries(operator)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

/**
 * Refresh cached reports produced by an older analysis contract. Raw captures
 * remain untouched; only the derived cache rows are replaced.
 */
export async function refreshStaleReportCaches(
  pool: Pool,
  account: string,
  requestedJob?: string,
) {
  const stale = await pool.query(
    `SELECT j.id AS job_id,r.context_key,r.operator_context
     FROM capture_jobs j
     JOIN capture_job_reports r ON r.job_id=j.id
     WHERE j.account_id=$1
       AND r.analyzer_version<>$2
       AND ($3::uuid IS NULL OR j.id=$3)
     ORDER BY j.updated_at DESC,r.updated_at DESC
     LIMIT 100`,
    [account, captureAnalysisVersion, requestedJob ?? null],
  );
  for (const report of stale.rows) {
    const raw = await pool.query(
      "SELECT raw FROM capture_snapshots WHERE bound_account=$1 AND job_id=$2 AND review_status<>'rejected' ORDER BY captured_at",
      [account, report.job_id],
    );
    const snapshots = raw.rows
      .map((row) => domSnapshotSchema.safeParse(row.raw))
      .filter((result) => result.success && result.data.account_id === account)
      .map((result) => result.data!);
    const operator = operatorContextSchema.parse(
      report.operator_context ?? {},
    );
    const analysis = analyzeCaptureJob(snapshots, { operator });
    await pool.query(
      `UPDATE capture_job_reports
       SET analysis=$1,analyzer_version=$2,updated_at=now()
       WHERE job_id=$3 AND context_key=$4`,
      [
        JSON.stringify(analysis),
        captureAnalysisVersion,
        report.job_id,
        report.context_key,
      ],
    );
  }
  return stale.rowCount ?? 0;
}
