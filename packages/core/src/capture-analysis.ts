import { canonicalHeader } from "./metrics";
import {
  captureLevel,
  parseDateRangeLabel,
  parseDisplayNumber,
  type CaptureLevel,
  type CaptureRow,
  type DomSnapshot,
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
 * - rows without a stable ID are de-duplicated inside one job only, by their
 *   complete cell content. That is not an identity and is never stored as one;
 * - rows whose header/body scroll offsets differ are excluded from rankings.
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
  [/ข้อผิดพลาดในการชำระเงิน|payment (?:issue|error|failed|method)/i, "payment_error"],
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

const footerLine = /^(?:ผลลัพธ์จาก\s*(?:โฆษณา|แคมเปญ|ชุดโฆษณา)?\s*([\d,]+)|results from\s+([\d,]+))/i;
const hoverLine =
  /^(แก้ไข|สร้างซ้ำ|แผนภูมิ|ดูแผนภูมิ|วิเคราะห์|เปรียบเทียบ|edit|duplicate|charts?|view charts|analy[sz]e|compare)$/i;
const unpublishedLine = /^(การแก้ไขที่ไม่ได้เผยแพร่|unpublished edits?)$/i;
const nameHeaders: Record<CaptureLevel, RegExp> = {
  campaigns: /^(campaign|campaign name|แคมเปญ|ชื่อแคมเปญ)$/i,
  adsets: /^(ad set|ad set name|ชุดโฆษณา|ชื่อชุดโฆษณา)$/i,
  ads: /^(ad|ad name|โฆษณา|ชื่อโฆษณา)$/i,
};
const idKeys: Record<CaptureLevel, string> = { campaigns: "campaign_id", adsets: "ad_set_id", ads: "ad_id" };
/** Columns that are labels, controls or explicitly handled; not "other" metrics. */
const handled = new Set([
  "status", "results", "cost_per_result", "impressions", "spend", "budget", "result_type", "attribution",
  "campaign_id", "ad_set_id", "ad_id", "campaign_name", "ad_set_name", "ad_name",
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
};
export type Recommendation = {
  severity: "critical" | "warning" | "opportunity" | "info";
  code: string;
  message: string;
  rows: string[];
};
export type RankedRow = Pick<AnalyzedRow, "name" | "entity_id" | "delivery" | "results" | "cost_per_result" | "spend" | "spend_source">;
export type LevelAnalysis = {
  level: CaptureLevel;
  snapshots: number;
  observed_rows: number;
  unique_rows: number;
  dedupe: "id" | "content_within_job" | "mixed" | "none";
  reported_total_rows: number | null;
  coverage: "complete" | "partial" | "unknown";
  context: {
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
  delivery_counts: Partial<Record<Delivery, number>>;
  recommendations: Recommendation[];
  warnings: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const lines = (t: string) => t.split("\n").map((s) => s.trim()).filter(Boolean);

function parseBudget(text: string | undefined): Budget {
  if (!text) return { amount: null, period: null, uses: null, text: null };
  const ls = lines(text);
  const joined = ls.join(" ");
  const n = parseDisplayNumber(ls[0] ?? "");
  return {
    amount: n?.value ?? null,
    period: /ต่อวัน|daily|per day/i.test(joined) ? "daily" : /ตลอดอายุ|lifetime/i.test(joined) ? "lifetime" : null,
    uses: /งบประมาณแคมเปญ|campaign budget/i.test(joined)
      ? "campaign_budget"
      : /งบประมาณชุดโฆษณา|ad set budget/i.test(joined)
        ? "ad_set_budget"
        : null,
    text: joined || null,
  };
}

/** Parse one observed row. Returns the footer row count when old captures merged it into a cell. */
export function analyzeRow(level: CaptureLevel, snapshot: DomSnapshot, row: CaptureRow) {
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
      if (i > 0 && nameHeaders[level].test(cell.header.trim()) && hoverLine.test(l)) continue;
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
        resultType = lines(cell.text).slice(1).find((s) => !/^[\d.,%฿$€£]+$/.test(s)) ?? null;
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
  const entity_id =
    row.identity && /^\d+$/.test(row.identity) ? row.identity : (row.identity_source === "id_column" ? idFromColumn : null);
  const mapping: Mapping =
    snapshot.column_alignment === "mismatch"
      ? "unverified"
      : row.column_mapping === "semantic" || row.column_mapping === "verified_geometry"
        ? "verified"
        : snapshot.column_alignment === "aligned"
          ? "aligned_geometry"
          : "unverified";
  const spendSource = spend !== null ? "column" : results !== null && cpr !== null ? "estimate_results_x_cost_per_result" : null;
  const spendValue = spend ?? (results !== null && cpr !== null ? round2(results * cpr) : null);
  const analyzed: Omit<AnalyzedRow, "key" | "occurrences"> = {
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
    cpm: spendValue !== null && impressions ? round2((spendValue / impressions) * 1000) : null,
    budget: parseBudget(budgetText),
    other,
    unpublished_edits: unpublished,
    mapping,
    flags,
  };
  const key = entity_id
    ? `id:${entity_id}`
    : `content:${JSON.stringify(cleaned.map((c) => [c.header.trim(), c.text]).sort())}`;
  return { row: analyzed, key, footerTotal };
}

function median(values: number[]) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : round2((v[m - 1] + v[m]) / 2);
}
const baht = (n: number | null, currency: string | null) =>
  n === null ? "—" : `${currency === "THB" || !currency ? "฿" : currency + " "}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
const levelThai: Record<CaptureLevel, string> = { campaigns: "แคมเปญ", adsets: "ชุดโฆษณา", ads: "โฆษณา" };

export function analyzeCaptureLevel(
  level: CaptureLevel,
  snapshots: DomSnapshot[],
  options: { min_results?: number; high_cost_ratio?: number; operator?: { timezone?: string; attribution?: string } } = {},
): LevelAnalysis {
  const minResults = options.min_results ?? 5;
  const highRatio = options.high_cost_ratio ?? 1.3;
  const ordered = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const byKey = new Map<string, AnalyzedRow>();
  const totals = new Set<number>();
  const columns = new Set<string>();
  let observed = 0;
  let usedId = false;
  let usedContent = false;
  for (const s of ordered) {
    if (typeof s.reported_total_rows === "number") totals.add(s.reported_total_rows);
    for (const row of s.row_observations) {
      observed++;
      for (const c of row.cells) columns.add(canonicalHeader(c.header));
      const { row: a, key, footerTotal } = analyzeRow(level, s, row);
      if (footerTotal !== null) totals.add(footerTotal);
      if (key.startsWith("id:")) usedId = true;
      else usedContent = true;
      const prior = byKey.get(key);
      if (prior) prior.occurrences++;
      else byKey.set(key, { ...a, key, occurrences: 1 });
    }
  }
  const rows = [...byKey.values()];
  const latest = ordered.at(-1);
  const ctx = latest?.reporting_context ?? {};
  const verified = (v: string | null | undefined) => (v && v !== "unverified" ? v : null);
  const range = parseDateRangeLabel(ctx.date_range_label);
  const currency = verified(ctx.currency);
  const reported = totals.size === 1 ? [...totals][0] : null;
  const warnings: string[] = [];
  if (totals.size > 1) warnings.push(`ตัวเลขจำนวนแถวรวมของ Meta ไม่ตรงกันระหว่างภาพ: ${[...totals].join(", ")}`);
  if (usedContent)
    warnings.push(
      "แถวที่ไม่มี ID ถูกรวมเฉพาะเมื่อทุกเซลล์ตรงกันในงานอ่านเดียวกัน ไม่ใช่การยืนยันตัวตน และไม่ใช้ข้ามงานอ่าน",
    );
  const excluded = rows.filter((r) => r.mapping === "unverified").length;
  if (excluded) warnings.push(`${excluded} แถวหัวตารางกับแถวเลื่อนไม่ตรงกัน ไม่นำมาจัดอันดับ`);
  const coverage = reported === null ? "unknown" : rows.length >= reported ? "complete" : "partial";

  // Group sums by result type; rates come from sums, never from averaging row rates.
  const groups = new Map<string, AnalyzedRow[]>();
  for (const r of rows)
    if (r.mapping !== "unverified" && r.results !== null && r.result_type)
      groups.set(r.result_type, [...(groups.get(r.result_type) ?? []), r]);
  const result_groups = [...groups].map(([result_type, rs]) => {
    const results = rs.reduce((a, r) => a + (r.results ?? 0), 0);
    const withSpend = rs.filter((r) => r.spend !== null);
    const spend = withSpend.length === rs.length ? round2(rs.reduce((a, r) => a + r.spend!, 0)) : null;
    const sources = new Set(rs.map((r) => r.spend_source));
    const withImpr = rs.filter((r) => r.impressions !== null);
    return {
      result_type,
      rows: rs.length,
      results,
      spend,
      spend_basis:
        spend === null ? null : sources.size === 1 ? (sources.has("column") ? ("column" as const) : ("estimate" as const)) : ("mixed" as const),
      cost_per_result: spend !== null && results > 0 ? round2(spend / results) : null,
      impressions: withImpr.length === rs.length ? rs.reduce((a, r) => a + r.impressions!, 0) : null,
    };
  });
  result_groups.sort((a, b) => b.rows - a.rows);
  const main = result_groups[0]?.result_type ?? null;
  const eligible = rows.filter(
    (r) =>
      r.mapping !== "unverified" &&
      r.result_type === main &&
      r.results !== null &&
      r.results >= minResults &&
      r.cost_per_result !== null,
  );
  const med = median(eligible.map((r) => r.cost_per_result!));
  const byCost = [...eligible].sort((a, b) => a.cost_per_result! - b.cost_per_result!);
  const n = Math.min(3, Math.floor(byCost.length / 2));
  const best = byCost.slice(0, Math.max(n, byCost.length ? 1 : 0));
  const worst = byCost.length > 1 ? byCost.slice(-Math.max(n, 1)).reverse() : [];

  const recs: Recommendation[] = [];
  const name = levelThai[level];
  const payment = rows.filter((r) => r.delivery === "payment_error");
  if (payment.length)
    recs.push({
      severity: "critical",
      code: "payment_error",
      message: `${name} ${payment.length} รายการแสดง "ข้อผิดพลาดในการชำระเงิน" โฆษณาจะไม่ถูกนำส่งจนกว่าจะแก้วิธีการชำระเงินในหน้าการเรียกเก็บเงินของ Meta`,
      rows: payment.map(label),
    });
  // Comparisons against the median need at least three comparable rows.
  if (med !== null && eligible.length >= 3) {
    const pausedWinners = eligible.filter(
      (r) => (r.delivery === "off" || r.delivery === "parent_off") && r.cost_per_result! <= med,
    );
    if (pausedWinners.length)
      recs.push({
        severity: "opportunity",
        code: "paused_low_cost",
        message: `${name}ที่ปิดอยู่แต่ต้นทุนต่อผลลัพธ์ไม่เกินค่ากลาง (${baht(med, currency)}) พิจารณาเปิดใช้อีกครั้งหรือนำกลุ่มเป้าหมาย/ครีเอทีฟไปใช้ในตัวที่เปิดอยู่ (ผู้ใช้ตัดสินใจเอง บอทไม่เปลี่ยนสถานะ)`,
        rows: pausedWinners.map((r) => `${label(r)} (${baht(r.cost_per_result, currency)})`),
      });
    const expensive = eligible.filter(
      (r) => r.delivery !== "off" && r.delivery !== "parent_off" && r.cost_per_result! >= med * highRatio,
    );
    if (expensive.length)
      recs.push({
        severity: "warning",
        code: "high_cost_per_result",
        message: `ต้นทุนต่อผลลัพธ์สูงกว่าค่ากลาง ${Math.round((highRatio - 1) * 100)}% ขึ้นไป ทบทวนกลุ่มเป้าหมาย ครีเอทีฟ หรือย้ายงบไปยังรายการที่ต้นทุนต่ำกว่า`,
        rows: expensive.map((r) => `${label(r)} (${baht(r.cost_per_result, currency)})`),
      });
  }
  const noResults = rows.filter((r) => r.mapping !== "unverified" && r.results === null && (r.impressions ?? 0) >= 1000);
  if (noResults.length)
    recs.push({
      severity: "warning",
      code: "impressions_without_results",
      message: "มีอิมเพรสชันตั้งแต่ 1,000 ขึ้นไปแต่ Meta ไม่แสดงผลลัพธ์ ตรวจข้อความโฆษณา ปลายทาง หรือเป้าหมายการปรับให้เหมาะสม",
      rows: noResults.map((r) => `${label(r)} (${r.impressions!.toLocaleString("en-US")} อิมเพรสชัน)`),
    });
  const low = rows.filter((r) => r.results !== null && r.results < minResults);
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
      message: `อ่านได้ ${rows.length} จาก ${reported} แถวที่ Meta แจ้ง ผลรวมและอันดับเป็นเฉพาะแถวที่อ่านได้`,
      rows: [],
    });
  const missing: string[] = [];
  if (!columns.has("spend")) missing.push("spend");
  if (!columns.has("impressions")) missing.push("impressions");
  if (!columns.has("results")) missing.push("results");
  if (!rows.some((r) => r.entity_id)) missing.push(idKeys[level]);
  if (missing.includes("spend"))
    recs.push({
      severity: "info",
      code: "add_spend_column",
      message: 'ตารางไม่มีคอลัมน์ "จำนวนเงินที่ใช้จ่ายไป" ยอดใช้จ่ายในรายงานนี้เป็นค่าประมาณจาก ผลลัพธ์ × ต้นทุนต่อผลลัพธ์ เพิ่มคอลัมน์นี้ใน Meta เพื่อใช้ยอดจริง',
      rows: [],
    });
  if (missing.includes(idKeys[level]))
    recs.push({
      severity: "info",
      code: "add_id_column",
      message: `ไม่พบ ID ของ${name}ในหน้า เพิ่มคอลัมน์ "ID ${name}" ใน Meta เพื่อให้ระบบยืนยันตัวตนและบันทึกเป็นข้อมูลถาวรได้`,
      rows: [],
    });
  const timezone = verified(ctx.timezone) ?? options.operator?.timezone ?? null;
  const attribution = verified(ctx.attribution) ?? options.operator?.attribution ?? null;
  const delivery_counts: Partial<Record<Delivery, number>> = {};
  for (const r of rows) delivery_counts[r.delivery] = (delivery_counts[r.delivery] ?? 0) + 1;
  return {
    level,
    snapshots: ordered.length,
    observed_rows: observed,
    unique_rows: rows.length,
    dedupe: !rows.length ? "none" : usedId && usedContent ? "mixed" : usedId ? "id" : "content_within_job",
    reported_total_rows: reported,
    coverage,
    context: {
      date_range_label: ctx.date_range_label ?? null,
      date_start: range?.date_start ?? null,
      date_end: range?.date_end ?? null,
      currency,
      timezone,
      attribution,
      column_preset_label: ctx.column_preset_label ?? null,
    },
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
    const s = snapshots.filter((x) => captureLevel(x.page) === level);
    if (s.length) levels.push(analyzeCaptureLevel(level, s, options));
  }
  const critical = levels.flatMap((l) => l.recommendations.filter((r) => r.severity === "critical"));
  return {
    levels,
    payment_error: critical.some((r) => r.code === "payment_error"),
    data_quality: {
      identity: levels.every((l) => l.unique_rows === 0 || l.dedupe === "id") ? "verified_ids" : "no_stable_ids",
      spend: levels.some((l) => l.missing_columns.includes("spend")) ? "estimated" : "reported",
      coverage: levels.map((l) => ({ level: l.level, captured: l.unique_rows, reported: l.reported_total_rows, coverage: l.coverage })),
    },
    notice:
      "วิเคราะห์จากข้อมูลที่มองเห็นบนหน้า Meta เท่านั้น ยังไม่ใช่ข้อมูลที่ยืนยันแล้ว ค่าที่ไม่ทราบไม่ถูกแทนด้วยศูนย์ และคำแนะนำไม่ถูกนำไปเปลี่ยนโฆษณาโดยอัตโนมัติ",
  };
}
export type CaptureJobAnalysis = ReturnType<typeof analyzeCaptureJob>;
