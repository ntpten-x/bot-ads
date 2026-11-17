import { z } from "zod";
import Papa from "papaparse";
import { metricNames, canonicalHeader, analysisColumns } from "./metrics";
export { metricNames, canonicalHeader, analysisColumns } from "./metrics";
const id = z.string().regex(/^\d+$/, "ID must contain digits only");
const date = z.iso.date();
export const recordSchema = z
  .object({
    account_id: id,
    campaign_id: id,
    campaign_name: z.string().min(1),
    ad_set_id: id.optional(),
    ad_set_name: z.string().optional(),
    ad_id: id.optional(),
    ad_name: z.string().optional(),
    level: z.enum(["campaign", "adset", "ad"]),
    date_start: date,
    date_end: date,
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1),
    attribution: z.string().min(1),
    result_type: z.string().min(1),
    spend: z.number().nonnegative(),
    impressions: z.number().int().nonnegative(),
    reach: z.number().int().nonnegative().optional(),
    results: z.number().nonnegative().optional(),
    link_clicks: z.number().int().nonnegative().optional(),
    purchase_value: z.number().nonnegative().optional(),
    status: z.string().optional(),
    objective: z.string().optional(),
    creative: z
      .object({
        body: z.string().optional(),
        headline: z.string().optional(),
        description: z.string().optional(),
        cta: z.string().optional(),
        destination_url: z.url().optional(),
        type: z.string().optional(),
      })
      .optional(),
    breakdown: z
      .partialRecord(
        z.enum([
          "age",
          "gender",
          "country",
          "region",
          "publisher_platform",
          "platform_position",
          "impression_device",
          "device_platform",
          "placement",
          "device",
        ]),
        z.string(),
      )
      .optional(),
    metrics: z
      .partialRecord(z.enum(metricNames), z.number().nonnegative())
      .optional(),
    raw: z.record(z.string(), z.string()),
  })
  .superRefine((r, c) => {
    if (r.date_start > r.date_end)
      c.addIssue({ code: "custom", message: "date_start must be <= date_end" });
    if (r.level !== "campaign" && !r.ad_set_id)
      c.addIssue({ code: "custom", message: "ad_set_id is required" });
    if (r.level === "ad" && !r.ad_id)
      c.addIssue({ code: "custom", message: "ad_id is required" });
    if (r.level === "campaign" && (r.ad_set_id || r.ad_id))
      c.addIssue({
        code: "custom",
        message: "campaign rows cannot contain child IDs",
      });
    if (r.level === "adset" && r.ad_id)
      c.addIssue({
        code: "custom",
        message: "adset rows cannot contain ad_id",
      });
    try {
      new Intl.DateTimeFormat("en", { timeZone: r.timezone });
    } catch {
      c.addIssue({ code: "custom", message: "invalid IANA timezone" });
    }
  });
