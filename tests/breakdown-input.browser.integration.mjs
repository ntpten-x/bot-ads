import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const bundle = await build({
  stdin: {
    contents:
      "export {probeBreakdownMenu,configureBreakdownWithInput} from './apps/extension/src/breakdown-input.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "BreakdownFixture",
  footer: { js: "globalThis.BreakdownFixture=BreakdownFixture;" },
  target: "chrome120",
});
const temp = await mkdtemp(path.join(tmpdir(), "breakdown-input-"));
const extension = path.join(temp, "extension");
await cp("dist/extension", extension, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_host_permissions;
await writeFile(
  path.join(extension, "breakdown-fixture-worker.js"),
  bundle.outputFiles[0].text,
);
manifest.background = { service_worker: "breakdown-fixture-worker.js" };
await writeFile(
  path.join(extension, "manifest.json"),
  JSON.stringify(manifest),
);
const context = await chromium.launchPersistentContext(
  path.join(temp, "profile"),
  {
    channel: "chromium",
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(bundle.outputFiles[0].text);
  await context.route("https://adsmanager.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><style>
button{display:block;margin:8px;padding:6px;width:260px}
#menu li{height:34px;line-height:34px}
#menu input[type=checkbox]{float:left;margin:5px 12px;width:24px;height:24px}
#menu{position:absolute;left:20px;top:70px;background:white;padding:8px;border:1px solid #999}
</style>
<button id="breakdown">ข้อมูลแยกย่อย: เลือกแล้ว 1 รายการ</button>
<input id="outside" type="checkbox" style="position:absolute;left:500px;top:101px;width:24px;height:24px">
<table><thead><tr><th>อายุ</th></tr></thead><tbody><tr><td>25-34</td></tr></tbody></table>
<div id="menu" role="menu" hidden>
<input id="search" aria-label="search columns" placeholder="ค้นหา">
<li role="listitem" data-row="age"><input type="checkbox" data-key="age">อายุ</li>
<li role="listitem" data-row="gender" hidden><input type="checkbox" data-key="gender">เพศ</li>
<li role="listitem" data-row="platform"><input type="checkbox" data-key="platform">แพลตฟอร์ม</li>
<li role="listitem" data-row="placement"><input type="checkbox" data-key="placement">ตำแหน่งโฆษณา</li>
</div>
<script>
window.trusted=0;window.untrusted=0;window.selected=new Set();
document.querySelector('#breakdown').addEventListener('click',e=>{
  if(!e.isTrusted){window.untrusted++;return;}
  window.trusted++;
  document.querySelector('#menu').hidden=!document.querySelector('#menu').hidden;
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(!e.isTrusted){window.untrusted++;return;}
  window.trusted++;document.querySelector('#menu').hidden=true;
});
document.querySelector('#search').addEventListener('input',e=>{
  if(!e.isTrusted){window.untrusted++;return;}
  window.trusted++;
  const query=e.target.value.trim();
  for(const row of document.querySelectorAll('#menu [data-row]'))
    row.hidden=!!query&&!row.textContent.includes(query);
  for(const input of document.querySelectorAll('#menu input[type=checkbox]'))
    input.hidden=input.dataset.key==='gender'?(query!=='เพศ'):!!query&&!document.querySelector('[data-row="'+input.dataset.key+'"]').textContent.includes(query);
});
for(const input of document.querySelectorAll('#menu input[type=checkbox]')){
  input.addEventListener('change',e=>{
    if(!e.isTrusted){window.untrusted++;input.checked=window.selected.has(input.dataset.key);return;}
    window.trusted++;
    if(input.checked)window.selected.add(input.dataset.key);
    else window.selected.delete(input.dataset.key);
    const url=new URL(location.href);
    for(const key of ['age','gender','platform','placement'])url.searchParams.delete(key+'_breakdown');
    url.searchParams.delete('demographics_breakdown');
    for(const key of window.selected){
      if(key==='age'||key==='gender')url.searchParams.set('demographics_breakdown',key);
      else url.searchParams.set(key+'_breakdown',key);
    }
    history.replaceState({},'',url);
  });
}
</script>`,
    }),
  );
  const page = await context.newPage();
  await page.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
  );
  await page.bringToFront();
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
  );
  const binding = { tabId, account: "123456789", enabled: true };
  await worker.evaluate(async (value) => {
    await chrome.storage.local.set({
      bridge: {
        tabId: value.tabId,
        account: value.account,
        enabled: true,
      },
      job: {
        id: "breakdown-fixture",
        tabId: value.tabId,
        account: value.account,
        status: "paused",
      },
    });
    await chrome.storage.session.set({
      reportInputLease: {
        tabId: value.tabId,
        account: value.account,
        expires_at: Date.now() + 900000,
      },
    });
  }, binding);
  const first = await worker.evaluate(
    (value) =>
      BreakdownFixture.configureBreakdownWithInput(value, ["gender"]),
    binding,
  );
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(first.selected).toEqual(["gender"]);
  expect(
    await page.evaluate(() => [...window.selected].sort()),
  ).toEqual(["gender"]);
  const second = await worker.evaluate(
    (value) => BreakdownFixture.configureBreakdownWithInput(value, ["age"]),
    binding,
  );
  expect(second.ok, JSON.stringify(second)).toBe(true);
  expect(second.selected).toEqual(["age"]);
  expect(second.cleared).toEqual(["gender"]);
  expect(await page.evaluate(() => [...window.selected])).toEqual(["age"]);
  const trustedBeforeRepeat = await page.evaluate(() => window.trusted);
  const repeated = await worker.evaluate(
    (value) => BreakdownFixture.configureBreakdownWithInput(value, ["age"]),
    binding,
  );
  expect(repeated.ok, JSON.stringify(repeated)).toBe(true);
  expect(repeated.selected).toEqual(["age"]);
  expect(repeated.missing).toEqual([]);
  expect(await page.evaluate(() => window.trusted)).toBe(trustedBeforeRepeat);
  expect(await page.evaluate(() => window.untrusted)).toBe(0);
  expect(await page.locator("#outside").isChecked()).toBe(false);
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
  console.log(
    "Breakdown input passed: trusted menu search, exact demographics scope, clear/switch and debugger detach",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
}
