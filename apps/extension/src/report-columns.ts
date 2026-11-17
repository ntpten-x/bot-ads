/** Only reporting preferences: no editor, ad state, budgets or publishing controls. */
export async function prepareReportColumns(options: {
  account: string;
  goal: "messages" | "sales" | "leads";
  fields?: ReportField[];
}) {
  const diagnostics: {
    dialog: string;
    checkbox_samples: {
      label: string;
      aria: string;
      item_visible: string;
      item_text: string;
    }[];
    searches: { label: string; placeholder: string }[];
    queries: string[];
  } = { dialog: "", checkbox_samples: [], searches: [], queries: [] };
  try {
    const started = Date.now(),
      deadline = started + 40000;
    const guard = () => {
      const u = new URL(location.href);
      if (
        !["adsmanager.facebook.com", "business.facebook.com"].includes(
          u.hostname,
        ) ||
        !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
        u.searchParams.get("act") !== options.account
      )
        throw new Error(
          "Reporting page or account changed; column setup stopped",
        );
    };
    const geometry = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
      let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
      let hidden = s.display === "none" || s.visibility === "hidden";
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const ps = getComputedStyle(parent), pr = parent.getBoundingClientRect();
        if (ps.display === "none" || ps.visibility === "hidden" || parent.getAttribute("aria-hidden") === "true") hidden = true;
        if (/^(hidden|clip|scroll|auto)$/.test(ps.overflowX)) {
          left = Math.max(left, pr.left + parent.clientLeft);
          right = Math.min(right, pr.left + parent.clientLeft + parent.clientWidth);
        }
        if (/^(hidden|clip|scroll|auto)$/.test(ps.overflowY)) {
          top = Math.max(top, pr.top + parent.clientTop);
          bottom = Math.min(bottom, pr.top + parent.clientTop + parent.clientHeight);
        }
      }
      return { visible: !hidden && r.width > 0 && r.height > 0 && right > left && bottom > top,
        x: (left + right) / 2, y: (top + bottom) / 2 };
    };
    const visible = (el: Element) => geometry(el).visible;
    const reachable = (el: HTMLElement) => {
      const g = geometry(el);
      if (!g.visible) return false;
      const hit = document.elementFromPoint(g.x, g.y), item = el.closest('li,[role="listitem"]');
      return !!hit && (el === hit || el.contains(hit) || !!item && item.contains(hit) &&
        item.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length === 1);
    };
    const text = (el: Element) =>
      (
        el.getAttribute("aria-label") ||
        (el instanceof HTMLElement ? el.innerText : el.textContent) ||
        ""
      )
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const wait = async (check: () => boolean, ms = 900) => {
      const end = Math.min(deadline, Date.now() + ms);
      while (Date.now() < end) {
        guard();
        if (check()) return true;
        await new Promise((r) => setTimeout(r, 75));
      }
      return check();
    };
    const controls = (root: ParentNode) =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'button,[role="button"],[role="menuitem"]',
        ),
      ].filter(visible);
    const custom =
      /^(?:customize columns|กำหนดคอลัมน์เอง|ปรับแต่งคอลัมน์)(?:\.{3}|…)?$/i;
    const getDialog = () =>
      [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .filter(visible)
        .find((d) => {
          const named = text(d);
          const headings = [...d.querySelectorAll('h1,h2,h3,[role="heading"]')];
          const labelled = (d.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter((e) => e !== null);
          return (
            custom.test(d.getAttribute("aria-label") ?? "") ||
            [...headings, ...labelled].some((h) => custom.test(text(h))) ||
            custom.test(named)
          );
        });
    guard();
    if (!getDialog()) {
      let customize = controls(document).filter((el) => custom.test(text(el)));
      if (!customize.length) {
        const openingMenu = controls(document).some(
          (el) =>
            el.getAttribute("role") === "menuitem" &&
            /^(loading|กำลังโหลด)/i.test(text(el)),
        );
        if (!openingMenu) {
          const button = controls(document).filter((el) =>
            /^(columns|คอลัมน์)\s*[:：]/i.test(text(el)),
          );
          if (button.length !== 1)
            throw new Error(
              "ไม่พบปุ่มคอลัมน์ที่ยืนยันได้ เปิดคอลัมน์ → กำหนดคอลัมน์เองใน Meta แล้วลองใหม่",
            );
          guard();
          button[0].click();
        }
        await wait(
          () => controls(document).some((el) => custom.test(text(el))),
          8000,
        );
        customize = controls(document).filter((el) => custom.test(text(el)));
      }
      if (customize.length !== 1)
        throw new Error("ไม่พบเมนูกำหนดคอลัมน์เองที่ยืนยันได้");
      guard();
      customize[0].click();
      if (!(await wait(() => !!getDialog(), 6000)))
        throw new Error("Meta ไม่เปิดหน้าตั้งคอลัมน์ที่รองรับ");
    }
    const fields = options.fields ?? [];
    if (!fields.length) throw new Error("Report field catalogue missing");
    const selected: string[] = [],
      missing: string[] = [];
    const label = (el: HTMLElement) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const ids = el.getAttribute("aria-labelledby");
      if (ids)
        return ids
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
      if (el instanceof HTMLInputElement) {
        const l = [...(el.labels ?? [])];
        if (l.length) return l.map(text).join(" ");
      }
      const item = el.closest('li,[role="listitem"]');
      if (
        item &&
        getDialog()?.contains(item) &&
        item.querySelectorAll('input[type="checkbox"],[role="checkbox"]')
          .length === 1
      )
        return text(item);
      return text(el);
    };
    const dialogBefore = getDialog()!;
    diagnostics.dialog = text(dialogBefore).slice(0, 120);
    diagnostics.checkbox_samples = [
      ...dialogBefore.querySelectorAll<HTMLElement>(
        'input[type="checkbox"],[role="checkbox"]',
      ),
    ]
      .filter(visible)
      .slice(0, 25)
      .map((el) => {
        const item = el.closest<HTMLElement>('li,[role="listitem"]');
        return {
          label: label(el).slice(0, 180),
          aria: el.getAttribute("aria-label") ?? "",
          item_visible: item?.innerText.slice(0, 180) ?? "",
          item_text: item?.textContent?.slice(0, 180) ?? "",
        };
      });
    diagnostics.searches = [
      ...dialogBefore.querySelectorAll<HTMLInputElement>("input"),
    ]
      .filter((el) => ["text", "search"].includes(el.type))
      .map((el) => ({ label: label(el), placeholder: el.placeholder }));
    for (const field of fields) {
      guard();
      if (Date.now() >= deadline) {
        missing.push(field.key);
        continue;
      }
      const matches = () => {
        const d = getDialog();
        if (!d) return [];
        return [
          ...d.querySelectorAll<HTMLElement>(
            'input[type="checkbox"],[role="checkbox"]',
          ),
        ].filter(
          (el) =>
            visible(el) &&
            field.labels.some(
              (l) =>
                label(el).replace(/\s+/g, " ").toLowerCase() ===
                l.toLowerCase(),
            ),
        );
      };
      let found = matches();
      if (!found.length) {
        const d = getDialog();
        if (!d) throw new Error("หน้าตั้งคอลัมน์ปิดก่อนเสร็จ");
        const searches = [
          ...d.querySelectorAll<HTMLInputElement>("input"),
        ].filter(
          (el) =>
            visible(el) &&
            ["text", "search"].includes(el.type) &&
            /search|ค้นหา/i.test(el.placeholder + " " + label(el)),
        );
        if (searches.length === 1) {
          for (const query of [
            field.labels[0],
            field.labels.find((l) => /[ก-๙]/.test(l)),
          ].filter((s): s is string => !!s)) {
            diagnostics.queries.push(query);
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )?.set;
            guard();
            setter?.call(searches[0], query);
            searches[0].dispatchEvent(new Event("input", { bubbles: true }));
            searches[0].dispatchEvent(new Event("change", { bubbles: true }));
            await wait(() => matches().length > 0, 450);
            found = matches();
            if (found.length) break;
          }
        }
      }
      if (found.length !== 1) {
        missing.push(field.key);
        continue;
      }
      const checkbox = found[0];
      if (!reachable(checkbox)) { missing.push(field.key); continue; }
      const checked =
        checkbox instanceof HTMLInputElement
          ? checkbox.checked
          : checkbox.getAttribute("aria-checked") === "true";
      if (!checked) {
        guard();
        checkbox.click();
        await wait(
          () =>
            checkbox instanceof HTMLInputElement
              ? checkbox.checked
              : checkbox.getAttribute("aria-checked") === "true",
          450,
        );
      }
      const after = matches();
      if (
        after.length === 1 && reachable(after[0]) &&
        (after[0] instanceof HTMLInputElement
          ? after[0].checked
          : after[0].getAttribute("aria-checked") === "true")
      )
        selected.push(field.key);
      else missing.push(field.key);
    }
    // Re-observe required checkboxes after all selection/search rerenders.
    // A field that was selected earlier may have been reverted by the UI.
    for (const field of fields.filter((f) => f.required && selected.includes(f.key))) {
      const matching = () => [...(getDialog()?.querySelectorAll<HTMLElement>(
        'input[type="checkbox"],[role="checkbox"]',
      ) ?? [])].filter((el) => visible(el) && field.labels.some(
        (l) => label(el).replace(/\s+/g, " ").toLowerCase() === l.toLowerCase(),
      ));
      let found = matching();
      if (!found.length) {
        const searches = [...(getDialog()?.querySelectorAll<HTMLInputElement>("input") ?? [])]
          .filter((el) => visible(el) && ["text", "search"].includes(el.type) && /search|ค้นหา/i.test(el.placeholder + " " + label(el)));
        if (searches.length === 1) for (const query of [...new Set([
          field.labels[0], field.labels.find((l) => /[ก-๙]/.test(l)),
        ].filter((s): s is string => !!s))]) {
          guard();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(searches[0], query);
          searches[0].dispatchEvent(new Event("input", { bubbles: true }));
          searches[0].dispatchEvent(new Event("change", { bubbles: true }));
          await wait(() => matching().length > 0, 450);
          found = matching();
          if (found.length) break;
        }
      }
      if (found.length !== 1 || !reachable(found[0]) || !(found[0] instanceof HTMLInputElement
        ? found[0].checked : found[0].getAttribute("aria-checked") === "true")) {
        selected.splice(selected.indexOf(field.key), 1);
        if (!missing.includes(field.key)) missing.push(field.key);
      }
    }
    const blocking = (field: ReportField) =>
      field.blocking ?? field.required;
    if (!selected.length || fields.some((f) => blocking(f) && !selected.includes(f.key)))
      return {
        ok: false as const,
        error: "คอลัมน์จำเป็นยังเลือกไม่ครบหรือยืนยันสถานะไม่ได้ จึงไม่บันทึกมุมมองรายงาน",
        goal: options.goal,
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
        applied: false,
        diagnostics,
        warning:
          "Required selections are incomplete; report preferences were not saved.",
      };
    const dialog = getDialog();
    if (!dialog) throw new Error("หน้าตั้งคอลัมน์ปิดก่อนตรวจผล");
    const apply = controls(dialog).filter(
      (el) =>
        /^(apply|save|นำไปใช้|ใช้|บันทึก)$/i.test(text(el)) &&
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-disabled") !== "true",
    );
    if (apply.length !== 1)
      throw new Error("เลือกคอลัมน์แล้ว แต่ไม่พบปุ่มนำไปใช้ที่ยืนยันได้ ตรวจหน้าต่าง Meta");
    guard();
    apply[0].click();
    const applied = await wait(() => !getDialog(), 1500);
    return {
      diagnostics,
      ok: true as const,
      goal: options.goal,
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
      applied,
      warning:
        "Only visible reporting preferences changed. Verify headers and exported values; missing fields were not invented.",
    };
  } catch (error) {
    return {
      diagnostics,
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
      goal: options.goal,
      selected: [] as string[],
      missing: [] as string[],
      missing_required: [] as string[],
      missing_goal_metrics: [] as string[],
      applied: false,
      warning: "Column setup stopped; review the visible Meta dialog.",
    };
  }
}

