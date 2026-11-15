import { getReportFields, type ReportField } from "./report-columns.js";
import {
  probeReportTarget,
  type ReportProbeOptions,
  type ReportProbe,
} from "./report-probe.js";
type Binding = { tabId: number; account: string; enabled: boolean };
export async function prepareReportWithInput(
  binding: Binding,
  goal: "messages" | "sales" | "leads",
  options:{visibleOnly?:boolean}={},
) {
  const trace:{op:string;field?:string;kind:string;reason?:string;label?:string;value?:string;debug?:unknown}[]=[];
  const source = { tabId: binding.tabId };
  let attached = false;
  const deadline = Date.now() + 120000;
  const fields = getReportFields(goal),
    selected: string[] = [],
    missing: string[] = [];
  const guard = async () => {
    if (Date.now() > deadline)
      throw new Error("Report input timed out; inspect the Meta dialog");
    const { reportInputLease } =
      await chrome.storage.session.get("reportInputLease");
    const l = reportInputLease as
      { tabId?: number; account?: string; expires_at?: number } | undefined;
    if (
      !binding.enabled ||
      !l ||
      l.tabId !== binding.tabId ||
      l.account !== binding.account ||
      typeof l.expires_at !== "number" ||
      l.expires_at < Date.now()
    )
      throw new Error("เปิดโหมดเมาส์และคีย์บอร์ดสำหรับรายงานใน Extension ก่อน");
    const tab = await chrome.tabs.get(binding.tabId);
    const u = new URL(tab.url ?? "");
    if (
      !tab.active ||
      u.protocol !== "https:" ||
      u.port !== "" ||
      !["adsmanager.facebook.com", "business.facebook.com"].includes(
        u.hostname,
      ) ||
      !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
      u.searchParams.get("act") !== binding.account
    )
      throw new Error(
        "Bound reporting tab must remain active with the same account",
      );
  };
  const probe = async (
    op: ReportProbeOptions["op"],
    field?: ReportField,
  ): Promise<ReportProbe> => {
    await guard();
    const [r] = await chrome.scripting.executeScript({
      target: source,
      func: probeReportTarget,
      args: [{ account: binding.account, op, field }],
    });
    if (!r?.result) throw new Error("No reporting control observation");
    const entry={op,field:field?.key,kind:r.result.kind,reason:r.result.reason,label:r.result.label,value:r.result.value,debug:r.result.debug};
    if(trace.length<200&&JSON.stringify(trace.at(-1))!==JSON.stringify(entry))trace.push(entry);
    return r.result;
  };
  // Protocol methods are fixed here; no arbitrary CDP method/params accepted from the bot.
  const send = async (
    method:
      | "Input.dispatchMouseEvent"
      | "Input.dispatchKeyEvent"
      | "Input.insertText",
    params: Record<string, unknown>,
  ) => {
    await guard();
    return chrome.debugger.sendCommand(source, method, params);
  };
  const click = async (op: ReportProbeOptions["op"], field?: ReportField) => {
    // Re-read the target immediately before input. Coordinates never come from a remote command.
    const p = await probe(op, field);
    if (
      (p.kind !== "click" && p.kind !== "fill") ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    )
      throw new Error(p.reason ?? "Report control not ready");
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: p.x,
      y: p.y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: p.x,
      y: p.y,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: p.x,
      y: p.y,
      button: "left",
      clickCount: 1,
    });
  };
  const wait = async (
    op: ReportProbeOptions["op"],
    accept: (p: ReportProbe) => boolean,
    ms: number,
    field?: ReportField,
  ) => {
    const end = Math.min(deadline, Date.now() + ms);
    let p = await probe(op, field);
    while (!accept(p) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 125));
      p = await probe(op, field);
    }
    return p;
  };
  try {
    await guard();
    await chrome.debugger.attach(source, "1.3");
    attached = true;
    const menu = await probe("menu");
    if (menu.kind === "click") await click("menu");
    let dialog = await wait(
      "dialog",
      (p) => p.kind === "click" || p.kind === "done",
      10000,
    );
    if (dialog.kind === "click") {
      await click("dialog");
      dialog = await wait("dialog", (p) => p.kind === "done", 6000);
    }
    if (dialog.kind !== "done")
      throw new Error("ไม่พบหน้าต่างปรับแต่งคอลัมน์ที่พร้อมใช้งาน");
    // Select options already present before changing the search filter.
    for(const field of fields){
      let p=await probe('field',field);
      if(p.kind==='click'){await click('field',field);p=await wait('field',q=>q.kind==='selected',1500,field);}
      if(p.kind==='selected')selected.push(field.key);
    }
    for (const field of (options.visibleOnly?[]:fields.filter(f=>!selected.includes(f.key)))) {
      let p = await probe("field", field);
      if (p.kind !== "click" && p.kind !== "selected") {
        for (const query of [
          field.labels[0],
          field.labels.find((l) => /[ก-๙]/.test(l)),
        ].filter((q): q is string => !!q)) {
          const search = await probe("search");
          if (search.kind !== "fill") break;
          await click("search");
          if ((await probe("focused_search")).kind !== "done")
            throw new Error("Report search focus changed");
          await send("Input.dispatchKeyEvent", {type:"rawKeyDown",key:"Control",code:"ControlLeft",windowsVirtualKeyCode:17,modifiers:2});
          await send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
            modifiers: 2,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
            modifiers: 2,
          });
          await send("Input.dispatchKeyEvent", {type:"keyUp",key:"Control",code:"ControlLeft",windowsVirtualKeyCode:17,modifiers:0});
          await send("Input.insertText", { text: query });
          await probe("search");
          p = await wait(
            "field",
            (q) => q.kind === "click" || q.kind === "selected",
            1000,
            field,
          );
          if (p.kind === "click" || p.kind === "selected") break;
        }
      }
      if (p.kind === "click") {
        await click("field", field);
        p = await wait("field", (q) => q.kind === "selected", 1000, field);
      }
      (p.kind === "selected" ? selected : missing).push(field.key);
    }
    for(const field of fields)if(!selected.includes(field.key)&&!missing.includes(field.key))missing.push(field.key);
    if (!selected.length) throw new Error("ไม่พบคอลัมน์ที่ยืนยันการเลือกได้ จึงไม่บันทึก");
    await click("apply");
    const closed = await wait("closed", (p) => p.kind === "done", 5000);
    return {
      ok: closed.kind === "done",
      goal,
      selected,
      missing,
      missing_required: fields
        .filter((f) => f.required && missing.includes(f.key))
        .map((f) => f.key),
      applied: closed.kind === "done",
      trace,
      input_mode: "chrome_input" as const,
      ...(closed.kind !== "done"
        ? { error: "Meta dialog remained open after Save" }
        : {}),
    };
  } catch (error) {
    return {
      ok: false,
      goal,
      selected,
      missing,
      missing_required: fields
        .filter((f) => f.required && !selected.includes(f.key))
        .map((f) => f.key),
      applied: false,
      trace,
      input_mode: "chrome_input" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (attached) await chrome.debugger.detach(source).catch(() => {});
  }
}
