# ผลทดลองระบบอ่านและวิเคราะห์แอด — 16 พฤศจิกายน 2026

## คำตัดสิน

ยังไม่พร้อมใช้ผลอ่าน DOM ตัดสินใจรายแอดหรือจัดสรรงบอย่างน่าเชื่อถือ ระบบอ่านหน้า Meta จริงและคำนวณตามกฎได้ แต่ยังยืนยันตัวตน ความครบถ้วน และบริบทของข้อมูลไม่ได้ เส้นทาง CSV ที่ผ่าน validation ใช้งานได้ตาม integration test; ผล fixture ไม่ใช่หลักฐานว่าข้อมูลบัญชีจริงครบแล้ว

## ขอบเขตและหลักฐาน

- ใช้ dependencies Windows ผ่าน `cmd.exe /d /c` ตามคู่มือ ไม่ติดตั้ง dependencies และไม่ rebuild Extension
- Backend/PostgreSQL พร้อม; Extension ที่ตอบกลับจริงระบุรุ่น 0.6.2
- ส่ง `ui.action/inspect` ผ่าน Backend queue ได้ผล `observed` และ `account_verified=true`
- ส่ง `start` ระดับ ads, `maxSteps=12`, `scan_columns=true` ผ่าน queue ใช้เวลาเก็บประมาณ 30 วินาทีหลังรับคำสั่ง จบ `needs_review`
- ไม่ส่งคำสั่งแก้งบ สถานะ หรือเผยแพร่ ไม่เปิดหรือข้าม local lease/approval
- มีการเปลี่ยนแปลงเดิมจำนวนมากใน workspace; รอบนี้ไม่แก้ product source หรือ migrations
- เครื่องมือ browser ของ agent ไม่มี Chrome ฝั่ง Linux จึงทดสอบเว็บด้วย browser integration ฝั่ง Windows และทดสอบ Meta ผ่าน Extension ที่เชื่อมต่ออยู่

## ผล Meta จริงรอบนี้

| สิ่งที่ตรวจ | ผล |
| --- | --- |
| จำนวนแถวในแต่ละ snapshot | 7 แถว × 6 snapshots จากการกวาดคอลัมน์ |
| ยอดรวมที่ Meta แสดง | 40 แอด |
| การเลื่อนแนวตั้ง | `moved=false`, method `none`; wheel และ scrollIntoView ไม่เผยแถวใหม่ |
| ตัวตน | `no_stable_ids`; ไม่มี Ad ID ที่ยืนยันได้ |
| บริบท | อ่านวันที่และ THB ได้; timezone/attribution ยังไม่ยืนยัน |
| สถานะการนำส่ง | พบข้อความ payment error 7 แถวที่มีสถานะอ่านได้; ไม่ใช่ข้อสรุปของทั้งบัญชี |
| ผล API วิเคราะห์ | นับ 42 แถวและระบุ `coverage=complete` ทั้งที่เลื่อนแนวตั้งไม่ได้ |
| แหล่งยอดใช้จ่าย | ระดับ job ระบุ `reported` แต่กลุ่มผลลัพธ์ระบุ `spend_basis=estimate` |

แถวจากการกวาดคอลัมน์ยังไม่มี stable ID จึงเชื่อมว่าเป็นแอดเดียวกันไม่ได้ ห้ามถือ 42 เป็นจำนวนแอดจริง และห้ามนำยอดรวม/อันดับรอบนี้ไปใช้ตัดสินใจงบ

## ประเด็นที่ต้องแก้ตามลำดับ

