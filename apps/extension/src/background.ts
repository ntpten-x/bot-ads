import { z } from "zod";
import {
  type BreakdownQueryParam,
  botCommandSchema,
  reportingUrl,
  suiteUrl,
} from "../../../packages/core/src/control.js";
import { controlUi, uiSession } from "./ui-controller.js";
import { configureBreakdownWithInput } from "./breakdown-input.js";
import {
  prepareReportWithInput,
  scrollReportColumnsWithInput,
  scrollReportWithInput,
} from "./report-input.js";
import {
  readVisibleTable,
  scrollReportingRows,
  scrollReportingTable,
  waitForReportingRows,
} from "./reader.js";
type Level = "campaigns" | "adsets" | "ads";
type Job = {
  id: string;
  tabId: number;
  account: string;
  levels: Level[];
  index: number;
  step: number;
  maxSteps: number;
  scan_columns?: boolean;
  horizontal_step?: number;
  read_attempts?: number;
  last_wait_reason?: string;
  level_warnings?: string[];
  /** Vertical paging evidence: methods tried and whether rows changed (no page text). */
  scroll_log?: { level: Level; step: number; moved: boolean; method: string; tried: unknown[]; reason?: string }[];
  zoom?: { original: number; applied: number };
  breakdown_params?: BreakdownQueryParam[];
  status: "running" | "paused" | "needs_review" | "error";
  error?: string;
  snapshots: ReturnType<typeof readVisibleTable>[];
};
let busy = false;
const bridgeSchema = z.object({
  device: z.uuid(),
  account: z.string().regex(/^\d+$/),
  tabId: z.number().int(),
  enabled: z.boolean(),
});
async function getBridge() {
  return bridgeSchema.safeParse(
    (await chrome.storage.local.get("bridge")).bridge,
  ).data;
}
let identityPromise: Promise<string> | undefined;
function getDeviceId() {
  if (!identityPromise)
    identityPromise = (async () => {
      const stored = await chrome.storage.local.get(["deviceId", "bridge"]);
      const identity = z.uuid().safeParse(stored.deviceId);
      const existing = bridgeSchema.safeParse(stored.bridge);
      const id = identity.success
        ? identity.data
        : existing.success
          ? existing.data.device
          : crypto.randomUUID();
      await chrome.storage.local.set({ deviceId: id });
      return id;
    })().catch((error) => {
      identityPromise = undefined;
      throw error;
    });
  return identityPromise;
}
async function backendRequest(path: string, body?: unknown) {
  const { token } = await chrome.storage.session.get("token");
  if (typeof token !== "string" || !token.trim())
    throw new Error("กรอกรหัสเชื่อมต่อ Backend จากไฟล์ .env ก่อน");
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:4318${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("เชื่อมต่อ Backend ไม่ได้ เปิด npm run dev:api แล้วลองใหม่");
  }
  if (response.status === 401)
    throw new Error("รหัสเชื่อมต่อ Backend ไม่ถูกต้อง ตรวจค่า API_TOKEN ในไฟล์ .env");
  if (!response.ok) throw new Error(`Backend ตอบกลับ HTTP ${response.status}`);
  return response.json();
}
async function publishBridgeState(bridge: z.infer<typeof bridgeSchema>) {
  const session = await uiSession("status");
  const job = await getJob();
  const { reportInputLease } =
    await chrome.storage.session.get("reportInputLease");
  const reportLease = reportInputLease as
    { tabId?: number; account?: string; expires_at?: number } | undefined;
  await backendRequest(`/devices/${bridge.device}/state`, {
    report_input:
      !!reportLease &&
      reportLease.tabId === bridge.tabId &&
      reportLease.account === bridge.account &&
      typeof reportLease.expires_at === "number" &&
      reportLease.expires_at > Date.now(),
    job: job?.account === bridge.account ? job : undefined,
    ui: (await chrome.storage.local.get("uiState")).uiState,
    control: session.control,
    approval: session.approval,
    bound_account: bridge.account,
    extension_version: chrome.runtime.getManifest().version,
    enabled: bridge.enabled,
  });
}
const origins = [
  "https://adsmanager.facebook.com/*",
  "https://business.facebook.com/*",
];
async function getJob() {
  return (await chrome.storage.local.get("job")).job as Job | undefined;
}
async function put(job: Job) {
  await chrome.storage.local.set({ job });
}
const READ_ZOOM = 0.5;
async function applyReadZoom(job: Job) {
  try {
    const current = await chrome.tabs.getZoom(job.tabId);
    const original = job.zoom?.original ?? current;
    const applied = Math.min(current, READ_ZOOM);
    if (applied < current - 0.001) {
      await chrome.tabs.setZoom(job.tabId, applied);
      job.zoom = { original, applied };
      await put(job);
    }
  } catch {
    // Reading continues at the user's zoom if Chrome rejects the change.
  }
}
async function restoreReadZoom(job: Job) {
  if (!job.zoom) return;
  try {
    await chrome.tabs.setZoom(job.tabId, job.zoom.original);
  } catch {
    // The tab may have closed after a bounded collection.
  }
  delete job.zoom;
  await put(job);
}
async function verifiedTab(job: Job) {
  const tab = await chrome.tabs.get(job.tabId);
  const u = new URL(tab.url ?? "");
  if (
    !["adsmanager.facebook.com", "business.facebook.com"].includes(
      u.hostname,
    ) ||
    !u.pathname.startsWith("/adsmanager/") ||
    u.searchParams.get("act") !== job.account
  )
    throw new Error("Tab or account changed; collection stopped");
  return tab;
}
async function advance() {
  if (busy) return;
  busy = true;
  try {
    const job = await getJob();
    if (!job || job.status !== "running") return;
    const tab = await verifiedTab(job);
    if (tab.status !== "complete") return;
    if (!tab.active) {
      job.status = "paused";
      job.error = "เปิดแท็บ Meta ที่ผูกไว้ แล้วกดทำต่อ เพื่อให้ Meta แสดงแถวข้อมูล";
      await put(job);
      await chrome.alarms.clear("collect");
      return;
    }
    const u = new URL(tab.url!);
    const expected = `/adsmanager/manage/${job.levels[job.index]}`;
    if (u.pathname.replace(/\/$/, "") !== expected)
      throw new Error(
        "Unexpected reporting page; resume after reviewing the tab",
      );
    // Wait in the page for headers and row markers instead of relying only on
    // the 30 second alarm. Diagnostics explain an unsupported layout.
    const [waited] = await chrome.scripting.executeScript({
      target: { tabId: job.tabId },
      func: waitForReportingRows,
      args: [8000],
    });
    const diag = waited.result;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: job.tabId },
      func: readVisibleTable,
    });
    const snapshot = result.result;
    const maxAttempts = 6;
    if (!snapshot?.tables.length && !snapshot?.row_observations.length) {
      job.read_attempts = (job.read_attempts ?? 0) + 1;
      const detail = diag
        ? `headers=${diag.headers}, switches=${diag.switches}, checkboxes=${diag.checkboxes}, rows=${diag.rows}, loading=${diag.loading}`
        : "no diagnostics";
      job.last_wait_reason = `กำลังรอแถวข้อมูลโหลด (${job.read_attempts}/${maxAttempts}; ${detail})`;
      if (job.read_attempts < maxAttempts) {
        await put(job);
        return;
      }
      if (!snapshot?.unstructured?.viewport_text)
        throw new Error(
          `No supported reporting rows after ${maxAttempts} attempts on ${expected} (${detail}). The page may still be loading or use an unsupported layout.`,
        );
      // Keep the visible text as raw evidence, but report that rows were not separated.
      job.level_warnings = [
        ...(job.level_warnings ?? []),
        `${job.levels[job.index]}: rows could not be separated (${detail}); visible text kept for review only`,
      ];
    }
    job.read_attempts = 0;
    delete job.last_wait_reason;
    if (
      snapshot.account_id !== job.account ||
      snapshot.page.replace(/\/$/, "") !== expected
    )
      throw new Error("Reporting context changed during capture");
    if (
      JSON.stringify(job.snapshots).length + JSON.stringify(snapshot).length >
      4_000_000
    )
      throw new Error(
        "Snapshot checkpoint reached 4 MB; export before starting a new job",
      );
    // Check the persisted status after an async read so pause remains effective.
    if ((await getJob())?.status !== "running") return;
    const previous = job.snapshots.at(-1);
    const same =
      previous &&
      JSON.stringify(previous.tables) === JSON.stringify(snapshot.tables) &&
      JSON.stringify(previous.unstructured) ===
        JSON.stringify(snapshot.unstructured) &&
      JSON.stringify(previous.row_observations) ===
        JSON.stringify(snapshot.row_observations) &&
      previous.page === snapshot.page;
    if (!same) {
      job.snapshots.push(snapshot);
      await put(job);
      void publishSoon();
    }
    if (job.scan_columns) {
      if ((job.horizontal_step ?? 0) < 12) {
        const [pan] = await chrome.scripting.executeScript({
          target: { tabId: job.tabId },
          func: scrollReportingTable,
          args: ["horizontal"],
        });
        let moved = !!pan.result;
        if (!moved) {
          const bridge = await getBridge();
          const native = await scrollReportColumnsWithInput({
            jobId: job.id,
            tabId: job.tabId,
            account: job.account,
            enabled:
              !!bridge?.enabled &&
              bridge.tabId === job.tabId &&
              bridge.account === job.account,
          });
          moved = native.moved;
          if (!native.moved)
            job.level_warnings = [
              ...(job.level_warnings ?? []),
              `${job.levels[job.index]}: ไม่ยืนยันการเลื่อนคอลัมน์ (${native.reason}) ข้อมูลรอบนี้ยังอาจไม่ครบ`,
            ];
        }
        if (moved) {
          job.horizontal_step = (job.horizontal_step ?? 0) + 1;
          await put(job);
          setTimeout(() => void advance(), 1500);
          return;
        }
      }
      await chrome.scripting.executeScript({
        target: { tabId: job.tabId },
        func: scrollReportingTable,
        args: ["reset_horizontal"],
      });
      job.horizontal_step = 0;
    }
    job.step++;
    if (job.step < job.maxSteps) {
      await put(job);
      const [scrolled] = await chrome.scripting.executeScript({
        target: { tabId: job.tabId },
        func: scrollReportingRows,
      });
      let paging: { moved: boolean; method: string; tried: unknown[]; reason?: string } | undefined = scrolled.result;
      if ((await getJob())?.status !== "running") return;
      if (!paging?.moved && (await getJob())?.status === "running") {
        const bridge = await getBridge();
        const native = await scrollReportWithInput({
          jobId: job.id,
          tabId: job.tabId,
          account: job.account,
          enabled: !!bridge?.enabled && bridge.tabId === job.tabId && bridge.account === job.account,
        });
        if ((await getJob())?.status !== "running") return;
        paging = {
          moved: native.moved,
          method: native.method,
          tried: [...(paging?.tried ?? []), { method: "native_wheel", moved: native.moved, ...("reason" in native ? { reason: native.reason } : {}), ...("target_diagnostics" in native ? { target_diagnostics: native.target_diagnostics } : {}) }],
          ...("reason" in native ? { reason: native.reason } : {}),
        };
        if (!native.moved) job.level_warnings = [...(job.level_warnings ?? []),
          native.reason === "report_input_lease_required"
            ? `${job.levels[job.index]}: เลื่อนแถวด้วย DOM ไม่ได้ เปิดเมาส์/คีย์บอร์ดรายงานใน popup แล้วเริ่มอ่านใหม่ ข้อมูลรอบนี้ยังไม่ครบ`
            : `${job.levels[job.index]}: ไม่ยืนยันการเลื่อนแถว (${native.reason}) ข้อมูลรอบนี้ยังไม่ครบ`,
        ];
      }
      job.scroll_log = [
        ...(job.scroll_log ?? []),
        {
          level: job.levels[job.index],
          step: job.step,
          moved: !!paging?.moved,
          method: paging?.method ?? "none",
          tried: paging?.tried ?? [],
          ...(paging && "reason" in paging && paging.reason ? { reason: paging.reason } : {}),
        },
      ].slice(-40);
      await put(job);
      if (paging?.moved) {
        // Read the newly revealed rows soon instead of waiting for the 30 s alarm.
        setTimeout(() => void advance(), 1500);
        return;
      }
    }
    job.index++;
    job.step = 0;
    if (job.index >= job.levels.length) {
      job.status = "needs_review";
      await restoreReadZoom(job);
      await put(job);
      await chrome.alarms.clear("collect");
      return;
    }
    await put(job);
    await chrome.tabs.update(job.tabId, {
      url: reportingUrl(
        job.account,
        job.levels[job.index],
        job.breakdown_params,
      ).href,
    });
  } catch (e) {
    const job = await getJob();
    if (job && job.status === "running") {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
      await restoreReadZoom(job);
      await put(job);
    }
    await chrome.alarms.clear("collect");
  } finally {
    busy = false;
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "collect") void advance();
});
// Start reading soon after a level finishes loading instead of waiting for the next alarm.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;
  void getJob().then((job) => {
    if (job?.status === "running" && job.tabId === tabId)
      setTimeout(() => void advance(), 1500);
  });
});
// Best effort: send new snapshots to the local Backend so they are stored in PostgreSQL promptly.
async function publishSoon() {
  try {
    const bridge = await getBridge();
    if (bridge?.enabled) await publishBridgeState(bridge);
  } catch {
    /* The periodic bridge tick retries. */
  }
}
async function perform(message: any) {
  if (
    typeof message?.command === "string" &&
    message.command.startsWith("ui.")
  ) {
    if (busy || (await getJob())?.status === "running")
      throw new Error("Pause table collection before UI control");
    const bridge = await getBridge();
    if (!bridge?.enabled)
      throw new Error("Bind the tab with bot control first");
    return controlUi(
      botCommandSchema.parse(
        Object.fromEntries(
          Object.entries(message).filter(
            ([key]) => !["tabId", "account"].includes(key),
          ),
        ),
      ),
      bridge,
    );
  }
  if (message?.command === "report.prepare") {
    if (busy || (await getJob())?.status === "running")
      throw new Error("พักงานอ่านตารางก่อนตั้งคอลัมน์");
    const validated = botCommandSchema.parse({
      command: message.command,
      goal: message.goal,
    });
    if (validated.command !== "report.prepare")
      throw new Error("Invalid report command");
    const bridge = await getBridge();
    if (!bridge?.enabled) throw new Error("เชื่อมต่อ Extension ก่อน");
    const tab = await chrome.tabs.get(bridge.tabId);
    suiteUrl(tab.url ?? "", bridge.account);
    if (tab.status !== "complete") throw new Error("รอหน้า Meta โหลดก่อนตั้งคอลัมน์");
    await chrome.tabs.update(bridge.tabId, { active: true });
    if (tab.windowId !== undefined)
      await chrome.windows.update(tab.windowId, { focused: true });
    const result = {
      result: await prepareReportWithInput(bridge, validated.goal),
    };
    const inspected = await controlUi(
      { command: "ui.action", action: { type: "inspect", max_controls: 150 } },
      bridge,
    );
    const ui = { ...inspected.ui, report: result.result };
    await chrome.storage.local.set({ uiState: ui });
    return {
      ui,
      ...(!result.result.ok ? { ok: false, error: result.result.error } : {}),
    };
  }
  if (message?.command === "breakdown.prepare") {
    if (busy || (await getJob())?.status === "running")
      throw new Error("พักงานอ่านตารางก่อนตั้ง Breakdown");
    const validated = botCommandSchema.parse({
      command: message.command,
      dimensions: message.dimensions,
    });
    if (validated.command !== "breakdown.prepare")
      throw new Error("Invalid breakdown command");
    const bridge = await getBridge();
    if (!bridge?.enabled) throw new Error("เชื่อมต่อ Extension ก่อน");
    const tab = await chrome.tabs.get(bridge.tabId);
    suiteUrl(tab.url ?? "", bridge.account);
    if (tab.status !== "complete")
      throw new Error("รอหน้า Meta โหลดก่อนตั้ง Breakdown");
    await chrome.tabs.update(bridge.tabId, { active: true });
    if (tab.windowId !== undefined)
      await chrome.windows.update(tab.windowId, { focused: true });
    const breakdown = await configureBreakdownWithInput(
      bridge,
      validated.dimensions,
    );
    const inspected = await controlUi(
      { command: "ui.action", action: { type: "inspect", max_controls: 150 } },
      bridge,
    );
    return {
      ui: { ...inspected.ui, breakdown },
      ...(!breakdown.ok
        ? { ok: false, error: breakdown.error ?? "Breakdown setup failed" }
        : {}),
    };
  }
  if (message?.command === "reportInputSession") {
    const action = z
      .enum(["enable", "disable", "status"])
      .parse(message.action);
    if (action === "disable")
      await chrome.storage.session.remove("reportInputLease");
    if (action === "enable") {
      const bridge = await getBridge();
      if (!bridge?.enabled) throw new Error("เชื่อมต่อ Extension ก่อน");
      const tab = await chrome.tabs.get(bridge.tabId);
      suiteUrl(tab.url ?? "", bridge.account);
      if (
        !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(
          new URL(tab.url!).pathname,
        )
      )
        throw new Error("เปิดหน้ารายงาน Ads Manager ก่อน");
      await chrome.storage.session.set({
        reportInputLease: {
          tabId: bridge.tabId,
          account: bridge.account,
          expires_at: Date.now() + 15 * 60000,
        },
      });
    }
    const { reportInputLease } =
      await chrome.storage.session.get("reportInputLease");
    const lease = reportInputLease as { expires_at?: number } | undefined;
    return {
      report_input:
        !!lease &&
        typeof lease.expires_at === "number" &&
        lease.expires_at > Date.now(),
    };
  }
  if (message?.command === "uiSession") {
    const action = z
      .enum(["enable", "disable", "status", "approve", "reject"])
      .parse(message.action);
    return uiSession(action, await getBridge(), message.approval_id);
  }
  switch (message?.command) {
    case "deviceIdentity":
      return { device: await getDeviceId() };
    case "bridgeSync": {
      const bridge = await getBridge();
      if (!bridge?.enabled) throw new Error("เชื่อมต่อ Extension ก่อน");
      suiteUrl((await chrome.tabs.get(bridge.tabId)).url ?? "", bridge.account);
      await publishBridgeState(bridge);
      return { synced: true };
    }
    case "bridgeEnable": {
      const account = String(message.account ?? "");
      if (!/^\d+$/.test(account))
        throw new Error("กดตรวจบัญชีที่เปิดอยู่ หรือกรอก Account ID ก่อนเชื่อมต่อ");
      const tabId = Number(message.tabId);
      const tab = await chrome.tabs.get(tabId);
      suiteUrl(tab.url ?? "", account);
      if (!(await chrome.permissions.contains({ origins })))
        throw new Error("Meta permission required");
      await backendRequest("/health");
      const previous = await getBridge();
      if (previous && previous.account !== account) {
        await perform({ command: "pause" });
        await uiSession("disable");
        await chrome.storage.local.remove("uiState");
      }
      const bridge = {
        device: await getDeviceId(),
        account,
        tabId,
        enabled: true,
      };
      await publishBridgeState(bridge);
      await chrome.storage.local.set({ bridge });
      await chrome.storage.local.remove("bridgeError");
      await chrome.alarms.create("bridge", { periodInMinutes: 0.5 });
      return { bridge };
    }
    case "bridgeDisable": {
      await chrome.storage.session.remove("reportInputLease");
      const bridge = await getBridge();
      if (bridge)
        await chrome.storage.local.set({
          bridge: { ...bridge, enabled: false },
        });
      await chrome.alarms.clear("bridge");
      await uiSession("disable");
      await perform({ command: "pause" });
      return {};
    }
    case "bridgeStatus": {
      const { bridgeError } = await chrome.storage.local.get("bridgeError");
      return {
        bridge: await getBridge(),
        device: await getDeviceId(),
        error: typeof bridgeError === "string" ? bridgeError : undefined,
      };
    }
    case "status":
      return { job: await getJob() };
    case "pause": {
      const job = await getJob();
      if (job) {
        job.status = "paused";
        await restoreReadZoom(job);
        await put(job);
      }
      await chrome.alarms.clear("collect");
      return { job };
    }
    case "resume": {
      const job = await getJob();
      if (!job || job.index >= job.levels.length)
        throw new Error("No resumable job");
      // A job started before the user reconnected may still point at the old tab.
      // Rebind only to the currently bound tab of the same account; verifiedTab
      // below still checks host, route and account before anything is read.
      const boundTab = Number(message.tabId);
      if (
        Number.isInteger(boundTab) &&
        boundTab !== job.tabId &&
        String(message.account ?? "") === job.account
      )
        job.tabId = boundTab;
      const resumeTab = await verifiedTab(job);
      await chrome.tabs.update(job.tabId, { active: true });
      if (resumeTab.windowId !== undefined)
        await chrome.windows.update(resumeTab.windowId, {
          focused: true,
          state: "maximized",
        });
      job.status = "running";
      delete job.error;
      await put(job);
      await applyReadZoom(job);
      await chrome.alarms.create("collect", { periodInMinutes: 0.5 });
      void advance();
      return { job };
    }
    case "start": {
      if (busy || (await getJob())?.status === "running")
        throw new Error("Pause the active job first");
      if (!(await chrome.permissions.contains({ origins })))
        throw new Error("Grant Meta reading permission in the extension first");
      const tabId = Number(message.tabId),
        account = String(message.account ?? "");
      if (!Number.isInteger(tabId) || !/^\d+$/.test(account))
        throw new Error("Valid tabId and account required");
      const levels: Level[] = message.levels;
      if (
        !Array.isArray(levels) ||
        !levels.length ||
        levels.length > 3 ||
        new Set(levels).size !== levels.length ||
        levels.some((l) => !["campaigns", "adsets", "ads"].includes(l))
      )
        throw new Error("Invalid levels");
      const maxSteps = Number(message.maxSteps ?? 5);
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20)
        throw new Error("maxSteps must be 1–20");
      const job: Job = {
        id: crypto.randomUUID(),
        tabId,
        account,
        levels,
        index: 0,
        step: 0,
        maxSteps,
        scan_columns: message.scan_columns === true,
        horizontal_step: 0,
        status: "running",
        snapshots: [],
      };
      const startTab = await verifiedTab(job);
      job.breakdown_params = [...new URL(startTab.url!).searchParams]
        .filter(
          ([key, value]) =>
            /^[a-z0-9_]{1,64}_breakdown$/i.test(key) &&
            /^[a-z0-9_,.-]{1,100}$/i.test(value),
        )
        .map(([key, value]) => [key, value] as const);
      if (startTab.windowId !== undefined)
        await chrome.windows.update(startTab.windowId, {
          focused: true,
          state: "maximized",
        });
      await put(job);
      await applyReadZoom(job);
      await chrome.tabs.update(tabId, {
        url: reportingUrl(
          account,
          levels[0],
          job.breakdown_params,
        ).href,
        active: true,
      });
      await chrome.alarms.create("collect", { periodInMinutes: 0.5 });
      return { job };
    }
    default:
      throw new Error("Unsupported read-only command");
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("popup.html")
  ) {
    reply({ error: "Extension pages only" });
    return;
  }
  void perform(message)
    .then((result) => reply({ ok: true, ...result }))
    .catch((e) =>
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  return true;
});

