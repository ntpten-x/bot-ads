import Papa from "papaparse";
import {
  parseReport,
  importSchema,
  csvSafe,
  type ImportInput,
} from "../../../packages/core/src/index.js";
import { suiteUrl } from "../../../packages/core/src/control.js";
import { readVisibleTable } from "./reader.js";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value.trim();
const status = (s: string) => {
  $("status").textContent = s;
  $("connectionFeedback").textContent = s;
};
let input: ImportInput | undefined;
let report: ReturnType<typeof parseReport> | undefined;
function invalidate() {
  input = undefined;
  report = undefined;
  for (const id of ["sync", "export", "exportCsv"])
    $<HTMLButtonElement>(id).disabled = true;
  $("report").textContent = "ข้อมูลเปลี่ยนแล้ว กรุณาตรวจสอบไฟล์อีกครั้ง";
}
function download(data: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function currentTab(verifyAccount = true) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("ไม่พบแท็บที่เปิดอยู่");
  const url = new URL(tab.url);
  suiteUrl(
    tab.url,
    (verifyAccount ? value("account") : "") ||
      url.searchParams.get("act") ||
      "0",
  );
  return { tab, url };
}
async function command(payload: Record<string, unknown>) {
  const r = await chrome.runtime.sendMessage(payload);
  if (!r.ok) throw new Error(r.error);
  return r;
}
async function api(path: string, body?: unknown) {
  const token = value("token");
  if (!token) throw new Error("กรอก API token ก่อน");
  await chrome.storage.session.set({ token });
  const response = await fetch(`http://127.0.0.1:4318${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ?? data.errors?.join("\n") ?? `API ${response.status}`,
    );
  return data;
}
function on(id: string, action: () => Promise<void>) {
  $(id).addEventListener("click", () => {
    const b = $<HTMLButtonElement>(id);
    b.disabled = true;
    void action()
      .catch((e) => status(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        b.disabled = false;
        if (id === "validate" && !report?.valid)
          for (const k of ["sync", "export", "exportCsv"])
            $<HTMLButtonElement>(k).disabled = true;
      });
  });
}
function showReport(r: ReturnType<typeof parseReport>) {
  const root = $("report");
  root.replaceChildren();
  const summary = document.createElement("p");
  summary.className = "result";
  summary.textContent = `${r.valid ? "ผ่านการตรวจรูปแบบ" : "พบข้อผิดพลาด"} • ${r.summary.rows} แถว • Spend ${r.summary.spend.toFixed(2)} • ความครบทั้งบัญชี: ยังไม่ยืนยัน`;
  root.append(summary);
  for (const [items, cls] of [
    [r.errors, "errors"],
    [r.warnings, "warnings"],
  ] as const) {
    const ul = document.createElement("ul");
    ul.className = cls;
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.append(li);
    }
    root.append(ul);
  }
  for (const id of ["sync", "export", "exportCsv"])
    $<HTMLButtonElement>(id).disabled = !r.valid;
}
on("detect", async () => {
  const { url } = await currentTab(false);
  const account = url.searchParams.get("act");
  if (!account || !/^\d+$/.test(account))
    throw new Error("URL ไม่มี Account ID ที่ตรวจสอบได้");
  invalidate();
  $<HTMLInputElement>("account").value = account;
  await chrome.storage.local.set({ account });
  status(`ตรวจพบบัญชี ${account} จาก URL — ยังไม่ได้ยืนยันสิทธิ์เข้าถึงข้อมูล`);
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-page]",
))
  button.addEventListener("click", () => {
    void (async () => {
      const { tab } = await currentTab();
      if (!/^\d+$/.test(value("account"))) throw new Error("กรอก Account ID");
      await chrome.tabs.update(tab.id!, {
        url: `https://adsmanager.facebook.com/adsmanager/manage/${button.dataset.page}?act=${value("account")}`,
      });
    })().catch((e) => status(e.message));
  });
