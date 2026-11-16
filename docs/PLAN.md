# Meta Ads Data Collector v1

## เป้าหมาย
รวบรวมข้อมูลโฆษณาที่ได้รับอนุญาตเข้า PostgreSQL พร้อมแหล่งที่มาและเงื่อนไขการวัดผล โดยไม่มีการสร้าง แก้ไข ลบ หรือเผยแพร่โฆษณา และยังไม่มี AI วิเคราะห์

## สถาปัตยกรรม

```text
Bot → authenticated local API → command queue → Chrome Extension
                                              ↓
                          Account guard → Navigator → Visible table reader
                                              ↓
                                   Checkpoint / raw snapshots
Meta CSV → Extension preview → API validation → atomic import → PostgreSQL
                                                              ↓
                                                     JSON / CSV → Future AI
```

## สิ่งที่ทำในรอบนี้
- Manifest V3, TypeScript, popup ภาษาไทย และ optional host permissions
- ตรวจ Account ID จาก URL (ไม่เท่ากับตรวจสิทธิ์บัญชี)
- บอทสั่ง start / pause / resume / status ผ่านคิวใน PostgreSQL
- จำกัดบอทให้ใช้แท็บและบัญชีที่ผู้ใช้ผูกไว้ ไม่มีคำสั่งรัน JavaScript หรือคลิก selector อิสระ
- นำทาง Campaigns → Ad Sets → Ads และเลื่อนตารางแบบจำกัดจำนวนรอบ
- บันทึก checkpoint ใน Chrome Storage และรายงาน error แทนการพยายามกดข้าม dialog
- CSV parser รองรับชื่อคอลัมน์มาตรฐานและ alias ภาษาอังกฤษบางส่วน
- Validation ของ ID, hierarchy, account, date, currency, timezone, attribution, result type, numbers, duplicate grain และ reconciliation
- Creative และ breakdown ที่อยู่ใน CSV; เก็บคอลัมน์ต้นฉบับใน raw เสมอ
- Transaction, UPSERT, duplicate import detection, immutable per-import observation history
- ส่งออก JSON และ CSV ที่ผ่านการตรวจ หรือ JSON จาก Database

## ความครบถ้วนห้าด้าน
| ด้าน | สิ่งที่ตรวจได้ขณะนี้ | สิ่งที่ยังไม่ยืนยัน |
|---|---|---|
| Entity coverage | จำนวนแถวเทียบ expected rows | จำนวน entity ทั้งบัญชีและแถวที่ซ่อนอยู่ |
| Date coverage | วันที่รูปแบบถูกต้องและช่วงเวลาแต่ละ record | ทุกวันที่คาดหวังและวันที่ไม่มีการส่งโฆษณา |
| Metric coverage | spend/impressions บังคับ, optional metrics คง null เมื่อไม่มี | ทุก metric ที่ Meta อาจรายงาน |
| Relationship | ID chain ในไฟล์และ parent ที่บันทึกแล้ว | entity ภายนอกไฟล์ |
| Reconciliation | spend เทียบ expected total ภายใต้ grain เดียว | results ต้องเทียบเพิ่ม และยอดต้นทางต้องมาจากเงื่อนไขเดียวกัน |

สถานะทั้งบัญชีเป็น `unverified` เสมอใน v0.1 ไม่แสดง 100% จากจำนวนหน้าที่เลื่อนแล้ว

## งานถัดไปก่อนใช้จริงหลายลูกค้า
1. ทดสอบ DOM adapter กับหน้า Meta จริง ทั้งภาษาไทยและอังกฤษ พร้อม fixture ที่ลบข้อมูลส่วนตัว
2. เพิ่ม column mapping UI, XLSX, date presets, ผลรวม results และรายการวันที่ขาดตาม expected manifest
3. เพิ่ม adapter สำหรับเปิด creative detail และ export report โดยมีการทดสอบว่าไม่แตะปุ่มแก้ไข
4. ทำ pagination/virtual scrolling ที่ยืนยัน ID ได้ และรองรับหน้าโหลดช้าโดย retry แบบจำกัด
5. เพิ่ม tenant isolation, account-scoped credentials, secret management, retention และ migration สำหรับ production
6. เพิ่มและทดสอบ DOM workflow ตามหน้าจริง โดยไม่ใช้ Meta API ตามข้อกำหนดล่าสุด

