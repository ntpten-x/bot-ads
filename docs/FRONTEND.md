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

ค่าเริ่มต้นเป็นโหมดง่ายสำหรับผู้ใช้ทั่วไป:

- **เริ่มต้น:** แสดงเพียง “งานถัดไป” และความคืบหน้า 4 ขั้น
- **ดูผลโฆษณา:** เปิด Report Studio
- **สิ่งที่ควรทำ:** เปิดข้อเสนอและแผน
- **บัญชีที่เชื่อมต่อ:** เพิ่มหรือตรวจบัญชีและ Extension
- **ช่วยเหลือ:** ขั้นตอนเชื่อมต่อและตั้งค่า

เครื่องมือสำหรับผู้ดูแล ได้แก่ ควบคุมหน้า Meta, นำเข้า CSV, ข้อมูลวิเคราะห์,
ข้อมูล/ส่งออก, raw captures และประวัติคำสั่ง จะอยู่ใน **เครื่องมือขั้นสูง**
ซึ่งเปิดและปิดได้จาก sidebar การตั้งค่าจะถูกจำใน
`localStorage.collectorAdvancedMode`

หน้าเริ่มต้นใช้รูปแบบ “งานถัดไปชัดเจน”: ระบบเลือก action ที่ควรทำเพียงรายการเดียว
จากการเชื่อมต่อ, จำนวน Ads, ข้อเสนอใหม่ และแผนที่รออนุมัติ จากนั้นจึงแสดงทางลัด
สำหรับงานหลักและซ่อนรายละเอียดระบบไว้ใน disclosure

หน้า **ข้อมูลและส่งออก** แสดง Data Lifecycle Policy, จำนวน Ads Catalog,
Daily retention, Raw Capture และ Monthly rollups. ปุ่ม “ตรวจแผนลบข้อมูล”
เรียก dry-run เท่านั้น; การ apply จริงทำผ่าน CLI หลังตรวจผลและ backup

หน้า **สิ่งที่ควรทำ** มีปุ่ม “เปิดเครื่องมือแก้ Ads (Manual)” ให้เห็นในโหมดง่าย
เพื่อไปยัง Control Meta โดยยังต้องเปิด write session ใน popup Extension และ
ผ่าน Local Approval สำหรับ action สำคัญ; ปุ่มนี้ไม่เปิด autonomous mutation

- **ภาพรวม:** สถานะ Backend/Database, Extension heartbeat, จำนวน Campaign / Ad Set / Ad / observations ในฐานข้อมูล และจำนวนการนำเข้าของบัญชีที่เลือก
- **บัญชีและสุขภาพ:** แสดง Customer, Account, Device heartbeat, coverage, normalized Ads ของงานล่าสุด, target configuration, acceptance และกำหนดการอ่านอัตโนมัติ พร้อมเปิด/ปิด Customer/บัญชี, เพิกถอน token และดู audit trail
- **สตูดิโอรายงาน:** เลือกงานอ่าน Ads และ reporting scope เพื่อดูกราฟแท่ง ตาราง สถานะการนำส่ง และ coverage โดยไม่ให้ระบบตัดสินแทนผู้ใช้
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

## สตูดิโอรายงาน Ads

เปิด `/#reports` หลังเลือกบัญชีและงานอ่าน Ads หน้าแสดง KPI ribbon พร้อมกราฟ 6 มุมมองและตารางที่กรอง/เรียงลำดับได้ ผู้ใช้เลือกเองว่าค่าใดสำคัญต่อธุรกิจ หน้านี้ไม่มีคะแนนประสิทธิภาพหรือคำแนะนำอัตโนมัติ

| มุมมอง | ตอบคำถาม | ข้อมูลที่ต้องมี |
| --- | --- | --- |
| เปรียบเทียบ | Ads ใดมี Spend, Results, Impressions, Cost/result หรือ CPM มาก/น้อยกว่ากัน | ตัวชี้วัดที่เลือก |
| ความสัมพันธ์ | Spend/Impressions กับ Results/Cost เปลี่ยนไปพร้อมกันหรือไม่ | ค่าครบทั้งสองแกน |
| การกระจาย | ต้นทุนหรือผลลัพธ์กระจุกตัว มี outlier หรือไม่ | ค่าตัวเลขที่อ่านได้อย่างน้อยหนึ่งค่า |
| องค์ประกอบ | Spend, Results หรือจำนวน Ads กระจายตามสถานะอย่างไร | สถานะและตัวชี้วัดฐาน |
| เส้นสะสม | Spend กระจุกใน Ads ไม่กี่รายการหรือกระจายทั่วชุด | Spend และ Results ใน Ads เดียวกัน |
| แนวโน้ม | ค่าเปลี่ยนอย่างไรตามวัน | daily observations ที่ source/เงื่อนไขเข้ากันอย่างน้อยสองวัน |

