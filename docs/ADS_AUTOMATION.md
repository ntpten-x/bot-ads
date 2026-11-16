# Ads automation agent

สถานะ: read-only automation v1. บอทเป็นตัววางแผนและตรวจผลผ่าน Backend queue;
Extension เป็นผู้ควบคุมหน้า Ads Manager จริงและส่ง snapshots เข้า PostgreSQL.
ยังไม่อนุมัติหรือแก้โฆษณาแทนผู้ใช้.

## เป้าหมาย

ผู้ใช้ต้องการให้ระบบเปิด Ads Manager, ตั้งคอลัมน์รายงาน, อ่าน Ads, เก็บข้อมูลลง
PostgreSQL และวิเคราะห์ผลได้เองโดยไม่ต้อง export CSV ด้วยมือ. สถาปัตยกรรมนี้ทำ
งานผ่านหน้าเว็บที่ผู้ใช้มองเห็นเท่านั้น ไม่มี Meta Graph/Marketing API, network
interception หรือการอ่าน cookie/session.

## แบ่งหน้าที่

```text
ads-agent (สมอง)
  → Backend command queue
  → Extension (ร่างกาย/ perceptron)
  → Ads Manager UI
  → DOM capture + PostgreSQL
  → capture analysis
  → ads-agent receipt
```

`scripts/ads-agent.ts` ตรวจ state, ส่งคำสั่งแบบ typed, รอผล และสรุป analysis.
Extension ยังคงตรวจ device/account/tab/route, local lease และ approval ทุกครั้ง.
Backend ไม่รับ JavaScript, selector, พิกัด หรือ CDP method จากบอท.

## Workflow v1

1. ตรวจ Extension heartbeat ไม่เกิน 90 วินาที, version ขั้นต่ำ และบัญชีที่ผูกไว้
2. หยุดถ้ามี collection job กำลังรัน เพื่อไม่แย่งแท็บ
3. เปิดหน้า Ads Manager ระดับ Ads ของบัญชีเดิม
4. ตรวจ local report-input lease จาก popup
5. สั่ง `report.prepare` ตาม goal ที่ระบุ
6. เริ่ม `start` ด้วย `levels=["ads"]`, `scan_columns=true`
7. รอ job ถึงสถานะ `needs_review` หรือ `error`
8. รอ capture snapshots ของ job ถูกบันทึกใน PostgreSQL
9. เรียก `/captures/analysis` และคืน blockers, coverage และ recommendations

คำสั่ง:

```bat
npm run ads:agent -- DEVICE_UUID messages
npm run ads:agent -- DEVICE_UUID sales --max-steps=12
npm run ads:agent -- DEVICE_UUID leads --timeout-seconds=300
npm run ads:agent -- DEVICE_UUID messages --timezone=Asia/Bangkok --no-breakdown --no-filters
npm run ads:agent -- DEVICE_UUID messages --breakdown=age,gender
```

ตัวเลือก:

- `--skip-prepare`: ใช้คอลัมน์ที่ตั้งไว้แล้ว
- `--skip-navigate`: เริ่มจากหน้า Ads Manager ที่เปิดอยู่
- `--max-steps=1..20`: จำกัดจำนวนรอบเลื่อนแนวตั้ง
- `--timeout-seconds=N`: จำกัดเวลารอ collection
- `--timezone=IANA`: ใช้เฉพาะเมื่อผู้ใช้ยืนยัน timezone ของรายงาน
- `--attribution=TEXT`: ใช้เฉพาะเมื่อผู้ใช้ยืนยัน attribution ที่ไม่ปรากฏบนหน้า
- `--result-type=TEXT`: ใช้เฉพาะเมื่อผู้ใช้ยืนยันชนิดผลลัพธ์
- `--no-breakdown`: ผู้ใช้ยืนยันว่าไม่มี Breakdown
- `--no-filters`: ผู้ใช้ยืนยันว่าไม่มีตัวกรองรายงาน
- `--breakdown=age,gender,platform,placement`: ใช้ Breakdown ที่อนุญาต;
  ระบบเลือกด้วย trusted UI input และล้างมิติที่เลือกไว้ออกจาก allowlist นี้

## Breakdown

Breakdown ไม่ใช่ Filter. Breakdown แยก Ads หนึ่งรายการตามมิติ เช่น อายุ เพศ
แพลตฟอร์ม หรือตำแหน่งการแสดงโฆษณา. ค่าที่เก็บต้องมี:

- มิติ (`age`, `gender`, `platform`, `placement`) และค่าของมิติ
- Ad ID และ parent IDs เดิม
- Spend, Impressions, Results และเงื่อนไขรายงานเดิม

ห้ามรวมยอดหรือจัดอันดับข้าม breakdown combination. Extension เลือกได้เฉพาะ
รายการ exact จาก allowlist; menu ที่มีตัวเลือกซ้ำ, ถูก clip, หรือมี Breakdown
ชนิดอื่นค้างอยู่จะหยุดโดยไม่เลือกต่อ. ทุกการเปลี่ยน view ต้องมี report-input
lease และไม่มีการอนุมัติจาก Backend.

