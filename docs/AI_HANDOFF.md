# AI handoff และรูปแบบการพัฒนาระบบ

เอกสารส่งต่องาน ณ 15 พฤศจิกายน 2026 อ้างอิง Extension 0.6.2 (อัปเดตจาก 0.5.0, 0.6.0 และ 0.6.1) ให้ตรวจ source และ package scripts ทุกครั้งก่อนใช้ เพราะเวอร์ชันแต่ละ package อาจต่างกัน

## 1. เป้าหมายและขอบเขต

ระบบช่วยรวบรวมข้อมูล Meta Ads ผ่าน Chrome Extension และนำเข้ารายงาน CSV ลง PostgreSQL เพื่อเตรียมข้อมูลสำหรับวิเคราะห์ ผู้ใช้กำหนดให้ใช้ Extension ควบคุมหน้า Meta เท่านั้น ไม่ใช้ Meta API ส่วน Backend API ในโปรเจกต์นี้เป็น API ของเราเองสำหรับรับคำสั่งและเก็บข้อมูล

ผู้ใช้ต้องการให้ต่อยอดอ่านและดำเนินงานโฆษณาผ่าน UI ได้ แต่ยังไม่มีหลักฐานว่าควบคุม Business Suite ได้ทุกฟังก์ชัน หรือเผยแพร่โฆษณาสำเร็จจริง การทดสอบบัญชีจริงที่ผ่านมาเป็นงานอ่านและปรับมุมมองรายงาน ไม่ได้สร้าง ลบ เผยแพร่ หรือปรับงบโฆษณา

มี deterministic analysis/preview แล้วใน source ไม่ใช่ AI ที่ตัดสินใจยิงแอดเอง อย่าลบโมดูลนี้เพียงเพราะ roadmap รุ่นแรกเลื่อนงาน AI ไว้ภายหลัง

ข้อกำหนดถาวร:

- ไม่เพิ่ม Graph/Marketing API, Meta access token, internal endpoint, network interception หรือการหลบระบบตรวจจับ
- ไม่อ่านหรือส่งออก password, cookie, session credential ของ Meta
- ไม่ข้ามการอนุมัติใน popup หรือเพิ่ม endpoint ให้บอทอนุมัติตัวเอง
- ทำงานในเครื่องเป็นหลัก ยังไม่ใช่ระบบหลายลูกค้าที่แยกสิทธิ์แบบ multi-tenant
- ไม่กล่าวว่าเก็บครบหรือดำเนินการสำเร็จหากมีเพียง raw capture หรือ action dispatch

## 2. สถาปัตยกรรม

```text
ผู้ใช้ / บอทภายนอก
        ↓
Next.js :9321 → /api rewrite → Express :4318 → PostgreSQL :5432
                                      ↑↓ queue / state / result
                                Chrome Extension MV3
                                      ↑↓ visible UI
                             Meta Business Suite / Ads Manager

CSV → validate → quality report → transactional import / UPSERT → export / analysis preview
```

### แผนที่ source

