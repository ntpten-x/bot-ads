// Isolated browser fixture for customer/account health and access management.
import { chromium, expect } from "@playwright/test";

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
  const updates = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      path === "/api/managed-accounts/123456789/schedule"
    ) {
      const body = request.postDataJSON();
      updates.push({ kind: "schedule", body });
      await route.fulfill({
        json: {
          account_id: "123456789",
          auto_enabled: body.enabled,
          auto_interval_minutes: body.interval_minutes,
          auto_next_run_at: new Date().toISOString(),
          auto_last_run_at: null,
          auto_last_status: null,
          auto_last_error: null,
        },
      });
      return;
    }
    if (
      request.method() === "POST" &&
      path.startsWith("/api/managed-accounts/")
    ) {
      const account = decodeURIComponent(path.split("/").at(-1));
      const body = request.postDataJSON();
      updates.push({ kind: "account", account, body });
      await route.fulfill({
        json: {
          account_id: account,
          display_name: "Customer A",
          enabled: body.enabled,
          report_template: {},
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }
    const data =
      path === "/api/health"
        ? { ok: true }
        : path === "/api/dashboard"
          ? { accounts: ["123456789"], devices: [] }
          : path === "/api/auth/me"
            ? {
                kind: "local-admin",
                role: "admin",
                customer_id: "00000000-0000-4000-8000-000000000001",
                customer_name: "Local",
              }
            : path === "/api/customers"
              ? [
                  {
                    id: "00000000-0000-4000-8000-000000000001",
                    name: "Customer A",
                    enabled: true,
                    account_count: 1,
                    created_at: new Date().toISOString(),
                  },
                ]
                : path ===
                    "/api/customers/00000000-0000-4000-8000-000000000001/clients"
                  ? [
                      {
                        id: "00000000-0000-4000-8000-000000000003",
                        customer_id:
                          "00000000-0000-4000-8000-000000000001",
                        name: "Operator A",
                        role: "operator",
                        enabled: true,
                        all_accounts: true,
                        account_ids: [],
                        created_at: new Date().toISOString(),
                      },
                    ]
                  : path === "/api/audit-log"
                    ? [
                        {
                          id: "00000000-0000-4000-8000-000000000004",
                          actor_kind: "local-admin",
                          actor_name: null,
                          customer_name: "Customer A",
                          action: "customer_created",
                          target:
                            "00000000-0000-4000-8000-000000000001",
                          details: {},
                          created_at: new Date().toISOString(),
                        },
                      ]
              : path === "/api/managed-accounts"
                ? [
                    {
                      account_id: "123456789",
                      customer_id: "00000000-0000-4000-8000-000000000001",
                      customer_name: "Customer A",
                      display_name: "Brand A",
                      enabled: true,
                      report_template: {},
                      device_count: 1,
                      fresh_devices: 1,
                      latest_job_id: "00000000-0000-4000-8000-000000000002",
                      latest_job_status: "needs_review",
                      latest_job_error: null,
                      last_capture_at: new Date().toISOString(),
                      normalized_ads: 29,
                      target_configured: false,
                      auto_enabled: false,
                      auto_interval_minutes: 60,
                      auto_next_run_at: null,
                      auto_last_run_at: null,
                      auto_last_status: null,
                      auto_last_error: null,
                      status: "partial",
                      issues: [
                        "Coverage ของ Ads scope ยังไม่ complete",
                        "ยังไม่ได้ตั้ง Target CPA/ROAS",
                      ],
                      coverage: "partial",
                      verified_ads: 29,
                      reported_ads: 34,
                    },
                  ]
                : {};
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("collectorToken", "fixture-only");
    localStorage.setItem("collectorAccount", "123456789");
  });
  await page.goto("http://127.0.0.1:9321/?account=123456789#accounts");
  await expect(
    page.getByRole("heading", {
      name: "บัญชีและอุปกรณ์",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Brand A", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("พร้อมบางส่วน", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText(/29\s*\/\s*29/),
  ).toBeVisible();
  await expect(
    page.getByText("จัดการ Customer, บัญชี และ Client Token"),
  ).toBeVisible();
  await page
    .getByText("จัดการ Customer, บัญชี และ Client Token")
    .click();
  await expect(page.getByText("Operator A", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".client-token-list")
      .getByText("ทุกบัญชีใน Customer", { exact: false }),
  ).toBeVisible();
  await page
    .getByText("ประวัติการเปลี่ยนสิทธิ์และการอ่านอัตโนมัติ")
    .click();
  await expect(page.getByText("customer_created", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "อ่านอัตโนมัติ", exact: true }).click();
  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0]).toEqual({
    kind: "schedule",
    body: { enabled: true, interval_minutes: 60 },
  });
  await page.getByRole("button", { name: "ปิดใช้งาน", exact: true }).click();
  await expect.poll(() => updates.length).toBe(2);
  expect(updates[1]).toEqual({
    kind: "account",
    account: "123456789",
    body: { enabled: false },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Accounts web fixture passed: health, schedule, token controls, audit, disable action and mobile layout",
  );
} finally {
  await browser.close();
}