คำสั่งเดี่ยว:

```bat
npm run bot -- DEVICE_UUID breakdown age gender
npm run bot -- DEVICE_UUID breakdown platform placement
```

`breakdown.prepare` รับได้เฉพาะ `age`, `gender`, `platform`, `placement`.
หาก URL มี breakdown ที่ไม่รองรับ เช่น `time_breakdown=time` ระบบจะหยุดและให้
ผู้ใช้ตรวจหน้า Meta ก่อน ไม่เดาวิธีล้างค่าที่ไม่รู้.

Age และ Gender เป็นค่าทางเลือกในช่วง `demographics_breakdown` เดียวกัน จึงต้อง
รันแยกงานหรือสลับค่า ไม่ขอพร้อมกัน:

```bat
npm run ads:agent -- DEVICE_UUID messages --breakdown=age
npm run ads:agent -- DEVICE_UUID messages --breakdown=gender
```

Collector จะพาเฉพาะ query ที่ลงท้าย `_breakdown` และผ่าน allowlist ไปยังทุกหน้า
Ads Manager ระหว่าง job. ค่าที่ไม่ผ่าน validation จะหยุดก่อน navigation.

## ความหมายของผล

`needs_review` เป็นการจบ workflow ที่ปลอดภัย แต่ไม่ใช่หลักฐานว่าอ่านครบ.
บอทจะไม่เปลี่ยน unknown เป็น 0, ไม่ใช้ชื่อแทน stable ID และไม่สร้างอันดับเมื่อ
scope, ID หรือ column mapping ยังไม่ยืนยัน.

การวิเคราะห์อาจมีประโยชน์จาก DOM แม้ coverage ยัง partial เช่น detecting payment
errors หรือ unpublished edits. Spending, CPA และ rankings ต้องรอ required metrics,
stable IDs, reporting context และ alignment ที่ผ่านเกณฑ์.

Report setup แยก **blocking capture fields** (ชื่อ, IDs, Spend, Impressions,
Results, Cost per result, Attribution) ออกจาก **goal metrics เสริม** เช่น Link
clicks หรือ Messaging conversations. ถ้า Meta ภาษาไทยไม่มีคอลัมน์เดี่ยวหรือ
ตัวเลือกถูก clip ระบบจะ Save เฉพาะ view ที่ blocking fields ผ่าน แล้วรายงาน
ฟิลด์เสริมใน `missing_goal_metrics`; Generic Results และ Cost per result ยังใช้
ประเมินผลลัพธ์ตาม objective ได้โดยไม่เปลี่ยน Results เป็น Purchases/Leads/Messages.

## Guards ที่ห้ามถอด

- Meta access ผ่าน Chrome Extension และหน้าเว็บเท่านั้น
- Device ผูกกับ account และ tab; route/account เปลี่ยนแล้วหยุด
- Report native input ต้องมี local lease จาก popup
- Action สำคัญต้องมี one-time local approval; backend อนุมัติแทนไม่ได้
- Disclosure/no-breakdown/no-filter ของผู้ใช้ต้องเป็น explicit true
- Job ต้อง bounded และหยุดเมื่อไม่มีความเคลื่อนไหวที่ยืนยันได้
- Frontend/API ไม่เก็บ Meta token, cookie หรือ password

## Startup และข้อจำกัด

Extension ทำงานได้เมื่อ Chrome เปิดอยู่และแท็บ Meta ที่ผูกไว้ยังใช้งานได้.
หลัง Chrome restart ผู้ใช้อาจต้องกรอก Backend token และเปิด report-input lease ใหม่.
การตั้งคอลัมน์ถือเป็นการเปลี่ยน reporting view จึงต้องมี lease แม้จะไม่ใช่การแก้โฆษณา.

Workflow v1 ยังไม่ทำ:

- autonomous publish/budget/status mutation
- automatic bypass ของ popup approval
- scheduled browser start
- guarantee ว่า Meta DOM ทุก layout รองรับ
- accept job เป็น complete จากจำนวน snapshot แทนการ reconciliation

## Acceptance criteria

ก่อนเรียก DOM workflow ว่าใช้วิเคราะห์ราย Ads ได้:

- อ่าน Ads ได้ครบตาม reported footer ภายใน scope ที่ตรวจ
- ได้ stable Ad ID และ parent IDs
- มี Spend/Impressions/Results ตาม goal
- column/row alignment aligned
- date, currency, timezone, attribution, breakdown และ filters มีหลักฐาน
- ไม่มี duplicate หรือ conflicting IDs
- analysis แสดง `complete` หรืออธิบาย blockers อย่างตรงไปตรงมา

จนกว่าจะผ่านเกณฑ์นี้ ให้ถือ DOM เป็นหลักฐานเสริม และใช้ validated CSV เป็น
แหล่ง normalized insights หลักเมื่อต้องการผลรวมหรือจัดอันดับที่มั่นใจได้
