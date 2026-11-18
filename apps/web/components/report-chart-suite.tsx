"use client";

import type { Delivery } from "../../../packages/core/src/capture-analysis";
import {
  deliveryLabels,
  reportMetrics,
  type CompositionBasis,
  type ReportMetric,
  type ReportRow,
  type TrendPoint,
  trendValue,
} from "../lib/report-studio";
import { number } from "../lib/utils";

function money(value: number, currency: string | null) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: currency ?? "THB",
    maximumFractionDigits: 2,
  }).format(value);
}

export function metricText(
  value: number | null,
  metric: ReportMetric,
  currency: string | null,
) {
  if (value === null) return "—";
  return reportMetrics[metric].kind === "money"
    ? money(value, currency)
    : number(value);
}

function compactMetric(
  value: number,
  metric: ReportMetric,
  currency: string | null,
) {
  const text = metricText(value, metric, currency);
  return text.length > 13
    ? new Intl.NumberFormat("th-TH", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : text;
}

type Aggregate = {
  value: number | null;
  present: number;
  total: number;
  reason: string | null;
};

export function KpiRibbon({
  ads,
  verified,
  observed,
  spend,
  results,
  impressions,
  costPerResult,
  cpm,
  currency,
  targetCostPerResult,
}: {
  ads: number;
  verified: number;
  observed: number;
  spend: Aggregate;
  results: Aggregate;
  impressions: Aggregate;
  costPerResult: Aggregate;
  cpm: Aggregate;
  currency: string | null;
  targetCostPerResult: number | null;
}) {
  const items = [
    {
      label: "Ads ในมุมมอง",
      value: number(ads),
      note: `${number(verified)} ยืนยัน ID · ${number(observed)} observed`,
      compact: false,
    },
    {
      label: "Spend ที่อ่านได้",
      value: metricText(spend.value, "spend", currency),
      note:
        spend.present < spend.total
          ? `${spend.present}/${spend.total} แถวมีค่า`
          : "ค่าจากคอลัมน์หรือแหล่งที่ติดป้าย",
      compact: false,
    },
    {
      label: "Results",
      value: metricText(results.value, "results", currency),
      note:
        results.reason ??
        (results.present < results.total
          ? `${results.present}/${results.total} แถวมีค่า`
          : "รวมภายในชุดผลลัพธ์เดียว"),
      compact: false,
    },
    {
      label: "Cost / result",
      value: metricText(costPerResult.value, "cost_per_result", currency),
      note:
        targetCostPerResult !== null
          ? `เป้าหมาย ${metricText(targetCostPerResult, "cost_per_result", currency)}`
          : (costPerResult.reason ?? "คำนวณจากผลรวม Spend ÷ Results"),
      compact: false,
    },
    {
      label: "Impressions",
      value: metricText(impressions.value, "impressions", currency),
      note:
        impressions.present < impressions.total
          ? `${impressions.present}/${impressions.total} แถวมีค่า`
          : "รวมภายใน scope เดียว",
      compact: false,
    },
    {
      label: "CPM",
      value: metricText(cpm.value, "cpm", currency),
      note: cpm.reason ?? "Spend ÷ Impressions × 1,000",
      compact: false,
    },
  ];
  return (
    <section className="report-kpis" aria-label="ตัวชี้วัดหลักของ scope">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.note}</small>
        </div>
      ))}
    </section>
  );
}