on("read", async () => {
  const { tab } = await currentTab();
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: readVisibleTable,
  });
  if (!r.result?.tables.length && !r.result?.unstructured?.viewport_text)
    throw new Error("ไม่พบตารางที่แสดงอยู่ ไม่ได้เก็บข้อมูล");
  download(JSON.stringify(r.result, null, 2), "visible-snapshot.json");
  status(
    "ส่งออกข้อมูลที่แสดงแล้ว — ยังไม่ได้ยืนยัน ID และเงื่อนไขรายงาน จึงไม่บันทึกเป็น Insights",
  );
});
on("run", async () => {
  const granted = await chrome.permissions.request({
    origins: [
      "https://adsmanager.facebook.com/*",
      "https://business.facebook.com/*",
    ],
  });
  if (!granted) throw new Error("ต้องอนุญาตอ่านหน้า Meta สำหรับงานอัตโนมัติ");
  const { tab } = await currentTab();
  const levels = ["campaigns", "adsets", "ads"].filter(
    (id) => $<HTMLInputElement>(id).checked,
  );
  await command({
    command: "start",
    tabId: tab.id,
    account: value("account"),
    levels,
    maxSteps: 5,
    scan_columns: $<HTMLInputElement>("scanColumns").checked,
  });
  status("เริ่มงานแล้ว ตรวจและอ่านทุก 30 วินาที ปิด popup ได้");
  await refresh();
});
on("pause", async () => {
  await command({ command: "pause" });
  await refresh();
});
on("resume", async () => {
  await command({ command: "resume" });
  await refresh();
});
on("snapshots", async () => {
  const { job } = await command({ command: "status" });
  if (!job) throw new Error("ยังไม่มีข้อมูล");
  download(JSON.stringify(job, null, 2), "collection-checkpoint.json");
});
on("bridgeEnable", async () => {
  const granted = await chrome.permissions.request({
    origins: [
      "https://adsmanager.facebook.com/*",
      "https://business.facebook.com/*",
    ],
  });
  if (!granted) throw new Error("ต้องอนุญาตอ่าน Meta");
  await chrome.storage.session.set({ token: value("token") });
  const { tab, url } = await currentTab();
  if (!value("account") && /^\d+$/.test(url.searchParams.get("act") ?? ""))
    $<HTMLInputElement>("account").value = url.searchParams.get("act")!;
  const { bridge } = await command({
    command: "bridgeEnable",
    tabId: tab.id,
    account: value("account"),
  });
  $("bridgeStatus").textContent = `เปิดรับคำสั่ง • Device ID: ${bridge.device}`;
  status("เชื่อมต่อแล้ว ระบบหน้าเว็บจะค้นพบ Extension อัตโนมัติ ไม่ต้องส่ง Device ID");
  try {
    const result = await command({
      command: "ui.action",
      action: { type: "inspect" },
    });
    const snapshot = result.ui?.snapshot;
    await command({ command: "bridgeSync" });
    status(
      `เชื่อมต่อและทดสอบอ่านแล้ว พบ ${snapshot?.controls?.length ?? 0} องค์ประกอบบนหน้า • บัญชี ${bridge.account}`,
    );
  } catch (error) {
    status(
      `เชื่อมต่อ Backend แล้ว แต่ทดสอบอ่านยังไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});
on("copyDevice", async () => {
  const input = $<HTMLInputElement>("deviceId");
  try {
    await navigator.clipboard.writeText(input.value);
    status("คัดลอก Device ID แล้ว (ไม่ใช่รหัส Backend)");
  } catch {
    input.focus();
    input.select();
    status("เลือก Device ID ให้แล้ว กด Ctrl+C เพื่อคัดลอก");
  }
});
on("openWorkspace", async () => {
  const account = value("account");
  await chrome.tabs.create({
    url: `http://localhost:9321/${/^\d+$/.test(account) ? "?account=" + account : ""}#control`,
  });
});
on("bridgeDisable", async () => {
  await command({ command: "bridgeDisable" });
  $("bridgeStatus").textContent = "ปิดรับคำสั่งบอทแล้ว";
  status("ปิดรับคำสั่งและพักงานแล้ว");
});
on("validate", async () => {
  invalidate();
  const file = $<HTMLInputElement>("file").files?.[0];
  if (!file) throw new Error("เลือก CSV ก่อน");
  if (file.size > 10_000_000) throw new Error("ไฟล์ใหญ่เกิน 10 MB");
  input = importSchema.parse({
    filename: file.name,
    csv: await file.text(),
    expected_account_id: value("account"),
    context: {
      timezone: value("timezone"),
      attribution: value("attribution"),
      result_type: value("resultType"),
    },
    expected: {
      ...(value("rows") ? { rows: Number(value("rows")) } : {}),
      ...(value("spend") ? { spend: Number(value("spend")) } : {}),
    },
  });
  report = parseReport(input);
  showReport(report);
  status(
    report.valid
      ? "ตรวจไฟล์แล้ว ตรวจข้อจำกัดก่อนบันทึก"
      : "แก้ข้อผิดพลาดใน CSV แล้วตรวจอีกครั้ง",
  );
});
on("sync", async () => {
  if (!input || !report?.valid) throw new Error("ตรวจไฟล์ก่อนบันทึก");
  const r = await api("/imports", input);
  status(
    `${r.duplicate ? "ไฟล์นี้บันทึกไว้แล้ว" : "บันทึกสำเร็จ"} • Job ${r.job_id} • ความครบทั้งบัญชียังไม่ยืนยัน`,
  );
});
on("export", async () => {
  if (!report?.valid) throw new Error("ตรวจไฟล์ก่อน");
  download(JSON.stringify(report, null, 2), "validated-report.json");
});
on("exportCsv", async () => {
  if (!report?.valid) throw new Error("ตรวจไฟล์ก่อน");
  const records = report.records.map(
    ({ raw, creative, breakdown, metrics, ...r }) =>
      Object.fromEntries(
        Object.entries({
          ...r,
          ...breakdown,
          ...metrics,
          ...Object.fromEntries(
            Object.entries(creative ?? {}).map(([k, v]) => [
              `creative_${k}`,
              v,
            ]),
          ),
        }).map(([k, v]) => [k, csvSafe(v)]),
      ),
  );
  download(
    Papa.unparse(records, {
      columns: [...new Set(records.flatMap((row) => Object.keys(row)))],
    }),
    "validated-report.csv",
    "text/csv;charset=utf-8",
  );
});
on("dbExport", async () => {
  const result = await api(
    `/export?account_id=${encodeURIComponent(value("account"))}`,
  );
  download(JSON.stringify(result, null, 2), "database-report.json");
  status("ส่งออกข้อมูลจาก Database แล้ว");
});
for (const id of [
  "account",
  "file",
  "timezone",
  "attribution",
  "resultType",
  "rows",
  "spend",
])
  $(id).addEventListener("input", invalidate);
