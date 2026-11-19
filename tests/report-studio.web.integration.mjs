// Isolated browser fixture for manual report rendering. No DB writes, Meta access
// or Extension commands; all API responses are synthetic.
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["packages/core/src/capture-analysis.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { analyzeCaptureJob } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

const snapshot = (adId, name, spend, results) => ({
  account_id: "123456789",
  reader_version: "0.6.41",
  page: "/adsmanager/manage/ads",
  captured_at: "2026-11-18T01:00:00Z",
  coverage: "visible_only",
  column_alignment: "aligned",
  reported_total_rows: 3,
  warnings: [],
  reporting_context: {
    date_range_label: "19 ต.ค. 2026 – 17 พ.ย. 2026",
    currency: "THB",
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    breakdown: {},
    filters: {},
  },
  row_observations: [
    {
      identity: adId,
      identity_source: "row_link_href",
      parent_ids: { campaign_id: "900", ad_set_id: null },
      name,
      method: "semantic",
      column_mapping: "semantic",
      warnings: [],
      cells: [
        { header: "Ad", text: name },
        { header: "Delivery", text: "ใช้งานอยู่" },
        { header: "Results", text: `${results}\nMessages` },
        { header: "Cost per result", text: `${(spend / results).toFixed(2)}` },
        { header: "Impressions", text: "10,000" },
        { header: "Amount spent", text: `฿${spend.toFixed(2)}` },
        { header: "Ad ID", text: adId },
        { header: "Attribution", text: "7-day click" },
      ],
    },
  ],
});

const analysis = analyzeCaptureJob([
  snapshot("111", "Ad Alpha", 500, 20),
  snapshot("222", "Ad Bravo", 250, 25),
  snapshot("333", "Ad Charlie", 800, 10),
]);
const response = {
  ...analysis,
  report_cached: true,
  job: {
    id: "00000000-0000-4000-8000-000000000001",
    status: "needs_review",
    extension_version: "0.6.41",
  },
  jobs: [
    {
      job_id: "00000000-0000-4000-8000-000000000001",
      captured_at: "2026-11-18T01:00:00Z",
      snapshots: 3,
    },
  ],
};
const dailyGroups = [
  {
    key: "fixture-daily",
    source: "csv",
    currency: "THB",
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "Messages",
    breakdown: {},
    points: [
      {
        date: "2026-11-01",
        records: 1,
        spend: 100,
        impressions: 1000,
        results: 10,
        cost_per_result: 10,
        cpm: 100,
      },
      {
        date: "2026-11-02",
        records: 1,
        spend: 140,
        impressions: 1200,
        results: 14,
        cost_per_result: 10,
        cpm: 116.67,
      },
    ],
    duplicate_grains: 0,
    date_start: "2026-11-01",
    date_end: "2026-11-02",
  },
];
const fixtureDevice = "00000000-0000-4000-8000-000000000010";
const workflowCommandId = "00000000-0000-4000-8000-000000000020";

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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const commandPayloads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/health"
        ? { ok: true }
        : path === "/api/dashboard"
          ? {
              accounts: ["123456789"],
              devices: [
                {
                  id: fixtureDevice,
                  account_id: "123456789",
                  enabled: "true",
                  updated_at: new Date().toISOString(),
                  job_status: "needs_review",
                },
              ],
            }
          : path === `/api/devices/${fixtureDevice}/state`
            ? {
                updated_at: new Date().toISOString(),
                state: {
                  bound_account: "123456789",
                  extension_version: "0.6.47",
                  report_input: true,
                  enabled: true,
                  job: response.job,
                },
              }
            : path === `/api/devices/${fixtureDevice}/commands` &&
                request.method() === "POST"
              ? (() => {
                  commandPayloads.push(request.postDataJSON());
                  return { id: workflowCommandId };
                })()
              : path ===
                  `/api/devices/${fixtureDevice}/commands/${workflowCommandId}`
                ? {
                    id: workflowCommandId,
                    status: "done",
                    command: commandPayloads[0],
                    created_at: new Date().toISOString(),
                    completed_at: new Date().toISOString(),
                    result: {
                      ok: true,
                      job: {
                        id: response.job.id,
                        status: "running",
                      },
                      collection: {
                        phase: "collection_started",
                        active: true,
                        job_id: response.job.id,
                        job_status: "running",
                      },
                    },
                  }
                : path === `/api/devices/${fixtureDevice}/commands`
                  ? []
                  : path === "/api/captures/analysis"
                    ? response
                    : path ===
                        `/api/captures/jobs/${response.job.id}/reconciliation`
                      ? {
                          reconciliation: [
                            {
                              filename: "meta-export.csv",
                              import_verified: true,
                              dom_rows: 3,
                              csv_rows: 3,
                              matched_ids: 3,
                              dom_only_ids: [],
                              csv_only_ids: [],
                              metrics: {
                                spend: {
                                  dom: 1550,
                                  csv: 1550,
                                  delta: 0,
                                  matched: true,
                                },
                                impressions: {
                                  dom: 30000,
                                  csv: 30000,
                                  delta: 0,
                                  matched: true,
                                },
                                results: {
                                  dom: 55,
                                  csv: 55,
                                  delta: 0,
                                  matched: true,
                                },
                              },
                              status: "matched",
                              notes: [],
                            },
                          ],
                        }
                      : path === "/api/reports/preferences"
                        ? {
                            preferences: {
                              goal: "messages",
                              target_cost_per_result: 15,
                              target_roas: 2.5,
                            },
                            updated_at: "2026-11-18T00:00:00Z",
                          }
                        : path ===
                            `/api/captures/jobs/${response.job.id}/materialization`
                          ? {
                              raw_rows: 87,
                              promoted_rows: 74,
                              needs_review_rows: 13,
                              verified_ads: 40,
                              normalized_ads: 35,
                              normalized_observations: 35,
                              reasons: ["missing_required_metric:impressions"],
                            }
                          : path === "/api/accounts/123456789/summary"
                            ? {
                                campaigns: 0,
                                ad_sets: 0,
                                ads: 3,
                                observations: 0,
                                imports: 0,
                              }
                            : path === "/api/captures"
                              ? []
                              : path === "/api/insights/trend"
                                ? { groups: dailyGroups }
                                : path === "/api/imports"
                                  ? []
                                  : {};
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("collectorToken", "fixture-only");
    localStorage.setItem("collectorAccount", "123456789");
    localStorage.setItem("collectorAdvancedMode", "true");
  });
  await page.goto("http://127.0.0.1:9321/?account=123456789#reports");
  await expect(
    page.getByRole("heading", { name: "ดูผลโฆษณา" }),
  ).toBeVisible();
  const pull = page.getByRole("button", { name: "ดึงข้อมูล Ads ใหม่" });
  await expect(pull).toBeEnabled();
  await pull.click();
  await expect.poll(() => commandPayloads.length).toBe(1);
  expect(commandPayloads[0]).toEqual({
    command: "report.collect",
    goal: "messages",
    maxSteps: 20,
    scan_columns: false,
  });
  await expect(
    page.getByText("เริ่ม Collection แล้ว Extension กำลังอ่านตาราง", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Command: done · Collection: running · กำลังทำงาน", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Ad Alpha", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Ad Bravo", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("35 / 40 Ads", { exact: true })).toBeVisible();
  await expect(page.getByText("5/6 ผ่าน", { exact: true })).toBeVisible();
  await expect(
    page.getByText("missing_required_metric:impressions", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /กราฟแท่งเปรียบเทียบ ยอดใช้จ่าย/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("meta-export.csv", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("กระทบยอดตรง", { exact: true })).toBeVisible();
  await expect(
    page.getByText("เป้าหมาย ฿15.00", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "ต้นทุนต่อผลลัพธ์", exact: true }).click();
  await expect(
    page.getByText("เส้นเป้าหมายที่ผู้ใช้กำหนด", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ผลลัพธ์", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: /กราฟแท่งเปรียบเทียบ ผลลัพธ์/,
    }),
  ).toBeVisible();
  await page.getByPlaceholder("ค้นหาชื่อหรือ ID").fill("Bravo");
  await expect(
    page.getByText("Ad Bravo", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Ad Charlie", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("ค้นหาชื่อหรือ ID").fill("");
  await page.getByRole("tab", { name: /ความสัมพันธ์/ }).click();
  await expect(
    page.getByRole("img", { name: /กราฟจุดความสัมพันธ์/ }),
  ).toBeVisible();
  if (process.env.REPORT_STUDIO_SCREENSHOT)
    await page.screenshot({
      path: process.env.REPORT_STUDIO_SCREENSHOT.replace(
        ".png",
        "-relationship.png",
      ),
      fullPage: true,
    });
  await page.getByRole("tab", { name: /การกระจาย/ }).click();
  await expect(
    page.getByRole("img", { name: /ฮิสโตแกรมการกระจาย/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^องค์ประกอบ/ }).click();
  await expect(
    page.getByRole("img", { name: /สัดส่วน Spend ตามสถานะการนำส่ง/ }),
  ).toBeVisible();
  if (process.env.REPORT_STUDIO_SCREENSHOT)
    await page.screenshot({
      path: process.env.REPORT_STUDIO_SCREENSHOT.replace(
        ".png",
        "-composition.png",
      ),
      fullPage: true,
    });
  await page.getByRole("tab", { name: /เส้นสะสม/ }).click();
  await expect(
    page.getByRole("img", { name: /กราฟเส้นสะสม Spend และ Results/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /แนวโน้ม/ }).click();
  await page.getByRole("button", { name: "ยอดใช้จ่าย", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /กราฟเส้นแนวโน้ม ยอดใช้จ่าย รายวัน/ }),
  ).toBeVisible();
  await page.getByText("ยืนยันบริบทที่ใช้ตีความรายงาน", { exact: true }).click();
  await expect(page.getByLabel("เขตเวลา (IANA)")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "บันทึกเป็นข้อมูลวิเคราะห์",
      exact: true,
    }),
  ).toBeVisible();
  if (process.env.REPORT_STUDIO_SCREENSHOT)
    await page.screenshot({
      path: process.env.REPORT_STUDIO_SCREENSHOT,
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Report studio web fixture passed: six chart views, metric switch, filtering, trend and mobile layout",
  );
} finally {
  await browser.close();
}
