// Executed in the isolated world. Never accesses cookies, page JS state or network APIs.
import manifest from "../manifest.json";

export function readVisibleTableUnsafe(readerVersion: string): any {
  try {
  const url = new URL(location.href);
  if (
    !["adsmanager.facebook.com", "business.facebook.com"].includes(
      url.hostname,
    ) ||
    !url.pathname.startsWith("/adsmanager/")
  )
    throw new Error("Open an Ads Manager reporting page");
  const norm = (value: string) =>
    value
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
    ].filter(visible);
    if (headers.length >= 2) {
      let common: HTMLElement | null = headers[0].parentElement;
      while (common && !headers.every((h) => common!.contains(h)))
        common = common.parentElement;
      let container: HTMLElement | null = common ?? document.body;
      const markerSelector =
        '[role="switch"],[role="gridcell"],[role="cell"],input[type="checkbox"],[role="checkbox"]';
      while (container) {
        const markers = [
          ...container.querySelectorAll<HTMLElement>(markerSelector),
        ].filter((el) => {
          if (!visible(el) || el.closest('[role="columnheader"]')) return false;
          return true;
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
        if (container === document.body) break;
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
  const readerDiagnostics = {
    visible_headers: 0,
    readable_headers: 0,
    observed_headers: 0,
    unstructured: false,
    header_bottom: 0,
    switches: 0,
    checkboxes: 0,
    anchors: 0,
    bands: 0,
    text_nodes: 0,
    mapped_text_nodes: 0,
    mapped_rows: 0,
  };
  const readableHeaders = [
    ...document.querySelectorAll<HTMLElement>('[role="columnheader"],thead th'),
  ].filter(headerReadable);
  const visibleHeaders = [
    ...document.querySelectorAll<HTMLElement>('[role="columnheader"],thead th'),
  ].filter(visible);
  const observedHeaders = (
    readableHeaders.length >= 2
      ? readableHeaders
      : visibleHeaders
  )
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
  readerDiagnostics.visible_headers = visibleHeaders.length;
  readerDiagnostics.readable_headers = readableHeaders.length;
  readerDiagnostics.observed_headers = observedHeaders.length;
  readerDiagnostics.unstructured = !!unstructured;
  readerDiagnostics.switches = [
    ...document.querySelectorAll('[role="switch"]'),
  ].filter(visible).length;
  readerDiagnostics.checkboxes = [
    ...document.querySelectorAll(
      'input[type="checkbox"],[role="checkbox"]',
    ),
  ].filter(visible).length;
  const headersBottom = observedHeaders.length
    ? Math.max(...observedHeaders.map((h) => h.rect.bottom))
    : 0;
  readerDiagnostics.header_bottom = Math.round(headersBottom);
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
      parent_conflicts: {campaign_id:campaign.size>1,ad_set_id:adset.size>1},
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
    const columnIds = new Set(cells.filter((c)=>idHeaderPattern.test(c.header)&&/^\d+$/.test(c.text.trim())).map(c=>c.text.trim()));
    const columnId = columnIds.size===1?[...columnIds][0]:null;
    if (found.conflict||columnIds.size>1) {
      rowWarnings.push("Row links or ID columns expose more than one ID; identity left unverified.");
      return {identity:null,identity_source:null};
    }
    if (columnId && found.id && columnId !== found.id) {
      rowWarnings.push("ID column and row link disagree; identity left unverified.");
      return { identity: null, identity_source: null };
    }
    if (found.id) return { identity: found.id, identity_source: "row_link_href" as const };
    if (columnId) return { identity: columnId, identity_source: "id_column" as const };
    return { identity: null, identity_source: null };
  };
  const resolveParents = (
    found:ReturnType<typeof linkIds>,
    cells:{header:string;text:string}[],
    rowWarnings:string[],
    allowColumnIds:boolean,
  ) => {
    const result={campaign_id:null as string|null,ad_set_id:null as string|null};
    const fields: {key:"campaign_id"|"ad_set_id";pattern:RegExp}[]=[];
    if(level!=="campaigns")fields.push({key:"campaign_id",pattern:/^(campaign id|id แคมเปญ|รหัสแคมเปญ)$/i});
    if(level==="ads")fields.push({key:"ad_set_id",pattern:/^(ad set id|id ชุดโฆษณา|รหัสชุดโฆษณา)$/i});
    for(const {key,pattern} of fields){
      const ids=new Set(allowColumnIds?cells.filter(c=>pattern.test(c.header.trim())&&/^\d+$/.test(c.text.trim())).map(c=>c.text.trim()):[]);
      if(found.parent_conflicts[key]||ids.size>1){
        rowWarnings.push(`Conflicting parent ${key} evidence; parent ID left unverified.`);
        continue;
      }
      const column=ids.size===1?[...ids][0]:null,link=found.parent_ids[key];
      if(column&&link&&column!==link){
        rowWarnings.push(`Parent ${key} column and row link disagree; parent ID left unverified.`);
        continue;
      }
      result[key]=link??column;
    }
    return result;
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
        parent_ids: resolveParents(found,rowCells,rowWarnings,true),
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
  let row_alignment:"aligned"|"mismatch"|"unverified"="aligned";
  const row_alignment_diagnostics:{compared_cells:number;pairs:{row_index:number;identity_scroll_top:number;metric_scroll_top:number;independent_transform:boolean;independent_owner:boolean}[]}={compared_cells:0,pairs:[]};
  const column_alignment_diagnostics: {
    scrollers: {role:"header"|"body_markers"|"body_text";included:boolean;scroll_left:number;client_width:number;scroll_width:number;range:number;left:number;right:number;contains_rows:boolean}[];
    truncated:boolean;
  } = {scrollers:[],truncated:false};
  const rowMarkerSelector =
    '[role="switch"],input[type="checkbox"],[role="checkbox"],[role="row"],[role="gridcell"]';
  if (observedHeaders.length >= 2) {
    const headerEls = [
      ...document.querySelectorAll<HTMLElement>('[role="columnheader"]'),
    ];
    let alignmentScope:Element|null=headerEls[0]?.parentElement??null;
    while(alignmentScope&&!headerEls.every(h=>alignmentScope!.contains(h)))alignmentScope=alignmentScope.parentElement;
    while(alignmentScope&&alignmentScope!==document.body&&![...alignmentScope.querySelectorAll(rowMarkerSelector)].some(m=>!m.closest('[role="columnheader"]')))
      alignmentScope=alignmentScope.parentElement;
    const scrollers = [...document.querySelectorAll<HTMLElement>("*")].filter(
      (el) =>
        !!alignmentScope?.contains(el) &&
        el.scrollWidth > el.clientWidth + 2 &&
        ["auto", "scroll", "hidden"].includes(getComputedStyle(el).overflowX) &&
        visible(el),
    );
    const containsHeaders=(el:Element)=>headerEls.some(h=>el.contains(h));
    const containsRows=(el:Element)=>[...el.querySelectorAll(rowMarkerSelector)].some(m=>!m.closest('[role="columnheader"]')&&!headerEls.some(h=>m.contains(h)));
    const numericHeaders=observedHeaders.filter(h=>!/^(?:ad|ad name|campaign|campaign name|ad set|ad set name|โฆษณา|ชื่อโฆษณา|แคมเปญ|ชื่อแคมเปญ|ชุดโฆษณา|ชื่อชุดโฆษณา|on\s*\/\s*off|off\s*\/\s*on|ปิด\s*\/\s*เปิด|เปิด\s*\/\s*ปิด)$/i.test(h.label));
    const centers=[...document.querySelectorAll<HTMLElement>('[role="switch"],input[type="checkbox"],[role="checkbox"]')]
      .filter(el=>visible(el)&&!el.closest('[role="columnheader"]')&&el.getBoundingClientRect().top>headersBottom)
      .map(el=>{const r=el.getBoundingClientRect();return r.top+r.height/2;}).sort((a,b)=>a-b)
      .filter((y,i,all)=>i===0||Math.abs(y-all[i-1])>8);
    const metricRows=(el:Element)=>{
      if(el.closest('form,[role="dialog"],[aria-modal="true"]'))return false;
      const rect=el.getBoundingClientRect(),seen=new Set<number>();
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let visited=0;
      while(walker.nextNode()&&visited++<5000){
        const parent=walker.currentNode.parentElement,text=walker.currentNode.textContent?.trim();
        if(!parent||!text||!visible(parent)||parent.closest('input,textarea,select,button,[role="button"],[role="columnheader"],[contenteditable="true"],script,style')||
          !/^(?:[฿$€£]?\s*\d[\d,.]*(?:\s*%)?|[—–-])$/.test(text))continue;
        const range=document.createRange();range.selectNodeContents(walker.currentNode);const r=range.getBoundingClientRect();
        const x=r.left+r.width/2,y=r.top+r.height/2;
        if(!r.width||!r.height||x<Math.max(0,rect.left)||x>Math.min(innerWidth,rect.right)||y<Math.max(headersBottom,rect.top)||y>Math.min(innerHeight,rect.bottom)||
          !numericHeaders.some(h=>x>=h.rect.left&&x<=h.rect.right))continue;
        const row=centers.findIndex((center,i)=>y>=(i?(centers[i-1]+center)/2:center-30)&&y<(i<centers.length-1?(center+centers[i+1])/2:center+30));
        if(row>=0)seen.add(row);
        if(seen.size>=(containsRows(el)?1:2))return true;
      }
      return false;
    };
    const innermost=(candidates:HTMLElement[])=>candidates.filter(el=>!candidates.some(other=>el!==other&&el.contains(other)));
    const numericHeaderEls=headerEls.filter(h=>numericHeaders.some(n=>n.label===(h.innerText||h.textContent||"").trim()));
    const headerScrollers=innermost(scrollers.filter(el=>numericHeaderEls.some(h=>el.contains(h))));
    const bodyScrollers=innermost(scrollers.filter(el=>!containsHeaders(el)&&metricRows(el)));
    const described=scrollers.filter(el=>containsHeaders(el)||containsRows(el)||bodyScrollers.includes(el));
    column_alignment_diagnostics.truncated=described.length>24;
    column_alignment_diagnostics.scrollers=described.slice(0,24).map(el=>{
      const rect=el.getBoundingClientRect(),hasRows=containsRows(el);
      return {role:containsHeaders(el)?"header":hasRows?"body_markers":"body_text",included:headerScrollers.includes(el)||bodyScrollers.includes(el),
        scroll_left:el.scrollLeft,client_width:el.clientWidth,scroll_width:el.scrollWidth,range:el.scrollWidth-el.clientWidth,
        left:Math.round(rect.left),right:Math.round(rect.right),contains_rows:hasRows};
    });
    column_alignment = "aligned";
    for (const h of headerScrollers)
      for (const b of bodyScrollers)
        if (Math.abs(h.scrollLeft - b.scrollLeft) > 1) column_alignment = "mismatch";
    if(headerScrollers.some(h=>Math.abs(h.scrollLeft)>1&&!containsRows(h))&&!bodyScrollers.length)
      column_alignment="mismatch"; // A moved header without a verified body is not alignment proof.
    if (column_alignment === "mismatch")
      warnings.push(
        "Header and body scroll offsets differ; column mapping is rejected for this capture.",
      );
  }
  const geometryParents: { center: number; row: Observation }[] = [];
  let geometryScope: Element | null = null;
  if (!row_observations.length && observedHeaders.length >= 2) {
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
    while (scope) {
      const kind = anchorKinds.find((k) => markersIn(scope!, k).length);
      if (kind) {
        anchorSelector = kind;
        break;
      }
      if (scope === document.body) break;
      scope = scope.parentElement;
    }
    if (anchorSelector !== anchorKinds[0])
      warnings.push("Rows anchored by selection checkboxes because no on/off switches were visible.");
    if (scope) {
      geometryScope = scope;
      const anchors = markersIn(scope, anchorSelector)
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.top - b.rect.top)
        .filter(
          (a, i, all) => i === 0 || Math.abs(a.rect.top - all[i - 1].rect.top) > 4,
        );
      readerDiagnostics.anchors = anchors.length;
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
      readerDiagnostics.bands = bands.length;
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
      const verticalState=(element:Element)=>{
        let scroll_top=0;
        const transforms:Element[]=[];
        const owners:Element[]=[];
        for(let a:Element|null=element;a&&a!==scope;a=a.parentElement){
          const style=getComputedStyle(a);
          if(a.scrollHeight>a.clientHeight+2&&["hidden","auto","scroll"].includes(style.overflowY)){scroll_top+=a.scrollTop;owners.push(a);}
          if(style.transform!=="none"){
            try{
              const matrix=new DOMMatrixReadOnly(style.transform);
              if(Math.abs(matrix.m42)>0.1||Math.abs(matrix.m22-1)>0.001||Math.abs(matrix.m12)>0.001||Math.abs(matrix.m21)>0.001)transforms.push(a);
            }catch{transforms.push(a);}
          }
        }
        return {scroll_top,transforms,owners};
      };
      const identityStates=anchors.map(a=>verticalState(a.el));
      const recordedPairs=new Set<string>();
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode,
          parent = node.parentElement,
          text = node.textContent?.trim();
        readerDiagnostics.text_nodes++;
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
        readerDiagnostics.mapped_text_nodes++;
        const h = headers[0].label,
          parts = cells[row].get(h) ?? [];
        // Geometric Y bands cannot join frozen IDs to newly scrolled metric
        // values. Compare their actual vertical owners before trusting a row.
        if(!/^(?:on\s*\/\s*off|off\s*\/\s*on|ปิด\s*\/\s*เปิด|เปิด\s*\/\s*ปิด)$/i.test(h)&&
          !(nameHeaderPattern.test(h)&&parent.closest('button,[role="button"]'))){
          const identity=identityStates[row],metric=verticalState(parent);
          const independent_transform=metric.transforms.some(a=>!identity.transforms.includes(a))||identity.transforms.some(a=>!metric.transforms.includes(a));
          const independent_owner=metric.owners.some(a=>!identity.owners.includes(a))||identity.owners.some(a=>!metric.owners.includes(a));
          const mismatch=Math.abs(identity.scroll_top-metric.scroll_top)>1;
          if(mismatch)row_alignment="mismatch";
          else if(independent_transform&&row_alignment!=="mismatch")row_alignment="unverified";
          row_alignment_diagnostics.compared_cells++;
          const key=`${row}:${identity.scroll_top}:${metric.scroll_top}:${independent_transform}:${independent_owner}`;
          if(!recordedPairs.has(key)&&row_alignment_diagnostics.pairs.length<12){
            recordedPairs.add(key);row_alignment_diagnostics.pairs.push({row_index:row,identity_scroll_top:identity.scroll_top,metric_scroll_top:metric.scroll_top,independent_transform,independent_owner});
          }
        }
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
        readerDiagnostics.mapped_rows++;
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
          column_alignment !== "mismatch" && row_alignment === "aligned" && (linkInName || idColumnOk)
            ? ("verified_geometry" as const)
            : ("unverified" as const);
        if (column_mapping === "unverified")
          rowWarnings.push("Column mapping unverified for this row.");
        if(row_alignment!=="aligned")rowWarnings.push(row_alignment==="mismatch"
          ?"Identity and metric vertical scroll offsets differ; row association is unverified."
          :"Independent vertical transforms prevent verification of identity/metric row association.");
        const observation: Observation = {
          ...identity,
          parent_ids: resolveParents(found,rowCells,rowWarnings,column_mapping==="verified_geometry"),
          name: nameHeader
            ? (map.get(nameHeader.label)?.[0] ?? null)
            : null,
          method: "geometry",
          column_mapping,
          cells: rowCells,
          warnings: rowWarnings,
        };
        row_observations.push(observation);
        geometryParents.push({
          center: (band.top + band.bottom) / 2,
          row: observation,
        });
      });
    }
  }
  if(row_alignment!=="aligned")warnings.push(row_alignment==="mismatch"
    ?"Identity and metric panes are vertically out of sync; geometric rows must not be normalized or ranked."
    :"Vertical identity/metric row association is unverified; geometric rows must not be normalized or ranked.");
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
  // A missing breakdown/filter control does not prove that no restriction is
  // active. Keep scope unknown until an explicit supported observation exists.
  evidence.breakdown = "unverified";
  evidence.filters = "unverified";
  warnings.push("Breakdown and filter scope are unverified; visible rows cannot certify whole-account coverage.");
  const activeBreakdowns = [...url.searchParams]
    .filter(([key, value]) => /_breakdown$/i.test(key) && !!value)
    .map(([key, value]) => ({ key, value }));
  const breakdownValue =
    /^(?:18[–-]24|25[–-]34|35[–-]44|45[–-]54|55[–-]64|65\+|male|female|ชาย|หญิง|ไม่ระบุ)$/i;
  const breakdown_diagnostics =
    activeBreakdowns.length === 0
      ? null
      : (() => {
          const tokens: {
            value: string;
            rect: { left: number; top: number; width: number; height: number };
            visible: boolean;
            ancestors: {
              tag: string;
              role: string | null;
              width: number;
              height: number;
              id_links: number;
              switches: number;
              cells: number;
            }[];
            identity_ancestor: number | null;
          }[] = [];
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
          );
          let visited = 0;
          while (walker.nextNode() && visited++ < 30000 && tokens.length < 20) {
            const value = norm(walker.currentNode.textContent ?? "");
            if (!breakdownValue.test(value)) continue;
            const parent = walker.currentNode.parentElement;
            if (!parent) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const rect = range.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            const ancestors: {
              tag: string;
              role: string | null;
              width: number;
              height: number;
              id_links: number;
              switches: number;
              cells: number;
            }[] = [];
            let identity_ancestor: number | null = null;
            let current: Element | null = parent;
            for (let depth = 0; current && depth < 10; depth++) {
              const r = current.getBoundingClientRect();
              const idLinks = [
                ...current.querySelectorAll<HTMLAnchorElement>("a[href]"),
              ].filter((anchor) => {
                try {
                  const link = new URL(anchor.href, location.href);
                  const id = link.searchParams.get(ownParam);
                  return (
                    ["adsmanager.facebook.com", "business.facebook.com"].includes(
                      link.hostname,
                    ) &&
                    !!id &&
                    /^\d+$/.test(id)
                  );
                } catch {
                  return false;
                }
              }).length;
              if (idLinks && identity_ancestor === null)
                identity_ancestor = depth;
              ancestors.push({
                tag: current.tagName.toLowerCase(),
                role: current.getAttribute("role"),
                width: Math.round(r.width),
                height: Math.round(r.height),
                id_links: idLinks,
                switches: current.querySelectorAll(
                  '[role="switch"],input[type="checkbox"],[role="checkbox"]',
                ).length,
                cells: current.querySelectorAll(
                  '[role="gridcell"],[role="cell"],[role="rowheader"],td',
                ).length,
              });
              current = current.parentElement;
            }
            tokens.push({
              value,
              rect: {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              visible:
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.top < innerHeight &&
                rect.right > 0 &&
                rect.left < innerWidth,
              ancestors,
              identity_ancestor,
            });
          }
          return { active: activeBreakdowns, tokens };
        })();
  const demographicValue = activeBreakdowns.find(
    ({ key }) => key === "demographics_breakdown",
  )?.value;
  const breakdownDimension =
    demographicValue === "age"
      ? {
          header: "อายุ",
          pattern:
            /^(?:18[–-]24|25[–-]34|35[–-]44|45[–-]54|55[–-]64|65\+)$/,
        }
      : demographicValue === "gender"
        ? {
            header: "เพศ",
            pattern: /^(?:ชาย|หญิง|ไม่ระบุ|male|female|unknown)$/i,
          }
        : null;
  if (
    breakdownDimension &&
    geometryScope &&
    geometryParents.length &&
    observedHeaders.length >= 2
  ) {
    const parents = [...geometryParents].sort((a, b) => a.center - b.center);
    const rowsByAge: Observation[] = [];
    const scope = geometryScope;
    const maxHeaderWidth = Math.max(
      ...observedHeaders.map((header) => header.rect.width),
    );
    const clippedRect = (element: Element) => {
      const own = element.getBoundingClientRect();
      let left = own.left,
        right = own.right,
        top = own.top,
        bottom = own.bottom;
      for (
        let ancestor: Element | null = element.parentElement;
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
      return {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
      };
    };
    // Meta wraps multiline cells in several spans. A line can be painted over
    // an adjacent header's x-range, so assign it to the nearest structural
    // owner whose left edge belongs to one column. The owner's height keeps
    // the grouping inside this Age row and prevents parent-row leakage.
    const ownerFor = (
      parent: Element,
      rowTop: number,
      rowBottom: number,
    ):
      | { element: Element; header: string; rect: ReturnType<typeof clippedRect> }
      | null => {
      let best:
        | {
            element: Element;
            header: string;
            rect: ReturnType<typeof clippedRect>;
            score: number;
          }
        | null = null;
      let ancestor: Element | null = parent;
      for (let depth = 0; ancestor && ancestor !== scope && depth < 9; depth++) {
        const rect = clippedRect(ancestor);
        if (rect.width < 24 || rect.height < 10) {
          ancestor = ancestor.parentElement;
          continue;
        }
        // A row container is wider/taller than a cell; never use it to own text.
        if (
          rect.height > Math.max(96, (rowBottom - rowTop) * 2.5) ||
          rect.width > Math.max(240, maxHeaderWidth * 2.4)
        ) {
          ancestor = ancestor.parentElement;
          continue;
        }
        const leftMatches = observedHeaders.filter(
          (header) =>
            rect.left >= header.rect.left - 8 &&
            rect.left <= header.rect.right + 8,
        );
        const oneLeft = leftMatches.length === 1 ? leftMatches[0] : null;
        const contained = observedHeaders.filter(
          (header) =>
            rect.left >= header.rect.left - 2 &&
            rect.right <= header.rect.right + 2,
        );
        const header =
          oneLeft ?? (contained.length === 1 ? contained[0] : null);
        if (!header) {
          ancestor = ancestor.parentElement;
          continue;
        }
        const role = (ancestor.getAttribute("role") ?? "").toLowerCase();
        const structural =
          role === "gridcell" ||
          role === "cell" ||
          role === "rowheader" ||
          ancestor.tagName === "TD" ||
          ancestor.tagName === "TH";
        const score =
          (structural ? 1000 : 0) +
          rect.width +
          (rect.height >= 16 ? 40 : 0) +
          (Math.abs(rect.left - header.rect.left) <= 8 ? 80 : 0);
        if (!best || score > best.score)
          best = { element: ancestor, header: header.label, rect, score };
        ancestor = ancestor.parentElement;
      }
      return best
        ? { element: best.element, header: best.header, rect: best.rect }
        : null;
    };
    const attributionPattern =
      /^(?:attribution setting|การตั้งค่าการระบุที่มา|การตั้งค่าการระบุแหล่งที่มา)$/i;
    const adSetNamePattern = /^(?:ad set name|ชื่อชุดโฆษณา)$/i;
    const attributionFragment =
      /^(?:การคลิกในช่วง|หรือการดูในช่วง|คอนเวอร์ชั่นทั้งหมด|7\s*วัน|1\s*วัน|click|view|all conversions|\d+\s*[- ]?\s*day.*)$/i;
    const parentWalker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (parentWalker.nextNode()) {
      const node = parentWalker.currentNode;
      const value = norm(node.textContent ?? "");
      if (!breakdownDimension.pattern.test(value)) continue;
      const parent = node.parentElement;
      if (!parent || !visible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const tokenRect = range.getBoundingClientRect();
      if (!tokenRect.width || !tokenRect.height) continue;
      const center = tokenRect.top + tokenRect.height / 2;
      const identityParent = [...parents]
        .reverse()
        .find((candidate) => candidate.center < center)?.row;
      if (
        !identityParent?.identity ||
        !["row_link_href", "id_column"].includes(
          identityParent.identity_source ?? "",
        )
      )
        continue;
      const top = tokenRect.top - 9;
      const bottom = tokenRect.bottom + 9;
      const rowTop = top;
      const rowBottom = bottom;
      const groups = new Map<
        string,
        {
          header: string;
          parts: { text: string; top: number; left: number; order: number }[];
        }
      >();
      const metricWalker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let textOrder = 0;
      while (metricWalker.nextNode()) {
        const metricNode = metricWalker.currentNode;
        if (metricNode === node) continue;
        const metricParent = metricNode.parentElement;
        const textValue = metricNode.textContent?.trim();
        if (
          !metricParent ||
          !textValue ||
          !visible(metricParent) ||
          metricParent.closest(
            'script,style,noscript,input,textarea,[contenteditable="true"],[role="columnheader"]',
          )
        )
          continue;
        const metricRange = document.createRange();
        metricRange.selectNodeContents(metricNode);
        const rect = metricRange.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const owner = ownerFor(metricParent, rowTop, rowBottom);
        if (
          !rect.width ||
          !rect.height ||
          rect.left < 0 ||
          rect.right > innerWidth
        )
          continue;
        let header: string | null = owner?.header ?? null;
        if (owner) {
          const ownerCenter = (owner.rect.top + owner.rect.bottom) / 2;
          if (ownerCenter < rowTop || ownerCenter > rowBottom) continue;
        } else {
          if (y < top || y > bottom) continue;
          const matchedHeaders = observedHeaders.filter(
            (candidate) =>
              rect.left >= candidate.rect.left - 2 &&
              rect.right <= candidate.rect.right + 2,
          );
          if (matchedHeaders.length === 1) header = matchedHeaders[0].label;
        }
        if (!header) continue;
        const key = owner
          ? `owner:${observedHeaders.findIndex((candidate) => candidate.label === owner.header)}:${Math.round(owner.rect.left)}:${Math.round(owner.rect.top)}`
          : `text:${header}`;
        const group = groups.get(key) ?? { header, parts: [] };
        group.parts.push({
          text: norm(textValue),
          top: rect.top,
          left: rect.left,
          order: textOrder++,
        });
        groups.set(key, group);
      }
      const values = new Map<string, string[]>();
      for (const group of groups.values()) {
        const lines = group.parts
          .sort(
            (a, b) =>
              a.top - b.top || a.left - b.left || a.order - b.order,
          )
          .map((part) => part.text)
          .filter(Boolean);
        const unique = [...new Set(lines)];
        if (!unique.length) continue;
        values.set(group.header, [
          ...(values.get(group.header) ?? []),
          ...unique,
        ]);
      }
      // Attribution is one multiline cell. A wrapped line can be painted over
      // the next column's x-range; merge it back instead of treating it as an
      // ad-set name or a separate reporting scope.
      const attributionHeaders = [...values.keys()].filter((header) =>
        attributionPattern.test(header.trim()),
      );
      for (const adSetHeader of [...values.keys()].filter((header) =>
        adSetNamePattern.test(header.trim()),
      )) {
        const adSetLines = values.get(adSetHeader) ?? [];
        if (
          attributionHeaders.length === 1 &&
          adSetLines.length &&
          adSetLines.every((line) => attributionFragment.test(norm(line)))
        ) {
          const attributionHeader = attributionHeaders[0];
          values.set(attributionHeader, [
            ...(values.get(attributionHeader) ?? []),
            ...adSetLines,
          ]);
        }
        values.delete(adSetHeader);
      }
      const idCells = identityParent.cells.filter((cell) =>
        /^(?:id แคมเปญ|id ชุดโฆษณา|id โฆษณา|campaign id|ad set id|ad id)$/i.test(
          cell.header.trim(),
        ),
      );
      const statusCell = identityParent.cells.find((cell) =>
        /^(?:status|การแสดงโฆษณา)$/i.test(cell.header.trim()),
      );
      const resultCell = identityParent.cells.find((cell) =>
        /^(?:results|ผลลัพธ์)$/i.test(cell.header.trim()),
      );
      const resultTypeCell = identityParent.cells.find((cell) =>
        /^(?:result type|ประเภทผลลัพธ์|result indicator|ตัวบ่งชี้ผลลัพธ์)$/i.test(
          cell.header.trim(),
        ),
      );
      const resultType =
        (resultTypeCell?.text.trim() ||
          (() => {
            if (!resultCell) return null;
            const lines = resultCell.text.split("\n");
            const separate = lines
              .slice(1)
              .find(
                (line) =>
                  !!norm(line) &&
                  !/^[\d.,%฿$€£—–-]+$/.test(norm(line)),
              );
            if (separate) return separate;
            const inline = norm(lines[0] ?? "").replace(
              /^[\d.,%฿$€£—–-]+\s*/,
              "",
            );
            return inline || null;
          })()) ??
        null;
      const cells = [
        { header: breakdownDimension.header, text: value },
        ...idCells,
        ...(statusCell ? [statusCell] : []),
        ...(resultType
          ? [{ header: "result_type", text: resultType }]
          : []),
        ...identityParent.cells.filter((cell) =>
          adSetNamePattern.test(cell.header.trim()),
        ),
        ...[...values]
          .filter(
            ([header]) =>
              !idCells.some((cell) => cell.header === header) &&
              header !== statusCell?.header &&
              !nameHeaderPattern.test(header) &&
              !adSetNamePattern.test(header),
          )
          .map(([header, parts]) => ({
            header,
            text: parts.join("\n"),
          })),
      ];
      if (cells.length < 3) continue;
      const verified =
        identityParent.column_mapping === "verified_geometry" &&
        column_alignment === "aligned" &&
        row_alignment === "aligned";
      const warnings = [
        `Breakdown ${breakdownDimension.header} row associated with the nearest preceding stable-ID parent row.`,
        ...(!verified
          ? ["Breakdown subrow column mapping requires review."]
          : []),
      ];
      rowsByAge.push({
        identity: identityParent.identity,
        identity_source: identityParent.identity_source,
        parent_ids: { ...identityParent.parent_ids },
        name: identityParent.name,
        method: "geometry",
        column_mapping: verified ? "verified_geometry" : "unverified",
        cells,
        warnings,
      });
    }
    if (rowsByAge.length) {
      row_observations.length = 0;
      row_observations.push(...rowsByAge);
      warnings.push(
        `Breakdown ${breakdownDimension.header} rows were mapped only to nearest stable-ID parent rows; no name/position identity join was used across pages.`,
      );
    }
  }
  const result = {
    account_id: url.searchParams.get("act"),
    reader_version: readerVersion,
    page: url.pathname,
    level,
    captured_at: new Date().toISOString(),
    tables,
    row_observations,
    reported_total_rows: reportedTotals.size === 1 ? [...reportedTotals][0] : null,
    format: tables.length ? "structured" : "visible_text_fallback",
    unstructured,
    column_alignment,
    column_alignment_diagnostics,
    row_alignment,
    row_alignment_diagnostics,
    reader_diagnostics: readerDiagnostics,
    header_mode: headerMode,
    breakdown_diagnostics,
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
      breakdown: null,
      filters: null,
      evidence,
    },
    coverage: "visible_only",
    warnings,
  };
  if (!result.tables.length && !result.row_observations.length) {
    return {
      ...result,
      tables: [],
      row_observations: [],
      unstructured: result.unstructured,
      reader_result_bytes: JSON.stringify(result).length,
    };
  }
  return JSON.parse(JSON.stringify(result)) as typeof result;
  } catch (error) {
    return {
      tables: [],
      row_observations: [],
      unstructured: null,
      reader_error: error instanceof Error ? error.message : String(error),
      reader_diagnostics: null,
    };
  }
}

export function readVisibleTable(): ReturnType<typeof readVisibleTableUnsafe> & {
  reader_error?: string;
} {
  try {
    return readVisibleTableUnsafe(manifest.version);
  } catch (error) {
    return {
      tables: [],
      row_observations: [],
      unstructured: null,
      reader_error: error instanceof Error ? error.message : String(error),
      reader_diagnostics: null,
    } as unknown as ReturnType<typeof readVisibleTableUnsafe> & {
      reader_error?: string;
    };
  }
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
  const horizontalHeaderBottom = Math.max(0, ...headers.filter(visible).map((h)=>h.getBoundingClientRect().bottom));
  const numericHeaders = headers.filter((h)=>visible(h) && !/^(?:ad|ad name|campaign|campaign name|ad set|ad set name|โฆษณา|ชื่อโฆษณา|แคมเปญ|ชื่อแคมเปญ|ชุดโฆษณา|ชื่อชุดโฆษณา|on\s*\/\s*off|off\s*\/\s*on|ปิด\s*\/\s*เปิด|เปิด\s*\/\s*ปิด)$/i.test((h.textContent??"").trim()));
  const horizontalAnchors = [...(scope?.querySelectorAll<HTMLElement>('[role="switch"],input[type="checkbox"],[role="checkbox"]')??[])]
    .filter((el)=>visible(el)&&!el.closest('[role="columnheader"]')&&el.getBoundingClientRect().top>horizontalHeaderBottom)
    .map((el)=>{const r=el.getBoundingClientRect();return r.top+r.height/2;}).sort((a,b)=>a-b)
    .filter((y,i,all)=>i===0||Math.abs(y-all[i-1])>8);
  const metricRows = (el:Element) => {
    if (el.closest('form,[role="dialog"],[aria-modal="true"]')) return false;
    const rect=el.getBoundingClientRect(), seen=new Set<number>();
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    let visited=0;
    while(walker.nextNode()&&visited++<5000){
      const parent=walker.currentNode.parentElement, text=walker.currentNode.textContent?.trim();
      if(!parent||!text||!visible(parent)||parent.closest('input,textarea,select,button,[role="button"],[role="columnheader"],[contenteditable="true"],script,style')||
        !/^(?:[฿$€£]?\s*\d[\d,.]*(?:\s*%)?|[—–-])$/.test(text))continue;
      const range=document.createRange();range.selectNodeContents(walker.currentNode);const r=range.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      if(!r.width||!r.height||x<Math.max(0,rect.left)||x>Math.min(innerWidth,rect.right)||y<Math.max(horizontalHeaderBottom,rect.top)||y>Math.min(innerHeight,rect.bottom)||
        !numericHeaders.some(h=>{const b=h.getBoundingClientRect();return x>=b.left&&x<=b.right;}))continue;
      const row=horizontalAnchors.findIndex((center,i)=>y>=(i?(horizontalAnchors[i-1]+center)/2:center-30)&&y<(i<horizontalAnchors.length-1?(center+horizontalAnchors[i+1])/2:center+30));
      if(row>=0)seen.add(row);
      if(seen.size>=(hasRows(el)?1:2))return true;
    }
    return false;
  };
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
    // Main metric bodies may have no switches/checkboxes (those live in a
    // frozen name pane). Require numeric cells in observed row/column bands;
    // row markers alone never authorize panning a frozen name-only pane.
    const matched = candidates.filter((el) => (horizontal ? numericHeaders : headers).some((h) => el.contains(h)) ||
      (horizontal&&headers.some(h=>el.contains(h))&&hasRows(el)) ||
      (horizontal ? metricRows(el) : !!el.querySelector(rowMarkers)));
    const reporting = horizontal ? matched.filter((el)=>!matched.some(other=>other!==el&&el.contains(other))) : matched;
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
      const pairedBody = reporting.some((el)=>metricRows(el)||
        (headers.some((h)=>el.contains(h))&&hasRows(el)));
      if (!pairedBody) return false; // Never move a separate header without its verified reporting body.
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
  let diagnostics: {
    headers: number;
    switches: number;
    checkboxes: number;
    rows: number;
    loading: number;
    debug?: unknown;
  } = {
    headers: 0,
    switches: 0,
    checkboxes: 0,
    rows: 0,
    loading: 0,
  };
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
    const chain = (el: Element) => {
      const values: { tag: string; role: string | null; top: number; height: number }[] = [];
      for (
        let current: Element | null = el;
        current && current !== document.documentElement && values.length < 8;
        current = current.parentElement
      ) {
        const rect = current.getBoundingClientRect();
        values.push({
          tag: current.tagName.toLowerCase(),
          role: current.getAttribute("role"),
          top: Math.round(rect.top),
          height: Math.round(rect.height),
        });
      }
      return values;
    };
    const visibleSwitches = [
      ...document.querySelectorAll<HTMLElement>('[role="switch"]'),
    ].filter(visible);
    const visibleCheckboxes = [
      ...document.querySelectorAll<HTMLElement>(
        'input[type="checkbox"],[role="checkbox"]',
      ),
    ].filter(visible);
    diagnostics = {
      headers: headers.length,
      switches: below('[role="switch"]'),
      checkboxes: below('input[type="checkbox"],[role="checkbox"]'),
      rows: below('[role="row"],tbody tr'),
      loading: [...document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].filter(visible).length,
      debug: {
        header_labels: headers.slice(0, 16).map((el) =>
          (el as HTMLElement).innerText.trim(),
        ),
        switch_chain: visibleSwitches[0] ? chain(visibleSwitches[0]) : [],
        checkbox_chain: visibleCheckboxes[0]
          ? chain(visibleCheckboxes[0])
          : [],
        aria_rows: document.querySelectorAll('[aria-rowindex]').length,
        grid_roles: [
          ...document.querySelectorAll(
            '[role="grid"],[role="treegrid"],[role="table"],[role="rowgroup"]',
          ),
        ]
          .filter(visible)
          .slice(0, 6)
          .map((el) => ({
            role: el.getAttribute("role"),
            rows: el.querySelectorAll('[role="row"],tbody tr').length,
            gridcells: el.querySelectorAll(
              '[role="gridcell"],[role="cell"]',
            ).length,
          })),
      },
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
 * Return reporting rows to the physical top of the table before a new capture
 * level. A previous job may leave the virtualized body at its last page.
 */
export async function resetReportingRows() {
  const settle = (ms: number) =>
    new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, ms)));
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const headers = [...document.querySelectorAll('[role="columnheader"],thead th')].filter(visible);
  if (!headers.length) return { reset: false, reason: "no_headers", offsets: [] };
  const headerBottom = Math.max(...headers.map((h) => h.getBoundingClientRect().bottom));
  const rowMarkers = () =>
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
          const clip = a.getBoundingClientRect();
          if (cy < clip.top || cy > clip.bottom) return false;
        }
        return true;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const markers = rowMarkers();
  if (!markers.length) return { reset: false, reason: "no_rows", offsets: [] };
  const seen = new Set<Element>();
  const offsets: { from: number; to: number }[] = [];
  for (const marker of markers) {
    for (let a = marker.parentElement; a && a !== document.body; a = a.parentElement) {
      if (seen.has(a) || headers.some((h) => a!.contains(h))) continue;
      const style = getComputedStyle(a);
      if (
        a.scrollHeight <= a.clientHeight + 2 ||
        !["auto", "scroll", "hidden"].includes(style.overflowY)
      )
        continue;
      seen.add(a);
      const from = a.scrollTop;
      if (from > 0) a.scrollTop = 0;
      offsets.push({ from, to: a.scrollTop });
    }
  }
  if (offsets.some(({ from, to }) => from > to + 1)) await settle(350);
  // Re-query after scrolling. The pre-reset markers can be detached or moved
  // by virtualization; scrolling one of those back into view would undo the
  // reset and leave the new job at the old bottom page.
  const first = rowMarkers()[0];
  const firstRect = first?.getBoundingClientRect();
  if (
    first &&
    firstRect &&
    (firstRect.top < headerBottom - 2 || firstRect.top > headerBottom + 120)
  )
    first.scrollIntoView({ block: "start", inline: "nearest" });
  const changed = offsets.filter(({ from, to }) => from > to + 1).length;
  return {
    reset: changed > 0,
    reason: changed > 0 ? null : "already_at_start",
    changed,
    offsets,
  };
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
  // Compare row identities/name cells and actual body offsets, never metric
  // samples or page coordinates (a refresh/page nudge is not row paging).
  const level = location.pathname.replace(/\/$/, "").split("/").at(-1);
  const headerText = (h: Element) =>
    ((h as HTMLElement).innerText || h.textContent || "").trim();
  const namePattern = level === "ads"
    ? /^(ad|ad name|โฆษณา|ชื่อโฆษณา)$/i
    : level === "adsets"
      ? /^(ad set|ad set name|ชุดโฆษณา|ชื่อชุดโฆษณา)$/i
      : /^(campaign|campaign name|แคมเปญ|ชื่อแคมเปญ)$/i;
  const idPattern = level === "ads"
    ? /^(ad id|id โฆษณา|รหัสโฆษณา)$/i
    : level === "adsets"
      ? /^(ad set id|id ชุดโฆษณา|รหัสชุดโฆษณา)$/i
      : /^(campaign id|id แคมเปญ|รหัสแคมเปญ)$/i;
  // Stable IDs are preferred. Names are only a fallback when the visible
  // report omits an ID column.
  const identityHeader = headers.find((h) => idPattern.test(headerText(h)));
  const nameHeader = headers.find((h) => namePattern.test(headerText(h)));
  const contentHeader = identityHeader ?? nameHeader;
  const contentBand = contentHeader?.getBoundingClientRect();
  const contentAt = (y: number) => {
    if (!contentBand) return "";
    const x = Math.min(
      contentBand.right - 2,
      Math.max(contentBand.left + 2, contentBand.left + 20),
    );
    const hits = document
      .elementsFromPoint(x, y)
      .filter((el) => {
        if (!visible(el) || el.closest('input,textarea,button,[role="button"]'))
          return false;
        const r = el.getBoundingClientRect();
        return r.left < contentBand.right && r.right > contentBand.left;
      })
      .sort(
        (a, b) =>
          a.getBoundingClientRect().width * a.getBoundingClientRect().height -
          b.getBoundingClientRect().width * b.getBoundingClientRect().height,
      );
    for (const el of hits) {
      const text = ((el as HTMLElement).innerText || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text.length > 300) continue;
      if (!identityHeader || /^\d+$/.test(text) || /\b\d{8,}\b/.test(text))
        return text.slice(0, 250);
    }
    return "";
  };
  const idParam = level === "ads" ? "selected_ad_ids" : level === "adsets" ? "selected_adset_ids" : "selected_campaign_ids";
  const signature = () => {
    const current = rows();
    const values = current.map((el, i) => {
      const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
      const previous = current[i - 1]?.getBoundingClientRect(), next = current[i + 1]?.getBoundingClientRect();
      const low = previous ? (previous.top + previous.height / 2 + y) / 2 : y - 30;
      const high = next ? (next.top + next.height / 2 + y) / 2 : y + 30;
      const ids = new Set([...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(visible).flatMap((a) => {
        const rect = a.getBoundingClientRect(), cy = rect.top + rect.height / 2;
        if (!contentBand || cy < low || cy >= high || rect.left + rect.width / 2 < contentBand.left || rect.left + rect.width / 2 > contentBand.right) return [];
        const link = new URL(a.href, location.href), id = link.searchParams.get(idParam);
        return ["adsmanager.facebook.com", "business.facebook.com"].includes(link.hostname) && id && /^\d+$/.test(id) ? [id] : [];
      }));
      if (ids.size === 1) return `id:${[...ids][0]}`;
      const text = contentAt(y);
      return text ? `${identityHeader ? "idcol" : "name"}:${text}` : "";
    });
    const offsets: number[] = [];
    for (let a = current[0]?.parentElement; a; a = a.parentElement) {
      if (a.scrollHeight > a.clientHeight + 2 && !headers.some((h) => a!.contains(h)) &&
        ["auto", "scroll", "hidden"].includes(getComputedStyle(a).overflowY)) offsets.push(a.scrollTop);
    }
    return { rows: current.length, values, offsets };
  };
  const anchors = rows();
  if (anchors.length < 2) return { moved: false, method: "none", tried, reason: "fewer_than_two_rows" };
  const last = anchors[anchors.length - 1];
  const before = signature();
  const delta = Math.max(
    40,
    last.getBoundingClientRect().top - anchors[0].getBoundingClientRect().top,
  );
  const changed = () => {
    const after = signature();
    const seen = new Set(before.values.filter(Boolean));
    // Losing the last visible row at a clip edge is not a page. A row step
    // must introduce at least one identity that was not already visible.
    return after.values.some((value) => !!value && !seen.has(value));
  };
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

/** Read-only planning for one bounded native report wheel. No selectors or
 * coordinates are accepted remotely; only a guarded Extension caller uses it.
 * The fingerprint stays opaque so diagnostics do not include customer text.
 */
export function probeReportingPage(account: string) {
  const u = new URL(location.href);
  if (
    u.protocol !== "https:" ||
    u.port ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(u.hostname) ||
    !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
    u.searchParams.get("act") !== account
  )
    return { ready: false as const, reason: "reporting_context_changed" };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.top < innerHeight &&
      r.bottom > 0 &&
      r.left < innerWidth &&
      r.right > 0 &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  };
  const norm = (value: string | null | undefined) =>
    (value ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const pageMatch = norm(document.body.innerText).match(
    /(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)\s*(?:จาก|of)\s*(\d[\d,]*)/i,
  );
  const page = pageMatch
    ? {
        from: Number(pageMatch[1].replaceAll(",", "")),
        to: Number(pageMatch[2].replaceAll(",", "")),
        total: Number(pageMatch[3].replaceAll(",", "")),
      }
    : null;
  const page_token = u.searchParams.get("ad_page_id");
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      'button,[role="button"],a[href]',
    ),
  ].filter(visible);
  const next = buttons.find((button) => {
    const text = norm(
      button.getAttribute("aria-label") ??
        button.getAttribute("title") ??
        button.innerText,
    );
    if (!/^(?:ถัดไป|next|next page)$/i.test(text)) return false;
    if (
      button.hasAttribute("disabled") ||
      button.getAttribute("aria-disabled") === "true"
    )
      return false;
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return !!hit && (button === hit || button.contains(hit) || hit.contains(button));
  });
  if (!next)
    return {
      ready: true as const,
      page,
      page_token,
      next: null,
      reason:
        page && page.to >= page.total
          ? "last_page"
          : "next_page_unavailable",
    };
  const r = next.getBoundingClientRect();
  return {
    ready: true as const,
    page,
    page_token,
    next: {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      label: norm(next.innerText || next.getAttribute("aria-label")),
    },
    signature: `${page_token ?? ""}:${page ? `${page.from}:${page.to}:${page.total}` : ""}`,
  };
}

