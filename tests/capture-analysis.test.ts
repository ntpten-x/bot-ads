import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCaptureJob, analyzeCaptureLevel, parseDelivery } from "../packages/core/src/capture-analysis.js";
import type { CaptureRow, DomSnapshot } from "../packages/core/src/dom-capture.js";

// Synthetic rows shaped like a live 0.6.0 Thai campaigns capture: no IDs, no spend
// column, geometry rows, hover buttons and the summary row merged into the last name.
const msg = "การส่งข้อความเพื่อเริ่มการสนทนา";
const per = "ต่อการเริ่มการสนทนาในแอพรับส่งข้อความ";
const row = (name: string, delivery: string, results: string, cpr: string, impressions: string, budget: string): CaptureRow => ({
  identity: null,
  identity_source: null,
  parent_ids: { campaign_id: null, ad_set_id: null },
  name: name.split("\n")[0],
  method: "geometry",
  column_mapping: "unverified",
  cells: [
    { header: "แคมเปญ", text: name },
    { header: "การแสดงโฆษณา", text: delivery },
    { header: "ผลลัพธ์", text: `${results}\n${msg}` },
    { header: "ต้นทุนต่อผลลัพธ์", text: `${cpr}\n${per}` },
    { header: "อิมเพรสชัน", text: impressions },
    { header: "งบประมาณ", text: budget },
  ],
  warnings: [],
});
const snap = (rows: CaptureRow[], over: Partial<DomSnapshot> = {}): DomSnapshot => ({
  account_id: "123456789",
  reader_version: "0.6.0",
  page: "/adsmanager/manage/campaigns",
  captured_at: "2026-11-15T16:46:29.000Z",
  coverage: "visible_only",
  column_alignment: "aligned",
  warnings: [],
  reporting_context: {
    date_range_label: "30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026",
    currency: "THB",
    timezone: "unverified",
    attribution: "unverified",
  },
  row_observations: rows,
  ...over,
});
const live = () =>
  snap([
    row("Fixture A", "ข้อผิดพลาดในการชำระเงิน", "16", "฿18.63", "4,537", "การใช้งบประมาณชุดโฆษณา"),
    row("Fixture B\nแก้ไข\nสร้างซ้ำ\nแผนภูมิ\nวิเคราะห์", "ข้อผิดพลาดในการชำระเงิน", "93", "฿15.52", "25,723", "฿100.00\nต่อวัน"),
    row("Fixture C", "ข้อผิดพลาดในการชำระเงิน", "380", "฿14.33", "123,054", "การใช้งบประมาณชุดโฆษณา"),
    row("Fixture D", "ปิด", "178", "฿13.18", "44,211", "฿509.11\nต่อวัน"),
    row("Fixture E", "ปิด", "—", "—", "—", "฿509.12\nต่อวัน"),
    row("Fixture F", "ปิด", "188", "฿17.75", "96,469", "฿509.13\nต่อวัน"),
    row("Fixture G\nการแก้ไขที่ไม่ได้เผยแพร่\nผลลัพธ์จาก 8 แคมเปญ", "ปิด", "—", "—", "—", "฿35.00\nต่อวัน"),
  ]);

test("delivery text maps to explicit states; unknown text stays unknown", () => {
  assert.equal(parseDelivery("ข้อผิดพลาดในการชำระเงิน"), "payment_error");
  assert.equal(parseDelivery("ปิด"), "off");
  assert.equal(parseDelivery("แคมเปญปิดอยู่"), "parent_off");
  assert.equal(parseDelivery("ใช้งานอยู่"), "active");
  assert.equal(parseDelivery("—"), "unknown");
  assert.equal(parseDelivery("something new"), "unknown");
});

test("live-shaped capture: parses metrics, cleans names, keeps unknowns null, estimates spend explicitly", () => {
  const a = analyzeCaptureLevel("campaigns", [live()]);
  assert.equal(a.unique_rows, 7);
  assert.equal(a.reported_total_rows, 8, "summary row count recovered from merged name cell");
  assert.equal(a.coverage, "partial");
  const b = a.rows.find((r) => r.name === "Fixture B")!;
  assert.equal(b.results, 93);
  assert.equal(b.cost_per_result, 15.52);
  assert.equal(b.impressions, 25723);
  assert.equal(b.spend, 1443.36);
  assert.equal(b.spend_source, "estimate_results_x_cost_per_result");
  assert.deepEqual(b.budget, { amount: 100, period: "daily", uses: null, text: "฿100.00 ต่อวัน" });
  assert.equal(b.mapping, "aligned_geometry");
  const e = a.rows.find((r) => r.name === "Fixture E")!;
  assert.equal(e.results, null);
  assert.equal(e.spend, null);
  assert.equal(e.impressions, null);
  assert.equal(e.spend_source, null);
  const g = a.rows.find((r) => r.name === "Fixture G")!;
  assert.equal(g.unpublished_edits, true);
  assert.equal(a.rows.find((r) => r.name === "Fixture A")!.budget.uses, "ad_set_budget");
  assert.equal(a.context.date_start, "2026-10-16");
  assert.equal(a.context.timezone, null);
  assert.ok(a.missing_columns.includes("spend"));
  assert.ok(a.missing_columns.includes("campaign_id"));
});

