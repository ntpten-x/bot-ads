import { chromium, expect } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(tmpdir(), "collector-e2e-"));
// Test fixture pregrants optional hosts. The shipping manifest keeps user opt-in permissions.
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
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  await context.route("https://adsmanager.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div role="grid"><div role="row"><div role="columnheader">Campaign name</div><div role="columnheader">Spend</div></div><div role="row"><div role="gridcell">Synthetic campaign</div><div role="gridcell">200</div></div></div></body></html>',
    }),
  );
  const meta = await context.newPage();
  await meta.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789",
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator("#account").fill("123456789");
  await page.locator("#attribution").fill("7-day click");
  await page.locator("#resultType").fill("leads");
  await page.locator("#rows").fill("2");
  await page.locator("#spend").fill("200");
  await page.locator("#file").setInputFiles("samples/meta-report.csv");
  await page.locator("#validate").click();
  await expect(page.locator("#report")).toContainText("2 แถว");
  await expect(page.locator("#sync")).toBeEnabled();
  await page.locator("#token").fill(process.env.API_TOKEN!);
  await page.locator("#sync").click();
  await expect(page.locator("#status")).toContainText(
    /บันทึกสำเร็จ|ไฟล์นี้บันทึกไว้แล้ว/,
  );
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/extension.png",
    fullPage: true,
  });
  await page.locator("#spend").fill("201");
  await expect(page.locator("#sync")).toBeDisabled();
  await page.locator("#validate").click();
  await expect(page.locator("#report")).toContainText("Spend differs");
  await expect(page.locator("#sync")).toBeDisabled();
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) =>
      t.url?.startsWith("https://adsmanager.facebook.com/"),
    )!.id!;
  });
  const send = async (payload: Record<string, unknown>) =>
    page.evaluate((p) => chrome.runtime.sendMessage(p), payload);
  const started = await send({
    command: "start",
    tabId,
    account: "123456789",
    levels: ["campaigns", "adsets", "ads"],
    maxSteps: 1,
  });
  expect(started.ok, JSON.stringify(started)).toBe(true);
  for (let index = 0; index < 3; index++) {
    await meta.waitForURL(
      `**/manage/${["campaigns", "adsets", "ads"][index]}?act=123456789`,
    );
    await worker.evaluate(() =>
      chrome.alarms.create("collect", { when: Date.now() + 100 }),
    );
    await expect
      .poll(
        async () => {
          const r = await send({ command: "status" });
          return r.job.index;
        },
        { timeout: 15000 },
      )
      .toBe(index + 1);
  }
  const collected = await send({ command: "status" });
  expect(collected.job.status).toBe("needs_review");
  expect(collected.job.snapshots).toHaveLength(3);
  expect(collected.job.snapshots[0].tables[0].rows[0]).toEqual([
    "Synthetic campaign",
    "200",
  ]);
  // Bridge uses the actual local API, but the Meta page above is entirely synthetic.
  const enabled = await send({
    command: "bridgeEnable",
    tabId,
    account: "123456789",
  });
  expect(enabled.ok).toBe(true);
  const device = enabled.bridge.device;
  const headers = {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const queued = await (
    await fetch(`http://127.0.0.1:4318/devices/${device}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({ command: "status" }),
    })
  ).json();
  await worker.evaluate(() =>
    chrome.alarms.create("bridge", { when: Date.now() + 100 }),
  );
  await expect
    .poll(
      async () => {
        const r = await (
          await fetch(
            `http://127.0.0.1:4318/devices/${device}/commands/${queued.id}`,
            { headers },
          )
        ).json();
        return r.status;
      },
      { timeout: 15000 },
    )
    .toBe("done");
  await send({ command: "bridgeDisable" });
  // Account guard stops before reading an unexpected account.
  await meta.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=999",
  );
  const rejected = await send({
    command: "start",
    tabId,
    account: "123456789",
    levels: ["campaigns"],
    maxSteps: 1,
  });
  expect(rejected.ok).toBe(false);
  expect(rejected.error).toContain("account changed");
  expect(errors).toEqual([]);
  console.log(
    "Browser integration passed: popup validation, API sync, invalidation, 3-page runner, snapshots, bot bridge, account guard",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
}
