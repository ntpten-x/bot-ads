# Validation record — 2026-11-15

## CSV-first reconciliation — 2026-11-17

`parseReport()` now returns a structured `reconciliation` object plus
`scope_coverage`. A successful import requires expected row count and spend to
match; an optional expected date interval is checked when supplied. The
whole-account `coverage` remains `unverified` and is never promoted by a
file-level match.

Saved CSV observations receive server-stamped
`raw._import_reconciliation` provenance after validation. The normal export
therefore carries proof that the row came from a reconciled file, while
analysis still reports `verified_import_rows` separately. DOM rows are
`not_applicable`; old CSV rows without proof are `unverified`.

Analysis now classifies `csv`, `dom_capture` and `unknown` sources, sorts CSV
groups first and includes source in the comparable group key. CSV and DOM rows
with the same IDs and conditions remain separate groups and their totals are
never summed. This is source separation, not a claim that DOM is a second
complete report.

Validation passed:

- `npm test` — 73/73, including reconciliation success/mismatch/missing-input
  cases, source separation, and server-proof tamper handling.
- `npm run typecheck`, `npm run build`, `npm run build:web`.
- `npm run test:analysis` — preview/import/export persistence of
  reconciliation and provenance passed against local PostgreSQL.
- `npm run test:api` — validated import, idempotency, export and queue passed.
- `npm run test:web` — production UI flow passed, including reconciled-file
  status, source counts in filtered JSON export, and 2 verified imported rows
  in the saved analysis export.

The local API was restarted on `127.0.0.1:4318` and Next dev is running on
`127.0.0.1:9321`. No new live Meta collection or whole-account coverage claim
was made in this change.

## 0.6.41 live validation — 2026-11-17

After the user reloaded Extension `0.6.41` and opened a fresh local report
lease, the bounded Age run completed with job
`047d3c3e-64c5-447c-bdc1-ed25727550a2`. The run persisted 8 snapshots and
ended `needs_review` with no `level_warnings`. The native reset succeeded live
(`reset=true`, `method=native_scrollbar_drag`, scrollbar `at_top=true`) and the
final paging attempt returned `reporting_bottom_reached` with
`at_bottom=true`, `attempted_scrollbar=true` and no further row identity
change. This closes the false `visible_rows_unchanged` result from `0.6.40`.

The capture contained 198 raw Age observations and 35 unique parent Ad IDs.
Per-Age verified counts were `18–24: 34`, `25–34: 35`, `35–44: 32`,
`45–54: 26`, `55–64: 26` and `65+: 27`. Meta's footer reported 40 ads for the
whole report; it does not prove a separate total for each Age partition, so
these counts are exposed as `coverage=lower_bound` and must not be read as
`x/40` completeness for each partition. No cross-Age totals or whole-account
claim is supported.

`report.prepare messages` returned `applied=true`, `missing_required=[]` and
`missing_goal_metrics=["link_clicks","messaging_conversations"]`. The analysis
produced one messaging result group in every Age scope, with eligible ranking
counts `8/9/4/2/2/2`; no column, identity, timezone or filter blockers remained.
Examples include `MLBB` at `฿12.08` CPA for `18–24` and
`MLBB, Free Fire, Rov, PUBG Mobile` at `฿7.21` CPA for `55–64`. These are
bounded recommendations from verified visible rows, not whole-account totals.
`payment_error=true` stayed diagnostic-only and added no recommendation.

## 0.6.41 analysis coverage semantics fix — 2026-11-17

Core/API/web now distinguishes the scope of the footer row count. A level with
no active Breakdown keeps `reported_total_scope=partition` and may reach
`coverage=complete`. A Breakdown partition only sees a report-wide footer, so
it reports `reported_total_scope=report` and `coverage=lower_bound`; the UI
shows `ยืนยัน ID ได้ N แถว (ขั้นต่ำของกลุ่มนี้)` instead of `N/40`. The
`partition_total_unverified` recommendation explains that the footer total is
report-wide, and no code sums Age partitions into a report total. This change
does not require an Extension reload because the Extension bundle is unchanged;
restart the API/web processes to load it.

The web analysis panel now exposes explicit operator context controls for
timezone, attribution, no filters and no Breakdown. Only checked/entered values
are sent to `/captures/analysis`; values persist locally so the operator does
not have to re-enter them on every refresh. This is the missing bridge that
previously left the web panel blocked while `ads:agent` could already rank.

Validation: `npm run check` (strict typecheck, 71/71 unit tests and builds),
`test:capture-analysis-web` with a synthetic Breakdown partition, and the
specific `capture-analysis` test suite. After restarting the API, the live
`/captures/analysis` response for job
`047d3c3e-64c5-447c-bdc1-ed25727550a2` returned
`reported_scope=report` and `coverage=lower_bound` for all six Age scopes
(`34/35/32/26/26/27` verified rows against the report-wide `40`), with
`partition_total_unverified` recommendations and no `x/40` completeness claim.
The live browser check opened the `0.6.41` job, confirmed
`Asia/Bangkok` + no filters, and observed the `18–24` scope render its
messaging result group, spend, CPA and best/worst ranking instead of the
timezone/filter blockers. The web fixture also asserts that the panel sends
`timezone=Asia/Bangkok` and `confirm_no_filters=true`.

## 0.6.41 source validation — 2026-11-17

Live `0.6.40` after reload and a fresh lease completed a bounded Age run but
still ended `needs_review`. Job
`b344acdc-1d78-467c-a27f-b0056021c642` persisted 8 snapshots, 196
observations and 35 unique parent Ad IDs. Coverage against the 40 rows
reported by Meta remained partial in every scope: `18–24: 34/40`,
`25–34: 35/40`, `35–44: 32/40`, `45–54: 26/40`, `55–64: 26/40` and
`65+: 27/40`. No cross-scope totals or ranking over the whole account are
supported.

Paging steps 1–2 used `wheel`, steps 3–7 used `scroll_into_view`, and step 8
returned `visible_rows_unchanged`. At step 8 the custom scrollbar existed
(track top `311`, height `1102`; thumb top `1277`, height `131`), but its
thumb was only about 5px above the nominal track end. The previous 2px edge
tolerance therefore failed to classify the physical bottom. The native row
reset still returned `reporting_view_changed_before_input`; the DOM reset
reported `already_at_start`, so the native reset is not yet proven live.
`payment_error=true` remained diagnostic-only with zero payment
recommendations. Missing goal metrics were `link_clicks` and
`messaging_conversations`.

`0.6.41` changes:

- Native body and custom-scrollbar edges use a bounded 8px tolerance. A
  near-bottom thumb is recognized without treating an arbitrary partial page
  as complete.
- `target_diagnostics.at_bottom` can be established by the custom scrollbar
  itself, not only by a scrollable row ancestor.
- After debugger attach, paging and reset may rebase to a repainted view only
  after two consecutive identical probes. A continuously changing view still
  returns `reporting_view_changed_before_input`.
- `report-scroll` adds a fixture with a 5px bottom gutter and a fixture where
  attach performs one repaint before a trusted reset succeeds.

Checks on the `0.6.41` build passed: `npm run check` (strict typecheck, 70/70
unit tests and build), `test:reader`, `test:report-scroll`,
`test:report-input`, `test:report-probe`, `test:report-selected-columns`,
`test:report-columns`, `test:breakdown` and `test:capture-analysis-web`.
`dist/extension/manifest.json` and `reader_version` are `0.6.41`. The live
evidence above confirms native reset and physical-bottom handling; complete
per-Age or whole-account coverage is still not claimed.

## 0.6.40 source validation — 2026-11-17

Live `0.6.39` after reload and a fresh lease passed report columns and Age
Breakdown setup, but still stored one snapshot and ended `needs_review`. The
scroll diagnostics finally proved the custom-scrollbar hypothesis:
`attempted_scrollbar=true`, a `17px × 1102px` track and a `131px` nested thumb
were detected. The thumb was already at the bottom of the track, so the only
planned drag moved downward by about 86px and could not introduce new rows.
Coverage remained five parent Ad IDs in the top scopes (`18–24: 5`, `25–34: 5`,
`35–44: 5`, `45–54: 2`, `55–64: 3`, `65+: 4`) against 40 reported rows.
`payment_error=true` remained diagnostic-only with zero payment
recommendations.

`0.6.40` adds the missing reset:

- The custom-scrollbar probe exposes `track_top`, `thumb_top`, `at_top` and
  `at_bottom` in addition to the drag target.
- At job step zero, after the ordinary DOM reset, a guarded native reset checks
  the custom thumb. If it is not at the top, the Extension hovers the thumb,
  presses, drags it to the top of the track and releases it. Every debugger
  command rechecks the report lease, active tab, account, route, bridge and
  running job.
- Reset is accepted only when the thumb reaches `at_top` and the visible row
  signature changes. A thumb that reaches the top without a changed row set is
  reported as `reset_rows_unverified`; a missing track is
  `custom_scrollbar_not_found`.
- The browser fixture starts with the thumb near the bottom, verifies the
  trusted up-drag, changed row IDs, `thumb_top=0px`, method
  `native_scrollbar_drag` and debugger detach.

Checks on the `0.6.40` build passed: `npm run check` (strict typecheck, 70/70
unit tests and build), `test:reader`, `test:report-scroll`,
`test:report-input`, `test:report-probe`, `test:report-selected-columns`,
`test:report-columns`, `test:breakdown` and `test:capture-analysis-web`.
`dist/extension/manifest.json` and `reader_version` are `0.6.40`. Live
acceptance still requires reload, a fresh lease and a complete Age run; no
complete-coverage claim is supported yet.

## 0.6.39 source validation — 2026-11-17

Live `0.6.38` after reload and a fresh lease still failed the bounded Age
acceptance. The job stored one snapshot and ended `needs_review` with only the
first five parent Ad IDs (`18–24: 5`, `25–34: 5`, `35–44: 5`, `45–54: 2`,
`55–64: 3`, `65+: 4`) against 40 reported rows. Native paging returned
`visible_rows_unchanged` with `attempted_scrollbar=false`, no scrollbar
candidates and no vertical scrollbar geometry. `payment_error=true` remained a
diagnostic observation; it did not create a recommendation or block ranking.

Read-only comparison with the live DOM showed why the hover re-probe was not
enough: the custom scrollbar can be a sibling of the header/row reporting
scope. The `0.6.38` planner searched only inside that scope, so a hidden track
outside it could not become a hover target.

`0.6.39` changes:

- The custom-scrollbar search now includes the nearest reporting ancestors of
  the grid scope, bounded to four ancestors, while retaining the narrow
  right-edge geometry and strict interactive-control exclusion.
- Right-edge hover points are planned before the ten-target budget is consumed.
  Hover-only targets are not followed by a redundant wheel event.
- The custom-scrollbar fixture places its track outside the reporting scope and
  keeps it hidden until a trusted hover. The fixture verifies that hover
  reveals the track, the drag introduces new row identities, the method is
  `native_scrollbar_drag`, no wheel is sent and the debugger detaches.
- `payment_error` is diagnostic-only. It stays visible in delivery
  observations but is neither a recommendation nor a ranking/blocking signal,
  because adding ad credit clears Meta's billing message.

Checks on the `0.6.39` build passed: `npm run check` (strict typecheck, 70/70
unit tests and build), `test:reader`, `test:report-scroll`,
`test:report-input`, `test:report-probe`, `test:report-selected-columns`,
`test:report-columns`, `test:breakdown` and `test:capture-analysis-web`.
`dist/extension/manifest.json` is `0.6.39`. Live acceptance still requires
reload, a fresh lease and a complete Age run; no complete-coverage claim is
supported yet.