| ตำแหน่ง | หน้าที่ |
| --- | --- |
| apps/web | Next.js, หน้าภาพรวม ควบคุม นำเข้า ข้อมูล ประวัติ และ analysis |
| apps/api/src/server.ts | Auth, imports, export, command queue, device state และ diagnostic result |
| apps/api/src/dashboard.ts | ข้อมูล dashboard, account summary, ประวัติคำสั่ง |
| apps/api/src/store.ts | Transactions, UPSERT, parent integrity, import history |
| apps/api/src/captures.ts | บันทึก DOM capture ทุก snapshot ลง PostgreSQL, ตรวจและยก (promote) แถวที่ยืนยันครบ, `/captures` endpoints |
| apps/extension/src/background.ts | Device pairing, polling, jobs, checkpoints, dispatch |
| apps/extension/src/reader.ts | อ่านตาราง/ข้อความ/บริบทและ raw row observations |
| apps/extension/src/dom-control.ts | ตรวจเป้าหมายและทำ DOM actions แบบจำกัดชนิด |
| apps/extension/src/ui-controller.ts | Account/tab guards, write lease, approval และผลหลัง action |
| apps/extension/src/report-*.ts | เตรียมคอลัมน์ ตรวจ dialog และ bounded report input |
| packages/core/src/control.ts | Shared Zod command schemas และ URL/account guards |
| packages/core/src/index.ts | CSV parsing, normalized import schema และ quality validation |
| packages/core/src/analysis.ts, metrics.ts, capture-review.ts | วิเคราะห์ตามกฎและตรวจหลักฐาน capture |
| packages/core/src/dom-capture.ts | Zod contract ของ snapshot, แปลงวันที่จากปุ่มช่วงวันที่, กฎ promote แถว DOM capture (pure, มี unit test) |
| db | SQL migrations; insights_daily เป็น view ของ observation รายวันตามเงื่อนไข |
| scripts | Build, migration, health และ CLI bot |
| tests | Unit, API integration และ browser fixtures |
| reports, dist | Local artifacts ที่ไม่ใช่ source ถาวรและไม่ควร commit |

อ่านเพิ่มเติม: [Bot contract](BOT.md), [Frontend](FRONTEND.md), [Analysis](ANALYSIS.md), [Validation ledger](VALIDATION.md), [Historical plan](PLAN.md)

## 3. Pattern การควบคุม Extension

1. ผูก device UUID กับแท็บและบัญชีที่ผู้ใช้เลือก Device ID ไม่ใช่ API_TOKEN และไม่ควรสร้างใหม่ทุกครั้งที่เชื่อมต่อ
2. Backend ตรวจ Bearer token และ schema ก่อนเก็บคำสั่ง บอทไม่ติดต่อ Meta เอง
3. Extension รับคำสั่งผ่าน queue ตรวจ host, route, account, tab และ local permission อีกครั้ง
4. Inspect เพื่อสร้าง snapshot และ target handles ชั่วคราว ใช้ handle จาก snapshot ล่าสุดเท่านั้น
5. Execute action ที่มีชนิดชัดเจน แล้ว observe หน้าซ้ำ บันทึกผลหรือ error ตามจริง
6. บันทึก checkpoint และสถานะ เพื่อหยุด/ทำต่อได้โดยไม่ยิง mutation ซ้ำแบบเดาสุ่ม

Shared command รองรับ start/pause/resume/status, ui.action, ui.navigate, ui.focus, ui.screenshot และ report.prepare อ่าน payload จริงจาก control.ts และ BOT.md ก่อนเพิ่มผู้เรียก

หลักปฏิบัติ:

- ไม่รับ arbitrary JavaScript, selector หรือ CDP command จาก Backend เพื่อไป execute ใน Meta
- การแก้ UI ต้องมี local write session ที่ผู้ใช้เปิดใน popup ปัจจุบันจำกัด 15 นาที / 100 actions และผูกบัญชี/แท็บ
- ปุ่มสำคัญตามการจำแนก เช่น save/publish/confirm/delete และ switch/checkbox ต้องผ่าน one-time popup approval ที่ตรง action และบริบท
- การจำแนกด้วย label/role ไม่ครอบคลุมทุก mutation ฟอร์ม Meta บางส่วน autosave ได้ อย่าเรียกโหมดนี้ว่า sandbox
- report input มี local lease แยกและใช้ debugger เฉพาะ mouse/key/text input ที่กำหนดใน source ไม่ใช้ debugger เพื่ออ่าน network หรือ session
- Lease หมดอายุต้องหยุดและให้ผู้ใช้เปิดใหม่ ห้ามต่ออายุเองด้วยการเขียน storage หรือ helper
- Backend รับ report-result เพื่อบันทึก diagnostic เท่านั้น ไม่ใช่ช่องทาง execute หรืออนุมัติ
- หาก action ค้าง/Chrome ปิดหลัง dispatch ให้ inspect ผลจริงก่อน retry เพราะผลของ mutation อาจไม่แน่นอน
- Synthetic event อาจถูก Meta เพิกเฉย คำสั่ง done หรือคลิกแล้วไม่ใช่หลักฐานว่าโฆษณาเผยแพร่หรือกำลังส่งจริง

