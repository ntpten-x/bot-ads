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
  // A header is readable when the page hit-test lands on it. Overlays such as
  // tooltips or toasts can cover header centres; then fall back to headers that
  // are at least half visible inside every clipping ancestor.
  const hitReadable = (el: Element) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    const x = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2)),
      y = Math.max(1, Math.min(innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el === hit || el.contains(hit));
  };
  const clipReadable = (el: Element) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    let left = Math.max(0, r.left),
      right = Math.min(innerWidth, r.right),
      top = Math.max(0, r.top),
      bottom = Math.min(innerHeight, r.bottom);
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a),
        c = a.getBoundingClientRect();
      if (s.overflowX !== "visible") {
        left = Math.max(left, c.left);
        right = Math.min(right, c.right);
      }
      if (s.overflowY !== "visible") {
        top = Math.max(top, c.top);
        bottom = Math.min(bottom, c.bottom);
      }
    }
    return right - left >= r.width * 0.5 && bottom - top >= r.height * 0.5;
  };
  const allHeaderEls = [
    ...document.querySelectorAll('[role="columnheader"],thead th'),
  ];
  const headerMode: "hit_test" | "clip" =
    allHeaderEls.filter(hitReadable).length >= 2 ||
    allHeaderEls.filter(clipReadable).length < 2
      ? "hit_test"
      : "clip";
  const headerReadable = (el: Element) =>
    headerMode === "hit_test" ? hitReadable(el) : clipReadable(el);
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
  if (headerMode === "clip")
    warnings.push(
      "Column headers were covered at their centre; headers read from clipped visibility instead of hit-testing.",
    );
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
      const markerSelector =
        '[role="switch"],[role="gridcell"],[role="cell"],input[type="checkbox"],[role="checkbox"]';
      while (container && container !== document.body) {
        const markers = [
          ...container.querySelectorAll<HTMLElement>(markerSelector),
        ].filter((el) => {
          if (!visible(el) || el.closest('[role="columnheader"]')) return false;
          // The header select-all checkbox is not a row marker.
          const r = el.getBoundingClientRect();
          return (
            r.top + r.height / 2 >
            Math.max(...headers.map((h) => h.getBoundingClientRect().bottom))
          );
        });
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
  // Keep each visible cell attached to its observed row and source header.
  // Geometry is evidence for review; stable identity only comes from IDs exposed in the DOM.
  const observedHeaders = [
    ...document.querySelectorAll<HTMLElement>('[role="columnheader"],thead th'),
  ]
    .filter(headerReadable)
    .map((el) => ({
      label: el.innerText.trim(),
      rect: el.getBoundingClientRect(),
    }))
    .filter(
      // Sticky clones can render the same header twice at the same place.
      (h, i, all) =>
        all.findIndex(
          (o) =>
            o.label === h.label &&
            Math.abs(o.rect.left - h.rect.left) < 1 &&
            Math.abs(o.rect.top - h.rect.top) < 1,
        ) === i,
    );
  const headersBottom = observedHeaders.length
    ? Math.max(...observedHeaders.map((h) => h.rect.bottom))
    : 0;
  const level = url.pathname.replace(/\/$/, "").endsWith("/ads")
    ? "ads"
    : url.pathname.replace(/\/$/, "").endsWith("/adsets")
      ? "adsets"
      : "campaigns";
  const ownParam = {
    campaigns: "selected_campaign_ids",
    adsets: "selected_adset_ids",
    ads: "selected_ad_ids",
  }[level];
  const nameHeaderPattern = {
    campaigns: /^(campaign|campaign name|แคมเปญ|ชื่อแคมเปญ)$/i,
    adsets: /^(ad set|ad set name|ชุดโฆษณา|ชื่อชุดโฆษณา)$/i,
    ads: /^(ad|ad name|โฆษณา|ชื่อโฆษณา)$/i,
  }[level];
  const idHeaderPattern = {
    campaigns: /^(campaign id|id แคมเปญ|รหัสแคมเปญ)$/i,
    adsets: /^(ad set id|id ชุดโฆษณา|รหัสชุดโฆษณา)$/i,
    ads: /^(ad id|id โฆษณา|รหัสโฆษณา)$/i,
  }[level];
  // Read IDs only from href query parameters of visible links on our own host.
  const singleId = (target: URL, param: string) => {
    const value = target.searchParams.get(param);
    return value && /^\d+$/.test(value) ? value : null;
  };
  const linkIds = (anchors: HTMLAnchorElement[]) => {
    const own = new Set<string>(),
      campaign = new Set<string>(),
      adset = new Set<string>();
    const links: { id: string; rect: DOMRect }[] = [];
    for (const a of anchors) {
      let target: URL;
      try {
        target = new URL(a.href);
      } catch {
        continue; // Non-URL anchors are not IDs.
      }
      if (target.hostname !== url.hostname) continue;
      const act = target.searchParams.get("act");
      if (act && act !== url.searchParams.get("act")) continue;
      const id = singleId(target, ownParam);
      if (id) {
        own.add(id);
        links.push({ id, rect: a.getBoundingClientRect() });
      }
      if (level !== "campaigns") {
        const c = singleId(target, "selected_campaign_ids");
        if (c) campaign.add(c);
      }
      if (level === "ads") {
        const s = singleId(target, "selected_adset_ids");
        if (s) adset.add(s);
      }
    }
    return {
      id: own.size === 1 ? [...own][0] : null,
      conflict: own.size > 1,
      links,
      parent_ids: {
        campaign_id: campaign.size === 1 ? [...campaign][0] : null,
        ad_set_id: adset.size === 1 ? [...adset][0] : null,
      },
    };
  };
  type Observation = {
    identity: string | null;
    identity_source: "row_link_href" | "id_column" | null;
    parent_ids: { campaign_id: string | null; ad_set_id: string | null };
    name: string | null;
    method: "semantic" | "geometry";
    column_mapping: "semantic" | "verified_geometry" | "unverified";
    cells: { header: string; text: string }[];
    warnings: string[];
  };
  const row_observations: Observation[] = [];
  // Row counts Meta prints in the summary row ("ผลลัพธ์จาก 40 ชิ้น", "Results from 8 campaigns").
  const reportedTotals = new Set<number>();
  const resolveIdentity = (
    found: ReturnType<typeof linkIds>,
    cells: { header: string; text: string }[],
    rowWarnings: string[],
  ) => {
    const idCell = cells.find((c) => idHeaderPattern.test(c.header));
    const columnId =
      idCell && /^\d+$/.test(idCell.text.trim()) ? idCell.text.trim() : null;
    if (found.conflict) rowWarnings.push("Row links expose more than one ID; identity left unverified.");
    if (columnId && found.id && columnId !== found.id) {
      rowWarnings.push("ID column and row link disagree; identity left unverified.");
      return { identity: null, identity_source: null };
    }
    if (found.id) return { identity: found.id, identity_source: "row_link_href" as const };
    if (columnId) return { identity: columnId, identity_source: "id_column" as const };
    return { identity: null, identity_source: null };
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
      const rowCells = aligned.filter((c) => c !== null);
      const rowWarnings = [
        "Only visible cells; reporting context requires verification.",
      ];
      const found = linkIds([...row.querySelectorAll<HTMLAnchorElement>("a[href]")]);
      const identity = resolveIdentity(found, rowCells, rowWarnings);
      row_observations.push({
        ...identity,
        parent_ids: found.parent_ids,
        name:
          rowCells.find((c) => nameHeaderPattern.test(c.header))?.text.split("\n")[0] ??
          null,
        method: "semantic",
        column_mapping: "semantic",
        cells: rowCells,
        warnings: rowWarnings,
      });
    }
  }
  // Header/body alignment: Meta renders headers and rows in separate horizontal
  // scrollers. If their offsets differ, geometric column mapping is invalid.
  let column_alignment: "aligned" | "mismatch" | "not_applicable" = "not_applicable";
  const rowMarkerSelector =
    '[role="switch"],input[type="checkbox"],[role="checkbox"],[role="row"],[role="gridcell"]';
  if (observedHeaders.length >= 2) {
    const headerEls = [
      ...document.querySelectorAll<HTMLElement>('[role="columnheader"]'),
    ];
    const scrollers = [...document.querySelectorAll<HTMLElement>("*")].filter(
      (el) =>
        el.scrollWidth > el.clientWidth + 2 &&
        ["auto", "scroll", "hidden"].includes(getComputedStyle(el).overflowX) &&
        visible(el),
    );
    const headerScrollers = scrollers.filter((el) =>
      headerEls.some((h) => el.contains(h)),
    );
    const bodyScrollers = scrollers.filter(
      (el) =>
        !headerEls.some((h) => el.contains(h)) &&
        [...el.querySelectorAll(rowMarkerSelector)].some(
          (m) => !m.closest('[role="columnheader"]'),
        ),
    );
    column_alignment = "aligned";
    for (const h of headerScrollers)
      for (const b of bodyScrollers)
        if (Math.abs(h.scrollLeft - b.scrollLeft) > 1) column_alignment = "mismatch";
    if (column_alignment === "mismatch")
      warnings.push(
        "Header and body scroll offsets differ; column mapping is rejected for this capture.",
      );
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
    // Row anchors: on/off switches, otherwise row selection checkboxes. Both sit
    // below the header row; the header select-all checkbox is excluded.
    const markersIn = (root: Element, selector: string) =>
      [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => {
        if (!visible(el) || el.closest('[role="columnheader"]')) return false;
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 > headersBottom;
      });
    const anchorKinds = ['[role="switch"]', 'input[type="checkbox"],[role="checkbox"]'];
    let anchorSelector = anchorKinds[0];
    while (scope && scope !== document.body) {
      const kind = anchorKinds.find((k) => markersIn(scope!, k).length);
      if (kind) {
        anchorSelector = kind;
        break;
      }
      scope = scope.parentElement;
    }
    if (anchorSelector !== anchorKinds[0])
      warnings.push("Rows anchored by selection checkboxes because no on/off switches were visible.");
    if (scope && scope !== document.body) {
      const anchors = markersIn(scope, anchorSelector)
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.top - b.rect.top)
        .filter(
          (a, i, all) => i === 0 || Math.abs(a.rect.top - all[i - 1].rect.top) > 4,
        );
      const centers = anchors.map((a) => a.rect.top + a.rect.height / 2);
      const bands = centers.map((y, i) => {
        let row: Element | null = anchors[i].el.parentElement;
        while (row && row !== scope) {
          const r = row.getBoundingClientRect();
          if (
            r.width > 200 &&
            r.height >= 24 &&
            r.height <= 150 &&
            markersIn(row, anchorSelector).length === 1
          )
            return { top: r.top, bottom: r.bottom };
          row = row.parentElement;
        }
        return {
          top: i ? (centers[i - 1] + y) / 2 : y - 24,
          bottom: i < centers.length - 1 ? (y + centers[i + 1]) / 2 : y + 24,
        };
      });
      // Meta renders a summary row under the last entity row. Its label and
      // totals must never join a row band; its row count is kept for coverage.
      const footerPattern =
        /^(?:ผลลัพธ์จาก\s*(?:โฆษณา|แคมเปญ|ชุดโฆษณา)?\s*([\d,]+)|results from\s+([\d,]+))/i;
      const footers: { top: number; bottom: number }[] = [];
      const footerWalker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (footerWalker.nextNode()) {
        const parent = footerWalker.currentNode.parentElement;
        const m = footerPattern.exec(footerWalker.currentNode.textContent?.trim() ?? "");
        if (!m || !parent || !visible(parent)) continue;
        const count = Number((m[1] ?? m[2]).replaceAll(",", ""));
        if (Number.isInteger(count)) reportedTotals.add(count);
        // Start from the text itself: Meta's sticky summary row can be positioned
        // outside its wrappers, so only ancestors that really contain it count.
        const range = document.createRange();
        range.selectNodeContents(footerWalker.currentNode);
        const own = range.getBoundingClientRect();
        let rect = { top: own.top - 2, bottom: own.bottom + 2 };
        for (let a: Element | null = parent; a && a !== scope; a = a.parentElement) {
          const r = a.getBoundingClientRect();
          if (r.height > 150 || markersIn(a, anchorSelector).length) break;
          if (r.top <= own.top && r.bottom >= own.bottom)
            rect = { top: Math.min(rect.top, r.top), bottom: Math.max(rect.bottom, r.bottom) };
        }
        footers.push(rect);
      }
      for (const band of bands)
        for (const f of footers)
          if (band.top < f.top && band.bottom > f.top) band.bottom = f.top;
      const inFooter = (top: number, bottom: number) =>
        footers.some((f) => (top + bottom) / 2 >= f.top && (top + bottom) / 2 <= f.bottom);
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
        let left = r.left,
          right = r.right,
          top = r.top,
          bottom = r.bottom;
        for (
          let ancestor: Element | null = parent;
          ancestor && ancestor !== scope.parentElement;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor),
            clip = ancestor.getBoundingClientRect();
          if (["hidden", "auto", "scroll", "clip"].includes(style.overflowX)) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (["hidden", "auto", "scroll", "clip"].includes(style.overflowY)) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        if (
          right - left < 1 ||
          bottom - top < 1 ||
          inFooter(top, bottom) ||
          footerPattern.test(text)
        )
          continue;
        const row = bands.findIndex((b) => top >= b.top && bottom <= b.bottom);
        const headers = observedHeaders.filter(
          (h) => left >= h.rect.left - 2 && right <= h.rect.right + 2,
        );
        if (row < 0 || headers.length !== 1) continue;
        const h = headers[0].label,
          parts = cells[row].get(h) ?? [];
        parts.push(text);
        cells[row].set(h, parts);
      }
      const nameHeader =
        observedHeaders.find((h) => nameHeaderPattern.test(h.label)) ??
        observedHeaders.find((h) =>
          /^(campaign|ad set|ad|แคมเปญ|ชุดโฆษณา|โฆษณา)$/i.test(h.label),
        );
      const scopeLinks = [...scope.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .filter(visible)
        .map((a) => ({ a, rect: a.getBoundingClientRect() }));
      cells.forEach((map, i) => {
        if (!map.size) return;
        const band = bands[i];
        const rowLinks = scopeLinks
          .filter(({ rect }) => {
            const y = rect.top + rect.height / 2;
            return y >= band.top && y <= band.bottom;
          })
          .map(({ a }) => a);
        // Row hover buttons (แก้ไข / สร้างซ้ำ / แผนภูมิ / วิเคราะห์) are not part of the name.
        const hoverAction =
          /^(แก้ไข|สร้างซ้ำ|แผนภูมิ|ดูแผนภูมิ|วิเคราะห์|เปรียบเทียบ|edit|duplicate|charts?|view charts|analy[sz]e|compare)$/i;
        const rowCells = [...map].map(([header, parts]) => ({
          header,
          text: (nameHeader && header === nameHeader.label
            ? parts.filter((p, i) => i === 0 || !hoverAction.test(p))
            : parts
          ).join("\n"),
        }));
        const rowWarnings = [
          "Geometric alignment; duplicate names are not stable IDs. Do not join captures by name.",
        ];
        const found = linkIds(rowLinks);
        const identity = resolveIdentity(found, rowCells, rowWarnings);
        // The ID-bearing link must sit inside the name column of this row band;
        // that ties the row band, the name column and the ID together.
        const linkInName =
          !!nameHeader &&
          !!identity.identity &&
          found.links.some(
            (l) =>
              l.id === identity.identity &&
              l.rect.left + l.rect.width / 2 >= nameHeader.rect.left - 2 &&
              l.rect.left + l.rect.width / 2 <= nameHeader.rect.right + 2,
          );
        const idColumnOk =
          identity.identity_source === "id_column" && !!nameHeader && map.has(nameHeader.label);
        const column_mapping =
          column_alignment !== "mismatch" && (linkInName || idColumnOk)
            ? ("verified_geometry" as const)
            : ("unverified" as const);
        if (column_mapping === "unverified")
          rowWarnings.push("Column mapping unverified for this row.");
        row_observations.push({
          ...identity,
          parent_ids: found.parent_ids,
          name: nameHeader
            ? (map.get(nameHeader.label)?.[0] ?? null)
            : null,
          method: "geometry",
          column_mapping,
          cells: rowCells,
          warnings: rowWarnings,
        });
      });
    }
  }
  // IDs repeated across rows of one snapshot are not stable identities.
  const idCounts = new Map<string, number>();
  for (const r of row_observations)
    if (r.identity) idCounts.set(r.identity, (idCounts.get(r.identity) ?? 0) + 1);
  for (const r of row_observations)
    if (r.identity && (idCounts.get(r.identity) ?? 0) > 1) {
      r.identity = null;
      r.identity_source = null;
      r.warnings.push("Same ID seen on more than one row; identity left unverified.");
    }
  const buttons = [
    ...document.querySelectorAll<HTMLElement>('button,[role="button"]'),
  ]
    .filter(visible)
    .map((b) => b.innerText.trim().replace(/\s*\n\s*/g, " "));
  // Reporting context from visible evidence only. Anything not shown stays "unverified".
  const evidence: Record<string, string> = {};
  const symbolCurrency: Record<string, string> = {
    "฿": "THB", "€": "EUR", "£": "GBP", "₹": "INR", "₫": "VND", "₩": "KRW", "₱": "PHP",
  };
  const symbols = new Set<string>();
  const headerCodes = new Set<string>();
  for (const h of observedHeaders) {
    const code = /\(([A-Z]{3})\)\s*$/.exec(h.label)?.[1];
    if (code) headerCodes.add(code);
  }
  for (const r of row_observations)
    for (const c of r.cells) {
      const m = /^(฿|€|£|₹|₫|₩|₱|US\$|\$)\s?\d/.exec(c.text.trim());
      if (m) symbols.add(m[1]);
    }
  let currency = "unverified";
  const fromSymbols = [...symbols].map((s) => symbolCurrency[s] ?? "ambiguous");
  const candidates = new Set([...headerCodes, ...fromSymbols]);
  if (candidates.size === 1 && !candidates.has("ambiguous")) {
    currency = [...candidates][0];
    evidence.currency = headerCodes.size
      ? `column_header:(${currency})`
      : `cell_symbol:${[...symbols].join("")}`;
  } else if (candidates.size) evidence.currency = `conflicting_or_ambiguous:${[...candidates].join(",")}`;
  const pageText = (document.body.innerText || "").slice(0, 200000);
  const zones = new Set(
    pageText.match(
      /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/g,
    ) ?? [],
  );
  let timezone = "unverified";
  if (zones.size === 1) {
    timezone = [...zones][0];
    evidence.timezone = "visible_text";
  } else if (zones.size > 1) evidence.timezone = `multiple:${[...zones].join(",")}`;
  const attributionHeader = observedHeaders.some((h) =>
    /^(attribution setting|การตั้งค่าการระบุที่มา|การตั้งค่าการระบุแหล่งที่มา)$/i.test(h.label),
  );
  if (attributionHeader) evidence.attribution = "row_column";
  return {
    account_id: url.searchParams.get("act"),
    reader_version: "0.6.2",
    page: url.pathname,
    level,
    captured_at: new Date().toISOString(),
    tables,
    row_observations,
    reported_total_rows: reportedTotals.size === 1 ? [...reportedTotals][0] : null,
    format: tables.length ? "structured" : "visible_text_fallback",
    unstructured,
    column_alignment,
    header_mode: headerMode,
    reporting_context: {
      date_range_label:
        buttons.find((s) =>
          /วันที่ผ่านมา|วันนี้|เมื่อวาน|last\s+\d+\s+days|today|yesterday|\d{4}\s*[–—-]/i.test(s),
        ) ?? null,
      column_preset_label:
        buttons.find((s) => /^(คอลัมน์|columns)\s*:/i.test(s)) ?? null,
      // Attribution is only verified per row from an attribution column.
      attribution: "unverified",
      timezone,
      currency,
      evidence,
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
  const rowMarkers =
    '[role="switch"],[role="row"],[role="gridcell"],[role="cell"],input[type="checkbox"],[role="checkbox"]';
  let scope: Element | null = headers[0].parentElement;
  while (scope && !headers.every((h) => scope!.contains(h)))
    scope = scope.parentElement;
  // Widen to the smallest ancestor that also holds row markers, so separate
  // header and body scrollers are both found and moved together.
  const hasRows = (el: Element) =>
    [...el.querySelectorAll(rowMarkers)].some(
      (m) => !m.closest('[role="columnheader"]') && !headers.some((h) => m.contains(h)),
    );
  let rowScope: Element | null = scope;
  while (rowScope && rowScope !== document.body && !hasRows(rowScope))
    rowScope = rowScope.parentElement;
  if (rowScope && rowScope !== document.body) scope = rowScope;
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
            ["auto", "scroll", "hidden"].includes(style.overflowX)
        : el.scrollHeight > el.clientHeight + 2 &&
            ["auto", "scroll"].includes(style.overflowY);
    });
    // A reporting scroller must contain headers or row controls, not a toolbar dropdown.
    const reporting = candidates.filter(
      (el) => headers.some((h) => el.contains(h)) || el.querySelector(rowMarkers),
    );
    if (!horizontal) {
      const scroller = reporting.find((el) =>
        ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
      );
      if (scroller) {
        const before = scroller.scrollTop;
        scroller.scrollTop += Math.max(100, scroller.clientHeight * 0.7);
        return scroller.scrollTop !== before;
      }
    } else if (reporting.length) {
      // Header and body may be separate scrollers. Move every reporting
      // scroller to the same offset so header bands stay over their cells.
      const user = reporting.find((el) =>
        ["auto", "scroll"].includes(getComputedStyle(el).overflowX),
      ) ?? reporting[0];
      const target =
        direction === "reset_horizontal"
          ? 0
          : user.scrollLeft + Math.max(100, user.clientWidth * 0.7);
      let moved = false;
      for (const el of reporting) {
        const before = el.scrollLeft;
        el.scrollLeft = target;
        if (el.scrollLeft !== before) moved = true;
      }
      // Ensure scrollers that cannot reach the target are not left misaligned.
      const reached = Math.min(...reporting.map((el) => el.scrollLeft));
      for (const el of reporting) if (el.scrollLeft !== reached) el.scrollLeft = reached;
      return moved;
    }
    scope = scope.parentElement;
  }
  if (horizontal) return false;
  // Fallback for bodies whose scroller is overflow:hidden with a custom scrollbar,
  // or that virtualize rows in script: move the nearest scrollable ancestor of the
  // last visible row so it becomes the first row (one row of overlap). Without a
  // scrollable ancestor, send one wheel event over the rows. The caller re-reads
  // and stops when the visible rows did not change.
  const headerBottom = Math.max(
    0,
    ...headers.filter(visible).map((h) => h.getBoundingClientRect().bottom),
  );
  const anchors = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="switch"],input[type="checkbox"],[role="checkbox"]',
    ),
  ]
    .filter((el) => {
      if (!visible(el) || el.closest('[role="columnheader"]')) return false;
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      if (cy <= headerBottom || r.bottom > innerHeight) return false;
      // Rows rendered ahead of time but clipped by the body are not on screen.
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowY === "visible") continue;
        const c = a.getBoundingClientRect();
        if (cy < c.top || cy > c.bottom) return false;
      }
      return true;
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  if (anchors.length < 2) return false;
  const last = anchors[anchors.length - 1];
  const delta = Math.max(
    40,
    last.getBoundingClientRect().top - anchors[0].getBoundingClientRect().top,
  );
  for (let a = last.parentElement; a && a !== document.body; a = a.parentElement) {
    if (a.scrollHeight - a.clientHeight < 40) continue;
    const before = a.scrollTop;
    a.scrollTop = before + delta;
    if (a.scrollTop !== before) return true;
  }
  const lr = last.getBoundingClientRect();
  const target =
    document.elementFromPoint(
      Math.min(innerWidth - 2, lr.right + 120),
      lr.top + lr.height / 2,
    ) ?? last;
  target.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY: delta,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      clientX: lr.right + 120,
      clientY: lr.top + lr.height / 2,
    }),
  );
  return true;
}

