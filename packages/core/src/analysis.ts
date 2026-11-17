import {
  recordKey,
  type AdRecord,
  type ImportReconciliation,
} from "./index";
export type AnalysisGoal = "messages" | "sales" | "leads";
export type AnalysisSource = "csv" | "dom_capture" | "unknown";
export type AnalysisScopeCoverage = "verified_for_import" | "unverified";
export const goalLabels = {
  messages: "ข้อความ",
  sales: "ยอดขาย",
  leads: "ลูกค้าเป้าหมาย",
} as const;
/** CSV provenance is stamped by the importer and must win over user-supplied raw
 * keys. DOM provenance is stamped by capture promotion. Unknown stays unknown
 * rather than being guessed from names or row positions. */
export function recordSource(record: AdRecord): AnalysisSource {
  if (record.raw._source_filename) return "csv";
  if (record.raw._source === "dom_capture") return "dom_capture";
  return "unknown";
}
export type ImportScopeStatus =
  | "verified_for_import"
  | "unverified"
  | "not_applicable";
function importScopeStatus(record: AdRecord): ImportScopeStatus {
  if (recordSource(record) !== "csv") return "not_applicable";
  try {
    const proof: unknown = JSON.parse(
      record.raw._import_reconciliation ?? "",
    );
    if (!proof || typeof proof !== "object" || Array.isArray(proof))
      return "unverified";
    const stored = proof as {
      version?: unknown;
      filename?: unknown;
      reconciliation?: {
        status?: unknown;
        verified?: unknown;
        rows?: { matched?: unknown };
        spend?: { matched?: unknown };
      };
    };
    return stored.version === 1 &&
      stored.filename === record.raw._source_filename &&
      stored.reconciliation?.status === "verified_for_import" &&
      stored.reconciliation.verified === true &&
      stored.reconciliation.rows?.matched === true &&
      stored.reconciliation.spend?.matched === true
      ? "verified_for_import"
      : "unverified";
  } catch {
    return "unverified";
  }
}
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
  /^(|unknown|unverified|unspecified|not set|n\/a|ไม่ทราบ|ยังไม่ยืนยัน|-+|—|–)$/i.test(
    s.trim(),
  );
/** DOM scope proof v1 is stamped only after capture promotion validates scope.
 * Historical rows stay visible, but cannot acquire actionable validity by export.
 * Keep this browser-safe: dom-capture also imports server-only fingerprint tools.
 */
