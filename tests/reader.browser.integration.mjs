import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["apps/extension/src/reader.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ReaderFixture",
  target: "chrome120",
});
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
let fixture = "";
await page.route("https://adsmanager.facebook.com/**", (route) =>
  route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }),
);
async function read(html, path = "/adsmanager/manage/campaigns", prepare) {
  fixture = html;
  await page.goto(`https://adsmanager.facebook.com${path}?act=123456789`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  if (prepare) await page.evaluate(prepare);
  return page.evaluate(() => ReaderFixture.readVisibleTable());
}
try {
  const grid = await read(
    '<div role="grid"><div role="row"><div role="columnheader">Campaign</div><div role="columnheader">Spend</div></div><div role="row"><div role="gridcell">A</div><div role="gridcell">100</div></div></div>',
  );
  expect(grid.format).toBe("structured");
  expect(grid.tables[0].rows).toEqual([["A", "100"]]);
  expect(grid.unstructured).toBe(null);
  const tree = await read(
    '<div role="treegrid"><div role="row"><div role="columnheader">Campaign</div><div role="columnheader">Spend</div></div><div role="row"><div role="rowheader">A</div><div role="cell">100</div></div></div>',
  );
  expect(tree.tables[0].rows).toEqual([["A", "100"]]);
  const raw = await read(
    '<button>30 วันที่ผ่านมา: 16 ต.ค. – 14 พ.ย. 2026</button><button>คอลัมน์: คอนเวอร์ชั่นการส่งข้อความ</button><div class="report"><div class="headers"><div role="columnheader">Campaign</div><div role="columnheader">Results</div></div><div><a href="#ad">Campaign example</a><div>16</div><button role="switch">On</button><input type="password" value="must-not-read"></div><div style="margin-top:2000px"><a href="#off">Offscreen campaign</a><div>999</div></div></div>',
  );
  expect(raw.format).toBe("visible_text_fallback");
  expect(raw.tables).toEqual([]);
  expect(raw.unstructured.headers).toEqual(["Campaign", "Results"]);
  expect(raw.unstructured.viewport_text).toContain("16");
  expect(raw.unstructured.viewport_text).not.toContain("999");
  expect(raw.unstructured.viewport_text).not.toContain("must-not-read");
  expect(raw.unstructured.entity_labels).toEqual(["Campaign example"]);
  expect(raw.reporting_context.attribution).toBe("unverified");
  expect(raw.reporting_context.column_preset_label).toContain("คอนเวอร์ชั่น");
  expect(raw.warnings.some((w) => w.includes("Do not normalize"))).toBe(true);
  const noTable = await read('<h1>Log in</h1><a href="#login">Log in</a>');
  const columns = await read(
    '<div class="workspace"><nav><a href="#nav">All ads navigation</a></nav><div class="report" style="display:flex"><div><div role="columnheader">Campaign</div><a href="#campaign">Real campaign</a></div><div><div role="columnheader">Status</div><button role="switch">On</button></div></div></div>',
  );
  expect(columns.unstructured.entity_labels).toEqual(["Real campaign"]);
  expect(columns.unstructured.viewport_text).not.toContain(
    "All ads navigation",
  );
  const unloaded = await read(
    '<div class="workspace"><nav><a href="#nav">All ads navigation</a></nav><div class="report"><div role="columnheader">Campaign</div><div role="columnheader">Spend</div><div>Loading rows</div></div></div>',
  );
  expect(unloaded.unstructured).toBe(null);
  expect(noTable.tables).toEqual([]);
  expect(noTable.unstructured).toBe(null);
  const headersOnly = await read(
    '<div><div role="columnheader">Campaign</div><div role="columnheader">Spend</div></div><a href="#other">Unrelated navigation</a>',
  );
  expect(headersOnly.unstructured).toBe(null);
  // Realistic column-oriented layout: duplicate names remain separate observations.
  const geometry =
    await read(`<div id="report" style="position:relative;width:900px;height:250px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:100px;height:40px">On / Off</div>
    <div role="columnheader" style="position:absolute;left:100px;top:0;width:300px;height:40px">Ad</div>
    <div role="columnheader" style="position:absolute;left:400px;top:0;width:200px;height:40px">Amount spent (THB)</div>
    <div role="columnheader" style="position:absolute;left:600px;top:0;width:200px;height:40px">Purchases</div>
    ${[0, 1]
      .map(
        (
          i,
        ) => `<div role="switch" style="position:absolute;left:10px;top:${60 + i * 50}px;width:40px;height:24px"></div>
      <div style="position:absolute;left:110px;top:${60 + i * 50}px">Same ad name</div>
      <div style="position:absolute;left:410px;top:${60 + i * 50}px">${i ? 200 : 100}</div>
      <div style="position:absolute;left:610px;top:${60 + i * 50}px">${i ? 4 : 2}</div>`,
      )
      .join("")}
    <input type="password" value="never-export" style="position:absolute;left:810px;top:65px">
  </div>`);
  expect(geometry.reader_version).toBe("0.6.1");
  expect(geometry.row_observations).toHaveLength(2);
  expect(geometry.row_observations.map((r) => r.name)).toEqual([
    "Same ad name",
    "Same ad name",
  ]);
  expect(
    geometry.row_observations[0].cells.find(
      (c) => c.header === "Amount spent (THB)",
    ).text,
  ).toBe("100");
  expect(
    geometry.row_observations[1].cells.find((c) => c.header === "Purchases")
      .text,
  ).toBe("4");
  expect(
    geometry.row_observations.every(
      (r) => r.identity === null && r.method === "geometry",
    ),
  ).toBe(true);
  expect(JSON.stringify(geometry.row_observations)).not.toContain(
    "never-export",
  );
  const scrolling =
    await read(`<div id="scroller" style="width:500px;height:150px;overflow:auto"><div style="width:1400px;height:600px">
    <div role="columnheader" style="width:200px;height:40px">Ad</div><div role="columnheader" style="width:200px;height:40px">Spend</div>
    <button role="switch">On</button><a href="#example">Ad example</a></div></div>`);
  expect(
    await page.evaluate(() => ReaderFixture.scrollReportingTable("horizontal")),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.querySelector("#scroller").scrollLeft),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      ReaderFixture.scrollReportingTable("reset_horizontal"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.querySelector("#scroller").scrollLeft),
  ).toBe(0);
  expect(
    await page.evaluate(() => ReaderFixture.scrollReportingTable("vertical")),
  ).toBe(true);
  // Ads level (fixture only): checkbox-anchored rows, Thai headers, headers covered
  // by an overlay, IDs and parent IDs from row link hrefs, visible context evidence.
  const adsHtml = `<button>30 วันที่ผ่านมา: 16 ต.ค. 2026 – 14 พ.ย. 2026</button>
  <div id="tip" style="position:fixed;left:0;top:30px;width:1000px;height:40px;z-index:10;background:#fff">tooltip overlay</div>
  <div id="report" style="position:relative;width:960px;height:260px;margin-top:22px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:40px;height:40px"><input type="checkbox" aria-label="เลือกทั้งหมด"></div>
    <div role="columnheader" style="position:absolute;left:40px;top:0;width:300px;height:40px">โฆษณา</div>
    <div role="columnheader" style="position:absolute;left:340px;top:0;width:200px;height:40px">จำนวนเงินที่ใช้จ่ายไป</div>
    <div role="columnheader" style="position:absolute;left:540px;top:0;width:200px;height:40px">อิมเพรสชัน</div>
    <div role="columnheader" style="position:absolute;left:740px;top:0;width:200px;height:40px">ผลลัพธ์</div>
    ${[0, 1, 2]
      .map(
        (i) => `<input type="checkbox" style="position:absolute;left:10px;top:${64 + i * 50}px">
      <a href="${i === 2 ? "#" : `https://adsmanager.facebook.com/adsmanager/manage/ads/edit?act=123456789&selected_campaign_ids=111&selected_adset_ids=222&selected_ad_ids=33${i}`}" style="position:absolute;left:50px;top:${60 + i * 50}px">Same ad name</a>
      <div style="position:absolute;left:350px;top:${60 + i * 50}px">฿${i + 1}00.00</div>
      <div style="position:absolute;left:550px;top:${60 + i * 50}px">${i + 1},000</div>
      <div style="position:absolute;left:750px;top:${60 + i * 50}px">${i ? "—" : "5"}</div>`,
      )
      .join("")}
  </div>
  <p style="position:absolute;top:420px">เขตเวลาของบัญชี: Asia/Bangkok</p>`;
  const ads = await read(adsHtml, "/adsmanager/manage/ads", () => {
    const r = document.querySelector("#report").getBoundingClientRect();
    Object.assign(document.querySelector("#tip").style, { top: `${r.top}px`, height: "40px" });
  });
  expect(ads.level).toBe("ads");
  expect(ads.header_mode).toBe("clip");
  expect(ads.row_observations).toHaveLength(3);
  expect(ads.row_observations.map((r) => r.identity)).toEqual(["330", "331", null]);
  expect(ads.row_observations[0].identity_source).toBe("row_link_href");
  expect(ads.row_observations[0].parent_ids).toEqual({ campaign_id: "111", ad_set_id: "222" });
  expect(ads.row_observations[0].column_mapping).toBe("verified_geometry");
  expect(ads.row_observations[2].column_mapping).toBe("unverified");
  expect(ads.row_observations[1].cells.find((c) => c.header === "ผลลัพธ์").text).toBe("—");
  expect(ads.row_observations[0].name).toBe("Same ad name");
  expect(ads.reporting_context.currency).toBe("THB");
  expect(ads.reporting_context.timezone).toBe("Asia/Bangkok");
  expect(ads.reporting_context.attribution).toBe("unverified");
  expect(ads.reporting_context.date_range_label).toContain("14 พ.ย. 2026");
  expect(ads.column_alignment).toBe("aligned");
  const wait = await page.evaluate(() => ReaderFixture.waitForReportingRows(1000));
  expect(wait.ready).toBe(true);
  expect(wait.checkboxes).toBe(3);
  // Rows not rendered yet: the wait helper reports why instead of hanging.
  await read('<div><div role="columnheader">โฆษณา</div><div role="columnheader">ผลลัพธ์</div></div>', "/adsmanager/manage/ads");
  const notReady = await page.evaluate(() => ReaderFixture.waitForReportingRows(600));
  expect(notReady.ready).toBe(false);
  expect(notReady.headers).toBe(2);
  // Duplicate IDs across rows are not stable identities.
  const dup = await read(
    `<div id="report" style="position:relative;width:900px;height:200px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:100px;height:40px">ปิด / เปิด</div>
    <div role="columnheader" style="position:absolute;left:100px;top:0;width:300px;height:40px">แคมเปญ</div>
    <div role="columnheader" style="position:absolute;left:400px;top:0;width:200px;height:40px">อิมเพรสชัน</div>
    ${[0, 1].map((i) => `<div role="switch" style="position:absolute;left:10px;top:${60 + i * 50}px;width:40px;height:24px"></div>
    <a href="/adsmanager/manage/adsets?act=123456789&selected_campaign_ids=777" style="position:absolute;left:110px;top:${60 + i * 50}px">Campaign ${i}</a>
    <div style="position:absolute;left:410px;top:${60 + i * 50}px">${i + 1}</div>`).join("")}
  </div>`,
  );
  expect(dup.row_observations.map((r) => r.identity)).toEqual([null, null]);
  // Header/body in separate scrollers with different offsets: mapping rejected,
  // then the synced horizontal reset realigns them.
  const split = `<div id="wrap"><div id="hs" style="width:600px;overflow:hidden"><div style="position:relative;width:1200px;height:40px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:100px;height:40px">ปิด / เปิด</div>
    <div role="columnheader" style="position:absolute;left:100px;top:0;width:300px;height:40px">แคมเปญ</div>
    <div role="columnheader" style="position:absolute;left:400px;top:0;width:200px;height:40px">อิมเพรสชัน</div>
    <div role="columnheader" style="position:absolute;left:600px;top:0;width:200px;height:40px">ผลลัพธ์</div></div></div>
  <div id="bs" style="width:600px;height:200px;overflow:auto"><div style="position:relative;width:1200px;height:300px">
    <div role="switch" style="position:absolute;left:10px;top:20px;width:40px;height:24px"></div>
    <a href="/adsmanager/manage/adsets?act=123456789&selected_campaign_ids=555" style="position:absolute;left:110px;top:20px">Split campaign</a>
    <div style="position:absolute;left:410px;top:20px">1,234</div><div style="position:absolute;left:610px;top:20px">7</div></div></div></div>`;
  const mismatch = await read(split, "/adsmanager/manage/campaigns", () => {
    document.querySelector("#hs").scrollLeft = 150;
  });
  expect(mismatch.column_alignment).toBe("mismatch");
  expect(mismatch.row_observations).toHaveLength(1);
  expect(mismatch.row_observations.every((r) => r.column_mapping === "unverified")).toBe(true);
  expect(
    await page.evaluate(() => ReaderFixture.scrollReportingTable("reset_horizontal")),
  ).toBe(true);
  const realigned = await page.evaluate(() => ReaderFixture.readVisibleTable());
  expect(realigned.column_alignment).toBe("aligned");
  expect(realigned.row_observations[0].identity).toBe("555");
  expect(realigned.row_observations[0].column_mapping).toBe("verified_geometry");
  expect(realigned.row_observations[0].cells.find((c) => c.header === "อิมเพรสชัน").text).toBe("1,234");
  expect(
    await page.evaluate(() => ReaderFixture.scrollReportingTable("horizontal")),
  ).toBe(true);
  expect(
    await page.evaluate(() => [document.querySelector("#hs").scrollLeft, document.querySelector("#bs").scrollLeft]),
  ).toEqual(await page.evaluate(() => [document.querySelector("#bs").scrollLeft, document.querySelector("#bs").scrollLeft]));
  // Live-shaped layout (synthetic names): body scroller is overflow:hidden with a
  // custom scrollbar, rows are pre-rendered below the clip, a row has hover buttons
  // in its name cell and Meta's summary row overlaps the last visible row band.
  const liveShaped = `<div id="wrap" style="position:relative;width:900px">
    <div style="position:relative;width:900px;height:40px">
      <div role="columnheader" style="position:absolute;left:0;top:0;width:100px;height:40px">ปิด / เปิด</div>
      <div role="columnheader" style="position:absolute;left:100px;top:0;width:300px;height:40px">แคมเปญ</div>
      <div role="columnheader" style="position:absolute;left:400px;top:0;width:200px;height:40px">การแสดงโฆษณา</div>
      <div role="columnheader" style="position:absolute;left:600px;top:0;width:200px;height:40px">ผลลัพธ์</div>
    </div>
    <div id="body" style="position:relative;width:900px;height:200px;overflow:hidden">
      <div style="position:relative;height:400px">
      ${[0, 1, 2, 3, 4, 5, 6, 7]
        .map(
          (i) => `<div role="switch" style="position:absolute;left:10px;top:${i * 50 + 10}px;width:40px;height:20px"></div>
        <div style="position:absolute;left:110px;top:${i * 50 + 8}px">Fixture ${i}</div>
        ${i === 0 ? '<div role="button" style="position:absolute;left:110px;top:28px">แก้ไข</div><div role="button" style="position:absolute;left:170px;top:28px">วิเคราะห์</div>' : ""}
        <div style="position:absolute;left:410px;top:${i * 50 + 8}px">ปิด</div>
        <div style="position:absolute;left:610px;top:${i * 50 + 8}px">${i + 1}0</div>`,
        )
        .join("")}
      </div>
    </div>
    <div style="position:relative;width:900px;height:30px;margin-top:-22px;background:#fff">
      <div style="position:absolute;left:110px;top:4px">ผลลัพธ์จาก 8 แคมเปญ</div>
      <div style="position:absolute;left:610px;top:4px">999</div>
    </div>
  </div>`;
  const live = await read(liveShaped);
  expect(live.reader_version).toBe("0.6.1");
  expect(live.row_observations.map((r) => r.name)).toEqual(["Fixture 0", "Fixture 1", "Fixture 2", "Fixture 3"]);
  expect(live.row_observations[0].cells.find((c) => c.header === "แคมเปญ").text).toBe("Fixture 0");
  expect(live.row_observations[3].cells.find((c) => c.header === "แคมเปญ").text).toBe("Fixture 3");
  expect(live.row_observations[3].cells.find((c) => c.header === "ผลลัพธ์").text).toBe("40");
  expect(JSON.stringify(live.row_observations)).not.toContain("999");
  expect(live.reported_total_rows).toBe(8);
  expect(await page.evaluate(() => ReaderFixture.scrollReportingTable("vertical"))).toBe(true);
  expect(await page.evaluate(() => document.querySelector("#body").scrollTop)).toBe(150);
  const liveNext = await page.evaluate(() => ReaderFixture.readVisibleTable());
  expect(liveNext.row_observations.map((r) => r.name)).toEqual(["Fixture 3", "Fixture 4", "Fixture 5", "Fixture 6"]);
  // Script-virtualized body without any scrollable element: one wheel event is sent.
  await read(
    `<div id="vwrap" style="position:relative;width:900px">
    <div style="position:relative;height:40px"><div role="columnheader" style="position:absolute;left:0;width:100px;height:40px">ปิด / เปิด</div><div role="columnheader" style="position:absolute;left:100px;width:300px;height:40px">แคมเปญ</div></div>
    <div id="vbody" style="position:relative;height:120px;overflow:hidden">
      ${[0, 1].map((i) => `<div role="switch" style="position:absolute;left:10px;top:${i * 50 + 10}px;width:40px;height:20px"></div><div style="position:absolute;left:110px;top:${i * 50 + 8}px">Virtual ${i}</div>`).join("")}
    </div></div>`,
    "/adsmanager/manage/campaigns",
    () => {
      window.__wheel = 0;
      document.querySelector("#vbody").addEventListener("wheel", (e) => (window.__wheel = e.deltaY));
    },
  );
  expect(await page.evaluate(() => ReaderFixture.scrollReportingTable("vertical"))).toBe(true);
  expect(await page.evaluate(() => window.__wheel)).toBe(50);
  console.log(
    "Reader 0.6.1 fixtures passed: summary row excluded and counted, hover buttons stripped from names, overflow:hidden body scrolled by one page with one row overlap, wheel fallback for script-virtualized bodies;",
  );
  console.log(
    "Reader integration (fixtures only) passed: ads-level checkbox rows, href IDs and parent IDs, duplicate-ID rejection, header overlay fallback, scroll mismatch detection and synced scrolling, visible currency/timezone evidence, wait diagnostics;",
  );
  console.log(
    "Reader integration passed: structured grid, treegrid cells, gridless text fallback, viewport filtering, no invented rows, unknown attribution and empty-page rejection",
  );
} finally {
  await browser.close();
}
