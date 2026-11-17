import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReport, type ImportInput } from "../packages/core/src/index.js";
import { buildAnalysis } from "../packages/core/src/analysis.js";
import { buildCaptureReview } from "../packages/core/src/capture-review.js";
const input: ImportInput = {
  filename: "analysis.csv",
  csv: readFileSync("samples/analysis-template.csv", "utf8"),
  expected_account_id: "123456789",
  context: {
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "messaging_conversations",
  },
  expected: { rows: 1, spend: 200 },
};
const record = () => {
  const r = parseReport(input);
  assert.equal(r.valid, true, r.errors.join("\n"));
  return r.records[0];
};

test("import reconciliation verifies only the file scope and exposes mismatches", () => {
  const verified = parseReport(input);
  assert.equal(verified.valid, true, verified.errors.join("\n"));
  assert.equal(verified.coverage, "unverified");
  assert.equal(verified.scope_coverage, "verified_for_import");
  assert.equal(verified.reconciliation.status, "verified_for_import");
  assert.equal(verified.reconciliation.verified, true);
  assert.deepEqual(verified.reconciliation.rows, {
    expected: 1,
    actual: 1,
    delta: 0,
    matched: true,
  });
  assert.deepEqual(verified.reconciliation.spend, {
    expected: 200,
    actual: 200,
    delta: 0,
    matched: true,
  });

  const wrongRows = parseReport({
    ...input,
    expected: { rows: 2, spend: 200 },
  });
  assert.equal(wrongRows.valid, false);
  assert.equal(wrongRows.scope_coverage, "unverified");
  assert.equal(wrongRows.reconciliation.status, "mismatch");
  assert.deepEqual(wrongRows.reconciliation.mismatches, ["rows"]);
  assert.equal(wrongRows.reconciliation.rows.delta, -1);

  const wrongSpend = parseReport({
    ...input,
    expected: { rows: 1, spend: 201 },
  });
  assert.equal(wrongSpend.valid, false);
  assert.equal(wrongSpend.reconciliation.status, "mismatch");
  assert.deepEqual(wrongSpend.reconciliation.mismatches, ["spend"]);
  assert.ok(Math.abs(wrongSpend.reconciliation.spend.delta! + 1) < 0.005);

  const wrongInterval = parseReport({
    ...input,
    expected: { rows: 1, spend: 200, date_start: "2026-11-02" },
  });
  assert.equal(wrongInterval.valid, false);
  assert.deepEqual(wrongInterval.reconciliation.mismatches, ["interval"]);
  assert.equal(wrongInterval.reconciliation.interval.matched, false);

  const incomplete = parseReport({ ...input, expected: {} });
  assert.equal(incomplete.valid, true);
  assert.equal(incomplete.reconciliation.status, "incomplete");
  assert.equal(incomplete.reconciliation.verified, false);
  assert.deepEqual(incomplete.reconciliation.unchecked_inputs, [
    "rows",
    "spend",
    "interval",
  ]);
  assert.ok(
    incomplete.warnings.includes(
      "Source reconciliation is incomplete: supply expected row count and spend.",
    ),
  );
});

test("analysis separates CSV and DOM scopes and never sums across sources", () => {
  const csv = record();
  const dom = {
    ...csv,
    breakdown: {},
    raw: {
      _source: "dom_capture",
      _source_page: "/adsmanager/manage/ads",
      _dom_scope_version: "1",
      _dom_scope_filters: "[]",
      _dom_scope_breakdown: "{}",
      _dom_identity_source: "row_link_href",
    },
  };
  const report = buildAnalysis([csv, dom]);
  assert.deepEqual(report.source_mix, { csv: 1, dom_capture: 1, unknown: 0 });
  assert.equal(report.groups.length, 2);
  assert.deepEqual(
    report.groups.map((group) => group.source),
    ["csv", "dom_capture"],
  );
  assert.deepEqual(
    report.groups.map((group) => group.totals.spend),
    [200, 200],
  );
  assert.ok(report.rows.every((row) => !row.missing.includes("duplicate_grain")));
  assert.ok(
    report.warnings.some((warning) => warning.includes("ไม่บวกยอดข้ามแหล่ง")),
  );

  const validation = parseReport(input);
  const scoped = buildAnalysis([csv], "messages", {
    coverage: validation.scope_coverage,
    reconciliation: validation.reconciliation,
  });
  assert.equal(scoped.coverage, "unverified");
  assert.equal(scoped.scope_coverage, "verified_for_import");
  assert.equal(scoped.reconciliation?.verified, true);

  const stamped = {
    ...csv,
    raw: {
      ...csv.raw,
      _import_reconciliation: JSON.stringify({
        version: 1,
        filename: csv.raw._source_filename,
        reconciliation: validation.reconciliation,
      }),
    },
  };
  const persisted = buildAnalysis([stamped]);
  assert.equal(persisted.verified_import_rows, 1);
  assert.equal(
    persisted.rows[0].import_reconciliation,
    "verified_for_import",
  );
  const tampered = buildAnalysis([
    {
      ...stamped,
      raw: { ...stamped.raw, _source_filename: "different.csv" },
    },
  ]);
  assert.equal(tampered.verified_import_rows, 0);
  assert.equal(tampered.rows[0].import_reconciliation, "unverified");
  assert.equal(dom.raw._source, "dom_capture");
  assert.equal(
    buildAnalysis([dom]).rows[0].import_reconciliation,
    "not_applicable",
  );
});

