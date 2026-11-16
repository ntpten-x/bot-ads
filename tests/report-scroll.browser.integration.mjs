// Fixed, local MV3 fixture; no Meta requests or database writes.
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const bundle = await build({
  stdin: {
    contents:
      "export {scrollReportWithInput} from './apps/extension/src/report-input.ts'; export {readVisibleTable} from './apps/extension/src/reader.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ScrollFixture",
  footer: { js: "globalThis.ScrollFixture=ScrollFixture;" },
});
const temp = await mkdtemp(path.join(tmpdir(), "report-scroll-"));
const ext = path.join(temp, "extension");
await cp("dist/extension", ext, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(ext, "manifest.json"), "utf8"),
);
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_host_permissions;
// This transport fixture owns its lease/job transitions. The shipping
// collector's tab-update listener must not advance this intentionally minimal
// test job while we exercise pause and independently scrolling panes.
await writeFile(
  path.join(ext, "scroll-fixture-worker.js"),
  bundle.outputFiles[0].text,
);
manifest.background = { service_worker: "scroll-fixture-worker.js" };
await writeFile(path.join(ext, "manifest.json"), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(
  path.join(temp, "profile"),
  {
    channel: "chromium",
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  },
);
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(bundle.outputFiles[0].text);
  await context.route("https://adsmanager.facebook.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<div style="position:relative;width:1000px;height:260px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:220px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:300px;top:0;width:350px;height:40px">Amount spent</div>
 <div role="columnheader" style="position:absolute;left:650px;top:0;width:350px;height:40px">Impressions</div>
 <div id="body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow:hidden">
 ${[0, 1].map((i) => `<div role="switch" style="position:absolute;left:10px;top:${20 + i * 70}px;width:40px;height:25px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=11${i}" style="position:absolute;left:90px;top:${20 + i * 70}px;width:200px;height:25px">Same name</a><div style="position:absolute;left:320px;top:${20 + i * 70}px;width:300px;height:25px">10</div><div class="metric" style="position:absolute;left:680px;top:${20 + i * 70}px;width:300px;height:25px">100</div>`).join("")}
 </div></div><script>window.wheels=[];document.querySelector('#body').addEventListener('wheel',e=>{if(!e.isTrusted)return;window.wheels.push({x:e.clientX,y:e.clientY});document.querySelectorAll('.metric').forEach(n=>n.textContent=String(Number(n.textContent)+1));if(e.clientX>300&&e.clientX<650)document.querySelectorAll('.name').forEach((n,i)=>n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=22'+i);});</script>`,
    }),
  );
  const page = await context.newPage();
  await page.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
  );
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({})).find((t) =>
        t.url?.startsWith("https://adsmanager.facebook.com/"),
      )?.id,
  );
  const binding = {
    tabId,
    account: "123456789",
    enabled: true,
    jobId: "scroll-body-fixture",
  };
  await worker.evaluate(async (b) => {
    await chrome.storage.local.set({
      bridge: { tabId: b.tabId, account: b.account, enabled: true },
      job: {
        id: b.jobId,
        tabId: b.tabId,
        account: b.account,
        status: "running",
      },
    });
    await chrome.storage.session.set({
      reportInputLease: {
        tabId: b.tabId,
        account: b.account,
        expires_at: Date.now() + 900000,
      },
    });
  }, binding);
  const result = await worker.evaluate(
    (b) => ScrollFixture.scrollReportWithInput(b),
    binding,
  );
  expect(result.moved, JSON.stringify(result)).toBe(true);
  const wheels = await page.evaluate(() => window.wheels);
  expect(wheels.some((p) => p.x > 650)).toBe(true);
  expect(wheels.some((p) => p.x > 300 && p.x < 650)).toBe(true);
  expect(await page.locator(".name").first().getAttribute("href")).toContain(
    "selected_ad_ids=220",
  );
  expect(wheels.length).toBeLessThanOrEqual(4);
  expect(
    await worker.evaluate(
      async (id) =>
        chrome.debugger
          .sendCommand({ tabId: id }, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: 1,
            y: 1,
          })
          .then(
            () => true,
            () => false,
          ),
      tabId,
    ),
  ).toBe(false);
  // The free metric pane can scroll while frozen names/IDs remain unchanged.
  // Physical offset evidence must come from this target's body, not an editor.
  await page.evaluate(() => {
    window.wheels = [];
    const metrics = document.createElement("div");
    metrics.id = "metrics";
    metrics.style.cssText =
      "position:absolute;left:300px;top:0;width:700px;height:200px;overflow-y:auto;background:white";
    metrics.innerHTML =
      '<div style="height:900px">' +
      Array.from(
        { length: 12 },
        (_, i) => '<div style="height:70px">' + (100 + i) + "</div>",
      ).join("") +
      "</div>";
    document.querySelector("#body").append(metrics);
  });
  const frozenId = await page.locator(".name").first().getAttribute("href");
  const physical = await worker.evaluate(
    (b) => ScrollFixture.scrollReportWithInput(b),
    binding,
  );
  expect(physical.moved, JSON.stringify(physical)).toBe(false);
  expect(physical.reason).toBe("reporting_body_moved_rows_unverified");
  expect(
    await page.locator("#metrics").evaluate((e) => e.scrollTop),
  ).toBeGreaterThan(0);
  expect(await page.locator(".name").first().getAttribute("href")).toBe(
    frozenId,
  );
  expect(await page.evaluate(() => window.wheels.length)).toBe(1);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const capture = await page.evaluate(() => ScrollFixture.readVisibleTable());
  expect(capture.row_observations).toHaveLength(2);
  expect(
    capture.row_observations.every((r) => r.column_mapping === "unverified"),
  ).toBe(true);
  await page.evaluate(() => {
    window.wheels = [];
  });
  const paused = await worker.evaluate(async (b) => {
    const original = chrome.debugger.sendCommand.bind(chrome.debugger);
    chrome.debugger.sendCommand = async (source, method, params) => {
      const result = await original(source, method, params);
      if (
        method === "Input.dispatchMouseEvent" &&
        params?.type === "mouseWheel"
      ) {
        const { job } = await chrome.storage.local.get("job");
        await chrome.storage.local.set({ job: { ...job, status: "paused" } });
      }
      return result;
    };
    try {
      return await ScrollFixture.scrollReportWithInput(b);
    } finally {
      chrome.debugger.sendCommand = original;
    }
  }, binding);
  expect(paused.moved).toBe(false);
  expect(paused.reason).toBe("collection_context_changed");
  expect(await page.evaluate(() => window.wheels.length)).toBe(1);
  console.log(
    "Native scroll fixture passed: inert safe band and metric refresh do not stop fallback to responsive reporting body; bounded input and detach",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
}