## 0.6.38 source validation — 2026-11-17

Live `0.6.37` improved the first bounded Age run from one snapshot to eight.
Coverage rose to 26–35 verified rows per Age scope, but the job still ended
`needs_review`: DOM paging succeeded seven times via `scroll_into_view`, then
the native path returned `reporting_input_timeout` at step 8. No target
diagnostics were emitted because the 12-second deadline expired before a
controlled result.

A second run on the same `0.6.37` view, using `--skip-prepare --skip-navigate`,
captured one snapshot. Its native attempt reported
`visible_rows_unchanged`, `attempted_scrollbar=false`, no scrollbar candidates
and no vertical scrollbar. This reproduced Meta's hover-dependent custom
scrollbar: the initial probe did not see it, so the planned wheel target never
triggered the drag.

`0.6.38` addresses both findings:

- Every native target hover is re-probed. If the right-edge custom scrollbar
  appears after the trusted pointer move, the newly visible thumb is dragged
  before that target is consumed as a wheel.
- The vertical input deadline increases from 12 to 30 seconds. Individual
  debugger operations remain bounded at 6 seconds, and every command still
  rechecks lease/tab/account/route/job authority.
- The fixture now starts with the custom track hidden by CSS. A trusted hover
  reveals it, the drag changes row IDs, returns `native_scrollbar_drag`, does
  not use a wheel and detaches the debugger.
- The probe normalizes an absent custom scrollbar to `null` instead of an
  omitted property.

Checks on `0.6.38` all passed: `npm run check` (strict typecheck, 70/70 unit
tests and build), `test:reader`, `test:report-scroll`, `test:report-input`,
`test:report-probe`, `test:report-columns`, `test:breakdown` and
`test:capture-analysis-web`. Live acceptance still requires reload, a fresh
lease and a full Age run; the eight-snapshot `0.6.37` result is useful evidence
but not completion.

## 0.6.37 source validation — 2026-11-17

Live `0.6.36` completed the bounded Age run without the debugger hang. The job
captured one snapshot and ended `needs_review`; columns and Breakdown checks
passed, but every vertical paging attempt returned `visible_rows_unchanged`.
Coverage remained five parent Ad IDs in the first four Age scopes and smaller
counts at the top of the table (`18–24: 5`, `25–34: 5`, `35–44: 5`, `45–54: 2`,
`55–64: 3`, `65+: 4`) against 40 reported rows. `payment_error=true` was
preserved. No ad was edited or published.

Read-only inspection found the missing paging owner: Meta uses a custom
right-edge vertical scrollbar. It is a narrow, tall `div` with no
`role="scrollbar"`, is not an ancestor of the reporting rows, and therefore
never appeared in `body_offsets`. The existing wheel targets could repaint
metrics without changing row identity.

`0.6.37` adds a guarded custom-scrollbar path:

- Body-offset diagnostics traverse through `document.documentElement`, include
  `overflow-y: clip`, and expose whether each offset contains headers or rows.
- The reader detects one bounded right-edge track (4–28px wide, at least 80px
  tall), preferring a nested thumb and falling back to the track node only for
  local drag coordinates.
- `scrollReportWithInput` rechecks the report lease, active tab, account, route,
  bridge and running job before every debugger command. It sends trusted
  `mouseMoved`, `mousePressed`, drag `mouseMoved` and `mouseReleased` events.
- A drag is successful only when row fingerprints introduce an identity that
  was not visible before. It returns `method=native_scrollbar_drag` and observes
  for up to 900ms; unchanged or repainted metrics are not paging evidence.
- No caller-provided coordinates, selectors, page text, cookies, network
  interception or remote input are accepted.

Source/fixture checks on the `0.6.37` build:

- `npm run check`: strict typecheck, 70/70 unit tests and Extension/API build
- `dist/extension/manifest.json` and `reader_version`: `0.6.37`
- `npm run test:reader`: custom right-edge track/thumb geometry is exposed
- `npm run test:report-scroll`: a role-less track receives one trusted
  down/move/up sequence, row IDs change, method is `native_scrollbar_drag`, no
  wheel path runs, and the debugger detaches
- `npm run test:report-input`: lease/account/job guards, trusted input, modal,
  timeout and detach checks
- `npm run test:report-probe` passes

Live follow-up on `0.6.37` after reload produced eight snapshots and 26–35
verified rows per Age scope, then timed out at step 8. A second run exposed the
hover-dependent scrollbar and captured only one snapshot. The `0.6.38` section
above records both the remaining gap and the two fixes. `needs_review` remains
not completion.

## 0.6.36 source validation — 2026-11-17

Live `0.6.35` confirmed the Breakdown early-return and menu close. With
`--no-scan-columns`, the job captured one snapshot and advanced to `step=1`, but
then stayed there for more than five minutes with no `scroll_log` entry. The
start acknowledgement also exceeded 30 seconds. Because horizontal scanning was
disabled, the remaining debugger path was the vertical native wheel; a hung
`chrome.debugger` promise kept the worker `busy` and no error was recorded.

`0.6.36` bounds every debugger call used by report input:

- `attach`, `sendCommand` and `detach` are wrapped in a 6-second timeout.
- A timeout returns an explicit `debugger_attach_timeout`,
  `debugger_command_timeout` or `debugger_detach_timeout` reason instead of
  freezing the job.
- A browser fixture replaces `chrome.debugger.sendCommand` with a never-resolving
  promise and verifies `scrollReportWithInput` returns
  `debugger_command_timeout` in under 20 seconds.

Source/fixture checks on the `0.6.36` build:

- `npm run check`: strict typecheck, 70/70 unit tests and Extension/API build
- `dist/extension/manifest.json`: `0.6.36`
- `npm run test:report-input`: hung-debugger timeout plus all existing trusted
  input, lease, race, modal and detach checks
- `npm run test:reader`, `test:report-scroll`, `test:report-probe`,
  `test:report-selected-columns`, `test:report-columns`, `test:breakdown`,
  `test:capture-analysis-web`

Live follow-up on `0.6.36`: the user reloaded and opened a fresh lease. The
bounded Age run completed without a debugger hang, so the timeout fix held, but
it produced one `needs_review` snapshot and all paging attempts returned
`visible_rows_unchanged`. See the `0.6.37` section for the custom-scrollbar root
cause and the next acceptance run. No ad was edited or published.

## 0.6.35 source validation — 2026-11-17

Live `0.6.34` did not reach collection. Report columns applied, but Breakdown
setup timed out twice with `breakdown_input_timeout` while the URL already had
`demographics_breakdown=age`. A read-only inspection showed the Breakdown menu
still open with “เลือกแล้ว 1 รายการ”, plus a visible Columns search input. The
setup kept searching/iterating dimensions instead of accepting the applied Age
state, and its loading check scanned the whole page body on every observation.

`0.6.35` makes an applied breakdown idempotent:

- If every requested dimension is active in the URL and no other dimension is
  active, setup returns `ok=true` without searching or clicking. An already
  open menu is closed with a guarded Escape key.
- Dimensions that are neither requested nor active are skipped before search,
  so an open Columns search cannot capture the Breakdown query.
- Loading detection uses only visible progressbars/`aria-busy`; it no longer
  scans all body text on each probe.
- The Breakdown fixture repeats an already-applied Age setup and asserts zero
  additional trusted clicks.

Source/fixture checks on the `0.6.35` build:

- `npm run check`: strict typecheck, 70/70 unit tests and Extension/API build
- `dist/extension/manifest.json`: `0.6.35`
- `npm run test:breakdown`: applied-state early return, trusted search/select,
  clear/switch and detach
- `npm run test:reader`, `test:report-scroll`, `test:report-input`,
  `test:report-probe`, `test:report-selected-columns`, `test:report-columns`,
  `test:capture-analysis-web`

Live `0.6.35` confirmed the Breakdown fix: setup returned `ok=true`, selected
`age`, and closed the open menu. Collection then hung in the horizontal
column-scan phase: one snapshot with two row observations, `step=0`,
`horizontal_step=0`, and the start acknowledgement timed out. Pausing set the
job to `paused`, but the in-flight scan kept the worker busy, so a new start was
refused. The agent now supports `--no-scan-columns`; the next bounded Age run
uses that path to reach vertical paging. This is a transport fallback, not a
data-model change.

Live run after reload confirmed the Breakdown fix but hung in the vertical
native-wheel debugger path with no `scroll_log` entry. See the `0.6.36` section
above for the timeout guard.

## 0.6.34 source validation — 2026-11-17

Live `0.6.33` after reload still failed coverage acceptance. Column setup
applied and Age breakdown stayed active, but the run produced a single snapshot,
ended `needs_review`, and returned the same five parent Ad IDs:
`18–24: 5`, `25–34: 5`, `35–44: 5`, `45–54: 2`, `55–64: 3`, `65+: 4` against 40
reported rows. Paging reported `visible_rows_unchanged`.

The scroll log showed why: all ten planned targets were metric bands
(`band_index` 3–13), every target had empty `body_offsets`, and neither the
right-edge gutter nor a custom scrollbar was probed. The gutter candidates were
derived from `scopeRect.right`, which can be off-screen for a grid wider than
the viewport, and the gutter loop ran after column bands had already consumed
the ten-target budget.

`0.6.34` makes scroll ownership explicit and first:

- Visible `[role="scrollbar"]` elements are probed before column bands, using
  their own geometry and the strict interactive-control exclusion.
- Gutter candidates use the visible right edge
  (`min(scopeRect.right, innerWidth)`) instead of an off-screen table edge.
- `target_diagnostics.scroll_diagnostics` records the scope rectangle, visible
  right edge, visible scrollbar geometry and body-target count so the next live
  run shows whether the pager was found.
- A fixture with twelve metric columns and a fixed visible scrollbar verifies
  that body targets still win the bounded ten-target budget.

Source/fixture checks on the `0.6.34` build:

- `npm run check`: strict typecheck, 70/70 unit tests and Extension/API build
- `dist/extension/manifest.json`: `0.6.34`
- `npm run test:reader`: wide-grid scrollbar/gutter planning plus all prior
  reader fixtures
- `npm run test:report-scroll`: reset, identity-only paging, bottom detection,
  inert safe band, bounded input and detach
- `npm run test:report-input`: actual MV3 debugger input, lease/route guards,
  race/modal no-extra-wheel checks and detach
- `npm run test:report-probe`, `test:report-selected-columns`,
  `test:report-columns`, `test:breakdown`, `test:capture-analysis-web`

Live attempt after reload did not reach collection: Breakdown setup timed out
twice with `breakdown_input_timeout` while Age was already active. See the
`0.6.35` section above for the evidence and fix.

## 0.6.33 source validation — 2026-11-17

Live `0.6.32` after reload did not pass coverage acceptance. The bounded Age run
stored 20 snapshots, ended `needs_review` with `payment_error=true`, and still
held only 2–5 verified Ads per Age scope against 40 reported rows
(`18–24: 5`, `25–34: 5`, `35–44: 5`, `45–54: 2`, `55–64: 3`, `65+: 4`). All
snapshots came from the same five parent Ad IDs. The visible row count
alternated between 24 and 21 because one row left the viewport; the previous
paging check treated that count change as movement, so all 19 `scroll_log`
entries were false positives. Live inspection also found a custom right-edge
vertical scrollbar (about `15×386` px) and only three visible parent Ads.
`row_reset` returned `{reset:false, reason:"already_at_start"}` because the
diagnostics did not identify a body scroller, so the reset could not prove
anything about the virtualized body.

