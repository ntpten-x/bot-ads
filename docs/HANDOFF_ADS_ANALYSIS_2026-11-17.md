# Handoff — Ads capture & analysis, 2026-11-17

## สถานะปัจจุบัน

- Branch: `master`
- Extension/source build: `0.6.41`
- API: `http://127.0.0.1:4318`
- Web: `http://127.0.0.1:9321`
- PostgreSQL: ใช้ค่าจาก `.env`; เครื่อง dev นี้ bind `127.0.0.1:5433`
- Meta access ยังเป็น Chrome Extension + visible UI เท่านั้น ไม่มี Graph/Marketing API, network interception หรือการดึง cookie/session

รอบนี้รวมงานค้างตั้งแต่ Extension `0.6.23–0.6.41` และปิดชั้น CSV-first reconciliation/source separation สำหรับการวิเคราะห์โฆษณา

## สิ่งที่พร้อมใช้งาน

### Extension capture

- ตั้ง/ตรวจ/ตัดคอลัมน์รายงานผ่าน trusted UI, ตรวจ final recheck และไม่ถือว่าตัวเลือกที่หาไม่พบถูกเลือกแล้ว
- Breakdown Age/Gender/Platform/Placement ผ่าน lease, bounded search และหลักฐาน URL/DOM; Breakdown ไม่ใช่ filter
- Native/custom scrollbar reset และ paging มีหลักฐาน `at_top`/`at_bottom`, row signature และ scroll diagnostics
- Live `0.6.41` job `047d3c3e-64c5-447c-bdc1-ed25727550a2` ได้ 8 snapshots, 198 raw Age observations และ 35 unique parent Ad IDs; จบ `needs_review` ตามข้อจำกัด ไม่ใช่ complete
- ได้ `reporting_bottom_reached`, `at_bottom=true`, `level_warnings=[]`; verified rows ต่อ Age คือ `34/35/32/26/26/27`
- Footer `40` เป็นยอดรวมของรายงาน ไม่ใช่ตัวหารเฉพาะ Age จึงใช้ `reported_total_scope=report` และ `coverage=lower_bound`
- `payment_error` เป็น diagnostic เท่านั้น ไม่สร้าง recommendation, ไม่จัดอันดับ และไม่บล็อกการประเมิน

### CSV-first analysis

- `parseReport()` คืน `reconciliation` แบบ structured: expected/actual/delta/matched ของ rows, spend และ interval เมื่อระบุ
- `scope_coverage=verified_for_import` หมายถึงเฉพาะไฟล์ที่นำเข้าและยอดตรงกัน ไม่ได้ยกระดับ `coverage` ทั้งบัญชีจาก `unverified`
- Backend ประทับ `raw._import_reconciliation` หลัง validation ก่อนบันทึก เพื่อให้ยอดจากฐานข้อมูลตรวจย้อนกลับได้; CSV column ชื่อเดียวกันถูกเขียนทับ ไม่ถือเป็นหลักฐาน
- Analysis แยก `csv`, `dom_capture`, `unknown`; group key รวม source และไม่บวกยอด/จัดอันดับข้าม CSV กับ DOM แม้ ID เงื่อนไขตรงกัน
- `verified_import_rows` แสดงจำนวนแถว CSV ที่มีหลักฐาน reconciliation ระดับแถว; แถวเก่าหรือ proof ไม่ตรง filename เป็น `unverified`
- หน้าวิเคราะห์แสดงแหล่งข้อมูล, สถานะกระทบยอด และใช้ CSV ที่ยืนยันแล้วเป็นแหล่งยอดหลัก ส่วน DOM เป็น visible lower bound

### Coverage และการประเมิน

- `coverage=complete` รับรองเฉพาะ scope ที่มีหลักฐานครบ; Breakdown partition ใช้ `lower_bound` และห้ามอ่าน footer รวมเป็น `x/40`
- CPA เปรียบเทียบภายในชุดวันที่/level/currency/timezone/attribution/result type/objective/Breakdown/source เดียวกัน
- ต้องมีอย่างน้อย 5 conversions ต่อแอดและอย่างน้อย 3 แอดที่เทียบได้ก่อนจัดอันดับ; เป็นการคัดกรองเชิงพรรณนา ไม่ใช่นัยสำคัญทางสถิติหรือการรับประกันกำไร
- Missing metrics ยังเป็น unknown/null ไม่เติมศูนย์; ไม่ใช้ generic Results แทน purchases/leads/messaging conversations

## Validation ล่าสุด

- `npm run check` — strict typecheck, **73/73** unit tests, Extension/API build
- `npm run build:web` — Next production build ผ่าน
- `npm run test:analysis` — reconciliation/provenance persistence, preview/import/export ผ่าน
- `npm run test:api` — validate, idempotent import, atomic upsert และ export ผ่าน
- `npm run test:web` — หน้า production flow รวม reconciliation UI, filtered export, analysis scope และ mobile layout ผ่าน
- `npm run test:capture-analysis-web` — capture analysis fixture ผ่าน
- `git diff --check` รายงาน CRLF/trailing-whitespace ของไฟล์เดิมทั้ง repo; ไม่ได้ mass-format ไฟล์ที่ไม่เกี่ยวกับงาน

## ข้อจำกัดที่ต้องคงไว้

- Live DOM ยังพิสูจน์ whole-account coverage ไม่ได้; `needs_review` ไม่ใช่ complete
- ห้าม sum ข้าม Age/Breakdown/source หรือใช้ชื่อ/ตำแหน่งเซลล์เป็น stable ID
- CSV ต้องมี IDs และ metric ตามเป้าหมายจริง; ถ้าไม่มี messaging conversations/purchases/leads การประเมินจะ blocked ตามหลักฐาน
- ต้องมี sample เพียงพอและควรมีเป้าหมาย CPA/ROAS ของธุรกิจก่อนตัดสินใจงบ
- ยังไม่มี trend/statistical significance และ experiment workflow
- ห้าม commit `.env`, token, reports, screenshots, browser profile หรือข้อมูลลูกค้าจริง

## งานถัดไปที่ควรทำ

1. ใช้ CSV export จริงจาก Meta ที่มี IDs + metric เป้าหมาย แล้วตรวจว่า UI แสดง `กระทบยอดไฟล์นี้แล้ว` และ analysis มี `verified_import_rows` ตรงจำนวน
2. เพิ่ม business target CPA/ROAS และช่วงเวลาที่ต้องการเทียบ เพื่อแยกระดับ “ถูก/แพง” จาก median ภายในชุดข้อมูล
3. พิจารณา source-comparison แบบ group totals ระหว่าง CSV กับ DOM เฉพาะ scope ที่เข้ากันได้ โดยไม่ join รายชื่อ/ตำแหน่งและไม่ sum ข้าม source
4. เพิ่ม trend ตามช่วงวันที่และ experiment tracking หลังยืนยันคุณภาพข้อมูลจริงแล้ว

## เอกสารที่เกี่ยวข้อง

- [ANALYSIS.md](ANALYSIS.md)
- [VALIDATION.md](VALIDATION.md)
- [AI_HANDOFF.md](AI_HANDOFF.md)
- [HANDOFF_ADS_AUTOMATION_2026-11-16.md](HANDOFF_ADS_AUTOMATION_2026-11-16.md)