export type ReportField = {
  key: string;
  labels: string[];
  /** Read-only aliases used when matching rendered table headers. */
  header_labels?: string[];
  /** Search-only aliases. Exact labels still decide which checkbox is selected. */
  search_terms?: string[];
  /** Context terms that identify a similarly named but unrelated option. */
  exclude_terms?: string[];
  /** Preferred surrounding context when Meta renders more than one exact label. */
  prefer_terms?: string[];
  /** Only match an already-checked choice. Used when pruning a specific column. */
  checked_only?: boolean;
  required: boolean;
  /** Required for a trustworthy reporting view before Save. Goal-only metrics
   * may be reported missing without blocking a read-only capture. */
  blocking?: boolean;
};
export function getReportFields(goal: "messages" | "sales" | "leads") {
  const fields: ReportField[] = [
    {
      // The account is verified from the bound reporting URL on every input.
      // Meta does not offer this optional display column in every layout.
      key: "account_id",
      labels: ["Account ID", "ID บัญชีโฆษณา", "รหัสบัญชีโฆษณา"],
      required: false,
    },
    {
      key: "campaign_name",
      labels: ["Campaign name", "ชื่อแคมเปญ"],
      header_labels: ["Campaign", "แคมเปญ"],
      required: true,
      blocking: true,
    },
    {
      key: "ad_set_name",
      labels: ["Ad set name", "ชื่อชุดโฆษณา"],
      header_labels: ["Ad set", "ชุดโฆษณา"],
      required: false,
    },
    {
      key: "ad_name",
      labels: ["Ad name", "ชื่อโฆษณา"],
      header_labels: ["Ad", "โฆษณา"],
      required: false,
    },
    { key: "budget", labels: ["Budget", "งบประมาณ"], required: false },
    {
      key: "campaign_id",
      labels: ["Campaign ID", "ID แคมเปญ", "รหัสแคมเปญ"],
      required: true,
      blocking: true,
    },
    {
      key: "ad_set_id",
      labels: ["Ad set ID", "ID ชุดโฆษณา", "รหัสชุดโฆษณา"],
      required: true,
      blocking: true,
    },
    {
      key: "ad_id",
      labels: ["Ad ID", "ID โฆษณา", "รหัสโฆษณา"],
      required: true,
      blocking: true,
    },
    {
      key: "spend",
      labels: ["Amount spent", "จำนวนเงินที่ใช้จ่ายไป", "จำนวนเงินที่ใช้ไป"],
      header_labels: ["Amount spent", "ยอดใช้จ่าย", "จำนวนเงินที่ใช้จ่ายไป"],
      search_terms: ["ใช้จ่าย", "Amount spent"],
      exclude_terms: ["เป็นเปอร์เซ็นต์", "percentage"],
      prefer_terms: ["ผลลัพธ์และการใช้จ่าย", "เงินใช้จ่าย"],
      required: true,
      blocking: true,
    },
    {
      key: "impressions",
      labels: ["Impressions", "อิมเพรสชัน"],
      required: true,
      blocking: true,
    },
    {
      key: "link_clicks",
      labels: ["Link clicks", "การคลิกลิงก์"],
      search_terms: ["คลิกลิงก์", "Link clicks"],
      required: true,
      blocking: false,
    },
    { key: "reach", labels: ["Reach", "การเข้าถึง"], required: false },
    { key: "frequency", labels: ["Frequency", "ความถี่"], required: false },
    {
      key: "results",
      labels: ["Results", "ผลลัพธ์"],
      header_labels: ["Results", "ผลลัพธ์"],
      exclude_terms: ["ROAS", "ผลตอบแทนจากค่าใช้จ่ายในการโฆษณา"],
      prefer_terms: ["ผลลัพธ์และการใช้จ่าย"],
      required: true,
      blocking: true,
    },
    {
      key: "cost_per_result",
      labels: ["Cost per result", "ต้นทุนต่อผลลัพธ์"],
      header_labels: ["Cost per result", "ต้นทุนต่อผลลัพธ์"],
      required: true,
      blocking: true,
    },
    {
      key: "link_ctr",
      labels: ["CTR (link click-through rate)", "CTR (อัตราการคลิกผ่านลิงก์)"],
      required: false,
    },
    {
      key: "link_cpc",
      labels: ["CPC (cost per link click)", "CPC (ต้นทุนต่อการคลิกลิงก์)"],
      required: false,
    },
    {
      key: "cpm",
      labels: [
        "CPM (cost per 1,000 impressions)",
        "CPM (ต้นทุนต่ออิมเพรสชัน 1,000 ครั้ง)",
      ],
      required: false,
    },
    {
      key: "attribution",
      labels: ["Attribution setting", "การตั้งค่าการระบุที่มา"],
      header_labels: [
        "Attribution setting",
        "การตั้งค่าการระบุที่มา",
        "การตั้งค่าการกำหนดแอตทริบิวชัน",
      ],
      required: true,
      blocking: true,
    },
  ];
  if (goal === "messages")
    fields.push({
      key: "messaging_conversations",
      labels: ["Messaging conversations started", "การส่งข้อความเพื่อเริ่มการสนทนา"],
      search_terms: ["ส่งข้อความ", "Messaging conversations"],
      required: true,
      blocking: false,
    });
  if (goal === "leads")
    fields.push({
      key: "leads",
      labels: ["Leads", "ลูกค้าเป้าหมาย"],
      required: true,
      blocking: false,
    });
  if (goal === "sales")
    fields.push(
      {
        key: "purchases",
        labels: ["Purchases", "การซื้อ"],
        required: true,
        blocking: false,
      },
      {
        key: "purchase_value",
        labels: [
          "Purchases conversion value",
          "Purchase conversion value",
          "ค่าคอนเวอร์ชั่นการซื้อ",
          "มูลค่าคอนเวอร์ชั่นการซื้อ",
        ],
        required: true,
        blocking: false,
      },
      {
        key: "landing_page_views",
        labels: ["Landing page views", "การดูแลนดิ้งเพจ"],
        required: false,
      },
    );
  fields.sort((a, b) => Number(b.required) - Number(a.required));

  return fields;
}