`0.6.33` tightens paging and plan selection:

- Paging is proven only by a new visible row identity. `probeReportingScroll()`
  now returns opaque `row_fingerprints`; a changed row count, `scroll_top`,
  hover paint or losing one clipped row is not movement.
- `resetReportingRows()` resets detected reporting-body offsets, waits for the
  repaint and re-queries the first row before `scrollIntoView`. The pre-reset
  marker is never reused, so a detached marker cannot scroll the view back to
  the old bottom page.
- Native wheel planning covers name/switch/legacy/metric and right-edge gutter
  targets, bounded to 10 targets, 60 hit probes and a 12-second deadline. Every
  point is hit-tested again against the strict interactive-control exclusion,
  and gutter targets receive unique band indexes for hover re-resolution.

Source/fixture checks on the `0.6.33` build:

- `npm run check`: strict typecheck, 70/70 unit tests and Extension/API build
- `dist/extension/manifest.json`: `0.6.33`
- `npm run test:report-scroll`: reset from a bottom page, identity-only paging,
  physical-bottom detection, inert safe band, bounded input and detach
- `npm run test:report-input`: actual MV3 debugger input, lease/route guards,
  no extra wheel after a paused/rebound context or modal, and detach
- `npm run test:reader`, `test:report-probe`, `test:report-selected-columns`,
  `test:report-columns`, `test:breakdown`, `test:capture-analysis-web`

Live rerun after reload failed acceptance: one snapshot, `needs_review`, the
same five parent Ad IDs and no verified paging. See the `0.6.34` section above
for the target-planning evidence and fix. No ad was edited or published.

## 0.6.32 source validation — 2026-11-17

Live `0.6.31` after reload did not pass coverage acceptance. The bounded Age run
persisted 10 snapshots and finished `needs_review`. It still produced six
semantic Age scopes, but each scope held only 2–5 verified Ads against 40
reported rows, so cost-per-result rankings were correctly ineligible.

Root cause: the previous job left Meta's virtualized vertical body near its
bottom. The next job started capture without returning that body to the first
page and repeatedly captured the same last five Ads. `scroll_log` reported nine
“moved” steps because the paging fingerprint included the body's `scroll_top`;
the visible row identities never advanced. That is not verified paging.

`0.6.32` adds `resetReportingRows()` and runs it after rows are ready at
`step === 0`. It resets reporting-body offsets to `0`, waits for the repaint and
re-queries the first visible row before `scrollIntoView`; the pre-reset marker
is never reused because a virtualized table may detach it and scroll the view
back to the old bottom page. The job records the result as `row_reset`.

Paging fingerprints now contain only the visible row count and stable
identities (ID, then name fallback). A changed body offset with identical
identities returns `reporting_body_moved_rows_unverified`, not `moved=true` and
not a new row count. Physical `scroll_top` remains diagnostic evidence only.

Source/fixture checks on the `0.6.32` build:

- `npm run check`: strict typecheck, 70/70 unit tests, Extension/API build
- `dist/extension/manifest.json`: `0.6.32`
- `npm run test:report-scroll`: starts with the body at the bottom and verifies
  reset to the first row; also verifies that a changing row `scroll_top` with
  identical IDs remains `moved=false`, plus physical-bottom detection and
  trusted horizontal paging
- `npm run test:report-input`: actual MV3 debugger input, lease/route guards and
  debugger detach
- `npm run test:reader`
- `npm run test:report-probe`
- `npm run test:report-selected-columns`
- `npm run test:report-columns`
- `npm run test:breakdown`
- `npm run test:capture-analysis-web`

Live rerun after reload failed acceptance: the bounded Age collection produced
20 snapshots with only five parent Ad IDs and 2–5 verified Ads per scope. See
the `0.6.33` section above for the evidence and the tightened paging rules. No
ad was edited or published.

## 0.6.31 source validation — 2026-11-17

`0.6.31` fixes two evidence-mapping problems found in the live `0.6.30` Age run:

- Age subrow text is grouped by its structural cell owner (left edge, height and
  clipping) instead of by each text line's own x-coordinate. Multiline
  Attribution fragments now stay in one cell; a wrapped `หรือการดูในช่วง`
  line can no longer become an `ชื่อชุดโฆษณา` value or a new scope.
- Attribution fragments are whitespace-normalized and deduplicated in shared
  analysis, so identical cells with different DOM line order share one scope.
- Native vertical input now uses the reporting body's `scroll_top`,
  `client_height` and `scroll_height` to return `reporting_bottom_reached`
  when the table is physically at its end. That state is no longer reported as
  `visible_rows_unchanged` and does not add a false paging warning.

Source/fixture checks on the `0.6.31` build:

- `npm run typecheck`
- `npm test`: 70/70 unit tests
- `npm run test:reader`: multiline Attribution ownership and Age subrow mapping
- `npm run test:report-scroll`: bottom detection and trusted-paging guards
- `npm run test:report-input`: actual MV3 debugger input, lease/route guards and
  debugger detach
- `npm run test:report-probe`
- `npm run test:report-selected-columns`
- `npm run test:report-columns`
- `npm run test:breakdown`
- `npm run test:capture-analysis-web`

The stored raw `0.6.30` Age job was reanalyzed with the `0.6.31` source and the
operator-confirmed timezone/no-filter context. It produced exactly six semantic
Age scopes (`18–24` through `65+`), with no one- or two-row scopes from
Attribution line order. Each scope retained verified Ad IDs, reported Spend,
Impressions, Results/result type, Cost per result and a complete multiline
Attribution cell. Coverage remained partial at 26–35 verified unique rows per
scope against 40 reported rows. The main result group remained the messaging
conversation result type and eligible row rankings were available within each
scope; no totals were combined across Age scopes.

`ads:agent` now includes each scope's context, result groups, best/worst
cost-per-result ranking, delivery counts and recommendations in its JSON output
instead of returning only counts and recommendation codes.

Live `0.6.31` was reloaded but failed coverage acceptance because paging stayed
on the old bottom page; see the `0.6.32` section above. No ad was edited or
published.

## 0.6.30 source validation — 2026-11-17

Live `0.6.29` reached the real reporting dialog but failed before Save with
`ยกเลิกคอลัมน์ส่วนเกินไม่สำเร็จ`. The screenshot and accessibility snapshot
showed a right-hand panel headed `เลือกไว้ 24 คอลัมน์`; each selected column has
its own remove button, while the checkbox probe only saw the left-hand search
result and its category controls. The rendered-header search path therefore
searched labels that the active dialog view did not render.

`0.6.30` adds a read-only `selected_columns` probe scoped to that panel. It
returns each selected label plus the remove-button geometry and hit-test state,
scrolls the panel when an extra is clipped, and removes extras one at a time
through trusted Chrome input. The previous checkbox/search path remains as a
fallback for layouts without the panel. The delivery-status header
`ปิด / เปิด` is explicitly kept rather than treated as an extra metric.

Source/fixture checks on the `0.6.30` build:

- `npm run check`: strict typecheck, 69/69 unit tests, Extension/API `0.6.30` build
- `npm run test:report-probe`
- `npm run test:report-input`
- `npm run test:report-selected-columns`: removes hidden Budget/Purchases/ROAS
  through the selected-columns panel and verifies rendered headers
- `npm run test:reader`
- `npm run test:report-columns`
- `npm run test:breakdown`
- `npm run test:report-scroll`
- `npm run test:capture-analysis-web`

Live `0.6.30` after reload: `report.prepare` returned `applied=true` with
`missing_required=[]` and pruned nine stale columns (Budget, Purchases,
purchase conversions/cost, ROAS, audience, audience cost, created/delivered
orders). The rendered table kept IDs, Age, Delivery, Results, Cost per result,
Impressions, Spend, Attribution and Ad set name. Breakdown Age was verified with
`demographics_breakdown=age`, and the bounded run persisted 10 snapshots.

The analysis ended `needs_review` with partial coverage, not complete. It
produced the six expected Age scopes (`18–24` through `65+`) with verified Ad
IDs, per-row Spend from the reported column, Impressions, Results/result type,
Cost per result and Attribution. The main scopes had 25–34 verified unique rows
against 40 reported rows and eligible cost-per-result rankings of 2–9 rows.
`missing_columns` and `blockers` were empty for those scopes.

Four additional 1–2-row scopes appeared for `25–34`, `45–54` and `65+` because
some Attribution cells contained one- and two-setting multiline text. They are
kept separate rather than guessed or merged. The run also reported
`visible_rows_unchanged` and therefore remains partial. Payment errors were
present in the account evidence. No totals, coverage or ranking is labelled
complete, and no ad was edited or published.

## 0.6.29 source validation — 2026-11-17

The first live `0.6.28` Age run proved that the navigation guard was necessary
but not sufficient. `report.prepare` returned `applied=true`, yet the rendered
table still contained Budget and purchase/ROAS columns and did not expose a
usable Impressions/Results column together with stable IDs and Age. A second
standalone prepare also returned `applied=true` with an empty prune list.
Closing the dialog therefore did not prove that the saved view had changed.

`0.6.29` treats rendered report headers as evidence, not only checkbox rows in
the currently active dialog category. Extras visible in the table are searched
and unselected through trusted input even when Meta does not render their choice
in the open category. The probe also understands div-based choice rows and names
selected choices from collapsed/hidden DOM. After Save, the prepare result must
find every blocking field in the rendered headers and must find no stale extra
header; otherwise `applied=false` with bounded `missing_rendered_fields` and
`extra_rendered_headers` evidence.

Source/fixture checks on the `0.6.29` build:

- `npm run check`: strict typecheck, 69/69 unit tests, Extension/API `0.6.29` build
- `npm run test:report-probe`: div/hidden choices and rendered header projection
- `npm run test:report-input`: table-only hidden extra is pruned, stale rendered
  headers reject Save, sort glyphs are normalized, a spend alias does not keep
  a ROAS header that merely contains "ใช้จ่าย", and a rendered header with a
  parenthetical is matched back to its dialog choice before trusted search
- `npm run test:reader`
- `npm run test:report-columns`
- `npm run test:breakdown`
- `npm run test:report-scroll`
- `npm run test:capture-analysis-web`

Live `0.6.29` acceptance remains pending a user reload and another bounded Age
run. No capture, totals or ranking is accepted from the `0.6.28` run.

## 0.6.28 source validation — 2026-11-17

Live `0.6.27` passed the report-column prune, but the bounded Age run still
produced incompatible horizontal slices. The first `report.prepare` reported
`applied=true`, selected the required columns and pruned the stale `CPC (...)`
and frequency choices. Breakdown Age was verified as
`demographics_breakdown=age`. The subsequent collection produced 12 snapshots
and ended `needs_review`: some slices contained Impressions/Results without
stable IDs/Age/Spend, while others contained IDs/Age/Spend without
Impressions/Results. A short `--skip-prepare` run reproduced the same split
across 9 snapshots.

After Breakdown, another `report.prepare` still succeeded but this time pruned
Reach, proving Meta's transient report-column view had changed again. The
strongest common cause is `start` navigating to the reporting URL even when the
active tab was already the exact bound account, level and validated breakdown
view. That reload discarded the columns applied by `report.prepare`.

