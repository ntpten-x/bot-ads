# ระบบข้อมูลวิเคราะห์โฆษณา 0.6.73

สถานะปัจจุบัน: ใช้กฎตรวจหลักฐานและประเมินต้นทุนที่อธิบายได้ ไม่ใช่บอทปรับงบหรือเผยแพร่อัตโนมัติ ดูการแก้ reliability และขั้นตอนรับรองรุ่นใหม่ท้ายเอกสาร หัวข้อรุ่นเก่าเก็บไว้เป็นประวัติ

## CSV-first reconciliation — 2026-11-17

CSV ที่ผ่าน validation เป็นแหล่งยอดหลัก ส่วน DOM เป็นหลักฐานเสริมแบบ visible lower bound ระบบไม่บวกยอดหรือจัดอันดับข้ามแหล่งข้อมูล และแยกชุดรายงานตาม `source` แม้แถวจะมี ID/วันที่/เงื่อนไขเดียวกัน

`parseReport()` คืน `reconciliation` แบบ structured ประกอบด้วยจำนวนแถว, Spend และช่วงวันที่ (ถ้าระบุ) พร้อม expected/actual/delta/matched `coverage` ยังคงหมายถึงทั้งบัญชีและเป็น `unverified` เสมอ ส่วน `scope_coverage=verified_for_import` หมายถึงเฉพาะไฟล์ที่นำเข้าและจำนวนแถวกับ Spend ตรงกับค่าที่ผู้ใช้ระบุ ไม่ได้พิสูจน์ว่า Meta ไม่มีแถวอื่นนอกไฟล์

หลังบันทึก CSV สำเร็จ Backend ประทับ `raw._import_reconciliation` จากผล validation ฝั่ง server (เขียนทับค่าที่อาจมีในคอลัมน์ CSV) Analysis อ่านหลักฐานนี้เป็นระดับแถวและรายงาน `verified_import_rows`; การไม่มีหลักฐานหรือ filename ไม่ตรงจะถือเป็น `unverified` ไม่เดาเป็นยอดที่ยืนยันแล้ว

UI แสดง `กระทบยอดไฟล์นี้แล้ว` แยกจาก `ยังไม่ยืนยันทั้งบัญชี` และติดป้ายแหล่งข้อมูลในตารางวิเคราะห์ ประเมิน CPA/ROAS ภายในชุดรายงานเดียวกันเท่านั้น ห้ามใช้ยอด CSV แทน DOM ใน scope ที่ไม่ตรงกัน หรือรวมยอดสองแหล่งเข้าด้วยกัน

## เปิดใช้งาน

หน้าเว็บ: http://127.0.0.1:9321/#analysis → เมนู **ข้อมูลวิเคราะห์**

1. Reload Extension ใน `chrome://extensions` ให้เป็น 0.6.73 แล้วเปิดบัญชี Meta และกด **เชื่อมต่อและทดสอบอ่าน**
2. เลือกบัญชีและอุปกรณ์ในหน้าเว็บ เลือกเป้าหมาย **ข้อความ / ยอดขาย / ลูกค้าเป้าหมาย**
3. เปิด popup กด **เปิดเมาส์/คีย์บอร์ดรายงาน 15 นาที** แล้วกด **ตั้งคอลัมน์วิเคราะห์ใน Meta** ในหน้าเว็บ รอประมาณ 30 วินาทีสำหรับการรับคำสั่ง ตรวจผลว่าคอลัมน์หลักใดยังหาไม่พบ หาก Meta ใช้หน้าต่างที่ไม่รองรับให้เปิด Columns → Customize columns ด้วยตัวเอง แล้วเลือกตามรายการในหน้าเว็บ
4. กด **อ่านค่าตาราง Ads** เปิดแท็บ Meta ค้างไว้ ระบบเลื่อนแนวนอนเพื่อเก็บคอลัมน์และแนวตั้งเพื่อเก็บแถว ภาพข้อมูลแต่ละภาพมีเวลา รุ่นตัวอ่าน ชื่อคอลัมน์ และหลักฐานแถวของตัวเอง แถวระหว่างภาพอาจซ้ำกัน
5. เมื่อต้องการข้อมูลที่ระบุ IDs และเงื่อนไขครบ ให้ส่งออก **CSV จาก Meta ระดับ Ads** พร้อม IDs, reporting starts/ends และตัวเลข แล้วกด **นำเข้า CSV จาก Meta** ในหน้าระบบ
6. ตรวจการจับคู่คอลัมน์ ช่วงเวลา สกุลเงิน เขตเวลา Attribution และชนิดผลลัพธ์ ระบุจำนวนแถวกับยอดใช้จ่ายรวมจากต้นทาง ตรวจสอบไฟล์แล้วบันทึก
7. กลับเมนูข้อมูลวิเคราะห์ กดโหลดข้อมูลที่บันทึก เลือกชุดรายงาน ส่งออก JSON หรือ CSV เพื่อวิเคราะห์ต่อ

ไม่มี Meta API integration การตั้งคอลัมน์เป็นการเปลี่ยนมุมมองรายงาน ไม่ใช่การเปลี่ยนงบหรือสถานะโฆษณา ตัวเลือกที่หาไม่พบไม่ถูกเดาและไม่ถูกแทนด้วยศูนย์

