# Detailed handoff — Ads automation and Breakdown

วันที่: 16 พฤศจิกายน 2026
Timezone ที่ผู้ใช้ยืนยันสำหรับรายงาน: `Asia/Bangkok`

## 1. เป้าหมายของผู้ใช้

ผู้ใช้ต้องการให้ Chrome Extension เป็น “ร่างกาย” ที่ควบคุม Ads Manager ผ่าน UI
จริง และให้บอทเป็น “สมอง” ที่สั่งงานได้เอง:

- เปิด Ads Manager และตรวจบัญชี/แท็บ
- ตั้งคอลัมน์รายงาน
- ใช้งานเมนู “ข้อมูลแยกย่อย” (Breakdown)
- อ่าน Ads, IDs, Spend, Impressions, Results และมิติ Breakdown
- บันทึก raw evidence และ normalized observations ลง PostgreSQL
- วิเคราะห์และจัดอันดับ Ads จากข้อมูลที่ยืนยันแล้ว

ระบบต้องไม่ใช้ Meta Graph/Marketing API, network interception, cookie/session
หรือ password. Action สำคัญยังต้องมี local lease/approval ตาม contract เดิม.

## 2. สถานะ source/build/runtime

- Source และ build ล่าสุด: Extension/API `0.6.22`
- Chrome ที่เชื่อมล่าสุด ณ เวลาเขียน handoff: Extension `0.6.21`
- Device ล่าสุดยัง online และ `report_input=true`
- URL ล่าสุดมี Breakdown อายุ active:
  `demographics_breakdown=age`
- Build `0.6.22` ยังต้อง reload ใน Chrome ก่อน live test
- Backend ปกติ: `http://127.0.0.1:4318`
- Frontend ปกติ: `http://127.0.0.1:9321`
- PostgreSQL: `127.0.0.1:5432`

ใช้ placeholder `DEVICE_ID` และ `ACCOUNT_ID` ในเอกสาร/commit. ห้ามใส่ค่า
Device ID, account ID, token, customer data หรือ raw report จริงลง Git.

## 3. สถาปัตยกรรมที่เพิ่ม

```text
ads-agent (Node CLI / planner)
  → authenticated Backend command queue
  → Extension background state machine
  → trusted UI action under local report-input lease
  → Ads Manager DOM
  → capture_snapshots/capture_rows
  → capture analysis / scoped analysis
```

บอทไม่ได้เรียก Meta เอง. Backend รับเฉพาะ typed command จาก shared Zod schema.
Extension ตรวจ host, route, account, active tab, job และ lease ทุกครั้ง.

### ไฟล์หลัก

- `scripts/ads-agent.ts`: orchestrator read-only
- `apps/extension/src/breakdown-input.ts`: Breakdown menu UI automation
- `apps/extension/src/report-input.ts`: columns, trusted input, vertical/horizontal
  native scroll
- `apps/extension/src/report-probe.ts`: read-only report option planning
- `apps/extension/src/report-columns.ts`: field catalogue/search aliases
- `apps/extension/src/reader.ts`: grid/subrow capture and scroll
- `packages/core/src/control.ts`: command schemas and reporting URL allowlist
- `packages/core/src/capture-analysis.ts`: scoped analysis and cross-slice merge
- `packages/core/src/dom-capture.ts`: raw DOM contracts and promotion rules
- `apps/api/src/captures.ts`: capture endpoints and selected operator context
- `docs/ADS_AUTOMATION.md`: user-facing workflow

## 4. คำสั่งใช้งาน

### อ่าน Ads ปกติ

```bat
npm run ads:agent -- DEVICE_ID messages
```

### อ่าน Ads พร้อม Breakdown อายุ

```bat
npm run ads:agent -- DEVICE_ID messages ^
  --breakdown=age ^
  --timezone=Asia/Bangkok ^
  --no-filters ^
  --max-steps=20 ^
  --timeout-seconds=900
```

### ตั้ง Breakdown โดยตรง