`0.6.28` adds the pure `needsReportingNavigation()` check. It reuses the current
tab when the allowed host, exact level route, single matching `act`, and
validated `*_breakdown` query all match; unrelated query parameters such as
filters are preserved. Otherwise it navigates to the canonical reporting URL.
Both paths still activate and maximize the bound tab. A unit test covers a
matching view with extra filters, reordered breakdown parameters, account/level
mismatches, duplicate or invalid breakdown values, and duplicate `act`.

Observed on the rebuilt source/build `0.6.28`:

- `npm run check`: strict typecheck, 69/69 unit tests, Extension/API 0.6.28 build
- `npm run test:reader`
- `npm run test:report-input`: trusted input, duplicate Reach, clipped list,
  context mutation after uncheck and debugger detach

This was source/fixture evidence only. The subsequent live `0.6.28` run is
recorded above and did not pass report-column acceptance.

## 0.6.27 source and fixture validation — 2026-11-17

Live `0.6.26` passed heartbeat, lease and scroller discovery, but its
`report.prepare` command `408ae704-3cdb-4ff7-922b-66dcc40849f8` stopped before
Save while pruning Reach/Frequency/CPC. After trusted search, Meta changed the
rendered choice context; the exact-context matcher dropped to zero matches and
reported `target_not_unique`, even though the checked label was still present.

`0.6.27` matches the same normalized label and checked state during search, then
confirms success only when no checked choice with that label remains. This does
not depend on post-search context and cannot mistake an unchecked duplicate
sibling for the removed target. The report-input fixture now mutates Reach's
context after uncheck and still passes.

Observed on the rebuilt source/build `0.6.27`:

- `npm run check`: strict typecheck, 68/68 unit tests, Extension/API 0.6.27 build
- `npm run test:report-input`: duplicate Reach, clipped list, context mutation
  after uncheck, trusted input and debugger detach pass
- `npm run test:report-columns`
- `npm run test:breakdown`
- `npm run test:reader`
- `npm run test:report-probe`
- `npm run test:report-scroll`
- `npm run test:capture-analysis-web`

This is source/fixture evidence only. Live `0.6.27` acceptance remains pending
reload and the bounded Age run; no capture, totals or ranking is accepted yet.

## 0.6.26 source and fixture validation — 2026-11-17

Live `0.6.25` still failed to prune reach/frequency/CPC. The trace contained 57
clipped choices but no scroll target covering Meta's actual scroller. `0.6.26`
includes the dialog itself in scroller discovery, falls back to a bounded wheel
target, verifies the click through the hit-tested field probe, and records
post-click state in the trace. The clipped-list fixture passes.

Observed on the rebuilt source:

- `npm run check`: strict typecheck, 68/68 unit tests, Extension/API 0.6.26 build
- `npm run test:report-input`: clipped list and duplicate Reach pass
- `npm run test:reader`
- `npm run test:report-probe`
- `npm run test:report-scroll`

This was source/fixture evidence only. The subsequent live `0.6.26` run stopped
at the post-search context-mutation blocker above; no capture or ranking was
accepted.

## 0.6.25 source and fixture validation — 2026-11-17

Live `0.6.24` reached report setup but its prune step failed on reach/frequency/
CPC choices that were checked yet clipped outside the scrollable option pane.
`0.6.25` reports the bounded column-list scroller, moves it only through trusted
mouse wheel input, re-probes coordinates, and matches the checked choice by
label plus context before clicking. The browser fixture constrains the list to
two visible rows to reproduce clipping.

Observed on the rebuilt source:

- `npm run check`: strict typecheck, 68/68 unit tests, Extension/API 0.6.25 build
- `npm run test:report-input`: duplicate Reach and clipped-list pruning pass
- `npm run test:reader`
- `npm run test:report-probe`
- `npm run test:report-scroll`

This was source/fixture evidence only. The subsequent live 0.6.25 run reached
report setup but still failed on clipped prune choices; no capture or ranking
was accepted.

## 0.6.24 source and fixture validation — 2026-11-17

Live `0.6.23` reached report setup but stopped safely before Save because Meta
exposed two exact Reach labels (one checked, one unchecked). The previous prune
matcher treated this as ambiguous. `0.6.24` matches only the checked candidate
and confirms removal by label plus context, without guessing from row position.

Observed on the rebuilt source:

- `npm run check`: strict typecheck, 68/68 unit tests, Extension/API 0.6.24 build
- `npm run test:report-input`: duplicate Reach fixture prunes the checked
  candidate and leaves the unchecked variant untouched
- `npm run test:reader`
- `npm run test:report-probe`
- `npm run test:report-scroll`

This was source/fixture evidence only. The subsequent live 0.6.24 run reached
report setup but failed on clipped prune choices; no capture or ranking was
accepted.

## 0.6.23 source and fixture validation — 2026-11-17

Extension 0.6.23 changes report setup to prune stale optional columns through the
trusted Chrome input path before Save. This addresses the 0.6.22 live row shape
where identity/Age/Spend and Impressions/Results occupied separate horizontal
slices. It also starts horizontal scanning only when the captured diagnostics
show real overflow, and the agent now reports `report_columns.pruned`.

Observed on the rebuilt source:

- `npm run check`: strict typecheck, 68/68 unit tests, Extension/API 0.6.23 build
- `npm run test:reader`
- `npm run test:breakdown`
- `npm run test:report-input`: pre-selected Budget/Reach/Frequency/Purchases/ROAS
  were unselected, required/name columns remained selected, and Save occurred
  through trusted input
- `npm run test:report-scroll`
- `npm run test:report-probe`

This was source/fixture evidence only. The subsequent live 0.6.23 run stopped at
the duplicate-Reach prune blocker above; no complete age coverage, totals or
ranking was claimed.

## Live 0.6.22 Breakdown Age re-test — 2026-11-17

After the user reloaded Extension 0.6.22 and enabled the local report lease, the
agent verified a fresh heartbeat, the bound account and `report_input=true`.
The first bounded run navigated to the Ads level but stopped at
`report.prepare` with `ไม่พบหน้าต่างปรับแต่งคอลัมน์ที่พร้อมใช้งาน`; no report
view was saved and no ad, budget or publishing action occurred. The receipt trace
reported an ambiguous/missing report control during navigation.

A second `report.prepare messages` on the settled page completed with
`applied=true` and every blocking field verified: Campaign/Ad Set/Ad IDs, name,
Spend, Impressions, Results, Cost per result and Attribution. Link clicks and
Messaging conversations remained explicit `missing_goal_metrics`.

The same device then ran:

```text
npm run ads:agent -- DEVICE_ID messages --breakdown=age \
  --timezone=Asia/Bangkok --no-filters --max-steps=20 \
  --timeout-seconds=900 --skip-prepare
```

Breakdown Age selected and verified the URL parameter
`demographics_breakdown=age`. Collection job
`a7c31357-2fed-48f3-8d22-738629a8d2b0` reached `needs_review` with 38 snapshots;
all 38 were persisted by `reader_version=0.6.22`. The run produced 815 raw row
observations and all six age scopes shown by Meta: `18–24`, `25–34`, `35–44`,
`45–54`, `55–64`, `65+`.

The live row shape still fails acceptance:

- 805 age subrows carried a stable Ad ID, age and Spend.
- none of those age subrows carried Impressions or Results;
- `result_type` was absent from every age subrow;
- 10 non-age observations carried Impressions/Results but had no stable ID,
  age or Spend;
- analysis therefore reported `missing_columns: ["impressions","results"]`,
  partial coverage per age scope and no verified result groups/ranking;
- horizontal diagnostics repeatedly reported
  `reporting_input_timeout`, `visible_columns_unchanged` or
  `reporting_view_changed_before_input`; vertical paging itself moved.

This moves the immediate blocker from result-type propagation to horizontal
slice pairing: the stable identity/age/Spend pane and the Impressions/Results
pane were not visible together, and the non-age pane cannot be joined by name or
position. The run is not complete or comparable, and no totals or rankings were
accepted across age scopes.

The source also gained a breakdown-grain regression: duplicate detection now
uses `entity ID + visible breakdown combination` instead of Ad ID alone. Two age
subrows with the same Ad ID are accepted as different grains, while an identical
ID+age row is still rejected. Unit tests pass 68/68 and `npm run check` passes;
live normalized promotion remains blocked by the missing metrics above.

## 0.6.22 read-only agent and report diagnostics

Implemented `scripts/ads-agent.ts` and `npm run ads:agent` as a bounded
orchestrator over the existing typed command queue. It refuses stale heartbeat,
Extension versions below 0.6.22, disabled bridges, missing bound accounts and an
already-running collection. It never enables the local report-input lease,
approves an action or bypasses a popup. Candidate report diagnostics now include
column labels and helper text within the existing bounded trace, and search uses
explicit Thai/partial aliases while exact labels still decide selection.

Observed checks:

- `npm run typecheck`
- `npm test`: 64/64 unit tests
- `npm run test:report-probe`
- `npm run test:report-columns`
- `npm run test:report-input`
- `npm run test:browser`
- `npm run build`: Extension/API 0.6.22

The agent version guard was exercised against the still-connected 0.6.5 device
and stopped before navigation or Meta input with:
`Extension 0.6.5 is older than required 0.6.6; reload dist/extension`.
This is guard evidence, not live 0.6.22 acceptance. The next run must use a
freshly reloaded device and report the resulting command/job IDs before any claim
that report setup, complete Ads paging, stable IDs or ranking works live.

### Live 0.6.6 report probe

After user reload/reconnection, device state reported Extension 0.6.6 and
`report_input=true`. `npm run ads:agent` verified the device and reached
`report.prepare` command `819848d3-3209-4fc4-9007-c0e72791967d`, but the command
ended safely with `applied=false`; no Save, publish, budget or ad-status action
occurred.

Bounded diagnostics identified distinct causes:

- Spend appeared as a checked, visible, hit-tested option named
  `จำนวนเงินที่ใช้จ่ายไป`, but later search/recheck churn lost it.
- Link clicks appeared as `การคลิกลิงก์` but was clipped outside the visible
  option pane.
- No exact single-column option for Messaging conversations was exposed by the
  Thai dialog for this Ads view.

The report contract now marks goal-specific metrics as non-blocking after a
trustworthy capture view is established. Generic Results and Cost per result are
blocking because they support objective-aware cost analysis without relabelling
generic Results as a conversion. The final verifier only revisits blocking fields,
reducing search-state churn while retaining reversion checks.

Post-correction fixtures pass: `test:report-columns`, `test:report-input`, all 64
unit tests and strict typecheck. This is not yet successful live Save or complete
Ads coverage; the user must reload the rebuilt 0.6.22 artifact before the next real
run.

### Live 0.6.9 report setup and collection

After loading 0.6.9 and enabling the local report lease, `ads:agent` completed
report setup with `applied=true`. Selected fields were Spend, Results, Cost per
result, Campaign/Ad Set/Ad IDs, Impressions and Attribution. Link clicks and
Messaging conversations remained explicit `missing_goal_metrics`; no value was
invented.

Collection job `e50e2ba5-651d-418e-97b7-1ab88f7fad56` produced 12 snapshots and
all 12 were persisted in PostgreSQL. Vertical paging moved successfully across
the bounded run. However every snapshot still contained only the visible name
and delivery columns, so analysis correctly remained partial with zero verified
IDs and no Spend/Impressions/Results. This isolates the next failure to
horizontal column access rather than report setup, persistence or the analysis
endpoint.

