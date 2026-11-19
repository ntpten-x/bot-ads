// Fixture for the default guided mode shown to non-technical users.
import { chromium, expect } from "@playwright/test";

const account = "123456789";
const device = "00000000-0000-4000-8000-000000000201";
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/health"
        ? { status: "ready" }
        : path === "/api/dashboard"
          ? {
              accounts: [account],
              devices: [
                {
                  id: device,
                  account_id: account,
                  enabled: "true",
                  updated_at: new Date().toISOString(),
                  job_status: "needs_review",
                },
              ],
            }
          : path === `/api/accounts/${account}/summary`
            ? {
                campaigns: 3,
                ad_sets: 5,
                ads: 18,
                observations: 18,
                imports: 0,
              }
            : path === `/api/devices/${device}/state`
              ? {
                  updated_at: new Date().toISOString(),
                  state: {
                    bound_account: account,
                    enabled: true,
                    report_input: true,
                    extension_version: "0.6.48",
                    job: { status: "needs_review" },
                  },
                }
              : path === `/api/devices/${device}/commands`
                ? []
                : path === "/api/optimization/workspace"
                  ? {
                      scope: { coverage: "complete", verified_ads: 18 },
                      policy: {},
                      recommendations: [
                        { status: "suggested" },
                        { status: "suggested" },
                      ],
                      plans: [{ status: "draft" }],
                    }
                  : path === "/api/imports"
                    ? []
                    : {};
    await route.fulfill({ json: data });
  });
  await page.addInitScript((value) => {
    sessionStorage.setItem("collectorToken", "fixture-only");
    localStorage.setItem("collectorAccount", value);
    localStorage.setItem("collectorDevice", "00000000-0000-4000-8000-000000000201");
    localStorage.removeItem("collectorAdvancedMode");
  }, account);
  await page.goto(`http://127.0.0.1:9321/?account=${account}#overview`);
  await expect(
    page.getByRole("heading", { name: "ภาพรวมการทำงาน" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "มี 1 แผนรอตรวจ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ตรวจแผนที่รออนุมัติ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ดูผลโฆษณา", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "สิ่งที่ควรทำ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ควบคุมหน้า Meta", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "เครื่องมือขั้นสูง", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ควบคุมหน้า Meta", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ซ่อนเครื่องมือขั้นสูง", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ควบคุมหน้า Meta", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  );
  if (overflowing.length) console.log("simple-mode overflow", overflowing);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Simple mode fixture passed: guided next action, four primary routes, advanced disclosure and mobile layout",
  );
} finally {
  await browser.close();
}
