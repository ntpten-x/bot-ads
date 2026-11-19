# Meta Workspace

Chrome Extension สำหรับอ่านข้อมูลและควบคุม Meta Business Suite / Ads Manager ผ่านหน้าเว็บ + Backend รับคำสั่งบอทในเครื่อง + PostgreSQL

**สถานะ:** source/build Extension 0.6.73 รองรับ one-click `report.collect` พร้อม fast refresh, receipt แยก command/collection, job-level materialization, paged export, daily trend aggregation, CSV และรายงาน Ads แบบ manual-first ระบบยืนยัน coverage ได้เฉพาะ scope ที่มีหลักฐานครบ ไม่ได้แปลว่าครบทั้งบัญชีหรือมีการสร้าง/เผยแพร่โฆษณาจริง

**สำหรับ AI ที่ทำงานต่อ:** เริ่มอ่าน [AGENTS.md](AGENTS.md) และ [คู่มือส่งต่องานและรูปแบบการพัฒนา](docs/AI_HANDOFF.md) ซึ่งรวมโครงสร้างระบบ วิธีรัน ข้อกำหนดข้อมูล วิธีทดสอบ และงานค้าง

**ใช้ Extension เท่านั้นในการติดต่อหน้า Meta** ไม่มี Meta Marketing API, Graph API, Meta token หรือการเรียก endpoint ภายในจากโค้ดเรา หน้า Meta จะทำคำขอของตัวเองตามปกติเมื่อถูกคลิก Backend API ในโปรเจกต์นี้เป็นช่องทางรับคำสั่งและเก็บข้อมูลของเราเอง

## การควบคุมหน้าเว็บ

- บอท inspect หน้า รับข้อความและปุ่ม/ช่องกรอกพร้อมรหัสเป้าหมายชั่วคราว
- สั่ง click, fill, select, check, press, scroll และ upload ผ่าน DOM ใน isolated world ของ Extension
- หลังแต่ละคำสั่งอ่านหน้าซ้ำเพื่อยืนยันผล รหัสเก่าใช้ต่อไม่ได้
- เปิดโหมดควบคุมจาก popup เมื่อต้องเปลี่ยนข้อมูล จำกัด session 15 นาที / 100 คำสั่ง เริ่มต้นไม่อนุญาตเปลี่ยนข้อมูล
- การแก้ฟอร์มอาจบันทึกจริงทันที ขึ้นกับ Meta ไม่ใช่ sandbox หรือโหมดสร้าง Paused อัตโนมัติ
- ปุ่มที่ระบุว่าเผยแพร่/บันทึก/ยืนยัน/ลบ หรือ switch/checkbox ต้องอนุมัติคำสั่งครั้งเดียวจาก popup ก่อน บอทอนุมัติเองผ่าน Backend ไม่ได้
- การจำแนกปุ่มอาศัย label/role ที่อ่านได้ ไม่ใช่หลักประกันว่าจะตรวจจับทุก mutation ได้ จึงควรใช้โหมดควบคุมกับงานและบัญชีที่ตั้งใจแก้ไขเท่านั้น
- Business Suite ที่ URL ไม่มี `act` อ่านและนำทางได้ แต่การแก้ไขต้องอยู่บนหน้า Ads Manager ที่มี `act` ตรงบัญชีที่ผูกไว้
- ยังไม่มี AI เลือกขั้นตอนในโปรเจกต์นี้ บอทภายนอกต้องใช้วงจร inspect → เลือก action → ตรวจผล หรือเขียน workflow หลังทดสอบหน้าจริง

รายละเอียดและตัวอย่างคำสั่งอยู่ใน [Bot API](docs/BOT.md)

## Frontend Next.js (พอร์ต 9321)

เปิด Backend ตามคำสั่งด้านล่าง แล้วเปิด CMD อีกหน้าที่ `C:\BF`:

```bat
npm run dev:web
```

เปิด **http://localhost:9321** และกรอก `API_TOKEN` จาก `.env` มีหน้าภาพรวม บัญชีและสุขภาพ สตูดิโอรายงาน Ads ควบคุม Meta นำเข้า CSV ดูข้อมูล/ส่งออก ประวัติคำสั่ง และตั้งค่า

