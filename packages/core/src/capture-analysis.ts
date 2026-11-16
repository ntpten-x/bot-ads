import { canonicalHeader } from "./metrics";
import {
  captureLevel,
  currencyFromSymbol,
  parseDateRangeLabel,
  parseDisplayNumber,
  type CaptureLevel,
  type CaptureRow,
  type DomSnapshot,
  type OperatorContext,
} from "./dom-capture";

/**
 * Deterministic performance analysis over Extension DOM captures.
 *
 * Captures are visible-only evidence and are usually not promotable (no IDs,
 * no spend column, unverified timezone). This module still lets the operator
 * read and compare what Meta showed, but it labels every limitation:
 * - unknown cells ("—", text, missing columns) stay null, never 0;
 * - spend comes from the spend column, otherwise it is an explicit estimate
 *   (results × cost per result) and is labelled as such;
 * - unresolved observations never become entity counts, totals or rankings;
 * - only compatible reporting scopes and verified IDs link column slices;
 * - uncertain identity, mapping or context blocks actionable comparisons.
 * Recommendations are suggestions for a human. Nothing here changes Meta.
 */

export type Delivery =
  | "payment_error"
  | "parent_off"
  | "off"
  | "limited"
  | "learning"
  | "in_review"
  | "rejected"
  | "not_delivering"
  | "completed"
  | "active"
  | "unknown";

const deliveryRules: [RegExp, Delivery][] = [
  [
    /ข้อผิดพลาดในการชำระเงิน|payment (?:issue|error|failed|method)/i,
    "payment_error",
  ],
  [/^(?:แคมเปญ|ชุดโฆษณา)ปิดอยู่$|^(?:campaign|ad set) (?:is )?off$/i, "parent_off"],
  [/^(?:ปิด|ปิดอยู่|off|inactive)$/i, "off"],
  [/จำกัดการเรียนรู้|learning limited/i, "limited"],
  [/กำลังเรียนรู้|^learning$/i, "learning"],
  [/ระหว่างการตรวจสอบ|อยู่ระหว่างตรวจสอบ|in review/i, "in_review"],
  [/ถูกปฏิเสธ|rejected|disapproved/i, "rejected"],
  [/ไม่ได้นำส่ง|ไม่มีการนำส่ง|not delivering/i, "not_delivering"],
  [/เสร็จสมบูรณ์|^completed$/i, "completed"],
  [/ใช้งานอยู่|^active$/i, "active"],
];
export function parseDelivery(text: string | null | undefined): Delivery {
  const first = (text ?? "").split("\n")[0].trim();
  if (!first || first === "—") return "unknown";
  return deliveryRules.find(([re]) => re.test(first))?.[1] ?? "unknown";
}

const footerLine =
  /^(?:ผลลัพธ์จาก\s*(?:โฆษณา|แคมเปญ|ชุดโฆษณา)?\s*([\d,]+)|results from\s+([\d,]+))/i;
const hoverLine =
  /^(แก้ไข|สร้างซ้ำ|แผนภูมิ|ดูแผนภูมิ|วิเคราะห์|เปรียบเทียบ|edit|duplicate|charts?|view charts|analy[sz]e|compare)$/i;
const unpublishedLine = /^(การแก้ไขที่ไม่ได้เผยแพร่|unpublished edits?)$/i;
const nameHeaders: Record<CaptureLevel, RegExp> = {
  campaigns: /^(campaign|campaign name|แคมเปญ|ชื่อแคมเปญ)$/i,
  adsets: /^(ad set|ad set name|ชุดโฆษณา|ชื่อชุดโฆษณา)$/i,
  ads: /^(ad|ad name|โฆษณา|ชื่อโฆษณา)$/i,
};
const idKeys: Record<CaptureLevel, string> = {
  campaigns: "campaign_id",
  adsets: "ad_set_id",
  ads: "ad_id",
};
/** Columns that are labels, controls or explicitly handled; not "other" metrics. */
const handled = new Set([
  "status",
  "results",
  "cost_per_result",
  "impressions",
  "spend",
  "budget",
  "result_type",
  "attribution",
  "campaign_id",
  "ad_set_id",
  "ad_id",
  "campaign_name",
  "ad_set_name",
  "ad_name",
]);

export type Budget = {
  amount: number | null;
  period: "daily" | "lifetime" | null;
  uses: "campaign_budget" | "ad_set_budget" | null;
  text: string | null;
};
export type Mapping = "verified" | "aligned_geometry" | "unverified";
export type AnalyzedRow = {
  key: string;
  name: string | null;
  entity_id: string | null;
  delivery: Delivery;
  delivery_text: string | null;
  results: number | null;
  result_type: string | null;
  cost_per_result: number | null;
  impressions: number | null;
  spend: number | null;
  spend_source: "column" | "estimate_results_x_cost_per_result" | null;
  cpm: number | null;
  budget: Budget;
  other: Record<string, number>;
  unpublished_edits: boolean;
  mapping: Mapping;
  occurrences: number;
  flags: string[];
  provenance: {
    captured_at: string;
    reader_version: string | null;
    columns: string[];
  }[];
};
export type SpendQuality = "reported" | "estimated" | "mixed" | "missing";
export type Recommendation = {
  severity: "critical" | "warning" | "opportunity" | "info";
  code: string;
  message: string;
  rows: string[];
};
export type RankedRow = Pick<
  AnalyzedRow,
  | "name"
  | "entity_id"
  | "delivery"
  | "results"
  | "cost_per_result"
  | "spend"
  | "spend_source"
