# Handoff: Ads Collection Reliability 0.6.73

วันที่: 19 พฤศจิกายน 2026

Branch: `master`

Extension source/build: `0.6.73`

Commit ล่าสุดของงานนี้:

```text
7cd57d5 fix: continue ads collection across virtualized repaints
```

เอกสารนี้เป็นจุดเริ่มต้นสำหรับ AI หรือนักพัฒนาคนถัดไปที่ต้องทำงานต่อจากระบบ
Meta Ads Data Collector รุ่น `0.6.73` โดยสรุปสถานะจริง สถาปัตยกรรม หลักฐาน
ข้อจำกัด และลำดับงานที่ควรทำต่อ

## 1. สรุปสั้น

ระบบปัจจุบันทำงานแบบ database-first:

```text
Chrome Extension
  → Meta Ads Manager ผ่านหน้าที่ผู้ใช้มองเห็น
  → typed command queue
  → raw DOM capture
  → normalization / coverage guards
  → PostgreSQL
  → Report Studio
  → deterministic Optimization Loop
```

ผู้ใช้กด “ดึงข้อมูล Ads ใหม่” ครั้งเดียว ระบบจะ:

1. ตรวจ device, account, tab และ permission
2. navigate ไป Ads report route เมื่อจำเป็น
3. ตรวจหรือตั้งคอลัมน์รายงานผ่าน trusted UI
4. เริ่ม read-only collection
5. อ่านตารางแบบ snapshot/paging
6. ส่ง raw capture เข้า PostgreSQL
7. วิเคราะห์เฉพาะหลักฐานที่ผ่าน guard
8. แสดงผลใน Report Studio

ระบบยังไม่แก้ Ads, งบ, สถานะ หรือเผยแพร่โฆษณาอัตโนมัติ
`automated_meta_mutation=false`

## 2. สถานะที่พร้อมใช้งาน

### Extension

- Chrome MV3 Extension `0.6.73`
- Device identity และ device-scoped credential
- Startup reconnect และ heartbeat
- typed command queue
- `report.prepare`
- `report.collect`
- trusted report-input lease
- virtualized table paging
- horizontal column scanning
- next-page transition เมื่อตรวจขอบเขตได้
- bounded tab-edit retry
- transient fingerprint re-probe

### Backend

- Express API ที่ `http://127.0.0.1:4318`
- PostgreSQL ที่ `127.0.0.1:5432`
- raw capture persistence
- normalization และ coverage evaluation
- report cache
- account/customer isolation
- account health
- read-only collection schedule
- optimization recommendations/plans/experiments
- audit log

### Web

- Next.js ที่ `http://127.0.0.1:9321`
- guided one-primary-action workspace
- Report Studio ที่ `/#reports`
- Account Center ที่ `/#accounts`
- Optimization Workspace ที่ `/#optimization`
- advanced tools สำหรับ import, raw capture, export และ command history

## 3. Report Studio

Report Studio แสดงหลักฐานเพื่อให้ผู้ใช้วิเคราะห์ด้วยตาเอง:

- KPI ribbon
- bar chart
- scatter plot
- histogram
- donut composition
- concentration curve
- daily trend
- scope comparison
- search/filter/sort
- Ads table
- target CPA/ROAS reference line
- normalized coverage
- materialization blockers
- CSV-vs-DOM reconciliation

หลักการสำคัญ:

- ไม่รวมยอดข้าม Account
- ไม่รวม CSV และ DOM capture เป็นยอดเดียว
- ไม่รวมต่าง Currency, Timezone, Attribution, Result type หรือ Breakdown
- Unknown เป็น `null`/`—` ไม่ใช่ `0`
- Reach/Frequency ไม่ถูกนำไปบวกข้ามแถว
- `coverage=complete` ใช้ได้เฉพาะ scope ที่ผ่านหลักฐานเท่านั้น
- Ads ที่ disabled, paused หรือมี payment error ยังแสดงเป็น diagnostic
  แต่ไม่ใช้เป็น performance peer หรือตัวสร้างคำแนะนำ

## 4. Database และข้อมูลหลัก

ฐานข้อมูลเป็นแหล่งข้อมูลหลักของระบบ:

- normalized observations
- report cache
- raw captures
- materialization history
- entity/status history
- optimization plans
- experiments
- audit records

CSV ยังใช้เป็นช่องทางเสริมหรือ reconciliation ไม่ใช่แหล่งหลักของ workflow
ปัจจุบัน

ข้อมูลถูกแยกชั้นดังนี้:

```text
raw DOM evidence
  ≠ normalized observation
  ≠ report aggregate
  ≠ recommendation
```