สตูดิโอรายงานที่ `/#reports` แสดง KPI, กราฟเปรียบเทียบ, scatter, histogram, องค์ประกอบตามสถานะ, เส้นสะสม, แนวโน้มรายวัน ตาราง และการตรวจเทียบ CSV-vs-DOM ปุ่ม **ดึงข้อมูล Ads ใหม่** ใช้ workflow เดียวสำหรับเปิดหน้า ตั้งคอลัมน์ และเริ่มอ่าน พร้อมบันทึกเป้าหมาย CPA/ROAS ต่อบัญชีเพื่อแสดงเส้นอ้างอิง

หน้า `/#optimization` เป็น Optimization Loop สำหรับสร้างข้อเสนอจาก Ads scope ที่ coverage complete, ตรวจ Evidence/Confidence/Risk, ตั้ง Policy, สร้างแผนอนุมัติ, บันทึก Experiment, Creative metadata, Campaign template, Rollback/Receipt และติดตามผลจาก Capture ล่าสุด. Action mutation ยังปิดอยู่จนกว่าจะมี certified Extension adapter และ local approval รายละเอียดที่ [OPTIMIZATION.md](docs/OPTIMIZATION.md)

ระบบแยกข้อมูล Ads เป็น catalog, daily/monthly performance, creative versions
และ raw capture ตามอายุ โดย raw snapshot ที่ยังไม่ผ่าน review จะไม่ถูกลบ
อัตโนมัติ ตรวจแผนด้วย `npm run data:lifecycle` และอ่านรายละเอียดที่
[DATA_LIFECYCLE.md](docs/DATA_LIFECYCLE.md)

หน้า `/#accounts` ใช้จัดการ Customer/Account mapping, Account-level access ต่อ Client Token, ตรวจ acceptance, เปิด/ปิด Customer หรือบัญชี, กำหนดการอ่าน Ads อัตโนมัติแบบ read-only, เพิกถอน client token และดู audit trail. Token ใหม่เลือกได้ว่าจะเห็นทุกบัญชีใน Customer หรือเฉพาะบาง Account; แม้เป็น `admin` ของ Customer ก็เห็นเฉพาะ Customer ของตน และ `viewer` เป็น read-only. Extension หนึ่ง Device ยังผูกทีละบัญชี จึงต้องใช้หลาย Device/Chrome Profile เมื่อต้องเก็บหลายบัญชีพร้อมกัน

หากเพิ่งอัปเดตเวอร์ชัน ให้รัน `npm ci` และ `npm run build` ใน CMD ก่อน แล้วรีสตาร์ต Backend และ Reload Extension เพื่อใช้ dashboard endpoints และสถานะอนุมัติรุ่นใหม่

ดู [คู่มือ Frontend และวิธีรันบน Windows](docs/FRONTEND.md)

## เริ่มใช้งาน

ต้องมี Node.js 22+ และ Docker Compose

### Windows CMD (C:\BF)

หากใช้ CMD ให้ติดตั้ง dependencies ด้วย npm ฝั่ง Windows ในโฟลเดอร์นี้ก่อน:

```bat
cd /d C:\BF
npm ci
```

จากนั้นใช้คำสั่ง Docker, migrate, build และ dev:api ด้านล่างได้ตามปกติ หากมี `.env` อยู่แล้วไม่ต้องคัดลอกทับ

อย่าสลับใช้ `node_modules` ชุดเดียวกันระหว่าง Windows กับ WSL โดยไม่ติดตั้งใหม่ ตัวเรียกคำสั่งและ esbuild ต่างแพลตฟอร์มกัน อาการ `tsx is not recognized` หลังติดตั้งจาก WSL แก้โดยรัน `npm ci` ใน CMD

### ติดตั้งครั้งแรก / WSL


```bash
npm ci
cp .env.example .env
```

เปลี่ยน `API_TOKEN` ใน `.env` เป็นค่าลับแบบสุ่มอย่างน้อย 32 ตัวอักษร ใช้คำสั่งนี้เพื่อสร้างค่าได้:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

