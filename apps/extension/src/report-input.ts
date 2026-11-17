import { getReportFields, type ReportField } from "./report-columns.js";
import { probeReportingScroll } from "./reader.js";
import {
  probeReportTarget,
  type ReportProbeOptions,
  type ReportProbe,
} from "./report-probe.js";
type Binding = { tabId: number; account: string; enabled: boolean };
const DEBUGGER_TIMEOUT_MS = 6000;
function withDebuggerTimeout<T>(
  operation: Promise<T>,
  reason: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(reason)),
      DEBUGGER_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
const attachDebugger = (source: { tabId: number }) =>
  withDebuggerTimeout(
    chrome.debugger.attach(source, "1.3"),
    "debugger_attach_timeout",
  );
const sendDebugger = (
  source: { tabId: number },
  method: string,
  params?: Record<string, unknown>,
) =>
  withDebuggerTimeout(
    chrome.debugger.sendCommand(source, method, params),
    "debugger_command_timeout",
  );
const detachDebugger = (source: { tabId: number }) =>
  withDebuggerTimeout(
    chrome.debugger.detach(source),
    "debugger_detach_timeout",
  ).catch(() => {});

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
    await attachDebugger(source);
    attached = true;
    const planned = await observe();
    if (!planned?.ready || planned.signature !== before.signature)
      return stopped("reporting_view_changed_before_input");
    for (const target of planned.targets.slice(0, 4)) {
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
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
      await sendDebugger(source, "Input.dispatchMouseEvent", {
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
        "debugger_attach_timeout",
        "debugger_command_timeout",
        "debugger_detach_timeout",
      ].includes(reason)
        ? reason
        : "native_horizontal_wheel_failed",
    );
  } finally {
    if (attached) await detachDebugger(source);
  }
}

/** Return Meta's custom virtualized scrollbar to its first row under the same
 * local report lease used for paging. Ordinary DOM reset runs first; this path
 * only trusts a custom thumb drag that reaches the top and reveals a changed
 * visible-row signature.
 */
