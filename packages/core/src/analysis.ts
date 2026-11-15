import { recordKey, type AdRecord } from "./index";
export type AnalysisGoal = "messages" | "sales" | "leads";
export const goalLabels = {
  messages: "ข้อความ",
  sales: "ยอดขาย",
  leads: "ลูกค้าเป้าหมาย",
} as const;
export const requiredColumns = {
  messages: ["spend", "impressions", "link_clicks", "messaging_conversations"],
  sales: ["spend", "impressions", "link_clicks", "purchases", "purchase_value"],
  leads: ["spend", "impressions", "link_clicks", "leads"],
} as const;
const value = (r: AdRecord, k: string): number | null => {
  const n =
    k in r
      ? r[k as keyof AdRecord]
      : r.metrics?.[k as keyof NonNullable<AdRecord["metrics"]>];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const ratio = (n: number | null, d: number | null, multiplier = 1) =>
  n === null || d === null || d === 0 ? null : (n / d) * multiplier;
const unknown = (s: string) =>
  /^(unknown|unverified|unspecified|not set|n\/a|ไม่ทราบ|ยังไม่ยืนยัน|-+|—|–)$/i.test(
    s.trim(),
  );
export function buildAnalysis(
  records: AdRecord[],
  goal: AnalysisGoal = "messages",
) {
  const rows = records.map((r) => {
    const metrics = Object.fromEntries(
      [
        "spend",
        "impressions",
        "reach",
        "results",
        "link_clicks",
        "purchase_value",
        "messaging_conversations",
        "leads",
        "purchases",
        "landing_page_views",
        "adds_to_cart",
        "checkouts_initiated",
        "website_purchases",
        "website_purchase_value",
        "budget",
        "ctr",
        "cpc",
        "cpm",
        "frequency",
        "cost_per_result",
        "link_ctr",
        "link_cpc",
        "roas",
        "website_roas",
        "cost_per_purchase",
        "cost_per_lead",
        "cost_per_messaging_conversation",
      ].map((k) => [k, value(r, k)]),
    );
    // Results have objective-dependent semantics. Only use explicitly named events.
    const conversions =
      metrics[
        goal === "sales"
          ? "purchases"
          : goal === "leads"
            ? "leads"
            : "messaging_conversations"
      ];
    const missing = requiredColumns[goal].filter(
      (k) => metrics[k] === null,
    ) as string[];
    if (r.level !== "ad" || !r.ad_id) missing.push("ad_id");
    if (unknown(r.attribution)) missing.push("attribution");
    if (unknown(r.result_type)) missing.push("result_type");
    const key = recordKey(r);
    return {
      key,
      account_id: r.account_id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      ad_set_id: r.ad_set_id ?? null,
      ad_set_name: r.ad_set_name ?? null,
      ad_id: r.ad_id ?? null,
      ad_name: r.ad_name ?? null,
      level: r.level,
      date_start: r.date_start,
      date_end: r.date_end,
      currency: r.currency,
      timezone: r.timezone,
      attribution: r.attribution,
      result_type: r.result_type,
      breakdown: r.breakdown ?? {},
      status: r.status ?? null,
      reported: metrics,
      derived: {
        link_ctr: ratio(metrics.link_clicks, metrics.impressions, 100),
        link_cpc: ratio(metrics.spend, metrics.link_clicks),
        cpm: ratio(metrics.spend, metrics.impressions, 1000),
        cost_per_conversion: ratio(metrics.spend, conversions),
        purchase_roas: ratio(metrics.purchase_value, metrics.spend),
        website_roas: ratio(metrics.website_purchase_value, metrics.spend),
        landing_page_rate: ratio(
          metrics.landing_page_views,
          metrics.link_clicks,
          100,
        ),
        // Conversion events need not be click-attributed; do not call purchases/clicks a conversion rate.
      },
      conversions,
      missing,
      readiness: missing.length ? "incomplete" : "ready_for_selected_goal",
      creative: r.creative ?? null,
      raw: r.raw,
    };
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  for (const row of rows)
    if (counts.get(row.key)! > 1) {
      row.missing.push("duplicate_grain");
      row.readiness = "incomplete";
    }
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.account_id,
      row.level,
      row.date_start,
      row.date_end,
      row.currency,
      row.timezone,
      row.attribution,
      row.result_type,
      Object.entries(row.breakdown).sort(),
    ]);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const summaries = [...groups.entries()].map(([key, group]) => {
    const first = group[0];
    const blocked =
      unknown(first.attribution) ||
      unknown(first.result_type) ||
      group.some((r) => r.missing.includes("duplicate_grain"));
    const sum = (k: string) =>
      blocked || group.some((r) => r.reported[k] === null)
        ? null
        : group.reduce((n, r) => n + r.reported[k]!, 0);
    const spend = sum("spend"),
      impressions = sum("impressions"),
      clicks = sum("link_clicks");
    const conversionKey =
      goal === "sales"
        ? "purchases"
        : goal === "leads"
          ? "leads"
          : "messaging_conversations";
    const conversions = sum(conversionKey),
      revenue = sum("purchase_value");
    return {
      key,
      account_id: first.account_id,
      level: first.level,
      date_start: first.date_start,
      date_end: first.date_end,
      currency: first.currency,
      timezone: first.timezone,
      attribution: first.attribution,
      result_type: first.result_type,
      breakdown: first.breakdown,
      rows: group.length,
      blocked,
      totals: {
        spend,
        impressions,
        link_clicks: clicks,
        conversions,
        purchase_value: revenue,
        // Reach/frequency are not additive; totals require a source aggregate.
        reach: null,
        frequency: null,
      },
      derived: {
        link_ctr: ratio(clicks, impressions, 100),
        link_cpc: ratio(spend, clicks),
        cpm: ratio(spend, impressions, 1000),
        cost_per_conversion: ratio(spend, conversions),
        purchase_roas: ratio(revenue, spend),
      },
    };
  });
  // Overlapping intervals can coexist in the database. Expose them instead of summing across groups.
  const overlaps: string[] = [];
  const intervals = new Map<string, typeof rows>();
  for (const row of rows) {
    const k = JSON.stringify([
      row.account_id,
      row.level,
      row.ad_id ?? row.ad_set_id ?? row.campaign_id,
      row.currency,
      row.timezone,
      row.attribution,
      row.result_type,
      Object.entries(row.breakdown).sort(),
    ]);
    const list = intervals.get(k) ?? [];
    list.push(row);
    intervals.set(k, list);
  }
  for (const list of intervals.values()) {
    list.sort((a, b) => a.date_start.localeCompare(b.date_start));
    let end = "";
    for (const r of list) {
      if (r.date_start <= end) overlaps.push(r.key);
      if (r.date_end > end) end = r.date_end;
    }
  }
  return {
    schema_version: "1.0",
    goal,
    generated_at: new Date().toISOString(),
    coverage: "unverified" as const,
    required_columns: requiredColumns[goal],
    summary: {
      rows: rows.length,
      ready_rows: rows.filter((r) => !r.missing.length).length,
      incomplete_rows: rows.filter((r) => r.missing.length).length,
      overlapping_observations: overlaps.length,
    },
    warnings: [
      "ความครบทั้งบัญชียังไม่ยืนยัน",
      "สรุปแยกตามช่วงวันที่ ระดับ สกุลเงิน Attribution และ Breakdown; ห้ามบวกยอดข้ามกลุ่ม",
      "Reach และ Frequency ไม่รวมข้ามแถว",
      "ค่าคำนวณแยกจากค่าที่ Meta รายงาน; ตัวหารศูนย์หรือข้อมูลขาดให้ค่า null",
      "รายได้จาก Meta เป็นยอดตาม Attribution ไม่ใช่ยอดรับเงินจริง; ยังไม่คำนวณกำไรเพราะไม่มีต้นทุนสินค้าและค่าธรรมเนียม",
      ...(overlaps.length
        ? ["มีช่วงวันที่ทับซ้อนสำหรับโฆษณาเดียวกัน ห้ามรวมยอดระหว่างกลุ่ม"]
        : []),
    ],
    overlapping_keys: overlaps,
    groups: summaries,
    rows,
  };
}
export type AnalysisReport = ReturnType<typeof buildAnalysis>;
