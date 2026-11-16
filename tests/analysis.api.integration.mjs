import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cleanupWebFixture } from "./helpers/web-fixture.mjs";
const base = process.env.ANALYSIS_TEST_API ?? "http://127.0.0.1:4318";
const account = "991" + Date.now(),
  device = randomUUID();
const headers = {
  Authorization: "Bearer " + process.env.API_TOKEN,
  "Content-Type": "application/json",
};
async function api(path, body, status = 200) {
  const r = await fetch(base + path, {
    headers,
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(r.status, status, await r.clone().text());
  return r.json();
}
const input = {
  filename: "analysis-integration.csv",
  csv: (await readFile("samples/analysis-template.csv", "utf8")).replaceAll(
    "123456789",
    account,
  ),
  expected_account_id: account,
  context: {
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "messaging_conversations",
  },
  expected: { rows: 1, spend: 200 },
};
try {
  assert.equal(
    (
      await fetch(base + "/analysis/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      })
    ).status,
    401,
  );
  await api(`/devices/${device}/state`, {
    bound_account: account,
    enabled: true,
    ui: { snapshot: { title: "Campaign editor (test fixture)" } },
  });
  const p = await api("/analysis/preview", { input, goal: "sales" });
  assert.equal(p.analysis.rows[0].derived.purchase_roas, 3);
  assert.equal(p.analysis.rows[0].derived.cost_per_conversion, 100);
  assert.equal(p.analysis.rows[0].evaluation.status, "insufficient_sample");
  assert.equal(p.analysis.rows[0].evaluation.comparison, null);
  assert.equal(p.analysis.evaluation_policy.min_conversions, 5);
  assert.ok(p.analysis.rows[0].evaluation.next_steps.length > 0);
  const bad = await api(
    "/analysis/preview",
    { input: { ...input, expected: { spend: 201 } }, goal: "sales" },
    422,
  );
  assert.equal(bad.validation.valid, false);
  assert.equal(bad.analysis, undefined);
  const saved = await api("/imports", input, 201);
  assert.ok(saved.job_id);
  const again = await api("/imports", input);
  assert.equal(again.duplicate, true);
  const data = await api("/export?account_id=" + account);
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].metrics.landing_page_views, 80);
  assert.equal(data.records[0].metrics.link_ctr, 1);
  assert.equal(data.records[0].metrics.messaging_conversations, 20);
  assert.equal(data.records[0].metrics.purchases, 2);
  assert.equal(data.records[0].purchase_value, 600);
  console.log(
    "Analysis API integration passed: auth, validated preview, rejected reconciliation, persistent metrics, exact IDs and idempotent import",
  );
} finally {
  await cleanupWebFixture(account, device);
}