```bat
npm run bot -- DEVICE_ID breakdown age
npm run bot -- DEVICE_ID breakdown gender
```

รองรับ allowlist:

- `age`
- `gender`
- `platform`
- `placement`

### Age/Gender เป็น mutually exclusive

Meta ใช้ `demographics_breakdown` เดียวสำหรับ Age และ Gender. การเลือกอีกค่าจะ
แทนค่าเดิม. Shared contract จึงปฏิเสธ `age+gender` พร้อมกัน. ต้องรันแยกงาน:

```bat
npm run ads:agent -- DEVICE_ID messages --breakdown=age
npm run ads:agent -- DEVICE_ID messages --breakdown=gender
```

## 5. Report columns และ Breakdown

### Blocking capture fields

ก่อน Save มุมมองรายงาน ระบบต้องยืนยัน:

- Campaign/Ad Set/Ad IDs
- Spend
- Impressions
- Results
- Cost per result
- Attribution
- ชื่อ Ads

ระบบแยก goal metrics เสริม เช่น link clicks หรือ messaging conversations
เป็น `missing_goal_metrics`; ไม่เดาและไม่ block view ถ้า Meta ไม่มีคอลัมน์เดี่ยว.

### Breakdown behavior

- Breakdown ไม่เท่ากับ Filter
- Breakdown แยก Ads ตาม อายุ/เพศ/แพลตฟอร์ม/ตำแหน่ง
- วิเคราะห์และรวมยอดแยกตาม combination เท่านั้น
- ห้ามรวม Spend/Results ข้าม Breakdown scope
- Breakdown query ที่ผ่าน allowlist ต้องถูก preserve ระหว่าง navigation และ
  vertical cycle
- `time_breakdown` และ Breakdown ที่ยังไม่รองรับจะหยุดก่อน input

### DOM จริงของ Meta ภาษาไทย

จาก live inspection:

- trigger label อาจเป็น `ข้อมูลแยกย่อย` หรือ
  `ข้อมูลแยกย่อย: เลือกแล้ว 1 รายการ`
- option ใช้ `role=listitem`
- checkbox เป็น element แยกจาก listitem
- placement label คือ `ตำแหน่งโฆษณา`
- ช่อง search ภายในเมนูใช้ label `search columns`
- Gender อาจถูกซ่อนจนกว่าจะค้นหา
- ต้องจับ checkbox ภายใน bounds แนวนอนเดียวกับ option; matching ด้วย Y
  อย่างเดียวเคยคลิก checkbox ของ Ads row

## 6. Live evidence และ debug ledger

### Report setup

- `0.6.9`: report.prepare สำเร็จ applied=true
- Spend, Results, Cost per result, IDs, Impressions, Attribution ถูกเลือก
- Link clicks และ Messaging conversations ถูก report เป็น missing goal metrics
- หลายรอบก่อนหน้านี้ applied=false และไม่ Save; ถือเป็น failed evidence

### Horizontal/vertical collection

- `0.6.10`: horizontal wheel เริ่มอ่านคอลัมน์ใหม่ได้
- `0.6.12`: coverage เพิ่มจาก 8 เป็น 18 Ads พร้อม ID+Spend
- bug เดิม: horizontal slice สุดท้ายไม่เปลี่ยนภาพแล้ว vertical cycle ถูกข้าม
- `0.6.12` แก้ให้ vertical cycle เดินต่อจนถึง maxSteps
- `0.6.13` ใช้ zoom 0.5 ชั่วคราวระหว่างอ่าน
- Job `7eb5a251-033b-4239-a7d5-36cac83412dc` ได้ 40/40 IDs + Spend
- Cross-slice attribution merge ใช้ stable ID เดียวกันเท่านั้น
- Analysis ด้วย timezone/no-filters ที่ผู้ใช้ยืนยันทำ ranking ได้ใน mechanism
  test แต่ยังไม่ถือเป็น age-breakdown acceptance

### Breakdown UI

