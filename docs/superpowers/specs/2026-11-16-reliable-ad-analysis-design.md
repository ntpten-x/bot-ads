# Reliable ad reading and analysis

User requests all corrections from ASSESSMENT_2026-11-16 and delegates design and implementation. Continue existing local Next.js/Express/PostgreSQL/Chrome Extension architecture. Preserve existing workspace changes; do not commit unrelated work.

## Approach

Repair existing contracts and evidence pipeline, rather than replace it or introduce Meta API access. CSV remains the validated reconciliation path. DOM is bounded visible evidence; incomplete evidence must remain incomplete. A new LLM service would not fix identity, units, or collection and is unnecessary for auditable performance evaluation.

## Design

- Scope every capture analysis by account, level, dates, currency, timezone, attribution and breakdown evidence. Different or unverified contexts cannot silently become one comparable report.
- Stable IDs alone link horizontal column slices. Preserve unresolved observations separately, never count them as confirmed unique ads or certified coverage. Merge compatible complementary cells; reject conflicts and retain provenance. Latest same-context evidence replaces stale same-ID values deliberately.
- Derive spend source from actual values used: reported, estimated, mixed or missing. Do not certify spend from presence of a header. Unknown remains null. Rankings exclude unresolved identity, incompatible context and uncertain mappings from actionable conclusions.
- Improve bounded vertical reading with verifiable viewport change and diagnostics; native input may only run through an existing account/tab-scoped locally enabled lease. No automatic lease enablement or renewal. No cookies, network interception, internal endpoints or Meta API.
- Report setup must verify selected required columns, including IDs and spend, before saving. Partial setup cannot claim ready.
- Web displays scope, coverage, unresolved observations, spend provenance, blockers and next steps. Normalized analysis evaluates explicit goal metrics with reasons and missing prerequisites; no net profit, causal claims or autonomous budget changes without evidence.
- Acceptance: regressions reproduce existing false coverage, changed same-ID values, mixed dates/currencies, absent values and estimated spend; fixtures cover horizontal slices and paging. Run Windows typechecks, units, reader/report/browser/API/web checks relevant to changes. Live acceptance only for actually installed version and valid local permissions; otherwise state pending precisely.

## Constraints

Keep ports 9321/4318/5432. Use Windows dependencies via cmd.exe. No real-data deletion; only exact fixture cleanup. Add migrations only if needed; prefer no schema migration. Generated bundles are build outputs. No secret or customer evidence committed.
