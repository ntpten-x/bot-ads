import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const bundle = await build({
  stdin: {
    contents: `export {prepareReportWithInput, scrollReportWithInput} from './apps/extension/src/report-input.ts'; export {getReportFields} from './apps/extension/src/report-columns.ts';`,
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
  let fixture = `<!doctype html><style>label{display:block} #dialog{position:fixed;top:40px;left:40px;width:800px;height:800px;overflow:auto;background:white;z-index:10}input[type=checkbox]{width:20px;height:20px}li{height:26px;list-style:none}#search{width:400px;height:30px}#headers div{display:inline-block;min-width:80px}</style>
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
  await meta.evaluate(() => {
    window.available = [
      ...window.available,
      { key: "purchases", labels: ["Purchases"], required: false },
      { key: "roas", labels: ["ROAS"], required: false },
    ];
    window.selected = new Set([
      "budget",
      "reach",
      "frequency",
      "purchases",
      "roas",
    ]);
    // Purchases stays in the rendered table but is omitted from the active
    // dialog category until a trusted search addresses it.
    window.hiddenExtraKeys = new Set(["purchases"]);
    window.mutateReachContext = true;
    render();
    renderHeaders();
  });
  const result = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.applied).toBe(true);
  expect(result.missing_required).toEqual([]);
  expect(result.selected).toContain("spend");
  expect(result.selected).toContain("ad_name");
  expect(result.selected).not.toContain("link_clicks");
  expect(result.missing_goal_metrics).toContain("link_clicks");
  expect(result.pruned).toEqual(
    expect.arrayContaining(["Budget", "Reach", "Frequency", "Purchases", "ROAS"]),
  );
  for (const key of ["budget", "reach", "frequency", "purchases", "roas"])
    expect(await meta.evaluate((k) => [...window.selected].includes(k), key)).toBe(false);
  expect(result.pruned).toContain("Purchases");
  expect(await meta.evaluate(() => [...document.querySelectorAll('#headers [role=columnheader]')].map(h => h.textContent))).not.toContain("Purchases");
  expect(await meta.evaluate(() => [...document.querySelectorAll('#headers [role=columnheader]')].map(h => h.textContent))).not.toContain("ROAS (ผลตอบแทนจากค่าใช้จ่ายในการโฆษณา)");
  expect(result.rendered_headers).toContain("Amount spent ↓");
  const trustedBeforeReuse = await meta.evaluate(() => window.trustedEvents);
  const reused = await worker.evaluate(
    (b) =>
      TrustedReportFixture.prepareReportWithInput(b, "messages", {
        reuseIfReady: true,
      }),
    binding,
  );
  expect(reused.ok, JSON.stringify(reused)).toBe(true);
  expect(reused.reused).toBe(true);
  expect(reused.applied).toBe(true);
  expect(await meta.evaluate(() => window.trustedEvents)).toBe(
    trustedBeforeReuse,
  );
  expect(await meta.evaluate(() => window.selected.has("reach_variant"))).toBe(false);
  expect(await meta.evaluate(() => window.available.find(f => f.key === "reach").helper)).toContain("Context changed");
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
  // A closed dialog is not proof that the table changed. If the rendered headers
  // are stale, the prepare result must not claim an applied column view.
  await meta.goto("https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789");
  await meta.evaluate(() => { window.freezeHeaders = true; });
  const unverified = await worker.evaluate((b) => TrustedReportFixture.prepareReportWithInput(b, "messages"), binding);
  expect(unverified.ok).toBe(false);
  expect(unverified.applied).toBe(false);
  expect(unverified.missing_rendered_fields.length).toBeGreaterThan(0);
  expect(unverified.error).toContain("ยืนยันคอลัมน์บนตารางไม่ได้");
  // Native search can commit after a delayed controlled-input rerender. The
  // previous query/results must not be accepted or overwritten in the meantime.
  await meta.goto("https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789");
  await meta.evaluate(() => {
    window.available = window.available.filter(f => f.key !== 'account_id');
    window.hiddenKey = 'ad_id';
    render();
    const search = document.querySelector('#search');
    // Meta's search aria name may remain English inside a Thai dialog.
    search.setAttribute('aria-label', 'search columns');
    document.querySelector('#title').textContent = 'ปรับแต่งคอลัมน์';
    window.queries = [];
    const defaultRender = render;
    render = query => defaultRender(window.available.find(f => f.labels.includes(query))?.labels[0] ?? query);
    search.oninput = e => {
      if (!e.isTrusted) return;
      window.queries.push(e.target.value);
      const query = e.target.value;
      e.target.value = '';
      setTimeout(() => { search.value = query; render(query); }, 2600);
    };
  });
  const delayed = await worker.evaluate((b) => TrustedReportFixture.prepareReportWithInput(b, "messages"), binding);
  expect(delayed.ok, JSON.stringify(delayed)).toBe(true);
  expect(delayed.selected).toContain('ad_id');
  expect(delayed.missing).toContain('account_id');
  expect(delayed.missing_required).toEqual([]);
  expect(delayed.applied).toBe(true);
  expect(await meta.evaluate(() => window.queries)).toContain('ID โฆษณา');
  // A distinct debounce shape: input commits immediately, results clear, and
  // the actual matching choices arrive later without an aria-busy marker.
  await meta.goto('https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789');
  await meta.evaluate(() => {
    window.hiddenKey = 'ad_id';
    render();
    document.querySelector('#search').oninput = e => {
      if (!e.isTrusted) return;
      const query = e.target.value;
      document.querySelector('#choices').replaceChildren();
      setTimeout(() => render(query), 2600);
    };
  });
  const debounced = await worker.evaluate((b) => TrustedReportFixture.prepareReportWithInput(b, 'messages'), binding);
  expect(debounced.ok, JSON.stringify(debounced)).toBe(true);
  expect(debounced.selected).toContain('ad_id');
  expect(debounced.applied).toBe(true);
  await meta.goto('https://adsmanager.facebook.com/adsmanager/manage/ads?act=999');
  const wrongAccountUrl = await worker.evaluate((b) => TrustedReportFixture.prepareReportWithInput(b, 'messages'), binding);
  expect(wrongAccountUrl.ok).toBe(false);
  expect(wrongAccountUrl.error).toContain('Bound reporting tab');
  expect(await meta.evaluate(() => !!window.applied)).toBe(false);
  // A partially selectable report must stay open instead of saving a preset
  // that lacks the stable identifier required by downstream analysis.
  await meta.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
  );
  await meta.evaluate(() => {
    window.available = window.available.filter((f) => f.key !== "ad_id");
    render();
  });
  const partial = await worker.evaluate(
    (b) => TrustedReportFixture.prepareReportWithInput(b, "messages"),
    binding,
  );
  expect(partial.ok).toBe(false);
  expect(partial.applied).toBe(false);
  expect(partial.missing_required).toContain("ad_id");
  expect(await meta.evaluate(() => !!window.applied)).toBe(false);
  await meta.goto("https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789");
  await meta.evaluate(() => { window.revokeOnChange = true; });
  const reverted = await worker.evaluate((b) => TrustedReportFixture.prepareReportWithInput(b, "messages"), binding);
  expect(reverted.ok).toBe(false);
  expect(reverted.applied).toBe(false);
  expect(reverted.missing_required).toContain("ad_id");
  expect(await meta.evaluate(() => !!window.applied)).toBe(false);
  // A custom virtualized body ignores synthetic wheel events. Only the existing
  // local report lease permits the fixed native wheel transport.
  fixture = `<div style="position:relative;width:900px;height:250px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
    <div role="columnheader" style="position:absolute;left:80px;top:0;width:420px;height:40px">Ad</div>
    <div role="columnheader" style="position:absolute;left:500px;top:0;width:400px;height:40px">Results</div>
    <div id="body" style="position:absolute;top:40px;left:0;width:900px;height:200px;overflow:hidden">
    ${[0,1].map(i=>`<div role="switch" style="position:absolute;left:10px;top:${20+i*60}px;width:40px;height:25px"></div><a class="name" href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=11${i}" style="position:absolute;left:90px;top:${20+i*60}px;width:410px;height:25px">Fixture ${i}</a><div class="metric" style="position:absolute;left:520px;top:${20+i*60}px;width:200px;height:25px">10</div>`).join('')}
    </div></div><script>window.trustedWheels=0;document.querySelector('#body').addEventListener('wheel',e=>{if(!e.isTrusted)return;window.trustedWheels++;if(window.metricOnly){document.querySelectorAll('.metric').forEach(n=>n.textContent=String(Number(n.textContent)+1));return;}if(window.idsOnly){document.querySelectorAll('.name').forEach((n,i)=>n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=22'+i);return;}document.querySelectorAll('.name').forEach((n,i)=>{n.textContent='Next '+i;n.href='/adsmanager/manage/ads?act=123456789&selected_ad_ids=33'+i;});});</script>`;
  await meta.goto("https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789");
  const pagingBinding = { ...binding, jobId: "report-paging-fixture" };
  await worker.evaluate(async (b) => chrome.storage.local.set({
    bridge: { tabId:b.tabId,account:b.account,enabled:true },
    job: { id:b.jobId,tabId:b.tabId,account:b.account,status:"running" },
  }),pagingBinding);
  await worker.evaluate(() => chrome.storage.session.remove("reportInputLease"));
  const noPagingLease = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(noPagingLease.moved).toBe(false);
  expect(noPagingLease.reason).toBe("report_input_lease_required");
  expect(await meta.evaluate(() => window.trustedWheels)).toBe(0);
  await worker.evaluate(async (b) => chrome.storage.session.set({ reportInputLease: { tabId:b.tabId, account:b.account, expires_at:Date.now()+900000 } }),binding);
  const nativePaging = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(nativePaging.moved, JSON.stringify(nativePaging)).toBe(true);
  expect(nativePaging.method).toBe("native_wheel");
  expect(await meta.evaluate(() => window.trustedWheels)).toBe(1);
  expect(await worker.evaluate(async(id)=>chrome.debugger.sendCommand({tabId:id},"Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1}).then(()=>true,()=>false),tabId)).toBe(false);
  const noChange = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(noChange.moved).toBe(false);
  expect(noChange.reason).toBe("visible_rows_unchanged");
  // A debugger command that never resolves must not freeze the collection.
  const stuckStart = Date.now();
  const debuggerStuck = await worker.evaluate(async (b) => {
    const original = chrome.debugger.sendCommand.bind(chrome.debugger);
    chrome.debugger.sendCommand = () => new Promise(() => {});
    try {
      return await TrustedReportFixture.scrollReportWithInput(b);
    } finally {
      chrome.debugger.sendCommand = original;
    }
  }, pagingBinding);
  expect(debuggerStuck.moved).toBe(false);
  expect(debuggerStuck.reason).toBe("debugger_command_timeout");
  expect(Date.now() - stuckStart).toBeLessThan(20_000);
  await meta.evaluate(() => {window.metricOnly=true;});
  const metricRefresh = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(metricRefresh.moved).toBe(false);
  expect(metricRefresh.reason).toBe("visible_rows_unchanged");
  await meta.evaluate(() => {window.metricOnly=false;window.idsOnly=true;document.querySelectorAll('.name').forEach(n=>n.textContent='Same name');});
  const sameNamesNewIds = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(sameNamesNewIds.moved).toBe(true);
  // Pause or rebind after debugger attach but before the wheel: current local
  // authority must win over the stale binding passed into the operation.
  const wheelsBeforeRaces = await meta.evaluate(() => window.trustedWheels);
  for (const race of ["pause", "rebind"]) {
    const raced = await worker.evaluate(async ({b,race}) => {
      const original = chrome.debugger.attach.bind(chrome.debugger);
      chrome.debugger.attach = async (...args) => {
        await original(...args);
        if (race === "pause") {
          const {job} = await chrome.storage.local.get("job");
          await chrome.storage.local.set({job:{...job,status:"paused"}});
        } else await chrome.storage.local.set({bridge:{tabId:b.tabId,account:"999",enabled:true}});
      };
      try { return await TrustedReportFixture.scrollReportWithInput(b); }
      finally { chrome.debugger.attach = original; }
    },{b:pagingBinding,race});
    expect(raced.moved).toBe(false);
    expect(raced.reason).toBe("collection_context_changed");
    expect(await meta.evaluate(() => window.trustedWheels)).toBe(wheelsBeforeRaces);
    await worker.evaluate(async(b)=>chrome.storage.local.set({bridge:{tabId:b.tabId,account:b.account,enabled:true},job:{id:b.jobId,tabId:b.tabId,account:b.account,status:"running"}}),pagingBinding);
  }
  // A modal must not receive the reporting wheel input.
  const wheelsBeforeModal = await meta.evaluate(() => window.trustedWheels);
  await meta.evaluate(() => {const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.style.cssText='position:fixed;inset:0;background:white';modal.textContent='Edit ad';document.body.append(modal);});
  const blockedPaging = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(blockedPaging.moved).toBe(false);
  expect(blockedPaging.reason).toBe("reporting_view_blocked");
  expect(await meta.evaluate(() => window.trustedWheels)).toBe(wheelsBeforeModal);
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
  const mismatchedPaging = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(mismatchedPaging.moved).toBe(false);
  expect(mismatchedPaging.reason).toBe("report_input_lease_required");
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
  const expiredPaging = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(expiredPaging.moved).toBe(false);
  expect(expiredPaging.reason).toBe("report_input_lease_required");
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
  const editorPaging = await worker.evaluate((b) => TrustedReportFixture.scrollReportWithInput(b), pagingBinding);
  expect(editorPaging.moved).toBe(false);
  expect(editorPaging.reason).toBe("reporting_context_changed");
  console.log(
    "Trusted report input passed: actual MV3 debugger Input events, synthetic rejection, native search/checkbox/Save, missing/reverted required selection blocks Save, verified native wheel/no-change/modal guards, exact account lease, no ad-budget/Publish mutations and detach",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