0.6.10 adds a guarded native horizontal wheel fallback using the same local
report lease, active tab/account/job checks and local target planning. Success
requires a changed header projection plus horizontal offset; rows moving without
verified column movement are rejected. The MV3 fixture verifies a frozen row
anchor, horizontal wheel input, shared header/body movement and debugger detach.
Fresh live0.6.10 acceptance remains pending reload and a new bounded collection.

### Live 0.6.10 horizontal collection

After reload and a fresh report lease, `ads:agent` again applied the reporting
view and completed job `4990f762-66ae-4684-8e42-6698867160ce` with 10 snapshots,
all persisted. Native horizontal paging produced distinct column slices for
Cost per result/Impressions, Spend, Campaign ID, Ad ID/Attribution and CPC. One
slice verified eight stable Ad IDs and another contained Spend plus other
metrics, proving horizontal access works.

The run still remained partial: IDs and metrics were captured in different
horizontal slices, and the slice containing IDs lacked Spend/Impressions/Results.
The analyzer correctly refused to join by row position or name. Only eight IDs
were verified versus the footer count of 40. 0.6.11 therefore maximizes the
reporting window before reading to increase the chance that stable IDs and
metrics share one slice, while preserving the no-geometric-join rule.

### Live 0.6.11 widened report slices

Job `528c90c8-2f8b-4b0a-ac37-454f5598d69e` verified Extension 0.6.11, applied
the report view and persisted six snapshots. Maximized-window slices placed
Spend, Campaign ID, Ad Set ID, Ad ID and Attribution together; eight Ads had
verified stable IDs and reported Spend. Another slice contained Results,
Cost per result and Impressions without IDs.

Only one vertical row set was collected because the final unchanged horizontal
slice set the local `same` flag and the old control flow skipped vertical
paging. The run therefore remained partial at 8/40 and could not merge ID and
result slices without violating the no-position/no-name identity rule.

0.6.12 removes that coupling: completing horizontal scanning now always
advances the bounded vertical cycle. It also temporarily applies a guarded 0.7
zoom while reading and restores the user's original zoom on completion, pause or
error. The browser integration still passes; horizontal and vertical movement
remain independently verified. Fresh live0.6.12 acceptance is pending.

### Live 0.6.12 vertical cycle and widened coverage

Job `401746be-e1bf-41d5-a52b-b3d30a2aee2a` verified Extension 0.6.12, applied the
report view and persisted 15 snapshots. Vertical paging advanced through seven
successful steps before the final no-move result. The main ID-bearing scope
reached 18 stable Ads with reported Spend versus the footer count of 40, a
material increase from 8.

The ID-bearing slices still omitted Impressions and Results because those
columns remained before the visible horizontal band. Another slice contained
Results/Impressions but no stable ID, so no cross-slice join was attempted.
0.6.13 reduces the temporary read zoom to 0.5 to try to fit the result metrics
and identity columns into one slice, retaining the same restore and alignment
guards. Fresh live0.6.13 acceptance is pending.

### Live 0.6.13 full identity and metric coverage

Job `7eb5a251-033b-4239-a7d5-36cac83412dc` verified Extension 0.6.13, applied
the report view and persisted 25 snapshots. Read zoom 0.5 produced result and
identity fields close enough to merge across horizontal slices. The analyzer now
fills an unknown row attribution only from a unique attribution value seen for
the same stable ID in another compatible slice.

After restarting the API to load that correction, the main evidence scope
reported:

- 40 verified unique Ads against footer count 40
- Spend from the reported column for all 40
- no missing required columns
- verified IDs and column mapping
- visible result types for message conversations

The remaining blockers before an official ranking were the operator-only
context fields: timezone, no-breakdown confirmation and no-filter confirmation.
A read-only analysis with the hypothetical context `Asia/Bangkok`,
`confirm_no_breakdown=true` and `confirm_no_filters=true` produced a complete
40-row scope, ten eligible message-result Ads, weighted cost per result and
best/worst candidates. This is mechanism verification only; it is not recorded
as an operator-confirmed production result until the user explicitly confirms
those conditions.

### 0.6.14 Breakdown reporting scope

Added the typed `breakdown.prepare` command and
`configureBreakdownWithInput`. The Extension may select only the exact allowlist
`age`, `gender`, `platform` and `placement` through trusted debugger input under
the existing report-input lease. It opens the identified Breakdown control,
verifies option checked state after each click, clears allowlisted dimensions
that are no longer requested, closes with Escape and detaches. A duplicate or
missing option fails without claiming success. Unsupported active breakdown
parameters, including `time_breakdown`, stop before input rather than guessing a
clear operation.

Analyzer scopes already carry row-level breakdown dimensions and never combine
totals across different combinations. Cross-horizontal-slice attribution may be
filled only from a unique value for the same stable ID; this lets IDs, Spend,
Results and dimensions merge without name or row-position joins.

Passing checks: strict typecheck, 66 unit tests, `test:breakdown` with trusted
menu clicks and clear/switch behavior, `test:browser`, Extension/API build
0.6.14. Live acceptance is pending a reloaded device with the unsupported `time`
Breakdown removed and a request for `age,gender` or another supported
combination.

### Live 0.6.14 Breakdown matcher probe and 0.6.15 correction

Backend initially rejected `breakdown.prepare` until the API process was
restarted with the new shared schema; this was a process-load issue, not an
Extension rejection. The next queued command reached the real Meta menu but
failed safely with `breakdown_menu_not_found`; no dimension was selected.

Read-only inspection after the trusted trigger click showed the real DOM shape:

- options use `role=listitem` with a separate adjacent checkbox,
- the placement label is `ตำแหน่งโฆษณา`,
- the menu search input is `search columns`,
- Gender was not visible until an in-menu search.

0.6.15 pairs an exact listitem label with the nearest unique checkbox, accepts
only the observed placement alias, and uses trusted `Input.insertText` in the
menu search for hidden allowlisted dimensions. Clicking the trigger, selecting
age, using search to reveal gender, switching to platform, clearing prior
dimensions, Escape close and debugger detach all pass the MV3 fixture.

Passing checks after correction: strict typecheck, 66 unit tests,
`test:breakdown`, browser integration and Extension/API build 0.6.15. Live menu
acceptance still requires the user to reload 0.6.15; the prior 0.6.14 failure is
not treated as success.

### Live 0.6.15 checkbox collision and 0.6.16 correction

Backend loaded the new Breakdown contract after restart. Command
`9937825b-91a8-4176-b27c-0daaf8884e6a` reached the live menu but returned
`breakdown_selection_incomplete`; it did not Save or mutate ad delivery.
The resulting URL contained `demographics_breakdown=age` but also
`selected_ad_ids=...`, proving the matcher clicked an Ads-row checkbox that was
vertically aligned with a Breakdown listitem but outside its menu column.

0.6.16 requires the nearest checkbox to be inside the horizontal bounds of the
matched Breakdown listitem. The MV3 fixture now includes a same-Y checkbox far
outside the menu and verifies it remains unchecked while age/gender are selected
through the real listitem/checkbox/search shape. Typecheck, 66 unit tests,
breakdown input, browser integration and Extension/API build pass. Fresh live
acceptance is pending reload of 0.6.16.

### Live 0.6.16 selected trigger label and 0.6.17 correction

After reload, command `7153acfc-db53-42f1-b4aa-8c6950cad9a8` returned
`breakdown_menu_not_found` without selecting a dimension. The live page already
had age Breakdown active, and read-only inspection showed its button label was
`ข้อมูลแยกย่อย: เลือกแล้ว 1 รายการ`, not the plain label used by the matcher.

0.6.17 accepts only a Breakdown-label prefix plus an optional selection-count
suffix. The MV3 fixture now starts with the same selected-count button text and
still opens, searches, selects and clears dimensions without changing an
outside checkbox. Typecheck, 66 unit tests, Breakdown integration, browser
integration and Extension/API build pass. Live acceptance requires reload of
0.6.17 and clearing the accidentally selected Ads-row checkbox from the prior
0.6.15 run.

### Live 0.6.17 exclusive demographics and 0.6.18 correction

Command `b5bde5c3-a127-420e-9c96-ee571c0b8163` reached the menu and selected
Gender, but the requested Age+Gender combination was impossible: the URL moved
from `demographics_breakdown=age` to `demographics_breakdown=gender`. A separate
Age request similarly updated the URL to `demographics_breakdown=age`, while the
post-rerender checkbox did not expose a checked state.

This proves Age and Gender are alternative values in one demographics breakdown,
not additive options. 0.6.18 therefore:

- rejects Age+Gender in the shared contract and agent parser,
- accepts the URL parameter for the matching stable dimension as verification
  when the checkbox is rerendered,
- treats an active URL value as selected without clicking it off,
- supports switching Age -> Gender or Gender -> Age with explicit clear proof.

Checks pass: typecheck, 66 unit tests, Breakdown search/switch fixture, browser
integration and Extension/API build 0.6.18. Live acceptance is pending reload.

## Passing checks

- `npm run check`: strict TypeScript, 12 unit tests, extension and API bundles.
- `npm run db:migrate`: PostgreSQL 17 in Docker; repeated execution leaves applied migrations unchanged.
- `npm run test:api`: real PostgreSQL and Express. Authentication, validation, import idempotency, updated observation UPSERT, conflicting parent rollback, JSON export, bot command allowlist and acknowledgement queue.
- `npm run test:browser`: real unpacked MV3 extension in Playwright Chromium, using intercepted synthetic Meta pages. Popup validation, database sync, invalidation after changing inputs, three-page navigation/read, raw snapshots, authenticated bot bridge and account-change guard. Zero page JavaScript errors.
- Screenshot: `docs/screenshots/extension.png`, inspected after the test.

## Debug ledger

| Reproduction | Trace / finding | Correction | Verification |
|---|---|---|---|
| `npm run typecheck` | Chrome Storage returns unknown values; assigning directly to input.value fails compilation | Narrow session/account values and validate bridge state with Zod | TypeScript passes |
| Initial browser integration | Extension opened in a tab has sender.tab too; filtering sender.tab rejected a legitimate extension page | Require exact extension ID and popup URL instead | Browser command dispatch passes; web content senders remain excluded |
| Browser validation intermittently failed | Asynchronous initial storage restore could overwrite a value already entered by the user/test | Restore saved input only while the input is empty | Complete browser integration passes |
| New breakdown unit test | Zod 4 record with enum keys required every possible dimension; no-breakdown fixtures had hidden this path | Use partialRecord for optional dimensions and metrics | Breakdown and partial metric tests pass |

## Limits of the evidence

No live Meta login or account was used. DOM selectors, actual Meta page routes, virtualization behavior, native permission prompts and date/report controls still require live acceptance testing. Browser fixtures pregrant optional host permissions only in a temporary extension copy; production manifest still asks the user.

The tests accelerate alarm scheduling in an unpacked test extension. Production uses 30-second polling, subject to Chrome scheduling and browser availability. Real service worker crash/restart and network interruption recovery have not been exhaustively tested. Stored command dispatch markers avoid automatic replay after uncertain execution.

Tests add synthetic records to the local database. No Meta data has been collected. Account coverage stays unverified even when every test passes.

## v0.2 UI controller validation

`npm run test:ui` uses a real unpacked extension with a synthetic campaign editor: inspect, blocked writes before enabling control, native input setter and input events, native and custom dropdowns, image upload, next-step click, single-use local Publish approval, refusal of consumed approval, stale-handle errors, lease disabling and view-only Business Suite without act. It also verifies a queued UI inspection returns through the actual local Backend. No Meta API requests are made by this test.