```bash
docker compose up -d
npm run db:migrate
npm run db:backup
npm run build
npm run dev:api
```

API ฟังเฉพาะ `127.0.0.1:4318` ในเครื่อง ไม่ได้เปิดให้เครือข่ายภายนอก หากรันผ่าน WSL ให้ตรวจว่า Chrome บน Windows เข้าถึง localhost forwarding ได้

ติดตั้ง Extension ที่ `chrome://extensions` → Developer mode → Load unpacked → เลือก `C:\BF\dist\extension` (บน Linux ใช้ `/mnt/c/BF/dist/extension`)

## การใช้งาน

1. เปิดหน้า Ads Manager ที่มี `act=AccountID` แล้วกดตรวจบัญชีใน Extension
2. เลือก Campaign / Ad Sets / Ads แล้วกดเริ่มเก็บอัตโนมัติ หรืออ่านหน้าปัจจุบัน
3. หากให้บอทสั่งงาน: ใส่ API token แล้วเชื่อมต่อและทดสอบอ่าน คัดลอก Device ID ไปใช้ตาม [Bot API](docs/BOT.md)
4. นำเข้า CSV จาก Meta หลังจัดชื่อคอลัมน์ตาม [ไฟล์ตัวอย่าง](samples/meta-report.csv) ระบุ timezone, attribution และชนิดผลลัพธ์ให้ตรงรายงาน
5. กรอกจำนวนแถวและ spend รวมจากต้นทางเพื่อตรวจเทียบ กดตรวจสอบไฟล์ แล้วบันทึกลง Database หรือส่งออก JSON / CSV

ใช้ตัวอย่างด้วยบัญชี `123456789`, timezone `Asia/Bangkok`, attribution `7-day click`, result type `leads`, จำนวนแถว `2`, spend `200` ตัวอย่างเป็นข้อมูลจำลองทั้งหมด

## รูปแบบ CSV

บังคับ: `account_id`, `campaign_id`, `campaign_name`, `date_start`, `date_end`, `currency`, `spend`, `impressions`

- ระดับ Ad Set เพิ่ม `ad_set_id`; ระดับ Ads เพิ่มทั้ง `ad_set_id` และ `ad_id`
- ID เป็นข้อความตัวเลข ห้ามให้ Excel แปลงเป็น scientific notation; วันที่ `YYYY-MM-DD`
- หนึ่งไฟล์ใช้ reporting level และชุดมิติ breakdown เดียวกัน ไม่รวมแถวสรุป
- ตัวเลขใช้จุดทศนิยม ไม่มี comma คั่นหลักพัน ไม่มีสัญลักษณ์สกุลเงินหรือ `%`
- `currency` เป็นรหัสสามตัวอักษร เช่น `THB`; timezone ต้องเป็น IANA timezone
- `timezone`, `attribution`, `result_type` ระบุในแต่ละแถวได้ หรือใช้ค่าจากฟอร์ม อย่าเดา attribution จากชื่อบัญชี
- ไม่เติม 0 ให้ metrics ที่ไม่มี: ช่องว่างคือไม่มีข้อมูล
- เพิ่ม `reach`, `results`, `link_clicks`, `purchase_value` ได้
- metrics เพิ่มเติม: `ctr`, `cpc`, `cpm`, `frequency`, `cost_per_result`, `messaging_conversations`, `leads`, `purchases`, `roas` (CTR ใช้หน่วยเปอร์เซ็นต์ตามต้นทาง; ไม่คำนวณใหม่)
- Creative: `creative_body`, `creative_headline`, `creative_description`, `creative_cta`, `creative_destination_url`, `creative_type`
- Breakdown: `age`, `gender`, `country`, `region`, `publisher_platform`, `platform_position`, `impression_device`, `device_platform`, `placement`, `device`
- ชื่อคอลัมน์ภาษาอังกฤษบางส่วน เช่น `Campaign ID`, `Reporting starts`, `Amount spent (THB)` รองรับโดยตรง ภาษาไทยและชื่ออื่นต้องเปลี่ยนเป็น canonical headers ก่อน รุ่นนี้ยังไม่มี mapping UI
- ข้อมูลอื่น เช่น budget, targeting, schedule และอ้างอิงสื่อ เก็บไว้ใน `raw` ตามที่มีในไฟล์ ยังไม่มีตัวอ่านรายละเอียดเฉพาะฟิลด์เหล่านี้

