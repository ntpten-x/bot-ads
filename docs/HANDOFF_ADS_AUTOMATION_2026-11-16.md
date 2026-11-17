# Detailed handoff — Ads automation and Breakdown

วันที่: 17 พฤศจิกายน 2026
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

- Source ล่าสุด: Extension/API `0.6.41`; build `dist/extension` สร้างใหม่แล้ว
- Runtime ที่ live-test ล่าสุด: Extension `0.6.41`; native reset และ physical-bottom detection ผ่าน live แต่ Breakdown coverage เป็น verified lower bound ไม่ใช่ `x/40` completeness
- `0.6.35` ทำ Breakdown setup เป็น idempotent เมื่อมิติที่ขอ active อยู่แล้ว, ปิดเมนูที่ค้างด้วย Escape และไม่ค้นหามิติที่ไม่ requested; คง scrollbar/gutter planning และ identity-only paging จาก 0.6.34
- live `0.6.35` ยืนยัน Breakdown fix (`ok=true`, menu ปิด) แต่ collection ด้วย `--no-scan-columns` ได้หนึ่ง snapshot ที่ `step=1` แล้วค้างเกินห้านาทีโดยไม่มี `scroll_log`; start acknowledgement ก็ timeout ทั้งที่ job เริ่มแล้ว
- `0.6.36` จำกัด `chrome.debugger.attach`/`sendCommand`/`detach` ด้วย timeout 6 วินาทีและคืน reason `debugger_*_timeout`; agent เพิ่มเวลารอ start acknowledgement เป็น 90 วินาที
- live `0.6.36` จบโดยไม่ค้าง แต่ทุก paging attempt คืน `visible_rows_unchanged`; parent Ad IDs ยังเป็นห้าตัวแรกในหลาย Age scope เทียบ footer 40 แถว
- หลักฐาน DOM พบ custom vertical scrollbar ด้านขวาเป็น `div` แคบ/สูง ไม่มี `role="scrollbar"` และไม่ใช่ ancestor ของ rows; `body_offsets` จึงว่าง
- `0.6.37` ตรวจ custom track/thumb จาก geometry, ส่ง trusted mouse drag ภายใต้ lease/account/job guards ทุกคำสั่ง และนับ movement เฉพาะเมื่อ row fingerprints มี identity ใหม่ (`native_scrollbar_drag`)
- live `0.6.37` รอบแรก coverage 26–35 แถว/scope แต่ timeout 12 วินาทีที่ step 8; รอบสอง probe ไม่เห็น scrollbar ที่ซ่อนจนกว่าจะ hover
- `0.6.38` re-probe หลัง trusted hover ทุก target, drag custom thumb ที่เพิ่งปรากฏก่อน wheel และเพิ่ม overall deadline เป็น 30 วินาที (per-command ยัง 6 วินาที)
- `0.6.39` ค้นหา custom scrollbar ใน reporting ancestor แทนการจำกัดเฉพาะ scope ของ header/rows, เพิ่ม hover point ที่ขอบขวาโดยไม่ส่ง wheel ซ้ำ และแยก `payment_error` เป็น diagnostic เท่านั้น ไม่ใช้จัดอันดับหรือบล็อกการประเมินผล
- live `0.6.39` พบ custom scrollbar จริง (`attempted_scrollbar=true`, track 1102px, thumb 131px) แต่ thumb อยู่ท้ายรางและ drag ลงต่อไม่ได้; `0.6.40` เพิ่ม native reset ที่ลาก thumb ขึ้นบนสุดก่อน snapshot แรกและยืนยันแถวเปลี่ยน
- live `0.6.40` job `b344acdc-1d78-467c-a27f-b0056021c642` ได้ 8 snapshots, 196 observations, 35 unique parent Ad IDs และจบ `needs_review`; coverage ต่อ Age scope เทียบ 40 แถวคือ 34/35/32/26/26/27 ตามลำดับ ทุก scope ยัง partial
- step 8 คืน `visible_rows_unchanged` ทั้งที่ custom thumb ห่างท้ายรางเพียง ~5px; native reset ยัง fail ด้วย `reporting_view_changed_before_input` ขณะที่ DOM reset เป็น `already_at_start`
- `0.6.41` ใช้ edge tolerance 8px, นับ custom scrollbar ที่ถึงท้ายเป็น `at_bottom`, และ rebase หลัง attach เฉพาะ view ที่นิ่งติดกันสอง probe; view ที่เปลี่ยนต่อเนื่องยัง fail closed
- live `0.6.41` job `047d3c3e-64c5-447c-bdc1-ed25727550a2` reset สำเร็จ (`native_scrollbar_drag`, `at_top=true`) และ step 8 คืน `reporting_bottom_reached` (`at_bottom=true`, `attempted_scrollbar=true`); ได้ 8 snapshots, 198 raw Age observations, 35 unique parent Ad IDs และ `level_warnings=[]`
- live `0.6.41` analysis สร้าง messaging result group และอันดับทุก Age scope (eligible 8/9/4/2/2/2) โดยไม่มี column/identity/timezone/filter blocker; verified rows 34/35/32/26/26/27 และ footer 40 เป็นยอดรวมรายงาน ไม่ใช่ตัวหารเฉพาะ Age จึงรายงาน `coverage=lower_bound` หลังแก้ semantics
- analysis panel ฝั่งเว็บเพิ่มช่องยืนยัน timezone/attribution/no-filter/no-Breakdown และส่งเฉพาะค่าที่ผู้ใช้ยืนยัน; live browser check ยืนยันว่า `Asia/Bangkok` + no filters เปิด result group/อันดับได้ โดยไม่ต้องใช้ `ads:agent`
- ต้องตรวจ heartbeat/`report_input` และเปิด report-input lease ใหม่ก่อน live test
- URL ล่าสุดมี Breakdown อายุ active:
  `demographics_breakdown=age`
