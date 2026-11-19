// Isolated browser fixture for the Optimization Loop. All responses are
// synthetic; no Meta action, provider call or DB write occurs.
import { chromium, expect } from "@playwright/test";

const account = "123456789";
const recId = "00000000-0000-4000-8000-000000000101";
const planId = "00000000-0000-4000-8000-000000000102";
const experimentId = "00000000-0000-4000-8000-000000000103";
const now = new Date().toISOString();
let planStatus = "draft";
let experimentStatus = "draft";
const writes = [];

const recommendation = {
  id: recId,
  account_id: account,
  job_id: "00000000-0000-4000-8000-000000000104",
  scope_key: "fixture-scope",
  entity_id: "900000000000000001",
  action: "pause_candidate",
  title: "ตรวจสอบก่อนหยุด Ads ที่ต้นทุนสูง",
  rationale: "ต้นทุนต่อผลลัพธ์สูงกว่าค่ากลาง 45%",
  evidence: {
    name: "Fixture expensive Ad",
    delivery: "active",
    spend: 200,
    results: 10,
    cost_per_result: 20,
    peer_median_cost_per_result: 13.75,
    cost_ratio_to_median: 1.45,
  },
  confidence: "0.780",
  risk: "medium",
  expected_impact: {},
  status: "suggested",
  updated_at: now,
};

const plan = () => ({
  id: planId,
  title: recommendation.title,
  objective: "pause_candidate",
  status: planStatus,
  note: null,
  created_at: now,
  approved_at: planStatus === "approved" ? now : null,
  completed_at: null,
  steps: [
    {
      id: "00000000-0000-4000-8000-000000000105",
      sequence: 1,
      action: "pause_ad",
      target: recommendation.entity_id,
      payload: {},
      status: planStatus === "approved" ? "ready_for_local_review" : "pending",
      requires_approval: true,
    },
  ],
});

