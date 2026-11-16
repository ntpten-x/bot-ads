import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentOptions } from "../scripts/ads-agent.js";

const device = "11111111-1111-4111-8111-111111111111";

test("ads agent parses bounded goal and collection options", () => {
  assert.deepEqual(parseAgentOptions([device]), {
    device,
    goal: "messages",
    maxSteps: 12,
    skipPrepare: false,
    skipNavigate: false,
    collectionTimeoutMs: 300_000,
    breakdown: [],
    operator: {},
  });
  const parsed = parseAgentOptions([
    device,
    "sales",
    "--max-steps=20",
    "--timeout-seconds=45",
    "--skip-prepare",
    "--skip-navigate",
    "--timezone=Asia/Bangkok",
    "--no-breakdown",
    "--no-filters",
    "--breakdown=age,platform",
  ]);
  assert.equal(parsed.goal, "sales");
  assert.equal(parsed.maxSteps, 20);
  assert.equal(parsed.collectionTimeoutMs, 45_000);
  assert.equal(parsed.skipPrepare, true);
  assert.equal(parsed.skipNavigate, true);
  assert.equal(parsed.operator.timezone, "Asia/Bangkok");
  assert.equal(parsed.operator.confirm_no_breakdown, true);
  assert.equal(parsed.operator.confirm_no_filters, true);
  assert.deepEqual(parsed.breakdown, ["age", "platform"]);
});

test("ads agent rejects unknown goals and unbounded values", () => {
  assert.throws(() =>
    parseAgentOptions([device, "engagement"]),
  );
  assert.throws(() =>
    parseAgentOptions([device, "messages", "--max-steps=0"]),
  );
  assert.throws(() =>
    parseAgentOptions([device, "messages", "--timeout-seconds=-1"]),
  );
  assert.throws(() =>
    parseAgentOptions([device, "messages", "--breakdown=age,age"]),
  );
  assert.throws(() =>
    parseAgentOptions([device, "messages", "--breakdown=age,gender"]),
  );
});