>;
export type LevelAnalysis = {
  scope_key: string;
  level: CaptureLevel;
  snapshots: number;
  observed_rows: number;
  unique_rows: number;
  verified_unique_rows: number;
  unresolved_observations: number;
  spend_quality: SpendQuality;
  blockers: string[];
  dedupe: "id" | "content_within_job" | "mixed" | "none";
  reported_total_rows: number | null;
  coverage: "complete" | "partial" | "unknown";
  context: {
    account_id: string | null;
    breakdown: unknown;
    filters: unknown;
    date_range_label: string | null;
    date_start: string | null;
    date_end: string | null;
    currency: string | null;
    timezone: string | null;
    attribution: string | null;
    column_preset_label: string | null;
  };
  columns: string[];
  missing_columns: string[];
  rows: AnalyzedRow[];
  result_groups: {
    result_type: string;
    rows: number;
    results: number;
    spend: number | null;
    spend_basis: "column" | "estimate" | "mixed" | null;
    cost_per_result: number | null;
    impressions: number | null;
  }[];
  ranking: {
    basis: "cost_per_result";
    result_type: string | null;
    min_results: number;
    median_cost_per_result: number | null;
    eligible: number;
    best: RankedRow[];
    worst: RankedRow[];
  };
  /** Counts confirmed entities only; unresolved evidence is separate below. */
  delivery_counts: Partial<Record<Delivery, number>>;
  delivery_observation_counts: Partial<Record<Delivery, number>>;
  recommendations: Recommendation[];
  warnings: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const lines = (t: string) =>
  t
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

function parseBudget(text: string | undefined): Budget {
  if (!text) return { amount: null, period: null, uses: null, text: null };
  const ls = lines(text);
  const joined = ls.join(" ");
  const n = parseDisplayNumber(ls[0] ?? "");
  return {
    amount: n?.value ?? null,
    period: /ต่อวัน|daily|per day/i.test(joined)
      ? "daily"
      : /ตลอดอายุ|lifetime/i.test(joined)
        ? "lifetime"
        : null,
    uses: /งบประมาณแคมเปญ|campaign budget/i.test(joined)
      ? "campaign_budget"
      : /งบประมาณชุดโฆษณา|ad set budget/i.test(joined)
        ? "ad_set_budget"
        : null,
    text: joined || null,
  };
}

/** Parse one observed row. Returns the footer row count when old captures merged it into a cell. */
export function analyzeRow(
  level: CaptureLevel,
  snapshot: DomSnapshot,
  row: CaptureRow,
) {
  let footerTotal: number | null = null;
  let unpublished = false;
  let name: string | null = null;
  let deliveryText: string | null = null;
  let results: number | null = null;
  let resultType: string | null = null;
  let cpr: number | null = null;
  let impressions: number | null = null;
  let spend: number | null = null;
  let budgetText: string | undefined;
  let idFromColumn: string | null = null;
  const other: Record<string, number> = {};
  const seen = new Set<string>();
  const flags: string[] = [];
  const cleaned: { header: string; text: string }[] = [];
  for (const cell of row.cells) {
    const kept: string[] = [];
    for (const [i, l] of lines(cell.text).entries()) {
      const f = footerLine.exec(l);
      if (f) {
        footerTotal = Number((f[1] ?? f[2]).replaceAll(",", ""));
        continue;
      }
      if (unpublishedLine.test(l)) {
        unpublished = true;
        continue;
      }
      if (
        i > 0 &&
        nameHeaders[level].test(cell.header.trim()) &&
        hoverLine.test(l)
      )
        continue;
      kept.push(l);
    }
    cleaned.push({ header: cell.header, text: kept.join("\n") });
  }
  for (const cell of cleaned) {
    if (nameHeaders[level].test(cell.header.trim())) {
      name = lines(cell.text)[0] ?? null;
      continue;
    }
    const key = canonicalHeader(cell.header);
    if (seen.has(key)) {
      flags.push(`ambiguous_column:${key}`);
      continue;
    }
    seen.add(key);
    const first = lines(cell.text)[0] ?? "";
    const num = parseDisplayNumber(cell.text);
    switch (key) {
      case "status":
        deliveryText = first || null;
        break;
      case "results":
        results = num?.value ?? null;
        resultType =
          lines(cell.text)
            .slice(1)
            .find((s) => !/^[\d.,%฿$€£]+$/.test(s)) ?? null;
        break;
      case "cost_per_result":
        cpr = num?.value ?? null;
        break;
      case "impressions":
        impressions = num && Number.isInteger(num.value) ? num.value : null;
        break;
      case "spend":
        spend = num?.value ?? null;
        break;
      case "budget":
        budgetText = cell.text;
        break;
      case idKeys[level]:
        if (/^\d+$/.test(first)) idFromColumn = first;
        break;
      default:
        if (!handled.has(key) && num) other[key] = num.value;
    }
  }
  const idMappingVerified =
    row.column_mapping === "semantic" ||
    row.column_mapping === "verified_geometry";
  const entity_id =
    row.identity_source === "row_link_href" &&
    row.identity &&
    /^\d+$/.test(row.identity)
      ? row.identity
      : row.identity_source === "id_column" &&
          idMappingVerified &&
          snapshot.column_alignment !== "mismatch"
        ? idFromColumn && (!row.identity || row.identity === idFromColumn)
          ? idFromColumn
          : null
        : null;
  const verticalReason =
    snapshot.row_alignment === "mismatch"
      ? "identity_metric_vertical_mismatch"
      : snapshot.row_alignment === "unverified"
        ? "row_alignment_unverified"
        : null;
  if (verticalReason) flags.push(verticalReason);
  const mapping: Mapping =
    snapshot.column_alignment === "mismatch" || verticalReason !== null
      ? "unverified"
      : row.column_mapping === "semantic" ||
          row.column_mapping === "verified_geometry"
        ? "verified"
        : snapshot.column_alignment === "aligned"
          ? "aligned_geometry"
          : "unverified";
  const spendSource =
    spend !== null
      ? "column"
      : results !== null && cpr !== null
        ? "estimate_results_x_cost_per_result"
        : null;
  const spendValue =
    spend ?? (results !== null && cpr !== null ? round2(results * cpr) : null);
  if (
    row.identity_source === "id_column" &&
    row.column_mapping !== "semantic" &&
    row.column_mapping !== "verified_geometry"
  )
    flags.push("id_column_mapping_unverified");
  if (entity_id && idFromColumn && entity_id !== idFromColumn)
    flags.push("conflicting_identity");
  for (const cell of cleaned) {
    const key = canonicalHeader(cell.header);
    if (key === "attribution" && knownText(cell.text))
      flags.push(`attribution:${cell.text.trim()}`);
    if (key === "result_type" && knownText(cell.text))
      resultType = cell.text.trim();
    if (key === "spend" || key === "cost_per_result") {
      const n = parseDisplayNumber(cell.text);
      const currency = currencyFromSymbol(n?.symbol ?? null);
      if (
        currency &&
        knownText(snapshot.reporting_context?.currency) &&
        currency !== snapshot.reporting_context?.currency
      )
        flags.push("currency_conflict");
    }
  }
  const analyzed: Omit<AnalyzedRow, "key" | "occurrences" | "provenance"> = {
    name: name ?? row.name ?? null,
    entity_id,
    delivery: parseDelivery(deliveryText),
    delivery_text: deliveryText,
    results,
    result_type: resultType,
    cost_per_result: cpr,
    impressions,
    spend: spendValue,
    spend_source: spendSource,
    cpm:
      spendValue !== null && impressions
        ? round2((spendValue / impressions) * 1000)
        : null,
    budget: parseBudget(budgetText),
    other,
    unpublished_edits: unpublished,
    mapping,
    flags,
  };
  if (verticalReason) invalidateVerticalMetrics(analyzed);
  const key = entity_id
    ? `id:${entity_id}`
    : `content:${JSON.stringify(cleaned.map((c) => [c.header.trim(), c.text]).sort())}`;
  return { row: analyzed, key, footerTotal };
}

/** Preserve the raw snapshot elsewhere; these values cannot be assigned to this ID. */
function invalidateVerticalMetrics(
  row: Omit<AnalyzedRow, "key" | "occurrences" | "provenance">,
) {
  row.mapping = "unverified";
  row.results =
    row.cost_per_result =
    row.impressions =
    row.spend =
    row.cpm =
      null;
  row.result_type = row.spend_source = null;
  row.other = {};
  row.budget = { amount: null, period: null, uses: null, text: null };
  row.delivery = "unknown";
  row.delivery_text = null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : round2((v[m - 1] + v[m]) / 2);
}
const baht = (n: number | null, currency: string | null) =>
  n === null
    ? "—"
    : `${currency === "THB" || !currency ? "฿" : currency + " "}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const label = (r: AnalyzedRow) => r.name ?? r.entity_id ?? "(ไม่มีชื่อ)";
const ranked = (r: AnalyzedRow): RankedRow => ({
  name: r.name,
  entity_id: r.entity_id,
  delivery: r.delivery,
  results: r.results,
  cost_per_result: r.cost_per_result,
  spend: r.spend,
  spend_source: r.spend_source,
});
const levelThai: Record<CaptureLevel, string> = {
  campaigns: "แคมเปญ",
  adsets: "ชุดโฆษณา",
  ads: "โฆษณา",
};

type AnalysisOptions = {
  min_results?: number;
  high_cost_ratio?: number;
  operator?: OperatorContext;
};
const knownText = (v: unknown): v is string =>
  typeof v === "string" &&
  !!v.trim() &&
  !/^(?:unknown|unverified|unspecified|n\/a|not set|ไม่ทราบ|ยังไม่ยืนยัน|[-—–]+)$/i.test(
    v.trim(),
  );
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  return value;
}
function explicitScopeValue(value: unknown, arrays = false): unknown {
  if (!value || typeof value !== "object" || (!arrays && Array.isArray(value)))
    return null;
  return stableValue(value);
}
function contextFor(snapshot: DomSnapshot, options: AnalysisOptions = {}) {
  const ctx = snapshot.reporting_context ?? {};
  const range = parseDateRangeLabel(ctx.date_range_label);
  const timezone = knownText(ctx.timezone)
    ? ctx.timezone
    : knownText(options.operator?.timezone)
      ? options.operator.timezone
      : null;
  let validTimezone = timezone;
  try {
    if (timezone) new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    validTimezone = null;
  }
  return {
    account_id: snapshot.account_id,
    date_range_label: ctx.date_range_label ?? null,
    date_start: range?.date_start ?? null,
    date_end: range?.date_end ?? null,
    currency:
      knownText(ctx.currency) && /^[A-Z]{3}$/.test(ctx.currency)
        ? ctx.currency
        : null,
    timezone: validTimezone,
    attribution: knownText(ctx.attribution)
      ? ctx.attribution.trim()
      : knownText(options.operator?.attribution)
        ? options.operator.attribution.trim()
        : null,
    breakdown:
      explicitScopeValue(ctx.breakdown ?? snapshot.breakdown) ??
      (options.operator?.confirm_no_breakdown === true ? {} : null),
    filters:
      explicitScopeValue(ctx.filters ?? snapshot.filters, true) ??
      (options.operator?.confirm_no_filters === true ? [] : null),
    column_preset_label: ctx.column_preset_label ?? null,
  };
}
function scopeKey(
  level: CaptureLevel,
  snapshot: DomSnapshot,
  options: AnalysisOptions = {},
) {
  const c = contextFor(snapshot, options);
  return JSON.stringify([
    level,
    c.account_id,
    c.date_start,
    c.date_end,
    c.currency ?? snapshot.reporting_context?.currency ?? null,
    c.timezone ?? snapshot.reporting_context?.timezone ?? null,
    c.attribution ?? snapshot.reporting_context?.attribution ?? null,
    c.breakdown,
    // An unparseable label must never make two different raw date selections compatible.
    c.date_start ? null : c.date_range_label,
    c.filters,
    stableValue(snapshot.reporting_context?.observed_breakdown ?? null),
  ]);
}
/** Row-visible attribution and dimensions take precedence over generic page labels. */
function scopedSnapshots(snapshots: DomSnapshot[]) {
  const dimensionNames: [RegExp, string][] = [
    [/^(?:age|อายุ)$/i, "age"],
    [/^(?:gender|เพศ)$/i, "gender"],
    [/^(?:country|ประเทศ)$/i, "country"],
    [/^(?:region|ภูมิภาค)$/i, "region"],
    [/^(?:placement|ตำแหน่งการจัดวาง)$/i, "placement"],
    [/^(?:platform|แพลตฟอร์ม)$/i, "platform"],
    [/^(?:publisher platform|แพลตฟอร์มผู้เผยแพร่)$/i, "publisher_platform"],
    [/^(?:device platform|แพลตฟอร์มอุปกรณ์)$/i, "device_platform"],
  ];
  const attributionById = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const row of snapshot.row_observations) {
      if (!row.identity) continue;
      const values = row.cells
        .filter(
          (cell) =>
            canonicalHeader(cell.header) === "attribution" &&
            knownText(cell.text),
        )
        .map((cell) => cell.text.trim());
      if (values.length !== 1) continue;
      const known = attributionById.get(row.identity) ?? new Set<string>();
      known.add(values[0]);
      attributionById.set(row.identity, known);
    }
  }
  return snapshots.flatMap((snapshot) => {
    const groups = new Map<
      string,
      {
        rows: CaptureRow[];
        context: NonNullable<DomSnapshot["reporting_context"]>;
      }
    >();
    if (!snapshot.row_observations.length) return [snapshot];
    for (const row of snapshot.row_observations) {
      const attributes = row.cells
        .filter(
          (c) =>
            canonicalHeader(c.header) === "attribution" && knownText(c.text),
        )
        .map((c) => c.text.trim());
      const knownById = row.identity
        ? attributionById.get(row.identity)
        : undefined;
      const attribution =
        new Set(attributes).size === 1
          ? attributes[0]
          : knownById?.size === 1
            ? [...knownById][0]
            : (snapshot.reporting_context?.attribution ?? "unverified");
      const dimensions: Record<string, string> = {};
      for (const cell of row.cells) {
        const field = dimensionNames.find(([pattern]) =>
          pattern.test(cell.header.trim()),
        )?.[1];
        if (field && knownText(cell.text)) dimensions[field] = cell.text.trim();
      }
      const base = explicitScopeValue(
        snapshot.reporting_context?.breakdown ?? snapshot.breakdown,
      );
      const breakdown =
        Object.keys(dimensions).length > 0
          ? {
              ...((base as Record<string, unknown> | null) ?? {}),
              ...dimensions,
            }
          : base;
      const context = {
        ...snapshot.reporting_context,
        attribution,
        breakdown,
        observed_breakdown: dimensions,
      };
      const key = JSON.stringify([
        attribution,
        stableValue(breakdown),
        stableValue(dimensions),
      ]);
      const prior = groups.get(key);
      if (prior) prior.rows.push(row);
      else groups.set(key, { rows: [row], context });
    }
    return [...groups.values()].map((g) => ({
      ...snapshot,
      reporting_context: g.context,
      row_observations: g.rows,
    }));
  });
}
function spendQuality(rows: AnalyzedRow[]): SpendQuality {
  if (!rows.length || rows.every((r) => r.spend_source === null))
    return "missing";
  const sources = new Set(rows.map((r) => r.spend_source));
  if (sources.size > 1) return "mixed";
  return sources.has("column") ? "reported" : "estimated";
}
const blockingRow = (r: AnalyzedRow) =>
  r.flags.some((f) =>
    /^(?:conflicting_|duplicate_id_in_snapshot|ambiguous_column:|currency_conflict|id_column_mapping_unverified)/.test(
      f,
    ),
  );

export function analyzeCaptureLevel(
  level: CaptureLevel,
  snapshots: DomSnapshot[],
  options: AnalysisOptions = {},
): LevelAnalysis {
  const minResults = options.min_results ?? 5;
  const highRatio = options.high_cost_ratio ?? 1.3;
  const ordered = scopedSnapshots(
    snapshots.filter((s) => captureLevel(s.page) === level),
  ).sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const scopes = new Set(ordered.map((s) => scopeKey(level, s, options)));
  const mixedScope = scopes.size > 1;
  const scope_key = mixedScope
    ? JSON.stringify([...scopes].sort())
    : ([...scopes][0] ?? JSON.stringify([level, "empty"]));
  const byKey = new Map<string, AnalyzedRow>();
  const merged = new Map<string, { capture: CaptureRow; at: string }>();
  const totals = new Set<number>();
  const columns = new Set<string>();
  const blockers = new Set<string>();
  let observed = 0;
  let usedId = false;
  let usedContent = false;
  for (const s of ordered) {
    if (typeof s.reported_total_rows === "number")
      totals.add(s.reported_total_rows);
    const idCounts = new Map<string, number>();
    for (const row of s.row_observations) {
      if (row.identity)
        idCounts.set(row.identity, (idCounts.get(row.identity) ?? 0) + 1);
    }
    for (const row of s.row_observations) {
      observed++;
      for (const c of row.cells) columns.add(canonicalHeader(c.header));
      let { row: a, key: rawKey, footerTotal } = analyzeRow(level, s, row);
      if (footerTotal !== null) totals.add(footerTotal);
      const duplicate = !!row.identity && (idCounts.get(row.identity) ?? 0) > 1;
      if (duplicate) {
        a.flags.push("duplicate_id_in_snapshot");
        blockers.add("duplicate_id_in_snapshot");
      }
      if (rawKey.startsWith("id:")) usedId = true;
      else usedContent = true;
      const key = `${scopeKey(level, s, options)}:${rawKey}`;
      const provenance = {
        captured_at: s.captured_at,
        reader_version: s.reader_version ?? null,
        columns: row.cells.map((c) => c.header),
      };
      const prior = byKey.get(key);
      const priorCapture = merged.get(key);
      if (prior && a.entity_id && priorCapture) {
        // Merge by verified ID within one compatible scope only. Never infer row identity from position/name.
        const cells = new Map(
          priorCapture.capture.cells.map((c) => [canonicalHeader(c.header), c]),
        );
        const flags = [...prior.flags, ...a.flags];
        if (
          prior.result_type &&
          a.result_type &&
          prior.result_type !== a.result_type
        )
          flags.push("conflicting_result_type");
        for (const c of row.cells) {
          const field = canonicalHeader(c.header);
          const old = cells.get(field);
          if (old && old.text.trim() !== c.text.trim()) {
            if (priorCapture.at === s.captured_at)
              flags.push("conflicting_values");
            else flags.push(`updated_column:${field}`);
          }
          cells.set(field, c);
        }
        const capture: CaptureRow = {
          ...priorCapture.capture,
          ...row,
          cells: [...cells.values()],
        };
        a = analyzeRow(level, s, capture).row;
        a.flags = [...new Set([...flags, ...a.flags])];
        if (
          a.flags.some(
            (flag) =>
              flag === "identity_metric_vertical_mismatch" ||
              flag === "row_alignment_unverified",
          )
        )
          invalidateVerticalMetrics(a);
        // Unverified slices cannot acquire a verified mapping by merging with a different slice.
        if (prior.mapping !== "verified" || a.mapping !== "verified")
          a.mapping = "unverified";
        byKey.set(key, {
          ...a,
          key,
          occurrences: prior.occurrences + 1,
          provenance: [...prior.provenance, provenance],
        });
        merged.set(key, { capture, at: s.captured_at });
      } else if (prior) {
        prior.occurrences++;
        prior.provenance.push(provenance);
      } else {
        byKey.set(key, { ...a, key, occurrences: 1, provenance: [provenance] });
        if (a.entity_id) merged.set(key, { capture: row, at: s.captured_at });
      }
    }
  }
  const rows = [...byKey.values()];
  const verifiedRows = rows.filter(
    (r) => r.entity_id !== null && r.mapping === "verified" && !blockingRow(r),
  );
  const unresolved = rows
    .filter((r) => !r.entity_id)
    .reduce((n, r) => n + r.occurrences, 0);
  const context =
    !mixedScope && ordered.length
      ? contextFor(ordered.at(-1)!, options)
      : {
          account_id: null,
          date_range_label: null,
          date_start: null,
          date_end: null,
          currency: null,
          timezone: null,
          attribution: null,
          breakdown: null,
          filters: null,
          column_preset_label: null,
        };
  const { currency, timezone, attribution } = context;
  if (mixedScope) blockers.add("mixed_reporting_context");
  if (!context.account_id) blockers.add("account_unverified");
  if (!context.date_start || !context.date_end)
    blockers.add("date_range_unverified");
  if (!currency) blockers.add("currency_unverified");
  if (!timezone) blockers.add("timezone_unverified");
  if (!attribution) blockers.add("attribution_unverified");
  if (context.breakdown === null) blockers.add("breakdown_unverified");
  if (context.filters === null) blockers.add("filters_unverified");
  if (unresolved) blockers.add("stable_id_unverified");
  if (rows.some((r) => r.mapping !== "verified"))
    blockers.add("column_mapping_unverified");
  for (const reason of [
    "identity_metric_vertical_mismatch",
    "row_alignment_unverified",
  ])
    if (rows.some((r) => r.flags.includes(reason))) blockers.add(reason);
  if (rows.some(blockingRow)) blockers.add("conflicting_row_evidence");
  const reported = totals.size === 1 && !mixedScope ? [...totals][0] : null;
  if (totals.size > 1) blockers.add("reported_count_conflict");
  if (reported !== null && verifiedRows.length > reported)
    blockers.add("reported_count_mismatch");
  const warnings: string[] = [];
  if (totals.size > 1)
    warnings.push(
      `ตัวเลขจำนวนแถวรวมของ Meta ไม่ตรงกันระหว่างภาพ: ${[...totals].join(", ")}`,
    );
  if (usedContent)
    warnings.push(
      "แถวที่ไม่มี ID เป็นหลักฐานแยก ไม่ใช่จำนวนเอนทิตีที่ยืนยันแล้ว และไม่นำมารวมยอดหรือจัดอันดับ",
    );
  if (mixedScope)
    warnings.push(
      "ข้อมูลต่างบัญชี ช่วงวัน สกุลเงิน Attribution หรือ Breakdown ถูกระงับการรวมยอดและอันดับ",
    );
  const excluded = rows.filter((r) => r.mapping !== "verified").length;
  if (excluded)
    warnings.push(`${excluded} แถวจับคู่คอลัมน์ยังไม่ยืนยัน ไม่นำมารวมยอดหรือจัดอันดับ`);
  const contextReady =
    !mixedScope &&
    !!context.account_id &&
    !!context.date_start &&
    !!context.date_end &&
    !!currency &&
    !!timezone &&
    !!attribution &&
    context.breakdown !== null &&
    context.filters !== null;
  const coverage: LevelAnalysis["coverage"] =
    reported === null
      ? "unknown"
      : !blockers.size && verifiedRows.length === reported && reported > 0
        ? "complete"
        : "partial";
  // Excluding unresolved rows is conservative: aggregates below explicitly cover only verified compatible rows.
  const comparable = contextReady ? verifiedRows : [];
  const groups = new Map<string, AnalyzedRow[]>();
  for (const r of comparable)
    if (r.results !== null && r.result_type)
      groups.set(r.result_type, [...(groups.get(r.result_type) ?? []), r]);
  const result_groups = [...groups].map(([result_type, rs]) => {
    const results = rs.reduce((a, r) => a + r.results!, 0);
    const spend = rs.every((r) => r.spend !== null)
      ? round2(rs.reduce((a, r) => a + r.spend!, 0))
      : null;
    const sources = new Set(rs.map((r) => r.spend_source));
    return {
      result_type,
      rows: rs.length,
      results,
      spend,
      spend_basis:
        spend === null
          ? null
          : sources.size > 1
            ? ("mixed" as const)
            : sources.has("column")
              ? ("column" as const)
              : ("estimate" as const),
      cost_per_result:
        spend !== null && results > 0 ? round2(spend / results) : null,
      impressions: rs.every((r) => r.impressions !== null)
        ? rs.reduce((a, r) => a + r.impressions!, 0)
        : null,
    };
  });
  result_groups.sort((a, b) => b.rows - a.rows);
  const main = result_groups[0]?.result_type ?? null;
  const eligible = comparable.filter(
    (r) =>
      r.result_type === main &&
      r.results !== null &&
      r.results >= minResults &&
      r.cost_per_result !== null &&
      r.spend_source === "column",
  );
  const med = median(eligible.map((r) => r.cost_per_result!));
  const byCost = [...eligible].sort(
    (a, b) => a.cost_per_result! - b.cost_per_result!,
  );
  const n = Math.min(3, Math.floor(byCost.length / 2));
  const best = byCost.slice(0, Math.max(n, byCost.length ? 1 : 0));
  const worst =
    byCost.length > 1 ? byCost.slice(-Math.max(n, 1)).reverse() : [];

  const recs: Recommendation[] = [];
  const name = levelThai[level];
  const payment = rows.filter((r) => r.delivery === "payment_error");
  if (payment.length)
    recs.push({
      severity: "critical",
      code: "payment_error",
      message: `พบข้อความ "ข้อผิดพลาดในการชำระเงิน" ในหลักฐานที่อ่านได้ของ${name} ตรวจวิธีการชำระเงินในหน้าการเรียกเก็บเงินของ Meta จำนวนหลักฐานอาจซ้ำและไม่ใช่จำนวนเอนทิตีที่ยืนยันแล้ว`,
      rows: [...new Set(payment.map(label))],
    });
  // Comparisons against the median need at least three comparable rows.
  if (med !== null && eligible.length >= 3) {
    const pausedWinners = eligible.filter(
      (r) =>
        (r.delivery === "off" || r.delivery === "parent_off") &&
        r.cost_per_result! <= med,
    );
    if (pausedWinners.length)
      recs.push({
        severity: "opportunity",
        code: "paused_low_cost",
        message: `${name}ที่ปิดอยู่แต่ต้นทุนต่อผลลัพธ์ไม่เกินค่ากลาง (${baht(med, currency)}) พิจารณาเปิดใช้อีกครั้งหรือนำกลุ่มเป้าหมาย/ครีเอทีฟไปใช้ในตัวที่เปิดอยู่ (ผู้ใช้ตัดสินใจเอง บอทไม่เปลี่ยนสถานะ)`,
        rows: pausedWinners.map(
          (r) => `${label(r)} (${baht(r.cost_per_result, currency)})`,
        ),
      });
    const expensive = eligible.filter(
      (r) =>
        r.delivery !== "off" &&
        r.delivery !== "parent_off" &&
        r.cost_per_result! >= med * highRatio,
    );
    if (expensive.length)
      recs.push({
        severity: "warning",
        code: "high_cost_per_result",
        message: `ต้นทุนต่อผลลัพธ์สูงกว่าค่ากลาง ${Math.round((highRatio - 1) * 100)}% ขึ้นไป ทบทวนกลุ่มเป้าหมาย ครีเอทีฟ หรือย้ายงบไปยังรายการที่ต้นทุนต่ำกว่า`,
        rows: expensive.map(
          (r) => `${label(r)} (${baht(r.cost_per_result, currency)})`,
        ),
      });
  }
  const noResults = comparable.filter(
    (r) => r.results === null && (r.impressions ?? 0) >= 1000,
  );
  if (noResults.length)
    recs.push({
      severity: "warning",
      code: "impressions_without_results",
      message:
        "มีอิมเพรสชันตั้งแต่ 1,000 ขึ้นไปแต่ Meta ไม่แสดงผลลัพธ์ ตรวจข้อความโฆษณา ปลายทาง หรือเป้าหมายการปรับให้เหมาะสม",
      rows: noResults.map(
        (r) =>
          `${label(r)} (${r.impressions!.toLocaleString("en-US")} อิมเพรสชัน)`,
      ),
    });
  const low = comparable.filter(
    (r) => r.results !== null && r.results < minResults,
  );
  if (low.length)
    recs.push({
      severity: "info",
      code: "low_volume",
      message: `ผลลัพธ์น้อยกว่า ${minResults} ยังสรุปว่าดีหรือแย่ไม่ได้ จึงไม่นำมาจัดอันดับ`,
      rows: low.map(label),
    });
  const unpublished = rows.filter((r) => r.unpublished_edits);
  if (unpublished.length)
    recs.push({
      severity: "info",
      code: "unpublished_edits",
      message: "มีการแก้ไขที่ยังไม่ได้เผยแพร่ ตัวเลขที่เห็นยังเป็นของเวอร์ชันที่เผยแพร่อยู่",
      rows: unpublished.map(label),
    });
  if (coverage === "partial")
    recs.push({
      severity: "warning",
      code: "partial_coverage",
      message: `ยืนยัน ID และคอลัมน์ได้ ${verifiedRows.length} จาก ${reported} แถวที่ Meta แจ้ง ผลรวมและอันดับเป็นเฉพาะแถวที่ยืนยันได้`,
      rows: [],
    });
  const missing: string[] = [];
  if (!rows.length || rows.some((r) => r.spend_source !== "column"))
    missing.push("spend");
  if (!columns.has("impressions")) missing.push("impressions");
  if (!columns.has("results")) missing.push("results");
  if (!rows.length || rows.some((r) => !r.entity_id))
    missing.push(idKeys[level]);
  if (missing.includes("spend"))
    recs.push({
      severity: "info",
      code: "add_spend_column",
      message:
        "ยังไม่มีจำนวนเงินที่ใช้จ่ายจริงครบทุกแถว บางค่าอาจประมาณจากผลลัพธ์ × ต้นทุนต่อผลลัพธ์ ตรวจคอลัมน์ยอดใช้จ่ายหรือเทียบ CSV ก่อนตัดสินใจ",
      rows: [],
    });
  if (missing.includes(idKeys[level]))
    recs.push({
      severity: "info",
      code: "add_id_column",
      message: `ไม่พบ ID ของ${name}ในหน้า เพิ่มคอลัมน์ "ID ${name}" ใน Meta เพื่อให้ระบบยืนยันตัวตนและบันทึกเป็นข้อมูลถาวรได้`,
      rows: [],
    });
  const delivery_counts: Partial<Record<Delivery, number>> = {};
  for (const r of verifiedRows)
    delivery_counts[r.delivery] = (delivery_counts[r.delivery] ?? 0) + 1;
  const delivery_observation_counts: Partial<Record<Delivery, number>> = {};
  for (const r of rows)
    delivery_observation_counts[r.delivery] =
      (delivery_observation_counts[r.delivery] ?? 0) + r.occurrences;
  return {
    scope_key,
    level,
    snapshots: snapshots.length,
    observed_rows: observed,
    unique_rows: verifiedRows.length,
    verified_unique_rows: verifiedRows.length,
    unresolved_observations: unresolved,
    spend_quality: spendQuality(rows),
    blockers: [...blockers],
    dedupe: !rows.length
      ? "none"
      : usedId && usedContent
        ? "mixed"
        : usedId
          ? "id"
          : "content_within_job",
    reported_total_rows: reported,
    coverage,
    context,
    columns: [...columns],
    missing_columns: missing,
    rows,
    result_groups,
    ranking: {
      basis: "cost_per_result",
      result_type: main,
      min_results: minResults,
      median_cost_per_result: med,
      eligible: eligible.length,
      best: best.map(ranked),
      worst: worst.map(ranked),
    },
    delivery_counts,
    delivery_observation_counts,
    recommendations: recs,
    warnings,
  };
}

/** Analyze all snapshots of one Extension job, grouped by reporting level. */
export function analyzeCaptureJob(
  snapshots: DomSnapshot[],
  options?: Parameters<typeof analyzeCaptureLevel>[2],
) {
  const levels: LevelAnalysis[] = [];
  for (const level of ["campaigns", "adsets", "ads"] as const) {
    const groups = new Map<string, DomSnapshot[]>();
    for (const snapshot of scopedSnapshots(
      snapshots.filter((x) => captureLevel(x.page) === level),
    )) {
      const key = scopeKey(level, snapshot, options);
      groups.set(key, [...(groups.get(key) ?? []), snapshot]);
    }
    for (const group of groups.values())
      levels.push(analyzeCaptureLevel(level, group, options));
  }
  const critical = levels.flatMap((l) =>
    l.recommendations.filter((r) => r.severity === "critical"),
  );
  return {
    levels,
    payment_error: critical.some((r) => r.code === "payment_error"),
    data_quality: {
      identity: !levels.some((l) => l.observed_rows > 0)
        ? "missing"
        : levels.every(
              (l) =>
                l.unresolved_observations === 0 &&
                l.rows.every((r) => !!r.entity_id && !blockingRow(r)),
            )
          ? "verified_ids"
          : "no_stable_ids",
      spend: spendQuality(levels.flatMap((l) => l.rows)),
      coverage: levels.map((l) => ({
        scope_key: l.scope_key,
        level: l.level,
        captured: l.unique_rows,
        reported: l.reported_total_rows,
        coverage: l.coverage,
      })),
    },
    notice:
      "วิเคราะห์จากข้อมูลที่มองเห็นบนหน้า Meta เท่านั้น ยังไม่ใช่ข้อมูลที่ยืนยันแล้ว ค่าที่ไม่ทราบไม่ถูกแทนด้วยศูนย์ และคำแนะนำไม่ถูกนำไปเปลี่ยนโฆษณาโดยอัตโนมัติ",
  };
}
export type CaptureJobAnalysis = ReturnType<typeof analyzeCaptureJob>;