function workspace() {
  return {
    account_id: account,
    scope: {
      job_id: "00000000-0000-4000-8000-000000000104",
      job_status: "needs_review",
      captured_at: now,
      scope_key: "fixture-scope",
      coverage: "complete",
      blockers: [],
      verified_ads: 12,
      reported_ads: 12,
      context: {
        date_start: "2026-11-01",
        date_end: "2026-11-17",
        currency: "THB",
        timezone: "Asia/Bangkok",
        attribution: "7-day click",
      },
    },
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
    policy_updated_at: now,
    recommendations: [
      recommendation,
      {
        ...recommendation,
        id: "00000000-0000-4000-8000-000000000106",
        entity_id: "900000000000000002",
        action: "duplicate_winner",
        title: "โคลนผู้ชนะไปทดสอบในชุดใหม่",
        evidence: {
          ...recommendation.evidence,
          name: "Fixture winner Ad",
          spend: 50,
          results: 10,
          cost_per_result: 5,
        },
        confidence: "0.910",
        risk: "low",
      },
    ],
    plans: [plan()],
    experiments: [
      {
        id: experimentId,
        name: "Hook experiment",
        hypothesis: "A new hook lowers cost per message",
        primary_metric: "Cost per result",
        status: experimentStatus,
        planned_days: 7,
        arms: [
          { id: "control", label: "Control", description: null },
          { id: "variant", label: "Variant A", description: "New hook" },
        ],
      },
    ],
    creatives: [
      {
        id: "00000000-0000-4000-8000-000000000107",
        ad_id: "900000000000000002",
        asset_type: "copy",
        title: "Fixture winner Ad",
        body: "Message us today",
        headline: "Fast response",
        cta: "Send message",
        updated_at: now,
      },
    ],
    templates: [
      {
        id: "00000000-0000-4000-8000-000000000108",
        name: "Messages winner template",
        goal: "messages",
        config: { daily_budget: 200, create_as_paused: true },
        enabled: true,
      },
    ],
    outcomes: [],
    hierarchy_versions: { ad: 12 },
    capability: {
      automated_meta_mutation: false,
      reason: "Action execution still requires a certified Extension adapter and local popup approval",
    },
  };
}

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32"
    ? {
        executablePath:
          process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() : undefined;
    if (request.method() !== "GET") writes.push({ path, body });
    if (path === "/api/health") {
      await route.fulfill({ json: { status: "ready" } });
      return;
    }
    if (path === "/api/dashboard") {
      await route.fulfill({
        json: {
          accounts: [account],
          devices: [
            {
              id: "00000000-0000-4000-8000-000000000109",
              account_id: account,
              enabled: "true",
              updated_at: now,
              job_status: "needs_review",
            },
          ],
        },
      });
      return;
    }
    if (path === `/api/accounts/${account}/summary`) {
      await route.fulfill({
        json: {
          campaigns: 2,
          ad_sets: 2,
          ads: 12,
          observations: 12,
          imports: 0,
        },
      });
      return;
    }
    if (path === "/api/devices/00000000-0000-4000-8000-000000000109/state") {
      await route.fulfill({
        json: {
          updated_at: now,
          state: {
            bound_account: account,
            enabled: true,
            extension_version: "0.6.47",
            report_input: true,
            job: { status: "needs_review" },
          },
        },
      });
      return;
    }
    if (path === "/api/devices/00000000-0000-4000-8000-000000000109/commands") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/api/optimization/workspace") {
      await route.fulfill({ json: workspace() });
      return;
    }
    if (path === "/api/optimization/recommendations/rebuild") {
      await route.fulfill({
        json: {
          evaluation: { eligible_scope: true, warnings: [] },
          recommendations: [recommendation],
        },
      });
      return;
    }
    if (path === `/api/optimization/recommendations/${recId}/plan`) {
      await route.fulfill({ status: 201, json: plan() });
      return;
    }
    if (path === `/api/optimization/plans/${planId}/decision`) {
      planStatus = "approved";
      await route.fulfill({ json: plan() });
      return;
    }
    if (path === `/api/optimization/plans/${planId}/observe`) {
      await route.fulfill({
        json: {
          id: "00000000-0000-4000-8000-000000000110",
          entity_id: recommendation.entity_id,
          observation_window: "latest_capture",
        },
      });
      return;
    }
    if (path === `/api/optimization/experiments/${experimentId}/status`) {
      experimentStatus = "running";
      await route.fulfill({ json: { status: experimentStatus } });
      return;
    }
    if (path === "/api/optimization/experiments") {
      await route.fulfill({ status: 201, json: { id: experimentId } });
      return;
    }
    if (path === "/api/optimization/policies") {
      await route.fulfill({ json: { updated_at: now } });
      return;
    }
    if (path === "/api/optimization/creatives") {
      await route.fulfill({ status: 201, json: {} });
      return;
    }
    if (path === "/api/optimization/templates") {
      await route.fulfill({ status: 201, json: {} });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled ${path}` } });
  });
  await page.addInitScript((value) => {
    sessionStorage.setItem("collectorToken", "fixture-only");
    localStorage.setItem("collectorAccount", value);
    localStorage.setItem("collectorAdvancedMode", "true");
    localStorage.setItem(
      "collectorDevice",
      "00000000-0000-4000-8000-000000000109",
    );
  }, account);
  await page.goto(`http://127.0.0.1:9321/?account=${account}#optimization`);
  await expect(
    page.getByRole("heading", { name: "สิ่งที่ควรทำกับโฆษณา", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("สิ่งที่ควรทำตอนนี้", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Fixture expensive Ad", { exact: true })).toBeVisible();
  await expect(page.getByText("78% confidence", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "สร้างข้อเสนอใหม่" })
    .click();
  await expect.poll(() => writes.some((item) => item.path.endsWith("/rebuild")))
    .toBe(true);
  await page
    .getByRole("button", { name: "สร้างแผนดำเนินการ", exact: true })
    .first()
    .click();
  await expect.poll(() => writes.some((item) => item.path.endsWith("/plan")))
    .toBe(true);
  await page.getByRole("button", { name: "อนุมัติแผน", exact: true }).click();
  await expect.poll(() => planStatus).toBe("approved");
  await expect(page.getByRole("button", { name: "เริ่ม", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "เริ่ม", exact: true }).click();
  await expect.poll(() => experimentStatus).toBe("running");
  await expect(
    page.getByText("ยังไม่เปิด Meta mutation อัตโนมัติ", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Optimization web fixture passed: evidence ledger, rebuild, plan approval boundary, experiments and mobile layout",
  );
} finally {
  await browser.close();
}
