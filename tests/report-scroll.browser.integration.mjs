// Fixed, local MV3 fixture; no Meta requests or database writes.
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const bundle = await build({
  stdin: {
    contents:
      "export {resetReportScrollWithInput,scrollReportColumnsWithInput,scrollReportWithInput} from './apps/extension/src/report-input.ts'; export {probeReportingScroll,readVisibleTable,resetReportingRows,scrollReportingRows} from './apps/extension/src/reader.ts';",
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
  expect(await page.evaluate(() => window.wheels.length)).toBeLessThanOrEqual(10);
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
  // A table already at its physical bottom must say so instead of reporting a
  // failed input attempt. The stable-ID fingerprint cannot change at the end.
  const bottomPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&bottom=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:260px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:220px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:300px;top:0;width:350px;height:40px">Amount spent</div>
 <div role="columnheader" style="position:absolute;left:650px;top:0;width:350px;height:40px">Impressions</div>
 <div id="bottom-body" style="position:absolute;top:40px;left:0;width:1000px;height:140px;overflow-y:auto">
  <div style="position:relative;height:800px">
   ${[620, 680, 740].map((top, i) => `<div role="switch" style="position:absolute;left:10px;top:${top}px;width:40px;height:25px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=33${i}" style="position:absolute;left:90px;top:${top}px;width:200px;height:25px">Bottom ${i}</a><div style="position:absolute;left:320px;top:${top}px;width:300px;height:25px">10</div><div style="position:absolute;left:680px;top:${top}px;width:300px;height:25px">100</div>`).join("")}
  </div>
 </div></div>
 <script>document.querySelector('#bottom-body').scrollTop=660;</script>`,
      }),
  );
  await bottomPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&bottom=1",
  );
  await bottomPage.bringToFront();
  await expect(bottomPage.locator('[role="switch"]')).toHaveCount(3);
  const bottomTabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true })).find(
        (t) => t.url?.includes("bottom=1"),
      )?.id,
  );
  const bottomBinding = {
    tabId: bottomTabId,
    account: "123456789",
    enabled: true,
    jobId: "bottom-fixture",
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
  }, bottomBinding);
  const bottom = await worker.evaluate(
    (b) => ScrollFixture.scrollReportWithInput(b),
    bottomBinding,
  );
  expect(bottom.moved, JSON.stringify(bottom)).toBe(false);
  expect(bottom.reason).toBe("reporting_bottom_reached");
  expect(bottom.target_diagnostics?.at_bottom).toBe(true);
  await context.unroute("https://adsmanager.facebook.com/**");
  // A previous job can leave the virtualized body on its bottom page. The new
  // job must return to the physical first row; re-querying after reset keeps
  // the old bottom markers from scrolling the view back down.
  const resetPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&reset=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:300px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:220px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:300px;top:0;width:350px;height:40px">Amount spent</div>
 <div role="columnheader" style="position:absolute;left:650px;top:0;width:350px;height:40px">Impressions</div>
 <div id="reset-body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow-y:auto">
  <div style="position:relative;height:1000px">
   ${Array.from({ length: 15 }, (_, i) => `<div id="row-${i}" role="switch" style="position:absolute;left:10px;top:${20 + i * 60}px;width:40px;height:25px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=55${String(i).padStart(2, "0")}" style="position:absolute;left:90px;top:${20 + i * 60}px;width:200px;height:25px">Reset ${i}</a><div style="position:absolute;left:320px;top:${20 + i * 60}px;width:300px;height:25px">10</div><div style="position:absolute;left:680px;top:${20 + i * 60}px;width:300px;height:25px">100</div>`).join("")}
  </div>
 </div></div>
 <script>document.querySelector('#reset-body').scrollTop=620;</script>`,
      }),
  );
  await resetPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&reset=1",
  );
  await expect(resetPage.locator("#reset-body")).toBeVisible();
  await expect
    .poll(() => resetPage.locator("#reset-body").evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  await resetPage.addScriptTag({ content: bundle.outputFiles[0].text });
  const reset = await resetPage.evaluate(() => ScrollFixture.resetReportingRows());
  expect(reset.reset, JSON.stringify(reset)).toBe(true);
  expect(
    reset.offsets.some((offset) => offset.from > 0 && offset.to === 0),
  ).toBe(true);
  expect(await resetPage.locator("#reset-body").evaluate((e) => e.scrollTop)).toBe(
    0,
  );
  const firstRowTop = await resetPage
    .locator("#row-0")
    .evaluate((e) => e.getBoundingClientRect().top);
  expect(firstRowTop).toBeGreaterThanOrEqual(40);
  expect(firstRowTop).toBeLessThan(150);
  await context.unroute(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&reset=1",
  );
  // A clip-edge repaint can make the last visible row disappear without
  // revealing any new identity. DOM paging must not report that as a page.
  const clipPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&clip=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:300px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:220px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:300px;top:0;width:350px;height:40px">Amount spent</div>
 <div role="columnheader" style="position:absolute;left:650px;top:0;width:350px;height:40px">Impressions</div>
 <div id="clip-body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow-y:auto">
  <div style="position:relative;height:1000px">
   ${Array.from({ length: 5 }, (_, i) => `<div role="switch" style="position:absolute;left:10px;top:${20 + i * 40}px;width:40px;height:25px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=77${i}" style="position:absolute;left:90px;top:${20 + i * 40}px;width:200px;height:25px">Clip ${i}</a><div style="position:absolute;left:320px;top:${20 + i * 40}px;width:300px;height:25px">10</div><div style="position:absolute;left:680px;top:${20 + i * 40}px;width:300px;height:25px">100</div>`).join("")}
  </div>
 </div></div>`,
      }),
  );
  await clipPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&clip=1",
  );
  await expect(clipPage.locator('[role="switch"]')).toHaveCount(5);
  await clipPage.addScriptTag({ content: bundle.outputFiles[0].text });
  const clipped = await clipPage.evaluate(() => ScrollFixture.scrollReportingRows());
  expect(clipped.moved, JSON.stringify(clipped)).toBe(false);
  expect(clipped.tried[0]?.moved).toBe(false);
  await context.unroute(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&clip=1",
  );
  // The row scroller itself advances while a virtualizer repaints the same
  // last IDs. Scroll offset alone is not paging evidence.
  const stuckPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&stuck=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:300px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:220px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:300px;top:0;width:350px;height:40px">Amount spent</div>
 <div role="columnheader" style="position:absolute;left:650px;top:0;width:350px;height:40px">Impressions</div>
 <div id="stuck-body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow-y:auto">
  <div style="height:3200px"></div>
  ${Array.from({ length: 5 }, (_, i) => `<div data-stuck="${i}" role="switch" style="position:fixed;z-index:2;left:10px;top:${70 + i * 35}px;width:40px;height:25px"></div><a data-stuck="${i}" class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=66${String(i).padStart(2, "0")}" style="position:fixed;z-index:2;left:90px;top:${70 + i * 35}px;width:200px;height:25px">Stuck ${i}</a><div data-stuck="${i}" style="position:fixed;z-index:2;left:320px;top:${70 + i * 35}px;width:300px;height:25px">10</div><div data-stuck="${i}" style="position:fixed;z-index:2;left:680px;top:${70 + i * 35}px;width:300px;height:25px">100</div>`).join("")}
 </div></div>
 <script>window.rowScrolls=0;document.querySelector('#stuck-body').addEventListener('wheel',e=>{if(!e.isTrusted)return;window.rowScrolls++;const b=document.querySelector('#stuck-body');b.scrollTop=Math.min(2900,b.scrollTop+160);document.querySelectorAll('[data-stuck="4"]').forEach(n=>n.style.display='none');});</script>`,
      }),
  );
  await stuckPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&stuck=1",
  );
  await stuckPage.bringToFront();
  await expect(stuckPage.locator('[role="switch"]')).toHaveCount(5);
  const stuckTabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true })).find(
        (t) => t.url?.includes("stuck=1"),
      )?.id,
  );
  const stuckBinding = {
    tabId: stuckTabId,
    account: "123456789",
    enabled: true,
    jobId: "stuck-fixture",
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
  }, stuckBinding);
  const visibleStuckIds = () =>
    stuckPage
      .locator(".name")
      .evaluateAll((links) =>
        links
          .filter((link) => link.getBoundingClientRect().width > 0)
          .map((link) => link.getAttribute("href")),
      );
  const stuckIds = await visibleStuckIds();
  const stuck = await worker.evaluate(
    (b) => ScrollFixture.scrollReportWithInput(b),
    stuckBinding,
  );
  expect(stuck.moved, JSON.stringify(stuck)).toBe(false);
  expect(stuck.reason).toBe("reporting_body_moved_rows_unverified");
  expect(
    await stuckPage.locator("#stuck-body").evaluate((e) => e.scrollTop),
  ).toBeGreaterThan(0);
  expect(await visibleStuckIds()).toEqual(
    stuckIds.filter((_, index) => index !== stuckIds.length - 1),
  );
  await context.unroute(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&stuck=1",
  );
  // Meta can expose a custom right-edge scrollbar with no ARIA role and no
  // row ancestry. Only a guarded trusted drag may page it.
  const customScrollPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&custom-scroll=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:260px">
 <div id="reporting" style="position:relative;width:1000px;height:240px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:420px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:500px;top:0;width:200px;height:40px">Ad ID</div>
 <div id="custom-body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow:hidden">
  ${Array.from({ length: 5 }, (_, i) => `<div role="switch" style="position:absolute;left:10px;top:${20 + i * 38}px;width:40px;height:24px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=881${i}" style="position:absolute;left:90px;top:${20 + i * 38}px;width:400px;height:24px">Custom ${i}</a><div style="position:absolute;left:510px;top:${20 + i * 38}px;width:180px;height:24px">881${i}</div>`).join("")}
 </div>
 </div>
 <div id="custom-track" style="display:none;position:absolute;left:986px;top:45px;width:14px;height:195px;background:#ddd;z-index:5">
  <div id="custom-thumb" style="position:absolute;left:2px;top:10px;width:10px;height:58px;background:#777"></div>
 </div>
</div>
<script>window.scrollbarInputs={down:0,move:0,up:0,trustedDown:0,trustedMove:0,trustedUp:0,paged:false,revealed:false};window.customWheels=0;
const track=document.querySelector('#custom-track');
document.querySelector('#custom-body').addEventListener('wheel',()=>{window.customWheels++;});
document.addEventListener('mousemove',e=>{if(e.isTrusted&&e.clientX>980&&e.clientY>40){track.style.display='block';window.scrollbarInputs.revealed=true;}});
track.addEventListener('mousedown',e=>{window.scrollbarInputs.down++;if(e.isTrusted)window.scrollbarInputs.trustedDown++;e.preventDefault();window.scrollbarInputs.dragging=true;window.scrollbarInputs.startY=e.clientY;});
document.addEventListener('mousemove',e=>{if(!window.scrollbarInputs.dragging)return;window.scrollbarInputs.move++;if(e.isTrusted)window.scrollbarInputs.trustedMove++;if(!window.scrollbarInputs.paged&&e.clientY>window.scrollbarInputs.startY+30){window.scrollbarInputs.paged=true;document.querySelectorAll('.name').forEach((n,i)=>{n.textContent='Scrolled '+i;n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=991'+i;});}});
document.addEventListener('mouseup',e=>{if(!window.scrollbarInputs.dragging)return;window.scrollbarInputs.up++;if(e.isTrusted)window.scrollbarInputs.trustedUp++;window.scrollbarInputs.dragging=false;});</script>`,
      }),
  );
  await customScrollPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&custom-scroll=1",
  );
  await customScrollPage.bringToFront();
  await expect(customScrollPage.locator('[role="switch"]')).toHaveCount(5);
  await customScrollPage.addScriptTag({ content: bundle.outputFiles[0].text });
  const customProbe = await customScrollPage.evaluate(() =>
    ScrollFixture.probeReportingScroll("123456789"),
  );
  expect(customProbe.ready, JSON.stringify(customProbe)).toBe(true);
  expect(customProbe.vertical_scrollbar, JSON.stringify(customProbe)).toBe(null);
  expect(
    customProbe.targets.some(
      (target) => target.column_kind === "body" && target.x > 970,
    ),
    JSON.stringify(customProbe),
  ).toBe(true);
  const customScrollTabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true })).find(
        (t) => t.url?.includes("custom-scroll=1"),
      )?.id,
  );
  const customScrollBinding = {
    tabId: customScrollTabId,
    account: "123456789",
    enabled: true,
    jobId: "custom-scrollbar-fixture",
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
  }, customScrollBinding);
  const customScroll = await worker.evaluate(
    (b) => ScrollFixture.scrollReportWithInput(b),
    customScrollBinding,
  );
  expect(customScroll.moved, JSON.stringify(customScroll)).toBe(true);
  expect(customScroll.method).toBe("native_scrollbar_drag");
  expect(customScroll.target_diagnostics?.attempted_scrollbar).toBe(true);
  const customInputs = await customScrollPage.evaluate(() => ({
    ...window.scrollbarInputs,
    wheels: window.customWheels,
    hrefs: [...document.querySelectorAll(".name")].map((n) =>
      n.getAttribute("href"),
    ),
  }));
  expect(customInputs.trustedDown).toBe(1);
  expect(customInputs.trustedMove).toBeGreaterThan(0);
  expect(customInputs.trustedUp).toBe(1);
  expect(customInputs.revealed).toBe(true);
  expect(customInputs.paged).toBe(true);
  expect(customInputs.wheels).toBe(0);
  expect(customInputs.hrefs.every((href) => href.includes("selected_ad_ids=991"))).toBe(true);
  expect(
    await worker.evaluate(
      async (id) =>
        chrome.debugger
          .sendCommand(
            { tabId: id },
            "Input.dispatchMouseEvent",
            { type: "mouseMoved", x: 1, y: 1 },
          )
          .then(
            () => true,
            () => false,
          ),
      customScrollTabId,
    ),
  ).toBe(false);
  await context.unroute(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&custom-scroll=1",
  );
  // Meta can leave the thumb a few pixels above the nominal track end. That
  // bounded gutter is still the physical bottom and must not become a false
  // visible_rows_unchanged warning.
  const nearBottomPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&near-bottom=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:260px">
 <div id="near-bottom-reporting" style="position:relative;width:1000px;height:240px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:420px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:500px;top:0;width:200px;height:40px">Ad ID</div>
 <div id="near-bottom-body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow:hidden">
  ${Array.from({ length: 5 }, (_, i) => `<div role="switch" style="position:absolute;left:10px;top:${20 + i * 38}px;width:40px;height:24px"></div><a class="near-bottom-name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=88${i}" style="position:absolute;left:90px;top:${20 + i * 38}px;width:400px;height:24px">Last ${i}</a><div style="position:absolute;left:510px;top:${20 + i * 38}px;width:180px;height:24px">88${i}</div>`).join("")}
 </div>
 </div>
 <div id="near-bottom-track" style="position:absolute;left:986px;top:45px;width:14px;height:195px;background:#ddd;z-index:5">
  <div id="near-bottom-thumb" style="position:absolute;left:2px;top:135px;width:10px;height:55px;background:#777"></div>
 </div>