export async function resetReportScrollWithInput(
  binding: Binding & { jobId: string },
) {
  const source = { tabId: binding.tabId };
  let attached = false;
  const deadline = Date.now() + 20_000;
  const stopped = (
    reason: string,
    target_diagnostics?: unknown,
  ) => ({
    reset: false as const,
    method: "none" as const,
    reason,
    ...(target_diagnostics ? { target_diagnostics } : {}),
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
  type Observation = Awaited<ReturnType<typeof observe>>;
  const diagnostics = (observation: unknown) =>
    observation && typeof observation === "object" && "target_diagnostics" in observation
      ? (observation as { target_diagnostics?: unknown }).target_diagnostics
      : undefined;
  const changedRows = (
    before: Extract<NonNullable<Observation>, { ready: true }>,
    after: Extract<NonNullable<Observation>, { ready: true }>,
  ) =>
    after.signature !== before.signature ||
    after.row_fingerprints.some(
      (fingerprint) => fingerprint && !before.row_fingerprints.includes(fingerprint),
    );
  try {
    const before = await observe();
    if (!before?.ready)
      return stopped(before?.reason ?? "no_reporting_observation", diagnostics(before));
    if (before.vertical_scrollbar?.at_top)
      return {
        reset: false as const,
        method: "none" as const,
        reason: "already_at_top",
        target_diagnostics: diagnostics(before),
      };
    await guard();
    await attachDebugger(source);
    attached = true;
    // Debugger attach can resize or repaint the reporting view. Rebase only
    // after two consecutive identical probes so a settled repaint is safe to
    // input, while a continuously moving view still fails closed.
    let current = before;
    let settledSignature = before.signature;
    let settled = false;
    const settleUntil = Math.min(deadline, Date.now() + 1600);
    do {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const observed = await observe();
      if (!observed?.ready)
        return stopped(
          observed?.reason ?? "no_reporting_observation",
          diagnostics(observed),
        );
      current = observed;
      if (observed.signature === settledSignature) {
        settled = true;
        break;
      }
      settledSignature = observed.signature;
    } while (Date.now() < settleUntil);
    if (!settled)
      return stopped(
        "reporting_view_changed_before_input",
        diagnostics(current),
      );

    let dragged = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let baseline = current;
      let scrollbar = current.vertical_scrollbar;
      if (!scrollbar) {
        const reveal = current.targets.find((target) => target.reveal_only) ?? current.targets[0];
        if (!reveal) return stopped("custom_scrollbar_not_found", diagnostics(current));
        await guard();
        await sendDebugger(source, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: reveal.x,
          y: reveal.y,
        });
        const hovered = await observe();
        if (!hovered?.ready)
          return stopped(hovered?.reason ?? "no_reporting_observation", diagnostics(hovered));
        current = hovered;
        baseline = hovered;
        scrollbar = hovered.vertical_scrollbar;
        if (!scrollbar) continue;
      }
      if (scrollbar.at_top)
        return dragged
          ? {
              reset: true as const,
              method: "native_scrollbar_drag" as const,
              target_diagnostics: diagnostics(current),
            }
          : stopped("already_at_top", diagnostics(current));
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: scrollbar.x,
        y: scrollbar.y,
      });
      const hovered = await observe();
      if (!hovered?.ready)
        return stopped(hovered?.reason ?? "no_reporting_observation", diagnostics(hovered));
      if (hovered.signature !== baseline.signature)
        return stopped("reporting_view_changed_before_input", diagnostics(hovered));
      const drag = hovered.vertical_scrollbar;
      if (
        !drag ||
        Math.abs(drag.x - scrollbar.x) > 2 ||
        Math.abs(drag.y - scrollbar.y) > 2
      )
        return stopped("reporting_target_changed", diagnostics(hovered));
      const topY = Math.max(
        drag.track_top + 2,
        Math.min(
          drag.y - 2,
          drag.track_top + Math.min(drag.thumb_height / 2, 48),
        ),
      );
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: drag.x,
        y: drag.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: drag.x,
        y: topY,
        button: "left",
        buttons: 1,
      });
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: drag.x,
        y: topY,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      dragged = true;
      let last = hovered;
      const observeUntil = Math.min(deadline, Date.now() + 1800);
      do {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const after = await observe();
        if (!after?.ready)
          return stopped(after?.reason ?? "no_reporting_observation", diagnostics(after));
        last = after;
        if (after.vertical_scrollbar?.at_top && changedRows(baseline, after))
          return {
            reset: true as const,
            method: "native_scrollbar_drag" as const,
            target_diagnostics: diagnostics(after),
          };
      } while (Date.now() < observeUntil);
      current = last;
      if (last.vertical_scrollbar?.at_top)
        return stopped("reset_rows_unverified", diagnostics(last));
    }
    return stopped("custom_scrollbar_reset_failed", diagnostics(current));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "reporting_input_failed";
    return stopped(
      [
        "report_input_lease_required",
        "reporting_context_changed",
        "reporting_input_timeout",
        "collection_context_changed",
        "debugger_attach_timeout",
        "debugger_command_timeout",
        "debugger_detach_timeout",
      ].includes(reason)
        ? reason
        : "native_scrollbar_reset_failed",
    );
  } finally {
    if (attached) await detachDebugger(source);
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
  const deadline = Date.now() + 30_000;
  type ScrollObservation = ReturnType<typeof probeReportingScroll>;
  type TargetDiagnostics = NonNullable<
    Extract<ScrollObservation, { ready: true }>["target_diagnostics"]
  > & { attempted_bands: typeof attempted; attempted_scrollbar: boolean };
  const attempted: {
    band_index: number;
    column_kind: string;
    outcome: "unchanged" | "moved" | "unverified";
  }[] = [];
  let attemptedScrollbar = false;
  const diagnostics = (observation: ScrollObservation | undefined) => {
    if (!observation || !("target_diagnostics" in observation))
      return undefined;
    return observation.target_diagnostics
      ? ({
          ...observation.target_diagnostics,
          attempted_bands: [...attempted],
          attempted_scrollbar: attemptedScrollbar,
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
  const introducedRows = (
    a: Extract<ScrollObservation, { ready: true }>,
    b: Extract<ScrollObservation, { ready: true }>,
  ) =>
    b.row_fingerprints.some(
      (fingerprint) => fingerprint && !a.row_fingerprints.includes(fingerprint),
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
    await attachDebugger(source);
    attached = true;
    // Recompute the target after attach. A single debugger-induced repaint is
    // allowed only after the view proves stable across consecutive probes.
    let baseline = before;
    let settledSignature = before.signature;
    let settled = false;
    const settleUntil = Math.min(deadline, Date.now() + 1600);
    do {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const observed = await observe();
      if (!observed?.ready)
        return stopped(
          observed?.reason ?? "no_reporting_observation",
          diagnostics(observed),
        );
      baseline = observed;
      if (observed.signature === settledSignature) {
        settled = true;
        break;
      }
      settledSignature = observed.signature;
    } while (Date.now() < settleUntil);
    if (!settled)
      return stopped(
        "reporting_view_changed_before_input",
        diagnostics(baseline),
      );
    const planned = baseline;
    type ReadyObservation = Extract<ScrollObservation, { ready: true }>;
    type ScrollbarDragResult =
      | { moved: true; observation: ReadyObservation }
      | { moved: false; observation: ReadyObservation }
      | { stop: ReturnType<typeof stopped> };
    const attemptScrollbarDrag = async (
      observation: ReadyObservation,
    ): Promise<ScrollbarDragResult | null> => {
      const scrollbar = observation.vertical_scrollbar;
      if (!scrollbar || attemptedScrollbar) return null;
      await guard();
      attemptedScrollbar = true;
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: scrollbar.x,
        y: scrollbar.y,
      });
      const hovered = await observe();
      if (!hovered?.ready)
        return {
          stop: stopped(
            hovered?.reason ?? "no_reporting_observation",
            diagnostics(hovered),
          ),
        };
      if (hovered.signature !== observation.signature)
        return {
          stop: stopped(
            "reporting_view_changed_before_input",
            diagnostics(hovered),
          ),
        };
      const drag = hovered.vertical_scrollbar;
      if (
        !drag ||
        Math.abs(drag.x - scrollbar.x) > 2 ||
        Math.abs(drag.y - scrollbar.y) > 2
      )
        return {
          stop: stopped("reporting_target_changed", diagnostics(hovered)),
        };
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: drag.x,
        y: drag.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: drag.x,
        y: drag.drag_y,
        button: "left",
        buttons: 1,
      });
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: drag.x,
        y: drag.drag_y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      let last = hovered;
      const observeUntil = Math.min(deadline, Date.now() + 900);
      do {
        await new Promise((r) => setTimeout(r, 150));
        const after = await observe();
        if (!after?.ready)
          return {
            stop: stopped(
              after?.reason ?? "no_reporting_observation",
              diagnostics(after),
            ),
          };
        if (introducedRows(baseline, after))
          return { moved: true as const, observation: after };
        last = after;
      } while (Date.now() < observeUntil);
      return { moved: false as const, observation: last };
    };
    let current = planned;
    const initialDrag = await attemptScrollbarDrag(planned);
    if (initialDrag && "stop" in initialDrag) return initialDrag.stop;
    if (initialDrag?.moved)
      return {
        moved: true as const,
        method: "native_scrollbar_drag" as const,
        target_diagnostics: diagnostics(initialDrag.observation),
      };
    if (initialDrag) current = initialDrag.observation;
    let bodyMovementObserved = false;
    // A safe frozen pane can ignore wheel events. Try distinct locally
    // observed reporting bands, keeping the same deadline and authority checks.
    for (let attempt = 0; attempt < 10; attempt++) {
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
      await sendDebugger(source, "Input.dispatchMouseEvent", {
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
      if (introducedRows(baseline, hovered))
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
      // Meta can reveal its custom scrollbar only after the pointer enters the
      // grid gutter. Re-probe after hover and drag the newly visible thumb
      // before consuming this target as a wheel.
      if (hovered.vertical_scrollbar && !attemptedScrollbar) {
        const drag = await attemptScrollbarDrag(hovered);
        if (drag && "stop" in drag) return drag.stop;
        if (drag?.moved)
          return {
            moved: true as const,
            method: "native_scrollbar_drag" as const,
            target_diagnostics: diagnostics(drag.observation),
          };
        if (drag) {
          current = drag.observation;
          continue;
        }
      }
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
      if (point.reveal_only) {
        attempted.push({
          band_index: point.band_index,
          column_kind: point.column_kind,
          outcome: "unchanged",
        });
        current = hovered;
        continue;
      }
      await guard();
      await sendDebugger(source, "Input.dispatchMouseEvent", {
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
        if (introducedRows(baseline, after)) {
          entry.outcome = "moved";
          return {
            moved: true as const,
            method: "native_wheel" as const,
            target_diagnostics: diagnostics(after),
          };
        }
        current = after;
      } while (Date.now() < observeUntil);
      // One wheel may land on a pane that scrolls physically while the row
      // identity set stays fixed. Keep the bounded remaining bands eligible;
      // a later band may own the actual vertical grid.
      if (independentBodyMovement) {
        entry.outcome = "unverified";
        bodyMovementObserved = true;
      }
    }
    const observed = diagnostics(current);
    return stopped(
      observed?.at_bottom
        ? "reporting_bottom_reached"
        : bodyMovementObserved
          ? "reporting_body_moved_rows_unverified"
          : "visible_rows_unchanged",
      observed,
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : "reporting_input_failed";
    // Known reason codes only; debugger failures need review, not raw page text.
    return stopped(
      [
        "report_input_lease_required",
        "reporting_context_changed",
        "reporting_input_timeout",
        "collection_context_changed",
        "debugger_attach_timeout",
        "debugger_command_timeout",
        "debugger_detach_timeout",
      ].includes(reason)
        ? reason
        : "native_wheel_failed",
    );
  } finally {
    if (attached) await detachDebugger(source);
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
  const deadline = Date.now() + 240000;
  const fields = getReportFields(goal),
    selected: string[] = [],
    missing: string[] = [],
    pruned: string[] = [];
  const blocking = (field: ReportField) => field.blocking ?? field.required;
  const keepName = new Set(["campaign_name", "ad_set_name", "ad_name"]);
  const desired = fields.filter((field) => blocking(field) || keepName.has(field.key));
  const normalize = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();
  const headerKey = (value: string) =>
    normalize(
      value.replace(/[\u2190-\u21ff\u2303\u2304\u25b2-\u25bd]/g, " "),
    )
      .replace(/\s*(?:\.{3}|…)\s*$/, "")
      .trim();
  const desiredLabels = desired
    .flatMap((field) => field.labels)
    .map(normalize);
  const keepLabels = new Set(
    [
      ...desired.flatMap((field) => field.labels),
      "Status",
      "สถานะ",
      "ปิด / เปิด",
      "เปิด / ปิด",
      "On / Off",
      "การแสดงโฆษณา",
      "การดำเนินการ",
      "การนำส่ง",
      "Actions",
      "Delivery",
      "Ad",
      "Campaign",
      "Ad set",
      "โฆษณา",
      "แคมเปญ",
      "ชุดโฆษณา",
      "Result type",
      "ประเภทผลลัพธ์",
      "Result indicator",
      "ตัวบ่งชี้ผลลัพธ์",
    ].map(normalize),
  );
  const keepsCheckedColumn = (choice: {
    label: string;
    context: string;
  }) => {
    const label = normalize(choice.label);
    if (keepLabels.has(label)) return true;
    return (
      /^(?:select|เลือก)$/i.test(label) &&
      desiredLabels.some((wanted) => normalize(choice.context).includes(wanted))
    );
  };
  const fieldHeaderLabels = (field: ReportField) =>
    [...(field.header_labels ?? []), ...field.labels]
      .map(headerKey)
      .filter((value) => value.length >= 2);
  const headerMatchesField = (header: string, field: ReportField) => {
    const value = headerKey(header);
    return fieldHeaderLabels(field).some(
      (label) =>
        value === label ||
        (label.length >= 4 && value.startsWith(label)),
    );
  };
  const spendHeaderAliases = new Set(
    [
      "Amount spent",
      "ยอดใช้จ่าย",
      "จำนวนเงินที่ใช้จ่ายไป",
      "จำนวนเงินที่ใช้ไป",
      "ค่าใช้จ่าย",
      "การใช้จ่าย",
    ].map(headerKey),
  );
  const isSpendHeader = (value: string) =>
    [...spendHeaderAliases].some((label) => {
      if (value === label) return true;
      if (label.length < 4 || !value.startsWith(label)) return false;
      return /^[\s(]/.test(value.slice(label.length));
    });
  const headerMatchesChoice = (header: string, choiceLabel: string) => {
    const value = headerKey(header);
    const label = normalize(choiceLabel);
    if (!value || !label) return false;
    if (value === label) return true;
    return (
      label.length >= 3 &&
      value.startsWith(label) &&
      /^[\s(]/.test(value.slice(label.length))
    );
  };
  const keepsRenderedHeader = (header: string) => {
    const value = headerKey(header);
    if (!value) return true;
    if (keepLabels.has(value)) return true;
    return desired.some(
      (field) =>
        headerMatchesField(header, field) ||
        (field.key === "spend" && isSpendHeader(value)),
    );
  };
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
    return sendDebugger(source, method, params);
  };
  const press = async (p: ReportProbe) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
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
  const click = async (op: ReportProbeOptions["op"], field?: ReportField) => {
    // Re-read the target immediately before input. Coordinates never come from a remote command.
    const p = await probe(op, field);
    if (p.kind !== "click" && p.kind !== "fill")
      throw new Error(p.reason ?? "Report control not ready");
    await press(p);
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
  type CheckedChoice = NonNullable<ReportProbe["checked_choices"]>[number];
  const sameLabel = (candidate: CheckedChoice, target: CheckedChoice) =>
    normalize(candidate.label) === normalize(target.label);
  const matchingChoice = (p: ReportProbe, target: CheckedChoice) =>
    (p.checked_choices ?? []).filter(
      (item) => sameLabel(item, target) && item.checked === target.checked,
    );
  const uncheckChoice = async (choice: CheckedChoice) => {
    const field: ReportField = {
      key: `extra_${normalize(choice.label).replace(/[^a-z0-9ก-๙]+/gi, "_")}`,
      labels: [choice.label],
      required: false,
      checked_only: true,
    };
    let p = await probe("checked");
    let matches = matchingChoice(p, choice);
    const scan = (note: string) =>
      record({
        op: "prune_scan",
        field: `extra_${normalize(choice.label).replace(/[^a-z0-9ก-๙]+/gi, "_")}`,
        phase,
        kind: matches.length === 1 ? "done" : "missing",
        label: choice.label,
        reason: note,
        debug: {
          choice_scroll: p.choice_scroll,
          match_count: matches.length,
          target: matches[0]
            ? {
                checked: matches[0].checked,
                visible: matches[0].visible,
                clipped: matches[0].clipped,
                context: matches[0].context.slice(0, 240),
              }
            : null,
        },
      });
    scan("initial");
    if (matches.length !== 1 || !matches[0].visible) {
      // Search narrows Meta's list, but the target row can still be clipped.
      await locateField(field);
      p = await probe("checked");
      matches = matchingChoice(p, choice);
      scan("after_search");
    }
    for (let step = 0; step < 12; step++) {
      if (matches.length !== 1) {
        scan("target_not_unique");
        return false;
      }
      if (matches[0].visible) break;
      if (!p.choice_scroll) {
        scan("no_scroll_target");
        return false;
      }
      const choices = p.checked_choices ?? [];
      const targetIndex = choices.findIndex(
        (item) => sameLabel(item, choice) && item.checked === choice.checked,
      );
      const visibleIndices = choices.flatMap((item, index) =>
        item.visible ? [index] : [],
      );
      const direction =
        targetIndex >= 0 && visibleIndices.length
          ? targetIndex > Math.max(...visibleIndices)
            ? 1
            : targetIndex < Math.min(...visibleIndices)
              ? -1
              : 1
          : 1;
      const before = p.choice_scroll.scroll_top;
      const beforeSignature = JSON.stringify(
        choices.map((item) => [
          item.label,
          item.context,
          item.checked,
          item.visible,
        ]),
      );
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: p.choice_scroll.x,
        y: p.choice_scroll.y,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: p.choice_scroll.x,
        y: p.choice_scroll.y,
        deltaX: 0,
        deltaY: direction * Math.max(180, p.choice_scroll.client_height * 0.8),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      p = await probe("checked");
      matches = matchingChoice(p, choice);
      const afterSignature = JSON.stringify(
        (p.checked_choices ?? []).map((item) => [
          item.label,
          item.context,
          item.checked,
          item.visible,
        ]),
      );
      if (
        p.choice_scroll?.scroll_top === before &&
        afterSignature === beforeSignature
      ) {
        scan("scroll_did_not_move");
        return false;
      }
    }
    const target = matches[0];
    if (
      matches.length !== 1 ||
      !target.checked ||
      !target.visible ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y)
    ) {
      scan("target_not_clickable");
      return false;
    }
    const clickable = await probe("field", field);
    if (
      clickable.kind !== "selected" ||
      !Number.isFinite(clickable.x) ||
      !Number.isFinite(clickable.y)
    ) {
      scan("click_target_not_verified");
      return false;
    }
    await press(clickable);
    p = await probe("checked");
    matches = matchingChoice(p, choice);
    scan("after_click");
    const unchecked = (candidate: ReportProbe) =>
      !(candidate.checked_choices ?? []).some(
        (item) => sameLabel(item, choice) && item.checked,
      );
    let after = await wait("checked", unchecked, 1500);
    if (!unchecked(after)) {
      await clearSearch();
      after = await wait("checked", unchecked, 1500);
    }
    return unchecked(after);
  };
  type SelectedColumn = NonNullable<ReportProbe["selected_columns"]>[number];
  const sameSelectedColumn = (a: string, b: string) =>
    headerKey(a) === headerKey(b);
  const removeSelectedColumn = async (label: string) => {
    const p = await probe("selected_columns");
    const matches = (p.selected_columns ?? []).filter(
      (item) =>
        sameSelectedColumn(item.label, label) &&
        item.visible &&
        item.hit &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y),
    );
    if (matches.length !== 1) return false;
    await press({
      kind: "click",
      x: matches[0].x,
      y: matches[0].y,
      label: matches[0].label,
    });
    const end = Math.min(deadline, Date.now() + 3000);
    while (Date.now() < end) {
      const current = await probe("selected_columns");
      if (
        !(current.selected_columns ?? []).some((item) =>
          sameSelectedColumn(item.label, label),
        )
      )
        return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  };
  const scrollSelectedColumns = async (p: ReportProbe) => {
    const scroll = p.selected_scroll;
    if (!scroll) return false;
    const before = scroll.scroll_top;
    const down = before < scroll.range - 2;
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: scroll.x,
      y: scroll.y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: scroll.x,
      y: scroll.y,
      deltaX: 0,
      deltaY:
        (down ? 1 : -1) * Math.max(180, scroll.client_height * 0.8),
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const after = await probe("selected_columns");
    return after.selected_scroll?.scroll_top !== before;
  };
  const clearSearch = async () => {
    const search = await probe("search");
    if (search.kind !== "fill" || !search.value) return;
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
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    const cleared = await wait(
      "search",
      (candidate) => candidate.kind === "fill" && candidate.value === "",
      4000,
    );
    if (cleared.kind !== "fill" || cleared.value !== "")
      throw new Error("ล้างคำค้นหาคอลัมน์ไม่สำเร็จ");
  };
  try {
    await guard();
    await attachDebugger(source);
    attached = true;
    phase = "inspect_table";
    const initialHeaders = await probe("table_headers");
    const menu = await wait(
      "menu",
      (candidate) => candidate.kind === "click" || candidate.kind === "done",
      15000,
    );
    if (menu.kind !== "click" && menu.kind !== "done")
      throw new Error(menu.reason ?? "Report menu not ready");
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
    // Meta keeps unrelated columns from the previous saved view. Leaving them
    // selected pushes required identity and metric cells into different
    // horizontal slices, where they cannot be joined safely.
    phase = "prune_optional";
    const renderedExtras = (initialHeaders.headers ?? []).filter(
      (header) => !keepsRenderedHeader(header),
    );
    const isPruned = (label: string) =>
      pruned.some((done) => headerMatchesChoice(label, done));
    // Meta's current dialog exposes a "selected columns" panel whose rows have
    // a remove button. That panel is authoritative and remains addressable even
    // when the active category/search omits the choice. Prefer it; the older
    // checkbox path is retained for layouts without the panel.
    phase = "prune_selected";
    let selectedListMode = false;
    for (let round = 0; round < 24; round++) {
      const current = await probe("selected_columns");
      if (!(current.selected_columns ?? []).length) break;
      selectedListMode = true;
      const extras = (current.selected_columns ?? []).filter(
        (column) =>
          !keepsRenderedHeader(column.label) && !isPruned(column.label),
      );
      if (!extras.length) break;
      const target = extras.find(
        (column) =>
          column.visible &&
          column.hit &&
          Number.isFinite(column.x) &&
          Number.isFinite(column.y),
      );
      if (target) {
        const ok = await removeSelectedColumn(target.label);
        record({
          op: "prune",
          field: `extra_${normalize(target.label).replace(/[^a-z0-9ก-๙]+/gi, "_")}`,
          phase,
          kind: ok ? "done" : "missing",
          label: target.label,
          reason: ok
            ? undefined
            : "Selected report column remove control failed",
        });
        if (ok) {
          pruned.push(target.label);
          continue;
        }
      }
      if (!(await scrollSelectedColumns(current))) break;
    }
    if (selectedListMode) {
      const left = await probe("selected_columns");
      const extrasLeft = (left.selected_columns ?? []).filter(
        (column) =>
          !keepsRenderedHeader(column.label) && !isPruned(column.label),
      );
      if (extrasLeft.length)
        throw new Error(
          `ยกเลิกคอลัมน์ส่วนเกินไม่สำเร็จ: ${extrasLeft
            .slice(0, 5)
            .map((column) => column.label)
            .join(", ")}`,
        );
      await clearSearch();
    } else {
      for (let round = 0; round < 4; round++) {
        await clearSearch();
        const checked = await probe("checked");
        const extrasByLabel = new Map<string, CheckedChoice>();
        for (const label of renderedExtras) {
          if (isPruned(label)) continue;
          // A rendered header may add a parenthetical or unit that is absent from
          // the dialog label. Prefer the real checked choice so trusted search
          // uses a query the dialog can actually match.
          const choice = (checked.checked_choices ?? []).find(
            (item) =>
              item.checked &&
              !keepsCheckedColumn(item) &&
              headerMatchesChoice(label, item.label),
          );
          extrasByLabel.set(
            normalize(choice?.label ?? label),
            choice ?? {
              label,
              context: label,
              checked: true,
              visible: false,
              clipped: true,
            },
          );
        }
        // Dialog choices can be omitted from the active category. Rendered table
        // headers remain the source of truth for extras that actually pollute the
        // capture view, and search makes those hidden choices addressable.
        for (const choice of checked.checked_choices ?? [])
          if (
            choice.checked &&
            !isPruned(choice.label) &&
            !keepsCheckedColumn(choice)
          )
            extrasByLabel.set(normalize(choice.label), choice);
        const extras = [...extrasByLabel.values()];
        if (!extras.length) break;
        const failed: string[] = [];
        for (const extra of extras) {
          const ok = await uncheckChoice(extra);
          record({
            op: "prune",
            field: `extra_${normalize(extra.label).replace(/[^a-z0-9ก-๙]+/gi, "_")}`,
            phase,
            kind: ok ? "done" : "missing",
            label: extra.label,
            reason: ok
              ? undefined
              : "Unrelated report column could not be unselected",
          });
          if (ok) pruned.push(extra.label);
          else failed.push(extra.label);
        }
        if (failed.length)
          throw new Error(
            `ยกเลิกคอลัมน์ส่วนเกินไม่สำเร็จ: ${failed.slice(0, 5).join(", ")}`,
          );
      }
      await clearSearch();
      const remaining = await probe("checked");
      const extrasLeft = (remaining.checked_choices ?? []).filter(
        (choice) => choice.checked && !keepsCheckedColumn(choice),
      );
      if (extrasLeft.length)
        throw new Error(
          `ยังพบคอลัมน์ส่วนเกิน ${extrasLeft.length} รายการ จึงไม่บันทึกมุมมอง`,
        );
    }
    // Select the small required/name set before changing the search filter.
    phase = "select_visible";
    for (const field of desired) {
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
      : desired.filter((f) => !selected.includes(f.key))) {
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
    if (closed.kind !== "done")
      return {
        ok: false,
        goal,
        selected,
        missing,
        pruned,
        missing_required: fields
          .filter((f) => blocking(f) && missing.includes(f.key))
          .map((f) => f.key),
        missing_goal_metrics: fields
          .filter(
            (f) => f.required && !blocking(f) && missing.includes(f.key),
          )
          .map((f) => f.key),
        applied: false,
        trace,
        input_mode: "chrome_input" as const,
        error: "Meta dialog remained open after Save",
      };
    // Closing the dialog only proves that a click was dispatched. Verify the
    // rendered report headers so a stale or hidden selection cannot be reported
    // as an applied column view.
    phase = "verify_rendered";
    const requiredHeaders = fields.filter(blocking);
    const renderedState = () => {
      const current = lastTableHeaders;
      const missingRendered = requiredHeaders
        .filter(
          (field) =>
            !current.some((header) => headerMatchesField(header, field)),
        )
        .map((field) => field.key);
      const extraHeaders = current.filter(
        (header) => !keepsRenderedHeader(header),
      );
      return { missingRendered, extraHeaders };
    };
    let lastTableHeaders: string[] = [];
    let verification = renderedState();
    const verifyUntil = Math.min(deadline, Date.now() + 8000);
    do {
      const current = await probe("table_headers");
      lastTableHeaders = current.headers ?? [];
      verification = renderedState();
      if (!verification.missingRendered.length && !verification.extraHeaders.length)
        break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < verifyUntil);
    const verified =
      lastTableHeaders.length > 0 &&
      !verification.missingRendered.length &&
      !verification.extraHeaders.length;
    record({
      op: "rendered_headers",
      phase,
      kind: verified ? "done" : "missing",
      reason: verified
        ? undefined
        : "Rendered table headers do not match the saved column view",
      debug: {
        headers: lastTableHeaders.slice(0, 40),
        missing_fields: verification.missingRendered,
        extra_headers: verification.extraHeaders.slice(0, 20),
      },
    });
    return {
      ok: verified,
      goal,
      selected,
      missing,
      pruned,
      missing_required: fields
        .filter((f) => blocking(f) && missing.includes(f.key))
        .map((f) => f.key),
      missing_goal_metrics: fields
        .filter(
          (f) => f.required && !blocking(f) && missing.includes(f.key),
        )
        .map((f) => f.key),
      applied: verified,
      trace,
      input_mode: "chrome_input" as const,
      rendered_headers: lastTableHeaders.slice(0, 40),
      missing_rendered_fields: verification.missingRendered,
      extra_rendered_headers: verification.extraHeaders.slice(0, 20),
      ...(!verified
        ? {
            error:
              "บันทึกแล้วแต่ยืนยันคอลัมน์บนตารางไม่ได้ จึงไม่ถือว่ามุมมองพร้อมใช้งาน",
            warning:
              "Saved dialog state was not trusted without rendered header verification.",
          }
        : {}),
    };
  } catch (error) {
    return {
      ok: false,
      goal,
      selected,
      missing,
      pruned,
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
    if (attached) await detachDebugger(source);
  }
}
