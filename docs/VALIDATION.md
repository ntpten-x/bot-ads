# Validation record — 2026-11-15

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
