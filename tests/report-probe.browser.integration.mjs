import {chromium,expect} from '@playwright/test';import {build} from 'esbuild';
const b=await build({entryPoints:['apps/extension/src/report-probe.ts'],bundle:true,write:false,format:'iife',globalName:'Probe'});
const browser=await chromium.launch({channel:'chromium',headless:true});const page=await browser.newPage();
await page.route('https://adsmanager.facebook.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="dialog" aria-label="ปรับแต่งคอลัมน์"><li><input type="checkbox"><span>ID โฆษณา</span><span> ชื่อและ ID ของวัตถุ &gt; ชื่อและ ID ของวัตถุ</span></li></div>'}));
try{await page.goto('https://adsmanager.facebook.com/adsmanager/manage/ads?act=123');await page.addScriptTag({content:b.outputFiles[0].text});const p=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'ad_id',labels:['ID โฆษณา'],required:true}}));expect(p.kind).toBe('click');
// A helper/category name is not the name of the checkbox it describes.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<li><input type="checkbox"><span>Budget</span><span>Amount spent</span></li>');
const helper=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(helper.kind).toBe('missing');
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML+='<li><input checked type="checkbox"><span>Amount spent</span><span>General metrics</span></li>');
const realSpend=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(realSpend.kind).toBe('selected');
// Distinct exact controls remain ambiguous, including selected duplicates.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<label><input checked type="checkbox">Amount spent</label><label><input checked type="checkbox">Amount spent</label>');
const duplicate=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(duplicate.kind).toBe('missing');expect(duplicate.reason).toBe('Ambiguous report control');
// The generic Results field can share its visible label with the ROAS result
// field. A known context exclusion keeps the exact generic result selectable.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<li><input checked type="checkbox"><span>ผลลัพธ์</span><span>ROAS | ผลลัพธ์และการใช้จ่าย</span></li><li><input checked type="checkbox"><span>ผลลัพธ์</span><span>ผลลัพธ์และการใช้จ่าย | ผลลัพธ์</span></li>');
const contextual=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'results',labels:['Results','ผลลัพธ์'],exclude_terms:['ROAS'],required:true}}));
expect(contextual.kind).toBe('selected');expect(contextual.diagnostics.matched_count).toBe(1);
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<li><input checked type="checkbox"><span>จำนวนเงินที่ใช้จ่ายไป</span><span>เป็นเปอร์เซ็นต์ | เงินใช้จ่าย</span></li><li><input checked type="checkbox"><span>จำนวนเงินที่ใช้จ่ายไป</span><span>ผลลัพธ์และการใช้จ่าย | เงินใช้จ่าย</span></li>');
const preferredSpend=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent','จำนวนเงินที่ใช้จ่ายไป'],exclude_terms:['เป็นเปอร์เซ็นต์'],prefer_terms:['ผลลัพธ์และการใช้จ่าย'],required:true}}));
expect(preferredSpend.kind).toBe('selected');expect(preferredSpend.diagnostics.matched_count).toBe(1);
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<input aria-label="search columns" value="Budget"><label><input checked type="checkbox">Amount spent</label>');
const stale=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',query:'Amount spent',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(stale.kind).toBe('wait');expect(stale.reason).toBe('Report search context changed');// A hidden stale spinner is not evidence that visible results are loading.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<h2>ปรับแต่งคอลัมน์</h2><input aria-label="search columns" value="Amount spent"><div role="progressbar" hidden></div><label><input checked type="checkbox">Amount spent</label>');
const hiddenBusy=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',query:'Amount spent',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(hiddenBusy.kind).toBe('selected');
const locale=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'search'}));
expect(locale.locale).toBe('th');expect(locale.busy).toBe(false);
// Rectangles within the viewport may still be fully clipped by an option pane.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<div style="height:20px;overflow:hidden"><div style="height:40px"></div><label><input checked type="checkbox">Amount spent</label></div>');
const clipped=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(clipped.kind).toBe('missing');
// A clipped duplicate must not make a real, visible control ambiguous.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML+='<label><input checked type="checkbox">Amount spent</label>');
const clippedDuplicate=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(clippedDuplicate.kind).toBe('selected');
expect(clipped.diagnostics.clipped_count).toBe(1);
expect(clipped.diagnostics.candidates[0]).toMatchObject({checked:true,visible:false,clipped:true,hit:false});
// A selected checkbox behind an overlay is not verified visible selection.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<label><input checked type="checkbox">Amount spent</label><div style="position:fixed;inset:0;background:white"></div>');
const occluded=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(occluded.kind).toBe('wait');expect(occluded.reason).toBe('Report control occluded');
expect(occluded.diagnostics.candidates[0].hit).toBe(false);
// Signature evidence must only include the visible option projection.
await page.evaluate(()=>document.querySelector('[role="dialog"]').innerHTML='<h2>Customize columns</h2><input aria-label="search columns" value="Amount spent"><div style="height:20px;overflow:hidden"><div style="height:40px"></div><label><input id="clipped-option" type="checkbox">Budget</label></div><label><input checked type="checkbox">Amount spent</label>');
const beforeClip=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'search'}));
await page.evaluate(()=>document.querySelector('#clipped-option').checked=true);
const afterClip=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'search'}));
expect(afterClip.signature).toBe(beforeClip.signature);
expect(afterClip.diagnostics.clipped_choice_count).toBe(1);
await page.evaluate(()=>document.querySelector('[role="dialog"]').insertAdjacentHTML('beforeend','<div role="progressbar">Loading</div>'));
const busy=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',query:'Amount spent',field:{key:'spend',labels:['Amount spent'],required:true}}));
expect(busy.kind).toBe('wait');expect(busy.diagnostics.visible_busy_count).toBe(1);
}finally{await browser.close();}