## 4. Pattern ข้อมูลและความครบถ้วน

แยกสามชั้นให้ชัด: raw evidence → validated normalized import → analysis/export ไม่ยกระดับ raw DOM เป็น insight เพียงเพราะอ่านตารางได้

- ใช้ stable account/campaign/ad set/ad IDs เป็น string ห้ามเชื่อมข้อมูลด้วยชื่อหรือ geometric alignment อย่างเดียว
- เก็บ source/import job, date start/end, entity level, metric/result type, attribution, currency, timezone และ breakdown dimensions ไปกับตัวเลข
- unknown/null ไม่ใช่ 0; ห้ามอนุมาน conversions ที่ไม่ได้วัด
- ห้ามรวมคนละระดับ คนละ attribution คนละสกุลเงิน หรือช่วงวันที่ทับซ้อน; Reach ไม่ใช่ค่าที่บวกข้ามแถวได้เสมอ
- Preserve raw input สำหรับตรวจย้อนกลับ ใช้ validation เดียวกันทั้ง preview และ import จริง
- Import ต้อง transaction, ตรวจ parent relationship, ป้องกัน import ซ้ำ และ UPSERT ด้วย grain ที่ถูกต้อง โดยคงประวัติแต่ละ import
- Query/export ต้องแจ้งเกิน limit ไม่ตัดเงียบแล้วทำให้ดูเหมือนครบ
- ตรวจ entity/date/metric coverage, relationship integrity และ reconciliation ภายใต้เงื่อนไขเดียวกัน ข้อมูลขาดต้องระบุรายการที่ขาด
- จำนวนใน dashboard คือข้อมูล normalized ที่บันทึกไว้ ไม่ใช่จำนวนทั้งหมดใน Meta
- มี pagination/virtualization/คอลัมน์นอกจอได้เสมอ `needs_review` หมายถึงยังต้องตรวจ ไม่ใช่เก็บครบ 100%

### DOM capture ใน PostgreSQL (ตั้งแต่ 0.6.0)

ทุก snapshot ที่ Extension ส่งมากับ device state ถูกบันทึกเป็น raw record อัตโนมัติ (`capture_jobs`, `capture_snapshots`, `capture_rows` ใน `db/003_dom_captures.sql`) ซ้ำได้ไม่เกินหนึ่งครั้งต่อ fingerprint จากนั้น `evaluateSnapshot` ตรวจทีละแถว แถวจะถูกยกเข้า campaigns/ad_sets/ads และ insight_observations (ผ่าน import_jobs ที่มี `data_quality_reports.report.source = "dom_capture"`) **เฉพาะเมื่อ**:

- มี stable ID ตัวเลขจาก href ของลิงก์ในแถว (`selected_campaign_ids` / `selected_adset_ids` / `selected_ad_ids`) หรือจากคอลัมน์ ID ที่มองเห็น และไม่ซ้ำในภาพเดียวกัน ชื่อหรือพิกัดไม่ถูกใช้เป็น ID
- ระดับลูกมี parent ID จาก href และ parent ถูกบันทึกแล้ว (แคมเปญแม่ต้องมีชื่อใน DB)
- ช่วงวันที่แปลงได้จากปุ่มวันที่ที่มีวันที่ชัดเจน, สกุลเงินยืนยันจากสัญลักษณ์/รหัสที่ไม่กำกวม (`$` กำกวม), เขตเวลา IANA ที่มองเห็นบนหน้า หรือผู้ใช้ยืนยันเอง, attribution จากคอลัมน์ในแถวหรือผู้ใช้ยืนยัน, result type จากบรรทัดที่สองของเซลล์ผลลัพธ์หรือผู้ใช้ยืนยัน
- column mapping เป็น `semantic` หรือ `verified_geometry` (ลิงก์ที่มี ID อยู่ในคอลัมน์ชื่อของแถวนั้น และ header/body scroll offset ตรงกัน)
- spend และ impressions อ่านเป็นตัวเลขได้ ค่า `—` หรือข้อความยังคงหายไป ไม่กลายเป็น 0