การอ่าน DOM สำเร็จไม่เท่ากับข้อมูลถูก normalize สำเร็จ และ `needs_review`
ไม่ใช่ `complete`

Migration ล่าสุดที่ระบบใช้งานคือ `015_device_credentials` งาน `0.6.73`
ไม่เพิ่ม migration ใหม่

รายละเอียด migration และ data lifecycle:

- [HANDOFF_OPTIMIZATION_2026-11-18.md](HANDOFF_OPTIMIZATION_2026-11-18.md)
- [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)

## 5. ปัญหาที่แก้ใน 0.6.73

### อาการจริง

งาน read-only บน Extension `0.6.72` ถูกส่งสำเร็จและเริ่มอ่านตาราง แต่จบด้วย
`needs_review` ก่อนครบ:

- Meta รายงาน `794 Ads`
- เก็บได้ `5 snapshots`
- raw rows `115`
- verified/distinct Ad IDs `115`
- unresolved duplicates ในชุดนี้ `0`
- reason สุดท้าย `row_fingerprint_unavailable`

ข้อมูลจริงชุดนี้ต้องถือเป็น partial coverage เท่านั้น

### สาเหตุ

หลัง trusted wheel Meta ได้ repaint virtualized grid และทำให้ row text/links
หายชั่วคราว ระบบ probe แล้วพบว่าไม่มี fingerprint จึงตีความว่า scroll
ล้มเหลวและจบ collection ก่อนเวลา

นอกจากนี้เพดานเดิม `20` steps ไม่พอสำหรับ scope หลายร้อย Ads เพราะอัตรา
ที่วัดได้คือ 5 steps ต่อ 115 IDs

พบ error แยกอีกกรณี:

```text
Tabs cannot be edited right now (user may be dragging a tab).
```

error นี้เป็น transient ของ Chrome ไม่ใช่หลักฐานว่า Meta หรือ account ใช้งาน
ไม่ได้

### การแก้

`0.6.73` ทำการเปลี่ยนแปลงดังนี้:

- re-probe `row_fingerprint_unavailable` สูงสุด 1.2 วินาที
- retry เฉพาะ Chrome tab-drag transient สูงสุด 4 ครั้ง
- เพิ่ม `report.collect` จาก 20 เป็น 60 steps
- scheduled collection ใช้ 60 steps
- shared contract รองรับ 1–60 และ default 40
- ยัง fail closed สำหรับ account, route, lease, modal และ context mismatch

ไฟล์หลัก:

- [report-input.ts](../apps/extension/src/report-input.ts)
- [tab-retry.ts](../apps/extension/src/tab-retry.ts)
- [background.ts](../apps/extension/src/background.ts)
- [control.ts](../packages/core/src/control.ts)

## 6. หลักฐานทดสอบล่าสุด

ผ่านหลังการแก้ `0.6.73`:

- `npm run check`
- typecheck
- unit tests `95/95`
- Extension/API build
- `npm run typecheck:web`
- `npm run build:web`
- `npm run test:connect`
- `npm run test:captures`
- `npm run test:report-input-paging`
- `npm run test:report-scroll`
- `npm run test:report-studio`
- `git diff --check`

Regression ที่เพิ่ม:

- Meta fingerprint หาย 350 ms หลัง wheel แล้วกลับมา
- ระบบต้อง probe ซ้ำและยืนยันการเคลื่อนที่ด้วย stable IDs ใหม่
- ต้องใช้ trusted wheel เพียงครั้งเดียว
- tab-drag transient retry ต้องไม่ retry error ชนิดอื่น

หลักฐานแบบละเอียดอยู่ใน [VALIDATION.md](VALIDATION.md)

## 7. สิ่งที่ยังพิสูจน์ไม่ได้

ห้ามกล่าวว่า scope ล่าสุด “อ่านครบ 794 Ads” จนกว่าจะมีหลักฐานจากรุ่นที่
Reload แล้ว

ยังค้าง:

- ต้อง Reload `dist/extension` เป็น `0.6.73`
- ต้องเปิดรายงาน lease
- ต้องรัน `report.collect` ใหม่กับ Meta จริง
- ต้องเปรียบเทียบ distinct verified IDs กับ Meta-reported total
- ต้องตรวจว่า next-page transition ทำงานจนจบ scope
- ต้องตรวจว่าไม่มี blocking reason ที่แก้ได้จาก preset
- ยังไม่มี real-account benchmark สำหรับ 794 Ads บนรุ่น `0.6.73`

ถ้าผลใหม่ออกมา เช่น `500/794` หรือ `780/794` ให้ถือว่า partial จนกว่าจะ
อธิบายจำนวนที่ขาดและ reason ได้

