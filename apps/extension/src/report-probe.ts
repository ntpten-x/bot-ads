import type { ReportField } from "./report-columns.js";
export type ReportProbeOptions = {
  account: string;
  op:
    | "menu"
    | "dialog"
    | "field"
    | "search"
    | "focused_search"
    | "apply"
    | "closed";
  field?: ReportField;
};
export type ReportProbe = {
  kind: "click" | "fill" | "selected" | "missing" | "wait" | "done";
  x?: number;
  y?: number;
  label?: string;
  reason?: string;
  value?:string;
  debug?:unknown;
};
/** Read-only planner. No click/fill, page JS, network, cookies or arbitrary selectors. */
export function probeReportTarget(options: ReportProbeOptions): ReportProbe {
  const u = new URL(location.href);
  if (
    u.protocol !== "https:" ||
    u.port !== "" ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(
      u.hostname,
    ) ||
    !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
    u.searchParams.get("act") !== options.account
  )
    throw new Error("Reporting page or account changed");
  const norm = (s: string) =>
    s
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const text = (e: Element) =>
    norm((e as HTMLElement).innerText ?? e.textContent ?? "");
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth &&
      s.visibility !== "hidden" &&
      s.display !== "none"
    );
  };
  const label = (e: Element) =>
    norm(
      e.getAttribute("aria-label") ||
        (e.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ") ||
        text(e),
    );
  const custom = /^(customize columns|กำหนดคอลัมน์เอง|ปรับแต่งคอลัมน์)(?:\.{3}|…)?$/i;
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
    .filter(visible)
    .filter(
      (d) =>
        custom.test(label(d)) ||
        [...d.querySelectorAll('h1,h2,h3,[role="heading"]')].some((h) =>
          custom.test(text(h)),
        ),
    );
  if (dialogs.length > 1) throw new Error("Ambiguous report dialogs");
  const dialog = dialogs[0];
  const controls = (root: ParentNode) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'button,[role="button"],[role="menuitem"]',
      ),
    ].filter(visible);
  const target = (
    elements: HTMLElement[],
    kind: "click" | "fill",
  ): ReportProbe => {
    if (elements.length !== 1)
      return {
        kind: "missing",
        reason: elements.length
          ? "Ambiguous report control"
          : "Report control not visible",
      };
    const e = elements[0];
    if (e.matches(':disabled,[aria-disabled="true"]'))
      return { kind: "wait", reason: "Report control disabled" };
    const r = e.getBoundingClientRect(),
      x = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2)),
      y = Math.max(1, Math.min(innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    const row = e.closest('li,[role="listitem"]');
    const rowHit =
      options.op === "field" &&
      !!hit &&
      !!row &&
      row.contains(hit) &&
      row.querySelectorAll('input[type="checkbox"],[role="checkbox"]')
        .length === 1;
    if (!hit || !(e === hit || e.contains(hit) || rowHit))
      return { kind: "wait", reason: "Report control occluded" };
    return { kind, x, y, label: label(e).slice(0, 150) };
  };
  if (options.op === "closed") return { kind: dialog ? "wait" : "done" };
  if (options.op === "menu") {
    if (dialog || controls(document).some((e) => custom.test(label(e))))
      return { kind: "done" };
    if (
      controls(document).some(
        (e) =>
          e.getAttribute("role") === "menuitem" &&
          /^(loading|กำลังโหลด)/i.test(label(e)),
      )
    )
      return { kind: "wait" };
    return target(
      controls(document).filter((e) =>
        /^(columns|คอลัมน์)\s*[:：]/i.test(label(e)),
      ),
      "click",
    );
  }
  if (options.op === "dialog") {
    if (dialog) return { kind: "done" };
    return target(
      controls(document).filter((e) => custom.test(label(e))),
      "click",
    );
  }
  if (!dialog)
    return {
      kind: "missing",
      reason: "Recognized column customization dialog required",
    };
  if (options.op === "apply")
    return target(
      controls(dialog).filter((e) =>
        /^(apply|save|นำไปใช้|ใช้|บันทึก)$/i.test(label(e)),
      ),
      "click",
    );
  if (options.op === "search" || options.op === "focused_search") {
    const searches = [
      ...dialog.querySelectorAll<HTMLInputElement>("input"),
    ].filter(
      (e) =>
        visible(e) &&
        ["text", "search"].includes(e.type) &&
        /search|ค้นหา/i.test(label(e) + " " + e.placeholder),
    );
    if (options.op === "focused_search")
      return {
        kind:
          searches.length === 1 && document.activeElement === searches[0]
            ? "done"
            : "missing",
      };
    return {...target(searches, "fill"),value:searches.length===1?searches[0].value:undefined};
  }
  const field = options.field;
  if (!field) throw new Error("Report field required");
  const exact = (s: string) =>
    field.labels.some((l) => norm(l).toLowerCase() === norm(s).toLowerCase());
  const checkboxes = [
    ...dialog.querySelectorAll<HTMLElement>(
      'input[type="checkbox"],[role="checkbox"]',
    ),
  ]
    .filter(visible)
    .filter((e) => {
      const labels =
        e instanceof HTMLInputElement ? [...(e.labels ?? [])].map(text) : [];
      const item = e.closest<HTMLElement>('li,[role="listitem"]');
      if (
        item &&
        item.querySelectorAll('input[type="checkbox"],[role="checkbox"]')
          .length === 1
      )
        {labels.push(text(item));
        const walker=document.createTreeWalker(item,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const parent=walker.currentNode.parentElement;
          if(parent&&visible(parent)&&!parent.closest('[aria-hidden="true"]'))labels.push(norm(walker.currentNode.textContent??''));}}

      labels.push(label(e));
      return labels.some(exact);
    });
  if (checkboxes.length === 1) {
    const e = checkboxes[0];
    if (
      e instanceof HTMLInputElement
        ? e.checked
        : e.getAttribute("aria-checked") === "true"
    )
      return { kind: "selected", label: field.key };
  }
  const plan=target(checkboxes,'click');
  if(!checkboxes.length)plan.debug={search:[...dialog.querySelectorAll<HTMLInputElement>('input')].filter(e=>['text','search'].includes(e.type)).map(e=>({value:e.value,label:label(e)})),
    choices:[...dialog.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')].filter(visible).slice(0,25).map(e=>{const item=e.closest<HTMLElement>('li,[role="listitem"]');return {label:label(e),item:item?text(item):null,count:item?.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length,labels:e instanceof HTMLInputElement?[...(e.labels??[])].map(text):[]};})};
  return plan;
}