test("legacy DOM records lacking verified scope metadata cannot guide normalized evaluations or totals", () => {
  const legacy = ["331", "332", "333"].map((ad_id) => ({
    ...record(),
    ad_id,
    raw: { ...record().raw, _source: "dom_capture" },
  }));
  const report = buildAnalysis(legacy);
  assert.equal(report.summary.ready_rows, 0);
  assert.ok(
    report.rows.every(
      (r) =>
        r.evaluation.status === "blocked" &&
        r.missing.includes("dom_scope_unverified"),
    ),
  );
  assert.equal(report.groups[0].totals.spend, null);
  assert.equal(report.groups[0].totals.conversions, null);
});

test("normalized DOM scope metadata must match preserved breakdown and explicit no-filter proof", () => {
  const trusted = ["331", "332", "333"].map((ad_id) => ({
    ...record(),
    ad_id,
    breakdown: {},
    raw: {
      ...record().raw,
      _source: "dom_capture",
      _dom_scope_version: "1",
      _dom_scope_filters: "[]",
      _dom_scope_breakdown: "{}",
      _dom_identity_source: "row_link_href",
    },
  }));
  const good = buildAnalysis(trusted);
  assert.equal(good.summary.ready_rows, 3);
  assert.ok(good.rows.every((r) => r.evaluation.status === "typical_cost"));
  for (const patch of [
    { _dom_scope_version: "0" },
    { _dom_scope_filters: '[{"status":"active"}]' },
    { _dom_scope_breakdown: '{"age":"25-34"}' },
    { _dom_scope_breakdown: "not-json" },
    { _dom_identity_source: "name" },
  ]) {
    const r = buildAnalysis(
      trusted.map((row) => ({ ...row, raw: { ...row.raw, ...patch } })),
    );
    assert.equal(r.summary.ready_rows, 0);
    assert.ok(r.rows.every((row) => row.evaluation.status === "blocked"));
  }
});
test("analysis preserves measured metrics and derives unit-correct ratios for selected goal", () => {
  const r = buildAnalysis([record()], "sales");
  assert.equal(r.summary.ready_rows, 1);
  assert.equal(r.rows[0].derived.purchase_roas, 3);
  assert.equal(r.rows[0].derived.cost_per_conversion, 100);
  assert.equal(r.rows[0].derived.link_ctr, 1);
  assert.equal(r.rows[0].derived.link_cpc, 2);
  assert.equal(r.groups[0].totals.reach, null);
  assert.equal(r.groups[0].derived.cpm, 20);
});
test("missing conversions remain null: generic Results are never substituted for purchases", () => {
  const r = record();
  delete r.metrics!.purchases;
  const a = buildAnalysis([r], "sales");
  assert.equal(a.rows[0].conversions, null);
  assert.equal(a.rows[0].derived.cost_per_conversion, null);
  assert.ok(a.rows[0].missing.includes("purchases"));
  assert.equal(a.groups[0].totals.conversions, null);
  const zero = { ...record(), spend: 0, impressions: 0, link_clicks: 0 };
  const z = buildAnalysis([zero], "sales");
  assert.equal(z.rows[0].derived.purchase_roas, null);
  assert.equal(z.rows[0].derived.link_ctr, null);
  assert.equal(z.rows[0].derived.link_cpc, null);
});
test("summary uses weighted ratios and separates currencies, levels, intervals and attribution", () => {
  const a = record(),
    b = {
      ...record(),
      ad_id: "334",
      spend: 800,
      impressions: 1000,
      link_clicks: 20,
    };
  const r = buildAnalysis([a, b]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].derived.link_ctr, (120 / 11000) * 100);
  assert.notEqual(r.groups[0].derived.link_ctr, (1 + 2) / 2);
  assert.equal(buildAnalysis([a, { ...b, currency: "USD" }]).groups.length, 2);
  assert.equal(
    buildAnalysis([a, { ...b, attribution: "1-day click" }]).groups.length,
    2,
  );
  assert.equal(
    buildAnalysis([a, { ...b, date_end: "2026-11-02" }]).groups.length,
    2,
  );
});
test("duplicate grains block totals; overlapping observations are exposed without cross-group totals", () => {
  const a = record();
  const duplicate = buildAnalysis([a, a]);
  assert.equal(duplicate.groups[0].blocked, true);
  assert.equal(duplicate.summary.ready_rows, 0);
  assert.equal(
    buildAnalysis([{ ...a, attribution: "unverified" }]).groups[0].totals.spend,
    null,
  );
  assert.equal(duplicate.groups[0].totals.spend, null);
  assert.equal(
    buildAnalysis([a, { ...a, date_end: "2026-11-05" }]).summary
      .overlapping_observations,
    1,
  );
});
test("Thai Meta headers, currency suffix, grouped numbers and explicit column mapping preserve metrics", () => {
  const csv =
    'รหัสบัญชีโฆษณา,รหัสแคมเปญ,ชื่อแคมเปญ,รหัสชุดโฆษณา,รหัสโฆษณา,วันที่เริ่มต้นการรายงาน,วันที่สิ้นสุดการรายงาน,จำนวนเงินที่ใช้จ่ายไป (THB),อิมเพรสชัน,การคลิกลิงก์,การซื้อ,ค่าคอนเวอร์ชั่นการซื้อ,CTR (Link click-through rate),CTR (All),Custom landing\n123456789,111,C,222,333,2026-11-01,2026-11-01,"1,234.50",10000,100,2,3000,1,5,80';
  const p = {
    ...input,
    csv,
    number_format: "grouped_dot" as const,
    column_mapping: { "Custom landing": "landing_page_views" as const },
    expected: {},
  };
  const r = parseReport(p);
  assert.equal(r.valid, true, r.errors.join("\n"));
  assert.equal(r.records[0].currency, "THB");
  assert.equal(r.records[0].spend, 1234.5);
  assert.equal(r.records[0].metrics!.link_ctr, 1);
  assert.equal(r.records[0].metrics!.ctr, 5);
  assert.equal(r.records[0].metrics!.landing_page_views, 80);
  assert.equal(parseReport({ ...p, number_format: "plain" }).valid, false);
});
test("column collisions and mismatched explicit currency are rejected, raw-only mapping stays raw", () => {
  assert.equal(
    parseReport({
      ...input,
      csv: input.csv.replace(
        "link_ctr,",
        "CTR (Link click-through rate),link_ctr,",
      ),
    }).valid,
    false,
  );
  const r = parseReport({ ...input, column_mapping: { budget: "__raw__" } });
  assert.equal(r.valid, true);
  assert.equal(r.records[0].metrics!.budget, undefined);
  assert.equal(r.records[0].raw._raw_budget, "500");
  const csv = input.csv.replace("spend,", "Amount spent (USD),");
  assert.equal(parseReport({ ...input, csv }).valid, false);
});
test("capture review rejects other accounts, preserves duplicate names and never promotes geometry to imports", () => {
  const s = {
    account_id: "123456789",
    reader_version: "0.4.0",
    page: "/adsmanager/manage/ads",
    captured_at: "2026-11-15T08:00:00.000Z",
    row_observations: [
      {
        identity: null,
        name: "Same ad",
        method: "geometry",
        warnings: [],
        cells: [
          { header: "Amount spent (THB)", text: "฿1,234.50" },
          { header: "Results", text: "20\nMessaging conversations" },
        ],
      },
      {
        identity: null,
        name: "Same ad",
        method: "geometry",
        warnings: [],
        cells: [{ header: "Amount spent (THB)", text: "—" }],
      },
    ],
  };
  const r = buildCaptureReview(
    [s, { ...s, account_id: "999" }],
    "123456789",
    "messages",
  );
  assert.deepEqual(r.rejected, [1]);
  assert.equal(r.captures[0].rows.length, 2);
  assert.equal(r.captures[0].rows[0].values.spend, 1234.5);
  assert.equal(r.captures[0].rows[0].values.results, null);
  assert.equal(r.ready_for_import, false);
  assert.equal(r.captures[0].rows[1].values.spend, null);
});