async function refresh() {
  const { job } = await command({ command: "status" });
  $("job").textContent = job
    ? `งาน ${job.status} • เก็บ ${job.snapshots.length} snapshots • หน้า ${job.levels[job.index] ?? "อ่านครบเส้นทางที่เลือก"}${job.error ? " • " + job.error : ""} • ยังไม่ยืนยันความครบ`
    : "ยังไม่มีงานอัตโนมัติ";
}
void (async () => {
  const identity = await command({ command: "deviceIdentity" });
  $<HTMLInputElement>("deviceId").value = identity.device;
  $<HTMLButtonElement>("copyDevice").disabled = false;
  const [local, session] = await Promise.all([
    chrome.storage.local.get("account"),
    chrome.storage.session.get("token"),
  ]);
  if (!value("account"))
    $<HTMLInputElement>("account").value =
      typeof local.account === "string" ? local.account : "";
  if (!value("token"))
    $<HTMLInputElement>("token").value =
      typeof session.token === "string" ? session.token : "";
  const { bridge } = await command({ command: "bridgeStatus" });
  if (bridge)
    $("bridgeStatus").textContent =
      `${bridge.enabled ? "เปิด" : "ปิด"}รับคำสั่ง • Device ID: ${bridge.device}`;
  await refresh();
})().catch((e) => status(e.message));
setInterval(() => {
  void refresh().catch(() => {});
}, 3000);

