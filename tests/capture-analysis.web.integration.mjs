// Isolated browser fixture: real Next UI + current core analysis, no DB writes or Meta access.
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
const snapshot = (at, cells) => ({
  account_id: "123456789",
  reader_version: "0.6.3",
  page: "/adsmanager/manage/ads",
  captured_at: at,
  coverage: "visible_only",
  column_alignment: "aligned",
  reported_total_rows: 1,
  warnings: [],
  reporting_context: {
    date_range_label: "14 Nov 2026 – 14 Nov 2026",
    currency: "THB",
    timezone: "unverified",
    attribution: "unverified",
  },
  row_observations: [
    {
      identity: null,
      identity_source: null,
      parent_ids: {},
      name: "Synthetic Ad",
      method: "geometry",
      column_mapping: "unverified",
      warnings: [],
      cells,
    },
  ],
});
const analysis = analyzeCaptureJob([
  snapshot("2026-11-15T01:00:00Z", [
    { header: "Ad", text: "Synthetic Ad" },
    { header: "Results", text: "5\nMessages" },
    { header: "Cost per result", text: "10" },
  ]),
  snapshot("2026-11-15T01:00:01Z", [
    { header: "Ad", text: "Synthetic Ad" },
    { header: "Amount spent", text: "50" },
  ]),
]);
const response = {
  ...analysis,
  job: {
    id: "00000000-0000-4000-8000-000000000001",
    status: "needs_review",
    extension_version: "0.6.3",
  },
  jobs: [],
};
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
  const reviewPayloads = [];
  const captures = [2, 3].map((n) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    job_id: response.job.id,
    account_id: "123456789",
    page: "/adsmanager/manage/ads",
    level: "ads",
    captured_at: "2026-11-15T01:00:00Z",
    reader_version: "0.6.22",
    coverage: "visible_only",
    column_alignment: "aligned",
    reporting_context: { currency: "THB", timezone: "unverified" },
    row_count: 1,
    rows_with_id: 0,
    promoted_rows: 0,
    review_status: "needs_review",
    review_reasons: ["stable_id_unverified"],
  }));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "POST" && u.pathname.endsWith("/review")) {
      reviewPayloads.push(route.request().postDataJSON());
      await route.fulfill({
        json: { status: "needs_review", promoted: 0, rows: 1 },
      });
      return;
    }
    const data =
      u.pathname === "/api/dashboard"
        ? { accounts: ["123456789"], devices: [] }
        : u.pathname === "/api/captures/analysis"
          ? response
          : u.pathname === "/api/captures"
            ? captures
            : u.pathname.startsWith("/api/captures/")
              ? {
                  ...captures.find((c) => u.pathname.endsWith(c.id)),
                  rows: [
                    {
                      row_index: 0,
                      entity_id: null,
                      identity_source: null,
                      name: "Synthetic Ad",
                      method: "geometry",
                      column_mapping: "unverified",
                      cells: [],
                      review_status: "needs_review",
                      review_reasons: ["stable_id_unverified"],
                    },
                  ],
                }
              : {
                  campaigns: 0,
                  ad_sets: 0,
                  ads: 0,
                  observations: 0,
                  imports: 0,
                };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("collectorToken", "fixture-only");
    localStorage.setItem("collectorAccount", "123456789");
  });
  await page.goto(
    (process.env.WEB_TEST_URL ?? "http://127.0.0.1:9321") +
      "/?account=123456789",
  );
  await page
    .locator("nav")
    .getByRole("button", { name: "ข้อมูลจาก Extension", exact: true })
    .click();
  await expect(
    page.getByText("ยังยืนยันจำนวนแอดไม่ได้", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText("ยอดใช้จ่ายหลายแหล่งหรือบางรายการยังขาด", { exact: false })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("ครบตามที่ Meta แจ้ง", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("ยังไม่มีอันดับที่ผ่านเกณฑ์", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic Ad", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "ดูแถว", exact: true }).first().click();
  const noBreakdown = page.getByRole("checkbox", {
    name: "ยืนยันว่าไม่มีการแจกแจงข้อมูล (Breakdown)",
    exact: true,
  });
  const noFilters = page.getByRole("checkbox", {
    name: "ยืนยันว่าไม่มีตัวกรองรายงาน",
    exact: true,
  });
  await expect(noBreakdown).not.toBeChecked();
  await expect(noFilters).not.toBeChecked();
  await page
    .getByRole("button", { name: "ตรวจซ้ำและยกแถวที่ครบเงื่อนไข", exact: true })
    .click();
  await expect.poll(() => reviewPayloads.length).toBe(1);
  expect(reviewPayloads[0]).toEqual({});
  await noBreakdown.check();
  await noFilters.check();
  await page.getByRole("button", { name: "ดูแถว", exact: true }).nth(1).click();
  await expect(noBreakdown).not.toBeChecked();
  await expect(noFilters).not.toBeChecked();
  await noBreakdown.check();
  await noFilters.check();
  await page
    .getByRole("button", { name: "ตรวจซ้ำและยกแถวที่ครบเงื่อนไข", exact: true })
    .click();
  await expect.poll(() => reviewPayloads.length).toBe(2);
  expect(reviewPayloads[1]).toEqual({
    context: { confirm_no_breakdown: true, confirm_no_filters: true },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Capture analysis web fixture passed: unresolved evidence, honest mixed spend, blocked ranking, mobile layout",
  );
} finally {
  await browser.close();
}
