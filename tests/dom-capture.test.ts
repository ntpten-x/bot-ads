import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureLevel,
  evaluateSnapshot,
  parseDateRangeLabel,
  parseDisplayNumber,
  snapshotFingerprint,
  type DomSnapshot,
} from "../packages/core/src/dom-capture.js";

const account = "123456789";
const row = (over: Partial<DomSnapshot["row_observations"][number]> = {}) => ({
  identity: "111",
  identity_source: "row_link_href",
  parent_ids: { campaign_id: null, ad_set_id: null },
  name: "Fixture campaign",
  method: "geometry" as const,
  column_mapping: "verified_geometry",
  cells: [
    { header: "แคมเปญ", text: "Fixture campaign" },
    { header: "ผลลัพธ์", text: "16\nการส่งข้อความเพื่อเริ่มการสนทนา" },
    { header: "จำนวนเงินที่ใช้จ่ายไป", text: "฿298.08" },
    { header: "อิมเพรสชัน", text: "4,537" },
    { header: "งบประมาณ", text: "การใช้งบประมาณชุดโฆษณา" },
    { header: "การตั้งค่าการระบุที่มา", text: "คลิก 7 วัน หรือดู 1 วัน" },
  ],
  warnings: [],
  ...over,
});
const snapshot = (over: Partial<DomSnapshot> = {}): DomSnapshot => ({
  account_id: account,
  reader_version: "0.6.0",
  page: "/adsmanager/manage/campaigns",
  captured_at: "2026-11-15T07:00:00.000Z",
  coverage: "visible_only",
  column_alignment: "aligned",
  warnings: [],
  reporting_context: {
    date_range_label: "30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026",
    attribution: "unverified",
    timezone: "Asia/Bangkok",
    currency: "THB",
  },
  row_observations: [row()],
  ...over,
});
const options = { bound_account: account };

test("date range labels from Thai and English date buttons", () => {
  assert.deepEqual(parseDateRangeLabel("30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026"), {
    date_start: "2026-10-16",
    date_end: "2026-11-14",
  });
  assert.deepEqual(parseDateRangeLabel("30 วันที่ผ่านมา: 16 ต.ค. – 14 พ.ย. 2569"), {
    date_start: "2026-10-16",
    date_end: "2026-11-14",
  });
  assert.deepEqual(parseDateRangeLabel("Last 7 days: Nov 8 – 14, 2026"), {
    date_start: "2026-11-08",
    date_end: "2026-11-14",
  });
  assert.deepEqual(parseDateRangeLabel("Last 30 days: Oct 16, 2026 – Nov 14, 2026"), {
    date_start: "2026-10-16",
    date_end: "2026-11-14",
  });
  assert.equal(parseDateRangeLabel("วันนี้"), null);
  assert.equal(parseDateRangeLabel(null), null);
  assert.equal(parseDateRangeLabel("31 ก.พ. 2026 – 1 มี.ค. 2026"), null);
});

test("display numbers never turn unknown into zero", () => {
  assert.deepEqual(parseDisplayNumber("฿1,234.50"), { value: 1234.5, symbol: "฿", percent: false });
  assert.equal(parseDisplayNumber("—"), null);
  assert.equal(parseDisplayNumber("การใช้งบประมาณชุดโฆษณา"), null);
  assert.equal(parseDisplayNumber("16\nการส่งข้อความ")?.value, 16);
  assert.equal(captureLevel("/adsmanager/manage/ads"), "ads");
  assert.equal(captureLevel("/adsmanager/manage/ads/edit"), null);
});

test("fully verified campaign row is promoted with verified conditions", () => {
  const [r] = evaluateSnapshot(snapshot(), options);
  assert.equal(r.status, "ready", r.reasons.join(","));
  assert.equal(r.record?.campaign_id, "111");
  assert.equal(r.record?.spend, 298.08);
  assert.equal(r.record?.impressions, 4537);
  assert.equal(r.record?.results, 16);
  assert.equal(r.record?.result_type, "การส่งข้อความเพื่อเริ่มการสนทนา");
  assert.equal(r.record?.attribution, "คลิก 7 วัน หรือดู 1 วัน");
  assert.equal(r.record?.currency, "THB");
  assert.equal(r.record?.date_start, "2026-10-16");
  assert.equal(r.record?.metrics?.budget, undefined, "non-numeric budget stays missing");
  assert.equal(r.record?.raw._source, "dom_capture");
});