export async function clickNextReportPage(account: string) {
  const u = new URL(location.href);
  if (
    u.protocol !== "https:" ||
    u.port ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(u.hostname) ||
    !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
    u.searchParams.get("act") !== account
  )
    return { paged: false as const, reason: "reporting_context_changed" };
  const norm = (value: string | null | undefined) =>
    (value ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.top < innerHeight &&
      r.bottom > 0 &&
      r.left < innerWidth &&
      r.right > 0 &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  };
  const page = () => {
    const match = norm(document.body.innerText).match(
      /(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)\s*(?:จาก|of)\s*(\d[\d,]*)/i,
    );
    return match
      ? `${match[1]}:${match[2]}:${match[3]}:${u.searchParams.get("ad_page_id") ?? ""}`
      : `:${u.searchParams.get("ad_page_id") ?? ""}`;
  };
  const next = [
    ...document.querySelectorAll<HTMLElement>(
      'button,[role="button"],a[href]',
    ),
  ].find((button) => {
    if (!visible(button)) return false;
    const text = norm(
      button.getAttribute("aria-label") ??
        button.getAttribute("title") ??
        button.innerText,
    );
    return (
      /^(?:ถัดไป|next|next page)$/i.test(text) &&
      !button.hasAttribute("disabled") &&
      button.getAttribute("aria-disabled") !== "true"
    );
  });
  if (!next)
    return { paged: false as const, reason: "next_page_unavailable" };
  const before = page();
  next.click();
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (page() !== before)
      return { paged: true as const, method: "dom_click" as const };
  }
  return { paged: false as const, reason: "reporting_page_unchanged" };
}