1. **ความครบถ้วนผิดจริง:** `analyzeRow` สร้าง key จากเนื้อหาเซลล์เมื่อไม่มี ID; แต่ละช่วงเลื่อนแนวนอนมีเซลล์ต่างกัน จึงถูกนับเป็นคนละแถว จากนั้น `rows.length >= reported` ให้ complete โดยไม่ยืนยันตัวตน ดู `packages/core/src/capture-analysis.ts` บริเวณ 273–276, 314–343 ต้องไม่รับรองครบจากจำนวน content keys และต้องแยกหลักฐานแต่ละช่วงคอลัมน์
2. **ยังเก็บไม่พ้นหน้าจอแรก:** scroll log ของ 0.6.2 จริงยืนยันว่า wheel/scrollIntoView ไม่ทำให้แถวเปลี่ยน ต้องแก้เส้นทางเลื่อนด้วยหลักฐาน DOM จริง แล้วเทียบ IDs กับจำนวนแถวต้นทาง
3. **ป้ายยอดใช้จ่ายเกินหลักฐาน:** `data_quality.spend` ดูเพียงการมีหัว spend ในระดับรวม (`capture-analysis.ts:522`) ขณะที่ค่าที่ใช้วิเคราะห์อาจมาจากผลลัพธ์ × ต้นทุนต่อผลลัพธ์ ต้องสรุปจากค่าที่นำมาใช้จริง รวมถึง missing/mixed/estimated
4. **บริบทข้าม snapshot ไม่ถูกแยก:** DOM analysis รวมตามระดับและชนิดผลลัพธ์ แต่ใช้บริบทจาก snapshot ล่าสุด ไม่มีการแยกช่วงวัน/สกุลเงิน/timezone/attribution เหมือน normalized analysis (`capture-analysis.ts:314–365`) ต้องแยก grain ก่อนรวม/จัดอันดับ
5. **ยังเป็นการประเมินตามกฎ:** เกณฑ์อันดับใช้ต้นทุนต่อผลลัพธ์และจำนวนผลลัพธ์ขั้นต่ำ ค่าใช้จ่าย/รายได้ที่ยืนยันได้ยังไม่ครบ ไม่มีหลักฐานการประเมินกำไรจริง คุณภาพลีด หรือผลของคำแนะนำต่อธุรกิจ

## การทดลองข้อมูลจำลองเพิ่มเติม

เรียก pure function ของ source ปัจจุบันด้วยข้อมูลสังเคราะห์ ไม่แตะข้อมูลลูกค้า:

| กรณี | ผลที่เกิดจริง | ปัญหา |
| --- | --- | --- |
| ID เดิม ต่างวัน ผลลัพธ์ 5 → 10 | เก็บค่า 5 แต่ติดป้ายวันที่ของ snapshot ล่าสุด | ใช้ค่าคนละช่วงกับป้ายบริบท |
| ไม่มี ID แอดเดิม ตัวเลขเปลี่ยน 5 → 10; footer 1 | นับ 2 แถว รวมผลลัพธ์ 15 และบอก complete | content key ไม่ใช่ identity |
| สอง IDs ต่างวันและ THB/USD | บวก spend 50 + 100 เป็น 150 พร้อมป้าย USD และไม่มี warning | รวมหน่วยและช่วงเวลาต่างกัน |

สคริปต์ทดลองอยู่ใน ignored `reports/assessment-edge.ts`; หลักฐานส่วนตัวของ live run อยู่ใต้ ignored `reports/assessment-*-private.json` ไม่ควร commit

## ผลตรวจซ้ำรอบนี้

| คำสั่ง | ผล/ขอบเขต |
| --- | --- |
| `npm run health` | ผ่าน Backend และ PostgreSQL |
| `npm test` | ผ่าน 34/34; ยังไม่มี regression ของสาม edge cases ข้างต้น |
| `npm run typecheck` | ผ่าน |
| `npm run test:reader` | ผ่าน browser fixtures รวม paging, column alignment, identity และ unknown values; ไม่พิสูจน์ live paging |
| `npm run test:analysis` | ผ่าน auth, validated preview, reconciliation rejection, DB persistence, IDs และ idempotent import; ลบเฉพาะ fixture ของการทดสอบ |
| `npm run test:web` | ผ่านการใช้งานหน้าเว็บจริงกับข้อมูล fixture: login, import, export, queue, approval handoff, history, mobile และ logout |

## เกณฑ์รับรองรอบถัดไป

ต้องอ่าน Ad IDs ไม่ซ้ำครบตามจำนวนต้นทางภายใต้ตัวกรองเดียวกัน เชื่อมคอลัมน์ด้วย IDs ตรวจยอดใช้จ่าย/ผลลัพธ์เทียบ CSV ที่ยืนยันเงื่อนไขเดียวกัน และทดสอบข้อมูลองค์ประกอบขาด/ซ้ำ/ต่างบริบทให้ถูกปฏิเสธหรือแยกกลุ่มก่อนเชื่อผลประเมิน ป้าย `needs_review`, partial และ estimated ต้องไม่ถูกตีความว่า complete หรือยอดจริง

ทางใช้งานที่มีหลักฐานรองรับขณะนี้คือ CSV จาก Meta ระดับ Ads พร้อม IDs และบริบทครบ → validation/reconciliation → normalized analysis โดยผู้ใช้ตรวจผลก่อนตัดสินใจ
