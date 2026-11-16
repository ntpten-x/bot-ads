import { test } from "node:test";
import assert from "node:assert/strict";
import {
  botCommandSchema,
  reportingUrl,
  suiteUrl,
} from "../packages/core/src/control.js";
test("accept typed UI commands and refuse JS, selectors and remote approvals", () => {
  assert.equal(
    botCommandSchema.safeParse({
      command: "ui.action",
      action: { type: "inspect" },
    }).success,
    true,
  );
  assert.equal(
    botCommandSchema.safeParse({
      command: "breakdown.prepare",
      dimensions: ["age", "platform"],
    }).success,
    true,
  );
  for (const command of [
    { command: "eval", code: "alert(1)" },
    { command: "reportInputSession", action: "enable" },
    { command: "report.prepare", goal: "messages", method: "Runtime.evaluate" },
    { command: "uiSession", action: "approve" },
    { command: "ui.action", action: { type: "click", selector: "button" } },
    { command: "ui.action", action: { type: "inspect" }, tabId: 999 },
    {
      command: "breakdown.prepare",
      dimensions: ["age", "age"],
    },
    {
      command: "breakdown.prepare",
      dimensions: ["age", "selector"],
    },
    {
      command: "breakdown.prepare",
      dimensions: ["age", "gender"],
    },
  ])
    assert.equal(botCommandSchema.safeParse(command).success, false);
});
test("restrict web navigation to the bound account on UI hosts and routes", () => {
  assert.equal(
    suiteUrl("https://business.facebook.com/latest/home?business_id=42", "123")
      .hostname,
    "business.facebook.com",
  );
  assert.equal(
    suiteUrl(
      "https://adsmanager.facebook.com/adsmanager/creation?act=123",
      "123",
      true,
    ).searchParams.get("act"),
    "123",
  );
  for (const url of [
    "https://graph.facebook.com/v27.0/123",
    "https://adsmanager.facebook.com/api/graphql",
    "https://adsmanager.facebook.com/adsmanager/manage/ads?act=999",
    "https://business.facebook.com.evil.example/latest/home",
    "http://business.facebook.com/latest/home",
    "https://business.facebook.com:8443/latest/home",
  ])
    assert.throws(() => suiteUrl(url, "123"));
  assert.throws(() =>
    suiteUrl(
      "https://business.facebook.com/latest/home?business_id=42",
      "123",
      true,
    ),
  );
});

test("reporting URLs preserve only validated breakdown parameters", () => {
  const url = reportingUrl("123", "ads", [
    ["demographics_breakdown", "age"],
    ["publisher_platform_breakdown", "platform"],
  ]);
  assert.equal(url.searchParams.get("act"), "123");
  assert.equal(url.searchParams.get("demographics_breakdown"), "age");
  assert.equal(
    url.searchParams.get("publisher_platform_breakdown"),
    "platform",
  );
  assert.throws(() =>
    reportingUrl("123", "ads", [["redirect", "https://example.com"]]),
  );
  assert.throws(() =>
    reportingUrl("123", "ads", [["demographics_breakdown", "age&evil=1"]]),
  );
});
