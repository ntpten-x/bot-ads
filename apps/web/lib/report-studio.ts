import type {
  AnalyzedRow,
  Delivery,
  LevelAnalysis,
} from "../../../packages/core/src/capture-analysis";
import { nonPerformanceDeliveries } from "../../../packages/core/src/capture-analysis";
import { recordSource } from "../../../packages/core/src/analysis";
import type { AdRecord } from "../../../packages/core/src/index";

export type ReportMetric =
  "spend" | "results" | "impressions" | "cost_per_result" | "cpm" | "roas";

export type ReportSortOrder = "desc" | "asc";
export type ReportView =
  | "compare"
  | "relationship"
  | "distribution"
  | "composition"
  | "concentration"
  | "trend";

export const reportMetrics: Record<
  ReportMetric,
  {
    label: string;
    short: string;
    kind: "money" | "number";
    aggregate: "sum" | "ratio" | "average";
  }
> = {
  spend: {
    label: "ยอดใช้จ่าย",
    short: "Spend",
    kind: "money",
    aggregate: "sum",
  },
  results: {
    label: "ผลลัพธ์",
    short: "Results",
    kind: "number",
    aggregate: "sum",
  },
  impressions: {
    label: "อิมเพรสชัน",
    short: "Impressions",
    kind: "number",
    aggregate: "sum",
  },
  cost_per_result: {
    label: "ต้นทุนต่อผลลัพธ์",
    short: "Cost / result",
    kind: "money",
    aggregate: "ratio",
  },
  cpm: {
    label: "CPM",
    short: "CPM",
    kind: "money",
    aggregate: "ratio",
  },
  roas: {
    label: "ROAS",
    short: "ROAS",
    kind: "number",
    aggregate: "ratio",
  },
};

export const reportViews: Record<
  ReportView,
  { label: string; question: string }
> = {
  compare: {
    label: "เปรียบเทียบ",
    question: "Ads ใดมีค่าที่เลือกมากหรือน้อยกว่ากัน",
  },
  relationship: {
    label: "ความสัมพันธ์",
    question: "เมื่อใช้จ่ายหรือได้อิมเพรสชันเพิ่มขึ้น ผลลัพธ์เปลี่ยนอย่างไร",
  },
  distribution: {
    label: "การกระจาย",
    question: "ค่ากระจุกตัวหรือกระจาย และมีค่าสุดโต่งหรือไม่",
  },
  composition: {
    label: "องค์ประกอบ",
    question: "Spend หรือผลลัพธ์กระจายอยู่ตามสถานะและกลุ่มใด",
  },
  concentration: {
    label: "เส้นสะสม",
    question: "Spend รวมศูนย์อยู่ใน Ads ไม่กี่รายการหรือกระจายทั่วทั้งชุด",
  },
  trend: {
    label: "แนวโน้ม",
    question: "ตัวเลขเปลี่ยนแปลงอย่างไรเมื่อเวลาผ่านไปในชุดข้อมูลรายวัน",
  },
};

export const deliveryLabels: Record<Delivery, string> = {
  payment_error: "ข้อผิดพลาดการชำระเงิน",
  parent_off: "ระดับบนปิดอยู่",
  off: "ปิด",
  limited: "จำกัดการเรียนรู้",
  learning: "กำลังเรียนรู้",
  in_review: "รอตรวจสอบ",
  rejected: "ถูกปฏิเสธ",
  not_delivering: "ไม่ได้นำส่ง",
  completed: "เสร็จสมบูรณ์",
  active: "ใช้งานอยู่",
  unknown: "ไม่ทราบสถานะ",
};

export type ReportRow = AnalyzedRow & {
  metric_value: number | null;
  identity_state: "verified" | "observed";
};

export function buildPerformanceRows(rows: ReportRow[]) {
  return rows.filter(
    (row) => !nonPerformanceDeliveries.has(row.delivery),
  );
}