- `0.6.14`: เพิ่ม `breakdown.prepare`; Backend ต้อง restart เพื่อโหลด schema
- `0.6.15`: matcher เห็น listitem/checkbox/search แต่คลิก checkbox Ads ผิด
- `0.6.16`: จำกัด checkbox ให้อยู่ในกรอบแนวนอนเดียวกับ listitem
- `0.6.16` ล้มด้วย `breakdown_menu_not_found`; พบ trigger มี suffix จำนวนที่เลือก
- `0.6.17`: รับ selected-count suffix ได้
- `0.6.17` ยืนยัน Age/Gender ใช้ `demographics_breakdown` ค่าเดียว
- `0.6.18`: ใช้ URL เป็น verification และ reject age+gender
- `0.6.19`: preserve `*_breakdown` ไปทุก navigation/vertical cycle
- Job `27244eba-436b-47ec-a9e7-62a160274b21` บน `0.6.21`:
  - Breakdown Age selection สำเร็จ
  - 36 snapshots persisted
  - พบ scope `18–24`, `25–34`, `35–44`, `45–54`, `55–64`, `65+`
  - IDs/Spend/metrics ถูก map ลงแต่ละ scope
  - row-level breakdown ถูกยอมรับหลังแก้ analyzer
  - results ส่วนใหญ่ขาด result type เพราะ subrow Results มีเฉพาะตัวเลข

### Current blocker

`0.6.21` อ่าน Age subrows ได้ แต่ยังไม่มี result type/status ใน subrow ทำให้
result groups/ranking ว่าง. `0.6.22` เพิ่ม:

- copy status/result type จาก stable-ID parent row
- derive result type จาก Results cell เมื่อเฉพาะ numeric subrow
- รอ busy marker ก่อนเปิด Breakdown menu
- row-level breakdown ใช้ได้แม้ base breakdown context เป็น null

`0.6.22` ผ่าน fixture และ build แต่ยังไม่ทดสอบ live.

## 7. Tests ล่าสุด

ผ่านบน source/build `0.6.22`:

```bat
npm run check
npm run test:reader
npm run test:breakdown
```

ผล:

- TypeScript strict ผ่าน
- Unit tests 67/67 ผ่าน
- Extension/API build ผ่าน
- Reader fixtures ผ่าน รวม age subrow → stable parent ID → metric mapping
- Breakdown fixture ผ่าน trusted search/select/clear/detach
- Browser integration ผ่านบน `0.6.22`
- report-probe และ report-columns fixtures ผ่านบน `0.6.22`

## 8. สิ่งที่ต้องทำต่อทันที

### A. Reload `0.6.22`

1. Reload Extension จาก `C:\BF\dist\extension`
2. กลับ Ads Manager, account เดิม
3. เปิด report-input lease
4. ให้ Breakdown Age active
5. รัน:

```bat
npm run ads:agent -- DEVICE_ID messages ^
  --breakdown=age ^
  --timezone=Asia/Bangkok ^
  --no-filters ^
  --max-steps=20 ^
  --timeout-seconds=900
```

### B. Acceptance criteria ของ live run

- Extension state เป็น `0.6.22`
- URL ระหว่าง collection คง `demographics_breakdown=age`
- snapshots มี cell header `อายุ`
- Row หนึ่งมี Ad ID + Age + Spend + Impressions + Results/Result type
- ไม่มี `breakdown_unverified`
- ไม่มี duplicate ID ภายใน scope เดียวกัน
- มี age scopes ตามที่ Meta แสดง
- ห้ามรวม Spend/Results ข้ามอายุ
- Result groups/ranking ต้องเกิดจาก row ที่มี result type และ mapping verified
- Coverage ต่อ age scope ต้องไม่ถูกเรียก complete เพียงเพราะผลรวมทุก scopeครบ 40

### C. ถ้า result type ยังว่าง

ตรวจตามลำดับ:

