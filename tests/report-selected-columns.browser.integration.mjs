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
  globalName: "TrustedSelectedColumnsFixture",
  footer: {
    js: "globalThis.TrustedSelectedColumnsFixture=TrustedSelectedColumnsFixture;",
  },
  target: "chrome120",
});
const temp = await mkdtemp(path.join(tmpdir(), "report-selected-columns-"));
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
    TrustedSelectedColumnsFixture.getReportFields("messages"),
  );
  const fixture = `<!doctype html><style>
  body{font:14px sans-serif}label{display:block}
  #dialog{position:fixed;top:30px;left:30px;width:820px;height:820px;overflow:hidden;background:white;z-index:10;border:1px solid #999}
  #choices{max-height:560px;overflow:auto;width:470px;margin:8px 0;padding:0}
  li{height:28px;list-style:none}input[type=checkbox]{width:20px;height:20px}
  #search{width:440px;height:30px}
  #selectedPanel{position:absolute;top:62px;right:8px;width:300px;height:360px;overflow:auto;background:white;border:1px solid #bbb;z-index:5}
  .selected-row{height:30px;display:flex;align-items:center;gap:8px;padding:0 6px}
  .selected-row .drag{width:8px;height:18px;display:inline-block}
  .selected-row .name{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .selected-row [role=button]{width:70px;height:26px;line-height:26px;text-align:center;background:#eee;cursor:pointer}
  #headers div{display:inline-block;min-width:90px}
  </style>
  <button id="columns" onclick="if(event.isTrusted)document.querySelector('#custom').hidden=false">Columns: Performance</button>
  <button hidden id="custom" onclick="if(event.isTrusted)document.querySelector('#dialog').hidden=false">Customize columns</button>
  <div id="headers"></div>
  <div hidden id="dialog" role="dialog" aria-labelledby="title"><h2 id="title">Customize columns</h2>
  <input id="search" aria-label="search columns" placeholder="Search columns">
  <ul id="choices"></ul>
  <div id="selectedPanel"><div id="selectedTitle"></div><div id="selectedRows"></div></div>
  <button id="apply" onclick="if(event.isTrusted){window.applied=true;renderHeaders();document.querySelector('#dialog').hidden=true}">Save</button></div>
  <script>
  window.available=${JSON.stringify(fields)};
  window.available.push({key:'purchases',labels:['Purchases'],required:false},{key:'roas',labels:['ROAS'],required:false});
  window.selected=new Set(['budget','purchases','roas']);
  window.hiddenExtraKeys=new Set(['budget','purchases','roas']);
  window.trustedEvents=0;window.untrustedEvents=0;window.removedViaSelectedList=0;
  function labelFor(key){return window.available.find(f=>f.key===key)?.labels[0]??key;}
  function renderHeaders(){
    const host=document.querySelector('#headers');host.replaceChildren();
    for(const key of ['status','ad_name',...window.selected]){
      const header=document.createElement('div');header.setAttribute('role','columnheader');
      header.textContent=key==='status'?'Status':labelFor(key);host.append(header);
    }
  }
  function renderSelected(){
    const rows=document.querySelector('#selectedRows');rows.replaceChildren();
    document.querySelector('#selectedTitle').textContent='Selected '+window.selected.size+' columns';
    for(const key of window.selected){
      const row=document.createElement('div');row.className='selected-row';
      const drag=document.createElement('span');drag.className='drag';
      const name=document.createElement('span');name.className='name';name.textContent=labelFor(key);
      const remove=document.createElement('div');remove.setAttribute('role','button');remove.tabIndex=0;remove.textContent='Remove';
      remove.onclick=e=>{
        if(!e.isTrusted){window.untrustedEvents++;return;}
        window.trustedEvents++;window.removedViaSelectedList++;
        window.selected.delete(key);renderSelected();renderHeaders();
      };
      row.append(drag,name,remove);rows.append(row);
    }
  }
  function render(query=''){
    const list=document.querySelector('#choices');list.replaceChildren();
    for(const field of window.available.filter(f=>query?f.labels[0].toLowerCase().includes(query.toLowerCase()):!window.hiddenExtraKeys.has(f.key))){
      const li=document.createElement('li'),input=document.createElement('input');input.type='checkbox';
      input.checked=window.selected.has(field.key);
      input.onchange=e=>{
        if(!e.isTrusted){input.checked=window.selected.has(field.key);window.untrustedEvents++;return;}
        window.trustedEvents++;
        if(input.checked)window.selected.add(field.key);else window.selected.delete(field.key);
        renderSelected();renderHeaders();
      };
      li.append(input,document.createTextNode(field.labels[0]));list.append(li);
    }
  }
  document.querySelector('#search').oninput=e=>{if(!e.isTrusted){window.untrustedEvents++;e.target.value='';return;}window.trustedEvents++;render(e.target.value)};
  render();renderSelected();renderHeaders();
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
    (b) => TrustedSelectedColumnsFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.applied).toBe(true);
  expect(result.missing_required).toEqual([]);
  expect(result.pruned).toEqual(
    expect.arrayContaining(["Budget", "Purchases", "ROAS"]),
  );
  expect(result.rendered_headers).not.toContain("Budget");
  expect(result.rendered_headers).not.toContain("Purchases");
  expect(result.rendered_headers).not.toContain("ROAS");
  expect(await meta.evaluate(() => window.removedViaSelectedList)).toBeGreaterThanOrEqual(3);
  expect(await meta.evaluate(() => window.untrustedEvents)).toBe(0);
  expect(await meta.evaluate(() => [...window.selected].filter(k => ['budget','purchases','roas'].includes(k)))).toEqual([]);
  expect(await meta.evaluate(() => !!window.applied)).toBe(true);
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
}
