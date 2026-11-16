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
  expect(raw.reporting_context.breakdown).toBe(null);
  expect(raw.reporting_context.filters).toBe(null);
  expect(raw.reporting_context.evidence.breakdown).toBe("unverified");
  expect(raw.reporting_context.evidence.filters).toBe("unverified");
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
  expect(geometry.reader_version).toBe("0.6.5");
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
  expect(live.reader_version).toBe("0.6.5");
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
  // Sticky summary row positioned outside its zero-height wrapper (as seen live on 0.6.1).
  const detached = liveShaped.replace(
    '<div style="position:relative;width:900px;height:30px;margin-top:-22px;background:#fff">',
    '<div style="position:relative;width:900px;height:0"><div style="position:absolute;left:0;top:-22px;width:900px;height:26px;background:#fff">',
  ).replace('<div style="position:absolute;left:610px;top:4px">999</div>\n    </div>', '<div style="position:absolute;left:610px;top:4px">999</div>\n    </div></div>');
  expect(detached).not.toBe(liveShaped);
  const det = await read(detached);
  expect(det.reported_total_rows).toBe(8);
  expect(JSON.stringify(det.row_observations)).not.toContain("ผลลัพธ์จาก");
  expect(JSON.stringify(det.row_observations)).not.toContain("999");
  // Verified paging: overflow:hidden body moves and the visible rows change.
  const paged = await page.evaluate(() => ReaderFixture.scrollReportingRows());
  expect(paged.moved).toBe(true);
  expect(paged.method).toBe("ancestor");
  expect(await page.evaluate(() => document.querySelector("#body").scrollTop)).toBe(150);
  // Script-virtualized body that pages on wheel.
  await read(
    `<div style="position:relative;width:900px">
    <div style="position:relative;height:40px"><div role="columnheader" style="position:absolute;left:0;width:100px;height:40px">ปิด / เปิด</div><div role="columnheader" style="position:absolute;left:100px;width:300px;height:40px">แคมเปญ</div></div>
    <div id="vb" style="position:relative;height:200px;overflow:hidden"><div id="vc">
      ${[0, 1, 2, 3].map((i) => `<div role="switch" style="position:absolute;left:10px;top:${i * 50 + 10}px;width:40px;height:20px"></div><div style="position:absolute;left:110px;top:${i * 50 + 8}px;width:280px">Virtual ${i}</div>`).join("")}
    </div></div></div>`,
    "/adsmanager/manage/campaigns",
    () => {
      document.querySelector("#vb").addEventListener("wheel", (e) => {
        document.querySelector("#vc").style.transform = `translateY(-${e.deltaY}px)`;
      });
    },
  );
  const wheeled = await page.evaluate(() => ReaderFixture.scrollReportingRows());
  expect(wheeled.moved).toBe(true);
  expect(wheeled.method).toBe("wheel");
  // Nothing can move: reported as not moved instead of pretending.
  await read(
    `<div style="position:relative;width:900px;height:200px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:100px;height:40px">ปิด / เปิด</div><div role="columnheader" style="position:absolute;left:100px;top:0;width:300px;height:40px">แคมเปญ</div>
    ${[0, 1].map((i) => `<div role="switch" style="position:absolute;left:10px;top:${60 + i * 50}px;width:40px;height:20px"></div><div style="position:absolute;left:110px;top:${58 + i * 50}px">Static ${i}</div>`).join("")}</div>`,
  );
  const stuck = await page.evaluate(() => ReaderFixture.scrollReportingRows());
  expect(stuck.moved).toBe(false);
  expect(stuck.method).toBe("none");
  expect(stuck.tried.map((t) => t.method)).toEqual(["wheel", "scroll_into_view"]);
  // A live metric refresh while a synthetic wheel is ignored is not paging.
  await page.evaluate(() => {
    const value = document.createElement("div"); value.id="refreshing-metric";
    value.textContent="10";value.style.cssText="position:absolute;left:410px;top:60px";
    document.querySelector('[role="switch"]').parentElement.append(value);
    document.addEventListener("wheel", () => {value.textContent=String(Number(value.textContent)+1);}, {once:true});
  });
  const metricOnlyPaging = await page.evaluate(() => ReaderFixture.scrollReportingRows());
  expect(metricOnlyPaging.moved).toBe(false);
  // Native paging target planning: the old fixed offset lands on an interactive
  // name cell. A safe cell in another visible reporting column is available.
  const nativeTargets = `<div id="native-report" style="position:relative;width:900px;height:250px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
    <div role="columnheader" style="position:absolute;left:80px;top:0;width:320px;height:40px">Ad</div>
    <div role="columnheader" style="position:absolute;left:400px;top:0;width:220px;height:40px">Amount spent</div>
    <div role="columnheader" style="position:absolute;left:620px;top:0;width:220px;height:40px">Ad ID</div>
    <div style="position:absolute;left:0;top:40px;width:900px;height:190px">
      ${[0,1,2].map(i=>`<div role="switch" style="position:absolute;left:10px;top:${20+i*50}px;width:40px;height:20px"></div>
      <button style="position:absolute;left:90px;top:${15+i*50}px;width:300px;height:30px">Fixture ${i}</button>
      <div class="safe-metric" style="position:absolute;left:410px;top:${15+i*50}px;width:200px;height:30px">100</div>
      <div style="position:absolute;left:630px;top:${15+i*50}px;width:200px;height:30px">111${i}</div>`).join('')}
    </div></div>`;
  await read(nativeTargets, "/adsmanager/manage/ads");
  const targetPlan = await page.evaluate(() => ReaderFixture.probeReportingScroll("123456789"));
  expect(targetPlan.ready, JSON.stringify(targetPlan)).toBe(true);
  expect(targetPlan.x).toBeGreaterThan(400);
  expect(targetPlan.x).toBeLessThan(620);
  expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y).classList.contains('safe-metric'),targetPlan)).toBe(true);
  await page.evaluate(() => {
    const blocker=document.createElement('button');blocker.style.cssText='position:absolute;left:0;top:40px;width:900px;height:190px;z-index:10';blocker.textContent='Edit ad';
    document.querySelector('#native-report').append(blocker);
  });
  const allBlocked = await page.evaluate(() => ReaderFixture.probeReportingScroll("123456789"));
  expect(allBlocked.ready).toBe(false);
  expect(allBlocked.reason).toBe("reporting_target_occluded");
  await read(nativeTargets, "/adsmanager/manage/ads");
  await page.evaluate(() => {
    const foreign=document.createElement('div');foreign.style.cssText='position:fixed;left:0;top:0;width:950px;height:300px;z-index:20;background:white';foreign.textContent='Unrelated outside panel';document.body.append(foreign);
  });
  const foreignBlocked = await page.evaluate(() => ReaderFixture.probeReportingScroll("123456789"));
  expect(foreignBlocked.ready).toBe(false);
  expect(foreignBlocked.reason).toBe("reporting_target_occluded");
  // Frozen row controls/name pane is safe to point at but ignores wheel input;
  // the separate metric body owns virtual paging. A safe point is not proof
  // that its pane is the scrolling body.
  const splitNativeBody = `<div style="position:relative;width:900px;height:250px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px">On / Off</div>
    <div role="columnheader" style="position:absolute;left:80px;top:0;width:320px;height:40px">Ad</div>
    <div role="columnheader" style="position:absolute;left:400px;top:0;width:220px;height:40px">Amount spent</div>
    <div role="columnheader" style="position:absolute;left:620px;top:0;width:220px;height:40px">Impressions</div>
    <div id="frozen-left" style="position:absolute;left:0;top:40px;width:400px;height:190px;overflow:hidden">
      ${[0,1,2].map(i=>`<div role="switch" style="position:absolute;left:10px;top:${20+i*50}px;width:40px;height:20px"></div><div class="names" style="position:absolute;left:90px;top:${15+i*50}px;width:300px;height:30px">Fixture ${i}</div>`).join('')}
    </div><div id="metric-body" style="position:absolute;left:400px;top:40px;width:500px;height:190px;overflow:hidden">
      ${[0,1,2].map(i=>`<div style="position:absolute;left:10px;top:${15+i*50}px;width:200px;height:30px">100</div><div style="position:absolute;left:230px;top:${15+i*50}px;width:200px;height:30px">1000</div>`).join('')}
    </div></div><script>
    document.querySelector('#frozen-left').addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();});
    document.querySelector('#metric-body').addEventListener('wheel',e=>{e.preventDefault();document.querySelectorAll('.names').forEach((el,i)=>el.textContent='Next '+i);});
    </script>`;
  await read(splitNativeBody, "/adsmanager/manage/ads");
  await page.mouse.move(170, 120);
  await page.mouse.wheel(0, 80);
  await expect(page.locator('.names').first()).toHaveText('Fixture 0');
  const splitBodyPlan = await page.evaluate(() => ReaderFixture.probeReportingScroll("123456789"));
  expect(splitBodyPlan.ready, JSON.stringify(splitBodyPlan)).toBe(true);
  expect(splitBodyPlan.x).toBeGreaterThan(400);
  expect(splitBodyPlan.targets.length).toBeGreaterThanOrEqual(2);
  expect(splitBodyPlan.targets.length).toBeLessThanOrEqual(4);
  expect(new Set(splitBodyPlan.targets.map(t=>t.band_index)).size).toBe(splitBodyPlan.targets.length);
  await page.mouse.move(splitBodyPlan.x, splitBodyPlan.y);
  await page.mouse.wheel(0, 80);
  await expect(page.locator('.names').first()).toHaveText('Next 0');
  const afterSplitBody = await page.evaluate(() => ReaderFixture.probeReportingScroll("123456789"));
  expect(afterSplitBody.signature).not.toBe(splitBodyPlan.signature);
  // Body offsets are local to the target's actual headerless scroll chain.
  // A separate frozen name pane or outside editor must not become that chain.
  await page.evaluate(()=>{
    const extent=document.createElement('div');extent.style.cssText='position:absolute;left:10px;top:980px;width:10px;height:20px';
    document.getElementById('metric-body').append(extent);
    const unrelated=document.createElement('div');unrelated.style.cssText='position:absolute;left:920px;top:40px;width:60px;height:190px;overflow:auto';
    unrelated.innerHTML='<div style="height:1400px">Other panel</div>';document.body.append(unrelated);
  });
  const withBodyOffsets=await page.evaluate(()=>ReaderFixture.probeReportingScroll('123456789'));
  expect(withBodyOffsets.targets[0].body_offsets).toEqual([{scroll_top:0,client_height:190,scroll_height:1000}]);
  expect(withBodyOffsets.targets.find(t=>t.column_kind==='name').body_offsets).toEqual([]);
  await page.evaluate(()=>{document.getElementById('metric-body').scrollTop=60;});
  const scrolledBodyOffsets=await page.evaluate(()=>ReaderFixture.probeReportingScroll('123456789'));
  expect(scrolledBodyOffsets.signature).toBe(withBodyOffsets.signature);
  expect(scrolledBodyOffsets.targets[0].body_offsets).toEqual([{scroll_top:60,client_height:190,scroll_height:1000}]);
  // Horizontal report layout: switches/names are frozen; metric cells are in a
  // separate marker-free body. Pan the header and metric body together, never
  // the frozen pane or an unrelated scrollable editor.
  const markerFreeMetrics = `<div id="pan-report" style="position:relative;width:780px;height:260px">
    <div role="columnheader" style="position:absolute;left:0;top:0;width:80px;height:40px;z-index:3;background:white">On / Off</div>
    <div id="fixed-name-header" style="position:absolute;left:80px;top:0;width:180px;height:40px;overflow:hidden;z-index:3;background:white"><div role="columnheader" style="width:180px;height:40px">Ad</div><div style="position:absolute;left:400px;top:0;width:10px;height:1px"></div></div>
    <div id="metric-headers" style="position:absolute;left:260px;top:0;width:500px;height:40px;overflow:hidden"><div style="position:relative;width:1300px;height:40px">
      ${['Amount spent','Impressions','Results','Ad ID','Link clicks'].map((s,i)=>`<div role="columnheader" style="position:absolute;left:${i*220}px;top:0;width:220px;height:40px">${s}</div>`).join('')}
    </div></div>
    <div id="fixed-names" style="position:absolute;left:0;top:40px;width:260px;height:220px;overflow:hidden"><div style="position:relative;width:400px;height:220px">
      ${[0,1,2].map(i=>`<div role="switch" style="position:absolute;left:10px;top:${20+i*60}px;width:40px;height:24px"></div><div style="position:absolute;left:90px;top:${20+i*60}px;width:160px;height:24px">Fixed ${i}</div>`).join('')}
    </div></div>
    <div id="plain-metrics" style="position:absolute;left:260px;top:40px;width:500px;height:220px;overflow:auto"><div style="position:relative;width:1300px;height:220px">
      ${[0,1,2].map(i=>[100+i,1000+i,10+i,1110+i,20+i].map((n,j)=>`<div style="position:absolute;left:${10+j*220}px;top:${20+i*60}px;width:190px;height:24px">${n}</div>`).join('')).join('')}
    </div></div></div>
    <div id="unrelated-editor" style="position:absolute;left:790px;top:50px;width:180px;height:180px;overflow:auto"><div style="width:1200px;height:600px"><input aria-label="Ad budget" value="500"><p>Editor content</p></div></div>`;
  await read(markerFreeMetrics, "/adsmanager/manage/ads");
  expect(await page.evaluate(() => ReaderFixture.scrollReportingTable('horizontal'))).toBe(true);
  const panOffsets = await page.evaluate(() => ['metric-headers','plain-metrics','fixed-names','unrelated-editor'].map(id=>document.getElementById(id).scrollLeft));
  expect(panOffsets[0]).toBeGreaterThan(0);
  expect(panOffsets[1]).toBe(panOffsets[0]);
  expect(panOffsets.slice(2)).toEqual([0,0]);
  expect(await page.evaluate(()=>document.getElementById('fixed-name-header').scrollLeft)).toBe(0);
  const afterMetricPan = await page.evaluate(() => ReaderFixture.readVisibleTable());
  expect(afterMetricPan.column_alignment).toBe('aligned');
  expect(afterMetricPan.row_observations.map(r=>r.identity)).toEqual(['1110','1111','1112']);
  expect(afterMetricPan.row_observations.every(r=>r.column_mapping==='verified_geometry')).toBe(true);
  expect(afterMetricPan.column_alignment_diagnostics.scrollers.some(s=>s.role==='body_text'&&s.included&&s.scroll_left===panOffsets[0])).toBe(true);
  expect(afterMetricPan.column_alignment_diagnostics.scrollers.some(s=>s.role==='body_markers'&&!s.included&&s.scroll_left===0)).toBe(true);
  await page.evaluate(()=>{document.getElementById('metric-headers').scrollLeft-=40;});
  const actualMismatch=await page.evaluate(()=>ReaderFixture.readVisibleTable());
  expect(actualMismatch.column_alignment).toBe('mismatch');
  expect(actualMismatch.row_observations.every(r=>r.column_mapping==='unverified')).toBe(true);
  await page.evaluate(()=>ReaderFixture.scrollReportingTable('reset_horizontal'));
  expect(await page.evaluate(()=>['metric-headers','plain-metrics','fixed-names','unrelated-editor'].map(id=>document.getElementById(id).scrollLeft))).toEqual([0,0,0,0]);
  await page.evaluate(()=>{[...document.querySelector('#plain-metrics>div').children].slice(5).forEach(el=>el.remove());});
  expect(await page.evaluate(()=>ReaderFixture.scrollReportingTable('horizontal'))).toBe(false);
  expect(await page.evaluate(()=>document.getElementById('metric-headers').scrollLeft)).toBe(0);
  await page.evaluate(()=>{document.querySelector('#metric-headers>div').setAttribute('role','row');document.getElementById('metric-headers').scrollLeft=50;});
  const headerRowWithoutBody=await page.evaluate(()=>ReaderFixture.readVisibleTable());
  expect(headerRowWithoutBody.column_alignment).toBe('mismatch');
  // Explicit parent ID columns are required when Meta renders plain names
  // without hrefs. Repeated parent IDs are valid; names are never identifiers.
  const idColumnsHtml = (parentHref = null, conflictingParentHref = false) => `<div style="position:relative;width:940px;height:240px">
    <div id="id-headers" style="position:absolute;left:0;top:0;width:940px;height:40px;overflow:hidden"><div style="position:relative;width:1100px;height:40px">
      ${[['On / Off',0,80],['Ad',80,200],['Campaign ID',280,150],['Ad set ID',430,150],['Ad ID',580,150],['Amount spent',730,150]].map(([s,x,w])=>`<div role="columnheader" style="position:absolute;left:${x}px;top:0;width:${w}px;height:40px">${s}</div>`).join('')}
    </div></div><div id="id-body" style="position:absolute;left:0;top:40px;width:940px;height:200px;overflow:hidden"><div style="position:relative;width:1100px;height:200px">
      ${[0,1].map(i=>`<div role="switch" style="position:absolute;left:10px;top:${20+i*60}px;width:40px;height:24px"></div>
        ${i===0&&parentHref?`<a href="/adsmanager/manage/ads?act=123456789&selected_campaign_ids=${parentHref}&selected_adset_ids=222&selected_ad_ids=333" style="position:absolute;left:90px;top:20px">Same ad ${i}</a>${conflictingParentHref?'<a href="/adsmanager/manage/ads?act=123456789&selected_campaign_ids=888&selected_adset_ids=222&selected_ad_ids=333" style="position:absolute;left:90px;top:38px">Other link</a>':''}`:`<div style="position:absolute;left:90px;top:${20+i*60}px">Same ad ${i}</div>`}
        ${[[111,290],[222,440],[333+i,590],[100+i,740]].map(([n,x])=>`<div style="position:absolute;left:${x}px;top:${20+i*60}px">${n}</div>`).join('')}`).join('')}
    </div></div></div>`;
  const columnParents=await read(idColumnsHtml(),'/adsmanager/manage/ads');
  expect(columnParents.row_observations.map(r=>r.identity)).toEqual(['333','334']);
  expect(columnParents.row_observations.every(r=>r.identity_source==='id_column'&&r.column_mapping==='verified_geometry')).toBe(true);
  expect(columnParents.row_observations.map(r=>r.parent_ids)).toEqual([{campaign_id:'111',ad_set_id:'222'},{campaign_id:'111',ad_set_id:'222'}]);
  const conflictingParent=await read(idColumnsHtml('999'),'/adsmanager/manage/ads');
  expect(conflictingParent.row_observations[0].parent_ids).toEqual({campaign_id:null,ad_set_id:'222'});
  expect(conflictingParent.row_observations[0].warnings.some(s=>/parent.*disagree/i.test(s))).toBe(true);
  const conflictingParentLinks=await read(idColumnsHtml('111',true),'/adsmanager/manage/ads');
  expect(conflictingParentLinks.row_observations[0].parent_ids.campaign_id).toBe(null);
  const mismatchedParents=await read(idColumnsHtml(),'/adsmanager/manage/ads',()=>{document.getElementById('id-headers').scrollLeft=60;});
  expect(mismatchedParents.column_alignment).toBe('mismatch');
  expect(mismatchedParents.row_observations.every(r=>r.parent_ids.campaign_id===null&&r.parent_ids.ad_set_id===null)).toBe(true);
  const semanticParents=await read(`<div role="grid"><div role="row" style="display:flex">${['Ad','Campaign ID','Ad set ID','Ad ID','Amount spent'].map(s=>`<div role="columnheader" style="width:160px">${s}</div>`).join('')}</div><div role="row" style="display:flex">${['Plain name','111','222','333','100'].map(s=>`<div role="gridcell" style="width:160px">${s}</div>`).join('')}</div></div>`,'/adsmanager/manage/ads');
  expect(semanticParents.row_observations[0].method).toBe('semantic');
  expect(semanticParents.row_observations[0].parent_ids).toEqual({campaign_id:'111',ad_set_id:'222'});
  const contradictoryOwnLinks=await read(idColumnsHtml('111',true).replace('selected_campaign_ids=888&selected_adset_ids=222&selected_ad_ids=333','selected_campaign_ids=111&selected_adset_ids=222&selected_ad_ids=777'),'/adsmanager/manage/ads');
  expect(contradictoryOwnLinks.row_observations[0].identity).toBe(null);
  const repeatedOwnId=await read(idColumnsHtml().replace('>334</div>','>333</div>'),'/adsmanager/manage/ads');
  expect(repeatedOwnId.row_observations.map(r=>r.identity)).toEqual([null,null]);
  // A physical metric-body scroll cannot bind its new values to frozen old
  // IDs/names merely because the new numbers fall into the old row bands.
  const unsynchronizedRows=await read(idColumnsHtml(),'/adsmanager/manage/ads',()=>{
    [...document.querySelector('#id-body>div').children].filter(el=>el.style.left==='740px').forEach(el=>el.remove());
    const pane=document.createElement('div');pane.id='independent-metrics';pane.style.cssText='position:absolute;left:730px;top:0;width:150px;height:200px;overflow-y:auto';
    pane.innerHTML='<div style="position:relative;height:700px">'+Array.from({length:8},(_,i)=>`<div style="position:absolute;left:10px;top:${20+i*60}px">${1000+i}</div>`).join('')+'</div>';
    document.getElementById('id-body').append(pane);pane.scrollTop=60;
  });
  expect(unsynchronizedRows.row_observations.map(r=>r.identity)).toEqual(['333','334']);
  expect(unsynchronizedRows.row_observations.every(r=>r.column_mapping==='unverified')).toBe(true);
  expect(unsynchronizedRows.row_alignment).toBe('mismatch');
  await page.evaluate(()=>{document.getElementById('independent-metrics').scrollTop=0;});
  const unknownPanePairing=await page.evaluate(()=>ReaderFixture.readVisibleTable());
  expect(unknownPanePairing.row_alignment).toBe('aligned');
  expect(unknownPanePairing.row_observations.every(r=>r.column_mapping==='verified_geometry')).toBe(true);
  const synchronizedRows=await read(idColumnsHtml(),'/adsmanager/manage/ads',()=>{
    document.querySelector('#id-body>div').style.height='500px';document.getElementById('id-body').scrollTop=20;
  });
  expect(synchronizedRows.row_alignment).toBe('aligned');
  expect(synchronizedRows.row_observations.every(r=>r.column_mapping==='verified_geometry')).toBe(true);
  const synchronizedSeparateRows=await read(idColumnsHtml(),'/adsmanager/manage/ads',()=>{
    [...document.querySelector('#id-body>div').children].filter(el=>el.style.left==='740px').forEach(el=>el.remove());
    document.querySelector('#id-body>div').style.height='500px';document.getElementById('id-body').scrollTop=20;
    const pane=document.createElement('div');pane.style.cssText='position:absolute;left:730px;top:40px;width:150px;height:200px;overflow-y:auto';
    pane.innerHTML='<div style="position:relative;height:700px">'+Array.from({length:8},(_,i)=>`<div style="position:absolute;left:10px;top:${20+i*60}px">${1000+i}</div>`).join('')+'</div>';
    document.getElementById('id-body').parentElement.append(pane);pane.scrollTop=20;
  });
  expect(synchronizedSeparateRows.row_alignment).toBe('aligned');
  expect(synchronizedSeparateRows.row_observations.every(r=>r.column_mapping==='verified_geometry')).toBe(true);
  const independentlyTransformedRows=await read(idColumnsHtml(),'/adsmanager/manage/ads',()=>{
    [...document.querySelector('#id-body>div').children].find(el=>el.textContent==='100').style.transform='translateY(3px)';
  });
  expect(independentlyTransformedRows.row_alignment).toBe('unverified');
  expect(independentlyTransformedRows.row_observations.every(r=>r.column_mapping==='unverified')).toBe(true);
  console.log("Reader 0.6.2 fixtures passed: detached summary row excluded, verified paging via ancestor and wheel, honest no-move result;");
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
