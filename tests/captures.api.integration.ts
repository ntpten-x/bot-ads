// Fixture-only API test for DOM capture persistence and promotion. Uses a random
// fixture account and device and deletes only the rows it created.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runCollectionSchedules } from "../apps/api/src/accounts.js";
import { runDataLifecycle } from "../apps/api/src/data-lifecycle.js";
import { captureAnalysisVersion } from "../packages/core/src/capture-analysis.js";
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
async function clientReq(tokenValue: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${tokenValue}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
async function patch(path: string, body: unknown) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const account = `9${Date.now()}`;
const device = randomUUID();
const jobId = randomUUID();
const adsOnlyJobId = randomUUID();
const optimizationJobId = randomUUID();
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
const adsCells = (spend: string, impressions: string, results: string) => [
  { header: "โฆษณา", text: "Ads-only fixture" },
  { header: "ชื่อแคมเปญ", text: "Ads-only campaign" },
  { header: "ชื่อชุดโฆษณา", text: "Ads-only ad set" },
  { header: "ผลลัพธ์", text: `${results}\nMessages` },
  { header: "จำนวนเงินที่ใช้จ่ายไป", text: spend },
  { header: "อิมเพรสชัน", text: impressions },
  { header: "การตั้งค่าการระบุที่มา", text: "7-day click" },
];
const adsOnlySnapshots = [
  snap(
    "/adsmanager/manage/ads",
    [
      obs(
        "777",
        { campaign_id: "888", ad_set_id: "999" },
        adsCells("฿50.00", "500", "5"),
      ),
    ],
    {
      captured_at: "2026-11-18T01:00:00.000Z",
      reporting_context: {
        date_range_label: "1 พ.ย. 2026 – 1 พ.ย. 2026",
        currency: "THB",
        timezone: "Asia/Bangkok",
        attribution: "7-day click",
      },
    },
  ),
  snap(
    "/adsmanager/manage/ads",
    [
      obs(
        "777",
        { campaign_id: "888", ad_set_id: "999" },
        adsCells("฿80.00", "800", "8"),
      ),
    ],
    {
      captured_at: "2026-11-18T01:00:01.000Z",
      reporting_context: {
        date_range_label: "2 พ.ย. 2026 – 2 พ.ย. 2026",
        currency: "THB",
        timezone: "Asia/Bangkok",
        attribution: "7-day click",
      },
    },
  ),
];
const adsOnlyState = {
  bound_account: account,
  enabled: true,
  report_input: true,
  extension_version: "0.6.41",
  job: {
    id: adsOnlyJobId,
    tabId: 1,
    account,
    levels: ["ads"],
    index: 1,
    step: 0,
    maxSteps: 20,
    status: "needs_review",
    level_warnings: [],
    snapshots: adsOnlySnapshots,
  },
};
const optimizationCells = (
  name: string,
  spend: string,
  impressions: string,
  results: string,
  costPerResult: string,
  budget: string,
) => [
  { header: "โฆษณา", text: name },
  { header: "ชื่อแคมเปญ", text: "Optimization campaign" },
  { header: "ชื่อชุดโฆษณา", text: "Optimization ad set" },
  { header: "ผลลัพธ์", text: `${results}\nMessages` },
  { header: "ต้นทุนต่อผลลัพธ์", text: costPerResult },
  { header: "จำนวนเงินที่ใช้จ่ายไป", text: spend },
  { header: "อิมเพรสชัน", text: impressions },
  { header: "การตั้งค่าการระบุที่มา", text: "7-day click" },
  { header: "Budget", text: budget },
];
const optimizationState = {
  bound_account: account,
  enabled: true,
  report_input: true,
  extension_version: "0.6.47",
  job: {
    id: optimizationJobId,
    tabId: 1,
    account,
    levels: ["ads"],
    index: 1,
    step: 0,
    maxSteps: 20,
    status: "needs_review",
    level_warnings: [],
    snapshots: [
      snap(
        "/adsmanager/manage/ads",
        [
          obs(
            "1101",
            { campaign_id: "1088", ad_set_id: "1099" },
            optimizationCells(
              "Optimization winner",
              "฿50.00",
              "500",
              "10",
              "฿5.00",
              "฿200.00",
            ),
          ),
          obs(
            "1102",
            { campaign_id: "1088", ad_set_id: "1099" },
            optimizationCells(
              "Optimization middle",
              "฿100.00",
              "1,000",
              "10",
              "฿10.00",
              "฿300.00",
            ),
          ),
          obs(
            "1103",
            { campaign_id: "1088", ad_set_id: "1099" },
            optimizationCells(
              "Optimization expensive",
              "฿200.00",
              "2,000",
              "10",
              "฿20.00",
              "฿400.00",
            ),
          ),
        ],
        {
          captured_at: "2026-11-18T02:00:00.000Z",
          reported_total_rows: 3,
          reporting_context: {
            date_range_label: "1 พ.ย. 2026 – 17 พ.ย. 2026",
            currency: "THB",
            timezone: "Asia/Bangkok",
            attribution: "7-day click",
            breakdown: {},
            filters: [],
          },
        },
      ),
    ],
  },
};
const state = {
  bound_account: account,
  enabled: true,
  report_input: true,
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
  const paged = await req(
    `/export?account_id=${account}&limit=2&offset=0&level=ad`,
  );
  assert.equal(paged.body.records.length, 1);
  assert.equal(paged.body.page.total, 1);
  assert.equal(paged.body.page.has_more, false);

  // Ads-only captures can materialize parent names from their visible columns
  // after the operator confirms filters and breakdown once at job level.
  const adsStored = await req(`/devices/${device}/state`, adsOnlyState);
  assert.deepEqual(adsStored.body.captures, { stored: 2 });
  const adsJobList = await req(`/captures?account_id=${account}`);
  assert.ok(
    adsJobList.body
      .filter((s: { job_id: string }) => s.job_id === adsOnlyJobId)
      .every((s: { review_status: string }) => s.review_status === "needs_review"),
  );
  const materialized = await req(
    `/captures/jobs/${adsOnlyJobId}/review?account_id=${account}`,
    {
      context: {
        timezone: "Asia/Bangkok",
        result_type: "Messages",
        confirm_no_breakdown: true,
        confirm_no_filters: true,
      },
    },
  );
  assert.equal(materialized.status, 200);
  assert.equal(materialized.body.status, "promoted");
  assert.equal(materialized.body.rows, 2);
  assert.equal(materialized.body.promoted, 2);
  assert.equal(materialized.body.unique_observations, 2);
  const catalog = await db.query(
    `SELECT count(*)::int AS count
     FROM ad_catalog
     WHERE account_id=$1 AND level='ad'`,
    [account],
  );
  assert.ok(catalog.rows[0].count > 0, "verified Ad IDs enter the catalog");
  const lifecycle = await req(
    `/data-lifecycle?account_id=${account}`,
  );
  assert.equal(lifecycle.status, 200);
  assert.ok(lifecycle.body.catalog.ads > 0);
  const lifecyclePreview = await req("/data-lifecycle/preview", {
    account_id: account,
  });
  assert.equal(lifecyclePreview.status, 200);
  assert.equal(lifecyclePreview.body.mode, "dry_run");
  const lifecycleImportJob = randomUUID();
  await db.query(
    `INSERT INTO import_jobs(id,account_id,fingerprint,status)
     VALUES($1,$2,$3,'completed')`,
    [lifecycleImportJob, account, `lifecycle-${lifecycleImportJob}`],
  );
  await db.query(
    `INSERT INTO insight_observations(
       grain_key,account_id,level,entity_id,date_start,date_end,currency,
       timezone,attribution,result_type,data,last_job_id
     ) VALUES(
       $1,$2,'ad','lifecycle-fixture','2025-01-01','2025-01-01','THB',
       'Asia/Bangkok','7-day click','Messages',$3,$4
     )`,
    [
      `lifecycle-fixture-${lifecycleImportJob}`,
      account,
      JSON.stringify({ spend: 100, impressions: 1000, results: 10 }),
      lifecycleImportJob,
    ],
  );
  const oldSnapshot = await db.query(
    `SELECT id FROM capture_snapshots
     WHERE bound_account=$1 AND review_status='promoted' AND job_id<>$2
     ORDER BY captured_at LIMIT 1`,
    [account, adsOnlyJobId],
  );
  assert.equal(oldSnapshot.rowCount, 1);
  const retainedSnapshotId = randomUUID();
  await db.query(
    `INSERT INTO capture_snapshots(
       id,fingerprint,job_id,device_id,bound_account,account_id,page,level,
       captured_at,reader_version,format,coverage,column_alignment,
       reporting_context,warnings,row_count,review_status,review_reasons,raw
     )
     SELECT
       $1,$2,job_id,device_id,bound_account,account_id,page,level,
       now()-interval '60 days',reader_version,format,coverage,column_alignment,
       reporting_context,warnings,row_count,'needs_review','[]',raw
     FROM capture_snapshots WHERE id=$3`,
    [
      retainedSnapshotId,
      `lifecycle-retained-${retainedSnapshotId}`,
      oldSnapshot.rows[0].id,
    ],
  );
  await db.query(
    "UPDATE capture_snapshots SET captured_at=now()-interval '60 days' WHERE id=$1",
    [oldSnapshot.rows[0].id],
  );
  const appliedLifecycle = await runDataLifecycle(db, {
    apply: true,
    accountId: account,
  });
  assert.equal(appliedLifecycle.mode, "apply");
  assert.ok(appliedLifecycle.deleted.daily_observations >= 1);
  assert.ok(appliedLifecycle.deleted.raw_snapshots >= 1);
  const rolledUp = await db.query(
    `SELECT spend,impressions,results
     FROM ad_performance_monthly
     WHERE account_id=$1 AND entity_id='lifecycle-fixture'`,
    [account],
  );
  assert.equal(rolledUp.rowCount, 1);
  assert.equal(Number(rolledUp.rows[0].spend), 100);
  assert.equal(Number(rolledUp.rows[0].results), 10);
  const retainedReview = await db.query(
    `SELECT count(*)::int AS count FROM capture_snapshots
     WHERE bound_account=$1 AND review_status='needs_review'`,
    [account],
  );
  assert.ok(retainedReview.rows[0].count > 0);
  const cachedReport = await req(
    `/captures/analysis?account_id=${account}&job_id=${adsOnlyJobId}&timezone=Asia%2FBangkok&result_type=Messages&confirm_no_filters=true&confirm_no_breakdown=true`,
  );
  assert.equal(cachedReport.status, 200);
  assert.equal(cachedReport.body.report_cached, true);
  assert.equal(cachedReport.body.levels[0].verified_unique_rows, 1);
  await db.query(
    "UPDATE capture_job_reports SET analyzer_version=0 WHERE job_id=$1",
    [adsOnlyJobId],
  );
  const recomputedReport = await req(
    `/captures/analysis?account_id=${account}&job_id=${adsOnlyJobId}&timezone=Asia%2FBangkok&result_type=Messages&confirm_no_filters=true&confirm_no_breakdown=true`,
  );
  assert.equal(recomputedReport.status, 200);
  assert.equal(
    recomputedReport.body.report_cached,
    false,
    "an old analyzer cache must be recomputed",
  );
  const recached = await db.query(
    "SELECT analyzer_version FROM capture_job_reports WHERE job_id=$1",
    [adsOnlyJobId],
  );
  assert.equal(recached.rows[0].analyzer_version, captureAnalysisVersion);
  const materializationStatus = await req(
    `/captures/jobs/${adsOnlyJobId}/materialization?account_id=${account}`,
  );
  assert.equal(materializationStatus.status, 200);
  assert.equal(materializationStatus.body.verified_ads, 1);
  assert.equal(materializationStatus.body.normalized_ads, 1);
  assert.equal(materializationStatus.body.normalized_observations, 2);
  // Optimization loop fixture: complete three-Ad scope with deterministic
  // winner/middle/expensive cohorts. APIs only create plans and records; they
  // never dispatch a Meta mutation.
  const optimizationStored = await req(
    `/devices/${device}/state`,
    optimizationState,
  );
  assert.deepEqual(optimizationStored.body.captures, { stored: 1 });
  const optimizationReviewed = await req(
    `/captures/jobs/${optimizationJobId}/review?account_id=${account}`,
    {
      context: {
        timezone: "Asia/Bangkok",
        confirm_no_breakdown: true,
        confirm_no_filters: true,
      },
    },
  );
  assert.equal(optimizationReviewed.status, 200);
  const optimizationAnalysis = await req(
    `/captures/analysis?account_id=${account}&job_id=${optimizationJobId}&timezone=Asia%2FBangkok&confirm_no_filters=true&confirm_no_breakdown=true`,
  );
  assert.equal(optimizationAnalysis.status, 200);
  const rebuilt = await req(
    "/optimization/recommendations/rebuild",
    { account_id: account, job_id: optimizationJobId },
  );
  assert.equal(rebuilt.status, 200, JSON.stringify(rebuilt.body));
  assert.equal(
    rebuilt.body.evaluation.eligible_scope,
    true,
    JSON.stringify(rebuilt.body.evaluation),
  );
  assert.equal(rebuilt.body.evaluation.peers, 3);
  const actions = rebuilt.body.recommendations.map(
    (item: { action: string; entity_id: string }) => [
      item.entity_id,
      item.action,
    ],
  );
  assert.deepEqual(actions, [
    ["1103", "pause_candidate"],
    ["1101", "scale_budget"],
    ["1102", "create_new_test"],
  ]);
  const dismissedRecommendation = rebuilt.body.recommendations.find(
    (item: { action: string }) => item.action === "create_new_test",
  );
  assert.equal(
    (
      await req(
        `/optimization/recommendations/${dismissedRecommendation.id}/dismiss`,
        { account_id: account },
      )
    ).status,
    200,
  );
  const rebuiltAgain = await req(
    "/optimization/recommendations/rebuild",
    { account_id: account, job_id: optimizationJobId },
  );
  assert.equal(
    rebuiltAgain.body.recommendations.find(
      (item: { id: string }) => item.id === dismissedRecommendation.id,
    ).status,
    "dismissed",
    "dismissed recommendations stay dismissed across rebuilds",
  );
  const pauseRecommendation = rebuilt.body.recommendations.find(
    (item: { action: string }) => item.action === "pause_candidate",
  );
  const createdPlan = await req(
    `/optimization/recommendations/${pauseRecommendation.id}/plan`,
    { account_id: account },
  );
  assert.equal(createdPlan.status, 201);
  assert.equal(createdPlan.body.status, "draft");
  assert.equal(createdPlan.body.steps[0].action, "pause_ad");
  assert.equal(createdPlan.body.steps[0].requires_approval, true);
  const approvedPlan = await req(
    `/optimization/plans/${createdPlan.body.id}/decision`,
    { account_id: account, approved: true },
  );
  assert.equal(approvedPlan.body.status, "approved");
  const observedPlan = await req(
    `/optimization/plans/${createdPlan.body.id}/observe`,
    { account_id: account },
  );
  assert.equal(observedPlan.status, 200);
  assert.equal(observedPlan.body.entity_id, "1103");
  const verifiedPlan = await req(
    `/optimization/plans/${createdPlan.body.id}/result`,
    {
      account_id: account,
      status: "verified",
      evidence: { readback: "fixture-observation" },
    },
  );
  assert.equal(verifiedPlan.status, 200);
  assert.equal(verifiedPlan.body.status, "verified");
  assert.equal(verifiedPlan.body.receipts.length, 1);
  assert.equal(verifiedPlan.body.rollbacks.length, 1);
  const experiment = await req("/optimization/experiments", {
    account_id: account,
    name: "Hook experiment",
    hypothesis: "A new hook lowers cost per message",
    objective: "messages",
    primary_metric: "Cost per result",
    guardrails: ["Frequency"],
    min_spend: 50,
    min_results: 5,
    planned_days: 7,
    arms: [
      { label: "Control" },
      { label: "Variant A", description: "New hook" },
    ],
  });
  assert.equal(experiment.status, 201);
  const experimentList = await req(
    `/optimization/experiments?account_id=${account}`,
  );
  const experimentFixture = experimentList.body.find(
    (item: { id: string }) => item.id === experiment.body.id,
  );
  assert.equal(
    (
      await req(`/optimization/experiments/${experiment.body.id}/status`, {
        account_id: account,
        status: "running",
      })
    ).body.status,
    "running",
  );
  const experimentObservation = await req(
    `/optimization/experiments/${experiment.body.id}/observations`,
    {
      account_id: account,
      arm_id: experimentFixture.arms[0].id,
      metrics: { spend: 50, results: 10, cost_per_result: 5 },
      evidence: { source: "fixture" },
    },
  );
  assert.equal(experimentObservation.status, 201);
  const creative = await req("/optimization/creatives", {
    account_id: account,
    ad_id: "1101",
    asset_type: "copy",
    headline: "Fixture headline",
    body: "Fixture body",
    cta: "Send message",
    metadata: { format: "image" },
  });
  assert.equal(creative.status, 201);
  const template = await req("/optimization/templates", {
    account_id: account,
    name: "Messages winner template",
    goal: "messages",
    config: { daily_budget: 200, create_as_paused: true },
  });
  assert.equal(template.status, 201);
  const optimizationScopeKey = optimizationAnalysis.body.levels[0].scope_key;
  await db.query(
    `INSERT INTO optimization_recommendations(
       id,account_id,job_id,scope_key,source_key,entity_type,entity_id,
       action,title,rationale,evidence,confidence,risk,expected_impact,status
     ) VALUES($1,$2,$3,$4,$5,'ad','999','pause_candidate',
       'Unsupported old recommendation','Fixture stale evidence',
       '{}'::jsonb,0.9,'medium','{}'::jsonb,'suggested')`,
    [
      randomUUID(),
      account,
      optimizationJobId,
      optimizationScopeKey,
      `${optimizationScopeKey}:999:pause_candidate`,
    ],
  );
  await db.query(
    "UPDATE capture_job_reports SET analyzer_version=0 WHERE job_id=$1",
    [optimizationJobId],
  );
  const optimizationWorkspace = await req(
    `/optimization/workspace?account_id=${account}`,
  );
  assert.equal(optimizationWorkspace.status, 200);
  assert.equal(optimizationWorkspace.body.scope.coverage, "complete");
  assert.equal(optimizationWorkspace.body.recommendations.length, 3);
  assert.equal(optimizationWorkspace.body.plans.length, 1);
  assert.equal(optimizationWorkspace.body.experiments.length, 1);
  assert.equal(
    optimizationWorkspace.body.experiments[0].observation_count,
    1,
  );
  assert.equal(optimizationWorkspace.body.creatives.length >= 3, true);
  assert.equal(optimizationWorkspace.body.templates.length, 1);
  assert.equal(optimizationWorkspace.body.outcomes.length, 1);
  assert.equal(
    optimizationWorkspace.body.capability.automated_meta_mutation,
    false,
  );
  const refreshedOptimizationCache = await db.query(
    "SELECT analyzer_version FROM capture_job_reports WHERE job_id=$1",
    [optimizationJobId],
  );
  assert.ok(
    refreshedOptimizationCache.rows.every(
      (row) => row.analyzer_version === captureAnalysisVersion,
    ),
    "Optimization Workspace must refresh stale report caches before selecting a scope",
  );
  const emptyOptimizationJob = randomUUID();
  const emptyOptimizationState = {
    ...optimizationState,
    job: {
      ...optimizationState.job,
      id: emptyOptimizationJob,
      snapshots: [],
      status: "needs_review",
    },
  };
  await req(`/devices/${device}/state`, emptyOptimizationState);
  await req(
    `/captures/jobs/${emptyOptimizationJob}/review?account_id=${account}`,
    {},
  );
  const fallbackWorkspace = await req(
    `/optimization/workspace?account_id=${account}`,
  );
  assert.equal(fallbackWorkspace.status, 200);
  assert.ok(fallbackWorkspace.body.scope);
  assert.notEqual(fallbackWorkspace.body.scope.job_id, emptyOptimizationJob);
  assert.equal(fallbackWorkspace.body.scope.coverage, "complete");
  const trend = await req(`/insights/trend?account_id=${account}`);
  assert.equal(trend.status, 200);
  assert.equal(trend.body.groups.length, 1);
  assert.equal(trend.body.groups[0].source, "dom_capture");
  assert.equal(trend.body.groups[0].points.length, 2);
  assert.equal(trend.body.groups[0].points[0].spend, 50);
  assert.equal(trend.body.groups[0].points[1].results, 8);
  const afterMaterialize = await req(
    `/export?account_id=${account}&source=dom_capture&date_from=2026-11-01&date_to=2026-11-02`,
  );
  assert.equal(afterMaterialize.body.records.length, 2);
  const csvHeader =
    "account_id,campaign_id,campaign_name,ad_set_id,ad_set_name,ad_id,ad_name,date_start,date_end,currency,timezone,attribution,result_type,spend,impressions,results";
  const csv = [
    csvHeader,
    `${account},888,Ads-only campaign,999,Ads-only ad set,777,Ads-only fixture,2026-11-01,2026-11-01,THB,Asia/Bangkok,7-day click,Messages,50,500,5`,
    `${account},888,Ads-only campaign,999,Ads-only ad set,777,Ads-only fixture,2026-11-02,2026-11-02,THB,Asia/Bangkok,7-day click,Messages,80,800,8`,
  ].join("\n");
  const imported = await req("/imports", {
    filename: "ads-only.csv",
    csv,
    expected_account_id: account,
    context: {
      timezone: "Asia/Bangkok",
      attribution: "7-day click",
      result_type: "Messages",
    },
    expected: {
      rows: 2,
      spend: 130,
    },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const adsAnalysis = await req(
    `/captures/analysis?account_id=${account}&job_id=${adsOnlyJobId}&timezone=Asia%2FBangkok&confirm_no_filters=true&confirm_no_breakdown=true`,
  );
  const adsScope = adsAnalysis.body.levels.find(
    (level: { level: string }) => level.level === "ads",
  );
  const reconciled = await req(
    `/captures/jobs/${adsOnlyJobId}/reconciliation?account_id=${account}&scope_key=${encodeURIComponent(adsScope.scope_key)}&timezone=Asia%2FBangkok&confirm_no_filters=true&confirm_no_breakdown=true`,
  );
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reconciliation.length, 1);
  assert.equal(reconciled.body.reconciliation[0].filename, "ads-only.csv");
  assert.equal(reconciled.body.reconciliation[0].status, "matched");
  assert.equal(reconciled.body.reconciliation[0].matched_ids, 1);
  assert.equal(reconciled.body.reconciliation[0].metrics.spend.delta, 0);
  assert.deepEqual(
    (await req(`/reports/preferences?account_id=${account}`)).body.preferences,
    {
      goal: "messages",
      target_cost_per_result: null,
      target_roas: null,
    },
  );
  const preferences = await req("/reports/preferences", {
    account_id: account,
    preferences: {
      goal: "sales",
      target_cost_per_result: 12.5,
      target_roas: 2.8,
    },
  });
  assert.equal(preferences.status, 200);
  assert.deepEqual(preferences.body.preferences, {
    goal: "sales",
    target_cost_per_result: 12.5,
    target_roas: 2.8,
  });
  const summary = await req(`/accounts/${account}/summary`);
  assert.equal(summary.body.campaigns, 5);
  assert.equal(summary.body.ads, 5);
  const customer = await req("/customers", {
    name: `Fixture customer ${Date.now()}`,
  });
  assert.equal(customer.status, 201);
  await req(`/customers/${customer.body.id}/accounts`, {
    account_id: account,
    display_name: "Fixture managed account",
  });
  const operator = await req(`/customers/${customer.body.id}/clients`, {
    name: "Fixture operator",
    role: "operator",
  });
  assert.equal(operator.status, 201);
  assert.equal(operator.body.token.length, 64);
  const storedClient = await db.query(
    "SELECT token_hash FROM api_clients WHERE id=$1",
    [operator.body.id],
  );
  assert.notEqual(storedClient.rows[0].token_hash, operator.body.token);
  assert.equal(storedClient.rows[0].token_hash.length, 64);
  const pairedDevice = await req(`/devices/${device}/pair`, {
    account_id: account,
  });
  assert.equal(pairedDevice.status, 201);
  assert.equal(pairedDevice.body.credential.length, 64);
  const storedDevice = await db.query(
    "SELECT token_hash FROM device_credentials WHERE device_id=$1",
    [device],
  );
  assert.notEqual(storedDevice.rows[0].token_hash, pairedDevice.body.credential);
  const pairedState = await fetch(`${base}/devices/${device}/state`, {
    headers: { Authorization: `Bearer ${pairedDevice.body.credential}` },
  });
  assert.equal(pairedState.status, 200);
  const pairedOtherAccount = await fetch(
    `${base}/devices/${device}/state?account_id=1${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${pairedDevice.body.credential}` },
    },
  );
  assert.equal(pairedOtherAccount.status, 403);
  const scopedAccounts = await clientReq(
    operator.body.token,
    "/managed-accounts",
  );
  assert.equal(scopedAccounts.status, 200);
  assert.deepEqual(
    scopedAccounts.body.map((item: { account_id: string }) => item.account_id),
    [account],
  );
  assert.equal(
    (await clientReq(operator.body.token, `/export?account_id=${account}`))
      .status,
    200,
  );
  assert.equal(
    (
      await clientReq(
        operator.body.token,
        `/export?account_id=1${Date.now()}`,
      )
    ).status,
    403,
  );
  const otherCustomerAccount = `9${Date.now() + 1}`;
  await req(`/customers/${customer.body.id}/accounts`, {
    account_id: otherCustomerAccount,
  });
  const limitedOperator = await req(
    `/customers/${customer.body.id}/clients`,
    {
      name: "Fixture limited operator",
      role: "operator",
      all_accounts: false,
      account_ids: [account],
    },
  );
  assert.equal(limitedOperator.status, 201);
  assert.equal(limitedOperator.body.all_accounts, false);
  const limitedMe = await clientReq(
    limitedOperator.body.token,
    "/auth/me",
  );
  assert.deepEqual(limitedMe.body.accounts, [account]);
  assert.equal(limitedMe.body.all_accounts, false);
  const limitedAccounts = await clientReq(
    limitedOperator.body.token,
    "/managed-accounts",
  );
  assert.deepEqual(
    limitedAccounts.body.map((item: { account_id: string }) => item.account_id),
    [account],
  );
  assert.equal(
    (
      await clientReq(
        limitedOperator.body.token,
        `/export?account_id=${otherCustomerAccount}`,
      )
    ).status,
    403,
  );
  const limitedCustomers = await clientReq(
    limitedOperator.body.token,
    "/customers",
  );
  assert.equal(limitedCustomers.body[0].account_count, 1);
  const expandedAccess = await req(
    `/customers/${customer.body.id}/clients/${limitedOperator.body.id}`,
    { all_accounts: true },
  );
  assert.equal(expandedAccess.status, 200);
  assert.equal(expandedAccess.body.all_accounts, true);
  const expandedAccounts = await clientReq(
    limitedOperator.body.token,
    "/managed-accounts",
  );
  assert.equal(expandedAccounts.body.length, 2);
  const viewer = await req(`/customers/${customer.body.id}/clients`, {
    name: "Fixture viewer",
    role: "viewer",
  });
  assert.equal(
    (
      await clientReq(viewer.body.token, "/reports/preferences", {
        account_id: account,
        preferences: {
          goal: "messages",
          target_cost_per_result: null,
          target_roas: null,
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await clientReq(viewer.body.token, "/optimization/policies", {
        account_id: account,
        policy: {
          enabled: true,
          min_results: 5,
          min_spend: 50,
          min_peer_rows: 3,
          scale_ratio: 0.75,
          pause_ratio: 1.3,
          max_budget_change_pct: 20,
          require_experiment_for_new: true,
          allow_create_campaign_draft: true,
        },
      })
    ).status,
    403,
  );
  const customerAdmin = await req(`/customers/${customer.body.id}/clients`, {
    name: "Fixture customer admin",
    role: "admin",
  });
  const scopedCustomers = await clientReq(
    customerAdmin.body.token,
    "/customers",
  );
  assert.equal(scopedCustomers.status, 200);
  assert.deepEqual(
    scopedCustomers.body.map((item: { id: string }) => item.id),
    [customer.body.id],
    "a customer-scoped admin token must not list other customers",
  );
  await req(`/devices/${device}/state`, {
    ...optimizationState,
    job: {
      ...optimizationState.job,
      status: "needs_review",
      snapshots: [],
    },
  });
  const schedule = await patch(
    `/managed-accounts/${account}/schedule`,
    { enabled: true, interval_minutes: 60 },
  );
  assert.equal(schedule.status, 200);
  assert.equal(schedule.body.auto_enabled, true);
  const scheduledRuns = await runCollectionSchedules(db);
  assert.ok(
    scheduledRuns.some(
      (item) => item.account_id === account && item.status === "queued",
    ),
    `a due schedule with a fresh read-enabled device must queue report.collect: ${JSON.stringify(scheduledRuns)}`,
  );
  const scheduledCommand = await db.query(
    `SELECT command FROM bot_commands
     WHERE device_id=$1 AND command->>'command'='report.collect'
     ORDER BY created_at DESC LIMIT 1`,
    [device],
  );
  assert.equal(scheduledCommand.rows[0].command.maxSteps, 60);
  assert.equal(scheduledCommand.rows[0].command.scan_columns, false);
  assert.equal(
    (
      await patch(`/managed-accounts/${account}/schedule`, {
        enabled: false,
        interval_minutes: 60,
      })
    ).status,
    200,
  );
  const clientList = await req(`/customers/${customer.body.id}/clients`);
  assert.equal(clientList.status, 200);
  assert.ok(
    clientList.body.every(
      (item: Record<string, unknown>) =>
        !("token_hash" in item) && !("token" in item),
    ),
  );
  const revoked = await patch(
    `/customers/${customer.body.id}/clients/${operator.body.id}`,
    { enabled: false },
  );
  assert.equal(revoked.status, 200);
  assert.equal(
    (await clientReq(operator.body.token, "/auth/me")).status,
    401,
    "revoked client tokens must fail immediately",
  );
  const audit = await req("/audit-log?limit=100");
  assert.equal(audit.status, 200);
  assert.ok(
    audit.body.some(
      (item: { action: string }) => item.action === "client_token_revoked",
    ),
  );
  assert.ok(
    audit.body.some(
      (item: { action: string }) =>
        item.action === "optimization_plan_approved",
    ),
    "optimization approvals must be auditable",
  );
  const disabled = await req(`/managed-accounts/${account}`, {
    enabled: false,
  });
  assert.equal(disabled.status, 200);
  assert.equal(
    (await req(`/devices/${device}/state`, state)).status,
    403,
    "disabled accounts must not ingest new capture state",
  );
  assert.equal(
    (
      await req("/analysis/preview", {
        goal: "messages",
        input: {
          filename: "blocked.csv",
          csv:
            "account_id,campaign_id,campaign_name,level,date_start,date_end,currency,timezone,attribution,result_type,spend,impressions\n" +
            `${account},111,Fixture campaign,campaign,2026-11-01,2026-11-01,THB,Asia/Bangkok,7-day click,Messages,1,1`,
          expected_account_id: account,
          context: {
            timezone: "Asia/Bangkok",
            attribution: "7-day click",
            result_type: "Messages",
          },
          expected: {},
        },
      })
    ).status,
    403,
    "disabled accounts must not run analysis previews",
  );
  await req(`/managed-accounts/${account}`, { enabled: true });
  console.log(
    "Capture API integration (fixture) passed: raw persistence, Ads materialization, optimization recommendations/plans/experiments/outcomes, scheduling, audit and customer isolation",
  );
} finally {
  // Remove only fixture rows created by this test.
  await db.query(
    "DELETE FROM capture_rows WHERE snapshot_id IN (SELECT id FROM capture_snapshots WHERE bound_account=$1)",
    [account],
  );
  await db.query("DELETE FROM ad_status_history WHERE account_id=$1", [
    account,
  ]);
  await db.query("DELETE FROM ad_catalog WHERE account_id=$1", [account]);
  await db.query("DELETE FROM ad_performance_monthly WHERE account_id=$1", [
    account,
  ]);
  await db.query("DELETE FROM data_lifecycle_runs WHERE account_id=$1", [
    account,
  ]);
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
  await db.query("DELETE FROM report_preferences WHERE account_id=$1", [
    account,
  ]);
  await db.query(
    "DELETE FROM managed_accounts WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE 'Fixture customer %')",
  );
  await db.query(
    "DELETE FROM admin_audit_log WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE 'Fixture customer %') OR target=$1",
    [account],
  );
  await db.query("DELETE FROM customers WHERE name LIKE 'Fixture customer %'");
  await db.query("DELETE FROM bot_devices WHERE id=$1", [device]);
  await db.query("DELETE FROM bot_commands WHERE device_id=$1", [device]);
  await db.end();
}