- เลือก Ads capture job ย้อนหลังและ scope แยกตาม Breakdown ได้ โดยไม่บวกยอดข้าม scope หรือข้ามแหล่งข้อมูล
- ค่า unknown ยังเป็น `—` และไม่ถูกแทนด้วย 0; Spend ที่ประมาณจาก Results × Cost per result ติดป้ายในตาราง
- แถวที่ไม่มี stable ID แสดงเป็น observation ที่มนุษย์ตรวจได้ แต่ไม่ถูกนับเป็น Ads ที่ยืนยันแล้ว
- Coverage `complete` หมายถึงจำนวน ID และคอลัมน์ตรงกับ scope ของรายงานนั้น ไม่ได้ยืนยันทั้งบัญชี Meta
- ปุ่ม **ดึงข้อมูล Ads ใหม่** ใช้ `report.collect` เดียวเพื่อ Navigate → Prepare columns → Start collection ภายใต้ heartbeat/account/tab/report-input lease เดิม
- Fast refresh ตรวจ rendered headers ก่อน; หาก blocking columns ครบและไม่มี extra columns จะข้าม column dialog และเริ่มอ่านทันที
- เมื่อ Capture เสร็จ ให้ยืนยัน timezone/Attribution/result type/no-filter/no-Breakdown แล้วกด **บันทึกเป็นข้อมูลวิเคราะห์** ระบบจะ review ทุก snapshot ของ job และ materialize เฉพาะแถวที่ครบ; Ads row อ่านชื่อ Campaign/Ad Set จากคอลัมน์ที่เลือกได้
- ส่งออก CSV/JSON ของมุมมองที่กรองแล้วได้ โดย preserve evidence, spend source, mapping, flags และ reader version
- Cost/result และ CPM รวมใช้ผลรวม Spend หารด้วยผลรวมตัวหาร ไม่เฉลี่ยอัตราของแต่ละ Ads
- Scatter และ histogram แสดงเฉพาะจุดที่มีค่าครบ; กราฟเส้นรายวันไม่เชื่อมข้ามวันที่หายและไม่ผสม CSV/DOM source
- Insight panel บอกเฉพาะข้อจำกัดเชิงข้อมูล เช่น missing axis, mixed result type หรือ coverage; ไม่แปลงข้อจำกัดเป็นคำแนะนำธุรกิจ
- Report polling ใช้ 5 วินาทีเฉพาะขณะ command/job กำลังทำงาน และหยุดเมื่อจบ; แถวที่ไม่มี ID ไม่ถูกเปิดในกราฟเป็นค่าเริ่มต้น
- ผล Report ที่ตรวจด้วย operator context แล้วถูก cache ใน PostgreSQL (`capture_job_reports`) ต่อ job/context; การเปิดรายงานครั้งถัดไปจึงไม่ต้องวิเคราะห์ raw snapshots ซ้ำ
- `/export` รองรับ level/date/source/limit/offset และคืน page metadata. `/insights/trend` aggregate รายวันฝั่ง PostgreSQL เพื่อไม่ส่ง normalized rows ทั้งหมดเข้า browser
- แผง **ตรวจเทียบ DOM กับ CSV** เปรียบเทียบเฉพาะ CSV ที่ account/date/currency/timezone/attribution/result type/breakdown ตรงกับ scope และแสดง matched IDs, IDs ที่มีเฉพาะแหล่งเดียว และ delta ของ Spend/Results
- แผง **Normalized coverage** แสดง verified Ads, normalized Ads, unique observations, promoted/raw rows และ reason ที่ยัง block; ค่าจาก API นี้ไม่แก้หรือเดาข้อมูล
- Acceptance checklist ใช้ Coverage, Normalized data, DB report cache, Business targets, Daily trend และ Extension readiness; CSV reconciliation แสดงเป็น optional validation ไม่ block readiness ของ database-first workflow