## ค่าที่จัดเก็บ

| หมวด | ฟิลด์ |
|---|---|
| ระบุตัวตน | account_id, campaign_id/name, ad_set_id/name, ad_id/name, status, objective |
| เงื่อนไข | date_start, date_end, currency, timezone, attribution, result_type, breakdown |
| ต้นทุนโฆษณา | spend, budget, cost_per_result, cost_per_purchase, cost_per_lead, cost_per_messaging_conversation |
| การเข้าถึง | impressions, reach, frequency, cpm |
| การคลิก | link_clicks, link_ctr, link_cpc, landing_page_views; ctr/cpc แบบเดิมแยกต่างหาก |
| คอนเวอร์ชั่น | results, messaging_conversations, leads, purchases, adds_to_cart, checkouts_initiated |
| รายได้ตาม Attribution | purchase_value, roas, website_purchases, website_purchase_value, website_roas |
| ชิ้นงานเมื่อมีในไฟล์ | creative_body/headline/description/cta/destination_url/type |
| หลักฐาน | raw, ชื่อไฟล์/ลำดับข้อมูล, แผนจับคู่หัวคอลัมน์ใน quality report, import fingerprint และ immutable import history |

**Spend คือเงินที่ใช้จริง; Budget คืองบที่ตั้งไว้** ไม่รวม Budget ที่ซ้ำกันในหลาย Ads เป็นต้นทุนจริง ระบบนี้ยังไม่มีต้นทุนสินค้า ค่าธรรมเนียม ค่าจัดส่ง หรือยอดรับเงินจริง จึงไม่แสดงกำไรสุทธิ

คอลัมน์หลักสำหรับแต่ละเป้าหมาย:

- ข้อความ: spend, impressions, link_clicks, messaging_conversations
- ยอดขาย: spend, impressions, link_clicks, purchases, purchase_value
- ลูกค้าเป้าหมาย: spend, impressions, link_clicks, leads

ทั้งหมดต้องเป็นระดับ Ad มี Ad ID และเงื่อนไขรายงานที่ทราบ ค่า `Results` ขึ้นกับวัตถุประสงค์และไม่ถูกแทนเป็น Purchases/Leads/Messages โดยอัตโนมัติ

## การคำนวณ

ค่าจาก Meta อยู่ใน `reported`; ค่าคำนวณอยู่ใน `derived` (CSV ใช้คำนำหน้า `calculated_`)

- Link CTR (%) = link_clicks / impressions × 100
- Link CPC = spend / link_clicks
- CPM = spend / impressions × 1000
- ต้นทุนต่อคอนเวอร์ชั่น = spend / event ของเป้าหมายที่เลือก
- Purchase ROAS = purchase_value / spend
- Website ROAS = website_purchase_value / spend
- Landing page rate (%) = landing_page_views / link_clicks × 100

ตัวหารศูนย์หรือข้อมูลขาดให้ `null` ไม่แสดง Infinity และไม่เติม 0 ไม่มีการเรียก Purchases/Link clicks ว่าอัตราคอนเวอร์ชั่น เพราะยอดซื้ออาจไม่ได้มี Attribution จากคลิกเหล่านั้น

สรุปแยกตาม account, level, date interval, currency, timezone, attribution, result type และ breakdown เดียวกัน ใช้อัตราจากผลรวมตัวตั้ง/ตัวหาร ไม่เฉลี่ย CTR/CPA ของแต่ละแถว ไม่รวม Reach/Frequency ข้ามแถว ช่วงวันที่ทับซ้อนถูกแจ้งเตือน; ไม่มีการรวมยอดข้ามกลุ่มให้อัตโนมัติ ข้อมูลซ้ำใน grain เดียวกันบล็อกผลรวม

`ready_for_selected_goal` หมายถึงมีค่าหลักสำหรับเป้าหมาย ไม่ได้หมายความว่ามีข้อมูลครบทั้งบัญชีหรือ Meta ยืนยันยอดขายแล้ว

## การอ่าน DOM กับการนำเข้าที่ตรวจแล้ว

`row_observations` มี `identity`, `identity_source` (`row_link_href` / `id_column` / null), `parent_ids`, `name`, `method`, `column_mapping` (`semantic` / `verified_geometry` / `unverified`), `cells[{header,text}]`, warnings และ snapshot มี `level`, `column_alignment`, `header_mode`, `reporting_context.evidence`

