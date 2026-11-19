const token = process.env.API_TOKEN;
if (!token || token.length < 32)
  throw new Error("API_TOKEN must be configured");
const apiBase = (process.env.LOAD_API_URL ?? "http://127.0.0.1:4318").replace(
  /\/$/,
  "",
);
const rounds = Math.max(1, Number(process.env.LOAD_ROUNDS ?? 5));
const limit = Math.max(1, Number(process.env.LOAD_EXPORT_LIMIT ?? 200));
const headers = { Authorization: `Bearer ${token}` };

async function get(path) {
  const started = performance.now();
  const response = await fetch(`${apiBase}${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  await response.arrayBuffer();
  return {
    ok: response.ok,
    status: response.status,
    ms: performance.now() - started,
  };
}

const dashboard = await get("/dashboard");
if (!dashboard.ok)
  throw new Error(`Dashboard failed with HTTP ${dashboard.status}`);
const dashboardResponse = await fetch(`${apiBase}/dashboard`, {
  headers,
  signal: AbortSignal.timeout(30_000),
});
const devices = (await dashboardResponse.json()).devices ?? [];
const accounts = [
  ...new Set(
    devices
      .filter((device) => device.enabled === "true")
      .map((device) => device.account_id)
      .filter(Boolean),
  ),
];
if (!accounts.length) throw new Error("No enabled accounts to test");

const samples = [];
const failures = [];
for (let round = 0; round < rounds; round++) {
  await Promise.all(
    accounts.flatMap((account) => [
      get(`/accounts/${account}/summary`).then((result) => {
        samples.push({ kind: "summary", account, ...result });
        if (!result.ok) failures.push({ kind: "summary", account, result });
      }),
      get(`/optimization/workspace?account_id=${account}`).then((result) => {
        samples.push({ kind: "optimization", account, ...result });
        if (!result.ok) failures.push({ kind: "optimization", account, result });
      }),
      get(`/export?account_id=${account}&limit=${limit}`).then((result) => {
        samples.push({ kind: "export", account, ...result });
        if (!result.ok) failures.push({ kind: "export", account, result });
      }),
    ]),
  );
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

const byKind = Object.fromEntries(
  ["summary", "optimization", "export"].map((kind) => {
    const values = samples
      .filter((sample) => sample.kind === kind)
      .map((sample) => sample.ms);
    return [
      kind,
      {
        requests: values.length,
        p50_ms: Math.round(percentile(values, 0.5) ?? 0),
        p95_ms: Math.round(percentile(values, 0.95) ?? 0),
      },
    ];
  }),
);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      enabled_accounts: accounts.length,
      rounds,
      requests: samples.length,
      failures: failures.length,
      latency: byKind,
      scope:
        "Read-only summary, optimization workspace and paginated export; no Meta access or mutations",
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
