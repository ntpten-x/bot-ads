// Required-column and account guards for trusted report input.
import { expect } from "@playwright/test";
import { withReportInputFixture } from "./helpers/report-input-fixture.mjs";

await withReportInputFixture(
  "guards",
  async ({ meta, worker, binding, setLease, phase }) => {
    await setLease();
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=999",
    );
    const wrongAccount = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(wrongAccount.ok).toBe(false);
    expect(wrongAccount.error).toContain("Bound reporting tab");
    expect(await meta.evaluate(() => !!window.applied)).toBe(false);

    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    await meta.evaluate(() => {
      window.available = window.available.filter(
        (field) => field.key !== "ad_id",
      );
      render();
    });
    const partial = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(partial.ok).toBe(false);
    expect(partial.applied).toBe(false);
    expect(partial.missing_required).toContain("ad_id");
    expect(await meta.evaluate(() => !!window.applied)).toBe(false);
    phase("required-column-guards-finished");

    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    await meta.evaluate(() => {
      window.revokeOnChange = true;
    });
    const reverted = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(reverted.ok).toBe(false);
    expect(reverted.applied).toBe(false);
    expect(reverted.missing_required).toContain("ad_id");
    expect(await meta.evaluate(() => !!window.applied)).toBe(false);
    phase("reverted-selection-guard-finished");
    console.log(
      "Trusted report input guards passed: account mismatch, missing stable ID and reverted selection",
    );
  },
);
