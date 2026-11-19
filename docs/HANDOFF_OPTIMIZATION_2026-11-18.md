# Handoff: Database-first Reports and Optimization Loop

วันที่: 18 พฤศจิกายน 2026

สถานะ source/build: Extension `0.6.72`

Branch ที่ส่งต่อ: `master`

Commit message ที่ใช้ส่งงาน:

```text
feat: add database-first reports and optimization loop
```

เอกสารนี้เป็น handoff ของงานที่ต่อจาก commit ฐาน `c0f9201` โดยสรุปทั้งสิ่งที่
ใช้งานได้ หลักฐานทดสอบ ข้อจำกัดที่ยังเปิดอยู่ และลำดับงานที่ AI คนถัดไปควรทำ

## 1. เป้าหมายของรอบนี้

เป้าหมายคือทำให้ระบบ:

1. เก็บรายงาน Ads จาก Chrome Extension เข้า PostgreSQL ได้จริง
2. แสดงรายงานที่ตรวจสอบคุณภาพได้โดยไม่ใช้ CSV เป็นแหล่งหลัก
3. แยกข้อมูลตาม Account และ Customer อย่างถูกต้อง
4. สร้างข้อเสนอจาก Ads ที่มีหลักฐานเพียงพอ
5. วางแผนอนุมัติ ทดลอง และติดตามผลได้
6. ยังไม่แก้โฆษณา งบ หรือเผยแพร่โฆษณาแทนผู้ใช้โดยไม่มี certified adapter

## 2. สถานะที่ส่งต่อ

### พร้อมใช้งาน

- Web: `http://127.0.0.1:9321`
- API: `http://127.0.0.1:4318`
- PostgreSQL: local
- Report Studio
- Account Center
- Database-first report cache
- Customer/account ownership
- Client token hash, revoke และ disabled-account gate
- Scheduled read-only `report.collect`
- Optimization recommendations
- Optimization plan/approval/receipt/rollback
- Experiment register และ observation
- Creative metadata
- Campaign template
- Audit Trail
- Manual database backup/restore

### ยังไม่พร้อม

- Pause/Resume Ads อัตโนมัติ
- Duplicate Ads อัตโนมัติ
- Budget mutation อัตโนมัติ
- Campaign Draft Composer อัตโนมัติ
- Publish โฆษณา
- Statistical experiment decision engine
- Real-account load test 100–300 Ads
- Multi-device/multi-account concurrent soak test
- Automatic alerting/retention/backup scheduling

API ประกาศ `automated_meta_mutation=false` จาก
`apps/api/src/optimization.ts`; ห้ามเปลี่ยนค่านี้ก่อนมี certified adapter,
readback, idempotency และ rollback ครบ

## 3. Architecture

```text
Chrome Extension 0.6.72
  → visible Meta Ads Manager UI
  → command queue :4318
  → PostgreSQL raw captures
  → normalized observations / report cache
  → Report Studio
  → deterministic Optimization Engine
  → policy / plan / approval / experiment
  → local human execution (still manual)
  → latest capture outcome observation
```

ห้ามเพิ่ม:

- Meta Graph API
- Meta Marketing API
- Internal Meta endpoint
- Network interception
- Cookie/session/password extraction
- Backend approval แทน popup
- Arbitrary JS/selector จาก Backend

## 4. Base path

```text
Extension command
  → botCommandSchema
  → /devices/:device/commands
  → Extension ตรวจ device/account/tab/permission/lease
  → inspect
  → trusted UI action
  → observe
  → receipt
  → PostgreSQL
```

`report.collect` ทำ:

```text
navigate (ถ้าจำเป็น)
→ prepare/reuse Ads report columns
→ start read-only collection
→ Extension alarm อ่าน snapshots
→ state heartbeat
→ persistJob
```

ข้อควรระวัง: command receipt เป็น `done` หลังเริ่ม collection ไม่ได้หมายถึงอ่านครบ;
ต้องติดตาม `device.state.job.status` และ `/captures` จนจบ

