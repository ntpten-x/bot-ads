import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnalyzedRow,
  LevelAnalysis,
} from "../packages/core/src/capture-analysis.js";
import type { AdRecord } from "../packages/core/src/index.js";
import {
  buildChartRows,
  buildConcentration,
  buildHistogram,
  buildReportRows,
  buildScatter,
  buildTrendGroups,
} from "../apps/web/lib/report-studio.js";

function row(index: number): AnalyzedRow {
  const spend = 50 + (index % 17) * 20;
  const results = 2 + (index % 11);
  return {
    key: String(index),
    name: `Scale Ad ${index}`,
    entity_id: String(100000 + index),
    delivery: index % 5 === 0 ? "off" : "active",
    delivery_text: index % 5 === 0 ? "ปิด" : "ใช้งานอยู่",
    results,
    result_type: "Messages",
    cost_per_result: spend / results,
    impressions: 1000 + index * 13,
    spend,
    spend_source: "column",
    cpm: spend,
    budget: { amount: null, period: null, uses: null, text: null },
    other: { roas: 1 + (index % 7) / 10 },
    unpublished_edits: false,
    mapping: "verified",
    occurrences: 1,
    flags: [],
    provenance: [],
  };
}

test("report transforms remain bounded with 500 Ads", () => {
  const level = {
    scope_key: "scale",
    level: "ads",
    rows: Array.from({ length: 500 }, (_, index) => row(index)),
    context: {
      account_id: "123456789",
      breakdown: {},
      filters: [],
      date_range_label: null,
      date_start: "2026-11-01",
      date_end: "2026-11-30",
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      column_preset_label: null,
    },
  } as unknown as LevelAnalysis;
  const rows = buildReportRows(level, {
    metric: "cost_per_result",
    includeObserved: false,
  });
  assert.equal(rows.length, 500);
  assert.equal(buildChartRows(rows).rows.length, 12);
  assert.equal(buildHistogram(rows, "cost_per_result").values.length, 500);
  assert.equal(buildScatter(rows, "spend", "results").points.length, 500);
  assert.equal(buildConcentration(rows).count, 500);
});

test("daily trend aggregation remains bounded to one point per day", () => {
  const records: AdRecord[] = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1))
      .toISOString()
      .slice(0, 10);
    return {
      account_id: "123456789",
      campaign_id: "900",
      campaign_name: "Scale campaign",
      ad_set_id: "901",
      ad_set_name: "Scale ad set",
      ad_id: "777",
      ad_name: "Scale Ad",
      level: "ad",
      date_start: date,
      date_end: date,
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      result_type: "Messages",
      spend: 100,
      impressions: 1000,
      results: 10,
      raw: { _source_filename: "scale.csv" },
    };
  });
  const groups = buildTrendGroups(records, "123456789");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].points.length, 365);
});
