import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnalyzedRow,
  LevelAnalysis,
} from "../packages/core/src/capture-analysis.js";
import type { AdRecord } from "../packages/core/src/index.js";
import {
  aggregateRows,
  buildChartRows,
  buildComposition,
  buildConcentration,
  buildDeliverySummary,
  buildHistogram,
  buildPerformanceRows,
  buildReportRows,
  buildScatter,
  buildScopeBars,
  buildTrendGroups,
} from "../apps/web/lib/report-studio.js";

function row(
  id: string | null,
  name: string,
  spend: number | null,
  results: number | null,
  overrides: Partial<AnalyzedRow> = {},
): AnalyzedRow {
  return {
    key: id ?? name,
    name,
    entity_id: id,
    delivery: id ? "active" : "unknown",
    delivery_text: id ? "ใช้งานอยู่" : "—",
    results,
    result_type: results === null ? null : "Messages",
    cost_per_result:
      spend !== null && results !== null && results > 0
        ? spend / results
        : null,
    impressions: 1000,
    spend,
    spend_source: spend === null ? null : "column",
    cpm: spend === null ? null : spend,
    budget: { amount: null, period: null, uses: null, text: null },
    other: {},
    unpublished_edits: false,
    mapping: id ? "verified" : "unverified",
    occurrences: 1,
    flags: [],
    provenance: [
      {
        captured_at: "2026-11-18T00:00:00Z",
        reader_version: "0.6.41",
        columns: [],
      },
    ],
    ...overrides,
  };
}

function record(
  date: string,
  adId: string,
  spend: number,
  results: number,
  overrides: Partial<AdRecord> = {},
): AdRecord {
  return {
    account_id: "123456789",
    campaign_id: "900",
    campaign_name: "Fixture Campaign",
    ad_set_id: "901",
    ad_set_name: "Fixture Ad Set",
    ad_id: adId,
    ad_name: `Fixture Ad ${adId}`,
    level: "ad",
    date_start: date,
    date_end: date,
    currency: "THB",
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "Messages",
    spend,
    impressions: 1000,
    results,
    raw: { _source_filename: "daily.csv" },
    ...overrides,
  };
}

function level(
  scope: string,
  date: string,
  rows: AnalyzedRow[],
): LevelAnalysis {
  return {
    scope_key: scope,
    level: "ads",
    snapshots: 2,
    observed_rows: rows.length,
    unique_rows: rows.length,
    verified_unique_rows: rows.filter((item) => item.entity_id).length,
    unresolved_observations: rows.filter((item) => !item.entity_id).length,
    spend_quality: "reported",
    blockers: [],
    dedupe: "mixed",
    reported_total_rows: 40,
    reported_total_scope: "report",
    coverage: "lower_bound",
    context: {
      account_id: "123456789",
      breakdown: { age: date },
      filters: {},
      date_range_label: "19 Oct 2026 – 17 Nov 2026",
      date_start: "2026-10-19",
      date_end: "2026-11-17",
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      column_preset_label: null,
    },
    columns: [],
    missing_columns: [],
    rows,
    result_groups: [],
    ranking: {
      basis: "cost_per_result",
      result_type: "Messages",
      min_results: 5,
      median_cost_per_result: null,
      eligible: 0,
      best: [],
      worst: [],
    },
    delivery_counts: {},
    delivery_observation_counts: {},
    performance_excluded_counts: {},
    recommendations: [],
    warnings: [],
  };
}

test("report rows sort by the selected metric and can exclude unresolved observations", () => {
  const fixture = level("age:25-34", "25–34", [
    row("111", "Ad A", 100, 10),
    row("222", "Ad B", 300, 20),
    row(null, "Observed C", null, null),
  ]);
  const all = buildReportRows(fixture, { metric: "spend", order: "desc" });
  assert.deepEqual(
    all.map((item) => item.name),
    ["Ad B", "Ad A", "Observed C"],
  );
  const verified = buildReportRows(fixture, {
    metric: "spend",
    includeObserved: false,
  });
  assert.deepEqual(
    verified.map((item) => item.name),
    ["Ad B", "Ad A"],
  );
  assert.equal(verified[0].metric_value, 300);
  assert.equal(buildChartRows(all).rows[0].width, 100);
});