## 5. Database migrations

รายการ migration ที่ลงทะเบียนแล้วใน `scripts/migrate.ts`:

| Migration | หน้าที่ |
| --- | --- |
| `004_report_performance` | index สำหรับรายงาน |
| `005_report_preferences` | target CPA/ROAS ต่อ account |
| `006_capture_report_cache` | analysis cache ต่อ job + operator context |
| `007_managed_accounts` | customer/account registry, enabled/display/template |
| `008_customer_access` | hashed client token และ roles |
| `009_operations_hardening` | audit log และ account collection schedule |
| `010_optimization_loop` | recommendations/plans/experiments/outcomes/templates |
| `011_experiment_observations` | entity IDs และ metric ต่อ experiment arm |
| `012_account_level_access` | all_accounts flag และ per-client account grants |
| `013_report_analysis_version` | version derived report cache และบังคับคำนวณใหม่เมื่อ analyzer เปลี่ยน |
| `014_data_lifecycle` | ad catalog, status history, monthly rollups และ retention policy |

ห้ามแก้ migration ที่ apply แล้ว ให้เพิ่ม migration ใหม่

## 6. Security และ isolation

- Local `.env API_TOKEN` เป็น bootstrap admin
- Client token เก็บเฉพาะ SHA-256 hash
- Roles: `admin`, `operator`, `viewer`
- Customer-scoped admin เห็นเฉพาะ Customer ของตน
- Viewer ทำ write ไม่ได้
- Account/Device/Job ต้องอยู่นอก Customer ไม่ได้
- Client ที่ `all_accounts=false` ต้องมี grant ตรง account ใน Customer เดียวกัน
- Account disabled บล็อก capture/import/report/command
- Customer disabled บล็อก token และ schedule
- Token revoke มีผล request ถัดไป
- ทุก Optimization mutation สำคัญเขียน `admin_audit_log`
- Audit ห้ามเก็บ token plaintext

## 7. Report Studio

Route: `/#reports`

ความสามารถ:

- KPI ribbon
- Bars
- Scatter
- Histogram
- Donut composition
- Concentration curve
- Daily trend
- Search/filter/sort
- Ads table
- Scope comparison
- Target CPA/ROAS reference
- CSV-vs-DOM reconciliation
- Normalized coverage
- Report cache

หลักการ:

- ไม่รวมยอดข้าม Account
- ไม่รวม Source CSV/DOM
- ไม่รวม Attribution/Result type/Breakdown/Timezone ต่างกัน
- Unknown ต้องเป็น `null`/`—` ไม่ใช่ `0`
- `coverage=complete` ใช้ได้เฉพาะ scope ที่ตรวจแล้ว

## 8. Account Center

Route: `/#accounts`

ความสามารถ:

- Customer creation/deactivation
- Account mapping/display name/enable/disable
- API client token issue/list/revoke
- Device heartbeat
- Coverage/normalized Ads ล่าสุด
- Acceptance issues
- Read-only collection schedule
- Audit log

Schedule:

- ต้องมี enabled account/customer
- Device ต้องสดใหม่
- ต้องมี report-input lease
- ต้องไม่มี pending/running command
- Queue เฉพาะ `report.collect`
- Retry แบบจำกัด

## 9. Optimization Loop

Route: `/#optimization`

Recommendation Gate:

- Ads level
- coverage complete
- ไม่มี blockers
- ผลลัพธ์ประเภทเดียวกัน
- verified ID/mapping
- Spend จาก column
- peers ตาม policy

Action:

- `scale_budget`
- `pause_candidate`
- `duplicate_winner`
- `create_new_test`

Plan:

- status: `draft → approved/rejected → monitoring → verified/failed`
- steps ต้อง `requires_approval=true`
- มี rollback record
- plan approval ไม่เท่ากับ Meta action approval

Experiment:

- hypothesis
- objective
- primary metric
- guardrails
- 2–4 arms
- entity IDs
- metric observations