test("ranking uses cost per result among rows with enough results; recommendations are labelled", () => {
  const a = analyzeCaptureLevel("campaigns", [live()]);
  assert.equal(a.ranking.result_type, msg);
  assert.equal(a.ranking.eligible, 5);
  assert.equal(a.ranking.median_cost_per_result, 15.52);
  assert.equal(a.ranking.best[0].name, "Fixture D");
  assert.equal(a.ranking.worst[0].name, "Fixture A");
  const codes = a.recommendations.map((r) => r.code);
  assert.equal(a.recommendations[0].code, "payment_error");
  assert.deepEqual(a.recommendations[0].rows, ["Fixture A", "Fixture B", "Fixture C"]);
  assert.ok(codes.includes("paused_low_cost"));
  assert.ok(!codes.includes("high_cost_per_result"), "18.63 is below 1.3 × median 15.52");
  const strict = analyzeCaptureLevel("campaigns", [live()], { high_cost_ratio: 1.15 });
  const high = strict.recommendations.find((r) => r.code === "high_cost_per_result")!;
  assert.deepEqual(high.rows, ["Fixture A (฿18.63)"], "paused rows are not flagged as overspending");
  assert.ok(codes.includes("partial_coverage"));
  assert.ok(codes.includes("add_spend_column"));
  assert.ok(codes.includes("add_id_column"));
  const group = a.result_groups[0];
  assert.equal(group.results, 16 + 93 + 380 + 178 + 188);
  assert.equal(group.spend_basis, "estimate");
  assert.equal(a.delivery_counts.payment_error, 3);
});

test("no median comparison with fewer than three comparable rows", () => {
  const two = analyzeCaptureLevel("campaigns", [
    snap([
      row("Fixture X", "ใช้งานอยู่", "23", "฿9.23", "5,392", "฿300.00\nต่อวัน"),
      row("Fixture Y", "ใช้งานอยู่", "6", "฿20.76", "1,597", "฿300.00\nต่อวัน"),
    ]),
  ]);
  assert.equal(two.ranking.eligible, 2);
  assert.ok(!two.recommendations.some((r) => r.code === "high_cost_per_result" || r.code === "paused_low_cost"));
});

test("rows repeated across scroll snapshots of one job are counted once; distinct rows are kept", () => {
  const first = live();
  const second = snap(
    [
      row("Fixture F", "ปิด", "188", "฿17.75", "96,469", "฿509.13\nต่อวัน"),
      row("Fixture H", "ใช้งานอยู่", "12", "฿20.00", "3,000", "฿200.00\nต่อวัน"),
    ],
    { captured_at: "2026-11-15T16:46:35.000Z" },
  );
  const a = analyzeCaptureLevel("campaigns", [second, first]);
  assert.equal(a.observed_rows, 9);
  assert.equal(a.unique_rows, 8);
  assert.equal(a.coverage, "complete");
  assert.equal(a.dedupe, "content_within_job");
  assert.equal(a.rows.find((r) => r.name === "Fixture F")!.occurrences, 2);
});

test("header/body scroll mismatch rows are excluded from ranking; spend column wins over estimate", () => {
  const mismatch = analyzeCaptureLevel("campaigns", [snap(live().row_observations, { column_alignment: "mismatch" })]);
  assert.equal(mismatch.ranking.eligible, 0);
  assert.deepEqual(mismatch.result_groups, []);
  const withSpend = snap([
    {
      ...row("Fixture S", "ใช้งานอยู่", "10", "฿30.00", "1,000", "฿100.00\nต่อวัน"),
      identity: "777",
      identity_source: "row_link_href",
      column_mapping: "verified_geometry",
    },
  ]);
  withSpend.row_observations[0].cells.push({ header: "จำนวนเงินที่ใช้จ่ายไป", text: "฿299.50" });
  const a = analyzeCaptureLevel("campaigns", [withSpend]);
  assert.equal(a.rows[0].spend, 299.5);
  assert.equal(a.rows[0].spend_source, "column");
  assert.equal(a.rows[0].entity_id, "777");
  assert.equal(a.rows[0].mapping, "verified");
  assert.equal(a.rows[0].cpm, 299.5);
  assert.equal(a.dedupe, "id");
});

test("job analysis groups levels and reports data quality", () => {
  const ads = snap([], { page: "/adsmanager/manage/ads", reported_total_rows: 40 });
  const j = analyzeCaptureJob([live(), ads]);
  assert.deepEqual(j.levels.map((l) => l.level), ["campaigns", "ads"]);
  assert.equal(j.payment_error, true);
  assert.equal(j.data_quality.spend, "estimated");
  assert.equal(j.data_quality.identity, "no_stable_ids");
  assert.equal(j.levels[1].reported_total_rows, 40);
  assert.equal(j.levels[1].coverage, "partial");
});