let bridgeBusy = false;
async function bridgeTick() {
  if (bridgeBusy) return;
  bridgeBusy = true;
  try {
    const bridge = await getBridge();
    const { token } = await chrome.storage.session.get("token");
    if (!bridge?.enabled || typeof token !== "string" || !token) return;
    const request = (path: string, body?: unknown) =>
      backendRequest(`/devices/${bridge.device}${path}`, body);
    // Account binding must still hold before accepting a remote command.
    suiteUrl((await chrome.tabs.get(bridge.tabId)).url ?? "", bridge.account);
    const queued = await request("/commands/next");
    if (queued) {
      const cached = z
        .object({
          id: z.string(),
          result: z.object({
            ok: z.boolean(),
            error: z.string().optional(),
            job: z.unknown().optional(),
            ui: z.unknown().optional(),
          }),
        })
        .safeParse(
          (await chrome.storage.local.get("bridgeResult")).bridgeResult,
        ).data;
      let result =
        cached && cached.id === queued.id ? cached.result : undefined;
      if (!result) {
        // Mark before dispatch. An interrupted dispatch is reported as uncertain, never replayed automatically.
        await chrome.storage.local.set({
          bridgeResult: {
            id: queued.id,
            result: {
              ok: false,
              error:
                "Dispatch interrupted; inspect state before issuing another command",
            },
          },
        });
        try {
          const validated = botCommandSchema.parse(queued.command);
          const current = await getBridge();
          if (!current?.enabled) throw new Error("Bot control disabled");
          result = {
            ok: true,
            ...(await perform({
              ...validated,
              tabId: bridge.tabId,
              account: bridge.account,
            })),
          };
        } catch (e) {
          result = {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        await chrome.storage.local.set({
          bridgeResult: { id: queued.id, result },
        });
      }
      await request(`/commands/${queued.id}/result`, result);
    }
    await publishBridgeState(bridge);
    await chrome.storage.local.remove("bridgeError");
  } catch (e) {
    await chrome.storage.local.set({
      bridgeError: e instanceof Error ? e.message : String(e),
    });
  } finally {
    bridgeBusy = false;
  }
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "bridge") void bridgeTick();
});