## 8. Acceptance criteria สำหรับรอบถัดไป

### P0: Live completion ของ 0.6.73

1. Reload Extension จาก `dist/extension`
2. ยืนยัน manifest version เป็น `0.6.73`
3. เปิด Meta Ads Manager ในบัญชีที่ต้องการ
4. เปิดรายงาน lease ใน popup
5. กด “ดึงข้อมูล Ads ใหม่”
6. รอ command `done` และ collection จนสถานะไม่ใช่ `running`
7. ตรวจจำนวน distinct verified IDs
8. ตรวจ `reported_total_rows`
9. ตรวจ `scroll_log`, `page_index`, warnings และ blockers

ผ่านเมื่อ:

- verified IDs ตรงกับ reported total สำหรับ scope เดียวกัน หรือ
- จำนวนที่ขาดมีหลักฐานชัดว่า Meta ไม่มี/ไม่แสดง และไม่ถูกเติมเป็นศูนย์

ต้องบันทึก:

- Extension version
- elapsed time
- snapshots
- raw rows
- distinct IDs
- duplicates
- unresolved
- page transitions
- coverage
- materialization reasons
- ก่อน/หลังจำนวน normalized Ads

ห้ามบันทึก Account ID, Device ID หรือข้อมูลลูกค้าลงเอกสารสาธารณะ

### P0: ทำ collection ให้ตรวจ progress ได้

เพิ่ม diagnostic/UI ที่บอก:

- unique verified IDs ปัจจุบัน
- Meta-reported total
- current page
- last successful scroll/page method
- stalled step count
- last reason ที่ยังไม่จบ
- estimated remaining pages

ประโยชน์คือผู้ใช้รู้ว่า “ยังทำงาน” หรือ “หยุดกลางทาง” โดยไม่ต้องเปิด raw JSON

### P0: Stall recovery แบบมีหลักฐาน

ถ้า collection หยุดอีก:

- retry เฉพาะ transient reason
- ใช้ next-page เฉพาะเมื่อมีหลักฐานว่าเป็นหน้าถัดไปจริง
- ตรวจ page signature และ new row IDs
- ห้ามข้าม guard เพื่อให้ได้จำนวนมากขึ้น
- ถ้าไม่ยืนยัน ให้หยุดและรายงาน partial

### P1: แยก blocking metrics จาก preset

ตรวจ Report Preset ให้มี:

- Ad ID
- Campaign ID
- Ad Set ID
- Spend
- Impressions
- Results
- Cost per result
- Result type
- Attribution
- Date range

ถ้า Meta ไม่มีคอลัมน์หรือไม่สามารถยืนยันค่า ให้รายงาน reason ไม่เดาค่า

### P1: ทดสอบ scale จริง

ทดสอบอย่างน้อย:

- 100 Ads
- 300 Ads
- 794 Ads หรือใกล้เคียง
- หลายหน้าของ pagination
- browser minimized/focus เปลี่ยน
- service worker restart กลางงาน

วัด:

- เวลารวม
- snapshot size
- checkpoint size
- API ingest latency
- memory
- failure rate
- duplicate IDs
- resume behavior

### P1: Multi-account และ multi-device

- account ใหม่ต้องไม่แสดงข้อมูลของ account เดิม
- Device ต้องผูก account/tab ถูกต้อง
- command ต้องไม่ข้าม account
- schedule ต้องไม่ queue ซ้อน
- disabled account/customer ต้อง block ทุกช่องทาง
- ต้องมี soak test อย่างน้อยสอง device และสอง account

### P1: Operations

- command dead-letter/cancel
- stale job recovery
- alert เมื่อ schedule ล้มติดกัน
- backup/restore drill
- retention apply test บนสำเนา ไม่ลบฐานจริง
- dashboard สำหรับ queue latency และ collection failure rate

### P2: Meta mutation

ยังไม่ควรเปิด autonomous mutation จนมี:

- certified page adapter
- before/after readback
- one-time local approval
- idempotency
- rollback
- unknown-outcome handling
- live certification แยกตาม action

## 9. สถาปัตยกรรมและ safety invariants

ห้ามเพิ่ม:

- Meta Graph API
- Meta Marketing API
- internal Meta endpoint
- network interception
- cookie/session/password extraction
- arbitrary JavaScript/selector จาก Backend
- backend approval แทน popup

ทุก action ต้องไหลตามลำดับ:

```text
shared Zod contract
  → Backend queue
  → Extension device/account/tab/permission check
  → inspect
  → trusted action
  → observe
  → receipt
```

