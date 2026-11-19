import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function withReportInputFixture(label, run) {
  const bundle = await build({
    stdin: {
      contents:
        "export {advanceReportPageWithInput,prepareReportWithInput,scrollReportWithInput} from './apps/extension/src/report-input.ts'; export {clickNextReportPage} from './apps/extension/src/reader.ts'; export {getReportFields} from './apps/extension/src/report-columns.ts';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "TrustedReportFixture",
    footer: { js: "globalThis.TrustedReportFixture=TrustedReportFixture;" },
    target: "chrome120",
  });
  const temp = await mkdtemp(path.join(tmpdir(), `report-input-${label}-`));
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
  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(30_000);
  let fixture = "";
  const phase = (name) => console.log(`[report-input:${label}] ${name}`);
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
    phase("service-worker-ready");
    await worker.evaluate(bundle.outputFiles[0].text);
    const fields = await worker.evaluate(() =>
      TrustedReportFixture.getReportFields("messages"),
    );
    await context.route("https://adsmanager.facebook.com/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: fixture,
      }),
    );
    const meta = await context.newPage();
    fixture = baseFixture(fields);
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    await meta.bringToFront();
    const tabId = await worker.evaluate(
      async () =>
        (await chrome.tabs.query({})).find((tab) =>
          tab.url?.includes("act=123456789"),
        )?.id,
    );
    if (!Number.isInteger(tabId))
      throw new Error("Reporting tab was not discovered");
    const binding = { tabId, account: "123456789", enabled: true };
    const setLease = async ({
      account = binding.account,
      expires_at = Date.now() + 900_000,
    } = {}) => {
      await worker.evaluate(
        async ({ tabId, account, expires_at }) =>
          chrome.storage.session.set({
            reportInputLease: { tabId, account, expires_at },
          }),
        { tabId, account, expires_at },
      );
    };
    const removeLease = () =>
      worker.evaluate(() => chrome.storage.session.remove("reportInputLease"));
    phase("fixture-ready");
    await run({
      bundle,
      context,
      meta,
      worker,
      binding,
      fields,
      setFixture: (next) => {
        fixture = next;
      },
      setLease,
      removeLease,
      phase,
    });
  } finally {
    await context.close();
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

export function baseFixture(fields) {
  return `<!doctype html><style>label{display:block} #dialog{position:fixed;top:40px;left:40px;width:800px;height:800px;overflow:auto;background:white;z-index:10}input[type=checkbox]{width:20px;height:20px}li{height:26px;list-style:none}#search{width:400px;height:30px}#headers div{display:inline-block;min-width:80px}</style>
 <button id="publish" onclick="window.published=true">Publish</button><input id="adBudget" value="500">
 <button id="columns" onclick="if(event.isTrusted)document.querySelector('#custom').hidden=false">Columns: Performance</button>
 <button hidden id="custom" onclick="if(event.isTrusted)document.querySelector('#dialog').hidden=false">Customize columns</button>
 <div id="headers"></div>
 <div hidden id="dialog" role="dialog" aria-labelledby="title"><h2 id="title">Customize columns</h2>
 <input id="search" aria-label="search columns" placeholder="Search columns"><ul id="choices" style="max-height:52px;overflow:auto"></ul>
 <button id="apply" onclick="if(event.isTrusted){window.applied=true;renderHeaders();document.querySelector('#dialog').hidden=true}">Save</button></div>
 <script>
 window.available=${JSON.stringify(fields)};window.available.push({key:'reach_variant',labels:['Reach'],helper:'Variant without budget',required:false});window.selected=new Set();window.hiddenExtraKeys=new Set();window.trustedEvents=0;window.untrustedEvents=0;
 function labelFor(key){return window.available.find(f=>f.key===key)?.labels[0]??key;}
 function renderHeaders(){
  if(window.freezeHeaders)return;
  const host=document.querySelector('#headers');host.replaceChildren();
  for(const key of ['status','ad_name',...window.selected]){const header=document.createElement('div');header.setAttribute('role','columnheader');
   header.textContent=key==='status'?'Status':key==='roas'?'ROAS (ผลตอบแทนจากค่าใช้จ่ายในการโฆษณา)':key==='spend'?labelFor(key)+' ↓':labelFor(key);host.append(header);}
 }
 function render(query=''){
 window.currentQuery=query;
 const list=document.querySelector('#choices');list.replaceChildren();
 for(const field of window.available.filter(f=>query?f.labels[0].toLowerCase().includes(query.toLowerCase()):f.key!==(window.hiddenKey??'link_clicks')&&!window.hiddenExtraKeys.has(f.key))){
 const li=document.createElement('li'),input=document.createElement('input');input.type='checkbox';input.checked=window.selected.has(field.key);
 input.dataset.key=field.key;input.onchange=e=>{if(!e.isTrusted){input.checked=window.selected.has(field.key);window.untrustedEvents++;return;}window.trustedEvents++;if(input.checked)window.selected.add(field.key);else window.selected.delete(field.key);renderHeaders();if(window.revokeOnChange&&field.key==='ad_id')window.selected.delete('ad_id');if(window.mutateReachContext&&field.key==='reach'&&!input.checked){window.mutateReachContext=false;setTimeout(()=>{field.helper='Context changed after uncheck';render(window.currentQuery);},0);}};
 li.append(input,document.createTextNode(field.labels[0]));if(field.helper){const detail=document.createElement('span');detail.textContent=' '+field.helper;li.append(detail);}list.append(li);
 }}
 document.querySelector('#search').oninput=e=>{if(!e.isTrusted){window.untrustedEvents++;e.target.value='';return;}window.trustedEvents++;render(e.target.value)};render();renderHeaders();
 </script>`;
}

export function pagingFixture() {
  return `<div style="position:relative;width:900px;height:250px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
    <div role="columnheader" style="position:absolute;left:80px;top:0;width:420px;height:40px">Ad</div>
    <div role="columnheader" style="position:absolute;left:500px;top:0;width:400px;height:40px">Results</div>
    <div id="body" style="position:absolute;top:40px;left:0;width:900px;height:200px;overflow:hidden">
    ${[0, 1]
      .map(
        (index) =>
          `<div role="switch" style="position:absolute;left:10px;top:${20 + index * 60}px;width:40px;height:25px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=11${index}" style="position:absolute;left:90px;top:${20 + index * 60}px;width:410px;height:25px">Fixture ${index}</a><div class="metric" style="position:absolute;left:520px;top:${20 + index * 60}px;width:200px;height:25px">10</div>`,
      )
      .join("")}
    </div></div><script>window.trustedWheels=0;document.querySelector('#body').addEventListener('wheel',e=>{if(!e.isTrusted)return;window.trustedWheels++;if(window.metricOnly){document.querySelectorAll('.metric').forEach(n=>n.textContent=String(Number(n.textContent)+1));return;}if(window.idsOnly){document.querySelectorAll('.name').forEach((n,i)=>n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=22'+i);return;}document.querySelectorAll('.name').forEach((n,i)=>{n.textContent='Next '+i;n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=33'+i;});});</script>`;
}