Additional debug ledger: injected exceptions initially appeared as empty/null executeScript results, hiding the stale-handle reason. The isolated executor now catches errors and returns a serializable failure before the controller reports it. Native select labels initially included option text; label extraction now removes descendant form controls from label copies. The UI integration covers both fixes. An isolated probe required a string IIFE because the test transpiler adds function-name helpers; the probe was removed after diagnosis.

These tests do not prove that actual Meta forms accept synthetic events, that publication succeeds, that the native permission dialog was exercised, or that every mutation can be classified by label. No real ads were created or published.

## Windows CMD dependency repair

Reproduced `tsx is not recognized` using `cmd.exe /d /c "npm run build"`. The shared workspace had a Linux `node_modules/.bin/tsx` symlink and no Windows `tsx.cmd`. Running `npm ci` through Windows npm regenerated platform-specific launchers and native dependencies. Windows `npm run check` passed all 12 unit tests, typecheck and build; Windows migration passed; Windows API started successfully on loopback and was stopped after verification. No application-code change was required. README now distinguishes Windows installation from WSL installation.

## v0.3 Next.js frontend

Frontend uses Next.js App Router + React on port 9321. Windows `npm run typecheck:web` and `npm run build:web` passed. `npm run check` still passes TypeScript, all 12 core tests and Extension/API builds. The API integration also passes with the command-detail contract assertion.

`npm run test:web` exercised the actual Next server, authenticated local API and PostgreSQL: incorrect/correct login, device discovery, account selection, CSV validation, invalidation after input changes, rejection of mismatched reconciliation, successful import, history, filtering and JSON/CSV downloads, queued inspect/fill, an approval-gated command handoff, command history, mobile viewport without horizontal overflow, and logout clearing the session token. Extension responses in this test are explicit fixtures; this is not a live Meta publishing test. Test-only accounts/devices are cleaned up by exact fixture marker and IDs.

Debug ledger additions:

- Next config initially had one unclosed array; reproducible TypeScript parse error, corrected and production build passed.
- Login error test initially matched Next's route announcer as well as the login alert; narrowed the test to the login panel.
- Approval handoff exposed a missing `command` in the original command-detail API response. Included the command with upload base64 removed, and verified the exact approved action is requeued with the one-time approval ID.
- Reproduced a prior startup symptom: Express 5 invokes the listen callback on bind errors. The old callback logged readiness even for EADDRINUSE and exited successfully. The callback now checks its error argument, reports port conflict and exits with code 1. Starting on a free port reports the actual Backend URL.

Screenshots: `frontend-overview.png`, `frontend-control.png`, `frontend-mobile.png` in `docs/screenshots/`, inspected during QA. Next dev preview and temporary test Backend are stopped after QA; the requested local frontend runs on port 9321 against the normal Backend on 4318.

## Extension pairing usability — 0.3.1

Confirmed the requested account had no registered device; existing entries were stale test devices. Source trace showed Device ID was only generated after account/permission/token validation and successful binding, while failures were shown at the bottom of a long popup. Account detection also compared the existing account field before detecting a new account, preventing switching from an old value.

Device identity is now generated independently and persists across popup reloads (preserving a legacy bridge ID). The popup shows a readonly ID and copy button at the top, distinguishes the Backend secret field, validates backend health/auth, registers immediately, performs one read-only inspection and publishes the observation immediately. No Meta mutation is part of pairing. The frontend discovers fresh devices matching the selected/deep-linked account.

Windows `npm run test:connect` passed with a real unpacked Chrome-for-Testing extension and an intercepted Meta fixture: identity before pairing, identity persistence, changed-account detection, invalid-token rejection, visible one-click connection/read result and immediate Backend state including controls. Fixture device is removed afterward. `npm run test:ui` also passed for DOM actions. Core checks (12 tests), frontend typecheck and production build passed. Live inspection of the user's Meta account still requires their Chrome to reload and connect; no real Meta login, cookie or account content was used in these tests.

## First live Meta read and reader compatibility (0.3.2)

A user-connected extension successfully inspected Campaigns, Ad Sets and Ads and returned the requested account in both the binding and URL. The visible reporting interval was preserved across these navigations. Meta footer totals and actual snapshot records were kept in ignored `reports/` artifacts and command receipts; no normalized insights were inferred from them. The browser was returned to Campaigns.

The original automatic collector failed at its first page with `No visible reporting table` while the inspector could read names and column headers. Its selector path required `[role=grid]`/`table`, row wrappers and gridcell/td cells. The patch adds treegrid/cell/rowheader support and a conservative fallback for visible reporting text under column headers. Fallback captures carry an explicit unverified row/column warning and do not manufacture metric mappings. Both popup export and the collection runner accept this raw format; deduplication compares fallback content as well as structured rows. Empty pages and isolated unrelated headers still fail rather than produce data.

`npm run test:reader` passed against browser fixtures for structured grids, treegrids, gridless reporting text, offscreen exclusion, secret-input exclusion, unknown attribution and empty/header-only rejection. An initial Thai preset assertion failed because the fixture response lacked UTF-8 encoding; setting the fixture charset fixed the fixture without changing the reader regex. The standard three-page Extension integration and all 12 core tests passed. The patched reader still requires reload/reconnection in the user's Chrome before live validation; fixture success does not establish compatibility with every Meta layout.

## Live retest of 0.3.2 and scope correction in 0.3.3

The reloaded live extension completed its three-page read path. Campaigns captured eight visible campaign labels in text fallback. Ad Sets and Ads returned fallback captures that included navigation labels; those captures were rejected during review and were not normalized. The raw failed-scope observations are preserved under ignored `reports/` artifacts.

A browser fixture with column-oriented headers reproduced the scope error: the old fallback began above the headers' common ancestor and excluded all descendants of that ancestor as data markers. It could then select an outer wrapper because it contained unrelated navigation links. A new assertion reproduced the extra navigation label before the fix.

0.3.3 starts at the common ancestor, accepts row switches/cells outside actual column headers as evidence, and no longer treats generic navigation links as evidence of reporting rows. The runner retries an unavailable row layout up to three reads instead of accepting a loading-only page. Reader captures carry `reader_version` for live verification. Browser regressions now cover column-oriented layout and loading headers with unrelated navigation, along with existing grid/treegrid/viewport cases; all passed. Core 12 tests, the full structured three-page Extension integration and pairing integration also passed. Live validation of this correction requires loading 0.3.3 in the user's Chrome.

## Live acceptance of 0.3.3 — foreground tab retest

After reconnection, the first campaign-only job exhausted its three bounded reads without a snapshot. An independent UI inspection also showed column headers and the eight-campaign footer but no campaign rows. A screenshot command was rejected because the bound tab was inactive. A targeted upward scroll did not restore rows in its returned observation. After `ui.focus`, an independent inspection showed all eight campaign names again. This supports a foreground-rendering dependency in this live session; it does not prove that all background Meta tabs behave this way.

A fresh three-level job (`851413d7-b930-4d34-a3c8-add5c972b873`, one capture per level) finished at `needs_review`. All three snapshots explicitly identify reader 0.3.3 and account ACCOUNT_ID. Campaigns captured eight entity links, Ad Sets ten entity links, and Ads captured visible names/statuses in text (no entity links), with a footer reporting 40 ads. The Ads capture contains ten visible name/status occurrences; this is not evidence that all 40 ads were captured. No navigation labels appeared in these reporting captures. The displayed reporting period remained 16 October–14 November 2026.

All captures remain `visible_text_fallback`: row/column associations, stable entity IDs, hidden metrics and whole-account coverage remain unverified. No normalized import or ad mutation was performed. Raw observations are saved in ignored `reports/retest-reader-current-2026-11-15.json`; the paired Thai report explains these limits. This was a live acceptance run; no application source changes or new fixture-test claims were made.

## Analysis data workflow 0.4.0

Implemented the analysis workspace, explicit goal-specific metric completeness, separate measured/calculated values, unit-correct ratios, strict condition groups, duplicate/overlap handling, Thai/English header aliases, user column mapping (including raw-only fields), optional grouped-dot numeric parsing, source filename/row/header mapping, and JSON/CSV analysis exports. CSV exports use the union of row keys so an optional metric present only in a later row is retained. Budget is preserved separately from spend and is not summed as an expense. No net profit is calculated without business costs.

Extension captures now include semantic or geometric row/cell observations, plus the source headers, timestamp and reader version. Geometric rows remain review evidence; duplicate names are not stable IDs and observations are not automatically joined or imported. Horizontal collection is bounded to twelve pans per vertical block; default analysis collection uses five vertical blocks. Start/resume foregrounds the bound Meta tab; switching away pauses with an actionable reason. The bridge reports its manifest version, and the analysis workspace gates new collection/report commands until it sees Extension 0.4.0 or later.

`report.prepare` configures only recognized checkbox labels within an identified Customize Columns dialog on the bound Ads Manager reporting route. It adds rather than removes columns, prioritizes required fields, reports unavailable fields and clicks only a unique Apply control in that dialog. It does not invoke the general ad editing executor or change actual budget/status fields. Unrelated dialogs, ambiguous labels and changed accounts/routes stop the workflow. Injected errors are serialized before returning through Chrome scripting.

Passing checks against the final implementation:

- `npm run check`: strict TypeScript, 19 core tests, Extension/API bundles.
- `npm run build:web`: Next production build including TypeScript.
- `npm run test:reader`: existing grid/treegrid/fallback regressions plus duplicate-name geometric rows, correct row/metric placement, secret exclusion, horizontal pan/reset and vertical scroll in browser fixtures.
- `npm run test:report-columns`: exact dialog-scoped selection, already-selected preservation, missing fields, account and route changes, unrelated-dialog refusal, no outside checkbox or Publish mutations.
- `npm run test:analysis`: real authenticated Express/PostgreSQL, analysis preview ratios, rejected reconciliation, round-trip persistence of new metrics, correct IDs and import idempotency. Exact marked fixture account/device cleaned up.
- `npm run test:browser`: unpacked extension, standard three-level collection, popup/API synchronization, bridge and account guard.
- `npm run test:ui`: existing controlled DOM operations and important-action guards passed during this change.
- `npm run test:web`: actual production Next server on 9321, authenticated API and PostgreSQL. Original import/export/control/approval/mobile tests, analysis goal switch, incomplete conversion evidence, JSON download, report.prepare command payload/result display, and column-scanning collection payload. Fixture results emulate the extension; they do not contact Meta. Desktop screenshot `docs/screenshots/frontend-analysis.png` inspected; analysis mobile viewport has no document-level horizontal overflow.
- `npm run health`: normal Backend and database ready after restarting the updated services on 4318 and 9321. Temporary validation servers on 4320/9322 stopped.

Debug ledger: horizontal reset initially failed once all headers had scrolled offscreen; scroller discovery now uses reporting headers independently of their viewport position while requiring a visible scrolling container. New frontend module imports initially passed TypeScript but failed Turbopack's `.js` resolution; shared runtime imports use extensionless paths, verified by production build. Adding the column-mapping table exposed an overly broad test-only `tbody` locator, narrowed to import history. Analysis goal labels were made explicit and separate from select options so accessible labels match the visible names.