Report input ต้องมี local lease และ mutation ต้องมี popup approval แยก

## 10. วิธีรัน

ใช้ dependencies ฝั่ง Windows จาก WSL ผ่าน CMD:

```bat
docker compose up -d
cmd.exe /d /c "npm run db:migrate"
cmd.exe /d /c "npm run build"
cmd.exe /d /c "npm run dev:api"
```

อีกหน้าต่าง:

```bat
cmd.exe /d /c "npm run dev:web"
```

เปิด:

- Web: `http://127.0.0.1:9321`
- API: `http://127.0.0.1:4318`
- PostgreSQL: `127.0.0.1:5432`

หลังแก้ Extension:

```bat
cmd.exe /d /c "npm run build"
```

แล้ว Reload `dist/extension` ใน `chrome://extensions`

ห้ามแก้ `dist` เป็นงานถาวร ให้แก้ source แล้ว build ใหม่

## 11. ชุดทดสอบที่ควรใช้

| งานที่เปลี่ยน | คำสั่ง |
| --- | --- |
| TypeScript ทั้งระบบ | `npm run typecheck` |
| Web TypeScript | `npm run typecheck:web` |
| Unit tests | `npm test` |
| Extension/API build | `npm run build` |
| Web production build | `npm run build:web` |
| Connection/device | `npm run test:connect` |
| Raw capture/API/schedule | `npm run test:captures` |
| Report scrolling | `npm run test:report-scroll` |
| Trusted vertical/native paging | `npm run test:report-input-paging` |
| Report Studio | `npm run test:report-studio` |
| Full report-input | `npm run test:report-input` |

Integration บางชุดใช้ PostgreSQL จริงและต้องอ่าน test cleanup ก่อนรัน
ห้ามล้างฐานข้อมูลจริงเพื่อทำให้ test ผ่าน

## 12. Git และข้อกำหนดส่งงาน

- ตรวจ `git status` ก่อนแก้
- เก็บงานเดิมของผู้ใช้
- อย่า commit `.env`, token, account/device จริง, reports, screenshots,
  browser profile, `dist`, `.next` หรือ generated artifacts
- ไฟล์ `.codex-elevate-port.ps1` ใน workspace นี้เป็น local untracked file
  ห้าม stage
- เพิ่ม migration ใหม่เมื่อ schema เปลี่ยน
- อย่าแก้ migration ที่ apply แล้ว
- อย่า force push หรือย้อน commit ของผู้อื่น

Repo:

```text
https://github.com/ntpten-x/bot-ads.git
```

## 13. Key files

| File | หน้าที่ |
| --- | --- |
| `apps/extension/src/background.ts` | command queue, job lifecycle, paging orchestration |
| `apps/extension/src/report-input.ts` | trusted report input, wheel, scrollbar, next page |
| `apps/extension/src/reader.ts` | visible table, rows, fingerprints, page probe |
| `apps/extension/src/tab-retry.ts` | bounded Chrome tab-edit retry |
| `packages/core/src/control.ts` | shared command contract |
| `packages/core/src/capture-analysis.ts` | coverage, scope, analysis |
| `packages/core/src/dom-capture.ts` | promotion guards |
| `packages/core/src/optimization.ts` | deterministic recommendations |
| `apps/api/src/captures.ts` | raw persistence/materialization/cache |
| `apps/api/src/accounts.ts` | account/customer/schedule/audit |
| `apps/web/components/report-studio-view.tsx` | Report Studio |
| `apps/web/components/optimization-view.tsx` | Optimization Workspace |
| `docs/AI_HANDOFF.md` | master handoff index |
| `docs/VALIDATION.md` | validation ledger |
| `docs/ANALYSIS.md` | metric/analysis rules |
| `docs/OPTIMIZATION.md` | optimization contract |

## 14. ลำดับงานที่แนะนำทันที

1. Reload Extension `0.6.73`
2. รัน live `report.collect` หนึ่งรอบ
3. บันทึก unique IDs เทียบ reported total
4. ตรวจว่าจบเพราะถึงขอบเขตจริงหรือยังมี reason ค้าง
5. ถ้ายัง partial ให้เริ่มจาก `scroll_log` และ page signature
6. เพิ่ม progress contract/UI ก่อนขยาย AI หรือ mutation
7. ทำ real scale test และ multi-account soak
8. ค่อยพิจารณา certified mutation adapters

งานนี้ยังไม่ควรถูกเรียกว่า “อ่านครบทุก Ads” จนข้อ 1–4 ผ่านด้วยหลักฐานจาก
Extension รุ่นที่ Reload แล้ว
