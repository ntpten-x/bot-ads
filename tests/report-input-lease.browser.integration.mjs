// Lease and reporting-context guards for trusted report input.
import { expect } from "@playwright/test";
import { withReportInputFixture } from "./helpers/report-input-fixture.mjs";

await withReportInputFixture(
  "lease",
  async ({ meta, worker, binding, setLease }) => {
    await setLease({ account: "999" });
    const mismatch = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toContain("เปิดโหมดเมาส์");

    await setLease({ expires_at: Date.now() - 1 });
    const expired = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(expired.ok).toBe(false);
    expect(expired.error).toContain("เปิดโหมดเมาส์");

    await setLease();
    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/creation?act=123456789",
    );
    const editor = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    expect(editor.ok).toBe(false);
    expect(editor.error).toContain("Bound reporting tab");
    console.log(
      "Trusted report input lease passed: account mismatch, expiry and editor-route guards",
    );
  },
);