export type AdRecord = z.infer<typeof recordSchema>;
export const importSchema = z.object({
  filename: z.string().min(1).max(255),
  csv: z.string().min(1).max(10_000_000),
  expected_account_id: id,
  context: z.object({
    timezone: z.string().min(1),
    attribution: z.string().min(1),
    result_type: z.string().min(1),
  }),
  number_format: z.enum(["plain", "grouped_dot"]).optional(),
  column_mapping: z
    .record(
      z.string(),
      z.union([z.enum(analysisColumns), z.literal("__raw__")]),
    )
    .optional(),
  expected: z
    .object({
      rows: z.number().int().positive().optional(),
      spend: z.number().nonnegative().optional(),
      date_start: date.optional(),
      date_end: date.optional(),
    })
    .default({}),
});
export type ImportInput = z.infer<typeof importSchema>;
export type ReconciliationCheck = {
  expected: number | null;
  actual: number;
  delta: number | null;
  matched: boolean | null;
};
export type ImportReconciliation = {
  scope: "import";
  status: "verified_for_import" | "incomplete" | "mismatch";
  verified: boolean;
  rows: ReconciliationCheck;
  spend: ReconciliationCheck;
  interval: {
    checked: boolean;
    expected_start: string | null;
    expected_end: string | null;
    actual_start: string | null;
    actual_end: string | null;
    matched: boolean | null;
  };
  unchecked_inputs: Array<"rows" | "spend" | "interval">;
  mismatches: string[];
  note: string;
};
const numeric = [
  "spend",
  "impressions",
  "reach",
  "results",
  "link_clicks",
  "purchase_value",
];
export function parseReport(input: ImportInput) {
  const parsed = Papa.parse<Record<string, string>>(input.csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) =>
      input.column_mapping?.[h] === "__raw__"
        ? `_raw_${h}`
        : (input.column_mapping?.[h] ?? canonicalHeader(h)),
  });
  const errors: string[] = parsed.errors.map(
    (e) => `CSV row ${e.row ?? "?"}: ${e.message}`,
  );
  if (parsed.meta.renamedHeaders)
    errors.push("Duplicate headers are not allowed");
  const originalHeaders =
    Papa.parse<string[]>(input.csv, { preview: 1 }).data[0] ?? [];
  const currencies = new Set(
    originalHeaders
      .filter(
        (h) => (input.column_mapping?.[h] ?? canonicalHeader(h)) === "spend",
      )
      .map((h) => /\(([A-Za-z]{3})\)\s*$/.exec(h)?.[1]?.toUpperCase())
      .filter(Boolean),
  );
  const headerCurrency = currencies.size === 1 ? [...currencies][0] : undefined;
  const parseNumber = (text: string) => {
    const pattern =
      input.number_format === "grouped_dot"
        ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
        : /^\d+(\.\d+)?$/;
    return pattern.test(text) ? Number(text.replaceAll(",", "")) : NaN;
  };
  const records: AdRecord[] = [];
  if (!parsed.data.length) errors.push("No data rows");
  for (const [i, raw] of parsed.data.entries()) {
    const clean = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [
        k,
        typeof v === "string" ? v.trim() : v,
      ]),
    );
    const value: Record<string, unknown> = {
      ...input.context,
      ...clean,
      raw: {
        ...raw,
        _source_filename: input.filename,
        _source_data_row: String(i + 1),
      },
    };
    if (!clean.currency && headerCurrency) value.currency = headerCurrency;
    if (clean.currency && headerCurrency && clean.currency !== headerCurrency)
      errors.push(`Row ${i + 2}: currency differs from spend column currency`);
    for (const [k, v] of Object.entries(value)) if (v === "") delete value[k];
    value.level =
      clean.level ||
      (clean.ad_id ? "ad" : clean.ad_set_id ? "adset" : "campaign");
    for (const k of numeric) if (clean[k]) value[k] = parseNumber(clean[k]);
    const breakdown = Object.fromEntries(
      [
        "age",
        "gender",
        "country",
        "region",
        "publisher_platform",
        "platform_position",
        "impression_device",
        "device_platform",
        "placement",
        "device",
      ]
        .filter((k) => clean[k])
        .map((k) => [k, clean[k]]),
    );
    if (Object.keys(breakdown).length) value.breakdown = breakdown;
    const metrics = Object.fromEntries(
      metricNames
        .filter((k) => clean[k])
        .map((k) => [k, parseNumber(clean[k])]),
    );
    if (Object.keys(metrics).length) value.metrics = metrics;
    const creative = Object.fromEntries(
      ["body", "headline", "description", "cta", "destination_url", "type"]
        .filter((k) => clean[`creative_${k}`])
        .map((k) => [k, clean[`creative_${k}`]]),
    );
    if (Object.keys(creative).length) value.creative = creative;
    const result = recordSchema.safeParse(value);
    if (!result.success) {
      errors.push(
        `Row ${i + 2}: ${result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      );
      continue;
    }
    if (result.data.account_id !== input.expected_account_id)
      errors.push(`Row ${i + 2}: account differs from selected account`);
    records.push(result.data);
  }
  const keys = new Set<string>();
  const parents = new Map<string, string>();
  for (const r of records) {
    const key = recordKey(r);
    if (keys.has(key))
      errors.push(
        `Duplicate reporting grain: ${r.ad_id ?? r.ad_set_id ?? r.campaign_id}`,
      );
    keys.add(key);
    for (const [child, parent] of [
      [r.ad_set_id, r.campaign_id],
      [r.ad_id, r.ad_set_id],
    ])
      if (child && parent) {
        const k = `${r.account_id}:${child}`;
        if (parents.has(k) && parents.get(k) !== parent)
          errors.push(`Conflicting parent for ${child}`);
        parents.set(k, parent);
      }
  }
  const breakdownShapes = new Set(
    records.map((r) =>
      Object.keys(r.breakdown ?? {})
        .sort()
        .join(","),
    ),
  );
  if (breakdownShapes.size > 1)
    errors.push(
      "Import one breakdown combination per file; totals and breakdowns cannot be reconciled together",
    );
  const levels = new Set(records.map((r) => r.level));
  if (levels.size > 1)
    errors.push("Import one reporting level per file to avoid double counting");
  for (const field of [
    "currency",
    "timezone",
    "attribution",
    "result_type",
  ] as const) {
    if (new Set(records.map((r) => r[field])).size > 1)
      errors.push(`Mixed ${field}: import one reporting condition per file`);
  }
  const intervals = new Map<string, AdRecord[]>();
  for (const r of records) {
    const grouping = JSON.stringify([
      r.account_id,
      r.level,
      r.ad_id ?? r.ad_set_id ?? r.campaign_id,
      r.currency,
      r.timezone,
      r.attribution,
      r.result_type,
      Object.entries(r.breakdown ?? {}).sort(),
    ]);
    const prior = intervals.get(grouping) ?? [];
    prior.push(r);
    intervals.set(grouping, prior);
  }
  for (const group of intervals.values()) {
    group.sort((a, b) => a.date_start.localeCompare(b.date_start));
    for (let i = 1; i < group.length; i++)
      if (group[i].date_start <= group[i - 1].date_end)
        errors.push(
          "Overlapping reporting intervals for the same entity and conditions",
        );
  }
  const spend = records.reduce((n, r) => n + r.spend, 0);
  const expectedRows = input.expected.rows ?? null;
  const expectedSpend = input.expected.spend ?? null;
  const rowsMatched =
    expectedRows === null ? null : expectedRows === records.length;
  const spendMatched =
    expectedSpend === null
      ? null
      : Math.abs(expectedSpend - spend) <= 0.005;
  const intervalChecked =
    input.expected.date_start !== undefined ||
    input.expected.date_end !== undefined;
  const intervalMatched = !intervalChecked
    ? null
    : !records.some(
        (r) =>
          (input.expected.date_start &&
            r.date_start !== input.expected.date_start) ||
          (input.expected.date_end && r.date_end !== input.expected.date_end),
      );
  const mismatches = [
    ...(rowsMatched === false ? ["rows"] : []),
    ...(spendMatched === false ? ["spend"] : []),
    ...(intervalMatched === false ? ["interval"] : []),
  ];
  const uncheckedInputs: ImportReconciliation["unchecked_inputs"] = [
    ...(expectedRows === null ? (["rows"] as const) : []),
    ...(expectedSpend === null ? (["spend"] as const) : []),
    ...(!intervalChecked ? (["interval"] as const) : []),
  ];
  const reconciled =
    rowsMatched === true &&
    spendMatched === true &&
    intervalMatched !== false;
  const reconciliation: ImportReconciliation = {
    scope: "import",
    status: mismatches.length
      ? "mismatch"
      : reconciled
        ? "verified_for_import"
        : "incomplete",
    verified: reconciled && mismatches.length === 0,
    rows: {
      expected: expectedRows,
      actual: records.length,
      delta: expectedRows === null ? null : records.length - expectedRows,
      matched: rowsMatched,
    },
    spend: {
      expected: expectedSpend,
      actual: spend,
      delta:
        expectedSpend === null
          ? null
          : Number((spend - expectedSpend).toFixed(6)),
      matched: spendMatched,
    },
    interval: {
      checked: intervalChecked,
      expected_start: input.expected.date_start ?? null,
      expected_end: input.expected.date_end ?? null,
      actual_start: records.length
        ? records.reduce(
            (min, r) => (r.date_start < min ? r.date_start : min),
            records[0].date_start,
          )
        : null,
      actual_end: records.length
        ? records.reduce(
            (max, r) => (r.date_end > max ? r.date_end : max),
            records[0].date_end,
          )
        : null,
      matched: intervalMatched,
    },
    unchecked_inputs: uncheckedInputs,
    mismatches,
    note: "Reconciliation verifies only this imported file's scope. Whole-account coverage remains unverified.",
  };
  if (
    expectedRows !== null &&
    rowsMatched === false
  )
    errors.push(`Expected ${expectedRows} rows, found ${records.length}`);
  if (
    expectedSpend !== null &&
    spendMatched === false
  )
    errors.push(`Spend differs: expected ${expectedSpend}, found ${spend}`);
  if (
    records.some(
      (r) =>
        (input.expected.date_start &&
          r.date_start !== input.expected.date_start) ||
        (input.expected.date_end && r.date_end !== input.expected.date_end),
    )
  )
    errors.push("Reporting interval differs from expected interval");
  const warnings = [
    "Coverage of the entire account is unverified; only this file is validated.",
    "Reach is non-additive. Results are comparable only with matching result type and attribution.",
  ];
  if (records.some((r) => r.date_start !== r.date_end))
    warnings.push("Period aggregates detected; these are not daily insights.");
  if (!reconciliation.verified)
    warnings.push(
      "Source reconciliation is incomplete: supply expected row count and spend.",
    );
  if (records.some((r) => r.results === undefined))
    warnings.push(
      "Results missing in some rows; missing values remain null, not zero.",
    );
  if (records.some((r) => r.level === "ad" && !r.creative))
    warnings.push("Creative details missing for some ads.");
  return {
    source: {
      filename: input.filename,
      number_format: input.number_format ?? "plain",
      headers: originalHeaders.map((header) => ({
        original: header,
        canonical:
          input.column_mapping?.[header] === "__raw__"
            ? `_raw_${header}`
            : (input.column_mapping?.[header] ?? canonicalHeader(header)),
      })),
    },
    valid: errors.length === 0,
    records,
    errors,
    warnings,
    summary: { rows: records.length, spend, levels: [...levels] },
    reconciliation,
    coverage: "unverified" as const,
    scope_coverage: reconciliation.verified
      ? ("verified_for_import" as const)
      : ("unverified" as const),
  };
}
export function recordKey(r: AdRecord) {
  return JSON.stringify([
    r.account_id,
    r.level,
    r.ad_id ?? r.ad_set_id ?? r.campaign_id,
    r.date_start,
    r.date_end,
    r.currency,
    r.timezone,
    r.attribution,
    r.result_type,
    Object.entries(r.breakdown ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
export function csvSafe(value: unknown) {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
