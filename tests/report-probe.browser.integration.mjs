import {chromium,expect} from '@playwright/test';import {build} from 'esbuild';
const b=await build({entryPoints:['apps/extension/src/report-probe.ts'],bundle:true,write:false,format:'iife',globalName:'Probe'});
const browser=await chromium.launch({channel:'chromium',headless:true});const page=await browser.newPage();
await page.route('https://adsmanager.facebook.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="dialog" aria-label="ปรับแต่งคอลัมน์"><li><input type="checkbox"><span>ID โฆษณา</span><span> ชื่อและ ID ของวัตถุ &gt; ชื่อและ ID ของวัตถุ</span></li></div>'}));
try{await page.goto('https://adsmanager.facebook.com/adsmanager/manage/ads?act=123');await page.addScriptTag({content:b.outputFiles[0].text});const p=await page.evaluate(()=>Probe.probeReportTarget({account:'123',op:'field',field:{key:'ad_id',labels:['ID โฆษณา'],required:true}}));expect(p.kind).toBe('click');}finally{await browser.close();}