test("scope bars compare partitions without summing them", () => {
  const first = level("age:18-24", "18–24", [row("111", "Ad A", 100, 10)]);
  const second = level("age:25-34", "25–34", [row("222", "Ad B", 50, 5)]);
  const bars = buildScopeBars([first, second], "spend");
  assert.equal(bars.rows.length, 2);
  assert.equal(bars.rows[0].value, 100);
  assert.equal(bars.rows[1].value, 50);
  assert.equal(bars.rows[0].width, 100);
  assert.equal(bars.rows[1].width, 50);
});

test("delivery summary uses the filtered row set", () => {
  const fixture = level("age:25-34", "25–34", [
    row("111", "Ad A", 100, 10),
    row(null, "Observed C", 10, 1),
  ]);
  const rows = buildReportRows(fixture, { metric: "results" });
  const summary = buildDeliverySummary(rows);
  assert.deepEqual(
    summary.map((item) => [item.delivery, item.count]),
    [
      ["active", 1],
      ["unknown", 1],
    ],
  );
});

test("performance charts exclude billing and disabled Ads while diagnostics stay in the table", () => {
  const fixture = level("age:25-34", "25–34", [
    row("111", "Active", 100, 10),
    row("222", "Disabled", 900, 10, { delivery: "off" }),
    row("333", "Billing", 800, 10, { delivery: "payment_error" }),
  ]);
  const rows = buildReportRows(fixture, { metric: "spend" });
  assert.equal(rows.length, 3);
  assert.deepEqual(
    buildPerformanceRows(rows).map((item) => item.name),
    ["Active"],
  );
  const bars = buildScopeBars([fixture], "spend");
  assert.equal(bars.rows[0].value, 100);
  assert.equal(bars.rows[0].total, 1);
});

test("aggregate cost per result is weighted and refuses mixed result types", () => {
  const rows = [row("111", "A", 100, 10), row("222", "B", 300, 20)];
  const aggregate = aggregateRows(rows, "cost_per_result");
  assert.equal(aggregate.value, 400 / 30);
  const mixed = aggregateRows(
    [
      row("111", "A", 100, 10),
      row("222", "B", 300, 20, { result_type: "Leads" }),
    ],
    "cost_per_result",
  );
  assert.equal(mixed.value, null);
  assert.match(mixed.reason ?? "", /หลายประเภท/);
});

test("histogram and composition use only known values without inventing zeroes", () => {
  const rows = buildReportRows(
    level("age:25-34", "25–34", [
      row("111", "A", 100, 10),
      row("222", "B", 300, 20),
      row(null, "Observed C", null, null),
    ]),
    { metric: "cost_per_result" },
  );
  const histogram = buildHistogram(rows, "cost_per_result", 2);
  assert.equal(histogram.values.length, 2);
  assert.equal(histogram.missing, 1);
  assert.equal(histogram.stats?.median, (10 + 15) / 2);
  const composition = buildComposition(rows, "spend");
  assert.equal(composition.total, 400);
  assert.equal(
    composition.segments.find((item) => item.key === "active")?.share,
    100,
  );
});

test("scatter excludes Ads missing either axis", () => {
  const rows = buildReportRows(
    level("age:25-34", "25–34", [
      row("111", "A", 100, 10),
      row("222", "B", 300, 20),
      row("333", "C", 50, null),
    ]),
    { metric: "spend" },
  );
  const scatter = buildScatter(rows, "spend", "results");
  assert.equal(scatter.points.length, 2);
  assert.equal(scatter.missing, 1);
});

test("concentration curve reports how many Ads reach 80 percent", () => {
  const rows = buildReportRows(
    level("age:25-34", "25–34", [
      row("111", "A", 400, 10),
      row("222", "B", 100, 90),
    ]),
    { metric: "spend" },
  );
  const concentration = buildConcentration(rows);
  assert.equal(concentration.spend80, 1);
  assert.equal(concentration.results80, 2);
  assert.equal(concentration.points.at(-1)?.spendShare, 100);
  assert.equal(concentration.points.at(-1)?.resultShare, 100);
});

test("daily trend groups separate sources and require at least two days", () => {
  const records = [
    record("2026-11-01", "111", 100, 10),
    record("2026-11-02", "111", 120, 12),
    record("2026-11-01", "222", 80, 8, {
      raw: { _source: "dom_capture" },
    }),
  ];
  const groups = buildTrendGroups(records, "123456789");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].source, "csv");
  assert.equal(groups[0].points.length, 2);
  assert.equal(groups[0].points[0].spend, 100);
});