/** Wait inside the page until reporting headers and row markers render. */
export async function waitForReportingRows(timeoutMs = 8000) {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      s.visibility !== "hidden" &&
      s.display !== "none"
    );
  };
  const started = Date.now();
  let diagnostics = { headers: 0, switches: 0, checkboxes: 0, rows: 0, loading: 0 };
  while (Date.now() - started < timeoutMs) {
    const headers = [...document.querySelectorAll('[role="columnheader"],thead th')].filter(visible);
    const bottom = headers.length
      ? Math.max(...headers.map((h) => h.getBoundingClientRect().bottom))
      : Infinity;
    const below = (selector: string) =>
      [...document.querySelectorAll(selector)].filter((el) => {
        if (!visible(el) || el.closest('[role="columnheader"]')) return false;
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 > bottom;
      }).length;
    diagnostics = {
      headers: headers.length,
      switches: below('[role="switch"]'),
      checkboxes: below('input[type="checkbox"],[role="checkbox"]'),
      rows: below('[role="row"],tbody tr'),
      loading: [...document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].filter(visible).length,
    };
    if (
      diagnostics.headers >= 2 &&
      (diagnostics.switches || diagnostics.checkboxes || diagnostics.rows) &&
      !diagnostics.loading
    ) {
      // Let virtualized cells finish painting.
      await new Promise((r) => setTimeout(r, 400));
      return { ready: true, waited_ms: Date.now() - started, ...diagnostics };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ready: false, waited_ms: Date.now() - started, ...diagnostics };
}

