import { chromium } from "@playwright/test";

const token = process.env.API_TOKEN;
if (!token || token.length < 32)
  throw new Error("API_TOKEN must be configured with at least 32 characters");
const apiBase = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4318").replace(
  /\/$/,
  "",
);
const webBase = (process.env.SMOKE_WEB_URL ?? "http://127.0.0.1:9321").replace(
  /\/$/,
  "",
);

async function api(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error ?? `Backend returned ${response.status}`);
  return body;
}

const dashboard = await api("/dashboard");
const deviceAccounts = dashboard.devices
  .filter((device) => device.enabled === "true")
  .sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  )
  .map((device) => device.account_id);
const accountCandidates = [
  ...new Set(
    process.env.SMOKE_ACCOUNT
      ? [process.env.SMOKE_ACCOUNT]
      : deviceAccounts,
  ),
];
if (!accountCandidates.length)
  throw new Error("No enabled Extension device is registered");

let selected = null;
for (const candidate of accountCandidates) {
  try {
    const captures = await api(
      `/captures?account_id=${encodeURIComponent(candidate)}`,
    );
    const latestAds = captures.find((capture) => capture.level === "ads");
    const exported = await api(
      `/export?account_id=${encodeURIComponent(candidate)}&level=ad&limit=20`,
    );
    const storedContext = exported.records.find(
      (record) =>
        record.attribution &&
        !/^(unverified|unknown)$/i.test(record.attribution),
    );
    const attribution =
      process.env.SMOKE_ATTRIBUTION ??
      (latestAds?.reporting_context?.attribution &&
      !/^(unverified|unknown)$/i.test(latestAds.reporting_context.attribution)
        ? latestAds.reporting_context.attribution
        : (storedContext?.attribution ?? ""));
    if (!attribution) continue;
    selected = {
      account: candidate,
      attribution,
      timezone:
        process.env.SMOKE_TIMEZONE ??
        (latestAds?.reporting_context?.timezone &&
        !/^(unverified|unknown)$/i.test(
          latestAds.reporting_context.timezone,
        )
          ? latestAds.reporting_context.timezone
          : null) ??
        storedContext?.timezone ??
        "Asia/Bangkok",
    };
    break;
  } catch {
    // A newly connected account may not have exports or captures yet. Continue
    // with the next enabled device so one incomplete account does not hide a
    // verified account from the smoke test.
  }
}
if (!selected)
  throw new Error(
    "No enabled account has a verified reporting context; set SMOKE_ACCOUNT, SMOKE_ATTRIBUTION and SMOKE_TIMEZONE explicitly",
  );
const { account, attribution, timezone } = selected;
const params = new URLSearchParams({
  account_id: account,
  timezone,
  attribution,
  confirm_no_filters: "true",
  confirm_no_breakdown: "true",
});
const coldStarted = performance.now();
await api(`/captures/analysis?${params}`);
const coldMs = performance.now() - coldStarted;
const cachedStarted = performance.now();
const analysis = await api(`/captures/analysis?${params}`);
const cachedMs = performance.now() - cachedStarted;
const ads = analysis.levels
  .filter((level) => level.level === "ads")
  .sort(
    (left, right) => right.verified_unique_rows - left.verified_unique_rows,
  )[0];
if (!ads) throw new Error("No Ads analysis scope available");
const resultTypes = [
  ...new Set(ads.rows.map((row) => row.result_type).filter(Boolean)),
];

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32"
    ? {
        executablePath:
          process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ token, account, timezone, attribution, resultType }) => {
      sessionStorage.setItem("collectorToken", token);
      localStorage.setItem("collectorAccount", account);
      localStorage.setItem("analysisTimezone", timezone);
      localStorage.setItem("analysisUseTimezone", "true");
      localStorage.setItem("analysisAttribution", attribution);
      localStorage.setItem("analysisUseAttribution", "true");
      localStorage.setItem("analysisNoFilters", "true");
      localStorage.setItem("analysisNoBreakdown", "true");
      if (resultType) {
        localStorage.setItem("analysisResultType", resultType);
        localStorage.setItem("analysisUseResultType", "true");
      }
    },
    {
      token,
      account,
      timezone,
      attribution,
      resultType: resultTypes.length === 1 ? resultTypes[0] : "",
    },
  );
  await page.goto(`${webBase}/?account=${account}#reports`);
  await page.getByRole("heading", { name: "รายงานโฆษณาแบบมองเห็น" }).waitFor();
  await page
    .getByText(`${ads.verified_unique_rows} Ads ที่ยืนยัน ID`, {
      exact: true,
    })
    .waitFor();
  await page.getByRole("tab", { name: /ความสัมพันธ์/ }).click();
  await page.getByRole("img", { name: /กราฟจุดความสัมพันธ์/ }).waitFor();
  await page.getByRole("tab", { name: /การกระจาย/ }).click();
  await page.getByRole("img", { name: /ฮิสโตแกรมการกระจาย/ }).waitFor();
  await page.getByRole("tab", { name: /^องค์ประกอบ/ }).click();
  await page.getByRole("img", { name: /สัดส่วน Spend/ }).waitFor();
  await page.getByRole("tab", { name: /เส้นสะสม/ }).click();
  await page
    .getByRole("img", { name: /กราฟเส้นสะสม Spend และ Results/ })
    .waitFor();
  await page.getByRole("tab", { name: /แนวโน้ม/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  if (!noOverflow) throw new Error("Report Studio overflows mobile viewport");
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  const materialization = await api(
    `/captures/jobs/${analysis.job.id}/materialization?account_id=${account}`,
  );
  const reconciliation = await api(
    `/captures/jobs/${analysis.job.id}/reconciliation?${params.toString()}&scope_key=${encodeURIComponent(ads.scope_key)}`,
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        extension_version: analysis.job.extension_version,
        job_id: analysis.job.id,
        job_status: analysis.job.status,
        report_cached: analysis.report_cached === true,
        cold_analysis_ms: Math.round(coldMs),
        cached_analysis_ms: Math.round(cachedMs),
        coverage: ads.coverage,
        verified_ads: ads.verified_unique_rows,
        reported_ads: ads.reported_total_rows,
        unresolved_observations: ads.unresolved_observations,
        normalized_ads: materialization.normalized_ads,
        normalized_observations: materialization.normalized_observations,
        materialization_reasons: materialization.reasons,
        csv_reconciliation_files: reconciliation.reconciliation.length,
        chart_views_checked: 5,
        mobile_no_overflow: noOverflow,
        page_errors: errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
