# Reliable Ad Analysis Implementation Plan

> **For agentic workers:** Use test-first implementation with separate ownership for core capture analysis, Extension collection/reporting, and normalized evaluation. Integrate and review the complete pipeline.

**Goal:** Correct every verified reliability issue in the assessment and provide honest, actionable ad evaluation.

**Architecture:** Keep raw evidence distinct from validated records. Group compatible contexts, merge by stable IDs only, derive provenance from values and verify collection with observed row changes.

**Tech Stack:** Existing TypeScript, Zod, Express, Next.js, PostgreSQL, Chrome MV3 and Playwright; no new dependencies.

**Spec:** ../specs/2026-11-16-reliable-ad-analysis-design.md

## Global Constraints

Preserve dirty workspace. Windows npm only. No Meta APIs or credential extraction; preserve local leases/approvals. No automatic ad changes. No real DB cleanup or unrelated commits.

## Review Focus

Horizontal slices without IDs; conflicting repeated IDs; mixed/unknown reporting contexts; zero versus absent metrics; actual versus estimated spend. Each must have behavior tests.

## Tasks

- [x] 1. Core capture analysis: add failing tests in tests/capture-analysis.test.ts, then fix packages/core/src/capture-analysis.ts. Keep API compatible where possible, expose explicit scope and quality blockers. Test coverage and provenance from actual evidence, complementary slices and conflicting data.
- [x] 2. Extension reader/report workflow: reproduce failed live paging with sanitized fixture where possible, add reader/report regressions before fixes; improve verified bounded navigation/input under existing leases. Required ID/spend fields must be checked. Own extension files and browser fixture tests only.
- [x] 3. Normalized goal evaluation: add tests/analysis.test.ts regressions then extend packages/core/src/analysis.ts with reasoned deterministic assessment, prerequisites and next steps. Preserve null and reporting groups. Update normalized analysis UI and export types.
- [x] 4. Integrate capture UI/API contract, update docs/ANALYSIS.md, handoff and validation. Run Windows units/typechecks, reader/report fixtures, API persistence and web integration. Build once after source checks; do not claim loaded extension changed until confirmed.
- [x] 5. Independent code review, correct material findings, rerun affected checks, and attempt bounded live acceptance through queue if correct version and leases exist. Report limitations without relabeling needs_review as success.

## Execution record

- Existing dirty working tree contains the user's full running implementation; edit current source in place to preserve it and Windows dependency setup. No branch reset, dependency install, staging or commit.
- Design/implementation authorized by user's request to implement all assessment recommendations and choose the design. Delegate independent file ownership per dispatching-parallel-agents skill; root owns API/capture UI and integration.
- Completed test-first changes and two independent review passes. Fixed additional missing-scope/delivery-count/provenance findings and native pause/signature races. Final units52/52, root/web typechecks, root/API+Next builds, reader/report-column/report-input fixtures, analysis/capture API integration, web/capture-analysis-web and newly built Extension pairing pass.
- Local services restarted at4318/9321. Existing real0.6.2 evidence reanalyzes as partial with zero verified IDs and no totals/rankings, eliminating false42/40 completeness. Final device check still reports0.6.2 and report_input=false; new0.6.3 live paging acceptance pending user Reload/reconnection/local popup lease. User has been notified asynchronously; no lease bypass or new live input sent.

## Live acceptance continuation

- User confirmed Reload/reconnection. Fresh0.6.3 state and local report-input lease confirmed. Inspect passed. Report setup failed required fields and refused Save; read ended needs_review, six7-row snapshots/footer40, native target rejected as occluded. Evidence/limits recorded in VALIDATION.md.
- Narrow follow-up:0.6.4 bounded candidate selection in reporting cells, exact primary field labels excluding helpers, search value/results settling and required-first workflow. Preserve all account/tab/lease/pause guards. Tests reproduce occluded first target, unsafe overlays, helper-label false matches and delayed native search.
- Ruling: report account_id column may be optional because independently verified bound URL account remains mandatory; the actual account identity is never inferred from a label. Campaign/adset/ad ID columns and goal/spend metrics remain required. Missing optional columns must stay explicit and must not consume the time reserved for required-field verification.
- Ruling: screenshots and guard codes support hypotheses but do not prove sole live causes. A fixture pass/build cannot certify Meta paging or report setup until the new version is loaded and tested on the same guarded path.
- Follow-up source/build0.6.4 complete: reader/probe/column/native-input regressions, typecheck and core52 tests pass; newly built MV3 pairing integration passes. Independent reviewer verified the late-empty-result fix after a distinct RED/GREEN fixture. Connected device still0.6.3/report_input=false after build; user notified to Reload0.6.4/reconnect/enable local lease. Live0.6.4 acceptance remains explicitly pending, not complete.
- User subsequently reloaded0.6.4 with local lease. Fresh3-level collection ended needs_review: native target guard passes, but every level remains visible_rows_unchanged; Ads seven rows per snapshot/footer40. Separate report.prepare again failed required spend/link_clicks/messages and refused Save. These live acceptance criteria remain FAILED even though regression fixtures pass. Updated handoff/validation; no autonomous budget or publication action taken.

## Remaining-fix implementation 0.6.5

- User explicitly authorized all remaining corrections. Added header/main-body pairing evidence, metric-first bounded native attempts, visible/clipped/busy report probes, dialog locale and final failure trace retention. Parent ID columns and contradictory identity source guards completed. Fixtures reproduced each corrected mechanism before edits.
- Independent review rejected draft metric-offset-only success. Final helper refuses unsynchronized metric-only movement; reader and both core paths enforce row_alignment. New end-to-end capture regression and cohesive/split positive controls pass.
- Proved and fixed DOM promotion bypass into normalized evaluation. Shared operator context supports explicit true-only no-breakdown/no-filter confirmation; GUI unchecked/reset; known evidence cannot be overridden. Scope markers and provenance validate new records; legacy DOM stays visible but blocked. No DB migration/rewrite/deletion.
- Unit62/62, typechecks, reader/probe/column/native/scroll fixtures, current-source capture/analysis API integration, production build and review GUI tests verified. Built0.6.5 ready for live acceptance. Backend/Next updated at4318/9321. Real0.6.4 search/paging failure remains historical failed evidence; do not call0.6.5 live complete until new device/snapshot proof.