- Live acceptance รอบ `0.6.41` ผ่าน native reset/bottom handling แล้ว; coverage ต่อ Breakdown ใช้ `reported_total_scope=report` + `coverage=lower_bound` ไม่แสดง `x/40` และห้ามรวม Age rows เป็นยอดรายงาน; งานถัดไปคือตรวจผลกับข้อมูล CSV เมื่อต้องการ whole-account conclusion
- Backend ปกติ: `http://127.0.0.1:4318`
- Frontend ปกติ: `http://127.0.0.1:9321`
- PostgreSQL: ใช้ค่าจาก `.env` (เครื่อง dev นี้ bind `127.0.0.1:5433`)

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
  --timeout-seconds=900 ^
  --no-scan-columns
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

`0.6.22` ผ่าน fixture และ build แต่ live run ล่าสุดยังไม่ผ่าน: report setup
เก็บคอลัมน์เสริมเดิมไว้ ทำให้คอลัมน์ identity/Age/Spend กับ
Impressions/Results อยู่คนละ horizontal slice และ join กันไม่ได้อย่างปลอดภัย.

`0.6.23` แก้ที่ต้นเหตุโดย prune คอลัมน์นอก allowlist ผ่าน trusted Chrome input
ก่อน Save, รอ column menu พร้อม, ตรวจ search clearing และยืนยัน checked columns
ว่าลดลงจริงก่อนบันทึก. Background จะเริ่ม horizontal scan เฉพาะเมื่อ scroller
มี overflow จริง จึงไม่วน diagnostic เดิมหลัง view ถูกลดความกว้างแล้ว. Agent
รายงาน `report_columns.pruned` เพื่อใช้ตรวจผล. ยังไม่มี live `0.6.23`
acceptance.

Live `0.6.23` หลังผู้ใช้ reload: heartbeat และ lease ผ่าน แต่ `report.prepare`
หยุดก่อน Save ที่ Reach เพราะ Meta มี exact label `การเข้าถึง` สองรายการ
(checked 1 / unchecked 1) และ matcher เดิมถือว่า ambiguous. `0.6.24` จึงเพิ่ม
`checked_only` สำหรับการ prune และยืนยันผลด้วย label + context หลัง trusted
click. Fixture ใหม่ผ่าน; ยังต้อง reload และทดสอบ live.

Live `0.6.24` หลัง reload: heartbeat/lease ผ่าน แต่ prune ยังไม่ผ่าน เพราะ
checkbox ของ Reach, Frequency และ CPC ถูก clip นอก scroll pane แม้ trusted
search จะแคบผลลัพธ์แล้ว. `0.6.25` เพิ่ม bounded scroll container probe และ
trusted mouse wheel ภายใน column list ก่อนคลิก พร้อมยืนยัน checked state ด้วย
label + context. Fixture ที่จำกัด list เหลือสองแถวผ่าน; live acceptance ยังรอ.