## การจัดเก็บ

ตาราง entity แยกตาม Campaign → Ad Set → Ad → Creative โดย key ประกอบ account ID เสมอ. Local `API_TOKEN` เป็น bootstrap admin; client token ถูกจำกัดด้วย customer ownership และ role ที่ Backend ทุก request. Token เก็บเฉพาะ SHA-256 hash และเพิกถอนได้ทันที

`insight_observations` เก็บทั้ง daily และ period aggregates; view `insights_daily` เลือกเฉพาะวันเดียวและไม่มี breakdown เท่านั้น ช่วงรายงานที่ทับซ้อนกันยังเป็นคนละ observation ผู้ใช้ข้อมูลต้องเลือก grain ให้ตรงก่อนรวมยอด

กุญแจ UPSERT รวม account, level, entity, date interval, currency, timezone, attribution, result type และ breakdown dimensions ประวัติข้อมูลแต่ละ import อยู่ใน `insight_import_history` พร้อม job, ชื่อไฟล์ และ SHA-256 ไม่เก็บไฟล์ต้นฉบับทั้งไฟล์ในฐานข้อมูล

DOM snapshots ทุกชุดที่ Extension ส่งมาถูกบันทึกเป็นข้อมูลดิบใน PostgreSQL (`capture_jobs`, `capture_snapshots`, `capture_rows` จาก migration `003_dom_captures`) แถวที่ยืนยัน stable ID, parent IDs, ช่วงวันที่, สกุลเงิน, เขตเวลา, Attribution, result type, การจับคู่คอลัมน์ และ spend/impressions ครบเท่านั้นที่ถูกยกเป็น normalized insights อัตโนมัติ แถวอื่นอยู่ในสถานะ `needs_review` พร้อมเหตุผล ดูได้ที่หน้า **ข้อมูลจาก Extension** และ [docs/ANALYSIS.md](docs/ANALYSIS.md) การนำเข้า CSV ยังใช้ได้เหมือนเดิม

## ตรวจสอบ

```bash
npm run check
npm run test:api
npm run test:captures
npm run check:live-report
npm run test:accounts-web
npm run test:optimization-web
npm run test:simple-mode
npm run check:accounts-load
npm run test:reader
npx playwright install chromium
npm run test:browser
npm run test:ui
```

Integration tests ต้องเปิด PostgreSQL, migrate และ API ก่อน โดยอ่าน `.env` ชุดเดียวกัน ทั้งสองชุดเพิ่มข้อมูลจำลองในฐานข้อมูล ควรใช้ฐานทดสอบแยกเมื่อนำไปใช้จริง

`npm run db:backup` สร้างไฟล์ PostgreSQL custom dump ใน `backups/` ซึ่งถูก ignore จาก Git. การ restore ต้องระบุไฟล์และยืนยันชัดเจน:

```bash
DB_RESTORE_CONFIRM=restore-local-database npm run db:restore -- backups/FILE.dump
```

Restore เป็น destructive operation และควรทดสอบบนฐานสำรองก่อนใช้กับข้อมูลจริง

Browser test ใช้ Chrome Extension จริงกับหน้า Ads Manager จำลอง ไม่ติดต่อ Meta และ pregrant host permission ในสำเนา extension สำหรับทดสอบเท่านั้น ภาพ UI จากการทดสอบเก็บไว้ใน `docs/screenshots/` เฉพาะเครื่องที่รันทดสอบ และไม่รวมใน Git

## ขอบเขตและแผนต่อ

ดู [แผนระบบและช่องว่างที่ยังต้องทำ](docs/PLAN.md) และ [วิธีสั่งงานบอท](docs/BOT.md)