Creative:

- copy metadata
- media hash/metadata
- linked latest Ads performance
- ไม่เก็บ credential หรือ raw cookie

Templates:

- goal
- config
- create-as-paused
- experiment requirement

## 10. Live evidence

### บัญชีเดิมที่ complete

- Coverage `40/40`
- Verified IDs `40`
- Unresolved `0`
- Report cache warm ประมาณ `13–29 ms`
- Normalized `35/35`; 5 Ads ยังขาด Impressions
- Recommendations `12`
- Hierarchy versions:
  - Campaign 5
  - Ad Set 7
  - Ad 40
- Creative assets 35; 21 รายการเชื่อม Cost/result

### บัญชีใหม่ที่ทดสอบสด

- `report.collect` เริ่มสำเร็จ
- ใช้เวลาจนจบประมาณ 65 วินาที
- 3 snapshots
- 85 raw rows
- ยืนยัน Ads ID 34 รายการ
- Unresolved observations 0
- Scope แยกเป็น:
  - 29/34 Messaging
  - 5/34 Purchase/other context
- หลังยืนยัน timezone/no-filter/no-breakdown:
  - 40 raw rows promoted
  - 15 unique normalized observations
  - remaining rows ขาด Impressions/Result type
- Optimization ถูกต้องที่ปฏิเสธการสร้างคำแนะนำเพราะ coverage partial

นี่เป็นข้อมูลจริง แต่ไม่ควรใช้ปิดยอดหรือเปรียบเทียบทั้งบัญชีจนกว่าจะแก้ Report
Preset ให้มี Result type/Attribution เดียวและ Metrics ครบ

## 11. Validation matrix

ผ่าน:

- `npm run check`: typecheck + 89/89 unit + Extension/API build
- `npm run build:web`
- `npm run test:api`
- `npm run test:captures`
- `npm run test:web`
- `npm run test:report-studio`
- `npm run test:accounts-web`
- `npm run test:optimization-web`
- `npm run test:capture-analysis-web`
- `npm run test:connect`
- `npm run test:report-columns`
- `npm run test:reader` หลังแก้ version assertion ให้อ่านจาก manifest
- `npm run check:live-report` ทั้งบัญชี complete และ partial
- Mobile overflow/page errors: ผ่าน

ยังมีปัญหา:

- `npm run test:report-input` ไม่จบภายใน 3 นาทีเมื่อรันเดี่ยวใน environment นี้
- ไม่มี output ระบุ phase ที่ค้าง จึงยังไม่รู้ว่าเป็น service worker, debugger
  attach, trusted input หรือ cleanup
- ต้องเพิ่ม per-step logging/timeout และ reproduce ก่อนใช้เป็น CI gate

## 12. Performance ที่วัดได้

- Report cache warm: `7–29 ms`
- Optimization rebuild: `210–314 ms`
- Optimization workspace: `318 ms`
- Fresh collect บัญชีใหม่: ประมาณ `65 s` end-to-end
- Scale fixture: 500 Ads + 365 daily points ผ่าน unit test
- ยังไม่มี real-account benchmark 100–300 Ads

## 13. Findings ที่ต้องแก้

### P0: Data completeness ก่อนเพิ่ม AI

บัญชีใหม่มี 34 Ads แต่รายงานแตกหลาย Result/Attribution และ Metrics ไม่ครบ
ควรแก้ Meta Report Preset ก่อน เพิ่ม algorithm หรือモデルใหม่

Acceptance:

- scope เดียวมี Result type เดียว
- Attribution เดียว
- Impressions/Spend/Results/IDs ครบ
- footer total ตรงกับ verified IDs
- materialization reason เหลือเฉพาะข้อมูลที่ Meta ไม่แสดงจริง

### P0: Command receipt semantics — resolved in 0.6.48

`report.collect` ยังคืน command `done` เมื่อเริ่มงานแล้ว แต่ receipt มี contract
แยก collection state ชัดเจน:

