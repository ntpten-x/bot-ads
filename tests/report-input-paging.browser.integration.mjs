// Native paging transport and readback safety.
import { expect } from "@playwright/test";
import {
  pagingFixture,
  withReportInputFixture,
} from "./helpers/report-input-fixture.mjs";

await withReportInputFixture(
  "paging",
  async ({
    meta,
    worker,
    binding,
    setFixture,
    setLease,
    removeLease,
    phase,
  }) => {
    setFixture(pagingFixture());
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    const pagingBinding = { ...binding, jobId: "report-paging-fixture" };
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
    await removeLease();
    const noLease = await worker.evaluate(
      (current) => TrustedReportFixture.scrollReportWithInput(current),
      pagingBinding,
    );
    expect(noLease.moved).toBe(false);
    expect(noLease.reason).toBe("report_input_lease_required");
    expect(await meta.evaluate(() => window.trustedWheels)).toBe(0);

    await setLease();
    const native = await worker.evaluate(
      (current) => TrustedReportFixture.scrollReportWithInput(current),
      pagingBinding,
    );
    phase("native-paging-finished");
    expect(native.moved, JSON.stringify(native)).toBe(true);
    expect(native.method).toBe("native_wheel");
    expect(await meta.evaluate(() => window.trustedWheels)).toBe(1);
    expect(
      await worker.evaluate(
        async (tabId) =>
          chrome.debugger
            .sendCommand({ tabId }, "Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: 1,
              y: 1,
            })
            .then(
              () => true,
              () => false,
            ),
        binding.tabId,
      ),
    ).toBe(false);
    const noChange = await worker.evaluate(
      (current) => TrustedReportFixture.scrollReportWithInput(current),
      pagingBinding,
    );
    expect(noChange.moved).toBe(false);
    expect(noChange.reason).toBe("visible_rows_unchanged");

    const stuckStart = Date.now();
    const debuggerStuck = await worker.evaluate(async (current) => {
      const original = chrome.debugger.sendCommand.bind(chrome.debugger);
      chrome.debugger.sendCommand = () => new Promise(() => {});
      try {
        return await TrustedReportFixture.scrollReportWithInput(current);
      } finally {
        chrome.debugger.sendCommand = original;
      }
    }, pagingBinding);
    expect(debuggerStuck.moved).toBe(false);
    expect(debuggerStuck.reason).toBe("debugger_command_timeout");
    expect(Date.now() - stuckStart).toBeLessThan(20_000);
    phase("debugger-timeout-finished");

    await meta.evaluate(() => {
      window.metricOnly = true;
    });
    const metricRefresh = await worker.evaluate(
      (current) => TrustedReportFixture.scrollReportWithInput(current),
      pagingBinding,
    );
    expect(metricRefresh.moved).toBe(false);
    expect(metricRefresh.reason).toBe("visible_rows_unchanged");
    await meta.evaluate(() => {
      window.metricOnly = false;
      window.idsOnly = true;
      document
        .querySelectorAll(".name")
        .forEach((node) => (node.textContent = "Same name"));
    });
    const sameNamesNewIds = await worker.evaluate(
      (current) => TrustedReportFixture.scrollReportWithInput(current),
      pagingBinding,
    );
    expect(sameNamesNewIds.moved).toBe(true);

    setFixture(`<div id="page-status">1–200 จาก 400</div>
      <div style="position:relative;width:900px;height:260px">
        <div role="columnheader" style="position:absolute;left:0;top:0;width:400px;height:36px">Ad</div>
        <div role="columnheader" style="position:absolute;left:500px;top:0;width:200px;height:36px">Ad ID</div>
        <div role="switch" style="position:absolute;left:10px;top:60px;width:36px;height:24px"></div>
        <div id="page-rows" style="position:absolute;left:50px;top:60px;width:400px"><a href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=111">Page 1</a></div>
        <div id="page-id" style="position:absolute;left:500px;top:60px;width:200px">111</div>
      </div>
      <div role="button" aria-label="ถัดไป" style="position:fixed;right:20px;top:20px;width:80px;height:36px">ถัดไป</div>
      <script>
        window.trustedWheels=0;
        document.querySelector('[role="button"]').onclick=e=>{
          if(!e.isTrusted)return;
          window.pageClicks=(window.pageClicks??0)+1;
          document.querySelector('#page-status').textContent='201–400 จาก 400';
          document.querySelector('#page-rows').innerHTML='<a href="/adsmanager/manage/ads?act=123456789&selected_ad_ids=222">Page 2</a>';
          document.querySelector('#page-id').textContent='222';
        };
        window.pageClicks=0;
      </script>`);
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    await meta.bringToFront();
    const pageAdvance = await worker.evaluate(
      (current) => TrustedReportFixture.advanceReportPageWithInput(current),
      { ...pagingBinding, jobId: "report-paging-fixture" },
    );
    expect(pageAdvance.paged, JSON.stringify(pageAdvance)).toBe(true);
    expect(pageAdvance.method).toBe("native_click");
    expect(pageAdvance.page.from).toBe(201);
    expect(await meta.evaluate(() => window.pageClicks)).toBe(1);

    setFixture(`<div id="dom-page-status">1–100 จาก 200</div>
      <div role="button" aria-label="ถัดไป" style="position:fixed;right:20px;top:20px;width:80px;height:36px">ถัดไป</div>
      <script>
        document.querySelector('[role="button"]').onclick=()=>{
          document.querySelector('#dom-page-status').textContent='101–200 จาก 200';
        };
      </script>`);
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    const domClick = await worker.evaluate(
      async (current) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: current.tabId },
          func: TrustedReportFixture.clickNextReportPage,
          args: [current.account],
        });
        return result.result;
      },
      { tabId: binding.tabId, account: binding.account },
    );
    expect(domClick.paged, JSON.stringify(domClick)).toBe(true);
    expect(domClick.method).toBe("dom_click");

    const wheelsBeforeModal = await meta.evaluate(
      () => window.trustedWheels,
    );
    await meta.evaluate(() => {
      const modal = document.createElement("div");
      modal.setAttribute("role", "dialog");
      modal.style.cssText =
        "position:fixed;inset:0;background:white";
      modal.textContent = "Edit ad";
      document.body.append(modal);
    });
    const blocked = await worker.evaluate(
      (current) => TrustedReportFixture.scrollReportWithInput(current),
      pagingBinding,
    );
    expect(blocked.moved).toBe(false);
    expect(blocked.reason).toBe("reporting_view_blocked");
    expect(await meta.evaluate(() => window.trustedWheels)).toBe(
      wheelsBeforeModal,
    );
    phase("modal-guard-finished");
    console.log(
      "Trusted report input paging passed: lease, native wheel, visible-row evidence, debugger timeout and modal guard",
    );
  },
);
