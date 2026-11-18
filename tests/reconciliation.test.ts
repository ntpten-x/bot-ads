import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnalyzedRow,
  LevelAnalysis,
} from "../packages/core/src/capture-analysis.js";
import type { AdRecord } from "../packages/core/src/index.js";
import { reconcileDomWithCsv } from "../packages/core/src/reconciliation.js";

function domRow(id: string, spend: number, results: number): AnalyzedRow {
  return {
    key: id,
    name: `Ad ${id}`,
    entity_id: id,
    delivery: "active",
    delivery_text: "ใช้งานอยู่",
    results,
    result_type: "Messages",
    cost_per_result: spend / results,
    impressions: 1000,
    spend,
    spend_source: "column",
    cpm: spend,
    budget: { amount: null, period: null, uses: null, text: null },
    other: {},
    unpublished_edits: false,
    mapping: "verified",
    occurrences: 1,
    flags: [],
    provenance: [],
  };
}

function csvRow(
  id: string,
  spend: number,
  results: number,
  overrides: Partial<AdRecord> = {},
): AdRecord {
  return {
    account_id: "123456789",
    campaign_id: "900",
    campaign_name: "Campaign",
    ad_set_id: "901",
    ad_set_name: "Ad Set",
    ad_id: id,
    ad_name: `Ad ${id}`,
    level: "ad",
    date_start: "2026-11-01",
    date_end: "2026-11-01",
    currency: "THB",
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "Messages",
    spend,
    impressions: 1000,
    results,
    raw: {
      _source_filename: "meta.csv",
      _import_reconciliation: "{}",
    },
    ...overrides,
  };
}

const level = {
  scope_key: "scope",
  level: "ads",
  rows: [domRow("111", 100, 10), domRow("222", 200, 20)],
  context: {
    account_id: "123456789",
    date_start: "2026-11-01",
    date_end: "2026-11-01",
    currency: "THB",
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "Messages",
    breakdown: {},
    filters: {},
    date_range_label: null,
    column_preset_label: null,
  },
} as unknown as LevelAnalysis;

test("DOM and CSV reconcile only within the same context", () => {
  const result = reconcileDomWithCsv(level, [
    csvRow("111", 100, 10),
    csvRow("222", 200, 20),
    csvRow("333", 300, 30, {
      attribution: "1-day view",
    }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "matched");
  assert.equal(result[0].matched_ids, 2);
  assert.deepEqual(result[0].dom_only_ids, []);
  assert.deepEqual(result[0].csv_only_ids, []);
  assert.equal(result[0].metrics.spend.delta, 0);
});

test("ID or metric differences remain visible and never alter either source", () => {
  const result = reconcileDomWithCsv(level, [
    csvRow("111", 101, 10),
    csvRow("333", 200, 20),
  ]);
  assert.equal(result[0].status, "mismatch");
  assert.equal(result[0].matched_ids, 1);
  assert.deepEqual(result[0].dom_only_ids, ["222"]);
  assert.deepEqual(result[0].csv_only_ids, ["333"]);
  assert.equal(result[0].metrics.spend.delta, 1);
});
