import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalHeader } from "./metrics";
import { recordSchema, recordKey, type AdRecord } from "./index";

/**
 * DOM capture contract and promotion rules.
 *
 * A capture from the Chrome Extension is raw evidence of what was visible on the
 * page. It is stored as-is. A row may be promoted to normalized entities and
 * insight observations only when every reporting condition is verified:
 * stable numeric ID from the DOM (never a name or position), parent IDs for
 * child levels, explicit date range, currency, timezone, attribution, result
 * type, verified column mapping and numeric spend/impressions. Unknown values
 * stay missing; nothing is turned into 0.
 */
export const captureLevels = ["campaigns", "adsets", "ads"] as const;
export type CaptureLevel = (typeof captureLevels)[number];
const recordLevel = {
  campaigns: "campaign",
  adsets: "adset",
  ads: "ad",
} as const;

const breakdownDimensionHeaders: [
  RegExp,
  keyof NonNullable<AdRecord["breakdown"]>,
][] = [
  [/^(?:age|อายุ)$/i, "age"],
  [/^(?:gender|เพศ)$/i, "gender"],
  [/^(?:country|ประเทศ)$/i, "country"],
  [/^(?:region|ภูมิภาค)$/i, "region"],
  [/^(?:placement|ตำแหน่งการจัดวาง)$/i, "placement"],
  [
    /^(?:platform|publisher platform|แพลตฟอร์ม|แพลตฟอร์มผู้เผยแพร่)$/i,
    "publisher_platform",
  ],
  [/^(?:platform position|ตำแหน่งบนแพลตฟอร์ม)$/i, "platform_position"],
  [/^(?:impression device|อุปกรณ์ที่แสดงผล)$/i, "impression_device"],
  [/^(?:device platform|แพลตฟอร์มอุปกรณ์)$/i, "device_platform"],
  [/^(?:device|อุปกรณ์)$/i, "device"],
];