Live `0.6.25` หลัง reload: prune ยัง fail ที่ Reach/Frequency/CPC เพราะ trace
แสดง 57 clipped choices แต่ scroll target ที่ตรวจได้ไม่ครอบคลุม scroller ที่
Meta ใช้งาน. `0.6.26` รองรับ dialog scroller/fallback, ใช้ hit-tested field
probe ก่อนคลิก และบันทึก target state หลังคลิก. ยังไม่มี live acceptance.

Live `0.6.26` หลัง reload: heartbeat, lease และ scroller discovery ผ่าน แต่
`report.prepare` command `408ae704-3cdb-4ff7-922b-66dcc40849f8` หยุดก่อน Save
ที่ Reach/Frequency/CPC. หลัง trusted search label เดิมยังอยู่ แต่ Meta เปลี่ยน
context ทำให้ exact matcher เหลือ match count 0 และรายงาน `target_not_unique`.
`0.6.27` จึงจับคู่ label + checked state ระหว่าง search และยืนยันหลังคลิกว่ามี
checked choice ใช้ label เดิมเหลือศูนย์ ไม่ใช้ context หลัง rerender. Fixture
เปลี่ยน context ของ Reach หลังคลิกและผ่าน; live acceptance ยังรอ reload.

Live `0.6.27` หลัง reload: `report.prepare` ผ่าน (`applied=true`) และ prune
CPC/Frequency ได้, Breakdown Age ถูกยืนยันด้วย `demographics_breakdown=age`.
อย่างไรก็ตาม bounded run ได้ 12 snapshots และจบ `needs_review`: บาง slice มี
Impressions/Results แต่ไม่มี stable IDs/Age/Spend ขณะที่ slice อื่นมี
IDs/Age/Spend แต่ไม่มี Impressions/Results จึง join กันไม่ได้อย่างปลอดภัย.
Short run ด้วย `--skip-prepare` ให้ภาพแยกแบบเดิม 9 snapshots. หลัง Breakdown
`report.prepare` อีกรอบยังผ่านแต่ prune Reach เพิ่ม แสดงว่า transient report
view เปลี่ยนอีกครั้ง. สาเหตุร่วมที่ตรงที่สุดคือ `start` navigate ซ้ำไปยัง
reporting URL ทันทีหลังตั้งคอลัมน์.

`0.6.28` เพิ่ม `needsReportingNavigation()`: ถ้าแท็บปัจจุบันเป็น allowed host,
route ระดับที่ต้องการ, `act` เดียวที่ตรงบัญชี และ validated `*_breakdown` ตรง
ชุดเดิม จะไม่ reload หน้าและคง query อื่น เช่น filters ไว้; ถ้าไม่ตรงจึง
navigate ไป canonical reporting URL. ทั้งสองเส้นทางยัง activate/maximize แท็บ
ก่อนเริ่มอ่าน. Unit test ครอบคลุม view ที่ตรง, breakdown เรียงต่าง, account/
level ต่าง, breakdown ซ้ำ/ไม่ผ่าน allowlist และ `act` ซ้ำ.

Live `0.6.28` หลัง reload: navigation guard ทำงานและ collection ไม่ reset URL
ระหว่างรอบแรก แต่ยังไม่ผ่าน acceptance. `report.prepare` คืน `applied=true`
ทั้งที่ตารางจริงยังมี Budget/Purchases/ROAS/Target และไม่มี Impressions/Results
ใน identity slice; standalone prepare อีกรอบก็ยังคืน `applied=true` พร้อม
`pruned=[]`. หลักฐานนี้ชี้ว่า dialog ปิดไม่ใช่หลักฐานว่ามุมมองถูกบันทึก และ
คอลัมน์ส่วนเกินอาจไม่ถูก render เป็น checkbox ใน category ที่เปิดอยู่.

`0.6.29` ใช้ rendered column headers เป็นรายการเป้าหมายเพิ่มจาก checked DOM,
รองรับ choice row แบบ div/collapsed, prune ผ่าน trusted search/checkbox และ
ตรวจ header บนตารางหลัง Save. ถ้า blocking field ไม่ปรากฏหรือยังมี header
ส่วนเกิน จะคืน `applied=false` พร้อม `missing_rendered_fields` และ
`extra_rendered_headers`; ไม่เริ่ม collection จาก view ที่ยังพิสูจน์ไม่ได้.

