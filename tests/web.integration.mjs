import { chromium, expect as baseExpect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { cleanupWebFixture } from "./helpers/web-fixture.mjs";
const expect = baseExpect.configure({ timeout: 10000 });
const base = process.env.WEB_TEST_URL ?? "http://127.0.0.1:9321";
const token = process.env.API_TOKEN;
if (!token) throw new Error("API_TOKEN required");
const account = "990" + String(Date.now()),
  device = randomUUID();
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
async function api(path, body) {
  const r = await fetch(`${base}/api${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Test API ${path}: ${r.status}`);
  return r.json();
}
let snapshot = {
  snapshot_id: randomUUID(),
  captured_at: new Date().toISOString(),
  title: "Campaign editor (test fixture)",
  url: `https://adsmanager.facebook.com/adsmanager/creation?act=${account}`,
  text: "Campaign editor\nCampaign name\nPublish",
  account_verified: true,
  controls: [
    {
      id: "node_0",
      label: "Campaign name",
      tag: "input",
      role: "text",
      type: "text",
      value: "Draft",
      disabled: false,
      requires_review: false,
    },
    {
      id: "node_1",
      label: "Publish",
      tag: "button",
      role: "button",
      disabled: false,
      requires_review: true,
    },
  ],
};
const lease = { account, expires_at: Date.now() + 900000, remaining: 100 };
const deviceState = (extra = {}) => ({
  bound_account: account,
  extension_version: "0.5.0",
  report_input: true,
  enabled: true,
  control: lease,
  ui: { outcome: "observed", snapshot },
  ...extra,
});
await api(`/devices/${device}/state`, deviceState());
expect((await fetch(`${base}/api/dashboard`)).status).toBe(401);
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem("collectorAccount", "123456789");
    localStorage.removeItem("collectorDevice");
  });
  await page.goto(`${base}/?account=${account}`);
  await expect(
    page.getByRole("heading", { name: "Meta Workspace", exact: true }),
  ).toBeVisible();
  await page.getByLabel("รหัสเชื่อมต่อระบบ").fill("wrong-token");
  await page.getByRole("button", { name: "เข้าสู่หน้าระบบ" }).click();
  await expect(page.locator(".login-panel [role=alert]")).toContainText(
    "รหัสเชื่อมต่อไม่ถูกต้อง",
  );
  await page.getByLabel("รหัสเชื่อมต่อระบบ").fill(token);
  await page.getByRole("button", { name: "เข้าสู่หน้าระบบ" }).click();
  await expect(
    page.getByRole("heading", { name: "ภาพรวมการทำงาน" }),
  ).toBeVisible();
  await expect(page.getByLabel("บัญชีโฆษณา", { exact: true })).toHaveValue(
    account,
  );
  await expect(
    page.getByLabel("Chrome Extension", { exact: true }),
  ).toHaveValue(device);
  await page.getByLabel("บัญชีโฆษณา", { exact: true }).fill(account);
  await page
    .locator(".context-bar")
    .getByRole("button", { name: "เลือก", exact: true })
    .click();
  await page
    .getByLabel("Chrome Extension", { exact: true })
    .selectOption(device);
  await expect(page.locator(".context-state")).toContainText("เชื่อมต่อแล้ว");
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/frontend-overview.png",
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "นำเข้ารายงาน", exact: true })
    .click();
  const csv = (await readFile("samples/meta-report.csv", "utf8")).replaceAll(
    "123456789",
    account,
  );
  await page.locator("#csvFile").setInputFiles({
    name: "frontend-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByLabel("Attribution", { exact: true }).fill("7-day click");
  await page.getByLabel("ชนิดผลลัพธ์", { exact: true }).fill("leads");
  await page.getByLabel("จำนวนแถว", { exact: true }).fill("2");
  await page.getByLabel("Spend รวม", { exact: true }).fill("200");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ผ่านการตรวจรูปแบบข้อมูล" }),
  ).toBeVisible();
  await expect(
    page.getByText("กระทบยอดไฟล์นี้แล้ว", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "จำนวนแถวและ Spend ตรงกับที่ระบุสำหรับไฟล์นี้ แต่ยังไม่ยืนยันความครบทั้งบัญชี",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "บันทึกลงฐานข้อมูล", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Spend รวม", { exact: true }).fill("201");
  await expect(
    page.getByRole("button", { name: "บันทึกลงฐานข้อมูล", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "พบข้อผิดพลาดในไฟล์" }),
  ).toBeVisible();
  await expect(
    page.getByText("ยอดที่ระบุไม่ตรงกับไฟล์", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Spend รวม", { exact: true }).fill("200");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ผ่านการตรวจรูปแบบข้อมูล" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "บันทึกลงฐานข้อมูล", exact: true })
    .click();
  await expect(page.locator(".below-panel tbody")).toContainText(
    "frontend-test.csv",
  );
  await expect(page.locator(".below-panel tbody")).toContainText(
    "กระทบยอดไฟล์แล้ว",
  );
  await page
    .locator("nav")
    .getByRole("button", { name: "ข้อมูลและส่งออก", exact: true })
    .click();
  await expect(page.locator(".data-table")).toContainText("Sample ad two");
  await page.getByRole("textbox", { name: "ค้นหาข้อมูล" }).fill("Sample ad two");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(1);
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก JSON", exact: true }).click();
  const downloaded = await pendingDownload;
  const data = JSON.parse(await readFile(await downloaded.path(), "utf8"));
  expect(data.records).toHaveLength(1);
  expect(data.coverage).toBe("unverified");
  expect(data.source_counts.csv).toBe(1);
  expect(data.source_counts.dom_capture).toBe(0);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก CSV", exact: true }).click();
  const csvFile = await csvDownload;
  expect(await readFile(await csvFile.path(), "utf8")).toContain(
    "Sample ad two",
  );
  await page
    .locator("nav")
    .getByRole("button", { name: "ข้อมูลวิเคราะห์", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ข้อมูลสำหรับวิเคราะห์โฆษณา" }),
  ).toBeVisible();
  await expect(page.locator(".data-table")).toContainText("Sample ad two");
  await page.getByLabel("เป้าหมายหลัก", { exact: true }).selectOption("sales");
  await expect(page.locator(".data-table")).toContainText("การซื้อ");
  await expect(page.locator(".data-table")).toContainText("ข้อมูลยังขาด");
  await expect(
    page.getByRole("columnheader", {
      name: "ผลประเมินและขั้นตอนถัดไป",
      exact: true,
    }),
  ).toBeVisible();
  const analysisDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ส่งออกชุดวิเคราะห์ JSON", exact: true })
    .click();
  const analysisData = JSON.parse(
    await readFile(await (await analysisDownload).path(), "utf8"),
  );
  expect(analysisData.goal).toBe("sales");
  expect(analysisData.rows).toHaveLength(2);
  expect(analysisData.rows[0].derived.cost_per_conversion).toBeNull();
  expect(analysisData.rows[0].evaluation.status).toBe("blocked");
  expect(analysisData.rows[0].evaluation.next_steps.length).toBeGreaterThan(0);
  expect(analysisData.coverage).toBe("unverified");
  expect(analysisData.scope_coverage).toBe("unverified");
  expect(analysisData.source_mix.csv).toBeGreaterThan(0);
  expect(analysisData.verified_import_rows).toBe(2);
  await page
    .getByRole("button", { name: "ตั้งคอลัมน์วิเคราะห์ใน Meta", exact: true })
    .click();
  let analysisCommands;
  await expect
    .poll(async () => {
      analysisCommands = await api(`/devices/${device}/commands`);
      return analysisCommands[0]?.command?.command;
    })
    .toBe("report.prepare");
  expect(analysisCommands[0].command.goal).toBe("sales");
  const prepared = {
    outcome: "observed",
    snapshot,
    report: {
      goal: "sales",
      selected: ["spend", "impressions"],
      missing: ["purchases"],
      missing_required: ["purchases"],
      applied: true,
    },
  };
  await api(`/devices/${device}/commands/${analysisCommands[0].id}/result`, {
    ok: true,
    ui: prepared,
  });
  await api(`/devices/${device}/state`, deviceState({ ui: prepared }));
  await expect(
    page.getByText("คอลัมน์หลักที่ยังหาไม่พบ: การซื้อ", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "อ่านค่าตาราง Ads", exact: true })
    .click();
  await expect
    .poll(async () => {
      analysisCommands = await api(`/devices/${device}/commands`);
      return analysisCommands[0]?.command?.command;
    })
    .toBe("start");
  expect(analysisCommands[0].command.scan_columns).toBe(true);
  expect(analysisCommands[0].command.levels).toEqual(["ads"]);
  await api(`/devices/${device}/commands/${analysisCommands[0].id}/result`, {
    ok: true,
    job: { status: "needs_review" },
  });
  await page.screenshot({
    path: "docs/screenshots/frontend-analysis.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator("nav")
    .getByRole("button", { name: "ควบคุมหน้า Meta", exact: true })
    .click();
  await expect(page.locator(".controls-table")).toContainText("Campaign name");
  await page.getByRole("button", { name: "อ่านหน้าปัจจุบัน", exact: true }).click();
  let rows;
  await expect
    .poll(async () => {
      rows = await api(`/devices/${device}/commands`);
      return rows[0]?.command?.action?.type;
    })
    .toBe("inspect");
  snapshot = {
    ...snapshot,
    snapshot_id: randomUUID(),
    captured_at: new Date().toISOString(),
  };
  await api(`/devices/${device}/commands/${rows[0].id}/result`, {
    ok: true,
    ui: { outcome: "observed", snapshot },
  });
  await api(`/devices/${device}/state`, deviceState());
  await expect(
    page.getByRole("button", { name: "อ่านหน้าปัจจุบัน", exact: true }),
  ).toBeEnabled();
  await page
    .locator(".controls-table tr")
    .filter({ hasText: "Campaign name" })
    .getByRole("button", { name: "เลือก", exact: true })
    .click();
  await page
    .getByLabel("ค่าที่ต้องการ", { exact: true })
    .fill("New campaign from frontend");
  await page.getByRole("button", { name: "ส่งคำสั่ง", exact: true }).click();
  await expect
    .poll(async () => {
      rows = await api(`/devices/${device}/commands`);
      return rows[0]?.command?.action?.value;
    })
    .toBe("New campaign from frontend");
  expect(rows[0].command.action.snapshot_id).toBe(snapshot.snapshot_id);
  const fillId = rows[0].id;
  snapshot = {
    ...snapshot,
    snapshot_id: randomUUID(),
    captured_at: new Date().toISOString(),
    controls: snapshot.controls.map((c) =>
      c.id === "node_0" ? { ...c, value: "New campaign from frontend" } : c,
    ),
  };
  await api(`/devices/${device}/commands/${fillId}/result`, {
    ok: true,
    ui: { outcome: "dispatched", snapshot },
  });
  await api(`/devices/${device}/state`, deviceState());
  await expect(page.locator(".controls-table")).toContainText(
    "New campaign from frontend",
  );
  await page
    .locator(".controls-table tr")
    .filter({ hasText: "Publish" })
    .getByRole("button", { name: "เลือก", exact: true })
    .click();
  await page.getByRole("button", { name: "ส่งคำสั่ง", exact: true }).click();
  await expect
    .poll(async () => {
      rows = await api(`/devices/${device}/commands`);
      return rows[0]?.command?.action?.target;
    })
    .toBe("node_1");
  const publish = rows[0],
    approvalId = randomUUID();
  const approval = {
    id: approvalId,
    approved: false,
    expires_at: Date.now() + 120000,
    preview: {
      account,
      target: { label: "Publish" },
      action: publish.command.action,
    },
  };
  await api(`/devices/${device}/commands/${publish.id}/result`, {
    ok: true,
    ui: {
      outcome: "awaiting_local_review",
      approval_id: approvalId,
      preview: approval.preview,
    },
  });
  await api(`/devices/${device}/state`, deviceState({ approval }));
  await expect(
    page.getByRole("heading", { name: "มีคำสั่งรอตรวจใน Extension" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ดำเนินคำสั่งที่อนุมัติแล้ว" }),
  ).toBeDisabled();
  // Emulate an extension heartbeat after local popup approval; no real Meta action occurs.
  await api(
    `/devices/${device}/state`,
    deviceState({ approval: { ...approval, approved: true } }),
  );
  await expect(
    page.getByRole("button", { name: "ดำเนินคำสั่งที่อนุมัติแล้ว" }),
  ).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "ดำเนินคำสั่งที่อนุมัติแล้ว" }).click();
  await expect
    .poll(async () => {
      rows = await api(`/devices/${device}/commands`);
      return rows[0]?.command?.approval_id;
    })
    .toBe(approvalId);
  expect(rows[0].command.action).toEqual(publish.command.action);
  await page.screenshot({
    path: "docs/screenshots/frontend-control.png",
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "ประวัติคำสั่ง", exact: true })
    .click();
  await expect(page.getByRole("table")).toContainText("คลิกองค์ประกอบ");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("nav")
    .getByRole("button", { name: "ภาพรวม", exact: true })
    .click();
  await page.screenshot({
    path: "docs/screenshots/frontend-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "ออก", exact: true }).click();
  await expect(page.getByLabel("รหัสเชื่อมต่อระบบ")).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("collectorToken")),
  ).toBeNull();
  console.log(
    "Next frontend integration passed: auth, live database import, invalidation, filtered export, queued inspect/fill, local approval handoff, history, mobile layout and logout",
  );
} catch (error) {
  await page.screenshot({
    path: "docs/screenshots/frontend-test-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await api(`/devices/${device}/state`, deviceState({ enabled: false }));
  await context.close();
  await browser.close();
  await cleanupWebFixture(account, device);
}