/** Stable dedupe key for one entity + visible breakdown combination. */
function captureGrainKey(row: CaptureRow): string | null {
  if (!row.identity || !/^\d+$/.test(row.identity)) return null;
  const dimensions: [string, string][] = [];
  for (const cell of row.cells) {
    const dimension = breakdownDimensionHeaders.find(([pattern]) =>
      pattern.test(cell.header.trim()),
    )?.[1];
    if (dimension) dimensions.push([dimension, cell.text.trim()]);
  }
  dimensions.sort(
    ([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv),
  );
  return JSON.stringify([row.identity, dimensions]);
}

const rowSchema = z
  .object({
    identity: z.string().nullable(),
    identity_source: z.string().nullable().optional(),
    parent_ids: z
      .object({
        campaign_id: z.string().nullable().optional(),
        ad_set_id: z.string().nullable().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    name: z.string().nullable(),
    method: z.enum(["semantic", "geometry"]),
    column_mapping: z.string().optional(),
    cells: z.array(z.object({ header: z.string(), text: z.string() })),
    warnings: z.array(z.string()),
  })
  .passthrough();
export type CaptureRow = z.infer<typeof rowSchema>;

export const domSnapshotSchema = z
  .object({
    account_id: z.string().regex(/^\d+$/).nullable(),
    reader_version: z.string().max(40).optional(),
    page: z.string().max(300),
    captured_at: z.iso.datetime(),
    format: z.string().max(60).optional(),
    coverage: z.string().max(60).optional(),
    column_alignment: z.string().max(40).optional(),
    /** Frozen identity columns must remain aligned with independently scrolled metrics. */
    row_alignment: z.enum(["aligned", "mismatch", "unverified"]).optional(),
    warnings: z.array(z.string()).default([]),
    reporting_context: z
      .object({
        date_range_label: z.string().nullable().optional(),
        column_preset_label: z.string().nullable().optional(),
        attribution: z.string().optional(),
        timezone: z.string().optional(),
        currency: z.string().optional(),
        evidence: z.record(z.string(), z.string()).optional(),
      })
      .passthrough()
      .optional(),
    row_observations: z.array(rowSchema).default([]),
    /** Row count printed in Meta's summary row, when exactly one was visible. */
    reported_total_rows: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();
export type DomSnapshot = z.infer<typeof domSnapshotSchema>;

export function captureLevel(page: string): CaptureLevel | null {
  const m = /^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.exec(page);
  return m ? (m[1] as CaptureLevel) : null;
}

export function snapshotFingerprint(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

const thaiMonths: Record<string, number> = {
  "ม.ค.": 1,
  "ก.พ.": 2,
  "มี.ค.": 3,
  "เม.ย.": 4,
  "พ.ค.": 5,
  "มิ.ย.": 6,
  "ก.ค.": 7,
  "ส.ค.": 8,
  "ก.ย.": 9,
  "ต.ค.": 10,
  "พ.ย.": 11,
  "ธ.ค.": 12,
};
const englishMonths: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
function isoDate(y: number, m: number, d: number) {
  if (y > 2400) y -= 543; // Thai Buddhist era
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return date.toISOString().slice(0, 10);
}
function parseOneDate(text: string, fallbackYear?: number): string | null {
  const s = text.trim();
  let m = /^(\d{1,2})\s+([ก-๙.]+)\s*(\d{4})?$/.exec(s);
  if (m && thaiMonths[m[2]]) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    return y ? isoDate(y, thaiMonths[m[2]], Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,4})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})?$/.exec(s);
  if (m && englishMonths[m[1].toLowerCase()]) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    return y
      ? isoDate(y, englishMonths[m[1].toLowerCase()], Number(m[2]))
      : null;
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,4})[a-z]*\.?,?\s*(\d{4})?$/.exec(s);
  if (m && englishMonths[m[2].toLowerCase()]) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    return y
      ? isoDate(y, englishMonths[m[2].toLowerCase()], Number(m[1]))
      : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}
/**
 * Parse the explicit dates shown on the Ads Manager date button, e.g.
 * "30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026" or "Last 7 days: Nov 8 – 14, 2026".
 * Relative labels without explicit dates ("วันนี้") return null.
 */
export function parseDateRangeLabel(label: string | null | undefined) {
  if (!label) return null;
  const explicit = label.includes(":")
    ? label.slice(label.indexOf(":") + 1)
    : label;
  const parts = explicit.split(/\s+[–—-]\s+/);
  if (parts.length === 1) {
    const year = /(\d{4})\s*$/.exec(parts[0])?.[1];
    const single = parseOneDate(parts[0], year ? Number(year) : undefined);
    return single ? { date_start: single, date_end: single } : null;
  }
  if (parts.length !== 2) return null;
  const endYear = /(\d{4})\s*$/.exec(parts[1])?.[1];
  if (!endYear) return null;
  let end = parseOneDate(parts[1], Number(endYear));
  if (!end) {
    // "Nov 8 – 14, 2026": end has only day and year.
    const dayOnly = /^(\d{1,2}),?\s*(\d{4})$/.exec(parts[1].trim());
    const startMonth = /^([A-Za-z]{3,4})/
      .exec(parts[0].trim())?.[1]
      ?.toLowerCase();
    if (dayOnly && startMonth && englishMonths[startMonth])
      end = isoDate(
        Number(dayOnly[2]),
        englishMonths[startMonth],
        Number(dayOnly[1]),
      );
  }
  const start = parseOneDate(parts[0], Number(endYear));
  if (!start || !end || start > end) return null;
  return { date_start: start, date_end: end };
}

const currencySymbols: Record<string, string> = {
  "฿": "THB",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
  "₫": "VND",
  "₩": "KRW",
  "₱": "PHP",
};
/** Parse the first line of a visible cell. Returns null for "—", text or anything ambiguous. */
export function parseDisplayNumber(text: string) {
  const first = text.split("\n")[0].trim();
  const m =
    /^(฿|€|£|₹|₫|₩|₱|US\$|\$|[A-Z]{3}\s+)?\s*((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)\s*(%)?$/.exec(
      first,
    );
  if (!m) return null;
  const value = Number(m[2].replaceAll(",", ""));
  if (!Number.isFinite(value)) return null;
  return { value, symbol: m[1]?.trim() ?? null, percent: !!m[3] };
}
export function currencyFromSymbol(symbol: string | null) {
  if (!symbol) return null;
  if (/^[A-Z]{3}$/.test(symbol)) return symbol;
  return currencySymbols[symbol] ?? null;
}

const integerMetrics = new Set(["impressions", "reach", "link_clicks"]);
const recordNumbers = [
  "spend",
  "impressions",
  "reach",
  "results",
  "link_clicks",
  "purchase_value",
];
const extraMetrics = new Set([
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "cost_per_result",
  "messaging_conversations",
  "leads",
  "purchases",
  "roas",
  "link_ctr",
  "link_cpc",
  "landing_page_views",
  "adds_to_cart",
  "checkouts_initiated",
  "website_purchases",
  "website_purchase_value",
  "website_roas",
  "cost_per_purchase",
  "cost_per_lead",
  "cost_per_messaging_conversation",
  "budget",
]);
const nameHeaders: Record<CaptureLevel, RegExp> = {
  campaigns: /^(campaign|campaign name|แคมเปญ|ชื่อแคมเปญ)$/i,
  adsets: /^(ad set|ad set name|ชุดโฆษณา|ชื่อชุดโฆษณา)$/i,
  ads: /^(ad|ad name|โฆษณา|ชื่อโฆษณา)$/i,
};
const validTimezone = (tz: string) => {
  if (!/^[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(tz) && tz !== "UTC")
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const verified = (v: string | undefined | null) => !!v && v !== "unverified";

export const operatorContextSchema = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    attribution: z.string().min(1).max(200).optional(),
    result_type: z.string().min(1).max(200).optional(),
    confirm_no_breakdown: z.literal(true).optional(),
    confirm_no_filters: z.literal(true).optional(),
  })
  .strict();
export type OperatorContext = z.infer<typeof operatorContextSchema>;
export type RowEvaluation = {
  status: "ready" | "needs_review" | "rejected";
  reasons: string[];
  entity_id: string | null;
  record: AdRecord | null;
  /** Record awaiting a parent name lookup (adset/ad level). */
  pending_parent_name?: boolean;
};

/**
 * Decide whether one captured row may be normalized. Pure: the store supplies
 * parent names from rows that were already promoted.
 */
export function evaluateCaptureRow(
  snapshot: DomSnapshot,
  row: CaptureRow,
  options: {
    bound_account: string;
    duplicate_grains?: Set<string>;
    operator?: OperatorContext;
    campaign_names?: Map<string, string>;
  },
): RowEvaluation {
  const reasons: string[] = [];
  const level = captureLevel(snapshot.page);
  if (!level)
    return {
      status: "rejected",
      reasons: ["unsupported_page"],
      entity_id: null,
      record: null,
    };
  if (snapshot.account_id !== options.bound_account)
    return {
      status: "rejected",
      reasons: ["account_mismatch"],
      entity_id: null,
      record: null,
    };
  const id = row.identity && /^\d+$/.test(row.identity) ? row.identity : null;
  const grainKey = captureGrainKey(row);
  if (!id) reasons.push("stable_id_unverified");
  else if (grainKey && options.duplicate_grains?.has(grainKey))
    reasons.push("duplicate_id_in_snapshot");
  if (!["row_link_href", "id_column"].includes(row.identity_source ?? ""))
    reasons.push("identity_source_unverified");
  const parents = row.parent_ids ?? {};
  const campaignId = level === "campaigns" ? id : (parents.campaign_id ?? null);
  const adSetId =
    level === "adsets"
      ? id
      : level === "ads"
        ? (parents.ad_set_id ?? null)
        : null;
  if (level !== "campaigns" && !campaignId)
    reasons.push("parent_campaign_id_unverified");
  if (level === "ads" && !adSetId) reasons.push("parent_ad_set_id_unverified");
  const mapping =
    row.column_mapping ??
    (row.method === "semantic" ? "semantic" : "unverified");
  if (!["semantic", "verified_geometry"].includes(mapping))
    reasons.push("column_mapping_unverified");
  if (snapshot.column_alignment === "mismatch")
    reasons.push("header_body_scroll_mismatch");
  if (snapshot.row_alignment === "mismatch")
    reasons.push("identity_metric_vertical_mismatch");
  if (snapshot.row_alignment === "unverified")
    reasons.push("row_alignment_unverified");

  const ctx = snapshot.reporting_context ?? {};
  const range = parseDateRangeLabel(ctx.date_range_label);
  if (!range) reasons.push("date_range_unverified");
  // A missing scope is unknown, never an implicit unfiltered/all-dimensions report.
  const missingScope = (value: unknown) =>
    value === null ||
    value === undefined ||
    (typeof value === "string" &&
      /^(?:unknown|unverified|n\/a|ไม่ทราบ|ยังไม่ยืนยัน|[-—–]+)$/i.test(
        value.trim(),
      ));
  const rawBreakdown = ctx.breakdown ?? snapshot.breakdown;
  const confirmedBreakdown =
    missingScope(rawBreakdown) &&
    options.operator?.confirm_no_breakdown === true;
  const scopeBreakdown = recordSchema.shape.breakdown.safeParse(
    confirmedBreakdown ? {} : rawBreakdown,
  );
  const breakdown =
    scopeBreakdown.success && scopeBreakdown.data !== undefined
      ? { ...scopeBreakdown.data }
      : null;
  if (
    !breakdown ||
    Object.values(breakdown).some(
      (v) =>
        !v.trim() || /^(?:unknown|unverified|n\/a|[-—–]+)$/i.test(v.trim()),
    )
  )
    reasons.push("breakdown_unverified");
  if (
    breakdown &&
    Object.keys(breakdown).length &&
    options.operator?.confirm_no_breakdown === true
  )
    reasons.push("breakdown_conflict");
  const filters = ctx.filters ?? snapshot.filters;
  const confirmedFilters =
    missingScope(filters) && options.operator?.confirm_no_filters === true;
  if (!confirmedFilters && (filters === null || typeof filters !== "object"))
    reasons.push("filters_unverified");
  else if (!confirmedFilters && Object.keys(filters as object).length) {
    reasons.push("filters_not_supported");
    if (options.operator?.confirm_no_filters === true)
      reasons.push("filters_conflict");
  }
  const values: Record<string, number> = {};
  const symbols = new Set<string>();
  const seen = new Set<string>();
  let rowAttribution: string | null = null;
  let resultType: string | null = null;
  let name: string | null = null;
  let idFromColumn: string | null = null;
  for (const cell of row.cells) {
    const dimension = breakdownDimensionHeaders.find(([pattern]) =>
      pattern.test(cell.header.trim()),
    )?.[1];
    if (dimension) {
      if (options.operator?.confirm_no_breakdown === true)
        reasons.push("breakdown_conflict");
      const value = cell.text.trim();
      if (!value || /^(?:unknown|unverified|n\/a|[-—–]+)$/i.test(value))
        reasons.push("breakdown_unverified");
      else if (breakdown) {
        if (
          breakdown[dimension] !== undefined &&
          breakdown[dimension] !== value
        )
          reasons.push("breakdown_conflict");
        breakdown[dimension] = value;
      }
    }
    if (nameHeaders[level].test(cell.header.trim())) {
      name = cell.text.split("\n")[0].trim() || null;
      continue;
    }
    const key = canonicalHeader(cell.header);
    if (seen.has(key)) {
      reasons.push(`ambiguous_column:${key}`);
      delete values[key];
      continue;
    }
    seen.add(key);
    const idKey =
      level === "campaigns"
        ? "campaign_id"
        : level === "adsets"
          ? "ad_set_id"
          : "ad_id";
    if (key === idKey) {
      const text = cell.text.trim();
      if (/^\d+$/.test(text)) idFromColumn = text;
      continue;
    }
    if (key === "attribution") {
      const t = cell.text.trim();
      if (t && t !== "—" && t !== "-") rowAttribution = t.replace(/\s+/g, " ");
      continue;
    }
    if (key === "result_type") {
      const t = cell.text.split("\n")[0].trim();
      if (t && t !== "—") resultType = t;
      continue;
    }
    if (!recordNumbers.includes(key) && !extraMetrics.has(key)) continue;
    const parsed = parseDisplayNumber(cell.text);
    if (!parsed) continue; // "—", text or ambiguous display stays missing, never 0
    if (parsed.symbol) symbols.add(parsed.symbol);
    if (integerMetrics.has(key) && !Number.isInteger(parsed.value)) {
      reasons.push(`non_integer:${key}`);
      continue;
    }
    values[key] = parsed.value;
    if (key === "results" && !resultType) {
      const label = cell.text
        .split("\n")
        .slice(1)
        .map((s) => s.trim())
        .find((s) => s && !/^[\d.,%฿$€£]+$/.test(s));
      if (label) resultType = label;
    }
  }
  if (
    row.identity_source === "id_column" &&
    (!id ||
      idFromColumn !== id ||
      !["semantic", "verified_geometry"].includes(mapping))
  )
    reasons.push("identity_source_unverified");
  if (id && idFromColumn && id !== idFromColumn)
    reasons.push("identity_source_unverified");
  const currency =
    verified(ctx.currency) && /^[A-Z]{3}$/.test(ctx.currency!)
      ? ctx.currency!
      : null;
  if (!currency) reasons.push("currency_unverified");
  else
    for (const s of symbols) {
      const c = currencyFromSymbol(s);
      if (c !== currency) reasons.push("currency_conflict");
    }
  const timezone =
    verified(ctx.timezone) && validTimezone(ctx.timezone!)
      ? ctx.timezone!
      : options.operator?.timezone && validTimezone(options.operator.timezone)
        ? options.operator.timezone
        : null;
  if (!timezone) reasons.push("timezone_unverified");
  const attribution =
    rowAttribution ??
    (verified(ctx.attribution) ? ctx.attribution! : null) ??
    options.operator?.attribution?.trim() ??
    null;
  if (!attribution) reasons.push("attribution_unverified");
  const result = resultType ?? options.operator?.result_type?.trim() ?? null;
  if (!result) reasons.push("result_type_unverified");
  if (values.spend === undefined) reasons.push("missing_required_metric:spend");
  if (values.impressions === undefined)
    reasons.push("missing_required_metric:impressions");
  if (!name) reasons.push("entity_name_missing");
  const campaignName =
    level === "campaigns"
      ? name
      : campaignId
        ? (options.campaign_names?.get(campaignId) ?? null)
        : null;
  if (level !== "campaigns" && campaignId && !campaignName)
    reasons.push("parent_campaign_not_promoted");
  const unique = [...new Set(reasons)];
  if (unique.length)
    return {
      status: "needs_review",
      reasons: unique,
      entity_id: id,
      record: null,
    };

  const metrics = Object.fromEntries(
    Object.entries(values).filter(
      ([k]) => extraMetrics.has(k) && !recordNumbers.includes(k),
    ),
  );
  const raw: Record<string, string> = Object.fromEntries(
    row.cells.map((c) => [c.header, c.text]),
  );
  raw._source = "dom_capture";
  raw._source_page = snapshot.page;
  raw._captured_at = snapshot.captured_at;
  // Scope proof v1: supported breakdown preserved exactly; filters explicitly empty.
  // Normalized analysis blocks historical DOM rows without this proof.
  raw._dom_scope_version = "1";
  raw._dom_scope_filters = "[]";
  raw._dom_scope_breakdown = JSON.stringify(
    Object.fromEntries(
      Object.entries(breakdown!).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  raw._dom_identity_source = row.identity_source!;
  raw._dom_scope_provenance = JSON.stringify({
    breakdown: confirmedBreakdown ? "operator" : "dom",
    filters: confirmedFilters ? "operator" : "dom",
  });
  if (snapshot.reader_version) raw._reader_version = snapshot.reader_version;
  const candidate = {
    account_id: snapshot.account_id,
    campaign_id: campaignId,
    campaign_name: campaignName,
    ...(level !== "campaigns" ? { ad_set_id: adSetId } : {}),
    ...(level === "adsets" ? { ad_set_name: name } : {}),
    ...(level === "ads" ? { ad_id: id, ad_name: name } : {}),
    level: recordLevel[level],
    date_start: range!.date_start,
    date_end: range!.date_end,
    currency,
    timezone,
    attribution,
    result_type: result,
    breakdown: breakdown!,
    ...Object.fromEntries(
      recordNumbers
        .filter((k) => values[k] !== undefined)
        .map((k) => [k, values[k]]),
    ),
    ...(Object.keys(metrics).length ? { metrics } : {}),
    raw,
  };
  const parsed = recordSchema.safeParse(candidate);
  if (!parsed.success)
    return {
      status: "needs_review",
      reasons: parsed.error.issues.map(
        (i) => `invalid_record:${i.path.join(".")}`,
      ),
      entity_id: id,
      record: null,
    };
  return { status: "ready", reasons: [], entity_id: id, record: parsed.data };
}

/** Evaluate all rows of a snapshot, marking IDs repeated within it as unverifiable. */
export function evaluateSnapshot(
  snapshot: DomSnapshot,
  options: {
    bound_account: string;
    operator?: OperatorContext;
    campaign_names?: Map<string, string>;
  },
) {
  const counts = new Map<string, number>();
  for (const r of snapshot.row_observations) {
    const key = captureGrainKey(r);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicate_grains = new Set(
    [...counts].filter(([, n]) => n > 1).map(([id]) => id),
  );
  const rows = snapshot.row_observations.map((row) =>
    evaluateCaptureRow(snapshot, row, { ...options, duplicate_grains }),
  );
  // Two ready rows must not claim the same reporting grain with different data.
  const grains = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.record) return;
    const key = recordKey(r.record);
    const prior = grains.get(key);
    if (prior !== undefined) {
      for (const j of [prior, i]) {
        rows[j] = {
          ...rows[j],
          status: "needs_review",
          reasons: ["duplicate_grain_in_snapshot"],
          record: null,
        };
      }
    } else grains.set(key, i);
  });
  return rows;
}
