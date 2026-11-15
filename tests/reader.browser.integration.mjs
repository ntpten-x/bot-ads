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
async function read(html) {
  fixture = html;
  await page.goto(
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789",
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
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
  expect(geometry.reader_version).toBe("0.5.0");
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
  console.log(
    "Reader integration passed: structured grid, treegrid cells, gridless text fallback, viewport filtering, no invented rows, unknown attribution and empty-page rejection",
  );
} finally {
  await browser.close();
}
