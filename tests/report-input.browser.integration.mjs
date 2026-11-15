import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const bundle = await build({
  stdin: {
    contents: `export {prepareReportWithInput} from './apps/extension/src/report-input.ts'; export {getReportFields} from './apps/extension/src/report-columns.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "TrustedReportFixture",
  footer: { js: "globalThis.TrustedReportFixture=TrustedReportFixture;" },
  target: "chrome120",
});
const temp = await mkdtemp(path.join(tmpdir(), "report-input-"));
const ext = path.join(temp, "extension");
await cp("dist/extension", ext, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(ext, "manifest.json"), "utf8"),
);
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_host_permissions;
await writeFile(path.join(ext, "manifest.json"), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(
  path.join(temp, "profile"),
  {
    channel: "chromium",
    headless: true,
    viewport: { width: 1400, height: 1000 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  },
);
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(bundle.outputFiles[0].text);
  const fields = await worker.evaluate(() =>
    TrustedReportFixture.getReportFields("messages"),
  );
  const fixture = `<!doctype html><style>label{display:block} #dialog{position:fixed;top:40px;left:40px;width:800px;height:800px;overflow:auto;background:white;z-index:10}input[type=checkbox]{width:20px;height:20px}li{height:26px;list-style:none}#search{width:400px;height:30px}</style>
 <button id="publish" onclick="window.published=true">Publish</button><input id="adBudget" value="500">
 <button id="columns" onclick="if(event.isTrusted)document.querySelector('#custom').hidden=false">Columns: Performance</button>
 <button hidden id="custom" onclick="if(event.isTrusted)document.querySelector('#dialog').hidden=false">Customize columns</button>
 <div hidden id="dialog" role="dialog" aria-labelledby="title"><h2 id="title">Customize columns</h2>
 <input id="search" aria-label="search columns" placeholder="Search columns"><ul id="choices"></ul>
 <button id="apply" onclick="if(event.isTrusted){window.applied=true;document.querySelector('#dialog').hidden=true}">Save</button></div>
 <script>
 window.available=${JSON.stringify(fields)};window.selected=new Set();window.trustedEvents=0;window.untrustedEvents=0;
 function render(query=''){
 const list=document.querySelector('#choices');list.replaceChildren();
 for(const field of window.available.filter(f=>query?f.labels[0].toLowerCase().includes(query.toLowerCase()):f.key!=='link_clicks')){
 const li=document.createElement('li'),input=document.createElement('input');input.type='checkbox';input.checked=window.selected.has(field.key);
 input.dataset.key=field.key;input.onchange=e=>{if(!e.isTrusted){input.checked=window.selected.has(field.key);window.untrustedEvents++;return;}window.trustedEvents++;if(input.checked)window.selected.add(field.key);else window.selected.delete(field.key);};
 li.append(input,document.createTextNode(field.labels[0]));list.append(li);
 }}
 document.querySelector('#search').oninput=e=>{if(!e.isTrusted){window.untrustedEvents++;e.target.value='';return;}window.trustedEvents++;render(e.target.value)};render();
 </script>`;
  await context.route("https://adsmanager.facebook.com/**", (r) =>
    r.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }),
  );
  const meta = await context.newPage();
  await meta.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
  );
  await meta.bringToFront();
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({})).find((t) =>
        t.url?.includes("act=123456789"),
      ).id,
  );
  const binding = { tabId, account: "123456789", enabled: true };
  const disabled = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(disabled.ok).toBe(false);
  expect(disabled.error).toContain("เปิดโหมดเมาส์");
  // The fixture demonstrably refuses synthetic input before exercising the actual MV3 debugger transport.
  await meta.evaluate(() => {
    const input = document.querySelector("#search");
    input.value = "test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(await meta.locator("#search").inputValue()).toBe("");
  await worker.evaluate(
    async (b) =>
      chrome.storage.session.set({
        reportInputLease: {
          tabId: b.tabId,
          account: b.account,
          expires_at: Date.now() + 900000,
        },
      }),
    binding,
  );
  const result = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.applied).toBe(true);
  expect(result.missing_required).toEqual([]);
  expect(result.selected).toContain("spend");
  expect(result.selected).toContain("link_clicks");
  expect(await meta.evaluate(() => window.trustedEvents)).toBeGreaterThan(0);
  expect(await meta.evaluate(() => !!window.applied)).toBe(true);
  expect(await meta.evaluate(() => !!window.published)).toBe(false);
  expect(await meta.locator("#adBudget").inputValue()).toBe("500");
  const stillAttached = await worker.evaluate(
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
  );
  expect(stillAttached).toBe(false);
  await worker.evaluate(
    async (b) =>
      chrome.storage.session.set({
        reportInputLease: {
          tabId: b.tabId,
          account: "999",
          expires_at: Date.now() + 900000,
        },
      }),
    binding,
  );
  const mismatch = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(mismatch.ok).toBe(false);
  await worker.evaluate(
    async (b) =>
      chrome.storage.session.set({
        reportInputLease: {
          tabId: b.tabId,
          account: b.account,
          expires_at: Date.now() - 1,
        },
      }),
    binding,
  );
  const expired = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(expired.ok).toBe(false);
  await worker.evaluate(
    async (b) =>
      chrome.storage.session.set({
        reportInputLease: {
          tabId: b.tabId,
          account: b.account,
          expires_at: Date.now() + 900000,
        },
      }),
    binding,
  );
  await meta.goto(
    "https://adsmanager.facebook.com/adsmanager/creation?act=123456789",
  );
  const editor = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(editor.ok).toBe(false);
  expect(editor.error).toContain("Bound reporting tab");
  console.log(
    "Trusted report input passed: actual MV3 debugger Input events, synthetic rejection, native search/checkbox/Save, exact account lease, no ad-budget/Publish mutations and detach",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
