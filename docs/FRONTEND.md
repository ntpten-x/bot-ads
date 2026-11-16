# Next.js Frontend

Frontend ใช้ Next.js App Router + React + TypeScript และรันที่ **http://localhost:9321** ตามที่กำหนด Backend เป็น Express ในเครื่องที่พอร์ต 4318 และ PostgreSQL ตามเดิม

## เปิดใช้งานบน Windows CMD

ติดตั้ง dependencies จากโฟลเดอร์หลัก (ถ้ายังไม่ได้ติดตั้งหลังอัปเดต):

```bat
cd /d C:\BF
npm ci
npm run build
```

Terminal แรก:

```bat
cd /d C:\BF
docker compose up -d
npm run db:migrate
npm run dev:api
```

Terminal ที่สอง:

```bat
cd /d C:\BF
npm run dev:web
```

เปิด **http://localhost:9321** แล้วกรอก `API_TOKEN` จาก `.env` รหัสจะอยู่เฉพาะ session ของแท็บ ไม่ฝังใน frontend bundle และไม่ใช่ Meta access token

สำหรับ production build ในเครื่อง:

```bat
npm run build:web
npm run start:web
```

ทั้ง `dev:web` และ `start:web` ใช้พอร์ต 9321 ห้ามเปิดสองโหมดบนพอร์ตเดียวกันพร้อมกัน

## เมนูที่ใช้งานได้

- **ภาพรวม:** สถานะ Backend/Database, Extension heartbeat, จำนวน Campaign / Ad Set / Ad / observations ในฐานข้อมูล และจำนวนการนำเข้าของบัญชีที่เลือก
- **ควบคุมหน้า Meta:** สั่ง inspect, focus, screenshot, เลือกองค์ประกอบ, click, fill, select, check, press, upload, navigate, scroll และ start/pause/resume งานอ่านตาราง
- **นำเข้ารายงาน:** เลือกหรือลาก CSV, กรอก timezone/attribution/result type, ตรวจเทียบจำนวนแถวและ spend, ตรวจ backend ซ้ำ, บันทึก DB, ดูประวัติและดาวน์โหลดผลตรวจ
- **ข้อมูลและส่งออก:** ค้นหา, กรองระดับและช่วงวันที่, แบ่งหน้า, ดู record/raw และส่งออกข้อมูลที่กรองเป็น JSON/CSV
- **ประวัติคำสั่ง:** รอทำงาน/ทำงานแล้ว/ผิดพลาด, ผลลัพธ์และรายละเอียดคำสั่ง
- **ตั้งค่าและวิธีใช้:** วิธีเชื่อมต่อ, เพิ่ม Device ID เอง, ตรวจสุขภาพระบบ, ส่งออกข้อมูลการเชื่อมต่อโดยไม่มี token, ออกจากระบบ

## การเชื่อมต่อ Extension

หลังอัปเดตให้ Reload Extension จาก `C:\BF\dist\extension` เพื่อให้ส่งสถานะ control lease และการอนุมัติกลับมายังหน้าเว็บ

เปิด Ads Manager → popup Extension → กรอก Account ID และ token Backend → เชื่อมต่อและทดสอบอ่าน แล้วเลือกอุปกรณ์ในหน้าเว็บ หากต้องเปลี่ยนข้อมูล เปิดโหมดควบคุมใน popup ก่อน (15 นาที / 100 คำสั่ง)

คำสั่งเผยแพร่/บันทึก/ยืนยันที่ตรวจพบยังต้องอนุมัติจาก popup หน้าเว็บแสดงสถานะและปุ่มส่งคำสั่งเดิมหลังอนุมัติเท่านั้น ไม่สามารถอนุมัติแทนผู้ใช้ผ่าน Backend

## สถาปัตยกรรม

```text
Browser → Next.js :9321 → /api/* proxy → Express :4318 → PostgreSQL
                                              ↓
                                         command queue
                                              ↓
                                        Chrome Extension
                                              ↓
                                       Meta visible web UI
```