export function probeReportingScroll(account: string) {
  const u = new URL(location.href);
  const unavailable = (reason: string) => ({ ready: false as const, reason });
  if (u.protocol !== "https:" || u.port ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(u.hostname) ||
    !/^\/adsmanager\/manage\/(campaigns|adsets|ads)\/?$/.test(u.pathname) ||
    u.searchParams.get("act") !== account)
    return unavailable("reporting_context_changed");
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 &&
      r.left < innerWidth && r.right > 0 && s.display !== "none" && s.visibility !== "hidden";
  };
  if ([...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(visible))
    return unavailable("reporting_view_blocked");
  const headers = [...document.querySelectorAll('[role="columnheader"],thead th')].filter(visible);
  if (headers.length < 2) return unavailable("no_reporting_headers");
  const bottom = Math.max(...headers.map((el) => el.getBoundingClientRect().bottom));
  const below = (el: Element) => {
    if (!visible(el) || el.closest('[role="columnheader"],thead')) return false;
    const r = el.getBoundingClientRect(), cy = r.top + r.height / 2;
    if (cy <= bottom || r.bottom > innerHeight) return false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowY === "visible") continue;
      const clip = a.getBoundingClientRect();
      if (cy < clip.top || cy > clip.bottom) return false;
    }
    return true;
  };
  let markers = [...document.querySelectorAll<HTMLElement>('[role="switch"],input[type="checkbox"],[role="checkbox"]')].filter(below);
  if (!markers.length)
    markers = [...document.querySelectorAll<HTMLElement>('[role="row"],tbody tr')].filter(below);
  markers.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  // A row can have both a checkbox and switch: take one anchor per row band.
  const rows = markers.filter((el, i) => i === 0 ||
    Math.abs(el.getBoundingClientRect().top - markers[i - 1].getBoundingClientRect().top) > 8);
  if (!rows.length)
    return {
      ...unavailable("no_visible_reporting_rows"),
      marker_diagnostics: {
        headers: headers.length,
        header_bottom: bottom,
        switches: [...document.querySelectorAll('[role="switch"]')].filter(visible).length,
        checkboxes: [...document.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].filter(visible).length,
        row_elements: [...document.querySelectorAll('[role="row"],tbody tr')].filter(visible).length,
      },
    };
  let scope: Element | null = rows[0].parentElement;
  while (scope && !(headers.every((el) => scope!.contains(el)) && rows.every((el) => scope!.contains(el))))
    scope = scope.parentElement;
  if (!scope) return unavailable("no_reporting_scope");
  const level = u.pathname.replace(/\/$/, "").split("/").at(-1);
  const label = (el: Element) => ((el as HTMLElement).innerText || el.textContent || "").trim();
  const namePattern = level === "ads" ? /^(ad|ad name|โฆษณา|ชื่อโฆษณา)$/i
    : level === "adsets" ? /^(ad set|ad set name|ชุดโฆษณา|ชื่อชุดโฆษณา)$/i
    : /^(campaign|campaign name|แคมเปญ|ชื่อแคมเปญ)$/i;
  const idPattern = level === "ads" ? /^(ad id|id โฆษณา|รหัสโฆษณา)$/i
    : level === "adsets" ? /^(ad set id|id ชุดโฆษณา|รหัสชุดโฆษณา)$/i
    : /^(campaign id|id แคมเปญ|รหัสแคมเปญ)$/i;
  const nameBand = headers.find((el) => namePattern.test(label(el)))?.getBoundingClientRect();
  const idBand = headers.find((el) => idPattern.test(label(el)))?.getBoundingClientRect();
  const idParam = level === "ads" ? "selected_ad_ids" : level === "adsets" ? "selected_adset_ids" : "selected_campaign_ids";
  const texts: { x: number; y: number; text: string }[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let visited = 0;
  while (walker.nextNode() && visited++ < 25000) {
    const parent = walker.currentNode.parentElement;
    if (!parent || !visible(parent) || parent.closest('button,[role="button"],input,textarea,script,style,[aria-hidden="true"]')) continue;
    const text = walker.currentNode.textContent?.trim();
    if (!text) continue;
    const range = document.createRange(); range.selectNodeContents(walker.currentNode);
    const rect = range.getBoundingClientRect();
    if (rect.width && rect.height) texts.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: text.slice(0, 250) });
  }
  const links = [...scope.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(visible);
  const centers = rows.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
  const identities = rows.map((el, i) => {
    const center = centers[i], previous = centers[i - 1] ?? center - 60, next = centers[i + 1] ?? center + 60;
    const low = (previous + center) / 2, high = (center + next) / 2;
    const inBand = (band: DOMRect | undefined, x: number) => !!band && x >= band.left && x <= band.right;
    const names = texts.filter((t) => t.y >= low && t.y < high && inBand(nameBand, t.x)).map((t) => t.text);
    const ids = new Set(texts.filter((t) => t.y >= low && t.y < high && inBand(idBand, t.x) && /^\d+$/.test(t.text)).map((t) => t.text));
    for (const link of links) {
      const rect = link.getBoundingClientRect(), y = rect.top + rect.height / 2;
      if (y < low || y >= high || !inBand(nameBand, rect.left + rect.width / 2)) continue;
      const target = new URL(link.href, location.href), value = target.searchParams.get(idParam);
      if (["adsmanager.facebook.com", "business.facebook.com"].includes(target.hostname) &&
        (!target.searchParams.has("act") || target.searchParams.get("act") === account) && value && /^\d+$/.test(value)) ids.add(value);
    }
    return { id: ids.size === 1 ? [...ids][0] : null, name: names.join(" ") };
  });
  const samples = identities.map((r) => r.id && identities.filter((other) => other.id === r.id).length === 1
    ? `id:${r.id}` : r.name ? `name:${r.name}` : "");
  if (!samples.some(Boolean))
    return unavailable("row_fingerprint_unavailable");
  // Paging is proven only by row count/identity changes. Body scroll_top is a
  // diagnostic in target.body_offsets, never movement proof: a virtualized
  // table can advance its offset while repainting the same last rows.
  const fingerprint = (value: string) => {
    let hash = 2166136261;
    for (const c of value)
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16);
  };
  const row_fingerprints = samples.map((sample) => sample ? fingerprint(sample) : "");
  let hash = 2166136261;
  for (const c of JSON.stringify(samples)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const first = rows[0].getBoundingClientRect(), last = rows.at(-1)!.getBoundingClientRect();
  // The name cell may itself be an Edit button. Plan from visible column/row
  // interiors and hit-test each candidate; never weaken the control exclusion
  // just because the first point is blocked. At most 24 local observations.
  type ColumnKind = "metric" | "identity" | "name" | "legacy" | "body";
  const stickyColumn = (header: Element) => {
    for (let a: Element | null = header; a && a !== scope; a = a.parentElement) {
      const style = getComputedStyle(a);
      if (style.position === "sticky" && (style.left !== "auto" || style.right !== "auto")) return true;
    }
    return false;
  };
  const columnBands = headers.filter((h) => !h.querySelector('input,[role="checkbox"],[role="switch"]'))
    .map((h) => ({ rect: h.getBoundingClientRect(), sticky: stickyColumn(h), column_kind: (namePattern.test(label(h)) ? "name" : idPattern.test(label(h)) ? "identity" : /^(?:on\s*\/\s*off|off\s*\/\s*on|ปิด\s*\/\s*เปิด|เปิด\s*\/\s*ปิด|select all|เลือกทั้งหมด)$/i.test(label(h)) ? "legacy" : "metric") as ColumnKind }))
    .filter(({rect}) => Math.min(innerWidth - 2, rect.right) - Math.max(2, rect.left) > 12)
    .sort((a,b) => a.rect.left - b.rect.left)
    .filter((band,i,all)=>all.findIndex((other)=>Math.abs(other.rect.left-band.rect.left)<2 && Math.abs(other.rect.right-band.rect.right)<2)===i)
    .map((band, band_index) => ({ ...band, band_index }))
    .sort((a,b) => Number(a.sticky) - Number(b.sticky) ||
      ({metric:0,identity:1,name:2,legacy:3,body:4}[a.column_kind] - {metric:0,identity:1,name:2,legacy:3,body:4}[b.column_kind]) ||
      b.rect.left - a.rect.left);
  const ys = [...new Set([centers[Math.floor(centers.length / 2)], centers[0], centers.at(-1)!])]
    .filter((y) => y > bottom + 2 && y < innerHeight - 2);
  const rejected: { tag: string; role: string; reason: string | null }[] = [];
  let attempts = 0;
  const targets: {
    x: number;
    y: number;
    column_kind: ColumnKind;
    band_index: number;
    reveal_only?: boolean;
    body_offsets: {
      tag: string;
      role: string | null;
      overflow_y: string;
      scroll_top: number;
      client_height: number;
      scroll_height: number;
      at_top: boolean;
      at_bottom: boolean;
      contains_headers: boolean;
      contains_rows: boolean;
    }[];
  }[] = [];
  // Meta leaves a small gutter below a scrollbar thumb and can sub-pixel-round
  // native scroll offsets. Keep the tolerance bounded so a near-bottom view is
  // recognized without treating an arbitrary partial page as the end.
  const scrollEdgeTolerance = 8;
  const collectBodyOffsets = (hit: Element): (typeof targets)[number]["body_offsets"] => {
    const body_offsets: (typeof targets)[number]["body_offsets"] = [];
    for (let a: Element | null = hit; a && a !== document.documentElement; a = a.parentElement) {
      if (body_offsets.length >= 6) break;
      const style = getComputedStyle(a);
      if (a.scrollHeight > a.clientHeight + 2 &&
        ["auto", "scroll", "hidden", "clip"].includes(style.overflowY))
        body_offsets.push({
          tag: /^(?:div|section|main|article|aside|ul|ol|table|tbody|body)$/.test(a.tagName.toLowerCase())
            ? a.tagName.toLowerCase()
            : "other",
          role: /^(?:grid|treegrid|rowgroup|list|region|table|none|presentation)$/.test(a.getAttribute("role") ?? "")
            ? a.getAttribute("role")
            : (a.getAttribute("role") ? "other" : null),
          overflow_y: style.overflowY,
          scroll_top: a.scrollTop,
          client_height: a.clientHeight,
          scroll_height: a.scrollHeight,
          at_top: a.scrollTop <= scrollEdgeTolerance,
          at_bottom: a.scrollTop + a.clientHeight >= a.scrollHeight - scrollEdgeTolerance,
          contains_headers: headers.some((h) => a!.contains(h)),
          contains_rows: rows.some((row) => a!.contains(row)),
        });
    }
    return body_offsets;
  };
  const scopeRect = scope.getBoundingClientRect();
  const strictBlocked = (hit: Element | null) =>
    hit?.closest('[role="dialog"],input,textarea,select,button,[role="button"],a[href],[role="link"],[role="switch"],[role="checkbox"],[role="radio"],[contenteditable="true"]');
  let body_target_count = 0;
  const pushBodyTarget = (x: number, y: number, revealOnly = false) => {
    if (targets.length >= 10 || attempts >= 60) return false;
    if (targets.some((target) => Math.abs(target.x - x) < 2 && Math.abs(target.y - y) < 2)) return false;
    attempts++;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !scope.contains(hit) || strictBlocked(hit)) return false;
    targets.push({
      x,
      y,
      column_kind: "body",
      band_index: columnBands.length + body_target_count++,
      body_offsets: collectBodyOffsets(hit),
      ...(revealOnly ? { reveal_only: true } : {}),
    });
    return true;
  };
  const visibleScrollbars = [...document.querySelectorAll('[role="scrollbar"]')]
    .filter(visible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 4 && r.right > 0 && r.left < innerWidth && r.bottom > bottom && r.top < innerHeight;
    })
    .slice(0, 2);
  // Meta's virtualized grid uses a custom right-edge scrollbar that has no
  // scrollbar role and is not an ancestor of the rows. Its track is a narrow,
  // tall element; the thumb may be the same node or a nested child. Detect it
  // from local geometry and expose one bounded drag target under the same lease.
  const rightEdge = Math.min(scopeRect.right, innerWidth);
  // Meta's custom scrollbar can be a sibling of the grid scope rather than a
  // descendant of the common header/row ancestor. Search the nearest reporting
  // ancestors too, while keeping the same narrow right-edge geometry filter.
  const scrollbarRoots = new Set<Element>();
  for (
    let root: Element | null = scope;
    root && root !== document.body && scrollbarRoots.size < 4;
    root = root.parentElement
  )
    scrollbarRoots.add(root);
  const scrollbarElements = new Set<HTMLElement>();
  for (const root of scrollbarRoots)
    for (const element of root.querySelectorAll<HTMLElement>(
      '[role="scrollbar"],[tabindex],div',
    ))
      scrollbarElements.add(element);
  const scrollbarTracks = [...scrollbarElements]
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ element, rect }) =>
      rect.width >= 4 && rect.width <= 28 && rect.height >= 80 &&
      rect.left >= scopeRect.left && rect.right <= innerWidth + 2 &&
      rect.right >= rightEdge - 120 && rect.top >= bottom - 8 &&
      rect.bottom <= innerHeight + 2 &&
      !strictBlocked(element) &&
      !headers.some((header) => element.contains(header)) &&
      !rows.some((row) => element.contains(row)))
    .sort((a, b) => b.rect.height - a.rect.height || b.rect.right - a.rect.right)
    .slice(0, 2);
  const vertical_scrollbar = scrollbarTracks.map(({ element, rect }) => {
    const thumb = [...element.querySelectorAll<HTMLElement>('*')]
      .map((child) => ({ child, rect: child.getBoundingClientRect() }))
      .filter(({ rect: thumbRect }) =>
        thumbRect.width >= 4 && thumbRect.width <= rect.width + 2 &&
        thumbRect.height >= 20 && thumbRect.height < rect.height - 4 &&
        thumbRect.right >= rect.right - 4 && thumbRect.left <= rect.left + 4)
      .sort((a, b) => b.rect.height - a.rect.height)[0];
    const thumbRect = thumb?.rect ?? rect;
    const x = Math.min(innerWidth - 2, Math.max(2, Math.round(thumbRect.left + thumbRect.width / 2)));
    const y = Math.min(innerHeight - 3, Math.max(bottom + 2, Math.round(thumbRect.top + Math.min(thumbRect.height / 2, 48))));
    const drag_y = Math.min(
      innerHeight - 3,
      rect.bottom - 2,
      y + Math.max(80, Math.min(320, Math.round(rect.height * 0.55))),
    );
    return {
      x,
      y,
      drag_y,
      track_top: Math.round(rect.top),
      thumb_top: Math.round(thumbRect.top),
      track_height: Math.round(rect.height),
      thumb_height: Math.round(thumbRect.height),
      has_nested_thumb: !!thumb,
      at_top: thumbRect.top <= rect.top + scrollEdgeTolerance,
      at_bottom: thumbRect.bottom >= rect.bottom - scrollEdgeTolerance,
    };
  }).find(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return (
      !!hit &&
      [...scrollbarRoots].some((root) => root.contains(hit)) &&
      !strictBlocked(hit)
    );
  });
  // A custom scrollbar can be the only paging owner even when every metric
  // column ignores the wheel. Probe it before metric bands consume the target
  // budget; otherwise a 14-column report never reaches the scrollbar.
  for (const bar of visibleScrollbars) {
    if (targets.length >= 10 || attempts >= 60) break;
    const r = bar.getBoundingClientRect();
    const x = Math.min(innerWidth - 2, Math.max(2, r.left + r.width / 2));
    const barYs = [
      r.top + r.height / 2,
      r.top + r.height * 0.25,
      r.top + r.height * 0.75,
    ].filter((y) => y > bottom + 2 && y < innerHeight - 2);
    for (const y of barYs) if (pushBodyTarget(x, y)) break;
  }
  // The grid may be wider than the viewport. Derive the gutter from the
  // visible right edge, not the off-screen scope right edge.
  const visibleRight = Math.min(scopeRect.right, innerWidth);
  const gutterXs = [
    visibleRight - 2,
    visibleRight - 6,
    visibleRight - 12,
    visibleRight - 24,
    scopeRect.right - 8,
  ]
    .filter((x, index, all) =>
      x > Math.max(2, scopeRect.left + 8) && x < innerWidth - 2 && all.indexOf(x) === index,
    );
  for (const x of gutterXs) {
    if (targets.length >= 10 || attempts >= 60) break;
    for (const y of ys) if (pushBodyTarget(x, y, true)) break;
  }
  for (const band of columnBands) {
    if (targets.length >= 10 || attempts >= 60) break;
    const left = Math.max(2, band.rect.left), right = Math.min(innerWidth - 2, band.rect.right);
    const center = (left + right) / 2;
    // Distinct columns are distinct wheel-routing opportunities. A frozen safe
    // name pane is deliberately behind metric columns, rather than ending the
    // plan after the first safe hit. Each attempt must re-probe this plan.
    const xs = [center, (left + center) / 2];
    let found = false;
    for (const x of xs) {
      for (const y of ys) {
      if (attempts >= 60) break;
      attempts++;
      const hit = document.elementFromPoint(x, y);
      const blocked = hit?.closest('[role="dialog"],input,textarea,select,button,[role="button"],a[href],[role="link"],[role="switch"],[role="checkbox"],[role="radio"],[contenteditable="true"]');
      const reason = !hit ? "no_hit" : !scope.contains(hit) ? "outside_reporting_scope" : blocked ? "interactive_control" : null;
      if (hit && !blocked && scope.contains(hit)) {
        const body_offsets = collectBodyOffsets(hit);
        targets.push({ x, y, column_kind: band.column_kind, band_index: band.band_index, body_offsets });
        found = true;
        break;
      }
      if (rejected.length < 8) {
        const tag = (blocked ?? hit)?.tagName.toLowerCase() ?? "none";
        const role = (blocked ?? hit)?.getAttribute("role") ?? "none";
        rejected.push({
          tag: /^(div|span|button|input|textarea|select|a|table|tr|td|th|section|main|body|html|none)$/.test(tag) ? tag : "other",
          role: /^(button|link|checkbox|switch|radio|textbox|combobox|dialog|row|gridcell|cell|grid|table|none|presentation)$/.test(role) ? role : "other",
          reason,
        });
      }
      }
      if (found || attempts >= 60) break;
    }
  }
  const target_diagnostics = {
    candidate_count: attempts, rejected, planned_targets: targets.length,
    scroll_diagnostics: {
      scope_rect: {
        x: Math.round(scopeRect.left), y: Math.round(scopeRect.top),
        width: Math.round(scopeRect.width), height: Math.round(scopeRect.height),
      },
      visible_right: Math.round(visibleRight),
      scrollbar_count: visibleScrollbars.length,
      scrollbars: visibleScrollbars.map((bar) => {
        const r = bar.getBoundingClientRect();
        return {
          tag: bar.tagName.toLowerCase(),
          orientation: bar.getAttribute("aria-orientation"),
          x: Math.round(r.left), y: Math.round(r.top),
          width: Math.round(r.width), height: Math.round(r.height),
        };
      }),
      body_targets: targets.filter((target) => target.column_kind === "body").length,
      vertical_scrollbar_candidates: scrollbarTracks.map(({ rect }) => ({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
      })),
      vertical_scrollbar: vertical_scrollbar ?? null,
    },
    safe_bands: targets.map(({column_kind,band_index}) => ({column_kind,band_index})),
    targets: targets.map(({ column_kind, band_index, body_offsets, reveal_only }) => ({
      column_kind,
      band_index,
      ...(reveal_only ? { reveal_only: true } : {}),
      body_offsets: body_offsets.map(
        ({ tag, role, overflow_y, scroll_top, client_height, scroll_height, at_top, at_bottom, contains_headers, contains_rows }) => ({
          tag,
          role,
          overflow_y,
          scroll_top,
          client_height,
          scroll_height,
          at_top,
          at_bottom,
          contains_headers,
          contains_rows,
        }),
      ),
    })),
    at_bottom:
      vertical_scrollbar?.at_bottom === true ||
      targets.some((target) =>
        target.body_offsets.some(
          (offset) =>
            offset.scroll_height > offset.client_height + 2 && offset.at_bottom,
        ),
      ),
  };
  if (!targets.length) return { ...unavailable("reporting_target_occluded"), target_diagnostics };
  const horizontalCandidates = new Set<HTMLElement>(
    scope.querySelectorAll<HTMLElement>("*"),
  );
  for (const element of [...headers, ...rows]) {
    for (
      let ancestor = element.parentElement;
      ancestor && ancestor !== document.body;
      ancestor = ancestor.parentElement
    )
      horizontalCandidates.add(ancestor as HTMLElement);
  }
  const horizontal_offsets = [...horizontalCandidates]
    .filter(
      (el) =>
        el.scrollWidth > el.clientWidth + 2 &&
        ["auto", "scroll", "hidden"].includes(getComputedStyle(el).overflowX) &&
        visible(el),
    )
    .slice(0, 16)
    .map((el) => ({
      scroll_left: el.scrollLeft,
      client_width: el.clientWidth,
      scroll_width: el.scrollWidth,
      contains_headers: headers.some((header) => el.contains(header)),
      contains_rows: rows.some((row) => el.contains(row)),
    }));
  const header_projection = headers
    .filter(visible)
    .map((header) => {
      const rect = header.getBoundingClientRect();
      return {
        label: label(header).slice(0, 120),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      };
    });
  return {
    ready: true as const, signature: `${rows.length}:${hash >>> 0}`, rows: rows.length,
    row_fingerprints,
    x: targets[0].x, y: targets[0].y, targets,
    deltaY: Math.min(600, Math.max(40, last.top - first.top)),
    deltaX: Math.min(600, Math.max(180, Math.round(innerWidth * 0.45))),
    horizontal_offsets,
    header_projection,
    vertical_scrollbar: vertical_scrollbar ?? null,
    horizontal_signature: JSON.stringify({
      offsets: horizontal_offsets.map((offset) => offset.scroll_left),
      headers: header_projection,
    }),
    target_diagnostics,
  };
}