```json
{
  "ok": true,
  "job": { "id": "JOB_UUID", "status": "running" },
  "collection": {
    "phase": "collection_started",
    "active": true,
    "job_id": "JOB_UUID",
    "job_status": "running"
  }
}
```

- Shared Zod contract: `packages/core/src/control.ts`
- Backend persists/returns the collection block
- Report Studio uses `collection.active` to continue collection display/polling
- Command `done` still means Extension finished dispatching, never capture complete

Fixture/API validation passed. Live `0.6.48` validation also confirmed:

- command status `done`
- `collection.phase=collection_started`
- `collection.active=true`
- `collection.job_status=running`
- collection job ID present

The first live attempt reached a page with disabled report control. After the
page stabilized, retry produced the collection receipt successfully. The job
then paused at `rows=0` after 5/6 row-load attempts even though headers and
switches were visible; it was explicitly paused to release the queue and lease.
This is a Meta page-readiness limitation, not a receipt contract failure.

### P0: Browser test harness — split and passing

`test:reader` ใช้ version จาก manifest แล้วและผ่าน

`test:report-input` ถูกแยกเป็น process ย่อย:

- `test:report-input-columns`
- `test:report-input-search`
- `test:report-input-guards`
- `test:report-input-lease`
- `test:report-input-paging`
- `test:report-input-authority`

แต่ละ process มี default timeout 30 วินาทีและ progress log แยกชื่อ phase

ผลรัน:

- columns: ผ่าน ประมาณ 67 วินาที
- search: ผ่าน ประมาณ 113 วินาที
- guards: ผ่าน ประมาณ 52 วินาที
- lease: ผ่าน
- paging: ผ่าน ประมาณ 19 วินาที
- authority: ผ่าน

`npm run test:report-input` รวมทุก phase ผ่านตามลำดับ แต่ CI ควรแสดงผลแยกต่อ
phase เพื่อให้รู้ failure ได้ทันที

เพิ่ม fallback ของ Optimization workspace:

- เลือก scope ที่ coverage ดีที่สุดจากทุก operator context ภายใน job แรก
- ถ้า job ล่าสุดมีแต่ analysis ว่าง ให้ถอยไป job ก่อนหน้าที่มี Ads scope usable
- fixture ยืนยันว่า empty job ใหม่ไม่สามารถซ่อน complete scope เดิมได้

### P1: Certified Meta action adapters

เริ่มจาก action ที่เสี่ยงต่ำและตรวจผลได้ง่าย:

1. Pause/Resume Ads
2. Duplicate Ads as paused
3. Budget change with before/after readback
4. Campaign Draft creation
5. Publish เฉพาะหลังมี approval และ live certification

ทุก action ต้องมี:

- preflight
- target ID/account/tab verification
- one-time local approval
- idempotency key
- observe/readback
- action receipt
- rollback
- unknown outcome handling

### P1: Statistical experiment engine

ปัจจุบันเก็บ observation แต่ยังไม่ตัดสินผล

ต้องเพิ่ม:

- sample size/minimum spend
- confidence interval
- Bayesian หรือ sequential test
- guardrail breach
- stop/continue decision
- learning-phase exclusion

### P1: Recommendation quality

ปัจจุบันเป็น deterministic median heuristic

ต้องเพิ่มหรือ calibrate:

- objective-specific models
- budget marginal efficiency
- frequency/creative fatigue
- audience/placement mix
- seasonality
- uncertainty intervals
- per-account policy learning

จนกว่าจะ calibrate ให้เปลี่ยน label Confidence เป็น Evidence score

### P2: Real scale and operations

- real account 100–300 Ads
- multi-account concurrent collection
- multi-device soak test
- scheduler failure alerts
- command dead-letter/cancel
- automated backup schedule/restore drill
- retention policy
- queue latency/error dashboard

## 14. Key files

