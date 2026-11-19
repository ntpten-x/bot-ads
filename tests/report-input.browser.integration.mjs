// Columns phase of the trusted report-input integration. Kept below the
// process time budget by separating search, guard and paging phases.
import { expect } from "@playwright/test";
import { withReportInputFixture } from "./helpers/report-input-fixture.mjs";

await withReportInputFixture(
  "columns",
  async ({ meta, worker, binding, setLease, phase }) => {
    const disabled = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(disabled.ok).toBe(false);
    expect(disabled.error).toContain("เปิดโหมดเมาส์");
    await meta.evaluate(() => {
      const input = document.querySelector("#search");
      input.value = "test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(await meta.locator("#search").inputValue()).toBe("");
    await setLease();
    await meta.evaluate(() => {
      window.available = [
        ...window.available,
        { key: "purchases", labels: ["Purchases"], required: false },
        { key: "roas", labels: ["ROAS"], required: false },
      ];
      window.selected = new Set([
        "budget",
        "reach",
        "frequency",
        "purchases",
        "roas",
      ]);
      window.hiddenExtraKeys = new Set(["purchases"]);
      window.mutateReachContext = true;
      render();
      renderHeaders();
    });
    const result = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    phase("initial-prepare-finished");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.missing_required).toEqual([]);
    expect(result.selected).toContain("spend");
    expect(result.selected).toContain("ad_name");
    expect(result.selected).not.toContain("link_clicks");
    expect(result.missing_goal_metrics).toContain("link_clicks");
    expect(result.pruned).toEqual(
      expect.arrayContaining([
        "Budget",
        "Reach",
        "Frequency",
        "Purchases",
        "ROAS",
      ]),
    );
    for (const key of ["budget", "reach", "frequency", "purchases", "roas"])
      expect(
        await meta.evaluate(
          (candidate) => [...window.selected].includes(candidate),
          key,
        ),
      ).toBe(false);
    expect(
      await meta.evaluate(() =>
        [...document.querySelectorAll("#headers [role=columnheader]")].map(
          (header) => header.textContent,
        ),
      ),
    ).not.toContain("Purchases");
    expect(result.rendered_headers).toContain("Amount spent ↓");

    const trustedBeforeReuse = await meta.evaluate(
      () => window.trustedEvents,
    );
    const reused = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages", {
          reuseIfReady: true,
        }),
      binding,
    );
    phase("reuse-check-finished");
    expect(reused.ok, JSON.stringify(reused)).toBe(true);
    expect(reused.reused).toBe(true);
    expect(reused.applied).toBe(true);
    expect(await meta.evaluate(() => window.trustedEvents)).toBe(
      trustedBeforeReuse,
    );
    expect(
      await meta.evaluate(() => window.selected.has("reach_variant")),
    ).toBe(false);

    await meta.evaluate(() => {
      document.querySelector("#dialog").hidden = false;
    });
    const recoveredOpenDialog = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages", {
          reuseIfReady: true,
        }),
      binding,
    );
    phase("open-dialog-reuse-check-finished");
    expect(recoveredOpenDialog.ok, JSON.stringify(recoveredOpenDialog)).toBe(
      true,
    );
    expect(recoveredOpenDialog.reused).not.toBe(true);
    expect(await meta.locator("#dialog").isHidden()).toBe(true);

    expect(
      await meta.evaluate(
        () => window.available.find((field) => field.key === "reach").helper,
      ),
    ).toContain("Context changed");
    expect(await meta.evaluate(() => !!window.applied)).toBe(true);
    expect(await meta.evaluate(() => !!window.published)).toBe(false);
    expect(await meta.locator("#adBudget").inputValue()).toBe("500");
    const stillAttached = await worker.evaluate(
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
    );
    expect(stillAttached).toBe(false);

    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    await meta.evaluate(() => {
      window.freezeHeaders = true;
    });
    const unverified = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    phase("stale-header-check-finished");
    expect(unverified.ok).toBe(false);
    expect(unverified.applied).toBe(false);
    expect(unverified.missing_rendered_fields.length).toBeGreaterThan(0);
    expect(unverified.error).toContain("ยืนยันคอลัมน์บนตารางไม่ได้");
    console.log(
      "Trusted report input columns passed: lease gate, trusted events, column pruning, reuse and stale-header rejection",
    );
  },
);