- `semantic`: มีหลักฐานเซลล์กับ header จากโครงสร้างตารางและตำแหน่งที่ตรงกัน
- `geometry`: ใช้ตำแหน่งข้อความภายใต้หัวคอลัมน์และแนวแถวของสวิตช์ (หรือ checkbox เลือกแถวเมื่อไม่มีสวิตช์) เป็น `verified_geometry` ได้เมื่อ header/body scroll offset ตรงกันและลิงก์ที่มี ID อยู่ในคอลัมน์ชื่อของแถวนั้น นอกนั้นเป็น `unverified`
- ID อ่านเฉพาะพารามิเตอร์ ID ที่ชัดเจนใน URL ของลิงก์ภายใน Meta ไม่สร้าง ID จากชื่อหรือแถว
- ไม่รวมชื่อซ้ำ และไม่ join ภาพคนละช่วงเลื่อนด้วยชื่อ
- ตั้งแต่ 0.6.0 ทุก snapshot ถูกบันทึกลง PostgreSQL (`capture_snapshots`, `capture_rows`) และแถวจะถูกยกเป็น normalized Insights อัตโนมัติ **เฉพาะ** เมื่อยืนยัน ID, parent IDs, วันที่, currency, timezone, Attribution, result type, column mapping, spend และ impressions ได้ครบ แถวอื่นเป็น `needs_review` พร้อมเหตุผล ดูหน้า "ข้อมูลจาก Extension"
- ไม่สรุปจำนวนแถวที่เก็บเป็นความครบทั้งบัญชี; พารามิเตอร์เริ่มต้นจำกัด 5 ช่วงเลื่อนแนวตั้ง และสูงสุด 12 ครั้งแนวนอนต่อช่วง เก็บได้เพียงคอลัมน์ที่ Meta เปิดไว้
- เปลี่ยนไปแท็บอื่นขณะอ่านจะพักงานพร้อมคำอธิบาย; กดทำต่อเพื่อเปิดแท็บ Meta กลับมา

## CSV

ใช้ [ตัวอย่างคอลัมน์ครบ](../samples/analysis-template.csv) เป็นข้อมูลจำลองเท่านั้น

รองรับ alias ไทย/อังกฤษและ mapping UI สำหรับชื่ออื่น เลือก **เก็บในข้อมูลต้นฉบับ** เมื่อคอลัมน์ไม่ควรถูกแปลเป็นตัวเลข เช่นข้อความงบแบบใช้ร่วมกับแคมเปญ การจับคู่สองคอลัมน์เป็นฟิลด์เดียวกันถูกปฏิเสธ

รูปแบบตัวเลขเริ่มต้น `1234.56`; เลือก `1,234.56` ในฟอร์มได้เมื่อไฟล์ใช้ comma คั่นหลักพัน ไม่รองรับการเดาจุดทศนิยมแบบ comma วันที่ต้องเป็น ISO `YYYY-MM-DD` IDs ต้องเป็นข้อความตัวเลขที่ไม่ผ่าน scientific notation สกุลเงินอ่านจากคอลัมน์ currency หรือส่วนท้ายหัว spend เช่น `(THB)` ที่ชัดเจน และปฏิเสธเมื่อขัดกัน

## Bot และ API

```bash
npm run bot -- DEVICE_UUID prepare messages
npm run bot -- DEVICE_UUID collect ads
npm run bot -- DEVICE_UUID state
```

คำสั่งผ่านคิว:

```json
{"command":"report.prepare","goal":"sales"}
```

```json
{"command":"start","levels":["ads"],"maxSteps":5,"scan_columns":true}
```

`POST /analysis/preview` รับ `{goal, input}` โดย input ใช้ schema เดียวกับการนำเข้า ตอบ validation และ analysis เมื่อผ่านเท่านั้น ไม่มีการบันทึกฐานข้อมูลใน endpoint นี้ การบันทึกยังใช้ `POST /imports` ส่วนข้อมูลหน้าเว็บมาจาก authenticated `/export`

## ตรวจสอบ

```bash
npm run check
npm run build:web
npm run test:reader
npm run test:report-columns
npm run test:analysis
npm run test:web
```

Integration tests ต้องใช้ Backend รุ่นล่าสุดและ PostgreSQL; ใช้บัญชี/อุปกรณ์ fixture แยกแล้วลบด้วย marker ที่ตรงกัน Browser fixture tests ไม่ได้พิสูจน์ว่าการตั้งคอลัมน์หรือรูปแบบ DOM ใหม่รองรับ Meta จริงทุก layout

## เมาส์และคีย์บอร์ดรายงาน 0.5.0

ผลทดสอบ Meta จริงพบว่าค้นชื่อ checkbox ได้ แต่ค่าค้นหาไม่คงอยู่และการเลือกไม่ถูกยืนยันเมื่อใช้เหตุการณ์ DOM สังเคราะห์ รุ่น 0.5.0 เพิ่มทางส่ง Input ของ Chrome ผ่าน `chrome.debugger` แทน ใช้เฉพาะ workflow คอลัมน์รายงาน

