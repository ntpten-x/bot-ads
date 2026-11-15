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
