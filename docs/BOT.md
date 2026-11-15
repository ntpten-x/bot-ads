# Extension web control contract — v0.2

Backend เป็น API ในเครื่องของเราเองสำหรับคิวคำสั่งและ Database **ไม่ใช่ Meta API** โค้ดเราไม่เรียก Graph/Marketing API และไม่อ่าน cookie, session token, network traffic หรือ page JavaScript state ของ Meta

## เริ่มเชื่อมต่อ

1. เปิด Backend ตาม README แล้วติดตั้ง `dist/extension` รุ่นล่าสุด
2. เปิด Ads Manager เช่น `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=ACCOUNT_ID` หรือ Business Suite หน้า `/latest/...`
3. เปิด popup กรอกบัญชีและ token ของ Backend กดเชื่อมต่อและทดสอบอ่านและให้ optional host permission คัดลอก Device ID
4. เปิดโหมดควบคุม 15 นาทีเมื่อต้องเปลี่ยนข้อมูลบนบัญชีจริง (จำกัด 100 actions) ปุ่มหยุดการแก้ไขปิดสิทธิ์นี้ทันที คำสั่งที่เริ่ม dispatch แล้วอาจจบได้
5. Chrome ตรวจคิวทุกประมาณ 30 วินาทีขณะเปิดเบราว์เซอร์ หลัง restart ต้องใส่ Backend token ใหม่ (เก็บใน Chrome session)

## ส่งคำสั่ง

ทุก endpoint ใช้ `Authorization: Bearer API_TOKEN` ที่มาจาก `.env` Backend เป็นระบบ single operator ไม่ใช่ multi-tenant

```http
POST /devices/DEVICE_UUID/commands
Content-Type: application/json

{"command":"ui.action","action":{"type":"inspect"}}
```

จะได้ `{ "id": "COMMAND_UUID" }` ใช้ `GET /devices/DEVICE_UUID/commands/COMMAND_UUID` ตรวจ `status` และ `result` คำสั่งอาจ `done` แต่ `result.ui.outcome=awaiting_local_review` ซึ่งหมายถึงยังไม่ได้คลิก

`GET /devices/DEVICE_UUID/state` ให้ snapshot ล่าสุดกับ `updated_at` สถานะเก่าไม่รับรองว่าบราวเซอร์ยังเชื่อมต่อ `commands/next`, `result` POST และ `state` POST ใช้ภายใน Extension

CLI:

```bash
npm run bot -- DEVICE_UUID inspect
npm run bot -- DEVICE_UUID result COMMAND_UUID
npm run bot -- DEVICE_UUID state
npm run bot -- DEVICE_UUID send command.json
```

### วงจรควบคุม

`inspect` คืน `result.ui.snapshot`: ข้อความ viewport, controls, label, role, value, ตัวเลือก dropdown, สถานะ disabled และ `snapshot_id` เป้าหมายเป็น `node_0`, `node_1` ฯลฯ ไม่รับ arbitrary selectors หรือ JavaScript

```json
{
  "command": "ui.action",
  "action": {
    "type": "fill",
    "snapshot_id": "UUID_FROM_LATEST_OBSERVATION",
    "target": "node_4",
    "value": "ชื่อแคมเปญ"
  }
}
```

ผลหลังทำงานเป็น `outcome=dispatched`, `requires_verification=true` และ snapshot ใหม่ บอทต้องอ่านผลว่า value/ขั้นตอน/ข้อความยืนยันตรงเป้าหมายจริง **ห้ามถือว่า dispatched แปลว่าเผยแพร่สำเร็จ** คำสั่งไม่ถูก retry เมื่อผลไม่แน่นอน

### คำสั่งที่รองรับ

| Command/action | ข้อมูล |
|---|---|
| `ui.action` / `inspect` | `max_controls` 1–300, default 150 |
| `ui.action` / `click` | `snapshot_id`, `target` |
| `ui.action` / `fill` | `snapshot_id`, `target`, `value` สูงสุด 20,000 ตัวอักษร |
| `ui.action` / `select` | `snapshot_id`, `target`, `value` สำหรับ native select; custom dropdown ใช้ click → inspect → click option |
| `ui.action` / `check` | `snapshot_id`, `target`, `checked` boolean |
| `ui.action` / `press` | `snapshot_id`, `target`, `key`: Enter, Escape, ลูกศร, space; เป็น synthetic events อาจถูกหน้าเว็บละเลย Tab ไม่รองรับ ให้เลือก target โดยตรง |
| `ui.action` / `scroll` | `delta_y` -4000 ถึง 4000; ระบุ target/snapshot ได้เพื่อเลื่อน container |
| `ui.action` / `upload` | `snapshot_id`, `target`, `filename`, `mime_type`, `base64`; PNG/JPEG/WebP/MP4 สูงสุด 5 MB ผ่าน DOM file input |
| `ui.navigate` | `url` ของหน้า UI Business Suite / Ads Manager บัญชีเดิม ไม่รับ Graph/API/internal endpoint |
| `ui.focus` | เปิดแท็บและ window ที่ผูกไว้ |
| `ui.screenshot` | JPEG ของ viewport แท็บที่ผูกและกำลัง active; ต้องมีสิทธิ์ capture จาก Chrome หากไม่ได้ให้เปิด popup บนแท็บนั้นก่อน |