Limits: no new live Meta metric extraction or column-setup success is claimed for 0.4.0. The previously connected live extension continued reporting the old session; Chrome still needs to reload 0.4.0 and reconnect for live acceptance. No real ads were created, edited or published in this implementation round. DOM captures may be partial and remain unverified; validated CSV imports are the supported path to persistent per-ad metrics when IDs/reporting conditions are complete. The entire-account coverage flag remains unverified throughout.

## Live 0.4.0 report setup failure and 0.4.1 regression correction

The connected device explicitly reported 0.4.0. Its existing Ads collection was paused before testing `report.prepare` for messages. Live command `a05ca93b-1361-4270-963c-6678e5871929` failed with `เลือกคอลัมน์แล้ว แต่ไม่พบปุ่มนำไปใช้ที่ยืนยันได้ ตรวจหน้าต่าง Meta`. This error wording describes the stage reached; it does not prove any requested column was selected.

Read-only inspection `e84758b7-d40f-4bb8-a015-b5841bd54369` showed the identified `ปรับแต่งคอลัมน์` dialog, a search input named `search columns`, native checkbox inputs without labels next to text in `li` elements, and footer controls `ยกเลิก` and `บันทึก`. The original resolver accepted only associated labels/ARIA/text on the checkbox itself; the commit-control matcher accepted Apply/นำไปใช้/ใช้ but not Save/บันทึก. The search selector also excluded inputs named only by `aria-labelledby`. Thus recognizing the dialog did not establish compatibility with its selectable fields or commit control.

A browser fixture using the observed Thai dialog title, unlabeled list-item checkboxes and Save text reproduced the failure. 0.4.1 resolves a list item's text only when it belongs to the identified dialog and contains exactly one checkbox; it uses the accessible label resolver for search discovery; it accepts Save/บันทึก only for the unique commit control inside that same identified customization dialog. Existing route/account checks and refusal of unrelated dialogs remain in force. A second fixture exposes metrics only after typing into an aria-labelledby search input; this passes too. The outside checkbox and Publish trap remain untouched.

Checks passed: report-column browser regressions, all 19 core tests, strict typecheck, Extension/API build and reader browser regressions. These validate the reproduced layout, not a completed live 0.4.1 setup. Raw command/inspection artifacts are under ignored reports/. Live acceptance of the correction requires loading 0.4.1 and reconnecting; no Meta ad was edited or published.

The subsequent live 0.4.0 viewport-only Ads job `27415223-1888-4b74-8466-3718c12a998e` completed at needs_review with ten geometric row observations. The capture contained per-row Results, Cost per result and Impressions (for example Rov: 6, THB20.76, 1597; รวม 1: 3, THB17.95, 787), and preserved duplicate names as separate rows. The review parsed those numeric fields and left em dashes null. Spend, link clicks, explicit messaging event counts and stable IDs remained absent; reporting timezone/currency/attribution remained unverified. The footer reported 40 ads, which is not a collection count. No normalized import was performed. Raw capture and review are in ignored reports/live-v040-state.json and reports/live-v040-review.json; Thai summary in reports/live-v040-result.md. This establishes partial live row extraction, not complete metric readiness.

## Live 0.4.1 acceptance and remaining column-selection issue

The bridge confirmed `extension_version=0.4.1`. Live report command `1c6bfdc2-9106-4ef2-ba62-47bd117dec5b` returned `applied=true` after closing the customization dialog, but `selected=[]` and all twenty requested fields were listed as missing. This proves only the save/close control was activated; it does not establish successful column setup. The returned reporting route was Campaigns and its preset label changed to a copy. No ad was edited or published.

A subsequent explicit Ads viewport job `66536900-b9ee-4458-a9ed-aa7d1ddbd3ff` completed needs_review with ten row observations stamped reader 0.4.1. Headers still contained Results, Cost per result, Impressions and budget/purchase-related fields, without spend, link clicks or IDs. Raw evidence is saved as ignored `reports/live-0.4.1-state.json`; the report receipt is under `reports/live-v040-command-1c6bfdc2-9106-4ef2-ba62-47bd117dec5b.json`.

Further reproducible fixture: appending hidden descriptive text to metric list items makes the old textContent-based exact label matcher miss every requested field, matching the observed empty-selection symptom. The production DOM's exact checkbox label contents have not yet been captured, so this is a reproduced contributing case rather than a confirmed sole live root cause.

0.4.2 uses rendered innerText for element labels, refuses to save when no field selection can be verified, preserves serialized failure evidence through the bridge as a failed receipt, and includes bounded label/search diagnostics. Report-column regressions now exercise hidden helper text and verify zero-selection never activates Save. All 19 core tests, strict TypeScript, Extension/API build, and reader/report-column browser regressions pass. Live 0.4.2 validation remains pending Chrome reload/reconnection; no claim of complete per-ad metric extraction is made.

## Live 0.4.2: slow Meta columns menu

Confirmed a live 0.4.2 bridge. Two report.prepare attempts (`65e9e35e-dfb1-41ec-80a5-ebc98d363e50` and `f33576aa-b897-4515-b1e2-b2129fbd3300`, the latter after explicit Ads navigation) stopped before opening customization. Both serialized failures were preserved as error receipts, and both returned snapshots with a disabled `กำลังโหลด…` menu item. No field selection or report save was claimed.

Independent inspection `17c18b04-209f-489f-a0d7-ce1f5e40b970` later showed the loaded menu and its `ปรับแต่งคอลัมน์` button (`node_112`), with no customization dialog yet. This isolates a menu-readiness problem before checkbox matching. The user was asked to leave the customization dialog open so the installed 0.4.2 can test checkbox selection without another reload.

A delayed-menu fixture (customize entry appears 1600ms after opening) reproduced the 900ms timeout. 0.4.3 waits up to 8s for the menu and 6s for the dialog, within the existing overall deadline. It reuses an already-visible customize entry and waits for an already-loading menu rather than toggling it closed. Delayed-menu and previous column tests, all 19 core tests, strict typecheck, bundles and reader browser regressions passed. This is a prepared patch; no live 0.4.3 acceptance claim is made. Current live completion still depends on opening the customization dialog or loading the patched workflow.

## Live open-dialog 0.4.2 diagnostics and Chrome input implementation 0.5.0

With the user-opened customization dialog, report command `b9814256-e983-42ee-9ad8-68a7ce14859f` reached field selection and returned a failed receipt without saving. Diagnostics now show exact recognized labels for spend, impressions, reach, frequency and cost per result. All candidate queries were attempted, but the independent post-action snapshot still showed an empty search value and unchanged initial option groups. No selection was verified. This disproves label extraction as the only remaining explanation; it does not establish which Meta event handler rejects or reverts synthetic input.

Implemented `report-probe.ts` (read-only, guarded report control planning) and `report-input.ts` (fixed Chrome debugger Input commands). A local, tab/account-scoped 15-minute report input lease must be enabled from the popup; remote commands cannot enable it or provide CDP methods, JS, selectors or coordinates. Start/report guard checks and each Input dispatch verify the same reporting route/account, active tab, lease and bounded deadline. The debugger attaches to one bound tab and detaches in finally. Missing fields are explicit; there is no claim that Save alone proves column completeness.

Chrome requires the debugger permission in the manifest; it cannot be optional. 0.5.0 therefore introduces a permission change, disclosed in the popup/workspace documentation. It does not enable the local input lease automatically. Existing ad-editing controls and important-action approvals remain in their separate executor.

`npm run test:report-input` passed with the actual unpacked MV3 extension and Chrome debugger transport. Its intercepted fixture explicitly rejects synthetic input, requires isTrusted events for opening dialogs, filtering fields, changing checkboxes and Save, and hides Link clicks until a search occurs. The native path selected every required field, left an outside ad budget and Publish control untouched, rejected absent/mismatched local leases and detached its own debugger session after completion. This proves the transport against a controlled browser fixture, not live Meta acceptance. Playwright itself keeps the page target attached, so detach is verified by rejecting a subsequent command from the extension's own debugger session rather than by the target-wide attached flag.

Final 0.5.0 checks: core check (19 tests/typecheck/bundles), Next production build, reader browser regressions, unpacked-extension three-page browser integration, actual debugger Input fixture, analysis API/database integration, production Next web integration and pairing integration all passed. Pairing integration now clicks the real popup enable/disable report-input buttons and verifies their account-bound status reaches the API as true/false. Normal services remain running on 4318/9321. At the final live-status check the user's connected bridge still reported 0.4.2; live 0.5.0 acceptance is therefore pending user reload and explicit local report-input enablement. No further live report command was queued without that local lease.

## Live 0.6.0 read-only acceptance and 0.6.1 corrections

15 Nov 2026, Thai UI, THB, one connected device (ACCOUNT_ID / DEVICE_ID not recorded here). Read-only job over campaigns, adsets and ads; no write, toggle, budget or publish command was sent. An earlier paused job pointed at a closed tab; a fresh `start` used the currently bound tab and finished as `needs_review` in about 30 s.

- campaigns: 8 geometry rows, matching the summary row count 8. adsets: 8 of 10. ads: 8 of 40. All `column_alignment=aligned`, `header_mode=hit_test`, currency THB from cell symbols, explicit date range parsed.
- identity null on every row: names are not links carrying `selected_*_ids`; on the ads level no links were present in rows at all (UI inspection of controls). No ID columns in the preset. Parent IDs therefore also unknown.
- No spend column in the preset; timezone and attribution not visible. All 24 rows stayed `needs_review` (reasons: stable_id_unverified, column_mapping_unverified, timezone/attribution/result_type unverified, missing spend).
- Vertical scroll returned false on every level: the reporting body is not an `overflow:auto/scroll` element, so only the first viewport was read.
- The summary row text ("ผลลัพธ์จาก N …") was merged into the last row's name cell, and row hover buttons into the hovered row's name cell.

0.6.1 (fixtures only until reloaded): summary row excluded and counted, hover labels stripped, vertical fallback (scrollable ancestor incl. overflow:hidden, else one wheel event; clipped pre-rendered rows ignored), immediate re-read after scroll/pan, `resume` rebinds to the bound tab, and capture performance analysis. Checks: typecheck (root and web), 34 unit tests, reader browser fixtures, capture API integration including `/captures/analysis`.

## Live 0.6.1 read-only rerun and 0.6.2 corrections

16 Nov 2026 (00:11 Asia/Bangkok), same device after reload; state reported 0.6.1. Fresh read-only `start campaigns adsets ads` finished `needs_review` in about 30 s. Column preset unchanged (no spend, ID or attribution columns).

- Summary-row counts were captured: campaigns 8/8, adsets 8/10, ads 8/40 (`reported_total_rows`). Coverage did not improve: one snapshot per level, so vertical paging still did not reveal new rows. 0.6.1 could not tell whether a scroll moved anything.
- The summary row text was still merged into the last row's name cell on all three levels even though it was counted: the sticky summary row is positioned outside the wrapper the 0.6.1 exclusion measured.
- All 24 rows stayed `needs_review` (no IDs, no spend, timezone/attribution unverified).

0.6.2 (fixtures only until reloaded): summary row excluded by its own text rectangle and by its text; new `scrollReportingRows` pages only when the visible rows actually change (scrollable ancestor → one wheel event → scrollIntoView), reverts a scroll that moved nothing, and records `job.scroll_log` (methods tried, element tag, overflow, pixel range, moved; no page text) so the next live run shows which strategy Meta accepts.

## 0.6.3 reliability correction — 16 Nov 2026