Live `0.6.29` หลัง reload: header verification ทำงาน แต่ prune ล้มเหลวก่อน Save
เพราะ Meta แสดงแผง `เลือกไว้ N คอลัมน์` ที่มีปุ่มลบต่อแถว; probe เดิมหาเฉพาะ
checkbox จึงมองไม่เห็นคอลัมน์ที่เลือกไว้และพยายาม search ชื่อที่ dialog ไม่มี.
`0.6.30` เพิ่ม read-only `selected_columns` probe อ่านชื่อ/พิกัดปุ่มลบภายในแผง
นั้นเท่านั้น, ลบทีละคอลัมน์ผ่าน trusted click พร้อม scroll และยังใช้ checkbox
fallback เมื่อ layout ไม่มีแผง. `ปิด / เปิด` ของคอลัมน์สถานะถูกเก็บไว้.

Live `0.6.30` หลัง reload: `report.prepare` คืน `applied=true`, prune 9
คอลัมน์ส่วนเกิน, `missing_required=[]` และ Breakdown Age ผ่าน. Collection 10
snapshots จบ `needs_review`; พบ 6 Age scopes หลักพร้อม ID, Spend, Impressions,
Results/result type, Cost per result และ Attribution, coverage 25–34 จาก 40
และมี ranking เฉพาะแถวที่ยืนยันได้. ยังมี `visible_rows_unchanged` และ
Attribution แบบหลายบรรทัดทำให้เกิด scope ย่อย 1–2 แถว จึงยังไม่เรียกว่า
complete; ไม่มีการแก้/เผยแพร่โฆษณา.

Live `0.6.31` หลัง reload: ยังได้ 6 Age scopes แต่ verified coverage เหลือ
2–5 Ads ต่อ scope จาก 40 reported rows และ ranking ไม่ eligible. สาเหตุคือ
virtualized body ค้างอยู่ท้ายตารางจากงานก่อนหน้า; งานใหม่จับ Ads ห้าตัวสุดท้ายซ้ำ
และ scroll log รายงาน moved 9 ครั้งเพราะ fingerprint รวม `scroll_top` แม้
visible identities ไม่เปลี่ยน. `0.6.32` reset body ที่ step แรก, re-query
markers หลัง repaint และตัด scroll offset ออกจาก paging fingerprint. Fixture
ผ่าน reset-from-bottom และ identity-stable false paging; ยังต้อง live rerun.

Live `0.6.32` หลัง reload: 20 snapshots จบ `needs_review` พร้อม
`payment_error=true`; coverage ยังเป็น 2–5 verified Ads ต่อ Age scope จาก 40
แถว (`18–24: 5`, `25–34: 5`, `35–44: 5`, `45–54: 2`, `55–64: 3`, `65+: 4`)
และทุก snapshot มาจาก parent Ad IDs ชุดเดิมห้าตัว. จำนวนแถวสลับ 24/21 เพราะ
แถวหนึ่งหลุดขอบ จึงทำให้ scroll log ทั้ง 19 รายการเป็น false positive.
`row_reset` คืน `already_at_start` เพราะ diagnostics ไม่พบ body scroller.
`0.6.33` บังคับ paging proof เป็น identity ใหม่, reset body ที่ตรวจพบและ
re-query หลัง repaint, ตรวจ strict control exclusion ทุกจุด, ขยาย native wheel
ไปยัง gutter ขวา และจำกัด 10 targets/60 probes/12 วินาที. Fixture ผ่านครบ;
ผล live ของ 0.6.33 อยู่ด้านล่าง.

Live `0.6.33` หลัง reload: 1 snapshot, จบ `needs_review`, ยังเป็น parent Ad
IDs ชุดเดิมห้าตัว และ `visible_rows_unchanged`. scroll log แสดง target ทั้ง 10
เป็น metric bands, `body_offsets` ว่างทั้งหมด และไม่มีการ probe
scrollbar/gutter. สาเหตุคือ gutter ใช้ `scopeRect.right` ซึ่งอยู่นอกจอเมื่อ grid
กว้างกว่า viewport และ gutter loop อยู่หลัง column bands ที่ใช้ budget 10 ครบ.
`0.6.34` probe `[role="scrollbar"]` และ gutter จาก
`min(scopeRect.right, innerWidth)` ก่อน columns, ให้ band index ไม่ซ้ำ และเพิ่ม
`scroll_diagnostics` เพื่อยืนยัน geometry ของ scrollbar ในรอบถัดไป. Fixture
ตารางกว้าง 12 metric columns + scrollbar ผ่าน; ผล live ของ 0.6.34 อยู่ด้านล่าง.