Business Suite ที่ไม่มี `act` ใน URL อ่านได้ แต่แก้ข้อมูลไม่ได้จนกว่าจะเปิดหน้า Ads Manager ที่ `act` ตรงบัญชี ระบบไม่เดาบัญชีจากชื่อเพจ ไม่ควบคุม password/payment/token fields และไม่เข้า login หรือ CAPTCHA แทนผู้ใช้ ไม่รองรับ cross-origin frames, closed shadow DOM, OS dialogs และ trusted native input

### การตรวจคำสั่งสำคัญ

เมื่อเป้าหมายมีชื่อ publish/เผยแพร่, save/บันทึก, confirm/ยืนยัน, delete/ลบ ฯลฯ หรือเป็น switch/checkbox/radio จะได้:

```json
{"ok":true,"ui":{"outcome":"awaiting_local_review","approval_id":"...","preview":{"account":"...","target":{},"action":{},"context":"..."}}}
```

ผู้ใช้ตรวจบัญชี เป้าหมาย ค่าที่กรอกและข้อความบริบทใน popup แล้วกดอนุมัติครั้งเดียว บอทส่งคำสั่งเดิมพร้อม `approval_id` กลับมาใน 2 นาที หากหน้า/บริบท/เป้าหมายเปลี่ยน การอนุมัติใช้ไม่ได้ ปุ่มอนุมัติไม่ได้ execute คำสั่งเอง และไม่มีคำสั่งอนุมัติใน Backend contract

การจำแนกนี้อาศัย label/role เท่านั้น ฟอร์ม autosave หรือ handler ของปุ่มทั่วไปอาจเปลี่ยนข้อมูลจริงได้ จึงเปิด write session เฉพาะงานที่ต้องการเปลี่ยน และตรวจผลจากหน้า Meta เอง เวอร์ชันนี้ไม่มีตัวรับรองเพดานงบระดับบัญชี ไม่มี workflow ยิงแอดสำเร็จรูปที่ทดสอบกับบัญชีจริง และไม่มีข้อสรุปว่าแอดเริ่มส่งจากการกด Publish อย่างเดียว

### ความคงทนและการหยุด

คิวเป็น FIFO ต่อ Device ID ใช้หนึ่ง Extension ต่อ Device ID บันทึก dispatch marker ก่อน execute หาก worker ปิดกลางทางจะรายงาน interrupted แทน replay คำสั่งเดิม ให้ inspect ตรวจผลก่อนส่งใหม่

ปิดรับคำสั่งและพักงานจาก popup จะปิดทั้ง bridge, write session และงานอ่านตาราง คิวที่ยัง pending จะค้างอยู่ ควรตรวจคิวก่อนเปิดใหม่ คำสั่งที่เริ่มไปแล้วอาจทำงานจนจบ

## งานเก็บตารางเดิม

```json
{"command":"start","levels":["campaigns","adsets","ads"],"maxSteps":5}
```

`pause`, `resume`, `status` ยังใช้ได้ ต้องพักงานเก็บตารางก่อนใช้ `ui.*` เพื่อไม่ให้ตัวนำทางสองระบบแย่งแท็บ Job `needs_review` หมายถึงจบเส้นทางหรือถึงเพดานรอบ ไม่หมายถึงข้อมูลครบบัญชี Snapshots อาจทับซ้อนกันและไม่ถูกรวม spend เป็น normalized insights

## นำเข้าและส่งออกข้อมูล

`POST /imports/validate`, `POST /imports`, `GET /imports?account_id=...`, `GET /export?account_id=...` ยังใช้ตาม README สำหรับ CSV → validation → PostgreSQL ข้อมูล DOM ดิบอยู่ใน command receipts และ device state รวมถึง Chrome Storage ไม่ถูกแปลงเป็น daily insights โดยเดาเงื่อนไขรายงาน

## คำสั่งข้อมูลวิเคราะห์ 0.4.0

`{"command":"report.prepare","goal":"messages"}` ตั้งเฉพาะคอลัมน์รายงานใน dialog ที่ตรวจชื่อได้; goal เลือก `messages`, `sales`, `leads` ขณะไม่มีงานอ่านตารางรันอยู่ ผล `ui.report` ระบุ selected, missing, missing_required, applied

`{"command":"start","levels":["ads"],"maxSteps":5,"scan_columns":true}` อ่านแถวและเลื่อนคอลัมน์ที่เปิดอยู่แบบจำกัด ผลเป็น raw observations ไม่ใช่ normalized Insights

CLI: `npm run bot -- DEVICE_UUID prepare sales` และ `npm run bot -- DEVICE_UUID collect ads`

รายละเอียด schema/การตรวจ/การส่งออก: [ANALYSIS.md](ANALYSIS.md)
