import assert from "node:assert/strict";
import test from "node:test";
import type {
  AnalyzedRow,
  LevelAnalysis,
} from "../packages/core/src/capture-analysis.js";
import {
  buildOptimizationRecommendations,
  defaultOptimizationPolicy,
} from "../packages/core/src/optimization.js";

function row(
  id: string,
  spend: number,
  results: number,
  delivery: AnalyzedRow["delivery"] = "active",
  budget: number | null = null,
): AnalyzedRow {
  return {
    key: `ad:${id}`,
    name: `Ad ${id}`,
    entity_id: id,
    delivery,
    delivery_text: delivery,
    results,
    result_type: "Messages",
    cost_per_result: spend / results,
    impressions: 10_000,
    spend,
    spend_source: "column",
    cpm: 10,
    budget: {
      amount: budget,
      period: budget ? "daily" : null,
      uses: budget ? "ad_set_budget" : null,
      text: budget ? String(budget) : null,
    },
    other: {},
    unpublished_edits: false,
    mapping: "verified",
    occurrences: 1,
    flags: [],
    provenance: [
      {
        captured_at: "2026-11-18T01:00:00.000Z",
        reader_version: "0.6.47",
        columns: ["Results", "Spend"],
      },
    ],
  };
}

function analysis(rows: AnalyzedRow[]): LevelAnalysis {
  return {
    scope_key: "fixture-scope",
    level: "ads",
    snapshots: 1,
    observed_rows: rows.length,
    unique_rows: rows.length,
    verified_unique_rows: rows.length,
    unresolved_observations: 0,
    spend_quality: "reported",
    blockers: [],
    dedupe: "id",
    reported_total_rows: rows.length,
    reported_total_scope: "partition",
    coverage: "complete",
    context: {
      account_id: "123456789",
      breakdown: {},
      filters: [],
      date_range_label: "1 พ.ย. 2026 – 17 พ.ย. 2026",
      date_start: "2026-11-01",
      date_end: "2026-11-17",
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      column_preset_label: "Fixture",
    },
    columns: ["Results", "Spend", "Cost per result"],
    missing_columns: [],
    rows,
    result_groups: [
      {
        result_type: "Messages",
        rows: rows.length,
        results: rows.reduce((sum, item) => sum + (item.results ?? 0), 0),
        spend: rows.reduce((sum, item) => sum + (item.spend ?? 0), 0),
        spend_basis: "column",
        cost_per_result: 10,
        impressions: 30_000,
      },
    ],
    ranking: {
      basis: "cost_per_result",
      result_type: "Messages",
      min_results: 5,
      median_cost_per_result: 10,
      eligible: rows.length,
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

test("optimization policy creates evidence-based scale, test and pause candidates", () => {
  const result = buildOptimizationRecommendations(
    analysis([
      row("101", 50, 10, "active", 500),
      row("102", 100, 10, "off", null),
      row("103", 200, 10, "active", 700),
      row("104", 120, 10, "active"),
    ]),
    defaultOptimizationPolicy,
  );
  assert.equal(result.eligible_scope, true);
  assert.equal(result.peers, 3);
  assert.equal(result.median_cost_per_result, 12);
  assert.deepEqual(
    result.recommendations.map((item) => [item.entity_id, item.action]),
    [
      ["103", "pause_candidate"],
      ["101", "scale_budget"],
      ["104", "create_new_test"],
    ],
  );
  assert.ok(
    result.recommendations.every((item) => item.entity_id !== "102"),
    "disabled Ads are diagnostics and must not influence peers or recommendations",
  );
  assert.ok(result.recommendations.every((item) => item.confidence > 0.5));
  assert.equal(result.recommendations[0].risk, "medium");
});

test("payment and disabled delivery states are excluded from optimization evaluation", () => {
  const result = buildOptimizationRecommendations(
    analysis([
      row("501", 50, 10, "active"),
      row("502", 100, 10, "active"),
      row("503", 150, 10, "active"),
      row("504", 1, 10, "payment_error"),
      row("505", 2, 10, "off"),
      row("506", 3, 10, "parent_off"),
    ]),
    defaultOptimizationPolicy,
  );
  assert.equal(result.eligible_scope, true);
  assert.equal(result.peers, 3);
  assert.equal(result.median_cost_per_result, 10);
  assert.deepEqual(
    new Set(result.recommendations.map((item) => item.entity_id)),
    new Set(["501", "502", "503"]),
  );
});

test("optimization fails closed for partial coverage or insufficient peers", () => {
  const partial = analysis([row("201", 50, 10), row("202", 100, 10)]);
  partial.coverage = "partial";
  partial.blockers = ["timezone_unverified"];
  const result = buildOptimizationRecommendations(partial);
  assert.equal(result.eligible_scope, false);
  assert.equal(result.recommendations.length, 0);
  assert.ok(result.warnings.some((warning) => /coverage/i.test(warning)));

  const insufficient = buildOptimizationRecommendations(
    analysis([row("301", 50, 10), row("302", 100, 10)]),
  );
  assert.equal(insufficient.eligible_scope, false);
  assert.equal(insufficient.recommendations.length, 0);
});

test("missing results or non-column spend never produce recommendations", () => {
  const missing = row("401", 50, 10);
  missing.results = null;
  missing.cost_per_result = null;
  const estimated = row("402", 50, 10);
  estimated.spend_source = "estimate_results_x_cost_per_result";
  const result = buildOptimizationRecommendations(
    analysis([missing, estimated, row("403", 50, 10)]),
  );
  assert.equal(result.eligible_scope, false);
  assert.equal(result.peers, 1);
  assert.equal(result.recommendations.length, 0);
});
