import { getReportFields, type ReportField } from "./report-columns.js";
import { probeReportingScroll } from "./reader.js";
import {
  probeReportTarget,
  type ReportProbeOptions,
  type ReportProbe,
} from "./report-probe.js";
type Binding = { tabId: number; account: string; enabled: boolean };

/** One native horizontal page under the same local report lease and
 * job/account guards as vertical paging. Coordinates and deltas are computed
 * locally from the current reporting view.
 */
export async function scrollReportColumnsWithInput(
  binding: Binding & { jobId: string },
) {
  const source = { tabId: binding.tabId };
  let attached = false;
  const deadline = Date.now() + 6000;
  const stopped = (reason: string) => ({
    moved: false as const,
    method: "none" as const,
    reason,
  });
  const guard = async () => {
    const { reportInputLease } =
      await chrome.storage.session.get("reportInputLease");
    const lease = reportInputLease as
      | { tabId?: number; account?: string; expires_at?: number }
      | undefined;
    if (Date.now() >= deadline) throw new Error("reporting_input_timeout");
    if (
      !binding.enabled ||
      !lease ||
      lease.tabId !== binding.tabId ||
      lease.account !== binding.account ||
      typeof lease.expires_at !== "number" ||
      lease.expires_at <= Date.now()
    )
      throw new Error("report_input_lease_required");
    const tab = await chrome.tabs.get(binding.tabId);
    const url = new URL(tab.url ?? "");
    if (
      !tab.active ||
      url.protocol !== "https:" ||
      url.port ||
      !["adsmanager.facebook.com", "business.facebook.com"].includes(
        url.hostname,
      ) ||
      !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(url.pathname) ||
      url.searchParams.get("act") !== binding.account
    )
      throw new Error("reporting_context_changed");
    const current = await chrome.storage.local.get(["bridge", "job"]);
    const bridge = current.bridge as Partial<Binding> | undefined;
    const job = current.job as
      | { id?: string; status?: string; tabId?: number; account?: string }
      | undefined;
    if (
      !bridge?.enabled ||
      bridge.tabId !== binding.tabId ||
      bridge.account !== binding.account ||
      job?.id !== binding.jobId ||
      job.status !== "running" ||
      job.tabId !== binding.tabId ||
      job.account !== binding.account
    )
      throw new Error("collection_context_changed");
  };
  const observe = async () => {
    await guard();
    const [result] = await chrome.scripting.executeScript({
      target: source,
      func: probeReportingScroll,
      args: [binding.account],
    });
    return result?.result;
  };
  try {
    const before = await observe();
    if (!before?.ready) return stopped(before?.reason ?? "no_reporting_observation");
    await guard();
    await chrome.debugger.attach(source, "1.3");
    attached = true;
    const planned = await observe();
    if (!planned?.ready || planned.signature !== before.signature)
      return stopped("reporting_view_changed_before_input");
    for (const target of planned.targets.slice(0, 4)) {
      await guard();
      await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target.x,
        y: target.y,
      });
      const hovered = await observe();
      if (!hovered?.ready) return stopped(hovered?.reason ?? "no_reporting_observation");
      if (hovered.signature !== before.signature)
        return stopped("reporting_view_changed_before_input");
      const point = hovered.targets.find(
        (candidate) =>
          candidate.band_index === target.band_index &&
          candidate.column_kind === target.column_kind,
      );
      if (!point) return stopped("reporting_target_changed");
      await guard();
      await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: point.x,
        y: point.y,
        deltaX: hovered.deltaX,
        deltaY: 0,
      });
      const observeUntil = Math.min(deadline, Date.now() + 1200);
      do {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const after = await observe();
        if (!after?.ready)
          return stopped(after?.reason ?? "no_reporting_observation");
        if (after.signature !== before.signature && after.horizontal_signature === before.horizontal_signature)
          return stopped("reporting_rows_changed_without_columns");
        if (after.horizontal_signature !== before.horizontal_signature)
          return {
            moved: true as const,
            method: "native_horizontal_wheel" as const,
            target_diagnostics: after.target_diagnostics,
          };
      } while (Date.now() < observeUntil);
    }
    return stopped("visible_columns_unchanged");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "reporting_input_failed";
    return stopped(
      [
        "report_input_lease_required",
        "reporting_context_changed",
        "reporting_input_timeout",
        "collection_context_changed",
      ].includes(reason)
        ? reason
        : "native_horizontal_wheel_failed",
    );
  } finally {
    if (attached) await chrome.debugger.detach(source).catch(() => {});
  }
}