// These tests catch decision guidance escaping its evidence scope, rather than
// merely checking the presence of an analysis or the arithmetic it displays.
const evaluatedRecord = (id: string, spend: number, conversions: number) => {
  const r = record();
  return {
    ...r,
    ad_id: id,
    spend,
    metrics: {
      ...r.metrics,
      messaging_conversations: conversions,
      leads: conversions,
      purchases: conversions,
    },
  };
};
test("evaluation compares explicit goal cost only within compatible reporting and objective scopes", () => {
  const a = evaluatedRecord("301", 50, 10);
  const b = evaluatedRecord("302", 100, 10);
  const c = evaluatedRecord("303", 200, 10);
  const report = buildAnalysis([
    a,
    b,
    c,
    { ...evaluatedRecord("304", 10000, 10), currency: "USD" },
  ]);
  assert.equal(report.rows[0].evaluation?.status, "lower_cost");
  assert.equal(report.rows[1].evaluation?.status, "typical_cost");
  assert.equal(report.rows[2].evaluation?.status, "higher_cost");
  assert.deepEqual(report.rows[2].evaluation?.comparison, {
    peer_count: 3,
    median_cost_per_conversion: 10,
    relative_cost: 2,
  });
  assert.equal(report.rows[3].evaluation?.status, "insufficient_peers");
  assert.ok(report.rows[2].evaluation?.next_steps.length);
  const isolated = buildAnalysis([
    a,
    { ...b, objective: "SALES" },
    { ...c, objective: "LEADS" },
  ]);
  assert.ok(
    isolated.rows.every((r) => r.evaluation?.status === "insufficient_peers"),
  );
});
test("evaluation distinguishes missing conversions, measured zero, low sample and zero-spend data", () => {
  for (const goal of ["messages", "sales", "leads"] as const) {
    const zero = evaluatedRecord("301", 100, 0);
    const missing = evaluatedRecord("302", 100, 10);
    delete missing.metrics[
      goal === "messages"
        ? "messaging_conversations"
        : goal === "sales"
          ? "purchases"
          : "leads"
    ];
    const report = buildAnalysis(
      [
        zero,
        missing,
        evaluatedRecord("303", 100, 4),
        evaluatedRecord("304", 0, 10),
      ],
      goal,
    );
    assert.equal(report.rows[0].evaluation?.status, "insufficient_sample");
    assert.ok(report.rows[0].evaluation?.reasons.some((r) => r.includes("0")));
    assert.equal(report.rows[1].evaluation?.status, "blocked");
    assert.equal(report.rows[1].conversions, null);
    assert.equal(report.rows[2].evaluation?.status, "insufficient_sample");
    assert.equal(report.rows[3].evaluation?.status, "blocked");
    assert.ok(
      report.rows[3].evaluation?.blockers.includes("nonpositive_spend"),
    );
  }
});
test("duplicate, overlapping and unknown-context observations never guide relative decisions", () => {
  const a = evaluatedRecord("301", 50, 10);
  const duplicate = buildAnalysis([
    a,
    a,
    evaluatedRecord("302", 100, 10),
    evaluatedRecord("303", 200, 10),
  ]);
  assert.ok(duplicate.rows.every((r) => r.evaluation?.status === "blocked"));
  const overlapping = buildAnalysis([
    a,
    { ...a, date_end: "2026-11-05" },
    evaluatedRecord("302", 100, 10),
    evaluatedRecord("303", 200, 10),
  ]);
  assert.equal(overlapping.rows[0].evaluation?.status, "blocked");
  assert.equal(overlapping.rows[1].evaluation?.status, "blocked");
  assert.ok(
    overlapping.rows[0].evaluation?.blockers.includes("overlapping_interval"),
  );
  for (const context of [
    { timezone: "unverified" },
    { attribution: "unverified" },
    { result_type: "unverified" },
  ]) {
    assert.equal(
      buildAnalysis([{ ...a, ...context }]).rows[0].evaluation?.status,
      "blocked",
    );
  }
});
