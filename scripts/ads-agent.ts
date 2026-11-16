import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";

type Goal = "messages" | "sales" | "leads";
type TerminalJobStatus = "needs_review" | "error";
type BreakdownDimension = "age" | "gender" | "platform" | "placement";

type AgentOptions = {
  device: string;
  goal: Goal;
  maxSteps: number;
  skipPrepare: boolean;
  skipNavigate: boolean;
  collectionTimeoutMs: number;
  breakdown: BreakdownDimension[];
  operator: {
    timezone?: string;
    attribution?: string;
    result_type?: string;
    confirm_no_breakdown?: true;
    confirm_no_filters?: true;
  };
};

type DeviceState = {
  updated_at: string;
  state?: {
    enabled?: boolean;
    extension_version?: string;
    bound_account?: string;
    report_input?: boolean;
    job?: {
      id: string;
      status: "running" | "paused" | TerminalJobStatus;
      snapshots?: unknown[];
      error?: string;
    };
    ui?: { snapshot?: { url?: string } };
  };
};

type CommandReceipt = {
  id: string;
  status: "pending" | "done" | "error";
  completed_at: string | null;
  result?: {
    ok?: boolean;
    error?: string;
    job?: { id: string; status: string };
    ui?: {
      outcome?: string;
      snapshot?: { url?: string; account_verified?: boolean };
      report?: {
        ok?: boolean;
        applied?: boolean;
        selected?: string[];
        missing_required?: string[];
        missing_goal_metrics?: string[];
        error?: string;
      };
    };
  };
};

const apiBase = (
  process.env.AGENT_API_URL ?? "http://127.0.0.1:4318"
).replace(/\/$/, "");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function apiToken() {
  const token = process.env.API_TOKEN;
  if (!token || token.length < 32)
    throw new Error("API_TOKEN must be configured with at least 32 characters");
  return token;
}

function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `Backend returned HTTP ${response.status}`);
  return body;
}