test("rows without stable ID, verified context or mapping stay needs_review with reasons", () => {
  const real = snapshot({
    reporting_context: {
      date_range_label: "30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026",
      attribution: "unverified",
      timezone: "unverified",
      currency: "unverified",
    },
    row_observations: [
      row({
        identity: null,
        column_mapping: "unverified",
        cells: [
          { header: "แคมเปญ", text: "Same name" },
          { header: "ผลลัพธ์", text: "—" },
          { header: "อิมเพรสชัน", text: "4,537" },
        ],
      }),
    ],
  });
  const [r] = evaluateSnapshot(real, options);
  assert.equal(r.status, "needs_review");
  for (const reason of [
    "stable_id_unverified",
    "column_mapping_unverified",
    "currency_unverified",
    "timezone_unverified",
    "attribution_unverified",
    "result_type_unverified",
    "missing_required_metric:spend",
  ])
    assert.ok(r.reasons.includes(reason), reason);
  assert.equal(r.record, null);
});

test("operator may confirm timezone and attribution but never IDs, dates or currency", () => {
  const s = snapshot({
    reporting_context: { date_range_label: "วันนี้", currency: "unverified", timezone: "unverified" },
    row_observations: [row({ cells: row().cells.filter((c) => c.header !== "การตั้งค่าการระบุที่มา") })],
  });
  const [r] = evaluateSnapshot(s, { ...options, operator: { timezone: "Asia/Bangkok", attribution: "7-day click" } });
  assert.deepEqual(r.reasons.sort(), ["currency_unverified", "date_range_unverified"]);
  const ok = evaluateSnapshot(
    snapshot({ row_observations: [row({ cells: row().cells.filter((c) => c.header !== "การตั้งค่าการระบุที่มา") })] }),
    { ...options, operator: { attribution: "7-day click" } },
  );
  assert.equal(ok[0].status, "ready");
  assert.equal(ok[0].record?.attribution, "7-day click");
});

test("scroll mismatch, currency conflict, duplicate IDs and account mismatch block promotion", () => {
  assert.ok(evaluateSnapshot(snapshot({ column_alignment: "mismatch" }), options)[0].reasons.includes("header_body_scroll_mismatch"));
  const dollars = snapshot({
    row_observations: [row({ cells: row().cells.map((c) => (c.header === "จำนวนเงินที่ใช้จ่ายไป" ? { ...c, text: "$10.00" } : c)) })],
  });
  assert.ok(evaluateSnapshot(dollars, options)[0].reasons.includes("currency_conflict"));
  const dup = evaluateSnapshot(snapshot({ row_observations: [row(), row({ name: "Other" })] }), options);
  assert.ok(dup.every((r) => r.status === "needs_review" && r.reasons.includes("duplicate_id_in_snapshot")));
  assert.equal(evaluateSnapshot(snapshot({ account_id: "999" }), options)[0].status, "rejected");
});

test("child levels need DOM parent IDs and a promoted parent campaign", () => {
  const adset = snapshot({
    page: "/adsmanager/manage/adsets",
    row_observations: [row({ identity: "222", cells: row().cells.map((c) => (c.header === "แคมเปญ" ? { header: "ชุดโฆษณา", text: "Fixture ad set" } : c)) })],
  });
  assert.ok(evaluateSnapshot(adset, options)[0].reasons.includes("parent_campaign_id_unverified"));
  adset.row_observations[0].parent_ids = { campaign_id: "111" };
  assert.ok(evaluateSnapshot(adset, options)[0].reasons.includes("parent_campaign_not_promoted"));
  const ready = evaluateSnapshot(adset, { ...options, campaign_names: new Map([["111", "Fixture campaign"]]) })[0];
  assert.equal(ready.status, "ready", ready.reasons.join(","));
  assert.equal(ready.record?.ad_set_id, "222");
  assert.equal(ready.record?.level, "adset");
  const ad = snapshot({
    page: "/adsmanager/manage/ads",
    row_observations: [row({ identity: "333", parent_ids: { campaign_id: "111" }, cells: row().cells.map((c) => (c.header === "แคมเปญ" ? { header: "โฆษณา", text: "Fixture ad" } : c)) })],
  });
  const adEval = evaluateSnapshot(ad, { ...options, campaign_names: new Map([["111", "Fixture campaign"]]) })[0];
  assert.ok(adEval.reasons.includes("parent_ad_set_id_unverified"));
  ad.row_observations[0].parent_ids = { campaign_id: "111", ad_set_id: "222" };
  const adReady = evaluateSnapshot(ad, { ...options, campaign_names: new Map([["111", "Fixture campaign"]]) })[0];
  assert.equal(adReady.status, "ready", adReady.reasons.join(","));
  assert.equal(adReady.record?.ad_id, "333");
});

test("snapshot fingerprint is stable for identical captures", () => {
  assert.equal(snapshotFingerprint(snapshot()), snapshotFingerprint(snapshot()));
  assert.notEqual(snapshotFingerprint(snapshot()), snapshotFingerprint(snapshot({ captured_at: "2026-11-15T07:00:01.000Z" })));
});