Live `0.6.34` หลัง reload ยังไม่ถึง collection: `report.prepare` ผ่าน แต่
`breakdown.prepare` timeout สองครั้งด้วย `breakdown_input_timeout` ขณะที่ URL
มี `demographics_breakdown=age` แล้ว. Inspect แบบ read-only พบเมนู Breakdown
ค้างเปิด (“เลือกแล้ว 1 รายการ”) และมี Columns search ที่มองเห็น; setup ยังวน
ค้นหาทุกมิติแทนการรับสถานะที่ apply แล้ว. `0.6.35` จึง early-return เมื่อ
requested dimensions active ครบและไม่มีมิติอื่น active, ปิดเมนูที่เปิดด้วย
guarded Escape, ข้ามมิติที่ไม่ requested/ไม่ active ก่อน search, และตรวจ
loading เฉพาะ progressbar/`aria-busy` ที่มองเห็น. Fixture ยืนยัน Age setup ซ้ำ
ไม่สร้าง trusted click เพิ่ม; live acceptance ยังต้อง reload 0.6.36.

Live `0.6.35` หลัง reload: Breakdown setup ผ่าน (`ok=true`, menu ปิด) และ
collection ด้วย `--no-scan-columns` เริ่มได้หนึ่ง snapshot ที่ `step=1` แต่ไม่มี
`scroll_log` และค้างเกินห้านาที; start acknowledgement timeout ที่ 30 วินาที
แม้ job เริ่มแล้ว. หลักฐานชี้ว่า native vertical debugger call ไม่ resolve และ
worker `busy` ค้าง. `0.6.36` ห่อ debugger `attach`/`sendCommand`/`detach` ด้วย
timeout 6 วินาที โดยคืน `debugger_attach_timeout`, `debugger_command_timeout`
หรือ `debugger_detach_timeout` แทนการค้าง, และเพิ่มเวลารอ start acknowledgement
เป็น 90 วินาที. Fixture ที่ทำให้ `sendCommand` ไม่ resolve ยืนยันว่ากลับภายใน
20 วินาที; live acceptance ยังต้อง reload 0.6.36.

## 7. Tests ล่าสุด

ผ่านบน source `0.6.41`:

```bat
npm run check
npm run test:reader
npm run test:report-probe
npm run test:report-input
npm run test:report-selected-columns
npm run test:report-columns
npm run test:breakdown
npm run test:report-scroll
npm run test:capture-analysis-web
```

ผล:

- TypeScript strict ผ่าน
- Unit tests 70/70 ผ่าน
- Extension/API 0.6.41 build ผ่าน; `dist/extension/manifest.json` และ `reader_version` เป็น `0.6.41`
- report-scroll fixture เริ่มจาก body ท้ายตารางและ reset กลับแถวแรกได้
- report-scroll fixture ยืนยันว่า `scroll_top` เปลี่ยนแต่ visible IDs เดิมคืน `moved=false` (`reporting_body_moved_rows_unverified`) และ fixture ที่อยู่ไม่ถึง physical bottom
- Reader fixture ตรวจ custom right-edge track/thumb ที่ไม่มี ARIA role และคืน `vertical_scrollbar`
- report-scroll fixture เริ่มด้วย custom track ที่ซ่อน, trusted hover ทำให้ track ปรากฏ, ส่ง down/move/up, เปลี่ยน row IDs, คืน `method=native_scrollbar_drag`, ไม่ใช้ wheel และ detach debugger
- report-scroll fixture วาง custom track นอก reporting scope และยืนยัน ancestor search + right-edge hover path
- report-scroll fixture เริ่มจาก custom thumb ท้ายรางและยืนยัน native reset ลากขึ้นบนสุด, เปลี่ยนแถว, `thumb_top=0px` และ detach
- report-scroll fixture ยืนยัน near-bottom gutter 5px ว่าเป็น `reporting_bottom_reached` และ fixture ที่ attach ทำให้ repaint หนึ่งครั้งยัง reset สำเร็จ
- capture-analysis fixture ยืนยันว่า `payment_error` เป็น diagnostic เท่านั้น ไม่สร้าง recommendation และไม่ขวาง ranking
- Reader fixtures ผ่าน รวม age subrow → stable parent ID → metric mapping
- Reader fixture ตารางกว้าง 12 metric columns + scrollbar ยืนยันว่า body/gutter target ยังได้ budget ก่อน metric bands
- Breakdown fixture ยืนยันว่า Age ที่ active อยู่แล้ว setup ซ้ำได้โดยไม่สร้าง trusted click เพิ่ม
- report-input fixture ผ่าน trusted search/select/clear/detach
- report-input fixture ยืนยันว่า debugger `sendCommand` ที่ไม่ resolve คืน `debugger_command_timeout` ภายใน 20 วินาที
- report-input fixture ยืนยันว่า race/modal ไม่สร้าง wheel เพิ่ม และ strict interactive exclusion ยังทำงาน
- report-input fixture ยืนยัน duplicate Reach: prune เฉพาะ checked candidate
- report-input fixture บังคับ clipped list และผ่าน trusted wheel scrolling
- report-input fixture เปลี่ยน context หลัง uncheck และยังยืนยัน prune สำเร็จ
- report-input fixture prune extra ที่ซ่อนจาก dialog category ด้วย rendered header
- report-input fixture normalize ลูกศร sort ใน header และไม่เก็บ ROAS ที่มีคำว่าใช้จ่าย
- report-input fixture map header ที่มีวงเล็บกลับไปยัง dialog label ก่อนค้นหา
- report-input fixture บังคับ dialog ปิดแต่ header เก่า และยืนยัน `applied=false`
- report-selected-columns fixture ลบ Budget/Purchases/ROAS ผ่านปุ่มในแผง selected columns
- report-columns/breakdown/report-scroll fixtures ผ่านครบ
- capture-analysis-web fixture ผ่าน รวม unresolved evidence/mixed spend/mobile

