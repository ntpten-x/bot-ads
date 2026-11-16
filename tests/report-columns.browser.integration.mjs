import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["apps/extension/src/report-columns.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ReportColumns",
  target: "chrome120",
});
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();
const fields = [
  "Account ID",
  "Campaign name",
  "Campaign ID",
  "Ad set ID",
  "Ad ID",
  "Amount spent",
  "Impressions",
  "Link clicks",
  "Attribution setting",
  "Purchases",
  "Purchases conversion value",
];
let fixture = "";
await page.route("https://adsmanager.facebook.com/**", (route) =>
  route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }),
);
const html = (
  missing = false,
) => `<button id="publish" onclick="window.published=true">Publish</button><label><input id="outside" type="checkbox">Amount spent</label>
<button id="columns" onclick="document.querySelector('#custom').hidden=false">Columns: Performance</button>
<button hidden id="custom" onclick="document.querySelector('#dialog').hidden=false">Customize columns</button>
<div hidden id="dialog" role="dialog" aria-labelledby="title"><h2 id="title">Customize columns</h2>
${fields
  .filter((f) => !missing || f !== "Purchases")
  .map(
    (f, i) =>
      `<label><input type="checkbox" id="field${i}" ${i === 0 ? "checked" : ""}>${f}</label>`,
  )
  .join("")}
<button id="apply" onclick="window.applied=true;document.querySelector('#dialog').hidden=true">Apply</button></div>`;
async function prepare(
  body,
  url = "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
  account = "123456789",
) {
  fixture = body;
  await page.goto(url);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return page.evaluate(
    (account) =>
      ReportColumns.prepareReportColumns({
        account,
        goal: "sales",
        fields: ReportColumns.getReportFields("sales"),
      }),
    account,
  );
}
try {
  const result = await prepare(html());
  expect(result.applied).toBe(true);
  expect(result.missing_required).toEqual([]);
  expect(result.selected).toContain("purchase_value");
  expect(result.selected).toContain("ad_id");
  expect(await page.locator("#outside").isChecked()).toBe(false);
  expect(await page.evaluate(() => !!window.published)).toBe(false);
  expect(await page.locator("#field0").isChecked()).toBe(true);
  const noAccountColumn = await prepare(html().replace(/<label><input type="checkbox"[^>]*>Account ID<\/label>/, ""));
  expect(noAccountColumn.applied).toBe(true);
  expect(noAccountColumn.missing_required).toEqual([]);
  expect(noAccountColumn.missing).toContain("account_id");
  const slowMenu = html().replace(
    "document.querySelector('#custom').hidden=false",
    "setTimeout(()=>{document.querySelector('#custom').hidden=false},1600)",
  );
  const slowResult = await prepare(slowMenu);
  expect(slowResult.applied).toBe(true);
  const realLayout = html()
    .replaceAll('<label><input type="checkbox"', '<li><input type="checkbox"')
    .replaceAll("</label>", "</li>")
    .replace(">Customize columns</h2>", ">ปรับแต่งคอลัมน์</h2>")
    .replace(">Apply</button>", ">บันทึก</button>");
  const actual = await prepare(realLayout);
  expect(actual.applied).toBe(true);
  expect(actual.missing_required).toEqual([]);
  const hiddenHelp = realLayout.replaceAll(
    "</li>",
    '<span style="display:none">Hidden metric help</span></li>',
  );
  const hiddenResult = await prepare(hiddenHelp);
  expect(hiddenResult.missing_required).toEqual([]);
  expect(hiddenResult.selected).toContain("spend");
  const searched = `<div role="dialog" aria-labelledby="dialog-title"><h2 id="dialog-title">Customize columns</h2>
    <span id="search-title">search columns</span><input aria-labelledby="search-title" oninput="document.querySelector('#choices').replaceChildren(); const f=window.available.find(s=>s===this.value);if(f){let li=document.createElement('li');let input=document.createElement('input');input.type='checkbox';input.checked=window.selected.has(f);input.onchange=()=>input.checked?window.selected.add(f):window.selected.delete(f);li.append(input,document.createTextNode(f));document.querySelector('#choices').append(li);}">
    <ul id="choices"></ul><button onclick="this.closest('[role=dialog]').remove()">Save</button></div><script>window.available=${JSON.stringify(fields)};window.selected=new Set()</script>`;
  const searchedResult = await prepare(searched);
  expect(searchedResult.applied).toBe(true);
  expect(searchedResult.missing_required).toEqual([]);
  const clippedRequired = await prepare(html().replace(/(<label><input type="checkbox"[^>]*>Ad ID<\/label>)/,
    '<div style="height:20px;overflow:hidden"><div style="height:40px"></div>$1</div>'));
  expect(clippedRequired.applied).toBe(false);
  expect(clippedRequired.missing_required).toContain("ad_id");
  expect(await page.evaluate(() => !!window.applied)).toBe(false);
  const missing = await prepare(html(true));
  expect(missing.missing_required).toContain("purchases");
  expect(missing.applied).toBe(false);
  expect(missing.ok).toBe(false);
  expect(await page.evaluate(() => !!window.applied)).toBe(false);
  const reverted = await prepare(html().replace('id="field7"', `id="field7" onclick="document.querySelector('#field4').checked=false"`));
  expect(reverted.ok).toBe(false);
  expect(reverted.applied).toBe(false);
  expect(reverted.missing_required).toContain("ad_id");
  expect(await page.evaluate(() => !!window.applied)).toBe(false);
  expect(
    (
      await prepare(
        html(),
        "https://adsmanager.facebook.com/adsmanager/creation?act=123456789",
      )
    ).error,
  ).toContain("Reporting page or account changed");
  expect((await prepare(html(), undefined, "999")).error).toContain(
    "Reporting page or account changed",
  );
  const noFields = html().replace(
    /<label><input type="checkbox"[^>]*>[^<]*<\/label>/g,
    "",
  );
  const emptyResult = await prepare(noFields);
  expect(emptyResult.ok).toBe(false);
  expect(emptyResult.applied).toBe(false);
  expect(await page.evaluate(() => !!window.applied)).toBe(false);
  expect(emptyResult.diagnostics).toBeDefined();
  // Never guess Apply in an unrelated dialog, even when it has identical checkbox labels.
  const unrelated = html().replaceAll("Customize columns</h2>", "Edit ad</h2>");
  expect((await prepare(unrelated)).error).toContain(
    "Meta ไม่เปิดหน้าตั้งคอลัมน์ที่รองรับ",
  );
  expect(await page.evaluate(() => !!window.applied)).toBe(false);
  console.log(
    "Report column workflow passed: exact scoped checkboxes, only adding columns, missing fields, account/route guards, unrelated-dialog refusal and zero publish/outside mutations",
  );
} finally {
  await browser.close();
}
