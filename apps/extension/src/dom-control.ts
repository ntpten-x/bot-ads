import type { DomAction } from "../../../packages/core/src/control.js";
// Entire function is injected into the isolated extension world; it has no network or page-JS access.
export async function operateDom(request: {
  account: string;
  action: DomAction;
  execute: boolean;
  allow_commit: boolean;
}) {
  try {
    const pageUrl = new URL(location.href);
    if (
      pageUrl.protocol !== "https:" ||
      !["adsmanager.facebook.com", "business.facebook.com"].includes(
        pageUrl.hostname,
      ) ||
      !/^\/(adsmanager\/(manage|creation|reporting)(\/|$)|latest(\/|$)|business(\/|$)|settings(\/|$))/.test(
        pageUrl.pathname,
      )
    )
      throw new Error("Unsupported Meta web page");
    const act = pageUrl.searchParams.get("act");
    if (act && act !== request.account) throw new Error("Account changed");
    const state = globalThis as typeof globalThis & {
      __metaCollectorControl?: {
        snapshot: string;
        targets: Map<string, { element: HTMLElement; signature: string }>;
      };
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.top < innerHeight &&
        r.right > 0 &&
        r.left < innerWidth &&
        css.visibility !== "hidden" &&
        css.display !== "none"
      );
    };
    const label = (el: HTMLElement) => {
      const ariaIds = (el.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const labels =
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
          ? [...(el.labels ?? [])]
              .map((l) => {
                const copy = l.cloneNode(true) as HTMLElement;
                copy
                  .querySelectorAll("input,textarea,select")
                  .forEach((control) => control.remove());
                return copy.textContent ?? "";
              })
              .join(" ")
          : "";
      return (
        el.getAttribute("aria-label") ||
        ariaIds ||
        labels ||
        el.getAttribute("placeholder") ||
        el.innerText ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 500);
    };
    const role = (el: HTMLElement) =>
      el.getAttribute("role") ??
      {
        BUTTON: "button",
        A: "link",
        SELECT: "combobox",
        TEXTAREA: "textbox",
        INPUT: el instanceof HTMLInputElement ? el.type : "input",
      }[el.tagName] ??
      el.tagName.toLowerCase();
    const signature = (el: HTMLElement) =>
      JSON.stringify([
        el.tagName,
        role(el),
        label(el),
        el.getAttribute("href"),
        el.getAttribute("type"),
        el.getAttribute("name"),
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
          ? el.value
          : el.isContentEditable
            ? el.innerText
            : null,
        el instanceof HTMLInputElement
          ? el.checked
          : el.getAttribute("aria-checked"),
      ]);
    const secret = (el: HTMLElement) =>
      el instanceof HTMLInputElement &&
      (["password", "hidden"].includes(el.type) ||
        /password|passwd|cookie|token|secret|credit.?card|card.?number|cvv|รหัสผ่าน|หมายเลขบัตร/i.test(
          `${el.name} ${el.id} ${label(el)}`,
        ));
    const available = (el: HTMLElement) =>
      !el.matches(':disabled,[aria-disabled="true"]') && !el.closest("[inert]");
    const commit = (el: HTMLElement) =>
      !label(el) ||
      ["switch", "checkbox", "radio"].includes(role(el)) ||
      /publish|เผยแพร่|เผยแพร่ทั้งหมด|เปิดใช้งาน|ปิดใช้งาน|ยืนยัน|ชำระ|pay\b|confirm|submit|delete|ลบ|remove|apply|นำไปใช้|save|บันทึก|discard|ทิ้ง|boost|โปรโมท|สั่งซื้อ/i.test(
        label(el),
      );
    const fileVisible = (el: HTMLElement) =>
      el instanceof HTMLInputElement &&
      el.type === "file" &&
      ((el.labels && [...el.labels].some(visible)) ||
        (!!el.parentElement && visible(el.parentElement)));
    const describe = (el: HTMLElement, id: string) => {
      const r = el.getBoundingClientRect();
      return {
        id,
        tag: el.tagName.toLowerCase(),
        role: role(el),
        label: label(el),
        type: el.getAttribute("type"),
        disabled: !available(el),
        visible: visible(el),
        value: secret(el)
          ? "[redacted]"
          : el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement
            ? el.value.slice(0, 2000)
            : el.isContentEditable
              ? el.innerText.slice(0, 2000)
              : undefined,
        checked:
          el instanceof HTMLInputElement
            ? el.checked
            : el.getAttribute("aria-checked"),
        requires_review: commit(el),
        options:
          el instanceof HTMLSelectElement
            ? [...el.options]
                .slice(0, 100)
                .map((o) => ({ value: o.value, label: o.label }))
            : undefined,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      };
    };
    const inspect = (max = 150) => {
      const snapshot = crypto.randomUUID();
      const targets = new Map<
        string,
        { element: HTMLElement; signature: string }
      >();
      const candidates = [
        ...document.querySelectorAll<HTMLElement>(
          'button,a[href],input,textarea,select,[role="button"],[role="switch"],[role="checkbox"],[role="radio"],[role="combobox"],[role="option"],[role="tab"],[role="menuitem"],[contenteditable="true"],[tabindex]',
        ),
      ].filter((el) => (visible(el) || fileVisible(el)) && !secret(el));
      const controls = candidates.slice(0, max).map((el, index) => {
        const id = `node_${index}`;
        targets.set(id, { element: el, signature: signature(el) });
        return describe(el, id);
      });
      state.__metaCollectorControl = { snapshot, targets };
      // Clone visible viewport text while removing credentials and payment entry fields.
      const text: string[] = [];
      let textLength = 0;
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode() && textLength < 40000) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (
          parent &&
          visible(parent) &&
          !parent.closest(
            'script,style,noscript,input,textarea,[contenteditable="true"]',
          )
        ) {
          const s = node.textContent?.trim();
          if (s) {
            text.push(s);
            textLength += s.length;
          }
        }
      }
      return {
        snapshot_id: snapshot,
        url: location.href,
        account_id: act,
        account_verified: act === request.account,
        captured_at: new Date().toISOString(),
        title: document.title,
        text: text.join("\n").slice(0, 40000),
        controls,
        controls_truncated: candidates.length > max,
        coverage: "visible_viewport_only",
        warnings: [
          "DOM actions are synthetic events. Inspect the returned page state to verify the result; a click does not prove publication or delivery.",
        ],
      };
    };
    const action = request.action;
    if (action.type === "inspect")
      return { outcome: "observed", snapshot: inspect(action.max_controls) };
    let target: HTMLElement | undefined;
    if ("target" in action && action.target) {
      const cache = state.__metaCollectorControl;
      if (!cache || cache.snapshot !== action.snapshot_id)
        throw new Error("Stale snapshot; inspect again");
      const found = cache.targets.get(action.target);
      if (
        !found ||
        !found.element.isConnected ||
        found.signature !== signature(found.element)
      )
        throw new Error("Target changed; inspect again");
      target = found.element;
      if (
        !visible(target) &&
        !(action.type === "upload" && fileVisible(target))
      )
        throw new Error("Target is no longer visible");
      if (secret(target))
        throw new Error("Credential and payment inputs cannot be controlled");
      if (!available(target)) throw new Error("Target disabled");
    }
    if (action.type !== "scroll" && !target) throw new Error("Target required");
    const mutation = action.type !== "scroll";
    if (mutation && act !== request.account)
      throw new Error(
        "Account must be verified in the URL before changing the page",
      );
    const needsReview =
      !!target &&
      ((action.type === "click" && commit(target)) ||
        (action.type === "press" && ["Enter", " "].includes(action.key)) ||
        action.type === "check");
    if (!request.execute)
      return {
        outcome: "preview",
        requires_review: needsReview,
        target: target
          ? describe(target, "target" in action ? (action.target ?? "") : "")
          : undefined,
        url: location.href,
        title: document.title,
        context: document.body.innerText.slice(0, 10000),
        action: {
          ...action,
          ...(action.type === "upload"
            ? { base64: "[file contents omitted]" }
            : {}),
        },
      };
    if (needsReview && !request.allow_commit)
      throw new Error("This action requires local review");
    if (target && action.type === "click") {
      const r = target.getBoundingClientRect();
      const top = document.elementFromPoint(
        Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)),
        Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)),
      );
      if (!top || !(target === top || target.contains(top)))
        throw new Error("Target covered by another element; inspect again");
      if (target instanceof HTMLAnchorElement) {
        const link = new URL(target.href);
        if (
          link.protocol !== "https:" ||
          !["adsmanager.facebook.com", "business.facebook.com"].includes(
            link.hostname,
          )
        )
          throw new Error("External link navigation is not allowed");
      }
      target.click();
    } else if (target && action.type === "fill") {
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        if (
          target instanceof HTMLInputElement &&
          ["file", "checkbox", "radio", "submit", "button"].includes(
            target.type,
          )
        )
          throw new Error("Use the matching control action");
        const prototype =
          target instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        target.focus();
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) throw new Error("Native value setter unavailable");
        setter.call(target, action.value);
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: action.value,
          }),
        );
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (target.isContentEditable) {
        target.focus();
        target.textContent = action.value;
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: action.value,
          }),
        );
      } else throw new Error("Target is not editable");
    } else if (target && action.type === "select") {
      if (!(target instanceof HTMLSelectElement))
        throw new Error(
          "Custom dropdown: click combobox, inspect, then click an option",
        );
      if (
        ![...target.options].some(
          (o) => o.value === action.value && !o.disabled,
        )
      )
        throw new Error("Option unavailable");
      target.value = action.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (target && action.type === "check") {
      if (
        target instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(target.type)
      ) {
        if (target.checked !== action.checked) target.click();
      } else if (["switch", "checkbox", "radio"].includes(role(target))) {
        if (target.getAttribute("aria-checked") !== String(action.checked))
          target.click();
      } else throw new Error("Target is not a checkbox or switch");
    } else if (target && action.type === "press") {
      target.focus();
      if (action.key === "Tab")
        throw new Error(
          "Tab traversal is not supported; select the next target from inspect",
        );
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: action.key,
          bubbles: true,
          cancelable: true,
        }),
      );
      target.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: action.key,
          bubbles: true,
          cancelable: true,
        }),
      );
    } else if (target && action.type === "upload") {
      if (!(target instanceof HTMLInputElement) || target.type !== "file")
        throw new Error("Target is not a file input");
      const bytes = Uint8Array.from(atob(action.base64), (c) =>
        c.charCodeAt(0),
      );
      if (bytes.length > 5_000_000) throw new Error("File exceeds 5 MB");
      const png =
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71;
      const jpg = bytes[0] === 255 && bytes[1] === 216;
      const webp =
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
      const mp4 = String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
      if (
        !{
          "image/png": png,
          "image/jpeg": jpg,
          "image/webp": webp,
          "video/mp4": mp4,
        }[action.mime_type]
      )
        throw new Error("File signature does not match MIME type");
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], action.filename, { type: action.mime_type }),
      );
      target.files = transfer.files;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (action.type === "scroll") {
      let el: HTMLElement | undefined = target;
      if (!el) {
        el = [
          ...document.querySelectorAll<HTMLElement>(
            '[role="grid"],[role="dialog"]',
          ),
        ].find((e) => visible(e) && e.scrollHeight > e.clientHeight + 2);
      }
      if (el) {
        let scroll: HTMLElement | null = el;
        while (scroll && scroll.scrollHeight <= scroll.clientHeight + 2)
          scroll = scroll.parentElement;
        if (scroll) scroll.scrollTop += action.delta_y;
        else window.scrollBy(0, action.delta_y);
      } else window.scrollBy(0, action.delta_y);
    }
    // Invalidate handles immediately. The next observation provides fresh targets.
    state.__metaCollectorControl = undefined;
    await new Promise((resolve) => setTimeout(resolve, 350));
    return {
      outcome: "dispatched",
      snapshot: inspect(),
      requires_verification: true,
    };
  } catch (error) {
    return {
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
      requires_verification: request.execute,
    };
  }
}
