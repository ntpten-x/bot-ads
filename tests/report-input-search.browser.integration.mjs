// Search phase of trusted report-input integration. Isolated because Meta-like
// delayed search UI legitimately consumes several timeout windows.
import { expect } from "@playwright/test";
import { withReportInputFixture } from "./helpers/report-input-fixture.mjs";

await withReportInputFixture(
  "search",
  async ({ meta, worker, binding, setLease, phase }) => {
    await setLease();
    await meta.evaluate(() => {
      window.available = window.available.filter(
        (field) => field.key !== "account_id",
      );
      window.hiddenKey = "ad_id";
      render();
      const search = document.querySelector("#search");
      search.setAttribute("aria-label", "search columns");
      document.querySelector("#title").textContent = "ปรับแต่งคอลัมน์";
      window.queries = [];
      const defaultRender = render;
      render = (query) =>
        defaultRender(
          window.available.find((field) => field.labels.includes(query))
            ?.labels[0] ?? query,
        );
      search.oninput = (event) => {
        if (!event.isTrusted) return;
        window.queries.push(event.target.value);
        const query = event.target.value;
        event.target.value = "";
        setTimeout(() => {
          search.value = query;
          render(query);
        }, 2600);
      };
    });
    const delayed = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    phase("delayed-search-finished");
    expect(delayed.ok, JSON.stringify(delayed)).toBe(true);
    expect(delayed.selected).toContain("ad_id");
    expect(delayed.missing).toContain("account_id");
    expect(delayed.missing_required).toEqual([]);
    expect(delayed.applied).toBe(true);
    expect(await meta.evaluate(() => window.queries)).toContain("ID โฆษณา");

    await meta.goto(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456789",
    );
    await meta.evaluate(() => {
      window.hiddenKey = "ad_id";
      render();
      document.querySelector("#search").oninput = (event) => {
        if (!event.isTrusted) return;
        const query = event.target.value;
        document.querySelector("#choices").replaceChildren();
        setTimeout(() => render(query), 2600);
      };
    });
    const debounced = await worker.evaluate(
      (current) =>
        TrustedReportFixture.prepareReportWithInput(current, "messages"),
      binding,
    );
    phase("debounced-search-finished");
    expect(debounced.ok, JSON.stringify(debounced)).toBe(true);
    expect(debounced.selected).toContain("ad_id");
    expect(debounced.applied).toBe(true);
    console.log(
      "Trusted report input search passed: delayed controlled input and debounced choice rendering",
    );
  },
);