แถวอื่นอยู่ใน `needs_review` พร้อม reason codes DOM capture ไม่เขียนทับ observation ที่มาจาก CSV ใน grain เดียวกัน (`csv_observation_exists`) การนำเข้า CSV ยังทำงานเหมือนเดิมและยังเป็นทางหลักเมื่อหน้าไม่แสดงข้อมูลครบ ผลที่ยกขึ้นยังเป็น coverage `visible_only` ไม่ใช่ทั้งบัญชี

เมื่อเพิ่ม schema ให้แก้ core validation, migration, store, API, web และ tests ที่เกี่ยวข้องให้สอดคล้องกัน เพิ่มไฟล์ migration ใหม่และเพิ่มชื่อใน scripts/migrate.ts เพราะปัจจุบันใช้รายการ explicit ไม่ได้ค้น SQL อัตโนมัติ อย่าแก้ migration ที่ฐานข้อมูลใช้ไปแล้ว

## 5. วิธีรันบน Windows

ทำใน CMD ที่ C:\BF โดยใช้ dependencies ฝั่ง Windows ห้ามใช้ node_modules ร่วม Windows/WSL โดยไม่ติดตั้งใหม่ด้วย npm ของแพลตฟอร์มที่จะรัน หากเรียกจาก WSL ของ workspace นี้ ใช้ `cmd.exe /d /c "npm ..."`

```bat
cd /d C:\BF
npm ci
```

ครั้งแรกเท่านั้น: คัดลอก .env.example เป็น .env ตั้ง API_TOKEN แบบสุ่มอย่างน้อย 32 ตัวอักษร และตรวจ DATABASE_URL อย่าทับ .env เดิมหรือแสดงค่า token ใน log

```bat
docker compose up -d
npm run db:migrate
npm run build
npm run dev:api
```

เปิด CMD อีกหน้าต่าง:

```bat
cd /d C:\BF
npm run dev:web
```

เปิด http://localhost:9321 โหลด unpacked extension จาก dist/extension ใน chrome://extensions แล้วเชื่อมต่อ Backend ผ่าน popup ตาม BOT.md / FRONTEND.md หลังแก้ Extension ให้ build และ Reload Extension หลังแก้ Backend ให้ restart process ที่ใช้อยู่ อย่าเปิด process ซ้ำพอร์ตเดิม

| คำสั่ง | ใช้เมื่อ |
| --- | --- |
| npm run health | ตรวจ Backend และฐานข้อมูล |
| npm run build | Build Extension + API; ลบและสร้าง dist/extension ใหม่ |
| npm run build:web | ตรวจ production build ของ Next.js |
| npm run start:web | รัน production Next หลัง build ที่พอร์ต 9321 |
| npm run build:all | Build ทั้งสองส่วน |
| npm run typecheck | ตรวจ TypeScript ส่วน core/API/Extension |
| npm run typecheck:web | ตรวจ TypeScript ฝั่ง Next |
| npm test | Unit tests |
| npm run check | Typecheck + unit + Extension/API build |

อย่าเปิด dev:web และ start:web พร้อมกันบนพอร์ต 9321 โค้ด generated หรือ diagnostic page ที่วางเองใน dist/extension จะหายเมื่อ build จึงต้องเก็บ implementation ถาวรใน source

## 6. วิธีพัฒนาและเลือกทดสอบ