/**
 * Vertical paging that verifies movement. Tries, in order, every scrollable
 * ancestor of the last visible row, one wheel event over the rows, and
 * scrollIntoView of the last row. A step counts only when the visible rows
 * actually changed; otherwise the scroll is reverted. Returns diagnostics
 * (element tags and pixel sizes only, never page text).
 */
export async function scrollReportingRows() {
  const settle = (ms: number) =>
    new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, ms)));
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const tried: { method: string; tag?: string; overflow?: string; range?: number; moved: boolean }[] = [];
  const headers = [...document.querySelectorAll('[role="columnheader"],thead th')].filter(visible);
  if (!headers.length) return { moved: false, method: "none", tried, reason: "no_headers" };
  const headerBottom = Math.max(...headers.map((h) => h.getBoundingClientRect().bottom));
  const rows = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="switch"],input[type="checkbox"],[role="checkbox"]',
      ),
    ]
      .filter((el) => {
        if (!visible(el) || el.closest('[role="columnheader"]')) return false;
        const r = el.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (cy <= headerBottom || r.bottom > innerHeight) return false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowY === "visible") continue;
          const c = a.getBoundingClientRect();
          if (cy < c.top || cy > c.bottom) return false;
        }
        return true;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  // Signature of what is on screen: which anchor elements are visible, where, and the
  // short text right of each (recycled virtual rows keep elements but change text).
  const ids = new WeakMap<Element, number>();
  let next = 0;
  const idOf = (el: Element) => {
    if (!ids.has(el)) ids.set(el, next++);
    return ids.get(el)!;
  };
  const signature = () =>
    rows()
      .map((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const texts = [40, 120, 240].map((dx) => {
          const t = (document.elementFromPoint(Math.min(innerWidth - 2, r.right + dx), y)?.textContent ?? "").trim();
          return t.length < 300 ? t.slice(0, 80) : "";
        });
        return `${idOf(el)}@${Math.round(y)}:${texts.join("/")}`;
      })
      .join("|");
  const anchors = rows();
  if (anchors.length < 2) return { moved: false, method: "none", tried, reason: "fewer_than_two_rows" };
  const last = anchors[anchors.length - 1];
  const before = signature();
  const delta = Math.max(
    40,
    last.getBoundingClientRect().top - anchors[0].getBoundingClientRect().top,
  );
  const changed = () => signature() !== before;
  for (let a: Element | null = last.parentElement; a; a = a.parentElement) {
    const range = a.scrollHeight - a.clientHeight;
    if (range < 40) continue;
    const start = a.scrollTop;
    a.scrollTop = start + delta;
    if (a.scrollTop === start) continue;
    await settle(250);
    const moved = changed();
    tried.push({ method: "ancestor", tag: a.tagName.toLowerCase(), overflow: getComputedStyle(a).overflowY, range, moved });
    if (moved) return { moved, method: "ancestor", tried };
    a.scrollTop = start; // Not the row scroller; leave the page as it was.
  }
  const lr = last.getBoundingClientRect();
  const x = Math.min(innerWidth - 2, lr.right + 120),
    y = lr.top + lr.height / 2;
  const target = document.elementFromPoint(x, y) ?? last;
  target.dispatchEvent(
    new WheelEvent("wheel", { deltaY: delta, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
  await settle(600);
  let moved = changed();
  tried.push({ method: "wheel", tag: target.tagName.toLowerCase(), moved });
  if (moved) return { moved, method: "wheel", tried };
  last.scrollIntoView({ block: "start", inline: "nearest" });
  await settle(400);
  moved = changed();
  tried.push({ method: "scroll_into_view", moved });
  return { moved, method: moved ? "scroll_into_view" : "none", tried };
}