export function metricValue(row: AnalyzedRow, metric: ReportMetric) {
  if (metric === "roas")
    return typeof row.other.roas === "number" && Number.isFinite(row.other.roas)
      ? row.other.roas
      : null;
  const value =
    metric === "cost_per_result" || metric === "cpm"
      ? row[metric]
      : (row[metric] ?? row.other[metric]);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowIdentity(row: AnalyzedRow): ReportRow["identity_state"] {
  return row.entity_id && row.mapping === "verified" ? "verified" : "observed";
}

export function buildReportRows(
  level: LevelAnalysis | undefined,
  options: {
    metric: ReportMetric;
    order?: ReportSortOrder;
    query?: string;
    resultType?: string;
    delivery?: string;
    includeObserved?: boolean;
  },
) {
  if (!level) return [];
  const query = options.query?.trim().toLocaleLowerCase("th") ?? "";
  const order = options.order ?? "desc";
  return level.rows
    .filter(
      (row) =>
        (options.includeObserved !== false ||
          (row.entity_id !== null && row.mapping === "verified")) &&
        (!options.resultType || row.result_type === options.resultType) &&
        (!options.delivery || row.delivery === options.delivery) &&
        (!query ||
          [row.name, row.entity_id, row.result_type, row.delivery_text]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLocaleLowerCase("th").includes(query))),
    )
    .map((row): ReportRow => ({
      ...row,
      metric_value: metricValue(row, options.metric),
      identity_state: rowIdentity(row),
    }))
    .sort((a, b) => {
      if (a.metric_value === null && b.metric_value === null)
        return (a.name ?? a.entity_id ?? "").localeCompare(
          b.name ?? b.entity_id ?? "",
          "th",
        );
      if (a.metric_value === null) return 1;
      if (b.metric_value === null) return -1;
      return order === "desc"
        ? b.metric_value - a.metric_value
        : a.metric_value - b.metric_value;
    });
}

export function buildChartRows(rows: ReportRow[], limit = 12) {
  const values = rows
    .map((row) => row.metric_value)
    .filter((value): value is number => value !== null);
  const max = values.length ? Math.max(...values) : null;
  return {
    max,
    rows: rows
      .filter((row) => row.metric_value !== null)
      .slice(0, limit)
      .map((row) => ({
        row,
        width:
          max && max > 0
            ? Math.max(2, Math.min(100, (row.metric_value! / max) * 100))
            : 0,
      })),
  };
}

export function uniqueValues(
  level: LevelAnalysis | undefined,
  key: "result_type",
): string[];
export function uniqueValues(
  level: LevelAnalysis | undefined,
  key: "delivery",
): Delivery[];
export function uniqueValues(
  level: LevelAnalysis | undefined,
  key: "result_type" | "delivery",
) {
  const values = level?.rows
    .map((row) => row[key])
    .filter((value): value is string => Boolean(value));
  return [...new Set(values ?? [])].sort((a, b) => a.localeCompare(b, "th"));
}