1. Parent row observation มี metadata ใน Results/Status หรือไม่
2. Age subrow cells มี `result_type` หลัง `0.6.22` หรือไม่
3. Results cell ใน subrow เป็น `—` หรือมีตัวเลขจริง
4. API analysis ใช้ `timezone=Asia/Bangkok` และ `confirm_no_filters=true`
5. ผลของแต่ละ age scope มีผลลัพธ์อย่างน้อย 5 ต่อ Ads ก่อนคาดหวัง ranking

### D. Breakdown อื่น

- อ่าน DOM จริงของ Platform/Placement ก่อนเพิ่ม parser
- ต้องไม่ใช้ text ทั่วไปในหน้าเป็น dimension โดยไม่มี row structure
- เพิ่ม fixture สำหรับ subrow, hidden option, clip และ duplicate label
- ถ้า Meta ใช้ parameter/key shape ต่าง ให้เพิ่ม allowlist ชัดเจน ไม่รับ arbitrary query

### E. Normalized promotion

Raw analysis อาจทำงานได้ก่อน normalized promotion. ต้องตรวจเพิ่มว่า
`evaluateSnapshot`/`reviewStored` รองรับ breakdown subrow grain ครบ:

- entity ID + breakdown combination เป็น grain
- Parent ID และ breakdown provenance ถูกเก็บ
- Scope evidence ครบก่อน promote
- ห้ามใช้ subrow parent relationship เป็นการ join ด้วยชื่อ

## 9. Safety invariants

- Meta access ผ่าน Extension UI เท่านั้น
- ไม่มี Graph/Marketing API
- ไม่ดัก network หรืออ่าน cookie/session/password
- Backendไม่รับ arbitrary JS/selector/coordinate/CDP command
- Report/Breakdown input ต้องมี local report-input lease
- Important UI action ต้องมี one-time local approval
- Start/resume foregrounds tab; switching away pauses collection
- Interrupted dispatch ไม่ถูก replay อัตโนมัติ
- Unknown ไม่กลายเป็น 0
- Name/row position ใช้เป็น stable identity ไม่ได้
- `needs_review` ไม่เท่ากับ complete
- Child estimates ต้องติดป้าย estimated และไม่ใช้เป็น actual spend

## 10. ข้อควรระวังด้านเทคนิค

- Meta rerender ระหว่าง click; coordinate ต้องคำนวณใหม่ก่อน input ทุกครั้ง
- `รายการนี้จะไม่แสดง` / tooltip overlays อาจทำให้งงกับ breakdown rows
- `กำลังโหลด…` ต้องรอ; การเปิด Breakdown ก่อนพร้อมจะ fail safe
- การ restore zoom ต้องทำงานเมื่อ complete/pause/error
- `selected_ad_ids` เป็น row selection ไม่ใช่ Breakdown parameter
- Age/Gender ใช้ parameter เดียวกัน; ห้ามถือว่า additive
- `reported_total_rows=40` เป็นจำนวน Ads ของ scope รายงาน ไม่ใช่จำนวน
  age combinations
- Horizontal slices ที่ไม่มี dimension ห้าม merge เข้า age scope ด้วยตำแหน่ง

## 11. Git handoff

- Branch: `master`
- Remote: `origin` = `https://github.com/ntpten-x/bot-ads.git`
- ห้าม force push หรือย้อน commit ของผู้ใช้อื่น
- ไฟล์ `.codex-elevate-port.ps1` เป็น untracked ของผู้ใช้ ให้เก็บไว้และไม่ commit
- ตรวจ `git status`, `git diff --check`, secret scan และ tests ก่อน commit
- Generated artifacts, `.env`, reports/screenshots/browser profiles ห้าม commit

หลัง reload/ทดสอบ live ให้บันทึกผลใหม่ใน `docs/VALIDATION.md` และปรับ version
เฉพาะเมื่อ source/build/runtime ตรงกัน. หาก handoff นี้เก่ากว่า source ให้ยึด
source, schema และผลทดสอบล่าสุดเป็นหลัก.