let shownApproval = "";
async function refreshUi() {
  const reportMode = await command({
    command: "reportInputSession",
    action: "status",
  });
  $("reportInputStatus").textContent = reportMode.report_input
    ? "เปิดเมาส์/คีย์บอร์ดรายงานอยู่"
    : "โหมดเมาส์/คีย์บอร์ดรายงานยังไม่เปิด";

  const result = await command({ command: "uiSession", action: "status" });
  const control = result.control;
  $("controlStatus").textContent =
    control && control.expires_at > Date.now()
      ? `เปิดควบคุมบัญชี ${control.account} • เหลือ ${control.remaining} คำสั่ง • หมดเวลา ${new Date(control.expires_at).toLocaleTimeString()}`
      : "โหมดอ่านข้อมูล — ยังไม่ได้เปิดสิทธิ์แก้ไขหน้าเว็บ";
  const approval = result.approval;
  const active = approval && approval.expires_at > Date.now();
  $("approvalBox").hidden = !active;
  if (active && shownApproval !== approval.id) {
    shownApproval = approval.id;
    const preview = approval.preview;
    $("approvalText").textContent = JSON.stringify(
      {
        account: preview.account,
        target: preview.target,
        action: preview.action,
        page: preview.url,
        context: preview.context,
      },
      null,
      2,
    );
  }
  if (active) $<HTMLButtonElement>("approveUi").disabled = approval.approved;
  if (result.last)
    $("uiStatus").textContent =
      `ผลล่าสุด: ${result.last.outcome} • ${result.last.snapshot?.title ?? ""}`;
}
on("controlEnable", async () => {
  await command({ command: "pause" });
  await command({ command: "uiSession", action: "enable" });
  await refreshUi();
  status(
    "เปิดควบคุมผ่านหน้าเว็บ 15 นาที / 100 คำสั่ง การแก้ฟอร์มอาจบันทึกอัตโนมัติตามพฤติกรรม Meta",
  );
});
on("controlDisable", async () => {
  await command({ command: "uiSession", action: "disable" });
  await refreshUi();
  status("ปิดสิทธิ์เปลี่ยนข้อมูลบนหน้าเว็บแล้ว");
});
on("inspectUi", async () => {
  const result = await command({
    command: "ui.action",
    action: { type: "inspect" },
  });
  download(JSON.stringify(result.ui, null, 2), "meta-page-observation.json");
  await refreshUi();
  status("อ่านองค์ประกอบหน้าปัจจุบันแล้ว ไม่ได้เรียก Meta API");
});
on("approveUi", async () => {
  await command({
    command: "uiSession",
    action: "approve",
    approval_id: shownApproval,
  });
  await refreshUi();
  status("อนุมัติคำสั่งนี้ครั้งเดียวแล้ว บอทต้องส่งคำสั่งเดิมพร้อม approval_id ภายในเวลาที่กำหนด");
});
on("rejectUi", async () => {
  await command({
    command: "uiSession",
    action: "reject",
    approval_id: shownApproval,
  });
  shownApproval = "";
  await refreshUi();
  status("ปฏิเสธคำสั่งแล้ว");
});
void refreshUi().catch(() => {});
setInterval(() => void refreshUi().catch(() => {}), 2000);

on("reportInputEnable", async () => {
  await command({ command: "reportInputSession", action: "enable" });
  $("reportInputStatus").textContent = "เปิดเมาส์/คีย์บอร์ดรายงานแล้ว 15 นาที";
  await command({ command: "bridgeSync" });
});
on("reportInputDisable", async () => {
  await command({ command: "reportInputSession", action: "disable" });
  $("reportInputStatus").textContent = "ปิดเมาส์/คีย์บอร์ดรายงานแล้ว";
  await command({ command: "bridgeSync" });
});
