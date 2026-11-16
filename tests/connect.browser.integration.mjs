import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
const expect = baseExpect.configure({ timeout: 10000 });
const temp = await mkdtemp(path.join(tmpdir(), "collector-connect-"));
await cp("dist/extension", path.join(temp, "extension"), { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(temp, "extension/manifest.json"), "utf8"),
);
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_host_permissions;
await writeFile(
  path.join(temp, "extension/manifest.json"),
  JSON.stringify(manifest),
);
const context = await chromium.launchPersistentContext(
  path.join(temp, "profile"),
  {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${path.join(temp, "extension")}`,
      `--load-extension=${path.join(temp, "extension")}`,
    ],
  },
);
let device;
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const ext = new URL(worker.url()).host;
  const account = "990" + Date.now();
  await context.route("https://adsmanager.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><title>Connection test fixture</title></head><body><h1>Campaigns</h1><button>Columns</button><input aria-label="Search"></body></html>',
    }),
  );
  const meta = await context.newPage();
  await meta.goto(
    `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account}`,
  );
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${ext}/popup.html`);
  const send = (payload) =>
    popup.evaluate((p) => chrome.runtime.sendMessage(p), payload);
  await expect(popup.locator("#deviceId")).toHaveValue(/^[0-9a-f-]{36}$/i);
  device = await popup.locator("#deviceId").inputValue();
  expect(
    await popup.locator("#deviceId").getAttribute("readonly"),
  ).not.toBeNull();
  await expect(popup.locator("#copyDevice")).toBeEnabled();
  await popup.reload();
  await expect(popup.locator("#deviceId")).toHaveValue(device);
  await popup.locator("#account").fill("123456789");
  await meta.bringToFront();
  await popup.evaluate(() => document.getElementById("detect").click());
  await expect(popup.locator("#account")).toHaveValue(account);
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) =>
      t.url?.startsWith("https://adsmanager.facebook.com/"),
    )?.id;
  });
  await worker.evaluate(() =>
    chrome.storage.session.set({ token: "incorrect-backend-token" }),
  );
  const denied = await send({ command: "bridgeEnable", account, tabId });
  expect(denied.ok).toBe(false);
  expect(denied.error).toContain("รหัสเชื่อมต่อ Backend ไม่ถูกต้อง");
  await popup.evaluate((token) => {
    document.getElementById("token").value = token;
  }, process.env.API_TOKEN);
  await meta.bringToFront();
  await popup.evaluate(() => document.getElementById("bridgeEnable").click());
  await expect(popup.locator("#connectionFeedback")).toContainText(
    "เชื่อมต่อและทดสอบอ่านแล้ว",
  );
  const headers = { Authorization: `Bearer ${process.env.API_TOKEN}` };
  const response = await fetch(
    `http://127.0.0.1:4318/devices/${device}/state`,
    { headers },
  );
  expect(response.status).toBe(200);
  const state = await response.json();
  expect(state.state.bound_account).toBe(account);
  expect(state.state.enabled).toBe(true);
  expect(state.state.report_input).toBe(false);
  await popup.locator("#reportInputEnable").click();
  await expect(popup.locator("#reportInputStatus")).toContainText(
    "เปิดเมาส์/คีย์บอร์ดรายงาน",
  );
  await expect
    .poll(
      async () =>
        (
          await (
            await fetch(`http://127.0.0.1:4318/devices/${device}/state`, {
              headers,
            })
          ).json()
        ).state.report_input,
    )
    .toBe(true);
  await popup.locator("#reportInputDisable").click();
  await expect
    .poll(
      async () =>
        (
          await (
            await fetch(`http://127.0.0.1:4318/devices/${device}/state`, {
              headers,
            })
          ).json()
        ).state.report_input,
    )
    .toBe(false);

  expect(state.state.ui.snapshot.title).toBe("Connection test fixture");
  expect(state.state.ui.snapshot.controls).toHaveLength(2);
  const devices = await (
    await fetch("http://127.0.0.1:4318/dashboard", { headers })
  ).json();
  expect(
    devices.devices.some((d) => d.id === device && d.account_id === account),
  ).toBe(true);
  const status = await send({ command: "bridgeStatus" });
  expect(status.bridge.device).toBe(device);
  await mkdir("docs/screenshots", { recursive: true });
  await popup.screenshot({
    path: "docs/screenshots/extension-connect.png",
    fullPage: true,
  });
  await send({ command: "bridgeDisable" });
  console.log(
    "Connection integration passed: UUID visible before pairing, stable identity, account re-detection, invalid-token feedback, one-click connect/read and immediate backend discovery",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
  if (device) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query("DELETE FROM bot_commands WHERE device_id=$1", [device]);
      await pool.query("DELETE FROM bot_devices WHERE id=$1", [device]);
    } finally {
      await pool.end();
    }
  }
}
