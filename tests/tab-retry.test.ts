import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientTabEditError,
  retryTabEdit,
} from "../apps/extension/src/tab-retry.js";

test("tab edits retry only the bounded Chrome drag transient", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryTabEdit(
    async () => {
      calls++;
      if (calls < 3)
        throw new Error(
          "Tabs cannot be edited right now (user may be dragging a tab).",
        );
      return "activated";
    },
    {
      attempts: 4,
      baseDelayMs: 10,
      sleep: async (ms) => {
        delays.push(ms);
      },
    },
  );
  assert.equal(result, "activated");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(isTransientTabEditError(new Error("Tab was closed")), false);
  await assert.rejects(
    retryTabEdit(
      async () => {
        throw new Error("Tab was closed");
      },
      { attempts: 4, sleep: async () => {} },
    ),
    /Tab was closed/,
  );
});
