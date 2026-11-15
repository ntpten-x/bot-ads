# AI handoff และรูปแบบการพัฒนาระบบ

เอกสารส่งต่องาน ณ 15 พฤศจิกายน 2026 อ้างอิง Extension 0.5.0 ให้ตรวจ source และ package scripts ทุกครั้งก่อนใช้ เพราะเวอร์ชันแต่ละ package อาจต่างกัน

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
| apps/extension/src/background.ts | Device pairing, polling, jobs, checkpoints, dispatch |
| apps/extension/src/reader.ts | อ่านตาราง/ข้อความ/บริบทและ raw row observations |
| apps/extension/src/dom-control.ts | ตรวจเป้าหมายและทำ DOM actions แบบจำกัดชนิด |
| apps/extension/src/ui-controller.ts | Account/tab guards, write lease, approval และผลหลัง action |
| apps/extension/src/report-*.ts | เตรียมคอลัมน์ ตรวจ dialog และ bounded report input |
| packages/core/src/control.ts | Shared Zod command schemas และ URL/account guards |
| packages/core/src/index.ts | CSV parsing, normalized import schema และ quality validation |
| packages/core/src/analysis.ts, metrics.ts, capture-review.ts | วิเคราะห์ตามกฎและตรวจหลักฐาน capture |
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

ลำดับงานที่ควรทำต่อ:

1. ทำ report column selection ให้ตรวจ selected fields ได้จริงก่อน Apply/Save
2. แก้การเลื่อนให้ header/body สอดคล้อง ตรวจด้วย cell value และภาพ ไม่อาศัยพิกัดเพียงอย่างเดียว
3. เก็บ stable IDs และรายงานครบทุกแถว รวมทั้งตรวจ date/attribution/currency/timezone จากหลักฐาน
4. เพิ่ม quality report ที่ระบุข้อมูลขาดและ reconciliation ก่อน normalize/import
5. ค่อยขยาย workflow ยิงแอดตามงานที่ผู้ใช้อนุญาต โดยรักษา local lease และ approval พร้อมตรวจผลหลังทุกขั้น

## 8. Secrets, Git และการส่งต่องาน

ใช้ ACCOUNT_ID / DEVICE_ID / API_TOKEN เป็น placeholder ในเอกสาร ห้าม commit ค่าจริง, .env, customer CSV, captures/screenshots, browser profiles, reports, node_modules, dist หรือ .next ตรวจ .gitignore และ staged diff ทุกครั้ง

Repo: https://github.com/ntpten-x/bot-ads.git; branch ปัจจุบัน master ติดตาม origin/master ก่อน push ตรวจ remote/branch จริงอีกครั้ง ไม่ force push และไม่ stage งานอื่นที่ไม่เกี่ยวข้องโดยไม่ตรวจ

Token ฝั่งเว็บเก็บใน sessionStorage ส่วน account/device preferences อยู่ localStorage อย่านำ token ลง public environment variable หรือ client bundle Backend เป็น local single-operator token scope ยังไม่มี per-customer authorization อย่าเปลี่ยนเป็น public deployment โดยถือว่า production-ready แล้ว

เอกสาร PLAN/VALIDATION มีประวัติหลายรุ่น หากข้อมูลขัดกัน ให้อ่าน source ปัจจุบันและผลทดสอบที่มีวันที่/ขอบเขตชัดเจน แล้วแก้เอกสารให้ตรง อย่าทำให้ความสามารถดูมากกว่าหลักฐาน
