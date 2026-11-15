# ระบบข้อมูลวิเคราะห์โฆษณา 0.5.0

## เปิดใช้งาน

หน้าเว็บ: http://127.0.0.1:9321/#analysis → เมนู **ข้อมูลวิเคราะห์**

1. Reload Extension ใน `chrome://extensions` ให้เป็น 0.5.0 แล้วเปิดบัญชี Meta และกด **เชื่อมต่อและทดสอบอ่าน**
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

Reason codes หลัก: `stable_id_unverified`, `parent_campaign_id_unverified`, `parent_ad_set_id_unverified`, `parent_campaign_not_promoted`, `column_mapping_unverified`, `header_body_scroll_mismatch`, `date_range_unverified`, `currency_unverified`, `currency_conflict`, `timezone_unverified`, `attribution_unverified`, `result_type_unverified`, `missing_required_metric:spend`, `csv_observation_exists`, `duplicate_id_in_snapshot`

ข้อจำกัด: เป็น coverage `visible_only`; ภาพหลายช่วงเลื่อนของเอนทิตีเดียวกันใช้ grain เดียวกันจึง UPSERT ไม่ซ้ำ; ช่วงวันที่ต่างกัน (เช่น "30 วันที่ผ่านมา" ของคนละวัน) เป็นคนละ observation และอาจทับซ้อน ห้ามรวมยอดข้าม observation ที่ช่วงวันซ้อนกัน ถ้า preset คอลัมน์ไม่มี spend แถวจะไม่ถูกยกขึ้นเลย

## วิเคราะห์ประสิทธิภาพจาก DOM capture 0.6.1

หน้าเว็บ "ข้อมูลจาก Extension" มีแผง **วิเคราะห์ประสิทธิภาพจากงานอ่านล่าสุด** และ API `GET /captures/analysis?account_id=ACCOUNT_ID[&job_id=JOB_UUID]` (ค่าเริ่มต้นคืองานอ่านล่าสุด) ใช้ `packages/core/src/capture-analysis.ts` ซึ่งเป็น pure function มี unit test

- อ่าน capture ทั้งที่ `needs_review` และยกขึ้นแล้ว แต่ทุกผลมีป้ายกำกับ: ตัวตน (`verified_ids` / `no_stable_ids`), ยอดใช้จ่าย (`reported` / `estimated`), coverage เทียบจำนวนแถวที่ Meta พิมพ์ในแถวสรุป ("ผลลัพธ์จาก N …")
- สถานะการแสดงโฆษณาแปลงเป็น `payment_error`, `off`, `parent_off`, `active`, `learning`, `limited`, `in_review`, `rejected`, `not_delivering`, `completed`, `unknown` ข้อความที่ไม่รู้จักเป็น `unknown`
- ผลลัพธ์ ต้นทุนต่อผลลัพธ์ อิมเพรสชัน งบประมาณ (จำนวน/ต่อวัน/ตลอดอายุ/ใช้งบระดับบน) ค่า "—" หรือไม่มีคอลัมน์เป็น `null` ไม่เป็น 0
- ยอดใช้จ่าย: ใช้คอลัมน์ "จำนวนเงินที่ใช้จ่ายไป" ถ้ามี มิฉะนั้นเป็น **ค่าประมาณ** ผลลัพธ์ × ต้นทุนต่อผลลัพธ์ (`spend_source=estimate_results_x_cost_per_result`) ไม่ถูกบันทึกเป็น spend จริง
- แถวที่ไม่มี ID รวมซ้ำได้เฉพาะเมื่อทุกเซลล์ตรงกันในงานอ่านเดียวกัน (ภาพที่เลื่อนซ้อนกัน) ไม่ใช่ identity และไม่ใช้ข้ามงานอ่าน แถวที่ header/body เลื่อนไม่ตรงกันไม่ถูกจัดอันดับ
- สรุปตามประเภทผลลัพธ์จากผลรวม (ต้นทุนถ่วงน้ำหนัก = ยอดใช้จ่ายรวม / ผลลัพธ์รวม) จัดอันดับด้วยต้นทุนต่อผลลัพธ์เฉพาะแถวที่มีผลลัพธ์อย่างน้อย 5 และประเภทผลลัพธ์หลักเดียวกัน
- คำแนะนำ (มนุษย์ตัดสินใจ บอทไม่เปลี่ยนโฆษณา): ข้อผิดพลาดการชำระเงิน, ตัวที่ปิดอยู่แต่ต้นทุนไม่เกินค่ากลาง, ต้นทุนสูงกว่าค่ากลาง ≥30% (ต้องมีแถวเทียบได้ ≥3), อิมเพรสชัน ≥1,000 แต่ไม่มีผลลัพธ์, ผลลัพธ์น้อย, การแก้ไขที่ยังไม่เผยแพร่, อ่านได้ไม่ครบ, ไม่มีคอลัมน์ spend หรือ ID

ให้ผลวิเคราะห์ใช้ตัดสินใจได้ดีขึ้น: เพิ่มคอลัมน์ "จำนวนเงินที่ใช้จ่ายไป", "ID แคมเปญ", "ID ชุดโฆษณา", "ID โฆษณา" (และ "การตั้งค่าการระบุที่มา") ใน preset ของ Meta และวางไว้ช่วงซ้ายของตารางเพื่อให้อยู่ในจอโดยไม่ต้องเลื่อนแนวนอน