ตรวจระบบจริงแบบ read-only ด้วย `npm run check:live-report`; คำสั่งนี้เลือกบัญชีที่มี reporting context ยืนยันได้จาก Device ที่ enabled, เปิด Report Studio ด้วย Chrome headless, ตรวจกราฟหลัก, mobile overflow, report cache, coverage, normalization และ reconciliation โดยไม่แก้โฆษณา ใช้ `SMOKE_ACCOUNT`, `SMOKE_TIMEZONE` และ `SMOKE_ATTRIBUTION` เมื่อต้องเจาะจงบัญชีที่เพิ่งสลับมา
- แผง **เป้าหมายธุรกิจ** เก็บ target CPA/ROAS ต่อ account; เป้าหมายแสดงเป็นเส้นอ้างอิงในกราฟ Cost/result หรือ ROAS และไม่ถูกแปลงเป็นคำแนะนำอัตโนมัติ

การยืนยันเขตเวลา, Attribution, ไม่มีตัวกรอง และไม่มี Breakdown ใช้ค่าเดียวกับหน้า **ข้อมูลจาก Extension** และเก็บเฉพาะใน browser session/local preference ของเครื่องนี้

## หลาย Customer และหลายบัญชี

API_TOKEN ใน `.env` เป็น local admin และสามารถจัดการ Customer, Account mapping และ API client token ได้จากหน้า **บัญชีและสุขภาพ**

- Client token แสดงเพียงครั้งเดียวและเก็บเฉพาะ SHA-256 hash ใน PostgreSQL
- Token ใหม่เลือก Account-level access ได้: ทุกบัญชีใน Customer หรือเฉพาะ account_ids ที่กำหนด; token เดิมคง all_accounts=true เพื่อ compatibility
- `operator` ใช้งาน account ที่ผูกกับ Customer ของตนได้
- `admin` ของ Customer เห็นและจัดการได้เฉพาะ Customer ของตน; Customer management ทั้งระบบยังใช้ local `API_TOKEN` เท่านั้น
- `viewer` เปิดอ่านรายงานได้แต่คำสั่ง POST ทุกชนิดถูกปฏิเสธ
- Request ที่มี Account/Device/Capture job อยู่นอก Customer จะได้ `403`
- แต่ละบัญชีมี health จากงานอ่านล่าสุด ไม่ได้ใช้ผลจากบัญชีอื่นแทน
- บัญชีที่ disabled จะไม่รับ state/capture, import, command หรือ report operations ใหม่
- กำหนดการอ่านอัตโนมัติ queue เฉพาะ `report.collect` แบบอ่านอย่างเดียวเมื่อ Device สดใหม่และ open report-input lease; ไม่มี mutation หรือการอนุมัติแทนผู้ใช้
- การเพิกถอน token มีผลกับ request ถัดไปทันที; การปิด Customer/บัญชีปิด schedule ที่เกี่ยวข้องด้วยและบันทึกใน audit trail

Extension หนึ่ง Device ผูกได้ครั้งละหนึ่งบัญชี หากต้องเก็บหลายบัญชีพร้อมกันให้ใช้ Chrome Profile/Device แยกกัน

`npm run check:accounts-load` เป็น read-only load smoke สำหรับ Summary,
Optimization Workspace และ paginated Export โดยไม่แตะ Meta จริง

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

## Optimization Loop

เปิด `/#optimization` หลังมี Ads capture ที่ materialize แล้ว. ระบบใช้ cached
report scope ที่ coverage complete เท่านั้นสำหรับ Recommendation Engine และจะ
ไม่สร้างข้อเสนอเมื่อ blockers, peers หรือ verified metrics ไม่พอ.

- Recommendation ทุกรายการแสดง Ads ID, Spend, Results, Cost/result, peer median,
  confidence และ risk
- Plan มี rollback record; plan approval เป็นเพียงการอนุมัติแผน ยังไม่ใช่อนุมัติ
  ให้ Extension แก้ Meta
- Experiment Register เก็บ hypothesis, arms, metric, guardrails และสถานะ
- Creative Memory เก็บ copy metadata; Campaign Template เก็บโครง Draft
- Outcome Observation เทียบ Target Ads กับ Capture ล่าสุดและบันทึก delta
- `automated_meta_mutation=false` จนกว่าจะมี adapter ที่ผ่าน live readback

ในโหมดง่าย หน้า Optimization จะซ่อน Policy, Experiment, Creative metadata และ
Campaign template ไว้หลัง **เครื่องมือขั้นสูง** โดยยังแสดงข้อมูลล่าสุดและ
รายการ “สิ่งที่ควรทำตอนนี้” ตามปกติ

รายละเอียด contract และข้อจำกัดอยู่ที่ [OPTIMIZATION.md](OPTIMIZATION.md).