/** One native vertical page under the popup's existing local report lease.
 * No caller-provided coordinates, methods, deltas or JavaScript are accepted.
 */
export async function scrollReportWithInput(
  binding: Binding & { jobId: string },
) {
  const source = { tabId: binding.tabId };
  let attached = false;
  const deadline = Date.now() + 5000;
  type ScrollObservation = ReturnType<typeof probeReportingScroll>;
  type TargetDiagnostics = NonNullable<
    Extract<ScrollObservation, { ready: true }>["target_diagnostics"]
  > & { attempted_bands: typeof attempted };
  const attempted: {
    band_index: number;
    column_kind: string;
    outcome: "unchanged" | "moved" | "unverified";
  }[] = [];
  const diagnostics = (observation: ScrollObservation | undefined) => {
    if (!observation || !("target_diagnostics" in observation))
      return undefined;
    return observation.target_diagnostics
      ? ({
          ...observation.target_diagnostics,
          attempted_bands: [...attempted],
        } satisfies TargetDiagnostics)
      : undefined;
  };
  const stopped = (reason: string, target_diagnostics?: TargetDiagnostics) => ({
    moved: false as const,
    method: "none" as const,
    reason,
    ...(target_diagnostics ? { target_diagnostics } : {}),
  });
  type ScrollTarget = Extract<
    ScrollObservation,
    { ready: true }
  >["targets"][number];
  const bodyMoved = (a: ScrollTarget, b: ScrollTarget | undefined) =>
    !!b &&
    a.band_index === b.band_index &&
    a.column_kind === b.column_kind &&
    a.body_offsets.length > 0 &&
    a.body_offsets.length === b.body_offsets.length &&
    a.body_offsets.every(
      (offset, i) =>
        Math.abs(offset.client_height - b.body_offsets[i].client_height) <= 1 &&
        Math.abs(offset.scroll_height - b.body_offsets[i].scroll_height) <= 1,
    ) &&
    a.body_offsets.some(
      (offset, i) =>
        Math.abs(offset.scroll_top - b.body_offsets[i].scroll_top) > 1,
    );
  const guard = async () => {
    const { reportInputLease } =
      await chrome.storage.session.get("reportInputLease");
    const l = reportInputLease as
      { tabId?: number; account?: string; expires_at?: number } | undefined;
    if (Date.now() >= deadline) throw new Error("reporting_input_timeout");
    if (
      !binding.enabled ||
      !l ||
      l.tabId !== binding.tabId ||
      l.account !== binding.account ||
      typeof l.expires_at !== "number" ||
      l.expires_at <= Date.now()
    )
      throw new Error("report_input_lease_required");
    const tab = await chrome.tabs.get(binding.tabId);
    const u = new URL(tab.url ?? "");
    if (
      !tab.active ||
      u.protocol !== "https:" ||
      u.port ||
      !["adsmanager.facebook.com", "business.facebook.com"].includes(
        u.hostname,
      ) ||
      !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
      u.searchParams.get("act") !== binding.account
    )
      throw new Error("reporting_context_changed");
    // Read current authority after the asynchronous tab checks. A static
    // binding cannot authorize an input after pause/rebind during attach.
    const current = await chrome.storage.local.get(["bridge", "job"]);
    const bridge = current.bridge as Partial<Binding> | undefined;
    const job = current.job as
      | { id?: string; status?: string; tabId?: number; account?: string }
      | undefined;
    if (
      !binding.jobId ||
      !bridge?.enabled ||
      bridge.tabId !== binding.tabId ||
      bridge.account !== binding.account ||
      job?.id !== binding.jobId ||
      job.status !== "running" ||
      job.tabId !== binding.tabId ||
      job.account !== binding.account
    )
      throw new Error("collection_context_changed");
  };
  const observe = async () => {
    await guard();
    const [r] = await chrome.scripting.executeScript({
      target: source,
      func: probeReportingScroll,
      args: [binding.account],
    });
    return r?.result;
  };
  try {
    const before = await observe();
    if (!before?.ready)
      return stopped(
        before?.reason ?? "no_reporting_observation",
        diagnostics(before),
      );
    await guard();
    await chrome.debugger.attach(source, "1.3");
    attached = true;
    // Recompute the target after attach; Meta may have repainted in between.
    const planned = await observe();
    if (!planned?.ready || planned.signature !== before.signature)
      return stopped(
        "reporting_view_changed_before_input",
        diagnostics(planned),
      );
    let current = planned;
    // A safe frozen pane can ignore wheel events. Try distinct locally
    // observed reporting bands, keeping the same deadline and authority checks.
    for (let attempt = 0; attempt < 4; attempt++) {
      const target = current.targets.find(
        (candidate) =>
          !attempted.some(
            (a) =>
              a.band_index === candidate.band_index &&
              a.column_kind === candidate.column_kind,
          ),
      );
      if (!target) break;
      await guard();
      await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target.x,
        y: target.y,
      });
      // Hover can expose controls or repaint a pane; do not reuse coordinates.
      const hovered = await observe();
      if (!hovered?.ready)
        return stopped(
          hovered?.reason ?? "no_reporting_observation",
          diagnostics(hovered),
        );
      if (hovered.signature !== before.signature)
        return attempted.length
          ? {
              moved: true as const,
              method: "native_wheel" as const,
              target_diagnostics: diagnostics(hovered),
            }
          : stopped(
              "reporting_view_changed_before_input",
              diagnostics(hovered),
            );
      const point = hovered.targets.find(
        (candidate) =>
          candidate.band_index === target.band_index &&
          candidate.column_kind === target.column_kind,
      );
      if (!point)
        return stopped(
          "reporting_view_changed_before_input",
          diagnostics(hovered),
        );
      await guard();
      await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: point.x,
        y: point.y,
        deltaX: 0,
        deltaY: hovered.deltaY,
      });
      const entry = {
        band_index: point.band_index,
        column_kind: point.column_kind,
        outcome: "unchanged" as "unchanged" | "moved" | "unverified",
      };
      attempted.push(entry);
      const observeUntil = Math.min(deadline, Date.now() + 900);
      let independentBodyMovement = false;
      do {
        await new Promise((r) => setTimeout(r, 150));
        const after = await observe();
        if (!after?.ready)
          return stopped(
            after?.reason ?? "no_reporting_observation",
            diagnostics(after),
          );
        const afterTarget = after.targets.find(
          (candidate) =>
            candidate.band_index === point.band_index &&
            candidate.column_kind === point.column_kind,
        );
        independentBodyMovement ||= bodyMoved(point, afterTarget);
        if (after.signature !== before.signature) {
          entry.outcome = "moved";
          return {
            moved: true as const,
            method: "native_wheel" as const,
            target_diagnostics: diagnostics(after),
          };
        }
        current = after;
      } while (Date.now() < observeUntil);
      if (independentBodyMovement) {
        entry.outcome = "unverified";
        return stopped(
          "reporting_body_moved_rows_unverified",
          diagnostics(current),
        );
      }
    }
    return stopped("visible_rows_unchanged", diagnostics(current));
  } catch (e) {
    const reason = e instanceof Error ? e.message : "reporting_input_failed";
    // Known reason codes only; debugger failures need review, not raw page text.
    return stopped(
      [
        "report_input_lease_required",
        "reporting_context_changed",
        "reporting_input_timeout",
        "collection_context_changed",
      ].includes(reason)
        ? reason
        : "native_wheel_failed",
    );
  } finally {
    if (attached) await chrome.debugger.detach(source).catch(() => {});
  }
}
export async function prepareReportWithInput(
  binding: Binding,
  goal: "messages" | "sales" | "leads",
  options: { visibleOnly?: boolean } = {},
) {
  type TraceEntry = {
    op: string;
    field?: string;
    phase?: string;
    kind: string;
    reason?: string;
    label?: string;
    value?: string;
    debug?: unknown;
  };
  const trace: TraceEntry[] = [];
  const selectedQueries = new Map<string, string>();
  let phase = "inspect";
  let activeField: ReportField | undefined;
  const record = (entry: TraceEntry) => {
    if (JSON.stringify(trace.at(-1)) === JSON.stringify(entry)) return;
    // Keep early context and the newest failure evidence. A first-200 cap
    // used to hide final required-field verification on the actual page.
    if (trace.length >= 200) trace.splice(30, 1);
    trace.push(entry);
  };
  const source = { tabId: binding.tabId };
  let attached = false;
  const deadline = Date.now() + 120000;
  const fields = getReportFields(goal),
    selected: string[] = [],
    missing: string[] = [];
  const blocking = (field: ReportField) => field.blocking ?? field.required;
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
      l.expires_at <= Date.now()
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
  let expectedQuery: string | undefined;
  const probe = async (
    op: ReportProbeOptions["op"],
    field?: ReportField,
  ): Promise<ReportProbe> => {
    await guard();
    const [r] = await chrome.scripting.executeScript({
      target: source,
      func: probeReportTarget,
      args: [
        {
          account: binding.account,
          op,
          field,
          query: op === "field" ? expectedQuery : undefined,
        },
      ],
    });
    if (!r?.result) throw new Error("No reporting control observation");
    record({
      op,
      field: (field ?? activeField)?.key,
      phase,
      kind: r.result.kind,
      reason: r.result.reason,
      label: r.result.label,
      value: r.result.value,
      debug: r.result.diagnostics ?? r.result.debug,
    });
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
  const locateField = async (
    field: ReportField,
    preferredQuery?: string,
  ) => {
    let p: ReportProbe = {
      kind: "missing",
      reason: "Report field not observed",
    };
    const search = await probe("search");
    if (search.kind !== "fill") return probe("field", field);
    const thaiFirst = search.locale === "th";
    const queries = preferredQuery
      ? [preferredQuery]
      : [
      ...new Set([
        ...(thaiFirst ? field.labels.filter((l) => /[ก-๙]/.test(l)) : []),
        ...(field.search_terms ?? []),
        ...field.labels,
      ]),
        ];
    for (const query of queries) {
      const before = await probe("search");
      if (before.kind !== "fill") break;
      await click("search");
      if ((await probe("focused_search")).kind !== "done")
        throw new Error("Report search focus changed");
      await send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "Control",
        code: "ControlLeft",
        windowsVirtualKeyCode: 17,
        modifiers: 2,
      });
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
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Control",
        code: "ControlLeft",
        windowsVirtualKeyCode: 17,
        modifiers: 0,
      });
      await send("Input.insertText", { text: query });
      const end = Math.min(deadline, Date.now() + 4000);
      let signature: string | undefined,
        stableSince = Date.now();
      let changed = before.value === query;
      let settled = false;
      while (Date.now() < end) {
        const state = await probe("search");
        changed ||= state.signature !== before.signature;
        if (
          state.value !== query ||
          state.busy ||
          state.signature !== signature
        ) {
          signature = state.signature;
          stableSince = Date.now();
        } else if (changed && Date.now() - stableSince >= 500) {
          expectedQuery = query;
          p = await probe("field", field);
          if (p.kind === "click" || p.kind === "selected") {
            settled = true;
            break;
          }
          // Clearing results is itself a stable update, but may be only the
          // first phase of a debounced search. Keep this query's full bounded
          // window for a matching control instead of immediately replacing it.
        }
        await new Promise((r) => setTimeout(r, 125));
      }
      // Do not read or click stale results when a controlled input reverted,
      // a filter is still busy, or no result update was observable.
      if (!settled) {
        p = {
          kind: "wait",
          reason: "Report search value/results did not settle",
        };
        record({
          op: "search_result",
          field: field.key,
          phase,
          kind: p.kind,
          reason: p.reason,
          value: query,
        });
        continue;
      }
      expectedQuery = query;
      p = await probe("field", field);
      if (p.kind === "click" || p.kind === "selected") {
        selectedQueries.set(field.key, query);
        break;
      }
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
    phase = "select_visible";
    for (const field of fields) {
      activeField = field;
      let p = await probe("field", field);
      if (p.kind === "click") {
        await click("field", field);
        p = await wait("field", (q) => q.kind === "selected", 1500, field);
      }
      if (p.kind === "selected") selected.push(field.key);
    }
    // Preserve visible optional columns; spend the bounded input window on
    // required readiness and the final recheck rather than optional searches.
    phase = "select_required";
    for (const field of options.visibleOnly
      ? []
      : fields.filter((f) => blocking(f) && !selected.includes(f.key))) {
      activeField = field;
      let p = await locateField(field);
      if (p.kind === "click") {
        await click("field", field);
        p = await wait("field", (q) => q.kind === "selected", 1000, field);
      }
      (p.kind === "selected" ? selected : missing).push(field.key);
    }
    for (const field of fields)
      if (!selected.includes(field.key) && !missing.includes(field.key))
        missing.push(field.key);
    if (!selected.length) throw new Error("ไม่พบคอลัมน์ที่ยืนยันการเลือกได้ จึงไม่บันทึก");
    // An earlier check is not proof that selection survived a filtered rerender.
    // Revisit every required control without clicking it before committing.
    phase = "verify_required";
    for (const field of fields.filter(blocking)) {
      activeField = field;
      const current = options.visibleOnly
        ? await probe("field", field)
        : await locateField(field, selectedQueries.get(field.key));
      if (current.kind !== "selected") {
        const index = selected.indexOf(field.key);
        if (index >= 0) selected.splice(index, 1);
        if (!missing.includes(field.key)) missing.push(field.key);
      }
      record({
        op: "verification",
        field: field.key,
        phase,
        kind: current.kind,
        reason: current.reason,
        debug: current.diagnostics,
      });
    }
    if (fields.some((f) => blocking(f) && !selected.includes(f.key)))
      throw new Error(
        "คอลัมน์จำเป็นยังเลือกไม่ครบหรือยืนยันสถานะไม่ได้ จึงไม่บันทึกมุมมองรายงาน",
      );
    activeField = undefined;
    phase = "save";
    await click("apply");
    const closed = await wait("closed", (p) => p.kind === "done", 5000);
    return {
      ok: closed.kind === "done",
      goal,
      selected,
      missing,
      missing_required: fields
        .filter((f) => blocking(f) && missing.includes(f.key))
        .map((f) => f.key),
      missing_goal_metrics: fields
        .filter(
          (f) => f.required && !blocking(f) && missing.includes(f.key),
        )
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
        .filter((f) => blocking(f) && !selected.includes(f.key))
        .map((f) => f.key),
      missing_goal_metrics: fields
        .filter(
          (f) => f.required && !blocking(f) && !selected.includes(f.key),
        )
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