| File | หน้าที่ |
| --- | --- |
| `apps/api/src/server.ts` | auth, route composition, queue, scheduled timer |
| `apps/api/src/accounts.ts` | customer/account/token/schedule/audit |
| `apps/api/src/captures.ts` | raw persistence, promotion, analysis cache |
| `apps/api/src/optimization.ts` | optimization APIs |
| `apps/api/src/report-cache.ts` | refresh report cache รุ่นเก่าจาก raw snapshots |
| `packages/core/src/optimization.ts` | deterministic recommendation engine |
| `packages/core/src/capture-analysis.ts` | scope aggregation/coverage |
| `packages/core/src/delivery-status.ts` | shared delivery parser และ performance eligibility |
| `packages/core/src/dom-capture.ts` | promotion guards |
| `apps/web/components/optimization-view.tsx` | decision ledger/UI |
| `apps/web/components/report-studio-view.tsx` | report UI |
| `apps/web/components/accounts-view.tsx` | account center |
| `apps/extension/src/background.ts` | queue, report.collect, collection |
| `apps/extension/src/report-input.ts` | trusted report UI |
| `db/010_optimization_loop.sql` | optimization schema |
| `db/011_experiment_observations.sql` | experiment observations |
| `docs/OPTIMIZATION.md` | optimization contract |
| `docs/VALIDATION.md` | validation history |

## 15. Commands

Windows only for npm:

```bat
cmd.exe /d /c "npm run db:migrate"
cmd.exe /d /c "npm run dev:api"
cmd.exe /d /c "npm run dev:web"
```

Validation:

```bat
cmd.exe /d /c "npm run check"
cmd.exe /d /c "npm run build:web"
cmd.exe /d /c "npm run test:captures"
cmd.exe /d /c "npm run test:web"
cmd.exe /d /c "npm run test:accounts-web"
cmd.exe /d /c "npm run test:optimization-web"
cmd.exe /d /c "npm run check:live-report"
```

Backup:

```bat
cmd.exe /d /c "npm run db:backup"
```

Restore is destructive:

```bat
set DB_RESTORE_CONFIRM=restore-local-database
cmd.exe /d /c "npm run db:restore -- backups\FILE.dump"
```

## 16. Git and secret hygiene

- Do not commit `.env`
- Do not commit `backups/`
- Do not commit browser profiles
- Do not commit customer reports
- Do not commit screenshots generated during local tests
- Do not commit `dist/` or `.next/`
- Preserve user-owned `.codex-elevate-port.ps1`
- Do not force push
- Run `git status` and secret scan before every commit
- Use `git diff --check` with `-c core.whitespace=cr-at-eol` for this CRLF repo

## 17. Recommended next order

1. Fix Meta report preset and obtain one complete Ads scope for the switched account
2. Fix `report.collect` receipt semantics
3. Fix `test:report-input` hang with phase logs/timeouts
4. Add statistical experiment evaluation
5. Certify Pause/Resume adapter end-to-end
6. Add Duplicate and Budget adapters
7. Add Campaign Draft Composer
8. Run real-account 100–300 Ads and multi-device tests
9. Enable automation only after approval/readback/rollback pass

Completed after the original next-order list:

- command/collection receipt contract and live verification
- split trusted report-input browser tests by concern
- account-level client grants and read-only multi-account load smoke
- guided simple-mode UI with advanced-tool disclosure
- shared exclusion of billing-error and disabled Ads from every performance
  median/ranking/recommendation path
- Optimization Workspace filters stored recommendations against the current
  job/scope/source-key evaluation so old advice cannot survive an analysis change

## 18. Non-negotiable completion criteria

ห้ามถือว่างานเสร็จเมื่อ:

- command dispatched
- UI clicked
- plan approved
- action dispatched
- HTTP 200
- raw row found

จะถือว่าสำเร็จเมื่อ:

- target entity ถูกต้อง
- action ถูก observe จากหน้าเว็บ
- readback ตรงกับ expected state
- receipt และ audit ถูกบันทึก
- outcome ถูกวัดในหน้าต่างเวลาที่กำหนด
- ไม่มี account/scope/source contamination