function log(message: string, details?: Record<string, unknown>) {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[ads-agent] ${message}${suffix}`);
}

async function getState(device: string) {
  return api<DeviceState>(`/devices/${device}/state`);
}

async function sendCommand(device: string, command: Record<string, unknown>) {
  return api<{ id: string }>(`/devices/${device}/commands`, {
    method: "POST",
    body: JSON.stringify(command),
  });
}

async function waitForCommand(
  device: string,
  id: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await api<CommandReceipt>(
      `/devices/${device}/commands/${id}`,
    );
    if (receipt.status !== "pending") return receipt;
    await sleep(2_000);
  }
  throw new Error(`Command ${id} did not finish within ${timeoutMs} ms`);
}

async function verifyDevice(device: string, minimumVersion: string) {
  const snapshot = await getState(device);
  const state = snapshot.state;
  if (!state?.enabled) throw new Error("Extension bridge is not enabled");
  if (!state.bound_account)
    throw new Error("Extension has no verified bound account");
  const version = state.extension_version ?? "0.0.0";
  if (compareVersions(version, minimumVersion) < 0)
    throw new Error(
      `Extension ${version} is older than required ${minimumVersion}; reload dist/extension`,
    );
  const ageMs = Date.now() - new Date(snapshot.updated_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 90_000)
    throw new Error(
      `Extension heartbeat is stale (${Math.round(ageMs / 1000)}s); reconnect it`,
    );
  if (state.job?.status === "running")
    throw new Error(
      "A collection job is already running; pause it before starting ads automation",
    );
  return { account: state.bound_account, version, state };
}

async function inspect(device: string) {
  const queued = await sendCommand(device, {
    command: "ui.action",
    action: { type: "inspect", max_controls: 300 },
  });
  return waitForCommand(device, queued.id, 60_000);
}

function adsRoute(url: string | undefined, account: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ["adsmanager.facebook.com", "business.facebook.com"].includes(
        parsed.hostname,
      ) &&
      parsed.pathname.replace(/\/$/, "") === "/adsmanager/manage/ads" &&
      parsed.searchParams.get("act") === account
    );
  } catch {
    return false;
  }
}

async function ensureAdsRoute(device: string, account: string) {
  const current = await inspect(device);
  const currentUrl = current.result?.ui?.snapshot?.url;
  if (adsRoute(currentUrl, account)) return currentUrl!;

  const navigate = await sendCommand(device, {
    command: "ui.navigate",
    url: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${account}`,
  });
  const navigated = await waitForCommand(device, navigate.id, 60_000);
  if (navigated.status !== "done" || navigated.result?.ok === false)
    throw new Error(navigated.result?.error ?? "Navigation failed");

  const deadline = Date.now() + 60_000;
  let lastError = "page did not reach Ads Manager";
  while (Date.now() < deadline) {
    await sleep(2_000);
    try {
      const observed = await inspect(device);
      const url = observed.result?.ui?.snapshot?.url;
      if (observed.status === "done" && adsRoute(url, account)) return url!;
      lastError = observed.result?.error ?? lastError;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Ads page was not ready: ${lastError}`);
}

async function prepareReport(
  device: string,
  goal: Goal,
  state: DeviceState["state"],
) {
  if (!state?.report_input)
    throw new Error(
      "Open the 15-minute report input/popup lease before automatic column setup",
    );
  const queued = await sendCommand(device, {
    command: "report.prepare",
    goal,
  });
  const receipt = await waitForCommand(device, queued.id, 150_000);
  const report = receipt.result?.ui?.report;
  if (
    receipt.status !== "done" ||
    receipt.result?.ok === false ||
    report?.ok === false ||
    report?.applied === false
  )
    throw new Error(
      report?.error ??
        receipt.result?.error ??
        "Report column setup did not apply",
    );
  return {
    applied: report?.applied === true,
    selected: report?.selected ?? [],
    missing_required: report?.missing_required ?? [],
    missing_goal_metrics: report?.missing_goal_metrics ?? [],
  };
}

async function prepareBreakdown(
  device: string,
  dimensions: BreakdownDimension[],
) {
  const queued = await sendCommand(device, {
    command: "breakdown.prepare",
    dimensions,
  });
  const receipt = await waitForCommand(device, queued.id, 60_000);
  const breakdown = (
    receipt.result?.ui as
      | {
          breakdown?: {
            ok?: boolean;
            selected?: string[];
            cleared?: string[];
            missing?: string[];
            error?: string;
            breakdown_params_after?: [string, string][] | null;
          };
        }
      | undefined
  )?.breakdown;
  if (
    receipt.status !== "done" ||
    receipt.result?.ok === false ||
    breakdown?.ok === false
  )
    throw new Error(
      breakdown?.error ??
        receipt.result?.error ??
        "Breakdown setup did not apply",
    );
  return breakdown;
}

async function waitForJob(
  device: string,
  jobId: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const snapshot = await getState(device);
    const job = snapshot.state?.job;
    if (job?.id === jobId) {
      const line = `${job.status}:${job.snapshots?.length ?? 0}`;
      if (line !== last) {
        log("collection", {
          status: job.status,
          snapshots: job.snapshots?.length ?? 0,
        });
        last = line;
      }
      if (job.status === "needs_review" || job.status === "error") return job;
    }
    await sleep(3_000);
  }
  throw new Error(`Collection ${jobId} did not finish within ${timeoutMs} ms`);
}

async function collect(
  device: string,
  account: string,
  maxSteps: number,
  timeoutMs: number,
) {
  const queued = await sendCommand(device, {
    command: "start",
    levels: ["ads"],
    maxSteps,
    scan_columns: true,
  });
  const receipt = await waitForCommand(device, queued.id, 30_000);
  const jobId = receipt.result?.job?.id;
  if (receipt.status !== "done" || !jobId)
    throw new Error(receipt.result?.error ?? "Collection did not start");
  log("collection_started", { job_id: jobId, account });
  return waitForJob(device, jobId, timeoutMs);
}

async function waitForCaptures(
  account: string,
  jobId: string,
  expected: number,
) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const captures = await api<
      { id: string; job_id: string; level: string }[]
    >(`/captures?account_id=${encodeURIComponent(account)}`);
    const matching = captures.filter((capture) => capture.job_id === jobId);
    if (matching.length >= Math.max(1, expected)) return matching;
    await sleep(3_000);
  }
  return (
    await api<{ id: string; job_id: string; level: string }[]>(
      `/captures?account_id=${encodeURIComponent(account)}`,
    )
  ).filter((capture) => capture.job_id === jobId);
}

type LevelSummary = {
  level: string;
  coverage: string;
  observed_rows: number;
  unique_rows: number;
  unresolved_observations: number;
  reported_total_rows: number | null;
  missing_columns: string[];
  blockers: string[];
  recommendations: { code: string; severity: string; message: string }[];
};

async function analyze(
  account: string,
  jobId: string,
  operator: AgentOptions["operator"],
) {
  const url = new URL(`${apiBase}/captures/analysis`);
  url.searchParams.set("account_id", account);
  url.searchParams.set("job_id", jobId);
  for (const [key, value] of Object.entries(operator))
    if (value !== undefined) url.searchParams.set(key, String(value));
  const result = await api<{
    job: { status: string; error?: string; level_warnings?: string[] };
    data_quality: Record<string, unknown>;
    levels: LevelSummary[];
    payment_error: boolean;
    notice: string;
  }>(`${url.pathname}${url.search}`);
  return result;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error("Timeout and step values must be positive integers");
  return parsed;
}

export function parseAgentOptions(args: string[]): AgentOptions {
  const device = z.uuid().parse(args[0]);
  const goal = z.enum(["messages", "sales", "leads"]).parse(args[1] ?? "messages");
  const flags = args.slice(2);
  const maxStepsRaw = flags.find((flag) => flag.startsWith("--max-steps="));
  const timeoutRaw = flags.find((flag) =>
    flag.startsWith("--timeout-seconds="),
  );
  const valueOf = (name: string) =>
    flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
  const breakdown = (valueOf("breakdown") ?? "")
    .split(",")
    .filter(Boolean)
    .map((dimension) =>
      z.enum(["age", "gender", "platform", "placement"]).parse(dimension),
    );
  if (new Set(breakdown).size !== breakdown.length)
    throw new Error("Breakdown dimensions must be unique");
  if (breakdown.includes("age") && breakdown.includes("gender"))
    throw new Error(
      "Age and Gender are mutually exclusive Meta demographics breakdowns",
    );
  return {
    device,
    goal,
    maxSteps: Math.min(
      20,
      parsePositiveInteger(maxStepsRaw?.split("=")[1], 12),
    ),
    skipPrepare: flags.includes("--skip-prepare"),
    skipNavigate: flags.includes("--skip-navigate"),
    collectionTimeoutMs:
      parsePositiveInteger(timeoutRaw?.split("=")[1], 300) * 1_000,
    breakdown,
    operator: {
      ...(valueOf("timezone") ? { timezone: valueOf("timezone") } : {}),
      ...(valueOf("attribution")
        ? { attribution: valueOf("attribution") }
        : {}),
      ...(valueOf("result-type")
        ? { result_type: valueOf("result-type") }
        : {}),
      ...(flags.includes("--no-breakdown")
        ? { confirm_no_breakdown: true as const }
        : {}),
      ...(flags.includes("--no-filters")
        ? { confirm_no_filters: true as const }
        : {}),
    },
  };
}

export async function runAdsAgent(options: AgentOptions) {
  const minimumVersion = process.env.AGENT_MIN_EXTENSION_VERSION ?? "0.6.22";
  const verified = await verifyDevice(options.device, minimumVersion);
  log("device_ready", {
    account: verified.account,
    extension_version: verified.version,
  });

  if (!options.skipPrepare && !verified.state.report_input)
    throw new Error(
      "Open the 15-minute report input/popup lease before starting ads automation",
    );
  if (!options.skipNavigate)
    await ensureAdsRoute(options.device, verified.account);
  const reportColumns = options.skipPrepare
    ? null
    : await prepareReport(options.device, options.goal, verified.state);
  if (reportColumns) log("report_columns", reportColumns);
  const breakdown = options.breakdown.length
    ? await prepareBreakdown(options.device, options.breakdown)
    : null;
  if (breakdown) log("breakdown", breakdown);

  const job = await collect(
    options.device,
    verified.account,
    options.maxSteps,
    options.collectionTimeoutMs,
  );
  const persisted = await waitForCaptures(
    verified.account,
    job.id,
    job.snapshots?.length ?? 0,
  );
  const analysis = await analyze(verified.account, job.id, options.operator);

  const result = {
    outcome: job.status,
    account_id: verified.account,
    extension_version: verified.version,
    operator_context: options.operator,
    report_columns: reportColumns,
    breakdown,
    job_id: job.id,
    snapshots: job.snapshots?.length ?? 0,
    persisted_capture_snapshots: persisted.length,
    error: job.error ?? analysis.job.error ?? null,
    level_warnings: analysis.job.level_warnings ?? [],
    data_quality: analysis.data_quality,
    payment_error: analysis.payment_error,
    levels: analysis.levels.map((level) => ({
      level: level.level,
      coverage: level.coverage,
      reported_total_rows: level.reported_total_rows,
      observed_rows: level.observed_rows,
      unique_rows: level.unique_rows,
      unresolved_observations: level.unresolved_observations,
      missing_columns: level.missing_columns,
      blockers: level.blockers,
      recommendations: level.recommendations,
    })),
    notice: analysis.notice,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    console.log(
      "Usage: npm run ads:agent -- DEVICE_UUID [messages|sales|leads] [--max-steps=12] [--timeout-seconds=300] [--skip-prepare] [--skip-navigate]",
    );
    return;
  }
  await runAdsAgent(parseAgentOptions(args));
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(
      `[ads-agent] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