บอทใช้ตัวควบคุม DOM เพื่อเลือกช่วงวันที่ columns รายละเอียด Creative หรือฟอร์มสร้างแอดได้เมื่อหน้าเปิดเผยองค์ประกอบเหล่านั้น แต่ยังไม่มี workflow ที่ยืนยันกับหน้า Meta จริง การอัปโหลดผ่าน file input รองรับ PNG/JPEG/WebP/MP4 สูงสุด 5 MB และยังไม่รองรับ native file dialogs, iframe และ trusted keyboard shortcuts การคลิกสำเร็จไม่เท่ากับ Meta อนุมัติหรือแอดเริ่มส่งแล้ว ไม่มีการเรียก internal endpoint ดึง cookie หรือหลบระบบตรวจจับ

การใช้ `activeTab` และ `scripting` อิง [เอกสาร Chrome](https://developer.chrome.com/docs/extensions/reference/api/scripting) และการอนุญาตเข้าถึงหน้า Meta ต่อเนื่องเป็น optional host permission ที่ผู้ใช้เปิดจาก Extension

## ข้อมูลสำหรับวิเคราะห์ (0.4.0)

เปิด http://127.0.0.1:9321/#analysis เพื่อเลือกเป้าหมาย ตั้งคอลัมน์ Meta อ่านตาราง ตรวจค่าที่ขาด และส่งออกชุดวิเคราะห์ JSON/CSV รองรับยอดใช้จ่าย คอนเวอร์ชั่นข้อความ/ซื้อ/ลูกค้าเป้าหมาย มูลค่าการซื้อ และอัตราคำนวณ โดยไม่รวมช่วงเวลา/Attribution ที่ต่างกัน อ่านวิธีใช้งานและข้อจำกัดที่ [docs/ANALYSIS.md](docs/ANALYSIS.md)

CSV ที่กระทบยอดจำนวนแถวและ Spend กับต้นทางแล้วเป็นแหล่งยอดหลัก ส่วน DOM เป็นหลักฐานเสริมแบบ lower bound ระบบแยกชุดตามแหล่งและไม่บวกยอดข้าม CSV/DOM; การกระทบยอดไฟล์ไม่ได้แปลว่าครบทั้งบัญชี

หลังอัปเดตให้ Restart Backend/หน้าเว็บ และ Reload Extension 0.4.0 แล้วเชื่อมต่อใหม่ CSV มี column mapping ไทย/อังกฤษและตัวเลือกรูปแบบตัวเลข ส่วน DOM captures เป็นหลักฐานตรวจทาน ไม่ถูกนำเข้าเป็น Insights โดยอัตโนมัติ

### เมาส์/คีย์บอร์ดรายงาน 0.5.0

รุ่นล่าสุดเพิ่มสิทธิ์ Chrome `debugger` เพื่อส่งเมาส์และคีย์บอร์ดสำหรับหน้ารายงาน หลัง Reload/เชื่อมต่อ ให้กด **เปิดเมาส์/คีย์บอร์ดรายงาน 15 นาที** ใน popup ก่อนตั้งคอลัมน์ Chrome จะแสดงแถบ debugger ระหว่างคำสั่งและถอดเมื่อจบ โหมดนี้ผูกบัญชี/แท็บและเปิดจาก popup เท่านั้น ไม่มี API ให้บอทเปิดสิทธิ์เอง ดู [การใช้งานและขอบเขตสิทธิ์](docs/ANALYSIS.md)

### อัปเดตเป็น 0.6.0

1. `npm run db:migrate` (เพิ่ม `003_dom_captures`) แล้ว `npm run build`
2. Restart Backend (`npm run dev:api`) — หน้าเว็บ Next.js ไม่ต้อง restart ถ้ารัน `dev:web` อยู่
3. เปิด `chrome://extensions` กด Reload ที่ Extension ให้เป็น 0.6.0 เปิด popup ใส่ Backend token และกดเชื่อมต่อใหม่บนแท็บ Ads Manager ที่มี `act=ACCOUNT_ID`
4. เริ่มงานอ่าน แล้วดูผลที่หน้า **ข้อมูลจาก Extension** (http://localhost:9321)