1. อ่าน AGENTS.md, เอกสารนี้ และ git status ตรวจการเปลี่ยนแปลงที่มีอยู่ ห้ามทับงานผู้ใช้หรือย้อนเวอร์ชันตาม roadmap เก่า
2. อ่านเส้นทางจริงตั้งแต่ UI/command schema ถึง DB หรือ DOM ระบุ invariant และนิยามผลสำเร็จก่อนแก้ bug ต้อง reproduce และยืนยันสาเหตุด้วยหลักฐาน
3. แก้ที่ชั้นรับผิดชอบร่วม ใช้ shared Zod contracts แทน payload ที่แยกนิยามซ้ำ ไม่เพิ่ม bypass เพื่อให้ test ผ่าน
4. ทดสอบตามความเสี่ยง เก็บหลักฐานและแยก fixture จากหน้าจริง ไม่จำเป็นต้องรันทั้ง suite สำหรับ docs-only
5. อัปเดตเอกสารเมื่อ contract, setup หรือข้อจำกัดเปลี่ยน ตรวจ diff และข้อมูลลับก่อน commit
6. สรุปพฤติกรรมใหม่ สิ่งที่ทดสอบ และสิ่งที่ยังพิสูจน์ไม่ได้ เมื่อผู้ใช้สั่ง commit/push ให้ทำจนตรวจ remote สำเร็จ

| งานที่เปลี่ยน | การตรวจที่เหมาะสม |
| --- | --- |
| Docs | อ่านเทียบ source, ตรวจลิงก์, git diff --check, secret/privacy scan |
| Core parsing/metrics/schema | typecheck + unit tests ที่ตรวจ invariant จริง |
| API/store/migration | Unit ที่เกี่ยวข้อง + test:api บนฐานทดสอบที่กำหนด |
| DOM reader | test:reader และ fixture ที่แสดง virtualization/column alignment |
| DOM capture persistence/promotion | unit `tests/dom-capture.test.ts` + `npm run test:captures` (ต้องมี API/PostgreSQL; ใช้บัญชี fixture แบบสุ่มและลบเฉพาะข้อมูลของตัวเอง) |
| UI actions/guards | test:ui, test:connect หรือ test:browser ตามเส้นทางที่เปลี่ยน |
| Report columns/input | test:report-columns, test:report-input และตรวจหน้าจริงเมื่อมี local permission |
| Next components/data flow | typecheck:web, build:web และ test:web เมื่อเปลี่ยน interaction สำคัญ |
| Analysis | Unit ที่เกี่ยวข้อง + test:analysis |

Integration บางชุดต้องมี API/PostgreSQL และ .env พร้อม Browser fixture อาจจำลองหน้า Meta หรือคำตอบ Extension จึงไม่พิสูจน์การทำงานกับ Meta จริง อ่าน test ก่อนรันเพื่อทราบผลต่อ DB ลบได้เฉพาะข้อมูล fixture ที่ยืนยันเจ้าของได้ ห้ามล้างบัญชีหรือฐานจริงเป็นวงกว้าง

## 7. สิ่งที่พิสูจน์แล้วและงานค้าง

หลักฐานจากงานก่อนส่งต่อ ไม่ใช่การรับรองว่ารุ่นถัดไปจะยังผ่าน:

