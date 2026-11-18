import type { AnalyzedRow, LevelAnalysis } from "./capture-analysis";
import { recordSource, type AnalysisSource } from "./analysis";
import type { AdRecord } from "./index";

type Metric = "spend" | "impressions" | "results";

export type MetricReconciliation = {
  dom: number | null;
  csv: number | null;
  delta: number | null;
  matched: boolean | null;
};

export type DomCsvReconciliation = {
  filename: string;
  import_verified: boolean;
  dom_rows: number;
  csv_rows: number;
  matched_ids: number;
  dom_only_ids: string[];
  csv_only_ids: string[];
  metrics: Record<Metric, MetricReconciliation>;
  status: "matched" | "mismatch" | "incomplete";
  notes: string[];
};

const canonicalBreakdown = (value: unknown) =>
  JSON.stringify(
    Object.entries(
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    ).sort(([a], [b]) => a.localeCompare(b)),
  );

const sum = (values: (number | null)[]) =>
  values.every((value) => value !== null)
    ? values.reduce<number>((total, value) => total + value!, 0)
    : null;

const sameMetric = (left: number | null, right: number | null) =>
  left === null || right === null ? null : Math.abs(left - right) <= 0.01;

function compareMetric(left: number | null, right: number | null) {
  return {
    dom: left,
    csv: right,
    delta: left === null || right === null ? null : right - left,
    matched: sameMetric(left, right),
  };
}

function recordSourceLabel(record: AdRecord): AnalysisSource {
  return recordSource(record);
}

function importProofVerified(record: AdRecord, filename: string) {
  try {
    const proof = JSON.parse(record.raw._import_reconciliation ?? "") as {
      version?: unknown;
      filename?: unknown;
      reconciliation?: { status?: unknown; verified?: unknown };
    };
    return (
      proof.version === 1 &&
      proof.filename === filename &&
      proof.reconciliation?.status === "verified_for_import" &&
      proof.reconciliation.verified === true
    );
  } catch {
    return false;
  }
}

function contextMatches(
  level: LevelAnalysis,
  record: AdRecord,
  resultType: string | null,
) {
  const context = level.context;
  return (
    record.level === "ad" &&
    record.account_id === context.account_id &&
    record.date_start === context.date_start &&
    record.date_end === context.date_end &&
    record.currency === context.currency &&
    record.timezone === context.timezone &&
    record.attribution === context.attribution &&
    resultType !== null &&
    record.result_type === resultType &&
    canonicalBreakdown(record.breakdown) ===
      canonicalBreakdown(context.breakdown)
  );
}

/**
 * Compare one captured Ads scope with compatible CSV imports. This never combines
 * their metrics: it only compares stable IDs and totals within the same context.
 */
export function reconcileDomWithCsv(
  level: LevelAnalysis,
  records: AdRecord[],
): DomCsvReconciliation[] {
  const resultTypes = new Set(
    level.rows
      .map((row) => row.result_type)
      .filter((value): value is string => Boolean(value)),
  );
  const resultType = resultTypes.size === 1 ? [...resultTypes][0] : null;
  if (!resultType) return [];
  const csvByFile = new Map<string, AdRecord[]>();
  for (const record of records) {
    if (
      recordSourceLabel(record) !== "csv" ||
      !record.raw._source_filename ||
      !contextMatches(level, record, resultType)
    )
      continue;
    const filename = record.raw._source_filename;
    csvByFile.set(filename, [...(csvByFile.get(filename) ?? []), record]);
  }
  const dom = new Map(
    level.rows
      .filter(
        (row): row is AnalyzedRow & { entity_id: string } =>
          row.entity_id !== null,
      )
      .map((row) => [row.entity_id, row]),
  );
  return [...csvByFile]
    .map(([filename, rows]) => {
      const csv = new Map<string, AdRecord>();
      const duplicates = new Set<string>();
      for (const row of rows) {
        if (!row.ad_id) continue;
        if (csv.has(row.ad_id)) duplicates.add(row.ad_id);
        else csv.set(row.ad_id, row);
      }
      const common = [...dom.keys()]
        .filter((id) => csv.has(id))
        .sort((a, b) => a.localeCompare(b));
      const domOnly = [...dom.keys()]
        .filter((id) => !csv.has(id))
        .sort((a, b) => a.localeCompare(b));
      const csvOnly = [...csv.keys()]
        .filter((id) => !dom.has(id))
        .sort((a, b) => a.localeCompare(b));
      const metrics = {
        spend: compareMetric(
          sum([...dom.values()].map((row) => row.spend)),
          sum(rows.map((row) => row.spend)),
        ),
        impressions: compareMetric(
          sum([...dom.values()].map((row) => row.impressions)),
          sum(rows.map((row) => row.impressions)),
        ),
        results: compareMetric(
          sum([...dom.values()].map((row) => row.results)),
          sum(
            rows.map((row) =>
              typeof row.results === "number" ? row.results : null,
            ),
          ),
        ),
      };
      const completeMetrics = Object.values(metrics).every(
        (metric) => metric.matched !== null,
      );
      const matched =
        duplicateCount(duplicates) === 0 &&
        domOnly.length === 0 &&
        csvOnly.length === 0 &&
        completeMetrics &&
        Object.values(metrics).every((metric) => metric.matched === true);
      const notes = [
        ...(duplicates.size ? ["CSV has duplicate Ad IDs in this scope"] : []),
        ...(domOnly.length ? ["DOM has Ads missing from this CSV"] : []),
        ...(csvOnly.length ? ["CSV has Ads missing from DOM capture"] : []),
        ...(!completeMetrics
          ? [
              "At least one metric is unknown on one side, so equality is unverified",
            ]
          : []),
      ];
      return {
        filename,
        import_verified: rows.every((row) =>
          importProofVerified(row, filename),
        ),
        dom_rows: dom.size,
        csv_rows: rows.length,
        matched_ids: common.length,
        dom_only_ids: domOnly,
        csv_only_ids: csvOnly,
        metrics,
        status: matched ? ("matched" as const) : ("mismatch" as const),
        notes,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function duplicateCount(values: Set<string>) {
  return values.size;
}