Chrome กำหนดให้ประกาศ permission `debugger` ใน manifest และไม่รองรับเป็น optional permission: [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger), [รายการสิทธิ์ที่ไม่เป็น optional](https://developer.chrome.com/docs/extensions/reference/api/permissions#step_2_declare_optional_permissions_in_the_manifest) สิทธิ์นี้มีความสามารถกว้างกว่าการอ่านตาราง โค้ด workflow นี้จำกัดการใช้ไว้ที่ Input เมาส์/คีย์บอร์ดของแท็บที่ผู้ใช้ผูกไว้เท่านั้น

หลัง Reload 0.5.0 และเชื่อมต่อแล้ว ให้กด **เปิดเมาส์/คีย์บอร์ดรายงาน 15 นาที** ใน popup ก่อนกดตั้งคอลัมน์ หน้าเว็บจะปิดปุ่มตั้งคอลัมน์ไว้จนได้รับสถานะเปิดโหมดจาก Extension Chrome จะแสดงแถบกำลังแก้ไขข้อบกพร่องระหว่าง attach; เมื่อจบคำสั่ง Extension จะ detach เสมอ กด **หยุดเมาส์/คีย์บอร์ดรายงาน** เพื่อเพิกถอนโหมด หรือรอหมดเวลา

การเปิดโหมดทำได้จาก popup ในเครื่องเท่านั้น บอทไม่มีคำสั่งเปิดโหมด และไม่รับคำสั่ง CDP, JavaScript, selectors หรือพิกัดจาก API ตัวอ่าน DOM จะคำนวณตำแหน่ง control ที่ยืนยันได้ใหม่ก่อนส่ง Input แต่ละครั้ง ตรวจ account/route/active tab และเวลาหมดอายุซ้ำ บันทึกได้เฉพาะปุ่มใน dialog ปรับแต่งคอลัมน์ที่ระบุชื่อได้ ไม่มีการใช้ Runtime/Network/Fetch ของ CDP และไม่มี Meta API integration

ทดสอบ `npm run test:report-input` ใช้ MV3 Extension จริงกับหน้าจำลองที่ปฏิเสธ untrusted input ตรวจการค้นหา เลือก checkbox บันทึก scope สิทธิ์ และ detach ไม่ใช่การยืนยันว่าข้อมูล Meta บัญชีจริงเก็บครบแล้ว

## DOM capture ใน Database 0.6.0

| Endpoint | หน้าที่ |
| --- | --- |
| `GET /captures?account_id=ACCOUNT_ID[&status=needs_review]` | รายการ snapshot ล่าสุด 200 รายการ พร้อมจำนวนแถว แถวที่มี ID แถวที่ยกขึ้นแล้ว และเหตุผล |
| `GET /captures/CAPTURE_UUID` | รายละเอียด snapshot และทุกแถว (cells, identity, review_status, review_reasons) |
| `POST /captures/CAPTURE_UUID/review` | ตรวจซ้ำ body `{"context":{"timezone":"Asia/Bangkok","attribution":"...","result_type":"..."}}` (ไม่บังคับ) ผู้ใช้ยืนยันได้เฉพาะ timezone/attribution/result type เหมือน CSV import; ID วันที่ และสกุลเงินต้องมาจากหน้า Meta |
| `POST /captures/jobs/JOB_UUID/review?account_id=...` | Review/materialize ทุก snapshot ใน job ด้วย operator context เดียว; คืน promoted rows, unique observations และ reason ที่ยัง block |
| `GET /captures/jobs/JOB_UUID/reconciliation?account_id=...&scope_key=...` | เทียบ DOM scope กับ CSV ที่เงื่อนไขตรงกันด้วย stable IDs และ metric deltas โดยไม่รวมแหล่งข้อมูล |

Reason codes หลัก: `stable_id_unverified`, `parent_campaign_id_unverified`, `parent_ad_set_id_unverified`, `parent_campaign_not_promoted`, `column_mapping_unverified`, `header_body_scroll_mismatch`, `date_range_unverified`, `currency_unverified`, `currency_conflict`, `timezone_unverified`, `attribution_unverified`, `result_type_unverified`, `missing_required_metric:spend`, `csv_observation_exists`, `duplicate_id_in_snapshot`

ข้อจำกัด: เป็น coverage `visible_only`; ภาพหลายช่วงเลื่อนของเอนทิตีเดียวกันใช้ grain เดียวกันจึง UPSERT ไม่ซ้ำ; ช่วงวันที่ต่างกัน (เช่น "30 วันที่ผ่านมา" ของคนละวัน) เป็นคนละ observation และอาจทับซ้อน ห้ามรวมยอดข้าม observation ที่ช่วงวันซ้อนกัน ถ้า preset คอลัมน์ไม่มี spend แถวจะไม่ถูกยกขึ้นเลย

## วิเคราะห์ประสิทธิภาพจาก DOM capture 0.6.1

หน้าเว็บ "ข้อมูลจาก Extension" มีแผง **วิเคราะห์ประสิทธิภาพจากงานอ่านล่าสุด** และ API `GET /captures/analysis?account_id=ACCOUNT_ID[&job_id=JOB_UUID]` (ค่าเริ่มต้นคืองานอ่านล่าสุด) ใช้ `packages/core/src/capture-analysis.ts` ซึ่งเป็น pure function มี unit test

- อ่าน capture ทั้งที่ `needs_review` และยกขึ้นแล้ว แต่ทุกผลมีป้ายกำกับ: ตัวตน (`verified_ids` / `no_stable_ids`), ยอดใช้จ่าย (`reported` / `estimated`), coverage เทียบจำนวนแถวที่ Meta พิมพ์ในแถวสรุป ("ผลลัพธ์จาก N …") เฉพาะเมื่อ footer อ้างขอบเขตเดียวกับ level นั้น
- สถานะการแสดงโฆษณาแปลงเป็น `payment_error`, `off`, `parent_off`, `active`, `learning`, `limited`, `in_review`, `rejected`, `not_delivering`, `completed`, `unknown` ข้อความที่ไม่รู้จักเป็น `unknown`
- ผลลัพธ์ ต้นทุนต่อผลลัพธ์ อิมเพรสชัน งบประมาณ (จำนวน/ต่อวัน/ตลอดอายุ/ใช้งบระดับบน) ค่า "—" หรือไม่มีคอลัมน์เป็น `null` ไม่เป็น 0
- ยอดใช้จ่าย: ใช้คอลัมน์ "จำนวนเงินที่ใช้จ่ายไป" ถ้ามี มิฉะนั้นเป็น **ค่าประมาณ** ผลลัพธ์ × ต้นทุนต่อผลลัพธ์ (`spend_source=estimate_results_x_cost_per_result`) ไม่ถูกบันทึกเป็น spend จริง
- แถวที่ไม่มี ID รวมซ้ำได้เฉพาะเมื่อทุกเซลล์ตรงกันในงานอ่านเดียวกัน (ภาพที่เลื่อนซ้อนกัน) ไม่ใช่ identity และไม่ใช้ข้ามงานอ่าน แถวที่ header/body เลื่อนไม่ตรงกันไม่ถูกจัดอันดับ
- สรุปตามประเภทผลลัพธ์จากผลรวม (ต้นทุนถ่วงน้ำหนัก = ยอดใช้จ่ายรวม / ผลลัพธ์รวม) จัดอันดับด้วยต้นทุนต่อผลลัพธ์เฉพาะแถวที่มีผลลัพธ์อย่างน้อย 5 และประเภทผลลัพธ์หลักเดียวกัน
- คำแนะนำ (มนุษย์ตัดสินใจ บอทไม่เปลี่ยนโฆษณา): ต้นทุนสูงกว่าค่ากลาง ≥30% (ต้องมีแถวเทียบได้ ≥3), อิมเพรสชัน ≥1,000 แต่ไม่มีผลลัพธ์, ผลลัพธ์น้อย, การแก้ไขที่ยังไม่เผยแพร่, อ่านได้ไม่ครบ, ไม่มีคอลัมน์ spend หรือ ID. `payment_error`, `off` และ `parent_off` แสดงไว้เป็น diagnostic เท่านั้น ไม่ถูกนำมาคิดผลรวมผลลัพธ์ ค่ากลาง อันดับ หรือสร้างคำแนะนำ

ให้ผลวิเคราะห์ใช้ตัดสินใจได้ดีขึ้น: เพิ่มคอลัมน์ "จำนวนเงินที่ใช้จ่ายไป", "ID แคมเปญ", "ID ชุดโฆษณา", "ID โฆษณา" (และ "การตั้งค่าการระบุที่มา") ใน preset ของ Meta และวางไว้ช่วงซ้ายของตารางเพื่อให้อยู่ในจอโดยไม่ต้องเลื่อนแนวนอน

## Reliability และการประเมินรายแอด 0.6.3

ข้อกำหนดส่วนนี้แทนพฤติกรรมวิเคราะห์ DOM ของ 0.6.1 ข้างต้น:

Live `0.6.37` รอบแรกเพิ่มจากหนึ่งเป็นแปด snapshots และ coverage 26–35 แถวต่อ Age scope แต่ native path timeout ที่ step 8. รอบสอง probe ไม่เห็น custom scrollbar แม้ยังอยู่ที่ต้นตาราง; หลักฐานยืนยันว่า scrollbar ถูกเปิดเผยหลัง pointer hover. `0.6.38` จึง re-probe หลัง trusted hover ทุก target, drag thumb ที่เพิ่งปรากฏก่อนใช้ wheel และขยาย overall deadline เป็น 30 วินาทีโดยคง per-command debugger timeout 6 วินาที. Live `0.6.38` หลัง reload/lease ใหม่ยังได้หนึ่ง snapshot, `needs_review`, coverage ไม่ครบ และ `attempted_scrollbar=false`; DOM ชี้ว่า custom scrollbar อาจเป็น sibling ของ reporting scope. `0.6.39` จึงค้นหา track ใน reporting ancestors, เพิ่ม right-edge hover points ก่อน target budget เต็ม และไม่ส่ง wheel ซ้ำบน hover-only target. Live `0.6.39` พบ track/thumb จริงและ drag ถูกส่ง แต่ thumb อยู่ท้ายรางจนไม่มีแถวใหม่; `0.6.40` เพิ่ม native reset ลาก thumb ขึ้นบนสุดก่อน snapshot แรกและยืนยัน row signature เปลี่ยน. Live `0.6.40` ได้ 8 snapshots, 196 observations และ 35 unique parent Ad IDs แต่ทุก Age scope ยัง partial (coverage 26–35 จาก 40 แถว) และจบ `needs_review`; step 8 คืน `visible_rows_unchanged` ทั้งที่ custom thumb ห่างท้ายรางเพียง ~5px. `0.6.41` จึงเพิ่ม edge tolerance 8px, นับ custom scrollbar เป็นหลักฐาน `at_bottom`, และ rebase view หลัง attach เฉพาะเมื่อนิ่งติดกันสอง probe. Live `0.6.41` หลัง reload/lease ผ่าน native reset และ step 8 คืน `reporting_bottom_reached`; job `047d3c3e-64c5-447c-bdc1-ed25727550a2` มี 8 snapshots, 198 raw Age observations และ 35 unique parent Ad IDs. Analysis สร้าง messaging result group และอันดับทุก Age scope (eligible 8/9/4/2/2/2) โดยไม่มี blocker ด้าน column/identity/timezone/filter; verified rows คือ 34/35/32/26/26/27 และ footer 40 เป็นยอดรวมของรายงาน ไม่ใช่ตัวหารเฉพาะ Age จึงรายงานเป็น `coverage=lower_bound` ไม่ใช่ `x/40`. ตั้งแต่การแก้รอบ 19 พ.ย. 2026 `payment_error`, `off` และ `parent_off` เป็น diagnostic เท่านั้น: เก็บใน `delivery_counts`/`delivery_observation_counts` และ `performance_excluded_counts` เพื่อตรวจหลักฐาน แต่ไม่สร้าง recommendation, ไม่จัดอันดับ, ไม่คิดค่ากลาง และไม่ถูกนำไปสร้าง optimization recommendation.

- แยก scope ตามบัญชี ระดับ ช่วงวันที่ สกุลเงิน เขตเวลา Attribution Breakdown และตัวกรอง รวมคอลัมน์ข้ามภาพด้วย stable ID ที่ยืนยันแล้วเท่านั้น; ไม่มี ID ให้เก็บเป็น unresolved evidence ไม่เป็นจำนวนแอด ยอดรวม หรืออันดับ
- `unique_rows` / `verified_unique_rows` คือจำนวนตัวตนที่ยืนยันได้; `observed_rows` คือหลักฐานดิบที่อาจซ้ำ `unresolved_observations` คือหลักฐานที่ยังเชื่อมตัวตนไม่ได้ แยก `delivery_counts` ของตัวตนที่ยืนยันจาก `delivery_observation_counts` ของหลักฐานดิบ
- `coverage=complete` รับรองเพียงจำนวน ID ตรง footer ภายใน scope ที่ตรวจแล้ว และไม่มีข้อขัดแย้ง ไม่รับรองทั้งบัญชี Meta; Breakdown partition ที่เห็นเฉพาะ footer รวมทั้งรายงานใช้ `coverage=lower_bound` และห้ามนำไปคิดเป็น `x/40` หรือบวกข้าม Age ค่า `needs_review` ยังต้องตรวจเสมอ
- Web panel ส่งเฉพาะบริบทที่ผู้ใช้ยืนยันจริงไปยัง `/captures/analysis`: timezone, attribution, result type, ไม่มีตัวกรอง และไม่มี Breakdown โดยเก็บค่าไว้ใน localStorage และไม่เดาค่าแทนผู้ใช้; ปุ่ม materialize ใช้ context เดียวกัน review ทุก snapshot ของ job
- ค่าใหม่กว่าของ ID/เงื่อนไขเดิมใช้แทนค่าเก่าพร้อม provenance; ค่าขัดกันในเวลาเดียวกันหรือ ID ซ้ำในภาพถูกระงับการสรุป ค่า unknown ใหม่ไม่ใช้ค่าเก่ากลบ ส่วนข้อมูลต่างช่วงวัน/หน่วยไม่รวมกัน
- `spend_quality` และ `data_quality.spend` มี `reported`, `estimated`, `mixed`, `missing` อ้างอิงค่าที่อ่านได้จริง ไม่ใช่หัวคอลัมน์ `mixed` ครอบคลุมค่าขาดหายบางรายการด้วย ต้องดูแหล่งค่ารายแถว
- ไม่มีหลักฐาน Breakdown/ตัวกรองให้เป็น `null` พร้อม blockers; `{}`/`[]` ใช้เมื่อมีหลักฐานชัดเจนว่าไม่มีการแจกแจง/ตัวกรองเท่านั้น ปัจจุบัน reader ระบุส่วนนี้ว่ายังไม่ยืนยัน จึงควรใช้ validated CSV สำหรับผลรวมและการประเมินเมื่อบริบทบนหน้าไม่ครบ
- API คืน scope แยกใน `levels` (อาจมีระดับเดิมหลายชุด) ใช้ `scope_key` ระบุชุด; ระบุ `job_id` ที่ไม่มีหรือคนละบัญชีได้ 404 หน้าเว็บเลือกงานย้อนหลังได้ แสดง blockers และคำเตือนการเลื่อนจาก job

Report setup ต้องเลือกและตรวจซ้ำทุก required field รวม IDs และ spend ก่อน Save; ถ้าขาดหรือ selection ถูกย้อนคืน ให้ `applied=false` ไม่บันทึกมุมมองรายงาน การเลื่อน native fallback ใช้เฉพาะสิทธิ์รายงานที่เปิดเองใน popup ตรวจบัญชี/แท็บ/เส้นทาง/งานที่กำลังอ่านก่อน input และ detach หลังจบ เมื่อ lease หมดอายุหรือพักงานต้องหยุด ไม่เปิด/ต่อ lease เอง

Normalized analysis มี `row.evaluation` และ policy ที่ส่งออกได้: ข้อมูลขาด/ซ้ำ/ช่วงวันซ้อน/บริบทไม่ยืนยันเป็น `blocked`; ผลลัพธ์น้อยกว่า 5 เป็น `insufficient_sample`; แอดผ่านเกณฑ์เทียบได้น้อยกว่า 3 เป็น `insufficient_peers`; เมื่อพอจึงเปรียบเทียบ CPA กับ median ภายใน scope และ objective เดียวกัน สถานะ `higher_cost` เริ่มที่ 1.3 เท่าของ median, `lower_cost` ไม่เกิน 1/1.3 เท่า นี่เป็นเกณฑ์คัดกรองเชิงพรรณนา ไม่ใช่นัยสำคัญทางสถิติหรือความคุ้มทุน

สถานะ `payment_error`, `off` และ `parent_off` จาก normalized records ยังแสดงในตารางพร้อม blocker `performance_excluded_delivery_status` เพื่อให้ตรวจต้นเหตุได้ แต่ถูกตัดออกจาก peer set, median และ evaluation ranking. Report Studio แยกตารางวินิจฉัยออกจากชุดข้อมูลประสิทธิภาพ: ตารางยังแสดง Ads เหล่านี้ แต่ KPI, กราฟ, scope bars และ concentration ใช้ `buildPerformanceRows()` ซึ่งตัดสถานะทั้งสามก่อนคำนวณ. คำว่า `ปิด`, `ปิดใช้งาน`, `paused`, `disabled` และรูปแบบระดับแคมเปญ/ชุดโฆษณาใช้ shared parser เดียวกับ DOM analysis

ใช้คอนเวอร์ชั่นตามเป้าหมายที่ระบุชนิดชัดเจน ไม่แทน Results เป็นยอดซื้อ/ลีด/ข้อความ คำอธิบายระบุ reasons, blockers และ next_steps รวมถึงตรวจคุณภาพผลลัพธ์กับธุรกิจ ไม่เปลี่ยนโฆษณาอัตโนมัติ และไม่สรุปกำไรจาก ROAS

ทดสอบหน้าแสดงความไม่แน่นอนเพิ่มเติมด้วย `npm run test:capture-analysis-web` (fixture ไม่มี Meta access/DB writes) ส่วน `test:web` และ `test:analysis` ตรวจว่าผลประเมินและขั้นตอนถัดไปถึงหน้าเว็บ/JSON จริง

## Follow-up จากการทดสอบ Meta จริง 0.6.4

0.6.3 จริงยังตั้งคอลัมน์ไม่ผ่านและจุดเลื่อนถูกปฏิเสธว่าบังอยู่ จึงเพิ่มการเลือกจุดสำรองเฉพาะภายในคอลัมน์/แถวที่มองเห็น ไม่เกิน 24 จุด โดยยังปฏิเสธ controls และพื้นที่นอกตารางเหมือนเดิม `scroll_log.tried` มี `target_diagnostics` แบบจำกัดเฉพาะจำนวนจุด/ชนิด element/role/reason เพื่อแยกเหตุผลโดยไม่เก็บชื่อแอดหรือข้อความหน้าเว็บ

การจับคู่ checkbox ใช้ชื่อ control หรือข้อความหลักของรายการ ไม่เอาคำอธิบาย/ชื่อหมวดหมู่ข้างท้ายมาเป็นชื่อคอลัมน์ การค้นหาตรวจว่าคำค้นคงอยู่และรอรายการที่ตรงกันจริงในกรอบเวลาเดิมก่อนเปลี่ยน alias; รายการว่างชั่วคราวไม่ใช่หลักฐานว่าค้นเสร็จ ตรวจ query ซ้ำก่อนส่ง input และตรวจ required fields ซ้ำก่อน Save

คอลัมน์ Account ID ในมุมมองรายงานเป็น optional เพราะบางหน้าไม่มีตัวเลือกนี้ **บัญชีที่ผูกไว้และ act ใน URL ยังต้องตรงกันทุกครั้ง** ไม่ได้ยกเลิกการตรวจบัญชี ส่วน Campaign/Ad Set/Ad IDs, spend และตัวเลขจำเป็นตามเป้าหมายยัง required เก็บ optional fields ที่เห็นอยู่ได้ แต่ไม่ใช้เวลาค้น optional ที่หายไปจนหมดเวลาก่อนตรวจข้อมูลจำเป็น

ใช้ `npm run test:report-probe`, `test:report-columns`, `test:report-input` และ `test:reader` ตรวจ regression ที่เกี่ยวข้อง การผ่าน fixture ไม่ใช่ live acceptance ของ 0.6.4; ต้อง Reload และอ่านรุ่นจาก state/snapshots ใหม่ก่อนอ้างผล Meta จริง

## การแก้ครบเส้นทางข้อมูล 0.6.5

- การเลื่อนแนวนอนเลือกหัวคอลัมน์ตัวเลขกับตัวตารางที่มีหลักฐานเซลล์คร่อมหลายแถว ไม่เลื่อน pane ชื่อที่ตรึงไว้หรือฟอร์มอื่น มี diagnostics ตัวเลข/ชนิด container สำหรับตรวจการจับคู่ และยังปฏิเสธ header/body ที่ไม่ตรงกัน
- Native wheel ลองได้สูงสุด 4 column bands ที่คำนวณในหน้าใหม่ทุกครั้ง ภายใต้ deadline/lease/account/tab/job เดิม ถ้าตัวเลขขยับแต่แถวตัวตนยังไม่เปลี่ยน จะรอแบบจำกัดแล้วหยุด `reporting_body_moved_rows_unverified` ไม่ถือว่าเก็บหน้าถัดไปได้
- `row_alignment=aligned|mismatch|unverified` เป็น shared contract; offset แนวตั้งที่ขัดกันหรือ transform ที่ยืนยันไม่ได้ทำให้ geometric mapping ไม่ผ่าน และ core ทั้งวิเคราะห์/ยกข้อมูลปฏิเสธด้วย แม้แถวนั้นอ้าง semantic/verified_geometry ข้อมูลที่ปนจากภาพผิดแนวจะไม่ถูกฟื้นความน่าเชื่อถือด้วยภาพถัดไป
- เมื่อ IDs ทั้งสามอยู่ในคอลัมน์ที่อ่านได้ ระบบเก็บ parent campaign/ad set IDs ด้วย ไม่ต้องอาศัยลิงก์เท่านั้น แต่ IDs จากคอลัมน์/ลิงก์ที่ขัดกันยังเป็น unknown ไม่ใช้ชื่อเป็น ID
- Report probe ตัดตัวเลือกที่ถูก ancestor clip/overlay ออกจากหลักฐาน selected, ใช้เฉพาะ busy marker ที่มองเห็น และอิงภาษาของ dialog แทน aria ของช่องค้นหาที่อาจเป็นอังกฤษ คงการปฏิเสธ checkbox ที่กำกวมจริง
- Trace มี phase/field และเก็บช่วงต้นกับผลล่าสุดภายใน 200 entries เพื่อไม่ตัดเหตุผลที่ final verification ล้มเหลว มี diagnostics แบบ counts/booleans ไม่ส่ง arbitrary selectors/JavaScript/CDP จาก Backend

### ยืนยัน scope ในหน้าข้อมูลจาก Extension

เมื่อ snapshot ขาดข้อมูล scope ผู้ใช้ตรวจหน้า Meta แล้วเลือกยืนยัน **ไม่มี Breakdown** / **ไม่มีตัวกรองรายงาน** ได้ในฟอร์มตรวจข้อมูลเดิม ช่องเริ่มต้นไม่เลือกและรีเซ็ตเมื่อเปลี่ยนภาพ/บัญชี API ใช้ shared `operatorContextSchema` โดย `confirm_no_breakdown` / `confirm_no_filters` รับเฉพาะ `true` ที่ส่งมาอย่างชัดเจน การยืนยันนี้เป็นคำอธิบายข้อมูล ไม่ใช่การเปิดสิทธิ์ควบคุม Meta

Flags เติมได้เฉพาะ unknown ไม่ล้าง Breakdown หรือ filter ที่มีหลักฐานขัดกัน ไม่สร้าง ID วันที่ สกุลเงิน การจับคู่แถว หรือ parent IDs ข้อมูลที่มี filter จริงยังไม่ถูกยกเข้า normalized grain จนกว่าจะมี contract รองรับ ใช้ CSV ที่ระบุเงื่อนไขครบในกรณีนั้น

Record ที่ผ่านการยกมี `raw._dom_scope_version`, `_dom_scope_filters`, `_dom_scope_breakdown`, `_dom_identity_source` และ `_dom_scope_provenance` ให้ตรวจย้อนกลับ ส่วน normalized DOM เก่าที่ไม่มีหลักฐานนี้ยังมองเห็นได้แต่ไม่รวมยอด/ให้คำแนะนำ (`dom_scope_unverified`) ไม่มีการล้างหรือเขียนประวัติเดิมทับ

ดูผลจากข้อมูลที่ผ่านการตรวจในเมนู **ข้อมูลวิเคราะห์** แผง raw capture analysis ยังเก็บบริบทที่อ่านได้เดิม จึงอาจยังแจ้ง unknown แม้ผู้ใช้ยืนยันในฟอร์มแล้ว ห้ามตีความคำยืนยันโดยผู้ใช้ว่าเป็นค่าที่ Meta แสดงเอง

ตรวจเพิ่มด้วย `npm run test:report-scroll` (MV3 transport fixture แยก collector timer), `test:captures` (รวม explicit scope confirmation/audit), `test:capture-analysis-web` (default ไม่ติ๊ก/รีเซ็ต/ส่ง flags ตามการเลือกจริง) และ `test:connect` (shipping MV3 package) การผ่านทั้งหมดนี้ยังต้องแยกจากการทดสอบ Meta จริง