Live acceptance `0.6.41` ยืนยัน native reset และ physical bottom บน Meta จริงแล้ว;
coverage ต่อ Breakdown ใช้ verified lower bound และต้องไม่ตีความ footer รวมเป็น
ตัวหารของแต่ละ Age หรือแสดงเป็น `x/40`.

## 8. Live run และงานถัดไป

### A. Runbook สำหรับ live run (`0.6.41` ผ่านแล้ว)

1. Reload Extension จาก `C:\BADS\bot-ads\dist\extension`
2. กลับ Ads Manager, account เดิม
3. เปิด report-input lease
4. ให้ Breakdown Age active
5. ตรวจว่า runtime heartbeat และ snapshot แสดง `0.6.41`
6. รัน:

```bat
npm run ads:agent -- DEVICE_ID messages ^
  --breakdown=age ^
  --timezone=Asia/Bangkok ^
  --no-filters ^
  --max-steps=20 ^
  --timeout-seconds=900 ^
  --no-scan-columns
```

### B. Acceptance criteria ของ live run

- Extension state เป็น `0.6.41`
- Collection ไม่ค้างที่ debugger call; ไม่มี `debugger_*_timeout` หรือมี timeout ที่จบงานอย่างชัดเจนแทนการค้าง
- start acknowledgement กลับภายใน 90 วินาที
- ได้หลาย snapshot และพบ parent Ad IDs ใหม่มากกว่าห้าตัวแรกจาก run ก่อน
- `scroll_log` มี `method=native_scrollbar_drag` หรือหลักฐาน trusted input อื่นที่ identity เปลี่ยนจริง พร้อม `scroll_diagnostics`/custom scrollbar geometry
- `report_columns.pruned` แสดงคอลัมน์เสริมที่ถูกนำออก และ selected columns เหลือชุดที่ต้องการ
- URL ระหว่าง collection คง `demographics_breakdown=age`
- snapshots มี cell header `อายุ`
- Row หนึ่งมี Ad ID + Age + Spend + Impressions + Results/Result type
- ไม่มี `breakdown_unverified`
- ไม่มี duplicate grain (entity ID + breakdown) ภายใน snapshot เดียวกัน
- มี age scopes ตามที่ Meta แสดง
- ห้ามรวม Spend/Results ข้ามอายุ
- Result groups/ranking ต้องเกิดจาก row ที่มี result type และ mapping verified
- Coverage ต่อ age scope ต้องไม่ถูกเรียก complete เพียงเพราะผลรวมทุก scopeครบ 40

### C. ถ้า result type ยังว่าง

ตรวจตามลำดับ:

1. Parent row observation มี metadata ใน Results/Status หรือไม่
2. Age subrow cells มี `result_type` หลัง `0.6.30` หรือไม่
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