export function buildDeliverySummary(rows: ReportRow[]) {
  const counts = new Map<Delivery, number>();
  for (const row of rows)
    counts.set(row.delivery, (counts.get(row.delivery) ?? 0) + 1);
  return [...counts]
    .map(([delivery, count]) => ({
      delivery,
      label: deliveryLabels[delivery],
      count,
      width: rows.length ? (count / rows.length) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function scopeLabel(level: LevelAnalysis) {
  const breakdown = level.context.breakdown;
  if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
    const entries = Object.entries(breakdown);
    if (entries.length)
      return entries
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(" · ");
  }
  return level.context.date_range_label ?? level.scope_key;
}

export function buildScopeBars(levels: LevelAnalysis[], metric: ReportMetric) {
  const scoped = levels
    .filter((level) => level.level === "ads" && level.rows.length)
    .map((level) => {
      const rows = level.rows.filter(
        (row) => !nonPerformanceDeliveries.has(row.delivery),
      );
      const aggregate = aggregateRows(rows, metric);
      return {
        level,
        label: scopeLabel(level),
        value: aggregate.value,
        present: aggregate.present,
        total: rows.length,
        reason: aggregate.reason,
      };
    })
    .filter(
      (item): item is typeof item & { value: number } => item.value !== null,
    );
  const max = scoped.length
    ? Math.max(...scoped.map((item) => item.value))
    : null;
  return {
    max,
    rows: scoped.map((item) => ({
      ...item,
      width:
        max && max > 0
          ? Math.max(2, Math.min(100, (item.value / max) * 100))
          : 0,
    })),
  };
}

export function aggregateRows(
  rows: AnalyzedRow[],
  metric: ReportMetric,
): {
  value: number | null;
  present: number;
  total: number;
  reason: string | null;
} {
  const values = rows
    .map((row) => metricValue(row, metric))
    .filter((value): value is number => value !== null);
  if (!values.length)
    return {
      value: null,
      present: 0,
      total: rows.length,
      reason: "ไม่มีค่าที่อ่านได้",
    };
  if (metric === "cost_per_result") {
    const resultTypes = new Set(
      rows
        .map((row) => row.result_type)
        .filter((value): value is string => Boolean(value)),
    );
    const spend = rows
      .map((row) => row.spend)
      .filter((value): value is number => value !== null);
    const results = rows
      .map((row) => row.results)
      .filter((value): value is number => value !== null);
    if (resultTypes.size > 1)
      return {
        value: null,
        present: values.length,
        total: rows.length,
        reason: "ผลลัพธ์มีหลายประเภท จึงไม่รวมต้นทุนต่อผลลัพธ์",
      };
    if (spend.length < rows.length || results.length < rows.length)
      return {
        value: null,
        present: values.length,
        total: rows.length,
        reason: "Spend หรือ Results บางแถวหาย จึงไม่คำนวณยอดรวม",
      };
    const totalSpend = spend.reduce((sum, value) => sum + value, 0);
    const totalResults = results.reduce((sum, value) => sum + value, 0);
    return {
      value: totalResults > 0 ? totalSpend / totalResults : null,
      present: values.length,
      total: rows.length,
      reason: totalResults > 0 ? null : "Results รวมเป็นศูนย์ จึงคำนวณอัตราไม่ได้",
    };
  }
  if (metric === "cpm") {
    const spend = rows
      .map((row) => row.spend)
      .filter((value): value is number => value !== null);
    const impressions = rows
      .map((row) => row.impressions)
      .filter((value): value is number => value !== null);
    if (spend.length < rows.length || impressions.length < rows.length)
      return {
        value: null,
        present: values.length,
        total: rows.length,
        reason: "Spend หรือ Impressions บางแถวหาย จึงไม่คำนวณ CPM รวม",
      };
    const totalSpend = spend.reduce((sum, value) => sum + value, 0);
    const totalImpressions = impressions.reduce((sum, value) => sum + value, 0);
    return {
      value:
        totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : null,
      present: values.length,
      total: rows.length,
      reason: totalImpressions > 0 ? null : "Impressions รวมเป็นศูนย์",
    };
  }
  if (metric === "roas")
    return {
      value: null,
      present: values.length,
      total: rows.length,
      reason: "ROAS เป็นอัตราราย Ads จึงไม่เฉลี่ยหรือรวมเป็นยอดเดียว",
    };
  if (metric === "results") {
    const resultTypes = new Set(
      rows
        .map((row) => row.result_type)
        .filter((value): value is string => Boolean(value)),
    );
    if (resultTypes.size > 1)
      return {
        value: null,
        present: values.length,
        total: rows.length,
        reason: "Results มีหลายประเภท จึงไม่รวมยอดเข้าด้วยกัน",
      };
  }
  return {
    value: values.reduce((sum, value) => sum + value, 0),
    present: values.length,
    total: rows.length,
    reason: values.length < rows.length ? "บางแถวไม่มีค่าที่อ่านได้" : null,
  };
}

export function sumKnown(rows: ReportRow[], metric: ReportMetric) {
  return aggregateRows(rows, metric);
}

export function buildKpis(rows: ReportRow[]) {
  return {
    ads: rows.length,
    verified: rows.filter((row) => row.identity_state === "verified").length,
    observed: rows.filter((row) => row.identity_state === "observed").length,
    spend: aggregateRows(rows, "spend"),
    results: aggregateRows(rows, "results"),
    impressions: aggregateRows(rows, "impressions"),
    cost_per_result: aggregateRows(rows, "cost_per_result"),
    cpm: aggregateRows(rows, "cpm"),
  };
}

export type CompositionBasis = "count" | "spend" | "results";

export function buildComposition(rows: ReportRow[], basis: CompositionBasis) {
  const groups = new Map<
    Delivery,
    { count: number; spend: number; results: number }
  >();
  for (const row of rows) {
    const group = groups.get(row.delivery) ?? {
      count: 0,
      spend: 0,
      results: 0,
    };
    group.count++;
    group.spend += row.spend ?? 0;
    group.results += row.results ?? 0;
    groups.set(row.delivery, group);
  }
  const segments = [...groups]
    .map(([delivery, values], index) => ({
      key: delivery,
      label: deliveryLabels[delivery],
      value: values[basis],
      count: values.count,
      color: index % 5,
    }))
    .filter((segment) => segment.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const withShare = segments.map((segment) => {
    const share = total ? (segment.value / total) * 100 : 0;
    const item = { ...segment, share, offset };
    offset += share;
    return item;
  });
  return {
    total,
    segments: withShare,
    missingRows:
      basis === "count" ? 0 : rows.filter((row) => row[basis] === null).length,
  };
}

export function quartiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = (p: number) => {
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return lower === upper
      ? sorted[lower]
      : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  return {
    min: sorted[0],
    p25: percentile(0.25),
    median: percentile(0.5),
    p75: percentile(0.75),
    max: sorted.at(-1)!,
  };
}

export function buildHistogram(
  rows: ReportRow[],
  metric: ReportMetric,
  requestedBins = 7,
) {
  const values = rows
    .map((row) => metricValue(row, metric))
    .filter((value): value is number => value !== null);
  if (!values.length)
    return { values: [], bins: [], stats: null, missing: rows.length };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const count = min === max ? 1 : Math.min(requestedBins, values.length);
  const width = min === max ? Math.max(Math.abs(max), 1) : (max - min) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    start: min + width * index,
    end: index === count - 1 ? max : min + width * (index + 1),
    count: 0,
  }));
  for (const value of values) {
    const index =
      min === max ? 0 : Math.min(count - 1, Math.floor((value - min) / width));
    bins[index].count++;
  }
  return {
    values,
    bins,
    stats: quartiles(values),
    missing: rows.length - values.length,
  };
}

export function buildScatter(
  rows: ReportRow[],
  xMetric: ReportMetric,
  yMetric: ReportMetric,
) {
  const points = rows
    .map((row) => ({
      row,
      x: metricValue(row, xMetric),
      y: metricValue(row, yMetric),
    }))
    .filter(
      (
        point,
      ): point is {
        row: ReportRow;
        x: number;
        y: number;
      } => point.x !== null && point.y !== null,
    );
  const xStats = quartiles(points.map((point) => point.x));
  const yStats = quartiles(points.map((point) => point.y));
  return {
    points,
    xStats,
    yStats,
    missing: rows.length - points.length,
    xMax: points.length ? Math.max(...points.map((point) => point.x)) : null,
    yMax: points.length ? Math.max(...points.map((point) => point.y)) : null,
  };
}

export function buildConcentration(rows: ReportRow[]) {
  const sorted = rows
    .filter(
      (row): row is ReportRow & { spend: number; results: number } =>
        row.spend !== null && row.results !== null,
    )
    .sort((a, b) => b.spend - a.spend);
  const totalSpend = sorted.reduce((sum, row) => sum + row.spend, 0);
  const totalResults = sorted.reduce((sum, row) => sum + row.results, 0);
  if (!sorted.length || totalSpend <= 0 || totalResults <= 0)
    return {
      points: [],
      missing: rows.length,
      spend80: null,
      results80: null,
      count: 0,
    };
  let spend = 0;
  let results = 0;
  let spend80: number | null = null;
  let results80: number | null = null;
  const points = [
    {
      index: 0,
      label: "0",
      spendShare: 0,
      resultShare: 0,
    },
  ];
  sorted.forEach((row, index) => {
    spend += row.spend;
    results += row.results;
    const spendShare = (spend / totalSpend) * 100;
    const resultShare = (results / totalResults) * 100;
    if (spend80 === null && spendShare >= 80) spend80 = index + 1;
    if (results80 === null && resultShare >= 80) results80 = index + 1;
    points.push({
      index: index + 1,
      label: row.name ?? row.entity_id ?? `Ads ${index + 1}`,
      spendShare,
      resultShare,
    });
  });
  return {
    points,
    missing: rows.length - sorted.length,
    spend80,
    results80,
    count: sorted.length,
  };
}

export type TrendPoint = {
  date: string;
  records: number;
  spend: number;
  impressions: number;
  results: number | null;
  cost_per_result: number | null;
  cpm: number | null;
};

export function trendValue(point: TrendPoint, metric: ReportMetric) {
  if (metric === "roas") return null;
  return point[metric];
}

export function buildTrendGroups(
  records: AdRecord[],
  requestedAccount?: string,
) {
  const groups = new Map<
    string,
    {
      key: string;
      source: ReturnType<typeof recordSource>;
      currency: string;
      timezone: string;
      attribution: string;
      result_type: string;
      breakdown: Record<string, string>;
      rows: AdRecord[];
    }
  >();
  for (const record of records) {
    if (record.level !== "ad" || record.date_start !== record.date_end)
      continue;
    if (requestedAccount && record.account_id !== requestedAccount) continue;
    const breakdown = Object.fromEntries(
      Object.entries(record.breakdown ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
    const source = recordSource(record);
    const key = JSON.stringify([
      record.account_id,
      source,
      record.currency,
      record.timezone,
      record.attribution,
      record.result_type,
      breakdown,
    ]);
    const group = groups.get(key) ?? {
      key,
      source,
      currency: record.currency,
      timezone: record.timezone,
      attribution: record.attribution,
      result_type: record.result_type,
      breakdown,
      rows: [],
    };
    group.rows.push(record);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const dates = new Map<string, AdRecord[]>();
      for (const row of group.rows)
        dates.set(row.date_end, [...(dates.get(row.date_end) ?? []), row]);
      const points: TrendPoint[] = [...dates]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => {
          const spend = rows.reduce((sum, row) => sum + row.spend, 0);
          const impressions = rows.reduce(
            (sum, row) => sum + row.impressions,
            0,
          );
          const knownResults = rows
            .map((row) => row.results)
            .filter((value): value is number => value !== undefined);
          const results =
            knownResults.length === rows.length
              ? knownResults.reduce((sum, value) => sum + value, 0)
              : null;
          return {
            date,
            records: rows.length,
            spend,
            impressions,
            results,
            cost_per_result:
              results !== null && results > 0 ? spend / results : null,
            cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
          };
        });
      const duplicates =
        group.rows.length -
        new Set(group.rows.map((row) => `${row.ad_id}\u0000${row.date_end}`))
          .size;
      return {
        ...group,
        points,
        duplicate_grains: duplicates,
        date_start: points[0]?.date ?? null,
        date_end: points.at(-1)?.date ?? null,
      };
    })
    .filter((group) => group.points.length >= 2 && group.duplicate_grains === 0)
    .sort(
      (a, b) =>
        (b.date_end ?? "").localeCompare(a.date_end ?? "") ||
        a.source.localeCompare(b.source),
    );
}
