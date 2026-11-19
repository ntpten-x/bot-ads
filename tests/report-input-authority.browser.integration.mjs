// Authority must be re-read after debugger attach; pause/rebind must stop input.
import { expect } from "@playwright/test";
import {
  pagingFixture,
  withReportInputFixture,
} from "./helpers/report-input-fixture.mjs";

await withReportInputFixture(
  "authority",
  async ({ meta, worker, binding, setFixture, setLease }) => {
    setFixture(pagingFixture());
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    const pagingBinding = { ...binding, jobId: "report-authority-fixture" };
    await worker.evaluate(
      async (current) =>
        chrome.storage.local.set({
          bridge: {
            tabId: current.tabId,
            account: current.account,
            enabled: true,
          },
          job: {
            id: current.jobId,
            tabId: current.tabId,
            account: current.account,
            status: "running",
          },
        }),
      pagingBinding,
    );
    await setLease();
    const wheelsBefore = await meta.evaluate(() => window.trustedWheels);
    for (const race of ["pause", "rebind"]) {
      const result = await worker.evaluate(
        async ({ current, race }) => {
          const original = chrome.debugger.attach.bind(chrome.debugger);
          chrome.debugger.attach = async (...args) => {
            await original(...args);
            if (race === "pause") {
              const { job } = await chrome.storage.local.get("job");
              await chrome.storage.local.set({
                job: { ...job, status: "paused" },
              });
            } else {
              await chrome.storage.local.set({
                bridge: {
                  tabId: current.tabId,
                  account: "999",
                  enabled: true,
                },
              });
            }
          };
          try {
            return await TrustedReportFixture.scrollReportWithInput(current);
          } finally {
            chrome.debugger.attach = original;
          }
        },
        { current: pagingBinding, race },
      );
      expect(result.moved).toBe(false);
      expect(result.reason).toBe("collection_context_changed");
      expect(await meta.evaluate(() => window.trustedWheels)).toBe(
        wheelsBefore,
      );
      await worker.evaluate(
        async (current) =>
          chrome.storage.local.set({
            bridge: {
              tabId: current.tabId,
              account: current.account,
              enabled: true,
            },
            job: {
              id: current.jobId,
              tabId: current.tabId,
              account: current.account,
              status: "running",
            },
          }),
        pagingBinding,
      );
    }
    console.log(
      "Trusted report input authority passed: pause and rebind after debugger attach blocked every wheel",
    );
  },
);