- เคยเชื่อมบัญชีจริงและอ่าน Campaign/Ad Set/Ads ได้ผ่าน Extension 0.5.0
- ในรอบที่ตรวจ พบ 8 campaign rows, 10 ad set rows และ 10 ad rows ขณะที่ footer ระบุโฆษณา 40 รายการ จึงยังไม่ครบทั้งบัญชี
- ผลเก็บเป็น raw capture / needs_review ยังไม่ได้ import เป็น normalized insights เพราะ stable IDs และบริบท/ตัวเลขสำคัญยังไม่ครบ
- report.prepare ยังตรวจ required fields ไม่ผ่านในหน้าจริง ผล applied:false ไม่ได้กด Save สำเร็จ
- Meta มี header/body scroll containers แยกกัน การเลื่อน header อย่างเดียวเคยทำให้ geometric mapping ใส่ค่าผิดคอลัมน์ Capture นั้นถูกปฏิเสธ ห้ามนำมาเป็น metrics
- มี experimental helper ใน reports และ dist บางเครื่อง ไม่ใช่ shipped workflow และไม่ใช่หลักฐานว่าทำงานสำเร็จ
- ก่อน initial commit เคยผ่าน unit 19 tests และ typechecks ทั้งสองส่วน แต่ควรรันใหม่ตามงานที่แก้ ไม่อ้างจำนวนนี้เป็นผลรอบปัจจุบัน
- ยังไม่ทดสอบสร้าง/เผยแพร่/ปรับงบโฆษณาจริง และไม่มี autonomous AI workflow ที่พิสูจน์ครบวงจร

ทดสอบอ่านอย่างเดียวบนบัญชีจริงด้วย 0.5.0 (15 พ.ย. 2026, UI ภาษาไทย, THB): campaigns 8 แถวตรง footer, adsets 9 แถว ทั้งหมดเป็น geometry, identity=null, coverage visible_only; ระดับ ads จบด้วย "No supported reporting rows after 3 attempts"; currency/timezone/attribution unverified; preset ที่ใช้ไม่มีคอลัมน์ spend

สิ่งที่ 0.6.0 เปลี่ยน (พิสูจน์ด้วย fixture เท่านั้น ยังต้องทดสอบซ้ำบน Meta จริง):

- ระดับ ads: รอในหน้า (`waitForReportingRows` สูงสุด 8 วินาที) ก่อนอ่าน, ลองได้ 6 ครั้ง, เริ่มอ่านทันทีเมื่อแท็บโหลดเสร็จ, ใช้ checkbox เลือกแถวเป็น anchor เมื่อไม่มี switch, อ่าน header แบบ clip เมื่อ overlay บังกลาง header และ error ระบุจำนวน headers/switches/checkboxes/rows/loading เพื่อวิเคราะห์ layout จริง สาเหตุจริงบน Meta ยังไม่ยืนยันเพราะไม่มีหลักฐานหน้า ads ในรอบนั้น
- ID จาก href ของลิงก์ในแถว (รวม parent IDs) และคอลัมน์ ID; ID ซ้ำหลายแถวถูกตั้งเป็น null
- ตรวจ header/body scroll offset (`column_alignment`) และเลื่อนแนวนอนทุก reporting scroller พร้อมกัน
- reporting_context.currency/timezone มาจากหลักฐานบนหน้า (`evidence`) attribution ยืนยันเฉพาะจากคอลัมน์ในแถว
- บันทึก capture ลง PostgreSQL อัตโนมัติ + หน้าเว็บ "ข้อมูลจาก Extension"

ทดสอบอ่านอย่างเดียวบนบัญชีจริงด้วย 0.6.0 (15 พ.ย. 2026): ทั้ง 3 ระดับอ่านแถวได้ด้วย geometry (campaigns 8/8 ตรงแถวสรุป, adsets 8/10, ads 8/40) column_alignment=aligned, currency=THB จากสัญลักษณ์, date range อ่านได้ แต่ identity=null ทุกแถว (ชื่อในตารางไม่ใช่ลิงก์ที่มี `selected_*_ids`; ระดับ ads ไม่มีลิงก์เลย), ไม่มีคอลัมน์ spend, timezone/attribution unverified จึงไม่มีแถวใดถูกยกขึ้น การเลื่อนแนวตั้งไม่ขยับ (body ไม่ใช่ overflow auto/scroll) และแถวสรุป "ผลลัพธ์จาก N …" กับปุ่ม hover ไปปนในชื่อแถวสุดท้าย/แถวที่เมาส์ชี้

