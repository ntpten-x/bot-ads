import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseReport,
  recordKey,
  csvSafe,
  type ImportInput,
} from "../packages/core/src/index.js";
const sample = readFileSync("samples/meta-report.csv", "utf8");
const input = (csv = sample): ImportInput => ({
  filename: "report.csv",
  csv,
  expected_account_id: "123456789",
  context: {
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "leads",
  },
  expected: { rows: 2, spend: 200 },
});
test("valid report preserves string IDs, provenance, creatives and totals", () => {
  const r = parseReport(input());
  assert.equal(r.valid, true);
  assert.equal(r.summary.spend, 200);
  assert.equal(r.records[0].ad_id, "333");
  assert.equal(r.records[0].creative?.headline, "Sample headline");
  assert.equal(r.coverage, "unverified");
});
test("reject different account and reconciliation mismatch", () => {
  assert.equal(
    parseReport({ ...input(), expected_account_id: "999" }).valid,
    false,
  );
  assert.equal(
    parseReport({ ...input(), expected: { spend: 201 } }).valid,
    false,
  );
});
test("reject malformed date and negative or ambiguous numeric fields", () => {
  for (const replacement of ["-1", "1,000", "not a number"])
    assert.equal(
      parseReport(input(sample.replace("150.50", replacement))).valid,
      false,
    );
  assert.equal(
    parseReport(input(sample.replaceAll("2026-11-01", "2026-02-30"))).valid,
    false,
  );
});
test("reject duplicate grains and inconsistent parents", () => {
  const lines = sample.trim().split("\n");
  assert.equal(
    parseReport(input([...lines, lines[1]].join("\n"))).valid,
    false,
  );
  assert.equal(
    parseReport(
      input(
        sample.replace(
          "123456789,111,Sample campaign,222,Sample ad set,334",
          "123456789,999,Sample campaign,222,Sample ad set,334",
        ),
      ),
    ).valid,
    false,
  );
});
test("missing results remain missing and period aggregates remain aggregates", () => {
  const csv =
    "account_id,campaign_id,campaign_name,date_start,date_end,currency,spend,impressions\n123456789,111,C,2026-11-01,2026-11-30,THB,0,0";
  const r = parseReport({ ...input(csv), expected: {} });
  assert.equal(r.valid, true);
  assert.equal(r.records[0].results, undefined);
  assert.ok(r.warnings.some((w) => w.includes("not daily")));
});
test("grain separates attribution and currency; CSV formula injection escaped", () => {
  const r = parseReport(input()).records[0];
  assert.notEqual(recordKey(r), recordKey({ ...r, attribution: "1-day view" }));
  assert.notEqual(recordKey(r), recordKey({ ...r, currency: "USD" }));
  assert.equal(csvSafe("=1+1"), "'=1+1");
});
test("reject mixed levels and duplicate header names", () => {
  const csv =
    sample + "123456789,111,C,,,,,2026-11-01,2026-11-01,THB,1,2,,,,,,,";
  assert.equal(parseReport(input(csv)).valid, false);
  assert.equal(
    parseReport(input(sample.replace("creative_headline", "creative_body")))
      .valid,
    false,
  );
});
test("breakdown dimensions distinguish grains; mixed totals are rejected", () => {
  const csv =
    "account_id,campaign_id,campaign_name,date_start,date_end,currency,spend,impressions,age\n123456789,111,C,2026-11-01,2026-11-01,THB,100,500,18-24\n123456789,111,C,2026-11-01,2026-11-01,THB,100,500,25-34";
  const r = parseReport(input(csv));
  assert.equal(r.valid, true);
  assert.notEqual(recordKey(r.records[0]), recordKey(r.records[1]));
  assert.equal(r.records[0].breakdown?.age, "18-24");
  assert.equal(parseReport(input(csv.replace(",25-34", ","))).valid, false);
});
test("reject incomparable reporting conditions and overlapping intervals", () => {
  assert.equal(
    parseReport(input(sample.replace("THB,49.50", "USD,49.50"))).valid,
    false,
  );
  const csv =
    "account_id,campaign_id,campaign_name,date_start,date_end,currency,spend,impressions\n123456789,111,C,2026-11-01,2026-11-30,THB,100,500\n123456789,111,C,2026-11-01,2026-11-01,THB,100,500";
  assert.equal(parseReport(input(csv)).valid, false);
});
test("partial extra metrics are accepted without inventing other metrics", () => {
  const csv =
    "account_id,campaign_id,campaign_name,date_start,date_end,currency,spend,impressions,ctr\n123456789,111,C,2026-11-01,2026-11-01,THB,200,1000,1.5";
  const r = parseReport({ ...input(csv), expected: { spend: 200, rows: 1 } });
  assert.equal(r.valid, true);
  assert.deepEqual(r.records[0].metrics, { ctr: 1.5 });
});