function verifiedDomScope(record: AdRecord) {
  const raw = record.raw;
  if (raw._source !== "dom_capture") return true;
  if (
    raw._dom_scope_version !== "1" ||
    raw._dom_scope_filters !== "[]" ||
    !["row_link_href", "id_column"].includes(raw._dom_identity_source) ||
    !record.breakdown
  )
    return false;
  try {
    const stored: unknown = JSON.parse(raw._dom_scope_breakdown);
    if (!stored || typeof stored !== "object" || Array.isArray(stored))
      return false;
    if (
      Object.values(stored).some(
        (value) => typeof value !== "string" || unknown(value),
      )
    )
      return false;
    const canonical = (value: object) =>
      JSON.stringify(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      );
    return canonical(stored) === canonical(record.breakdown);
  } catch {
    return false;
  }
}
export type AdEvaluation = {
  status:
    | "blocked"
    | "insufficient_sample"
    | "insufficient_peers"
    | "lower_cost"
    | "typical_cost"
    | "higher_cost";
  blockers: string[];
  reasons: string[];
  next_steps: string[];
  comparison: {
    peer_count: number;
    median_cost_per_conversion: number;
    relative_cost: number;
  } | null;
};
const evaluationPolicy = Object.freeze({
  min_conversions: 5,
  min_comparable_ads: 3,
  high_cost_ratio: 1.3,
  low_cost_ratio: 1 / 1.3,
});
export function buildAnalysis(
  records: AdRecord[],
  goal: AnalysisGoal = "messages",
  scope: {
    coverage?: AnalysisScopeCoverage;
    reconciliation?: ImportReconciliation | null;
  } = {},
) {
  const sourceMix = { csv: 0, dom_capture: 0, unknown: 0 };
  const rows = records.map((r) => {
    const source = recordSource(r);
    sourceMix[source]++;
    const importReconciliation = importScopeStatus(r);
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
    if (unknown(r.timezone)) missing.push("timezone");
    if (unknown(r.currency)) missing.push("currency");
    if (!verifiedDomScope(r)) missing.push("dom_scope_unverified");
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
      objective: r.objective ?? null,
      breakdown: r.breakdown ?? {},
      status: r.status ?? null,
      source,
      import_reconciliation: importReconciliation,
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
      evaluation: {
        status: "blocked",
        blockers: [],
        reasons: [],
        next_steps: [],
        comparison: null,
      } as AdEvaluation,
    };
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.source}\u0000${row.key}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of rows)
    if (counts.get(`${row.source}\u0000${row.key}`)! > 1) {
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
      row.objective,
      row.source,
      Object.entries(row.breakdown).sort(),
    ]);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const sourceRank: Record<AnalysisSource, number> = {
    csv: 0,
    dom_capture: 1,
    unknown: 2,
  };
  const summaries = [...groups.entries()].map(([key, group]) => {
    const first = group[0];
    const blocked =
      unknown(first.attribution) ||
      unknown(first.result_type) ||
      unknown(first.timezone) ||
      unknown(first.currency) ||
      group.some(
        (r) =>
          r.missing.includes("duplicate_grain") ||
          r.missing.includes("dom_scope_unverified"),
      );
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
      objective: first.objective,
      source: first.source,
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
  summaries.sort(
    (a, b) =>
      sourceRank[a.source] - sourceRank[b.source] ||
      a.date_start.localeCompare(b.date_start),
  );
  // Overlapping intervals can coexist in the database. Expose them instead of summing across groups.
  const overlaps: string[] = [];
  const overlappingRows = new Set<string>();
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
      row.source,
      Object.entries(row.breakdown).sort(),
    ]);
    const list = intervals.get(k) ?? [];
    list.push(row);
    intervals.set(k, list);
  }
  for (const list of intervals.values()) {
    list.sort((a, b) => a.date_start.localeCompare(b.date_start));
    let end = "";
    let active: typeof rows = [];
    for (const r of list) {
      active = active.filter((p) => p.date_end >= r.date_start);
      if (r.date_start <= end) {
        overlaps.push(r.key);
        overlappingRows.add(r.key);
        for (const prior of active) overlappingRows.add(prior.key);
      }
      active.push(r);
      if (r.date_end > end) end = r.date_end;
    }
  }
  const evaluationGroups = summaries.map((summary) => {
    const group = groups.get(summary.key)!;
    const blockersFor = (r: (typeof rows)[number]) => [
      ...new Set([
        ...r.missing,
        ...(summary.blocked ? ["group_quality_blocked"] : []),
        ...(overlappingRows.has(r.key) ? ["overlapping_interval"] : []),
        ...(r.reported.spend !== null && r.reported.spend <= 0
          ? ["nonpositive_spend"]
          : []),
        ...(r.reported.impressions !== null && r.reported.impressions <= 0
          ? ["nonpositive_impressions"]
          : []),
      ]),
    ];
    const eligible = group.filter(
      (r) =>
        !blockersFor(r).length &&
        r.conversions !== null &&
        r.conversions >= evaluationPolicy.min_conversions &&
        r.derived.cost_per_conversion !== null,
    );
    const costs = eligible
      .map((r) => r.derived.cost_per_conversion!)
      .sort((a, b) => a - b);
    const middle = Math.floor(costs.length / 2);
    const median =
      costs.length < evaluationPolicy.min_comparable_ads
        ? null
        : costs.length % 2
          ? costs[middle]
          : (costs[middle - 1] + costs[middle]) / 2;
    for (const r of group) {
      const blockers = blockersFor(r);
      const next_steps = [
        "ตรวจคุณภาพคอนเวอร์ชั่นกับข้อมูลธุรกิจก่อนตัดสินใจงบ; บอทไม่เปลี่ยนโฆษณาอัตโนมัติ",
      ];
      const reasons = [
        `ประเมินเป้าหมาย${goalLabels[goal]}จากคอนเวอร์ชั่นที่ระบุชนิดชัดเจน ภายในชุดรายงานเดียวกัน`,
      ];
      let status: AdEvaluation["status"];
      let comparison: AdEvaluation["comparison"] = null;
      if (blockers.length) {
        status = "blocked";
        reasons.push("หลักฐานยังไม่พร้อมสำหรับคำแนะนำเปรียบเทียบ");
        next_steps.unshift(
          "ตรวจคอลัมน์ที่ขาด บริบทรายงาน และข้อมูลซ้ำหรือช่วงวันที่ทับซ้อน แล้วนำเข้ารายงานที่ตรวจยอดกับต้นทางแล้ว",
        );
      } else if (
        r.conversions === null ||
        r.conversions < evaluationPolicy.min_conversions
      ) {
        status = "insufficient_sample";
        reasons.push(
          `พบ ${r.conversions ?? "ไม่ทราบ"} คอนเวอร์ชั่น; เกณฑ์คัดกรองใช้ตั้งแต่ ${evaluationPolicy.min_conversions} ผลลัพธ์ ไม่ใช่การยืนยันนัยสำคัญทางสถิติ`,
        );
        next_steps.unshift(
          r.conversions === 0
            ? "ต้นทางรายงาน 0 ผลลัพธ์ ตรวจการวัดผล ปลายทาง และสถานะการนำส่งก่อนสรุปว่าแอดไม่มีประสิทธิภาพ"
            : "รวบรวมผลลัพธ์เพิ่มในช่วงรายงานที่เทียบกันได้ก่อนจัดอันดับ",
        );
      } else if (median === null || median <= 0) {
        status = "insufficient_peers";
        reasons.push(
          `มีแอดที่ผ่านเกณฑ์ ${eligible.length} รายการ ต้องมีอย่างน้อย ${evaluationPolicy.min_comparable_ads} รายการเพื่อเทียบค่ากลาง`,
        );
        next_steps.unshift(
          "เปรียบเทียบกับรายงานที่ใช้เป้าหมาย ช่วงวัน สกุลเงิน Attribution และเงื่อนไขเดียวกัน",
        );
      } else {
        const relative = r.derived.cost_per_conversion! / median;
        comparison = {
          peer_count: eligible.length,
          median_cost_per_conversion: median,
          relative_cost: relative,
        };
        status =
          relative >= evaluationPolicy.high_cost_ratio
            ? "higher_cost"
            : relative <= evaluationPolicy.low_cost_ratio
              ? "lower_cost"
              : "typical_cost";
        reasons.push(
          `ต้นทุนต่อคอนเวอร์ชั่น ${r.derived.cost_per_conversion} ${r.currency}; ค่ากลาง ${median} ${r.currency} จาก ${eligible.length} แอด (${relative.toFixed(2)} เท่าของค่ากลาง)`,
        );
        reasons.push(
          "เป็นการเปรียบเทียบเชิงพรรณนาในข้อมูลที่นำเข้า ไม่ยืนยันสาเหตุ ความคุ้มทุน หรือผลหลังปรับงบ",
        );
        if (status === "higher_cost")
          next_steps.unshift(
            "ตรวจแอดที่ต้นทุนสูงกว่าค่ากลางอย่างน้อย 30%: คุณภาพกลุ่มเป้าหมาย ครีเอทีฟ และปลายทาง แล้ววางการทดลองทีละปัจจัย",
          );
        else if (status === "lower_cost")
          next_steps.unshift(
            "ตรวจคุณภาพผลลัพธ์และความสม่ำเสมอของแอดต้นทุนต่ำก่อนวางแผนทดลองขยายผล",
          );
        else
          next_steps.unshift(
            "ติดตามต้นทุนและคุณภาพผลลัพธ์ในช่วงเวลาถัดไปภายใต้เงื่อนไขเดิม",
          );
      }
      if (/payment|ชำระเงิน/i.test(r.status ?? ""))
        next_steps.unshift(
          "ตรวจข้อผิดพลาดการชำระเงินใน Meta เพราะมีผลต่อการนำส่ง แยกจากผลประเมินต้นทุนย้อนหลัง",
        );
      if (goal === "sales")
        reasons.push(
          `ROAS ตาม Attribution: ${r.derived.purchase_roas ?? "ไม่ทราบ"}; ไม่ใช่กำไรสุทธิหรือยอดรับเงินจริง`,
        );
      r.evaluation = { status, blockers, reasons, next_steps, comparison };
    }
    return {
      group_key: summary.key,
      eligible_ads: eligible.length,
      median_cost_per_conversion: median,
    };
  });
  return {
    schema_version: "1.0",
    goal,
    generated_at: new Date().toISOString(),
    coverage: "unverified" as const,
    scope_coverage: scope.coverage ?? ("unverified" as const),
    reconciliation: scope.reconciliation ?? null,
    source_mix: sourceMix,
    verified_import_rows: rows.filter(
      (row) => row.import_reconciliation === "verified_for_import",
    ).length,
    required_columns: requiredColumns[goal],
    evaluation_policy: evaluationPolicy,
    evaluation_groups: evaluationGroups,
    summary: {
      rows: rows.length,
      ready_rows: rows.filter((r) => !r.missing.length).length,
      incomplete_rows: rows.filter((r) => r.missing.length).length,
      overlapping_observations: overlaps.length,
    },
    warnings: [
      "ความครบทั้งบัญชียังไม่ยืนยัน",
      "CSV ที่กระทบยอดแล้วเป็นแหล่งยอดหลัก; DOM เป็นหลักฐานเสริมแบบ lower bound และระบบไม่บวกยอดข้ามแหล่งหรือข้ามชุดรายงาน",
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