โครงการนี้ยังไม่ใช่บอทที่ควบคุม Meta Business ทุกฟังก์ชันอย่างอิสระ: รองรับการอ่านหน้ารายงานที่กำหนดเท่านั้น การเข้าสู่ระบบและตั้งค่ารายงานต้นทางยังทำโดยผู้ใช้

## เปลี่ยนขอบเขต v0.2 ตามคำสั่งล่าสุด

ข้อกำหนดปัจจุบันให้ควบคุมผ่าน Extension เท่านั้น และรองรับงานแก้ไข/ยิงแอดด้วย ข้อความ Read Only และข้อเสนอใช้ Meta API ในแผน v0.1 ด้านบนเป็นประวัติเดิม ไม่ใช่ขอบเขตปัจจุบัน

สถาปัตยกรรมใหม่:

```text
Bot → Local command queue → Extension → inspect visible DOM
                              ↑                 ↓
                         fresh snapshot ← click / fill / select / upload
                              ↑                 ↓
                      local one-time review ← publish/save/confirm

CSV / raw observations → validation + provenance → PostgreSQL
```

ทำแล้ว: shared typed command schema, viewport inspector, temporary target handles, DOM executor, URL/account guards, local control lease, one-time important-action review, command receipts และ UI control tests

ยังต้องทำก่อนบอทยิงแอดเองครบกระบวนการจริง: บันทึกและทดสอบ workflow ของ Meta ทั้ง Campaign/Ad Set/Ad editor, ประเภทวัตถุประสงค์ที่ต้องใช้, การตั้งงบ/วัน/กลุ่มเป้าหมาย/placement, media processing, publish review และการตรวจสถานะหลังเผยแพร่ โดยใช้บัญชีและชิ้นงานที่ผู้ใช้อนุญาต หน้าเว็บจริงอาจไม่รับ synthetic events หรือใช้ iframe/native dialogs ซึ่ง executor ปัจจุบันยังไม่รองรับ

ไม่มี Meta API integration และไม่มีการสร้างหรือเผยแพร่แอดจริงระหว่างพัฒนารอบนี้

## หน้าระบบ v0.3

เพิ่ม Next.js frontend ตามคำสั่งผู้ใช้ที่พอร์ต 9321 พร้อมภาพรวม การควบคุมหน้า Meta นำเข้า CSV ข้อมูล/ส่งออก ประวัติคำสั่ง และตั้งค่า/วิธีใช้ ใช้ Backend เดิมผ่าน same-origin `/api/*` proxy สิทธิ์การแก้ไขและการอนุมัติยังบังคับที่ Extension และไม่มี Meta API integration

ดู [วิธีเปิดระบบและขอบเขตหน้าเว็บ](FRONTEND.md)

## ระบบข้อมูลวิเคราะห์ 0.4.0

เพิ่มรายงานระดับ Ads สำหรับเป้าหมายข้อความ/ยอดขาย/ลูกค้าเป้าหมาย, catalogue metrics ไทย/อังกฤษ, column mapping UI, grouped-dot numeric parsing แบบเลือกชัดเจน, หลักฐาน row/cell จาก DOM, bounded horizontal/vertical collection, foreground-tab handling, workflow ตั้งคอลัมน์เฉพาะหน้ารายงาน, completeness per goal, ratios แยก reported/derived และ JSON/CSV analysis exports

รายละเอียดใช้งานและขอบเขต: [ANALYSIS.md](ANALYSIS.md) ขั้นต่อไปยังต้องทดสอบ workflow ตั้งคอลัมน์และ cell observations รุ่นใหม่บน Meta จริงหลัง Reload Extension ไม่ถือว่า fixture tests ยืนยันครบทุกคอลัมน์หรือทั้งบัญชี