Baseline failure was reproduced on real 0.6.2: seven visible rows across six horizontal slices produced 42 content keys, incorrectly labelled complete against footer40, despite vertical moved=false and no stable IDs. See ASSESSMENT_2026-11-16.md. Regression cases additionally reproduced stale same-ID values under a latest-date label, cross-currency aggregation, false reported-spend provenance, absent breakdown/filter context, and unresolved delivery observations being called ad counts.

Core now separates reporting scopes, merges complementary columns only by verified IDs, preserves per-row provenance, blocks ambiguous evidence, and derives spend quality from actual values. Unknown filter/breakdown evidence is not empty verified context. Normalized analysis adds explicit goal evaluation and reasons; missing/duplicate/overlapping evidence blocks comparisons, while sample and peer prerequisites remain separate from data readiness. No autonomous budget, delivery or publication operation was added.

Observed verification in this session: 52 unit tests pass; production Next build and web typecheck pass; current-source API integration for capture persistence/scoped analysis and normalized analysis passes; production web integration including evaluation display/export passes; isolated capture-analysis web fixture passes on desktop/mobile. Fixture accounts are random and cleanup only removes each test's own records. API tests also cover 404 for unknown/foreign-account capture jobs and propagation of collection warnings.

After restarting the local API on4318 and production Next on9321, the same STORED real0.6.2 raw captures were reanalyzed: 42 raw observations, zero verified entities, footer40, two reporting scopes (one lacks verified currency), partial coverage, mixed spend provenance, no result-group totals or eligible rankings. This verifies corrected analysis of real evidence, not a fresh0.6.3 collection and not zero actual ads in Meta.

Live0.6.3 acceptance requires the user to reload the built unpacked Extension, reconnect the same account/tab and locally enable the report-input lease before native fallback can be exercised. Until device state and new reader snapshots confirm0.6.3, do not claim complete live paging, report setup, or per-ad analysis readiness. Data may still need validated Ads-level CSV when IDs or reporting conditions are absent. No real ads were edited or published in this round.

Final Extension checks:0.6.3/API bundle built, reader/report-column/native report-input fixtures pass, root typecheck passes, and pairing integration using the newly built MV3 package passes. Independent reviews verified fixes to pause/rebind guards before native input and movement signatures excluding metric refresh; fixtures cover stationary metric updates and repeated-name pages with changed IDs. Both reviews report no remaining material finding in their reviewed paths. Final connected-device check still reported0.6.2 and report_input=false, so live0.6.3 remains pending rather than passed.

## Live0.6.3 after user reload — 16 Nov 2026

The user reloaded/reconnected. Backend state confirmed extension_version0.6.3, report_input=true, fresh heartbeat, same bound account. Queued inspect returned observed/account_verified=true.

Messages report.prepare failed safely with applied=false. It reported entity IDs among selected fields, but could not confirm required account_id/spend/link_clicks/messaging_conversations and therefore did not Save. This is an incomplete column setup, not successful live acceptance. Trace shows an initially selected spend later missing/ambiguous during recheck, empty/previous search values and stale option lists. These observations do not alone prove a sole cause.

A subsequent fresh Ads collection navigated back to the report view and completed needs_review: six snapshots with seven rows each, footer40, no stable IDs. DOM scrolling did not move; native wheel planning refused reporting_target_occluded before dispatch. An Extension screenshot confirmed the report was visible with no modal and neutral metric columns farther right than the row controls/name area. The exact hit-tested element was not captured; an interactive name area is a hypothesis for the fixed-offset target's rejection. Scope/identity blockers correctly prevented complete coverage, totals and rankings. This verifies conservative failure handling, not successful paging.

Raw receipts/state/screenshot are ignored local reports/live-v063-*-private files. Do not commit them or copy account/ad identifiers into documentation. Follow-up work targets bounded safe reporting-cell selection and report field/search matching; fresh live acceptance will require loading the resulting build.

## 0.6.4 narrow follow-up

Reader now tests at most24 locally derived points inside visible reporting columns/row bands, rather than stopping at one occluded fixed offset. Modal, interactive control and outside-scope guards remain. Bounded allowlisted target diagnostics reach job.scroll_log; no page labels, names or coordinates are logged there. RED fixture reproduced a blocked name-area target with an available safe metric cell; GREEN also preserves all-blocked/outside-grid refusal. The live screenshot supports this hypothesis but does not prove the exact rejected element.

Report matching now uses accessible/leading checkbox labels, excluding explanatory category text. The helper-label false match was reproduced RED and corrected; genuinely duplicate exact matches still refuse action. Native search checks the exact query and waits for an exact matching field within the same bounded4s alias window. RED/GREEN covers both delayed controlled-value commitment and immediately accepted input with empty interim choices followed by results after2600ms without a busy marker. Empty interim results no longer cause premature alias changes. Overall120s/lease bounds remain unchanged; optional missing columns skip searches to preserve required-field verification time.

The report's optional Account ID display column can be absent, but bound account/URL validation remains mandatory and wrong-account fixtures refuse input. Entity IDs/spend/goal metrics remain required before Save. This is not permission to infer account identity from names.

Observed checks:52 unit tests, reader/probe/column/native-input fixtures and typecheck pass; Extension/API build0.6.4 passes. Current-source native fixtures additionally retain missing/reverted required selection, no-lease/mismatch/expiry/editor-route rejection, pause/rebind races, metric-only refresh refusal and debugger detach. No new migration/dependency or Meta network access was added. Live0.6.4 remains pending loading the new artifact and a fresh local report-input lease;0.6.3's failed live run is retained as failed.

Newly built0.6.4 MV3 pairing integration also passes. Independent review rechecked the candidate-target guard and the delayed-empty-results fix with no remaining material finding in those paths. Post-build real-device state still reported0.6.3/report_input=false; no new input was queued without the required local authority.

## Live0.6.4 collection after reload

User-side reload/reconnection and report_input=true were observed in fresh device state. A user-started campaigns/adsets/ads collection was already running; no competing command was issued. It finished needs_review with campaigns five8-row snapshots/footer8, adsets five8-row snapshots/footer10, ads six7-row snapshots/footer40. Raw ID observations appeared in two campaign slices, but remained unverified for analysis; none at adset/ad level. Do not add snapshot rows to claim entity coverage.

Native planning now finds a permitted target (candidate_count1, no rejected candidates), but every level returned visible_rows_unchanged after wheel input. Thus the occluded-target refusal is resolved for this view, while successful vertical paging is still NOT demonstrated. Verified entity counts/ranking eligibility remain zero because identity/mapping/context blockers persist. Raw state remains ignored reports/live-v064-state-private.json.

After the collection finished, queued report.prepare for messages again returned an error with applied=false: spend/link_clicks/messaging_conversations were not confirmed at final verification. Entity ID fields and attribution were reported selected; the missing optional account column no longer blocks readiness. Trace still shows initial spend selected, while search/recheck did not establish the three remaining required fields. No Save/publication/budget action was performed. The exact live cause of the remaining search failure and unchanged scrolling is unconfirmed; fixtures prove narrower defects only. No fresh normalized real-ad data or reliable per-ad recommendation is claimed.

## 0.6.5 evidence-driven corrections

The user authorized all remaining fixes. Current0.6.4 evidence additionally showed column_alignment=mismatch in campaign ID-bearing horizontal slices. Source investigation reproduced a header-only pan when the metric body had no switches/checkboxes: the old selector moved header/frozen areas but not the actual numeric body. New fixture verifies header/body together, frozen name/header and unrelated editor unchanged. Numeric/type-only scroller diagnostics permit checking this mechanism on the next real run; no claim yet that it is the sole live cause.

Native transport now tries bounded distinct metric bands with fresh hit tests and unchanged lease/account/job guards. RED→GREEN proves fallback when an initially safe band ignores wheel events. A draft offset-only movement rule was rejected in independent review before release: metric-only movement could pair new numbers with frozen old IDs. Corrected helper waits for identity/name synchronization and otherwise stops reporting_body_moved_rows_unverified. Reader emits row_alignment and refuses geometric trust on divergent vertical offsets/unverified transforms; core promotion/analysis reject explicit misalignment even if a row claims semantic/verified_geometry. End-to-end fixtures cover independently moved metrics, normal zero/equal-offset split panes and cohesive scrolling. No unsafe offset-only rule was released.

Additional RED→GREEN report defects: hidden loaders blocking queries, ancestor-clipped or overlay-covered selected checkboxes falsely accepted, and language ordering inferred from an English search aria name inside a Thai dialog. Checks now use visible busy markers, clipped/hit-tested controls and dialog locale. Trace preserves early context plus latest verification within200 entries and records phase/field/bounded counts rather than silently truncating the final failure. These are proved code defects; the latest real screenshot still showed a normal table, not the customization dialog, so their contribution to the live search failure remains unconfirmed.

Another exact pure-function regression demonstrated a scope bypass: three DOM ads blocked by raw analysis were promoted without breakdown/filter evidence and then classified by normalized evaluation. Promotion now requires scope proof and identity provenance, preserves breakdown in the grain, rejects nonempty unsupported filters, stamps proof/provenance and blocks legacy DOM normalized data lacking matching proof from totals/recommendations. No migration, deletion or historical-data rewrite occurred.

Existing review workflow now accepts explicit true-only no-breakdown/no-filter confirmations under one shared schema. Defaults are unchecked and reset by capture/account; observed contradictory scope and missing IDs/date/currency/mapping cannot be overridden. API fixture verifies rejection before confirmation, true-only validation, promotion/audit only after explicit confirmation, and no identity creation. Browser fixture verifies empty default POST, reset on another capture, and flags sent only after user selection. Raw evidence remains unchanged; normalized records carry DOM/operator provenance.

Reader also preserves parent IDs from explicit visible columns and refuses conflicting own/parent ID columns or links. This closes the no-href child promotion path without joining names or positions as identity. Latest pure unit count62/62; current-source API tests, production Next build and browser review-flow tests pass. Final Extension0.6.5 artifact is built; fresh live acceptance still requires actual runtime0.6.5 and user-enabled local report-input lease. All raw customer evidence remains in ignored reports/.

## Live 0.6.19–0.6.21 Breakdown Age

`0.6.19` preserved `demographics_breakdown=age` through job navigation and ran a
39-snapshot collection. Age values were visible as subrows but the original
reader captured only parent Ads rows, so breakdown remained unverified.

Read-only DOM diagnostics in `0.6.20` showed age text subrows had no ID link or
switch inside their own ancestors; they sit below a parent row carrying the
stable Ad ID. `0.6.21` maps each visible age subrow by Y geometry to the nearest
preceding stable-ID parent, copies only ID/status/result-type metadata from that
parent, and reads the subrow's Spend/Impressions/Results from its own cells.

Live job `27244eba-436b-47ec-a9e7-62a160274b21` persisted 36 snapshots. The
analyzer produced age scopes `18–24`, `25–34`, `35–44`, `45–54`, `55–64`, `65+`
with 25–34 verified Ads per scope, Spend from the reported column, and no
breakdown blocker after the analyzer fix. It did not yet produce rankings because
most subrow Results cells lacked a result type.

0.6.22 adds parent status/result-type metadata copy and busy-marker waiting for
the Breakdown menu. Its reader fixture covers age subrows, stable parent ID,
metric cells, status and result type. `npm run check` (67 tests), reader,
Breakdown, browser, report-probe and report-columns fixtures pass. Live0.6.22
acceptance remains pending reload; no ranking from age scopes is claimed yet.
