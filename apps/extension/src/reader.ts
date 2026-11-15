// Executed in the isolated world. Never accesses cookies, page JS state or network APIs.
export function readVisibleTable() {
  const url = new URL(location.href);
  if (
    !["adsmanager.facebook.com", "business.facebook.com"].includes(
      url.hostname,
    ) ||
    !url.pathname.startsWith("/adsmanager/")
  )
    throw new Error("Open an Ads Manager reporting page");
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
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
  const headerReadable=(el:Element)=>{
    if(!visible(el))return false;const r=el.getBoundingClientRect();const x=Math.max(1,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(1,Math.min(innerHeight-1,r.top+r.height/2));
    const hit=document.elementFromPoint(x,y);return !!hit&&(el===hit||el.contains(hit));
  };
  const grids = [
    ...document.querySelectorAll('[role="grid"],[role="treegrid"],table'),
  ].filter(visible);
  const tables = grids
    .map((grid) => {
      const headers = [
        ...grid.querySelectorAll('[role="columnheader"],thead th'),
      ]
        .filter(headerReadable)
        .map((el) => (el as HTMLElement).innerText.trim());
      const rows = [...grid.querySelectorAll('[role="row"],tbody tr')]
        .filter(visible)
        .map((row) =>
          [
            ...row.querySelectorAll(
              '[role="gridcell"],[role="cell"],[role="rowheader"],td,th',
            ),
          ]
            .filter(visible)
            .map((el) => (el as HTMLElement).innerText.trim()),
        )
        .filter((row) => row.length);
      return { headers, rows };
    })
    .filter((t) => t.rows.length);
  const warnings = [
    "Only visible cells captured. Hidden columns, virtualized rows, date range and attribution require verification.",
  ];
  let unstructured: {
    headers: string[];
    viewport_text: string;
    entity_labels: string[];
  } | null = null;
  if (!tables.length) {
    // Preserve visible reporting text if Meta exposes headers without grid/row wrappers.
    // Never invent row relationships or assign numbers to metrics from this fallback.
    const headers = [
      ...document.querySelectorAll<HTMLElement>('[role="columnheader"]'),
    ].filter(headerReadable);
    if (headers.length >= 2) {
      let common: HTMLElement | null = headers[0].parentElement;
      while (common && !headers.every((h) => common!.contains(h)))
        common = common.parentElement;
      let container = common;
      const markerSelector = '[role="switch"],[role="gridcell"],[role="cell"]';
      while (container && container !== document.body) {
        const markers = [
          ...container.querySelectorAll<HTMLElement>(markerSelector),
        ].filter((el) => visible(el) && !el.closest('[role="columnheader"]'));
        if (markers.length) {
          const parts: string[] = [];
          let length = 0;
          const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
          );
          while (walker.nextNode() && length < 40000) {
            const parent = walker.currentNode.parentElement;
            if (
              !parent ||
              !visible(parent) ||
              parent.closest(
                'script,style,noscript,input,textarea,[contenteditable="true"]',
              )
            )
              continue;
            const value = walker.currentNode.textContent?.trim();
            if (value) {
              parts.push(value);
              length += value.length;
            }
          }
          const text = parts.join("\n").slice(0, 40000);
          if (text)
            unstructured = {
              headers: headers.map((h) => h.innerText.trim()),
              viewport_text: text,
              entity_labels: [
                ...new Set(
                  [
                    ...container.querySelectorAll<HTMLElement>(
                      'a[href],[role="link"]',
                    ),
                  ]
                    .filter(visible)
                    .map((el) => el.innerText.trim())
                    .filter(Boolean),
                ),
              ],
            };
          break;
        }
        container = container.parentElement;
      }
    }
    if (unstructured)
      warnings.push(
        "Visible text fallback: row/column relationships are unverified. Do not normalize metrics from this capture.",
      );
  }
  // Keep each visible cell attached to its observed row and source header.
  // Geometry is evidence for review, never an assertion of stable identity.
  const observedHeaders = [
    ...document.querySelectorAll<HTMLElement>('[role="columnheader"],thead th'),
  ]
    .filter(headerReadable)
    .map((el) => ({
      label: el.innerText.trim(),
      rect: el.getBoundingClientRect(),
    }));
  const row_observations: {
    identity: string | null;
    name: string | null;
    method: "semantic" | "geometry";
    cells: { header: string; text: string }[];
    warnings: string[];
  }[] = [];
  const entityId = (row: Element) => {
    const ids = new Set<string>();
    const param = url.pathname.endsWith("/ads")
      ? "selected_ad_ids"
      : url.pathname.endsWith("/adsets")
        ? "selected_adset_ids"
        : "selected_campaign_ids";
    for (const a of row.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      try {
        const target = new URL(a.href);
        const id = target.searchParams.get(param);
        if (target.hostname === url.hostname && id && /^\d+$/.test(id))
          ids.add(id);
      } catch {
        /* Non-URL anchors are not IDs. */
      }
    }
    return ids.size === 1 ? [...ids][0] : null;
  };
  for (const grid of grids) {
    const headers = [
      ...grid.querySelectorAll<HTMLElement>('[role="columnheader"],thead th'),
    ].filter(visible);
    for (const row of [
      ...grid.querySelectorAll('[role="row"],tbody tr'),
    ].filter(visible)) {
      const cells = [
        ...row.querySelectorAll<HTMLElement>(
          '[role="gridcell"],[role="cell"],[role="rowheader"],td',
        ),
      ].filter(visible);
      if (!cells.length || !headers.length) continue;
      const aligned = cells.map((cell) => {
        const cr = cell.getBoundingClientRect();
        const matches = headers.filter((h) => {
          const hr = h.getBoundingClientRect();
          return cr.left >= hr.left - 2 && cr.right <= hr.right + 2;
        });
        return matches.length === 1
          ? { header: matches[0].innerText.trim(), text: cell.innerText.trim() }
          : null;
      });
      if (aligned.some((c) => !c)) continue;
      row_observations.push({
        identity: entityId(row),
        name: null,
        method: "semantic",
        cells: aligned.filter((c) => c !== null),
        warnings: [
          "Only visible cells; reporting context and identity require verification.",
        ],
      });
    }
  }
  if (!row_observations.length && unstructured && observedHeaders.length >= 2) {
    let scope: Element | null =
      document.querySelector('[role="columnheader"]')?.parentElement ?? null;
    while (
      scope &&
      !observedHeaders.every((h) =>
        [...scope!.querySelectorAll<HTMLElement>('[role="columnheader"]')].some(
          (el) => el.innerText.trim() === h.label,
        ),
      )
    )
      scope = scope.parentElement;
    while (
      scope &&
      scope !== document.body &&
      ![...scope.querySelectorAll('[role="switch"]')].some(visible)
    )
      scope = scope.parentElement;
    if (scope && scope !== document.body) {
      const anchors = [
        ...scope.querySelectorAll<HTMLElement>('[role="switch"]'),
      ]
        .filter(visible)
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.top - b.rect.top);
      const centers = anchors.map((a) => a.rect.top + a.rect.height / 2);
      const bands=centers.map((y,i)=>{
        let row:Element|null=anchors[i].el.parentElement;
        while(row&&row!==scope){const r=row.getBoundingClientRect();
          if(r.width>200&&r.height>=24&&r.height<=150&&row.querySelectorAll('[role="switch"]').length===1)return {top:r.top,bottom:r.bottom};
          row=row.parentElement;}
        return {top:i?(centers[i-1]+y)/2:y-24,bottom:i<centers.length-1?(y+centers[i+1])/2:y+24};
      });
      const cells = anchors.map(() => new Map<string, string[]>());
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode,
          parent = node.parentElement,
          text = node.textContent?.trim();
        if (
          !parent ||
          !text ||
          !visible(parent) ||
          parent.closest(
            'script,style,noscript,input,textarea,[contenteditable="true"],[role="columnheader"]',
          )
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (
          r.width <= 0 ||
          r.height <= 0 ||
          r.top < 0 ||
          r.bottom > innerHeight ||
          r.left < 0 ||
          r.right > innerWidth
        )
          continue;
        let left=r.left,right=r.right,top=r.top,bottom=r.bottom;
        for(let ancestor:Element|null=parent;ancestor&&ancestor!==scope.parentElement;ancestor=ancestor.parentElement){
          const style=getComputedStyle(ancestor),clip=ancestor.getBoundingClientRect();
          if(['hidden','auto','scroll','clip'].includes(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
          if(['hidden','auto','scroll','clip'].includes(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
        }
        if(right-left<1||bottom-top<1)continue;
        const row=bands.findIndex(b=>top>=b.top&&bottom<=b.bottom);
        const headers=observedHeaders.filter(h=>left>=h.rect.left-2&&right<=h.rect.right+2);
        if (row < 0 || headers.length !== 1) continue;
        const h = headers[0].label,
          parts = cells[row].get(h) ?? [];
        parts.push(text);
        cells[row].set(h, parts);
      }
      const nameHeader = observedHeaders.find((h) =>
        /^(campaign|ad set|ad|แคมเปญ|ชุดโฆษณา|โฆษณา)$/i.test(h.label),
      );
      cells.forEach((map, i) => {
        if (!map.size) return;
        row_observations.push({
          identity: null,
          name: nameHeader
            ? (map.get(nameHeader.label)?.join("\n") ?? null)
            : null,
          method: "geometry",
          cells: [...map].map(([header, parts]) => ({
            header,
            text: parts.join("\n"),
          })),
          warnings: [
            "Unverified geometric alignment. Duplicate names are not stable IDs; do not join captures by name.",
          ],
        });
      });
    }
  }
  const buttons = [
    ...document.querySelectorAll<HTMLElement>('button,[role="button"]'),
  ]
    .filter(visible)
    .map((b) => b.innerText.trim());
  return {
    account_id: url.searchParams.get("act"),
    reader_version: "0.5.0",
    page: url.pathname,
    captured_at: new Date().toISOString(),
    tables,
    row_observations,
    format: tables.length ? "structured" : "visible_text_fallback",
    unstructured,
    reporting_context: {
      date_range_label:
        buttons.find((s) =>
          /วันที่ผ่านมา|วันนี้|เมื่อวาน|last\s+\d+\s+days|today|yesterday/i.test(s),
        ) ?? null,
      column_preset_label:
        buttons.find((s) => /^(คอลัมน์|columns)\s*:/i.test(s)) ?? null,
      attribution: "unverified",
      timezone: "unverified",
      currency: "unverified",
    },
    coverage: "visible_only",
    warnings,
  };
}
export function scrollReportingTable(
  direction: "vertical" | "horizontal" | "reset_horizontal" = "vertical",
) {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth
    );
  };
  const headers = [
    ...document.querySelectorAll('[role="columnheader"],thead th'),
  ];
  if (!headers.length) return false;
  let scope: Element | null = headers[0].parentElement;
  while (scope && !headers.every((h) => scope!.contains(h)))
    scope = scope.parentElement;
  const horizontal = direction !== "vertical";
  while (
    scope &&
    scope !== document.body &&
    scope !== document.documentElement
  ) {
    const candidates = [scope, ...scope.querySelectorAll("*")].filter((el) => {
      if (!visible(el)) return false;
      const style = getComputedStyle(el);
      return horizontal
        ? el.scrollWidth > el.clientWidth + 2 &&
            ["auto", "scroll"].includes(style.overflowX)
        : el.scrollHeight > el.clientHeight + 2 &&
            ["auto", "scroll"].includes(style.overflowY);
    });
    // A reporting scroller must contain headers or row controls, not a toolbar dropdown.
    const scroller = candidates.find(
      (el) =>
        headers.some((h) => el.contains(h)) ||
        el.querySelector(
          '[role="switch"],[role="row"],[role="gridcell"],[role="cell"]',
        ),
    );
    if (scroller) {
      const before = horizontal ? scroller.scrollLeft : scroller.scrollTop;
      if (direction === "reset_horizontal") scroller.scrollLeft = 0;
      else if (horizontal)
        scroller.scrollLeft += Math.max(100, scroller.clientWidth * 0.7);
      else scroller.scrollTop += Math.max(100, scroller.clientHeight * 0.7);
      return horizontal
        ? scroller.scrollLeft !== before
        : scroller.scrollTop !== before;
    }
    scope = scope.parentElement;
  }
  return false;
}