สิ่งที่ 0.6.1 เปลี่ยน (fixture ผ่าน รอทดสอบจริงหลัง reload):

- ตัดแถวสรุปออกจากแถบแถว และเก็บจำนวนเป็น `reported_total_rows`; ตัดปุ่ม hover (แก้ไข/สร้างซ้ำ/แผนภูมิ/วิเคราะห์) ออกจากเซลล์ชื่อ
- เลื่อนแนวตั้งสำรอง: เลื่อน ancestor ที่ scroll ได้ของแถวสุดท้าย (รวม overflow:hidden) ให้แถวสุดท้ายขึ้นเป็นแถวแรก (ซ้อน 1 แถว) ถ้าไม่มีให้ส่ง wheel event หนึ่งครั้ง แล้วอ่านใหม่ภายใน 1.5 วินาที CLI `start`/`collect` ใช้ maxSteps 12
- `resume` ผูกงานเดิมเข้ากับแท็บที่เชื่อมต่ออยู่ปัจจุบัน (บัญชีเดียวกัน) แทนแท็บเก่าที่ปิดไปแล้ว
- วิเคราะห์ประสิทธิภาพจาก capture (`capture-analysis.ts`, `GET /captures/analysis`, แผงในหน้า "ข้อมูลจาก Extension") ดู [Analysis](ANALYSIS.md)

ลำดับงานที่ควรทำต่อ:

1. (0.6.1 จริง: นับ footer ได้ 8/10/40 แต่ยังอ่านได้หน้าจอแรกเท่านั้น และ footer ยังปนชื่อแถวสุดท้าย → แก้ใน 0.6.2 ดู VALIDATION) Reload เป็น 0.6.2 แล้วดู `state.job.scroll_log` ว่าวิธีเลื่อนแบบไหน moved=true และทดสอบการเลื่อนแนวตั้งบนบัญชีจริง (ads ต้องได้ใกล้ 40 แถวตามแถวสรุป) และให้ผู้ใช้เพิ่มคอลัมน์ ID + spend ใน preset เพื่อให้ identity มาจาก `id_column`
2. ทำ report column selection ให้ตรวจ selected fields ได้จริงก่อน Apply/Save และเพิ่มคอลัมน์ spend/attribution ใน preset
3. เก็บรายงานครบทุกแถว (virtualized rows / pagination) และ reconciliation กับ footer ก่อนสรุปว่าครบ
4. ค่อยขยาย workflow ยิงแอดตามงานที่ผู้ใช้อนุญาต โดยรักษา local lease และ approval พร้อมตรวจผลหลังทุกขั้น

## 8. Secrets, Git และการส่งต่องาน

ใช้ ACCOUNT_ID / DEVICE_ID / API_TOKEN เป็น placeholder ในเอกสาร ห้าม commit ค่าจริง, .env, customer CSV, captures/screenshots, browser profiles, reports, node_modules, dist หรือ .next ตรวจ .gitignore และ staged diff ทุกครั้ง

Repo: https://github.com/ntpten-x/bot-ads.git; branch ปัจจุบัน master ติดตาม origin/master ก่อน push ตรวจ remote/branch จริงอีกครั้ง ไม่ force push และไม่ stage งานอื่นที่ไม่เกี่ยวข้องโดยไม่ตรวจ

Token ฝั่งเว็บเก็บใน sessionStorage ส่วน account/device preferences อยู่ localStorage อย่านำ token ลง public environment variable หรือ client bundle Backend เป็น local single-operator token scope ยังไม่มี per-customer authorization อย่าเปลี่ยนเป็น public deployment โดยถือว่า production-ready แล้ว

เอกสาร PLAN/VALIDATION มีประวัติหลายรุ่น หากข้อมูลขัดกัน ให้อ่าน source ปัจจุบันและผลทดสอบที่มีวันที่/ขอบเขตชัดเจน แล้วแก้เอกสารให้ตรง อย่าทำให้ความสามารถดูมากกว่าหลักฐาน