</div>`,
      }),
  );
  await nearBottomPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&near-bottom=1",
  );
  await nearBottomPage.bringToFront();
  await expect(nearBottomPage.locator('[role="switch"]')).toHaveCount(5);
  const nearBottomTabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true })).find(
        (t) => t.url?.includes("near-bottom=1"),
      )?.id,
  );
  const nearBottomBinding = {
    tabId: nearBottomTabId,
    account: "123456789",
    enabled: true,
    jobId: "near-bottom-fixture",
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
  }, nearBottomBinding);
  const nearBottom = await worker.evaluate(
    (b) => ScrollFixture.scrollReportWithInput(b),
    nearBottomBinding,
  );
  expect(nearBottom.moved, JSON.stringify(nearBottom)).toBe(false);
  expect(nearBottom.reason).toBe("reporting_bottom_reached");
  expect(nearBottom.target_diagnostics?.at_bottom).toBe(true);
  expect(nearBottom.target_diagnostics?.attempted_scrollbar).toBe(true);
  await context.unroute(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&near-bottom=1",
  );
  // A custom thumb can already be at the bottom when a new job starts. The
  // native reset must drag it to the top before the first snapshot; dragging
  // downward from the bottom can never reveal the first rows.
  const customResetPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&custom-reset=1",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div style="position:relative;width:1000px;height:260px">
 <div id="reset-reporting" style="position:relative;width:1000px;height:240px">
 <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
 <div role="columnheader" style="position:absolute;left:80px;top:0;width:420px;height:40px">Ad</div>
 <div role="columnheader" style="position:absolute;left:500px;top:0;width:200px;height:40px">Ad ID</div>
 <div id="reset-custom-body" style="position:absolute;top:40px;left:0;width:1000px;height:200px;overflow:hidden">
  ${Array.from({ length: 5 }, (_, i) => `<div role="switch" style="position:absolute;left:10px;top:${20 + i * 38}px;width:40px;height:24px"></div><a class="reset-name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=77${i}" style="position:absolute;left:90px;top:${20 + i * 38}px;width:400px;height:24px">Bottom ${i}</a><div style="position:absolute;left:510px;top:${20 + i * 38}px;width:180px;height:24px">77${i}</div>`).join("")}
 </div>
 </div>
 <div id="custom-reset-track" style="position:absolute;left:986px;top:45px;width:14px;height:195px;background:#ddd;z-index:5">
  <div id="custom-reset-thumb" style="position:absolute;left:2px;top:138px;width:10px;height:55px;background:#777"></div>
 </div>
</div>
<script>window.resetScrollInputs={down:0,move:0,up:0,trustedDown:0,trustedUp:0,reset:false};const track=document.querySelector('#custom-reset-track');const thumb=document.querySelector('#custom-reset-thumb');let dragging=false,startY=0;track.addEventListener('mousedown',e=>{if(!e.isTrusted)return;window.resetScrollInputs.down++;window.resetScrollInputs.trustedDown++;startY=e.clientY;dragging=true;e.preventDefault();});document.addEventListener('mousemove',e=>{if(!dragging||!e.isTrusted)return;window.resetScrollInputs.move++;if(e.clientY<startY-40&&!window.resetScrollInputs.reset){window.resetScrollInputs.reset=true;thumb.style.top='0px';document.querySelectorAll('.reset-name').forEach((n,i)=>{n.textContent='Top '+i;n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=66'+i;});}});document.addEventListener('mouseup',e=>{if(!dragging)return;window.resetScrollInputs.up++;window.resetScrollInputs.trustedUp++;dragging=false;});</script>`,
      }),
  );
  await customResetPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&custom-reset=1",
  );
  await customResetPage.bringToFront();
  await expect(customResetPage.locator('[role="switch"]')).toHaveCount(5);
  await customResetPage.addScriptTag({ content: bundle.outputFiles[0].text });
  const resetProbe = await customResetPage.evaluate(() =>
    ScrollFixture.probeReportingScroll("123456789"),
  );
  expect(resetProbe.ready, JSON.stringify(resetProbe)).toBe(true);
  expect(resetProbe.vertical_scrollbar?.at_bottom, JSON.stringify(resetProbe)).toBe(true);
  expect(resetProbe.vertical_scrollbar?.at_top, JSON.stringify(resetProbe)).toBe(false);
  const customResetTabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true })).find(
        (t) => t.url?.includes("custom-reset=1"),
      )?.id,
  );
  const customResetBinding = {
    tabId: customResetTabId,
    account: "123456789",
    enabled: true,
    jobId: "custom-reset-fixture",
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
  }, customResetBinding);
  const resetScroll = await worker.evaluate(
    (b) => ScrollFixture.resetReportScrollWithInput(b),
    customResetBinding,
  );
  expect(resetScroll.reset, JSON.stringify(resetScroll)).toBe(true);
  expect(resetScroll.method, JSON.stringify(resetScroll)).toBe("native_scrollbar_drag");
  const resetInputs = await customResetPage.evaluate(() => ({
    ...window.resetScrollInputs,
    thumbTop: document.querySelector('#custom-reset-thumb')?.style.top,
    hrefs: [...document.querySelectorAll('.reset-name')].map((n) => n.href),
  }));
  expect(resetInputs.trustedDown).toBe(1);
  expect(resetInputs.move).toBeGreaterThan(0);
  expect(resetInputs.trustedUp).toBe(1);
  expect(resetInputs.reset).toBe(true);
  expect(resetInputs.thumbTop).toBe("0px");
  expect(resetInputs.hrefs.every((href) => href.includes("selected_ad_ids=66"))).toBe(true);
  // Debugger attach itself can repaint the grid once. A stable post-attach view
  // must be rebased instead of failing before the reset drag.
  await customResetPage.evaluate(() => {
    window.resetScrollInputs.reset = false;
    document.querySelector("#custom-reset-thumb").style.top = "138px";
    document.querySelectorAll(".reset-name").forEach((name, index) => {
      name.textContent = `Bottom ${index}`;
      name.href = `/adsmanager/manage/ads?act=123456789&selected_ad_ids=77${index}`;
    });
  });
  const resetAfterAttachRepaint = await worker.evaluate(async (b) => {
    const originalAttach = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = async (...args) => {
      await originalAttach(...args);
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          document.querySelectorAll(".reset-name").forEach((name, index) => {
            name.textContent = `Attached ${index}`;
            name.href = `/adsmanager/manage/ads?act=123456789&selected_ad_ids=88${index}`;
          });
        },
      });
    };
    try {
      return await ScrollFixture.resetReportScrollWithInput(b);
    } finally {
      chrome.debugger.attach = originalAttach;
    }
  }, customResetBinding);
  expect(resetAfterAttachRepaint.reset, JSON.stringify(resetAfterAttachRepaint)).toBe(true);
  expect(
    await customResetPage.evaluate(() =>
      [...document.querySelectorAll(".reset-name")].every((name) =>
        name.href.includes("selected_ad_ids=66"),
      ),
    ),
  ).toBe(true);
  expect(
    await worker.evaluate(
      async (id) =>
        chrome.debugger
          .sendCommand(
            { tabId: id },
            "Input.dispatchMouseEvent",
            { type: "mouseMoved", x: 1, y: 1 },
          )
          .then(
            () => true,
            () => false,
          ),
      customResetTabId,
    ),
  ).toBe(false);
  await context.unroute(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789&custom-reset=1",
  );
  const horizontalPage = await context.newPage();
  await context.route(
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789",
    (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<div id="hscroll" style="width:900px;height:300px;overflow-x:hidden;overflow-y:hidden">
<div role="grid" style="display:grid;grid-template-columns:400px 400px 400px 400px;width:1600px">
<div role="row" style="display:contents"><div role="columnheader" style="position:sticky;left:0;z-index:2;background:white">On / Off</div><div role="columnheader">Campaign</div><div role="columnheader">Amount spent</div><div role="columnheader">Impressions</div></div>
<div role="row" style="display:contents"><div role="gridcell" style="position:sticky;left:0;z-index:1;background:white"><div role="switch" style="width:40px;height:25px"></div></div><div role="gridcell"><a href="/adsmanager/manage/campaigns?act=123456789&selected_campaign_ids=111">Campaign A</a></div><div role="gridcell">100</div><div role="gridcell">1000</div></div>
<div role="row" style="display:contents"><div role="gridcell" style="position:sticky;left:0;z-index:1;background:white"><div role="switch" style="width:40px;height:25px"></div></div><div role="gridcell"><a href="/adsmanager/manage/campaigns?act=123456789&selected_campaign_ids=222">Campaign B</a></div><div role="gridcell">200</div><div role="gridcell">2000</div></div>
</div></div>
<script>window.horizontalWheels=0;document.querySelector('#hscroll').addEventListener('wheel',e=>{if(!e.isTrusted)return;window.horizontalWheels++;document.querySelector('#hscroll').scrollLeft+=Math.max(50,e.deltaX);});</script>`,
      }),
  );
  await horizontalPage.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789",
  );
  await horizontalPage.bringToFront();
  await expect(horizontalPage.locator('[role="switch"]')).toHaveCount(2);
  await horizontalPage.addScriptTag({ content: bundle.outputFiles[0].text });
  const directProbe = await horizontalPage.evaluate(() =>
    ScrollFixture.probeReportingScroll("123456789"),
  );
  expect(directProbe.ready, JSON.stringify(directProbe)).toBe(true);
  const horizontalTabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true })).find(
        (t) => t.url?.includes("/manage/campaigns?act=123456789"),
      )?.id,
  );
  const horizontalBinding = {
    tabId: horizontalTabId,
    account: "123456789",
    enabled: true,
    jobId: "horizontal-fixture",
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
  }, horizontalBinding);
  const horizontal = await worker.evaluate(
    (b) => ScrollFixture.scrollReportColumnsWithInput(b),
    horizontalBinding,
  );
  expect(horizontal.moved, JSON.stringify(horizontal)).toBe(true);
  expect(await horizontalPage.locator("#hscroll").evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  expect(await horizontalPage.evaluate(() => window.horizontalWheels)).toBe(1);
  console.log(
    "Native scroll fixture passed: row reset to first page, identity-only paging, physical bottom detection, inert safe band, guarded horizontal pan, bounded input and detach",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
}