ไม่มี Meta API integration ส่วน `/api/*` ใน Next เป็น proxy ไป Backend ของเราในเครื่อง ส่ง Authorization เดิมไปตรวจที่ Express ไม่มีการอ่าน `.env` ฝั่ง client

`BACKEND_URL` เป็น optional configuration ฝั่ง Next สำหรับเปลี่ยนปลายทางทดสอบ ค่าเริ่มต้น `http://127.0.0.1:4318` อนุญาตเฉพาะ localhost HTTP เมื่อเปลี่ยนต้องเริ่ม frontend ใหม่ (และ build ใหม่ถ้าใช้ production)

## หลักการแสดงข้อมูล

ไม่รวม Spend จาก observation คนละช่วง/ระดับ/attribution/breakdown ไม่เติม zero ให้ metric ที่ไม่มี และไม่แสดงว่าครบทั้งบัญชีจากจำนวน records ที่เก็บได้

Device status เก่ากว่า 90 วินาทีจะแสดงว่ายังไม่ยืนยันการเชื่อมต่อ คำสั่ง pending หมายถึงรอ Extension ซึ่งตรวจคิวประมาณทุก 30 วินาที ไม่ใช่ทำบน Meta สำเร็จแล้ว

## ทดสอบ

```bat
npm run typecheck:web
npm run build:web
npm run test:web
```

Browser test ใช้ Chrome บน Windows หรือ Chromium ของ Playwright บน Linux และต้องเปิด Next + Backend + Database ก่อน Test เพิ่มข้อมูลจำลองใน DB และเลียนแบบผลจาก Extension เพื่อทดสอบหน้าเว็บ ไม่กดโฆษณาจริงบน Meta

## เชื่อมต่อแบบไม่ต้องหา Device ID (Extension 0.3.1)

Reload Extension แล้วเปิด Ads Manager ของบัญชีที่ต้องการ กดตรวจบัญชี (หากช่องบัญชีว่าง ระบบจะใช้ act จากแท็บตอนเชื่อมต่อ) กรอกรหัส Backend และกด “เชื่อมต่อและทดสอบอ่าน” ระบบตรวจ Backend และลงทะเบียนอุปกรณ์ทันที อ่านเฉพาะหน้าเว็บหนึ่งครั้ง และส่งผลให้หน้าเว็บค้นพบอัตโนมัติ ไม่ต้องส่ง Device ID ให้ผู้ช่วย

Device ID ยังแสดงเป็นช่องอ่านอย่างเดียวด้านบนพร้อมปุ่มคัดลอก แม้ยังไม่ได้เชื่อมต่อ โดยแยกจากรหัส Backend อย่างชัดเจน ข้อผิดพลาดการเชื่อมต่อแสดงใกล้ปุ่มแทนการซ่อนท้าย popup

เปิดบัญชีที่กำหนดโดยตรงได้ เช่น `http://localhost:9321/?account=ACCOUNT_ID#control` หน้าเว็บจะเลือกเฉพาะอุปกรณ์ออนไลน์ที่ตรงบัญชีนี้ ไม่เลือกข้อมูลทดสอบเก่าที่ไม่มี heartbeat ใหม่

## เมนูข้อมูลวิเคราะห์ 0.4.0

เปิด `/#analysis` เลือกเป้าหมายข้อความ/ยอดขาย/ลูกค้าเป้าหมาย ตั้งคอลัมน์ Meta อ่านตารางผ่าน Extension 0.4.0 หรือใช้ CSV ที่มี IDs/เงื่อนไขรายงานครบ หน้าแสดงค่าที่ขาดแทนการเติม 0 และแยกค่าคำนวณจากค่าต้นทาง ส่งออก JSON พร้อมคุณภาพข้อมูล หรือ CSV ของชุดรายงานที่เทียบกันได้

ฟอร์มนำเข้าเพิ่ม column mapping ไทย/อังกฤษ ตัวเลือกเก็บเฉพาะ raw และ grouped-dot number format ดูขั้นตอนครบที่ [ANALYSIS.md](ANALYSIS.md)
