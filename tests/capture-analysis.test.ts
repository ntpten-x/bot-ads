import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCaptureJob,
  analyzeCaptureLevel,
  parseDelivery,
} from "../packages/core/src/capture-analysis.js";
import type {
  CaptureRow,
  DomSnapshot,
} from "../packages/core/src/dom-capture.js";

// Synthetic rows shaped like a live 0.6.0 Thai campaigns capture: no IDs, no spend
// column, geometry rows, hover buttons and the summary row merged into the last name.
const msg = "การส่งข้อความเพื่อเริ่มการสนทนา";
const per = "ต่อการเริ่มการสนทนาในแอพรับส่งข้อความ";
const row = (
  name: string,
  delivery: string,
  results: string,
  cpr: string,
  impressions: string,
  budget: string,
): CaptureRow => ({
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
const snap = (
  rows: CaptureRow[],
  over: Partial<DomSnapshot> = {},
): DomSnapshot => ({
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
    row(
      "Fixture A",
      "ข้อผิดพลาดในการชำระเงิน",
      "16",
      "฿18.63",
      "4,537",
      "การใช้งบประมาณชุดโฆษณา",
    ),
    row(
      "Fixture B\nแก้ไข\nสร้างซ้ำ\nแผนภูมิ\nวิเคราะห์",
      "ข้อผิดพลาดในการชำระเงิน",
      "93",
      "฿15.52",
      "25,723",
      "฿100.00\nต่อวัน",
    ),
    row(
      "Fixture C",
      "ข้อผิดพลาดในการชำระเงิน",
      "380",
      "฿14.33",
      "123,054",
      "การใช้งบประมาณชุดโฆษณา",
    ),
    row("Fixture D", "ปิด", "178", "฿13.18", "44,211", "฿509.11\nต่อวัน"),
    row("Fixture E", "ปิด", "—", "—", "—", "฿509.12\nต่อวัน"),
    row("Fixture F", "ปิด", "188", "฿17.75", "96,469", "฿509.13\nต่อวัน"),
    row(
      "Fixture G\nการแก้ไขที่ไม่ได้เผยแพร่\nผลลัพธ์จาก 8 แคมเปญ",
      "ปิด",
      "—",
      "—",
      "—",
      "฿35.00\nต่อวัน",
    ),
  ]);

test("delivery text maps to explicit states; unknown text stays unknown", () => {
  assert.equal(parseDelivery("ข้อผิดพลาดในการชำระเงิน"), "payment_error");
  assert.equal(parseDelivery("ปิด"), "off");
  assert.equal(parseDelivery("ปิดใช้งานอยู่"), "off");
  assert.equal(parseDelivery("paused"), "off");
  assert.equal(parseDelivery("แคมเปญปิดอยู่"), "parent_off");
  assert.equal(parseDelivery("แคมเปญปิดใช้งาน"), "parent_off");
  assert.equal(parseDelivery("ใช้งานอยู่"), "active");
  assert.equal(parseDelivery("—"), "unknown");
  assert.equal(parseDelivery("something new"), "unknown");
});

test("live-shaped capture: parses metrics, cleans names, keeps unknowns null, estimates spend explicitly", () => {
  const a = analyzeCaptureLevel("campaigns", [live()]);
  assert.equal(a.unique_rows, 0);
  assert.equal(a.unresolved_observations, 7);
  assert.equal(
    a.reported_total_rows,
    8,
    "summary row count recovered from merged name cell",
  );
  assert.equal(a.coverage, "partial");
  const b = a.rows.find((r) => r.name === "Fixture B")!;
  assert.equal(b.results, 93);
  assert.equal(b.cost_per_result, 15.52);
  assert.equal(b.impressions, 25723);
  assert.equal(b.spend, 1443.36);
  assert.equal(b.spend_source, "estimate_results_x_cost_per_result");
  assert.deepEqual(b.budget, {
    amount: 100,
    period: "daily",
    uses: null,
    text: "฿100.00 ต่อวัน",
  });
  assert.equal(b.mapping, "aligned_geometry");
  const e = a.rows.find((r) => r.name === "Fixture E")!;
  assert.equal(e.results, null);
  assert.equal(e.spend, null);
  assert.equal(e.impressions, null);
  assert.equal(e.spend_source, null);
  const g = a.rows.find((r) => r.name === "Fixture G")!;
  assert.equal(g.unpublished_edits, true);
  assert.equal(
    a.rows.find((r) => r.name === "Fixture A")!.budget.uses,
    "ad_set_budget",
  );
  assert.equal(a.context.date_start, "2026-10-16");
  assert.equal(a.context.timezone, null);
  assert.ok(a.missing_columns.includes("spend"));
  assert.ok(a.missing_columns.includes("campaign_id"));
});

const trustedStatusRow = (
  id: string,
  name: string,
  delivery: string,
  results: string,
  spend: string,
  cpr: string,
): CaptureRow => ({
  ...row(
    name,
    delivery,
    results,
    cpr,
    "1,000",
    "฿100.00\nต่อวัน",
  ),
  identity: id,
  identity_source: "row_link_href",
  column_mapping: "semantic",
  cells: [
    ...row(
      name,
      delivery,
      results,
      cpr,
      "1,000",
      "฿100.00\nต่อวัน",
    ).cells,
    { header: "Amount spent", text: spend },
  ],
});

function performanceFixture() {
  return scoped(
    [
      trustedStatusRow("201", "Performance low", "ใช้งานอยู่", "10", "50", "5"),
      trustedStatusRow("202", "Performance mid", "ใช้งานอยู่", "10", "100", "10"),
      trustedStatusRow(
        "203",
        "Performance typical",
        "ใช้งานอยู่",
        "10",
        "120",
        "12",
      ),
      trustedStatusRow(
        "204",
        "Performance high",
        "ใช้งานอยู่",
        "10",
        "200",
        "20",
      ),
      trustedStatusRow(
        "205",
        "Performance higher",
        "ใช้งานอยู่",
        "10",
        "150",
        "15",
      ),
      trustedStatusRow(
        "206",
        "Payment diagnostic",
        "ข้อผิดพลาดในการชำระเงิน",
        "10",
        "1000",
        "100",
      ),
      trustedStatusRow("207", "Disabled diagnostic", "ปิด", "10", "900", "90"),
      trustedStatusRow(
        "208",
        "Parent disabled diagnostic",
        "แคมเปญปิดอยู่",
        "10",
        "800",
        "80",
      ),
    ],
    { reported_total_rows: 8 },
  );
}

test("performance ranking excludes billing errors and disabled Ads while retaining diagnostics", () => {
  const a = analyzeCaptureLevel("campaigns", [performanceFixture()]);
  assert.equal(a.ranking.result_type, msg);
  assert.equal(a.ranking.eligible, 5);
  assert.equal(a.ranking.median_cost_per_result, 12);
  assert.equal(a.ranking.best[0].name, "Performance low");
  assert.equal(a.ranking.worst[0].name, "Performance high");
  const codes = a.recommendations.map((r) => r.code);
  assert.ok(
    !codes.includes("payment_error"),
    "payment_error is a billing diagnostic, not a performance recommendation",
  );
  assert.ok(!codes.includes("paused_low_cost"));
  const high = a.recommendations.find(
    (r) => r.code === "high_cost_per_result",
  )!;
  assert.deepEqual(
    high.rows,
    ["Performance high (฿20)"],
    "only Ads with performance-eligible delivery are ranked",
  );
  assert.equal(a.coverage, "complete");
  assert.ok(!codes.includes("add_spend_column"));
  assert.ok(!codes.includes("add_id_column"));
  const group = a.result_groups[0];
  assert.equal(group.results, 50);
  assert.equal(group.rows, 5);
  assert.equal(group.spend_basis, "column");
  assert.deepEqual(a.ranking.best.map((r) => r.name), [
    "Performance low",
    "Performance mid",
  ]);
  assert.ok(
    a.ranking.best
      .concat(a.ranking.worst)
      .every((r) => !/diagnostic/i.test(r.name ?? "")),
  );
  assert.equal(a.delivery_counts.payment_error, 1);
  assert.equal(a.delivery_counts.off, 1);
  assert.equal(a.delivery_counts.parent_off, 1);
  assert.deepEqual(a.performance_excluded_counts, {
    payment_error: 1,
    off: 1,
    parent_off: 1,
  });
});

test("no median comparison with fewer than three comparable rows", () => {
  const two = analyzeCaptureLevel("campaigns", [
    scoped([
      {
        ...verified("111", "23", "212.29"),
        cells: [
          ...verified("111", "23", "212.29").cells.filter(
            (c) => c.header !== "ต้นทุนต่อผลลัพธ์",
          ),
          { header: "Cost per result", text: "9.23" },
        ],
      },
      {
        ...verified("222", "6", "124.56"),
        cells: [
          ...verified("222", "6", "124.56").cells.filter(
            (c) => c.header !== "ต้นทุนต่อผลลัพธ์",
          ),
          { header: "Cost per result", text: "20.76" },
        ],
      },
    ]),
  ]);
  assert.equal(two.ranking.eligible, 2);
  assert.ok(
    !two.recommendations.some(
      (r) => r.code === "high_cost_per_result" || r.code === "paused_low_cost",
    ),
  );
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
  assert.equal(a.unique_rows, 0);
  assert.equal(a.rows.length, 8);
  assert.equal(a.coverage, "partial");
  assert.equal(a.dedupe, "content_within_job");
  assert.equal(a.rows.find((r) => r.name === "Fixture F")!.occurrences, 2);
});

test("header/body scroll mismatch rows are excluded from ranking; spend column wins over estimate", () => {
  const mismatch = analyzeCaptureLevel("campaigns", [
    snap(live().row_observations, { column_alignment: "mismatch" }),
  ]);
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
  withSpend.row_observations[0].cells.push({
    header: "จำนวนเงินที่ใช้จ่ายไป",
    text: "฿299.50",
  });
  const a = analyzeCaptureLevel("campaigns", [withSpend]);
  assert.equal(a.rows[0].spend, 299.5);
  assert.equal(a.rows[0].spend_source, "column");
  assert.equal(a.rows[0].entity_id, "777");
  assert.equal(a.rows[0].mapping, "verified");
  assert.equal(a.rows[0].cpm, 299.5);
  assert.equal(a.dedupe, "id");
});

test("job analysis groups levels and reports data quality", () => {
  const ads = snap([], {
    page: "/adsmanager/manage/ads",
    reported_total_rows: 40,
  });
  const j = analyzeCaptureJob([live(), ads]);
  assert.deepEqual(
    j.levels.map((l) => l.level),
    ["campaigns", "ads"],
  );
  assert.equal(j.payment_error, true);
  assert.equal(j.data_quality.spend, "mixed");
  assert.equal(j.data_quality.identity, "no_stable_ids");
  assert.equal(j.levels[1].reported_total_rows, 40);
  assert.equal(j.levels[1].coverage, "partial");
});

test("breakdown partitions expose verified rows as a lower bound instead of using the report-wide footer", () => {
  const partition = scoped([verified("111", "10", "100")], {
    reported_total_rows: 40,
    reporting_context: {
      date_range_label: "Nov 14, 2026 – Nov 14, 2026",
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      breakdown: { age: "25–34" },
      filters: [],
    },
  });
  const level = analyzeCaptureLevel("campaigns", [partition]);
  assert.equal(level.reported_total_rows, 40);
  assert.equal(level.reported_total_scope, "report");
  assert.equal(level.coverage, "lower_bound");
  assert.equal(level.verified_unique_rows, 1);
  const lowerBound = level.recommendations.find(
    (r) => r.code === "partition_total_unverified",
  );
  assert.ok(lowerBound);
  assert.ok(!/จาก\s*40/.test(lowerBound.message));
  assert.ok(
    level.warnings.some((w) => w.includes("ยอดรวมทั้งรายงาน")),
    "the UI can explain that 40 is report-wide, not this partition's total",
  );

  const job = analyzeCaptureJob([partition]);
  assert.equal(job.data_quality.coverage[0].reported_scope, "report");
  assert.equal(job.data_quality.coverage[0].coverage, "lower_bound");

  const wholeReport = analyzeCaptureLevel("campaigns", [
    scoped([verified("222", "10", "100")]),
  ]);
  assert.equal(wholeReport.reported_total_scope, "partition");
  assert.equal(wholeReport.coverage, "complete");
});

const verified = (id = "111", results = "10", spend = "100"): CaptureRow => ({
  ...row("Verified fixture", "ใช้งานอยู่", results, "10", "1000", "100"),
  identity: id,
  identity_source: "row_link_href",
  column_mapping: "semantic",
  cells: [
    ...row("Verified fixture", "ใช้งานอยู่", results, "10", "1000", "100").cells,
    { header: "Amount spent", text: spend },
  ],
});
const scoped = (
  rows: CaptureRow[],
  over: Partial<DomSnapshot> = {},
): DomSnapshot =>
  snap(rows, {
    reported_total_rows: rows.length,
    reporting_context: {
      date_range_label: "Nov 14, 2026 – Nov 14, 2026",
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      breakdown: {},
      filters: [],
    },
    ...over,
  });

test("horizontal slices without stable IDs never certify entity count, totals or ranking", () => {
  const first = scoped([row("Same name", "ใช้งานอยู่", "5", "10", "1000", "100")]);
  const second = scoped(
    [
      {
        ...first.row_observations[0],
        cells: [{ header: "Amount spent", text: "50" }],
      },
    ],
    { captured_at: "2026-11-15T16:46:35.000Z" },
  );
  const a = analyzeCaptureLevel("campaigns", [first, second]);
  assert.equal(a.unique_rows, 0);
  assert.equal(a.unresolved_observations, 2);
  assert.notEqual(a.coverage, "complete");
  assert.deepEqual(a.result_groups, []);
  assert.equal(a.ranking.eligible, 0);
});

test("compatible stable-ID slices merge complementary metrics and use newest same-context values", () => {
  const first = scoped([verified("111", "5", "50")]);
  const slice = scoped(
    [{ ...verified(), cells: [{ header: "Impressions", text: "2000" }] }],
    { captured_at: "2026-11-15T16:46:35.000Z" },
  );
  const a = analyzeCaptureLevel("campaigns", [slice, first]);
  assert.equal(a.unique_rows, 1);
  assert.equal(a.rows[0].results, 5);
  assert.equal(a.rows[0].spend, 50);
  assert.equal(a.rows[0].impressions, 2000);
  assert.equal(a.rows[0].occurrences, 2);
  assert.equal(a.rows[0].provenance.length, 2);
  assert.equal(a.coverage, "complete");
  assert.equal(a.ranking.eligible, 1);
});

test("same ID in different reporting periods stays separate and never uses the latest date for old values", () => {
  const first = scoped([verified("111", "5", "50")]);
  const second = scoped([verified("111", "10", "100")], {
    captured_at: "2026-11-15T16:46:35.000Z",
    reporting_context: {
      ...first.reporting_context,
      date_range_label: "Nov 15, 2026 – Nov 15, 2026",
    },
  });
  const job = analyzeCaptureJob([first, second]);
  assert.equal(job.levels.length, 2);
  assert.deepEqual(
    job.levels.map((l) => [l.context.date_start, l.rows[0].results]),
    [
      ["2026-11-14", 5],
      ["2026-11-15", 10],
    ],
  );
  const direct = analyzeCaptureLevel("campaigns", [first, second]);
  assert.equal(direct.context.date_start, null);
  assert.deepEqual(direct.result_groups, []);
  assert.equal(direct.ranking.eligible, 0);
  assert.ok(direct.blockers.includes("mixed_reporting_context"));
});

test("currency, account, attribution and breakdown differences partition capture reports", () => {
  const first = scoped([verified()]);
  const variants = [
    scoped([verified("222")], {
      reporting_context: { ...first.reporting_context, currency: "USD" },
    }),
    scoped([verified("333")], { account_id: "999" }),
    scoped([verified("444")], {
      reporting_context: {
        ...first.reporting_context,
        attribution: "1-day click",
      },
    }),
    scoped([verified("555")], {
      reporting_context: {
        ...first.reporting_context,
        breakdown: { age: "25-34" },
      },
    }),
  ];
  const job = analyzeCaptureJob([first, ...variants]);
  assert.equal(job.levels.length, 5);
  assert.equal(new Set(job.levels.map((l) => l.scope_key)).size, 5);
  assert.ok(job.levels.every((l) => l.result_groups[0].spend === 100));
});

test("spend provenance comes from actual values including empty spend cells, mixed and missing", () => {
  const estimated = verified("111");
  estimated.cells.find((c) => c.header === "Amount spent")!.text = "—";
  const missing = verified("333", "—", "—");
  missing.cells.find((c) => c.header === "ต้นทุนต่อผลลัพธ์")!.text = "—";
  assert.equal(
    analyzeCaptureJob([scoped([estimated])]).data_quality.spend,
    "estimated",
  );
  assert.equal(
    analyzeCaptureJob([scoped([estimated, verified("222")])]).data_quality
      .spend,
    "mixed",
  );
  assert.equal(
    analyzeCaptureJob([scoped([missing])]).data_quality.spend,
    "missing",
  );
  assert.equal(analyzeCaptureJob([]).data_quality.spend, "missing");
  assert.equal(analyzeCaptureJob([]).data_quality.identity, "missing");
});

test("duplicate IDs and simultaneous conflicting evidence cannot certify coverage or ranking", () => {
  const duplicate = analyzeCaptureLevel("campaigns", [
    scoped([verified(), verified()]),
  ]);
  assert.notEqual(duplicate.coverage, "complete");
  assert.equal(duplicate.ranking.eligible, 0);
  assert.ok(duplicate.blockers.includes("duplicate_id_in_snapshot"));
  const conflict = analyzeCaptureLevel("campaigns", [
    scoped([verified("111", "5", "50")]),
    scoped([verified("111", "10", "100")]),
  ]);
  assert.notEqual(conflict.coverage, "complete");
  assert.equal(conflict.ranking.eligible, 0);
  assert.deepEqual(conflict.result_groups, []);
  assert.ok(conflict.rows[0].flags.includes("conflicting_values"));
});

test("missing context, unverified mapping, changed unlabeled rows and excess IDs never become complete", () => {
  const unknown = analyzeCaptureLevel("campaigns", [snap([verified()])]);
  assert.equal(unknown.ranking.eligible, 0);
  assert.deepEqual(unknown.result_groups, []);
  const mapping = verified();
  mapping.column_mapping = "unverified";
  assert.equal(
    analyzeCaptureLevel("campaigns", [scoped([mapping])]).ranking.eligible,
    0,
  );
  const excess = analyzeCaptureLevel("campaigns", [
    scoped([verified("111"), verified("222")], { reported_total_rows: 1 }),
  ]);
  assert.notEqual(excess.coverage, "complete");
  assert.ok(excess.blockers.includes("reported_count_mismatch"));
});

test("unverified ID columns and arbitrary identity sources never become verified entities", () => {
  const unverified = verified();
  unverified.identity_source = "id_column";
  unverified.column_mapping = "unverified";
  unverified.cells.push({ header: "Campaign ID", text: "111" });
  const a = analyzeCaptureLevel("campaigns", [scoped([unverified])]);
  assert.equal(a.rows[0].entity_id, null);
  const arbitrary = verified();
  arbitrary.identity_source = "name";
  assert.equal(
    analyzeCaptureLevel("campaigns", [scoped([arbitrary])]).rows[0].entity_id,
    null,
  );
});

test("row attribution and result type determine comparable groups without cross-attribution sums", () => {
  const a = verified("111");
  a.cells.push({ header: "Attribution setting", text: "1-day click" });
  const b = verified("222");
  b.cells.push({ header: "Attribution setting", text: "7-day click" });
  const job = analyzeCaptureJob([scoped([a, b])]);
  assert.equal(job.levels.length, 2);
  assert.deepEqual(job.levels.map((l) => l.context.attribution).sort(), [
    "1-day click",
    "7-day click",
  ]);
  assert.ok(job.levels.every((l) => l.result_groups[0].results === 10));
});

test("multiline attribution fragments with duplicate lines stay in one comparable scope", () => {
  const variants = [
    "การคลิกในช่วง\n7 วัน\nคอนเวอร์ชั่นทั้งหมด",
    "คอนเวอร์ชั่นทั้งหมด\nการคลิกในช่วง\n7 วัน\nคอนเวอร์ชั่นทั้งหมด",
    "การคลิกในช่วง\n7 วัน\nคอนเวอร์ชั่นทั้งหมด\nคอนเวอร์ชั่นทั้งหมด",
  ];
  const rows = variants.map((text, index) => {
    const item = verified(String(111 + index), "10", "100");
    item.cells.push({ header: "Attribution setting", text });
    return item;
  });
  const job = analyzeCaptureJob([scoped(rows)]);
  assert.equal(
    job.levels.length,
    1,
    "one attribution cell must not become several reporting scopes",
  );
  assert.equal(job.levels[0].context.attribution?.includes("การคลิกในช่วง"), true);
  assert.equal(job.levels[0].context.attribution?.includes("หรือการดูในช่วง"), false);
  assert.equal(job.levels[0].result_groups[0].results, 30);
  assert.equal(job.levels[0].result_groups[0].rows, 3);
});

test("stable IDs fill unknown attribution from another compatible horizontal slice", () => {
  const metrics = verified("111", "10", "100");
  metrics.cells = metrics.cells.filter(
    (cell) => cell.header !== "Attribution setting",
  );
  const attribution = {
    ...verified("111", "10", "100"),
    cells: [
      { header: "Ad", text: "Verified fixture" },
      { header: "Amount spent", text: "100" },
      { header: "Attribution setting", text: "7-day click" },
    ],
  };
  const baseContext = {
    date_range_label: "Nov 14, 2026 – Nov 14, 2026",
    currency: "THB",
    timezone: "Asia/Bangkok",
    attribution: "unverified",
    breakdown: {},
    filters: [],
  };
  const first = snap([metrics], {
    page: "/adsmanager/manage/ads",
    row_observations: [metrics],
    reporting_context: baseContext,
  });
  const second = snap([attribution], {
    page: "/adsmanager/manage/ads",
    captured_at: "2026-11-15T16:46:35.000Z",
    row_observations: [attribution],
    reporting_context: baseContext,
  });
  const result = analyzeCaptureLevel("ads", [first, second]);
  assert.equal(result.unique_rows, 1);
  assert.equal(result.context.attribution, "7-day click");
  assert.equal(result.rows[0].spend, 100);
  assert.equal(result.rows[0].results, 10);
});

test("explicit operator timezone and no-scope confirmations enable compatible ranking", () => {
  const capture = scoped(
    Array.from({ length: 5 }, (_, index) =>
      verified(String(700 + index), String(5 + index), String(100 + index)),
    ),
    {
      reporting_context: {
        date_range_label: "Nov 14, 2026 – Nov 14, 2026",
        currency: "THB",
        timezone: "unverified",
        attribution: "7-day click",
        breakdown: null,
        filters: null,
      },
    },
  );
  const withoutContext = analyzeCaptureLevel("campaigns", [capture]);
  assert.equal(withoutContext.ranking.eligible, 0);
  assert.ok(withoutContext.blockers.includes("timezone_unverified"));
  const withContext = analyzeCaptureLevel("campaigns", [capture], {
    operator: {
      timezone: "Asia/Bangkok",
      confirm_no_breakdown: true,
      confirm_no_filters: true,
    },
  });
  assert.equal(withContext.context.timezone, "Asia/Bangkok");
  assert.deepEqual(withContext.context.breakdown, {});
  assert.deepEqual(withContext.context.filters, []);
  assert.ok(withContext.ranking.eligible >= 3);
  assert.ok(!withContext.blockers.includes("timezone_unverified"));
});

test("later explicit metric values replace stale values, including unknowns, within one reporting scope", () => {
  const first = scoped([verified("111", "5", "50")]);
  const later = scoped([verified("111", "10", "—")], {
    captured_at: "2026-11-15T16:46:35.000Z",
  });
  const a = analyzeCaptureLevel("campaigns", [later, first]);
  assert.equal(a.rows[0].results, 10);
  assert.equal(a.rows[0].spend_source, "estimate_results_x_cost_per_result");
  assert.equal(a.rows[0].spend, 100);
  assert.ok(a.rows[0].flags.includes("updated_column:results"));
  assert.equal(
    a.ranking.eligible,
    0,
    "estimated spend cannot produce actionable cost rankings",
  );
});

test("contradictory result types and monetary units block merged rows instead of ranking them", () => {
  const first = scoped([verified()]);
  const changed = verified();
  changed.cells.find((c) => c.header === "ผลลัพธ์")!.text = "10\nPurchases";
  const later = scoped([changed], { captured_at: "2026-11-15T16:46:35.000Z" });
  const conflict = analyzeCaptureLevel("campaigns", [first, later]);
  assert.equal(conflict.ranking.eligible, 0);
  assert.deepEqual(conflict.result_groups, []);
  assert.ok(conflict.rows[0].flags.includes("conflicting_result_type"));
  const wrongCurrency = verified();
  wrongCurrency.cells.find((c) => c.header === "Amount spent")!.text = "€100";
  assert.equal(
    analyzeCaptureLevel("campaigns", [scoped([wrongCurrency])]).ranking
      .eligible,
    0,
  );
});

test("absent breakdown and filter evidence stays unknown and cannot certify comparisons or coverage", () => {
  const missing = scoped([verified()]);
  delete missing.reporting_context!.breakdown;
  delete missing.reporting_context!.filters;
  const a = analyzeCaptureLevel("campaigns", [missing]);
  assert.equal(a.context.breakdown, null);
  assert.equal(a.context.filters, null);
  assert.ok(a.blockers.includes("breakdown_unverified"));
  assert.ok(a.blockers.includes("filters_unverified"));
  assert.deepEqual(a.result_groups, []);
  assert.equal(a.ranking.eligible, 0);
  assert.notEqual(a.coverage, "complete");
  const explicit = analyzeCaptureLevel("campaigns", [scoped([verified()])]);
  assert.deepEqual(explicit.context.breakdown, {});
  assert.deepEqual(explicit.context.filters, []);
  assert.equal(explicit.coverage, "complete");
  assert.equal(explicit.ranking.eligible, 1);
});

test("different explicit filters and unknown scope evidence never merge as one comparable report", () => {
  const known = scoped([verified("111", "5", "50")]);
  const filtered = scoped([verified("111", "10", "100")], {
    reporting_context: {
      ...known.reporting_context,
      filters: [{ status: "active" }],
    },
  });
  const unknown = scoped([verified("111", "15", "150")]);
  delete unknown.reporting_context!.filters;
  const job = analyzeCaptureJob([known, filtered, unknown]);
  assert.equal(job.levels.length, 3);
  assert.deepEqual(
    job.levels.map((l) => l.rows[0].results),
    [5, 10, 15],
  );
  assert.deepEqual(job.levels[2].result_groups, []);
});

test("unresolved delivery observations remain diagnostics without claiming unique entity counts", () => {
  const base = row(
    "Same name",
    "ข้อผิดพลาดในการชำระเงิน",
    "5",
    "10",
    "1000",
    "100",
  );
  const a = analyzeCaptureLevel("campaigns", [
    scoped([base]),
    scoped([
      {
        ...base,
        cells: [...base.cells, { header: "Amount spent", text: "50" }],
      },
    ]),
  ]);
  assert.equal(a.unique_rows, 0);
  assert.equal(a.delivery_counts.payment_error ?? 0, 0);
  assert.equal(a.delivery_observation_counts.payment_error, 2);
  assert.ok(!a.recommendations.some((r) => r.code === "payment_error"));
  assert.equal(analyzeCaptureJob([scoped([base])]).payment_error, true);
});

test("visible row breakdown overrides an empty context and partitions dimensions", () => {
  const first = verified("111");
  first.cells.push({ header: "Age", text: "25-34" });
  const second = verified("111");
  second.cells.push({ header: "Age", text: "35-44" });
  const job = analyzeCaptureJob([scoped([first, second])]);
  assert.equal(job.levels.length, 2);
  assert.deepEqual(
    job.levels.map((l) => l.context.breakdown),
    [{ age: "25-34" }, { age: "35-44" }],
  );
  const nullBase = snap([first], {
    reporting_context: {
      date_range_label: "Nov 14, 2026 – Nov 14, 2026",
      currency: "THB",
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      breakdown: null,
      filters: [],
    },
  });
  const direct = analyzeCaptureLevel("campaigns", [nullBase]);
  assert.deepEqual(direct.context.breakdown, { age: "25-34" });
  assert.ok(!direct.blockers.includes("breakdown_unverified"));
});

test("explicit vertical row misalignment blocks identity-bound metrics despite a forged verified mapping", () => {
  for (const alignment of ["mismatch", "unverified"] as const) {
    const a = analyzeCaptureLevel("campaigns", [
      scoped([verified()], { row_alignment: alignment }),
    ]);
    const reason =
      alignment === "mismatch"
        ? "identity_metric_vertical_mismatch"
        : "row_alignment_unverified";
    assert.equal(a.rows[0].mapping, "unverified");
    assert.equal(a.rows[0].spend, null);
    assert.equal(a.rows[0].results, null);
    assert.equal(a.rows[0].impressions, null);
    assert.deepEqual(a.result_groups, []);
    assert.equal(a.ranking.eligible, 0);
    assert.ok(a.blockers.includes(reason));
    assert.notEqual(a.coverage, "complete");
  }
  assert.equal(
    analyzeCaptureLevel("campaigns", [
      scoped([verified()], { row_alignment: "aligned" }),
    ]).ranking.eligible,
    1,
  );
});
