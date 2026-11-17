export type BreakdownDimension = "age" | "gender" | "platform" | "placement";
type Binding = { tabId: number; account: string; enabled: boolean };

type ProbeTarget = { x: number; y: number; label: string };
type ProbeOption = {
  key: BreakdownDimension;
  checked: boolean | null;
  visible: boolean;
  hit: boolean;
  target?: ProbeTarget;
};
type ProbeResult =
  | { ready: false; reason: string }
  | {
      ready: true;
      menu_open: boolean;
      loading: boolean;
      trigger?: ProbeTarget;
      search?: ProbeTarget;
      options: ProbeOption[];
      breakdown_params: [string, string][];
    };

/** Read-only local planning inside the isolated extension world.
 * Only allowlisted breakdown names are observed; no selector or JS is remote.
 */
export function probeBreakdownMenu(account: string): ProbeResult {
  const url = new URL(location.href);
  if (
    url.protocol !== "https:" ||
    url.port ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(
      url.hostname,
    ) ||
    !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(url.pathname) ||
    url.searchParams.get("act") !== account
  )
    return { ready: false, reason: "reporting_context_changed" };
  const norm = (value: string) =>
    value
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const text = (element: Element) =>
    norm((element as HTMLElement).innerText ?? element.textContent ?? "");
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top < innerHeight &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.right > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const label = (element: Element) =>
    norm(
      element.getAttribute("aria-label") ||
        (element.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ") ||
        text(element).split("\n")[0] ||
        (element as HTMLInputElement).placeholder ||
        "",
    );
  const target = (element: HTMLElement): ProbeTarget | undefined => {
    if (!visible(element)) return undefined;
    const rect = element.getBoundingClientRect();
    const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(element === hit || element.contains(hit))) return undefined;
    return { x, y, label: label(element).slice(0, 120) };
  };
  const clickable = [
    ...document.querySelectorAll<HTMLElement>(
      'button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],label',
    ),
  ];
  const triggers = clickable.filter(
    (element) =>
      visible(element) &&
      /^(?:ข้อมูลแยกย่อย(?:\s*:.*)?|breakdown(?:\s*:.*)?)$/i.test(
        label(element),
      ),
  );
  const trigger = triggers
    .map((element) => target(element))
    .find((candidate): candidate is ProbeTarget => !!candidate);
  const definitions: {
    key: BreakdownDimension;
    labels: RegExp;
  }[] = [
    { key: "age", labels: /^(?:อายุ|age)$/i },
    { key: "gender", labels: /^(?:เพศ|gender)$/i },
    { key: "platform", labels: /^(?:แพลตฟอร์ม|platform)$/i },
    {
      key: "placement",
      labels: /^(?:ตำแหน่ง(?:การแสดง)?โฆษณา|placement)$/i,
    },
  ];
  const options = definitions.map(({ key, labels }) => {
    const matches = [
      ...document.querySelectorAll<HTMLElement>(
        'button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="checkbox"],input[type="checkbox"],label,li,[role="listitem"]',
      ),
    ].filter(
      (element) =>
        visible(element) &&
        !element.closest(
          '[role="columnheader"],thead,[role="grid"],[role="treegrid"]',
        ) &&
        labels.test(label(element)),
    );
    if (matches.length !== 1)
      return {
        key,
        checked: null,
        visible: matches.some(visible),
        hit: false,
      } satisfies ProbeOption;
    const element = matches[0];
    let checkbox =
      element instanceof HTMLInputElement
        ? element
        : element.querySelector<HTMLElement>(
            'input[type="checkbox"],[role="checkbox"],[role="menuitemcheckbox"]',
          );
    if (!checkbox) {
      const rect = element.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      checkbox = [
        ...document.querySelectorAll<HTMLElement>(
          'input[type="checkbox"],[role="checkbox"],[role="menuitemcheckbox"]',
        ),
      ]
        .filter((candidate) => visible(candidate))
        .map((candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          const candidateX =
            candidateRect.left + candidateRect.width / 2;
          return {
            candidate,
            inColumn:
              candidateX >= rect.left - 20 &&
              candidateX <= rect.right + 20,
            distance: Math.abs(
              candidateRect.top + candidateRect.height / 2 - centerY,
            ),
          };
        })
        .filter(
          ({ distance, inColumn }) =>
            inColumn && distance <= Math.max(22, rect.height / 2 + 4),
        )
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
    }
    const semantic =
      checkbox instanceof HTMLInputElement
        ? checkbox.checked
        : checkbox?.getAttribute("aria-checked") === "true" ||
            element.getAttribute("aria-checked") === "true" ||
            element.getAttribute("aria-selected") === "true"
          ? true
          : checkbox?.getAttribute("aria-checked") === "false" ||
              element.getAttribute("aria-checked") === "false" ||
              element.getAttribute("aria-selected") === "false"
            ? false
            : null;
    const point = target(checkbox ?? element);
    return {
      key,
      checked: semantic,
      visible: visible(element),
      hit: !!point,
      ...(point ? { target: point } : {}),
    } satisfies ProbeOption;
  });
  const optionPoints = [
    ...document.querySelectorAll<HTMLElement>('li,[role="listitem"]'),
  ]
    .filter(
      (element) =>
        visible(element) &&
        definitions.some(({ labels }) => labels.test(label(element))),
    )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });
  const search = [
    ...document.querySelectorAll<HTMLInputElement>(
      'input:not([type]),input[type="text"],input[type="search"]',
    ),
  ]
    .filter(
      (element) =>
        visible(element) &&
        /search|ค้นหา/i.test(label(element) + " " + element.placeholder),
    )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const point =
        target(element) ?? {
          x: Math.max(
            1,
            Math.min(innerWidth - 1, rect.left + rect.width / 2),
          ),
          y: Math.max(
            1,
            Math.min(innerHeight - 1, rect.top + rect.height / 2),
          ),
          label: label(element).slice(0, 120),
        };
      const distance = optionPoints.length
        ? Math.min(
            ...optionPoints.map(
              (option) =>
                Math.abs(option.x - (rect.left + rect.width / 2)) +
                Math.abs(option.y - (rect.top + rect.height / 2)),
            ),
          )
        : Number.POSITIVE_INFINITY;
      return { point, distance };
    })
    .filter(
      (candidate): candidate is { point: ProbeTarget; distance: number } =>
        !!candidate.point,
    )
    .sort((a, b) => a.distance - b.distance)[0]?.point;
  return {
    ready: true,
    menu_open: options.some((option) => option.visible),
    loading:
      [...document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')]
        .some(visible),
    ...(trigger ? { trigger } : {}),
    ...(search ? { search } : {}),
    options,
    breakdown_params: [...url.searchParams]
      .filter(([key, value]) => /breakdown/i.test(key) && !!value)
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}

export async function configureBreakdownWithInput(
  binding: Binding,
  dimensions: BreakdownDimension[],
) {
  const source = { tabId: binding.tabId };
  let attached = false;
  const deadline = Date.now() + 30_000;
  const guard = async () => {
    const { reportInputLease } =
      await chrome.storage.session.get("reportInputLease");
    const lease = reportInputLease as
      | { tabId?: number; account?: string; expires_at?: number }
      | undefined;
    if (Date.now() >= deadline) throw new Error("breakdown_input_timeout");
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
    const { job } = await chrome.storage.local.get("job");
    if ((job as { status?: string } | undefined)?.status === "running")
      throw new Error("pause_collection_before_breakdown");
  };
  const observe = async () => {
    await guard();
    const [result] = await chrome.scripting.executeScript({
      target: source,
      func: probeBreakdownMenu,
      args: [binding.account],
    });
    return result?.result as ProbeResult | undefined;
  };
  const click = async (point: ProbeTarget) => {
    await guard();
    await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(source, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
  };
  const keyForQuery = (query: string): BreakdownDimension => {
    if (/เพศ|gender/i.test(query)) return "gender";
    if (/ตำแหน่ง|placement/i.test(query)) return "placement";
    if (/แพลตฟอร์ม|platform/i.test(query)) return "platform";
    return "age";
  };
  const queryFor = (key: BreakdownDimension) =>
    ({
      age: "อายุ",
      gender: "เพศ",
      platform: "แพลตฟอร์ม",
      placement: "ตำแหน่งโฆษณา",
    })[key];
  const press = async (
    key: string,
    code: string,
    windowsVirtualKeyCode: number,
    modifiers = 0,
  ) => {
    await guard();
    await chrome.debugger.sendCommand(source, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
    await chrome.debugger.sendCommand(source, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
  };
  const searchFor = async (
    current: Extract<ProbeResult, { ready: true }>,
    query: string,
  ) => {
    if (!current.search) throw new Error("breakdown_search_not_found");
    await click(current.search);
    await press("a", "KeyA", 65, 2);
    await press("Backspace", "Backspace", 8);
    await guard();
    await chrome.debugger.sendCommand(source, "Input.insertText", {
      text: query,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const observed = await observe();
    if (!observed?.ready)
      throw new Error(observed?.reason ?? "no_reporting_observation");
    return {
      current: observed,
      option: observed.options.find(
        (candidate) => candidate.key === keyForQuery(query),
      ),
    };
  };
  try {
    const before = await observe();
    if (!before?.ready)
      throw new Error(before?.reason ?? "no_reporting_observation");
    const unsupported = before.breakdown_params
      .map(([key]) => key)
      .filter(
        (key) =>
          !/^(?:age|gender|platform|placement|demographics)_breakdown$/i.test(
            key,
          ),
      );
    if (unsupported.length)
      throw new Error(`unsupported_active_breakdown:${unsupported.join(",")}`);
    const activeDimensions = new Set<BreakdownDimension>();
    for (const [param, value] of before.breakdown_params) {
      const name = param.replace(/_breakdown$/i, "").toLowerCase();
      if (name === "demographics") {
        for (const part of value.split(",")) {
          const dimension = part.trim().toLowerCase();
          if (["age", "gender", "platform", "placement"].includes(dimension))
            activeDimensions.add(dimension as BreakdownDimension);
        }
      } else if (["age", "gender", "platform", "placement"].includes(name))
        activeDimensions.add(name as BreakdownDimension);
    }
    const requested = new Set(dimensions);
    const alreadyApplied =
      dimensions.every((dimension) => activeDimensions.has(dimension)) &&
      [...activeDimensions].every((dimension) => requested.has(dimension));
    if (alreadyApplied) {
      await guard();
      let menuAfter: boolean | null = before.menu_open;
      if (before.menu_open) {
        await chrome.debugger.attach(source, "1.3");
        attached = true;
        await chrome.debugger.sendCommand(source, "Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await chrome.debugger.sendCommand(source, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const after = await observe();
        menuAfter = after?.ready ? after.menu_open : null;
      }
      return {
        ok: true,
        dimensions,
        selected: [...dimensions],
        cleared: [],
        missing: [],
        menu_open_after: menuAfter,
        breakdown_params_before: before.breakdown_params,
        breakdown_params_after: before.breakdown_params,
        url_after: (await chrome.tabs.get(binding.tabId)).url ?? "",
      };
    }
    await guard();
    await chrome.debugger.attach(source, "1.3");
    attached = true;
    let current = await observe();
    if (!current?.ready)
      throw new Error(current?.reason ?? "no_reporting_observation");
    for (let attempt = 0; current.loading && attempt < 16; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const observed = await observe();
      if (!observed?.ready)
        throw new Error(observed?.reason ?? "no_reporting_observation");
      current = observed;
    }
    if (!current.menu_open) {
      if (!current.trigger) throw new Error("breakdown_menu_not_found");
      await click(current.trigger);
      for (let attempt = 0; attempt < 8; attempt++) {
        current = await observe();
        if (current?.ready && current.menu_open) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (!current?.ready || !current.menu_open)
        throw new Error("breakdown_menu_not_found");
    }
    const selected: BreakdownDimension[] = [];
    const cleared: BreakdownDimension[] = [];
    const missing: BreakdownDimension[] = [];
    if (dimensions.includes("age") && dimensions.includes("gender"))
      throw new Error("breakdown_dimensions_mutually_exclusive");
    for (const key of ["age", "gender", "platform", "placement"] as const) {
      let option = current.options.find((candidate) => candidate.key === key);
      const wanted = dimensions.includes(key);
      const activeByUrl = current.breakdown_params.some(
        ([param, value]) =>
          (param === "demographics_breakdown" && value === key) ||
          (param === `${key}_breakdown` && !!value),
      );
      // Unrequested, inactive dimensions need no search or click. Searching
      // every key kept the menu busy until breakdown_input_timeout.
      if (!wanted && !activeByUrl && option?.checked !== true) continue;
      if (!option?.target && current.search) {
        const searched = await searchFor(current, queryFor(key));
        current = searched.current;
        option = searched.option;
      }
      if (!option || !option.target) {
        if (dimensions.includes(key)) missing.push(key);
        continue;
      }
      if (wanted && activeByUrl) {
        selected.push(key);
        continue;
      }
      if (wanted && option.checked !== true) {
        await click(option.target);
        const after = await observe();
        const verified = after?.ready
          ? after.options.find((candidate) => candidate.key === key)
          : undefined;
        const verifiedByUrl = after?.ready
          ? after.breakdown_params.some(
              ([param, value]) =>
                param === "demographics_breakdown" && value === key,
            )
          : false;
        if (verified?.checked !== true && !verifiedByUrl) missing.push(key);
        else selected.push(key);
        if (after?.ready) current = after;
      } else if (wanted && option.checked === true) {
        selected.push(key);
      } else if (
        !wanted &&
        (option.checked === true || activeByUrl)
      ) {
        await click(option.target);
        const after = await observe();
        const verified = after?.ready
          ? after.options.find((candidate) => candidate.key === key)
          : undefined;
        const stillByUrl = after?.ready
          ? after.breakdown_params.some(
              ([param, value]) =>
                param === "demographics_breakdown" && value === key,
            )
          : false;
        if (verified?.checked === true || stillByUrl)
          throw new Error(`breakdown_not_cleared:${key}`);
        cleared.push(key);
        if (after?.ready) current = after;
      }
    }
    if (current.search) {
      await click(current.search);
      await press("a", "KeyA", 65, 2);
      await press("Backspace", "Backspace", 8);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await guard();
    await chrome.debugger.sendCommand(source, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await chrome.debugger.sendCommand(source, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = await observe();
    const urlAfter =
      (await chrome.tabs.get(binding.tabId)).url ?? before.breakdown_params
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&");
    const ok = missing.length === 0;
    return {
      ok,
      dimensions,
      selected,
      cleared,
      missing,
      menu_open_after: after?.ready ? after.menu_open : null,
      breakdown_params_before: before.breakdown_params,
      breakdown_params_after:
        after?.ready ? after.breakdown_params : null,
      url_after: urlAfter,
      ...(!ok ? { error: "breakdown_selection_incomplete" } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      dimensions,
      selected: [],
      cleared: [],
      missing: dimensions,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (attached) await chrome.debugger.detach(source).catch(() => {});
  }
}
