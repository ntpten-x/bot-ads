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
  query?: string;
};
export type ReportProbe = {
  kind: "click" | "fill" | "selected" | "missing" | "wait" | "done";
  x?: number;
  y?: number;
  label?: string;
  reason?: string;
  value?:string;
  debug?:unknown;
  signature?: string;
  busy?: boolean;
  locale?: "th" | "en" | "unknown";
  diagnostics?: {
    visible_choice_count?: number;
    clipped_choice_count?: number;
    search_count?: number;
    matched_count: number;
    clipped_count: number;
    visible_busy_count: number;
    primary_match_count: number;
    helper_only_count: number;
    candidates: {
      label: string;
      helper: string;
      checked: boolean;
      visible: boolean;
      clipped: boolean;
      hit: boolean;
      primary_match: boolean;
      helper_match: boolean;
    }[];
  };
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
  const geometry = (e: Element) => {
    const r = e.getBoundingClientRect(), style = getComputedStyle(e);
    let left = Math.max(0, r.left), top = Math.max(0, r.top);
    let right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    let hidden = style.visibility === "hidden" || style.display === "none";
    for (let parent = e.parentElement; parent; parent = parent.parentElement) {
      const ps = getComputedStyle(parent), pr = parent.getBoundingClientRect();
      if (parent.getAttribute("aria-hidden") === "true" || ps.display === "none" || ps.visibility === "hidden") hidden = true;
      if (/^(hidden|clip|scroll|auto)$/.test(ps.overflowX)) {
        left = Math.max(left, pr.left + parent.clientLeft);
        right = Math.min(right, pr.left + parent.clientLeft + parent.clientWidth);
      }
      if (/^(hidden|clip|scroll|auto)$/.test(ps.overflowY)) {
        top = Math.max(top, pr.top + parent.clientTop);
        bottom = Math.min(bottom, pr.top + parent.clientTop + parent.clientHeight);
      }
    }
    const visible = !hidden && r.width > 0 && r.height > 0 && right > left && bottom > top;
    return { visible, hidden, clipped: left > r.left || top > r.top || right < r.right || bottom < r.bottom,
      x: (left + right) / 2, y: (top + bottom) / 2 };
  };
  const visible = (e: Element) => geometry(e).visible;
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
    const { visible: inView, x, y } = geometry(e);
    if (!inView) return { kind: "wait", reason: "Report control clipped" };
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
  const locale: "th" | "en" | "unknown" = dialog
    ? [...dialog.querySelectorAll('h1,h2,h3,[role="heading"],button,[role="button"]')]
      .filter(visible).some((e) => /[ก-๙]/.test(text(e))) || /[ก-๙]/.test(dialog.getAttribute("aria-label") ?? "")
      ? "th" : [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible)
        .some((e) => /customize columns/i.test(text(e))) ? "en" : "unknown"
    : "unknown";
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
    if (dialog) return { kind: "done", locale };
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
  const busyCount = () => [...dialog.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].filter(visible).length;
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
    const allChoices = [...dialog.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')];
    const choices = allChoices.filter(visible);
    return {
      ...target(searches, "fill"),
      value: searches.length === 1 ? searches[0].value : undefined,
      // DOM evidence only: stable visible choices, not a guessed network state.
      signature: JSON.stringify(choices.map((e) => [label(e), text(e.closest('li,[role="listitem"]') ?? e),
        e instanceof HTMLInputElement ? e.checked : e.getAttribute("aria-checked")])),
      busy: busyCount() > 0,
      locale,
      diagnostics: {
        matched_count: 0, clipped_count: 0, primary_match_count: 0, helper_only_count: 0, candidates: [],
        visible_choice_count: choices.length,
        clipped_choice_count: allChoices.filter((e) => geometry(e).clipped).length,
        search_count: searches.length, visible_busy_count: busyCount(),
      },
    };
  }
  if (options.query !== undefined) {
    const searches = [...dialog.querySelectorAll<HTMLInputElement>("input")].filter((e) =>
      visible(e) && ["text", "search"].includes(e.type) && /search|ค้นหา/i.test(label(e) + " " + e.placeholder));
    if (searches.length !== 1 || searches[0].value !== options.query ||
      busyCount() > 0)
      return { kind: "wait", reason: "Report search context changed", locale, diagnostics: {
        matched_count: 0, clipped_count: 0, primary_match_count: 0, helper_only_count: 0, candidates: [],
        search_count: searches.length, visible_busy_count: busyCount(),
      } };
  }
  const field = options.field;
  if (!field) throw new Error("Report field required");
  const exact = (s: string) =>
    field.labels.some((l) => norm(l).toLowerCase() === norm(s).toLowerCase());
  const states = [...dialog.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')].map((e) => {
    const names = e instanceof HTMLInputElement ? [...(e.labels ?? [])].map(text) : [];
    if (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby")) names.push(label(e));
    const item = e.closest<HTMLElement>('li,[role="listitem"]');
    const helper: string[] = [];
    if (item && item.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length === 1) {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let first = true;
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement, value = norm(walker.currentNode.textContent ?? "");
        if (!value || !parent || geometry(parent).hidden || parent.closest('[aria-hidden="true"]')) continue;
        if (first) { if (!names.length) names.push(value); first = false; }
        else helper.push(value);
      }
    } else if (!names.length) names.push(label(e));
    const g = geometry(e), checked = e instanceof HTMLInputElement ? e.checked : e.getAttribute("aria-checked") === "true";
    const context = [...names, ...helper].map(norm).join(" ").toLowerCase();
    const excluded = (field.exclude_terms ?? []).some((term) =>
      context.includes(norm(term).toLowerCase()),
    );
    const preferred_match = !excluded && (field.prefer_terms ?? []).some((term) =>
      context.includes(norm(term).toLowerCase()),
    );
    const primary_match = !excluded && names.some(exact),
      helper_match = !excluded && helper.some(exact);
    let hit = false;
    if (g.visible) {
      const node = document.elementFromPoint(g.x, g.y);
      hit = !!node && (node === e || e.contains(node) || !!item && item.contains(node) &&
        item.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length === 1);
    }
    return {
      e,
      names,
      helper,
      checked,
      visible: g.visible,
      clipped: g.clipped,
      hit,
      primary_match,
      helper_match,
      preferred_match,
    };
  });
  let matching = states.filter((state) => state.primary_match);
  if (matching.some((state) => state.preferred_match))
    matching = matching.filter((state) => state.preferred_match);
  const checkboxes = matching.filter((state) => state.visible).map((state) => state.e);
  const diagnostics: NonNullable<ReportProbe["diagnostics"]> = {
    matched_count: matching.length,
    clipped_count: matching.filter((state) => state.clipped).length,
    visible_busy_count: busyCount(),
    primary_match_count: matching.filter((state) => state.visible).length,
    helper_only_count: states.filter((state) => !state.primary_match && state.helper_match).length,
    candidates: states.filter((state) => state.primary_match || state.helper_match).slice(0, 12)
      .map(({ names, helper, checked, visible, clipped, hit, primary_match, helper_match }) => ({
        label: names.join(" | ").slice(0, 240),
        helper: helper.join(" | ").slice(0, 240),
        checked,
        visible,
        clipped,
        hit,
        primary_match,
        helper_match,
      })),
  };
  const plan = target(checkboxes, "click");
  if (plan.kind === "click" && checkboxes.length === 1 && matching.find((state) => state.e === checkboxes[0])?.checked)
    return { kind: "selected", label: field.key, locale, diagnostics };
  return { ...plan, locale, diagnostics };
}
