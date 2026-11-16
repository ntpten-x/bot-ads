// Fixture-only API test for DOM capture persistence and promotion. Uses a random
// fixture account and device and deletes only the rows it created.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.CAPTURES_TEST_API ?? "http://127.0.0.1:4318";
const token = process.env.API_TOKEN!;
async function req(path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const account = `9${Date.now()}`;
const device = randomUUID();
const jobId = randomUUID();
const context = {
  date_range_label: "30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026",
  column_preset_label: "คอลัมน์: Fixture",
  attribution: "unverified",
  timezone: "Asia/Bangkok",
  currency: "THB",
  breakdown: {},
  filters: [],
  evidence: { currency: "cell_symbol:฿", timezone: "visible_text" },
};
const cells = (name: [string, string], spend: string, impressions: string) => [
  { header: name[0], text: name[1] },
  { header: "ผลลัพธ์", text: "16\nการส่งข้อความเพื่อเริ่มการสนทนา" },
  { header: "จำนวนเงินที่ใช้จ่ายไป", text: spend },
  { header: "อิมเพรสชัน", text: impressions },
  { header: "การตั้งค่าการระบุที่มา", text: "คลิก 7 วัน หรือดู 1 วัน" },
];
const obs = (identity: string | null, parent_ids: object, c: object[]) => ({
  identity,
  identity_source: identity ? "row_link_href" : null,
  parent_ids,
  name: null,
  method: "geometry",
  column_mapping: identity ? "verified_geometry" : "unverified",
  cells: c,
  warnings: [],
});
const snap = (page: string, rows: object[], over: object = {}) => ({
  account_id: account,
  reader_version: "0.6.0",
  page,
  level: page.split("/").pop(),
  captured_at: new Date().toISOString(),
  tables: [],
  row_observations: rows,
  format: "visible_text_fallback",
  unstructured: null,
  column_alignment: "aligned",
  reporting_context: context,
  coverage: "visible_only",
  warnings: [],
  ...over,
});
const snapshots = [
  snap("/adsmanager/manage/campaigns", [
    obs("111", {}, cells(["แคมเปญ", "Fixture campaign"], "฿100.00", "1,000")),
    obs(null, {}, cells(["แคมเปญ", "Fixture campaign"], "฿5.00", "50")),
  ]),
  snap("/adsmanager/manage/adsets", [
    obs(
      "222",
      { campaign_id: "111" },
      cells(["ชุดโฆษณา", "Fixture ad set"], "฿60.00", "600"),
    ),
  ]),
  snap("/adsmanager/manage/ads", [
    obs(
      "333",
      { campaign_id: "111", ad_set_id: "222" },
      cells(["โฆษณา", "Fixture ad"], "฿40.00", "400"),
    ),
  ]),
  snap(
    "/adsmanager/manage/campaigns",
    [obs("444", {}, cells(["แคมเปญ", "Second campaign"], "฿10.00", "100"))],
    { reporting_context: { ...context, timezone: "unverified" } },
  ),
  snap(
    "/adsmanager/manage/campaigns",
    [
      obs(
        "555",
        {},
        cells(["แคมเปญ", "Unknown scope fixture"], "฿10.00", "100"),
      ),
    ],
    {
      reporting_context: {
        date_range_label: context.date_range_label,
        currency: "THB",
        timezone: "Asia/Bangkok",
        attribution: "7-day click",
      },
    },
  ),
];
const state = {
  bound_account: account,
  enabled: true,
  extension_version: "0.6.0",
  job: {
    id: jobId,
    tabId: 1,
    account,
    levels: ["campaigns", "adsets", "ads"],
    index: 3,
    step: 0,
    maxSteps: 5,
    status: "needs_review",
    level_warnings: ["ads: fixture paging incomplete"],
    snapshots,
  },
};
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const first = await req(`/devices/${device}/state`, state);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.captures, { stored: 5 });
  const again = await req(`/devices/${device}/state`, state);
  assert.deepEqual(
    again.body.captures,
    { stored: 0 },
    "identical snapshots are stored once",
  );
  const list = await req(`/captures?account_id=${account}`);
  assert.equal(list.body.length, 5);
  const byPage = (page: string, tz = "Asia/Bangkok") =>
    list.body.find(
      (s: {
        page: string;
        reporting_context: { timezone: string; breakdown?: unknown };
      }) =>
        s.page === page &&
        s.reporting_context.timezone === tz &&
        s.reporting_context.breakdown !== undefined,
    );
  assert.equal(
    byPage("/adsmanager/manage/campaigns").review_status,
    "partially_promoted",
  );
  assert.equal(byPage("/adsmanager/manage/adsets").review_status, "promoted");
  assert.equal(byPage("/adsmanager/manage/ads").review_status, "promoted");
  const pending = byPage("/adsmanager/manage/campaigns", "unverified");
  assert.equal(pending.review_status, "needs_review");
  const unknownScope = list.body.find(
    (s: { reporting_context: { breakdown?: unknown } }) =>
      s.reporting_context.breakdown === undefined,
  );
  assert.equal(unknownScope.review_status, "needs_review");
  const unknownDetail = await req(`/captures/${unknownScope.id}`);
  assert.ok(
    unknownDetail.body.rows.every(
      (r: { review_reasons: string[] }) =>
        r.review_reasons.includes("breakdown_unverified") &&
        r.review_reasons.includes("filters_unverified"),
    ),
  );
  const detail = await req(
    `/captures/${byPage("/adsmanager/manage/campaigns").id}`,
  );
  const unverified = detail.body.rows.find(
    (r: { entity_id: string | null }) => !r.entity_id,
  );
  assert.equal(unverified.review_status, "needs_review");
  assert.ok(unverified.review_reasons.includes("stable_id_unverified"));
  let exported = await req(`/export?account_id=${account}`);
  assert.equal(exported.body.records.length, 3);
  assert.deepEqual(
    exported.body.records.map((r: { level: string }) => r.level).sort(),
    ["ad", "adset", "campaign"],
  );
  assert.ok(
    exported.body.records.every(
      (r: { raw: { _source: string } }) => r.raw._source === "dom_capture",
    ),
  );
  assert.ok(
    exported.body.records.every(
      (r: { breakdown?: unknown; raw: Record<string, string> }) =>
        r.breakdown !== undefined &&
        r.raw._dom_scope_version === "1" &&
        r.raw._dom_scope_filters === "[]",
    ),
  );
  // Operator confirmation cannot create an ID; it can confirm the timezone.
  const stillPending = await req(
    `/captures/${byPage("/adsmanager/manage/campaigns").id}/review`,
    { context: { timezone: "Asia/Bangkok" } },
  );
  assert.equal(stillPending.body.status, "partially_promoted");
  const confirmed = await req(`/captures/${pending.id}/review`, {
    context: { timezone: "Asia/Bangkok" },
  });
  assert.equal(confirmed.body.status, "promoted");
  assert.equal(
    (
      await req(`/captures/${pending.id}/review`, {
        context: { timezone: "Not/AZone" },
      })
    ).body.status,
    "promoted",
    "promoted rows stay promoted",
  );
  assert.equal(
    (
      await req(`/captures/${pending.id}/review`, {
        context: { selector: "x" },
      })
    ).status,
    400,
  );
  exported = await req(`/export?account_id=${account}`);
  assert.equal(exported.body.records.length, 4);
  const missingConfirmation = await req(`/captures/${unknownScope.id}/review`, {
    context: { timezone: "Asia/Bangkok" },
  });
  assert.equal(missingConfirmation.body.status, "needs_review");
  assert.equal(
    (
      await req(`/captures/${unknownScope.id}/review`, {
        context: { confirm_no_filters: false },
      })
    ).status,
    400,
  );
  const scopeConfirmed = await req(`/captures/${unknownScope.id}/review`, {
    context: {
      timezone: "Asia/Bangkok",
      confirm_no_breakdown: true,
      confirm_no_filters: true,
    },
  });
  assert.equal(scopeConfirmed.status, 200);
  assert.equal(scopeConfirmed.body.status, "promoted");
  const reviewedDetail = await req(`/captures/${unknownScope.id}`);
  assert.ok(
    reviewedDetail.body.rows.every(
      (r: {
        operator_context: {
          confirm_no_breakdown?: true;
          confirm_no_filters?: true;
        };
      }) =>
        r.operator_context.confirm_no_breakdown === true &&
        r.operator_context.confirm_no_filters === true,
    ),
  );
  exported = await req(`/export?account_id=${account}`);
  assert.equal(exported.body.records.length, 5);
  const reviewedRecord = exported.body.records.find(
    (r: { campaign_id: string }) => r.campaign_id === "555",
  );
  assert.deepEqual(JSON.parse(reviewedRecord.raw._dom_scope_provenance), {
    breakdown: "operator",
    filters: "operator",
  });
  const analysis = await req(`/captures/analysis?account_id=${account}`);
  assert.equal(analysis.status, 200);
  assert.equal(analysis.body.job.id, jobId);
  assert.deepEqual(
    analysis.body.job.level_warnings,
    ["ads: fixture paging incomplete"],
    "paging blockers must reach the operator",
  );
  assert.equal(
    (
      await req(
        `/captures/analysis?account_id=${account}&job_id=${randomUUID()}`,
      )
    ).status,
    404,
    "a missing job cannot produce an empty successful analysis",
  );
  const campaignsAnalyses = analysis.body.levels.filter(
    (l: { level: string }) => l.level === "campaigns",
  );
  assert.equal(
    campaignsAnalyses.length,
    3,
    "unknown timezone or missing breakdown/filter scope remain separate analysis scopes",
  );
  assert.equal(
    campaignsAnalyses.reduce(
      (n: number, l: { snapshots: number }) => n + l.snapshots,
      0,
    ),
    3,
  );
  assert.ok(
    campaignsAnalyses.every((l: { rows: { spend_source: string }[] }) =>
      l.rows.every((r) => r.spend_source === "column"),
    ),
  );
  assert.equal(
    analysis.body.data_quality.identity,
    "no_stable_ids",
    "the unverified campaign row has no ID",
  );
  assert.equal(
    (await req(`/captures/analysis?account_id=1${Date.now()}&job_id=${jobId}`))
      .status,
    404,
    "a job from another account is not returned",
  );
  assert.equal(
    (await fetch(`${base}/captures/analysis?account_id=${account}`)).status,
    401,
  );
  assert.equal(
    (await req(`/captures/analysis?account_id=1${Date.now()}`)).status,
    404,
  );
  assert.equal(
    (await req(`/captures/analysis?account_id=${account}&job_id=not-a-uuid`))
      .status,
    400,
  );
  const summary = await req(`/accounts/${account}/summary`);
  assert.equal(summary.body.campaigns, 3);
  assert.equal(summary.body.ads, 1);
  console.log(
    "Capture API integration (fixture) passed: raw snapshot persistence, idempotency, promotion of verified rows only, needs_review reasons, operator-confirmed timezone, export, job analysis endpoint",
  );
} finally {
  // Remove only fixture rows created by this test.
  await db.query(
    "DELETE FROM capture_rows WHERE snapshot_id IN (SELECT id FROM capture_snapshots WHERE bound_account=$1)",
    [account],
  );
  await db.query("DELETE FROM capture_snapshots WHERE bound_account=$1", [
    account,
  ]);
  await db.query("DELETE FROM capture_jobs WHERE account_id=$1", [account]);
  await db.query(
    "DELETE FROM insight_import_history WHERE job_id IN (SELECT id FROM import_jobs WHERE account_id=$1)",
    [account],
  );
  await db.query("DELETE FROM insight_observations WHERE account_id=$1", [
    account,
  ]);
  await db.query(
    "DELETE FROM data_quality_reports WHERE job_id IN (SELECT id FROM import_jobs WHERE account_id=$1)",
    [account],
  );
  await db.query(
    "DELETE FROM import_files WHERE job_id IN (SELECT id FROM import_jobs WHERE account_id=$1)",
    [account],
  );
  await db.query("DELETE FROM import_jobs WHERE account_id=$1", [account]);
  await db.query("DELETE FROM ads WHERE account_id=$1", [account]);
  await db.query("DELETE FROM ad_sets WHERE account_id=$1", [account]);
  await db.query("DELETE FROM campaigns WHERE account_id=$1", [account]);
  await db.query("DELETE FROM ad_accounts WHERE id=$1", [account]);
  await db.query("DELETE FROM bot_devices WHERE id=$1", [device]);
  await db.end();
}