export function MetricBars({
  rows,
  metric,
  currency,
  max,
  target,
}: {
  rows: { row: ReportRow; width: number }[];
  metric: ReportMetric;
  currency: string | null;
  max: number | null;
  target: number | null;
}) {
  if (!rows.length)
    return (
      <p className="report-chart-empty">
        ไม่มีค่า {reportMetrics[metric].label} ตามตัวกรองนี้
      </p>
    );
  return (
    <>
      <div
        className="report-bars"
        role="img"
        aria-label={`กราฟแท่งเปรียบเทียบ ${reportMetrics[metric].label} ของ ${rows.length} โฆษณา`}
      >
        {rows.map(({ row, width }) => {
          const targetLeft =
            target !== null && max !== null && max > 0
              ? Math.min(100, (target / max) * 100)
              : null;
          return (
            <div className="report-bar-row" key={row.key}>
              <div className="report-bar-label">
                <strong>{row.name ?? "โฆษณาไม่มีชื่อ"}</strong>
                <span>
                  {row.entity_id ?? "ไม่มี ID"} · {deliveryLabels[row.delivery]}
                </span>
              </div>
              <div className="report-bar-track">
                <span
                  className="report-bar-fill"
                  style={{ width: `${width}%` }}
                />
                {targetLeft !== null ? (
                  <span
                    className="report-target-marker"
                    style={{ left: `${targetLeft}%` }}
                    title={`เป้าหมาย ${metricText(target, metric, currency)}`}
                  />
                ) : null}
              </div>
              <div className="report-bar-value">
                {metricText(row.metric_value, metric, currency)}
                <span>
                  {row.results !== null
                    ? `${number(row.results)} ผลลัพธ์`
                    : "ไม่ทราบผลลัพธ์"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {target !== null ? (
        <p className="report-target-note">
          เส้นเป้าหมายที่ผู้ใช้กำหนด: {metricText(target, metric, currency)}
          {max !== null && target > max ? " · เป้าอยู่เหนือค่าสูงสุดในกราฟ" : ""}
        </p>
      ) : null}
    </>
  );
}

export function CompositionDonut({
  segments,
  total,
  basis,
  currency,
}: {
  segments: {
    key: Delivery;
    label: string;
    value: number;
    count: number;
    color: number;
    share: number;
    offset: number;
  }[];
  total: number;
  basis: CompositionBasis;
  currency: string | null;
}) {
  const circumference = 2 * Math.PI * 63;
  const basisLabel =
    basis === "count" ? "จำนวน Ads" : basis === "spend" ? "Spend" : "Results";
  return (
    <div className="composition-layout">
      {segments.length ? (
        <svg
          className="composition-donut"
          viewBox="0 0 180 180"
          role="img"
          aria-label={`สัดส่วน ${basisLabel} ตามสถานะการนำส่ง`}
        >
          <circle className="donut-track" cx="90" cy="90" r="63" />
          {segments.map((segment) => (
            <circle
              key={segment.key}
              className={`donut-segment segment-${segment.color}`}
              cx="90"
              cy="90"
              r="63"
              pathLength="100"
              strokeDasharray={`${segment.share} ${100 - segment.share}`}
              strokeDashoffset={-segment.offset}
              transform="rotate(-90 90 90)"
            >
              <title>{`${segment.label}: ${segment.share.toFixed(1)}%`}</title>
            </circle>
          ))}
          <text x="90" y="84" textAnchor="middle" className="donut-label">
            {basis === "count"
              ? number(total)
              : metricText(
                  total,
                  basis === "spend" ? "spend" : "results",
                  currency,
                )}
          </text>
          <text x="90" y="102" textAnchor="middle" className="donut-caption">
            {basis === "count"
              ? "Ads"
              : basis === "spend"
                ? "Spend"
                : "Results"}
          </text>
        </svg>
      ) : (
        <p className="report-chart-empty">ไม่มีค่าสำหรับสร้างสัดส่วน</p>
      )}
      <dl className="composition-legend">
        {segments.map((segment) => (
          <div key={segment.key}>
            <dt>
              <span className={`legend-dot segment-${segment.color}`} />
              {segment.label}
            </dt>
            <dd>
              <strong>{segment.share.toFixed(1)}%</strong>
              <small>
                {number(segment.count)} Ads ·{" "}
                {basis === "count"
                  ? `${number(segment.value)} รายการ`
                  : metricText(
                      segment.value,
                      basis === "spend" ? "spend" : "results",
                      currency,
                    )}
              </small>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ScatterPlot({
  points,
  xMetric,
  yMetric,
  xMax,
  yMax,
  xMedian,
  yMedian,
  missing,
  currency,
}: {
  points: { row: ReportRow; x: number; y: number }[];
  xMetric: ReportMetric;
  yMetric: ReportMetric;
  xMax: number | null;
  yMax: number | null;
  xMedian: number | null;
  yMedian: number | null;
  missing: number;
  currency: string | null;
}) {
  if (!points.length || xMax === null || yMax === null)
    return (
      <p className="report-chart-empty">
        ต้องมีค่า {reportMetrics[xMetric].label} และ {reportMetrics[yMetric].label}{" "}
        ใน Ads เดียวกันก่อนจึงจะวาดความสัมพันธ์ได้
      </p>
    );
  const width = 720;
  const height = 410;
  const left = 62;
  const right = 24;
  const top = 24;
  const bottom = 50;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxBubble = Math.max(
    ...points.map((point) => point.row.impressions ?? 0),
  );
  const x = (value: number) => left + (value / Math.max(xMax, 1)) * plotWidth;
  const y = (value: number) =>
    top + plotHeight - (value / Math.max(yMax, 1)) * plotHeight;
  return (
    <div className="scatter-wrap">
      <svg
        className="relationship-scatter"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`กราฟจุดความสัมพันธ์ระหว่าง ${reportMetrics[xMetric].label} และ ${reportMetrics[yMetric].label} ของ ${points.length} Ads`}
      >
        {[0, 25, 50, 75, 100].map((step) => {
          const gy = top + plotHeight - (step / 100) * plotHeight;
          const gx = left + (step / 100) * plotWidth;
          return (
            <g key={step}>
              <line
                className="chart-grid-line"
                x1={left}
                x2={left + plotWidth}
                y1={gy}
                y2={gy}
              />
              <line
                className="chart-grid-line"
                x1={gx}
                x2={gx}
                y1={top}
                y2={top + plotHeight}
              />
            </g>
          );
        })}
        {xMedian !== null ? (
          <line
            className="chart-median-line"
            x1={x(xMedian)}
            x2={x(xMedian)}
            y1={top}
            y2={top + plotHeight}
          />
        ) : null}
        {yMedian !== null ? (
          <line
            className="chart-median-line"
            x1={left}
            x2={left + plotWidth}
            y1={y(yMedian)}
            y2={y(yMedian)}
          />
        ) : null}
        {points.map((point) => {
          const radius =
            maxBubble > 0 && point.row.impressions
              ? 5 + Math.sqrt(point.row.impressions / maxBubble) * 7
              : 5;
          return (
            <circle
              key={point.row.key}
              className={
                point.row.identity_state === "verified"
                  ? "scatter-point verified"
                  : "scatter-point observed"
              }
              cx={x(point.x)}
              cy={y(point.y)}
              r={radius}
            >
              <title>
                {`${point.row.name ?? point.row.entity_id ?? "Ads"} · ${reportMetrics[xMetric].label}: ${metricText(point.x, xMetric, currency)} · ${reportMetrics[yMetric].label}: ${metricText(point.y, yMetric, currency)}`}
              </title>
            </circle>
          );
        })}
        <text x={left} y={height - 14} className="chart-axis-label">
          {reportMetrics[xMetric].label} →
        </text>
        <text
          x={14}
          y={top + plotHeight / 2}
          transform={`rotate(-90 14 ${top + plotHeight / 2})`}
          textAnchor="middle"
          className="chart-axis-label"
        >
          {reportMetrics[yMetric].label} →
        </text>
        <text
          x={left + plotWidth}
          y={height - 14}
          textAnchor="end"
          className="chart-axis-max"
        >
          {compactMetric(xMax, xMetric, currency)}
        </text>
        <text
          x={left - 8}
          y={top + 5}
          textAnchor="end"
          className="chart-axis-max"
        >
          {compactMetric(yMax, yMetric, currency)}
        </text>
      </svg>
      <div className="scatter-legend">
        <span>
          <i className="scatter-dot verified" /> ID + mapping ยืนยัน
        </span>
        <span>
          <i className="scatter-dot observed" /> observation รอตรวจ
        </span>
        <span>ขนาดวงกลม = Impressions</span>
        {missing ? <span>{missing} Ads ไม่มีค่าครบทั้งสองแกน</span> : null}
      </div>
      <p className="report-axis-note">
        เส้นประคือ median ของแต่ละแกน ใช้เพื่อแบ่งกลุ่มดูค่าสูง/ต่ำ ไม่ได้พิสูจน์สาเหตุหรือความคุ้มทุน
      </p>
    </div>
  );
}

export function DistributionHistogram({
  bins,
  stats,
  metric,
  missing,
  currency,
}: {
  bins: { start: number; end: number; count: number }[];
  stats: {
    min: number;
    p25: number;
    median: number;
    p75: number;
    max: number;
  } | null;
  metric: ReportMetric;
  missing: number;
  currency: string | null;
}) {
  if (!bins.length || !stats)
    return (
      <p className="report-chart-empty">
        ยังไม่มีค่า {reportMetrics[metric].label} สำหรับดูการกระจาย
      </p>
    );
  const max = Math.max(...bins.map((bin) => bin.count));
  return (
    <div className="histogram-wrap">
      <div
        className="histogram-bars"
        role="img"
        aria-label={`ฮิสโตแกรมการกระจาย ${reportMetrics[metric].label}`}
      >
        {bins.map((bin, index) => (
          <div className="histogram-bin" key={`${bin.start}-${index}`}>
            <span className="histogram-count">{bin.count}</span>
            <i style={{ height: `${max ? (bin.count / max) * 100 : 0}%` }} />
            <small>
              {compactMetric(bin.start, metric, currency)}
              {index === bins.length - 1
                ? `–${compactMetric(bin.end, metric, currency)}`
                : ""}
            </small>
          </div>
        ))}
      </div>
      <dl className="quartile-strip">
        {[
          ["ต่ำสุด", stats.min],
          ["P25", stats.p25],
          ["Median", stats.median],
          ["P75", stats.p75],
          ["สูงสุด", stats.max],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{metricText(value as number, metric, currency)}</dd>
          </div>
        ))}
      </dl>
      <p className="report-axis-note">
        Median และ quartile เป็นค่าพรรณนาจาก Ads ในมุมมองนี้เท่านั้น
        {missing ? ` · ${missing} Ads ไม่มีค่าที่เลือก` : ""}
      </p>
    </div>
  );
}

export function ConcentrationCurve({
  points,
  spend80,
  results80,
  count,
  missing,
}: {
  points: {
    index: number;
    label: string;
    spendShare: number;
    resultShare: number;
  }[];
  spend80: number | null;
  results80: number | null;
  count: number;
  missing: number;
}) {
  if (points.length < 2 || !count)
    return (
      <p className="report-chart-empty">
        ต้องมี Spend และ Results อย่างน้อยหนึ่ง Ads เพื่อวาดเส้นสะสม
      </p>
    );
  const width = 720;
  const height = 390;
  const left = 54;
  const right = 24;
  const top = 22;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + (index / count) * plotWidth;
  const y = (share: number) => top + plotHeight - (share / 100) * plotHeight;
  const path = (key: "spendShare" | "resultShare") =>
    points
      .map(
        (point, index) =>
          `${index ? "L" : "M"} ${x(point.index).toFixed(1)} ${y(point[key]).toFixed(1)}`,
      )
      .join(" ");
  return (
    <div className="concentration-wrap">
      <svg
        className="concentration-line"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`กราฟเส้นสะสม Spend และ Results ของ ${count} Ads เรียงตาม Spend จากมากไปน้อย`}
      >
        {[0, 25, 50, 75, 80, 100].map((step) => (
          <g key={step}>
            <line
              className={
                step === 80 ? "chart-threshold-line" : "chart-grid-line"
              }
              x1={left}
              x2={left + plotWidth}
              y1={y(step)}
              y2={y(step)}
            />
            <text
              x={left - 8}
              y={y(step) + 4}
              textAnchor="end"
              className="chart-axis-tick"
            >
              {step}%
            </text>
          </g>
        ))}
        <path className="concentration-line-spend" d={path("spendShare")} />
        <path className="concentration-line-results" d={path("resultShare")} />
        <text x={left} y={height - 14} className="chart-axis-label">
          Ads เรียงตาม Spend
        </text>
        <text
          x={left + plotWidth}
          y={height - 14}
          textAnchor="end"
          className="chart-axis-max"
        >
          {count}
        </text>
      </svg>
      <div className="concentration-legend">
        <span>
          <i className="line-key spend" /> Spend สะสม
        </span>
        <span>
          <i className="line-key results" /> Results สะสม
        </span>
      </div>
      <dl className="concentration-facts">
        <div>
          <dt>Ads ที่ใช้จนถึง 80% ของ Spend</dt>
          <dd>
            {spend80 ?? "—"} จาก {count}
          </dd>
        </div>
        <div>
          <dt>Ads ที่ใช้จนถึง 80% ของ Results</dt>
          <dd>
            {results80 ?? "—"} จาก {count}
          </dd>
        </div>
      </dl>
      <p className="report-axis-note">
        เส้นยิ่งชันหมายถึงผลรวมกระจุกตัวใน Ads จำนวนน้อยลง
        {missing ? ` · ${missing} Ads ไม่มี Spend/Results ครบทั้งคู่` : ""}
      </p>
    </div>
  );
}

export function TrendLineChart({
  points,
  metric,
  currency,
}: {
  points: TrendPoint[];
  metric: ReportMetric;
  currency: string | null;
}) {
  const values = points
    .map((point) => trendValue(point, metric))
    .filter((value): value is number => value !== null);
  if (points.length < 2 || !values.length)
    return (
      <p className="report-chart-empty">
        ต้องมีข้อมูลรายวันอย่างน้อยสองวันที่มีค่า {reportMetrics[metric].label}
      </p>
    );
  const width = 760;
  const height = 360;
  const left = 58;
  const right = 24;
  const top = 25;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const low =
    min > 0 && min < max * 0.2 ? 0 : Math.max(0, min - (max - min) * 0.15);
  const times = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const x = (index: number) =>
    left +
    (maxTime === minTime
      ? 0
      : ((times[index] - minTime) / (maxTime - minTime)) * plotWidth);
  const y = (value: number) =>
    top + plotHeight - ((value - low) / Math.max(max - low, 1)) * plotHeight;
  const plotted = points
    .map((point, index) => {
      const value = trendValue(point, metric);
      return value === null ? null : { point, index, value };
    })
    .filter(
      (
        item,
      ): item is {
        point: TrendPoint;
        index: number;
        value: number;
      } => item !== null,
    );
  const pathSegments: string[] = [];
  let currentSegment: string[] = [];
  plotted.forEach((item, index) => {
    const previous = plotted[index - 1];
    const day = times[item.index] / 86_400_000;
    const priorDay = previous ? times[previous.index] / 86_400_000 : null;
    if (
      previous &&
      (item.index !== previous.index + 1 ||
        priorDay === null ||
        day - priorDay > 1)
    ) {
      if (currentSegment.length) pathSegments.push(currentSegment.join(" "));
      currentSegment = [];
    }
    currentSegment.push(
      `${currentSegment.length ? "L" : "M"} ${x(item.index).toFixed(1)} ${y(item.value).toFixed(1)}`,
    );
  });
  if (currentSegment.length) pathSegments.push(currentSegment.join(" "));
  const tickIndexes = [
    ...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  ];
  return (
    <div className="trend-line-wrap">
      <svg
        className="trend-line"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`กราฟเส้นแนวโน้ม ${reportMetrics[metric].label} รายวัน จำนวน ${points.length} วัน`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const value = low + (max - low) * step;
          return (
            <g key={step}>
              <line
                className="chart-grid-line"
                x1={left}
                x2={left + plotWidth}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                x={left - 8}
                y={y(value) + 4}
                textAnchor="end"
                className="chart-axis-tick"
              >
                {compactMetric(value, metric, currency)}
              </text>
            </g>
          );
        })}
        {pathSegments.map((path, index) => (
          <path className="trend-line-path" d={path} key={index} />
        ))}
        {plotted.map((item) => (
          <circle
            className="trend-point"
            key={`${item.point.date}-${item.index}`}
            cx={x(item.index)}
            cy={y(item.value)}
            r="4.5"
          >
            <title>{`${item.point.date}: ${metricText(item.value, metric, currency)}`}</title>
          </circle>
        ))}
        {tickIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={height - 16}
            textAnchor={
              index === 0
                ? "start"
                : index === points.length - 1
                  ? "end"
                  : "middle"
            }
            className="chart-axis-tick"
          >
            {points[index].date.slice(5)}
          </text>
        ))}
      </svg>
      <p className="report-axis-note">
        ข้อมูลนี้มาจาก normalized daily observations ของแหล่งเดียว ไม่ได้ผสมกับ period
        aggregate จาก DOM capture
      </p>
    </div>
  );
}
