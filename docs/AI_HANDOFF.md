# AI handoff และรูปแบบการพัฒนาระบบ

งานล่าสุดที่ต้องอ่านก่อนเริ่มแก้:
[HANDOFF_OPTIMIZATION_2026-11-18.md](HANDOFF_OPTIMIZATION_2026-11-18.md)

งาน Ads automation/Breakdown รอบล่าสุดมีรายละเอียดส่งต่อที่
[HANDOFF_ADS_AUTOMATION_2026-11-16.md](HANDOFF_ADS_AUTOMATION_2026-11-16.md)

สถานะรวมถึง CSV-first reconciliation และ source separation ณ 17 พฤศจิกายน 2026 อยู่ที่
[HANDOFF_ADS_ANALYSIS_2026-11-17.md](HANDOFF_ADS_ANALYSIS_2026-11-17.md)

เอกสารส่งต่องาน ณ 18 พฤศจิกายน 2026 อ้างอิง source/build Extension 0.6.47 ให้ตรวจ source และ package scripts ทุกครั้งก่อนใช้ เพราะเวอร์ชันแต่ละ package อาจต่างกัน

0.6.42 เพิ่ม `report.collect` typed workflow (navigate → prepare report columns → start Ads collection ภายใน Extension command เดียว), Ads-only parent-name materialization, job-level `/captures/jobs/:job/review`, paged/scoped `/export`, PostgreSQL `/insights/trend`, และ Report Studio materialize/context flow. Ads captures ที่มี ID + ชื่อ Campaign/Ad Set ในคอลัมน์สามารถ upsert parent entities ได้โดยไม่ต้องอ่าน hierarchy ก่อน. Report Studio poll เฉพาะงานที่กำลังรันและซ่อน observed rows จากกราฟเป็นค่าเริ่มต้น. ห้ามถือว่า parent name จาก Ads row เป็นหลักฐาน ID; parent IDs ยังต้องมาจาก stable columns/links. Live 0.6.42 พบว่า workflow ถูกส่งถึง Extension แต่ trusted report-input guard ปฏิเสธเพราะแท็บ Meta ไม่ active. 0.6.43 activate/focus/maximize ช่วงเริ่ม workflow แต่ live rerun ยัง fail ระหว่าง dialog; 0.6.44 re-activate bound tab ก่อน trusted input ทุกครั้งจน workflow ผ่าน. Live 0.6.44 พบว่า native custom-scrollbar reset รอ signature ทั้งตารางจน `reporting_view_changed_before_input` จาก metric refresh ทำให้เริ่ม scroll ผิดตำแหน่ง; 0.6.45 จำกัด reset stability เฉพาะ scrollbar geometry และยังยืนยัน row movement หลัง drag. Live 0.6.45 job `67c9bf13-99ba-47b6-95a5-a7ce8e54c4ba` อ่าน 40/40 Ads, 3 snapshots, 87 observations, verified IDs 40, unresolved 0 และ `coverage=complete` สำหรับ scope นี้; materialization ได้ 74 promoted rows และ 35 unique normalized observations โดย 8 raw rows ยังขาด Impressions ตามจริง.

Report Studio เพิ่ม CSV-vs-DOM reconciliation ผ่าน `packages/core/src/reconciliation.ts` และรายงานแยก matched IDs/dom-only/csv-only พร้อม Spend/Results deltas เฉพาะ context ที่ตรงกัน. เพิ่ม `report_preferences` (migration `005`) สำหรับ target CPA/ROAS ต่อ account; กราฟใช้เป็น reference line เท่านั้น ไม่สร้างคำแนะนำอัตโนมัติ. `/export` ไม่ควรถูกใช้เป็นแหล่งเทียบทั้งบัญชีโดยไม่มี filter; reconciliation ต้องใช้ stable IDs และไม่รวม metrics จากสอง source.

0.6.46 เพิ่ม fast refresh ใน `report.collect`: อ่าน rendered headers ก่อน ถ้า blocking columns ครบและไม่มี extra headers จะ reuse view และข้าม dialog. Report Studio เพิ่ม persistent normalized coverage จาก `/captures/jobs/:job/materialization` เพื่อแสดง verified Ads เทียบ normalized Ads/observations และ reason ที่ยัง block. Scale fixtures ครอบคลุม 500 Ads และ daily trend 365 วัน.

Live 0.6.46 fast refresh ใช้ command เพียง 2.68 วินาที แต่ coverage ลดเหลือ 31/40 เพราะ start ปล่อย alarm รอบก่อนทำงานก่อน read zoom/layout พร้อม. 0.6.47 clear collect alarm, apply zoom แล้วเรียก `advance()` ทันทีหนึ่งครั้งก่อนสร้าง alarm รอบถัดไป; Fast mode ต้องยืนยัน 40/40 ก่อนถือว่าผ่าน.

Live 0.6.47 fast-refresh passed: job `148d1780-4877-49eb-a52d-0ed657a807b5` collected 40/40 Ads in two snapshots with 58 raw observations, verified IDs 40, unresolved 0, no blockers and `coverage=complete`. `report.collect` completed in 7.92 seconds versus 122.05 seconds for the full-prepare path. Materialization produced 50 promoted raw rows and 35 unique normalized observations; remaining rows stayed `needs_review` because Meta omitted Impressions.

Database-first report cache: `006_capture_report_cache` stores the fully analyzed Report per capture job and canonical operator context. Materialization/review writes the cache; `/captures/analysis` returns it without replying on CSV or reparsing raw snapshots. Cache is invalidated whenever new snapshots are stored. Live 40-Ad job measured 31 ms cold analysis and 3.68 ms cached response.

Multi-account hardening uses migrations `007_managed_accounts` and `008_customer_access`: managed account/customer registry, SHA-256 API client tokens, admin/operator/viewer roles, per-account health/acceptance and disable gating. Local `API_TOKEN` remains bootstrap admin. Non-admin requests are rejected when Account/Device/Capture job ownership does not match the client customer. UI account health is at `/#accounts`; client tokens are one-time display and never stored plaintext.

Operations hardening adds migration `009_operations_hardening`: `admin_audit_log` records customer/account/token changes and scheduled collection queueing; `account_collection_schedules` stores an opt-in read-only `report.collect` schedule per account. The scheduler requires an enabled account/customer, a fresh Device with `report_input=true`, and no pending/running command. It retries errors at most three times with a bounded delay and never changes a Meta ad. Account health now reads normalized Ads from the latest capture job, not all historical jobs, and does not mark an account fully ready when its Device heartbeat is stale.

Customer isolation is enforced for all client-token roles, including a Customer-scoped `admin`: it cannot list other Customers. Disabling an account or Customer blocks state ingestion, imports, analysis previews, commands and report operations, and also disables configured schedules. Existing local admin can still inspect historical raw data. Live health and UI must still be rechecked after using a newly switched Meta account; account acceptance is never inherited from another account.

CSV-first analysis รอบ 17 พฤศจิกายน 2026 เพิ่ม `reconciliation` และ `scope_coverage` ใน shared import contract: การกระทบยอดจำนวนแถว/Spend ยืนยันเฉพาะ scope ของไฟล์ ไม่ยกระดับ `coverage` ทั้งบัญชีจาก `unverified` Backend ประทับ `raw._import_reconciliation` หลัง validation และ Analysis แยกกลุ่ม `csv`/`dom_capture`/`unknown` โดยไม่บวกยอดข้ามแหล่ง อย่าลบ proof นี้หรือรวมยอด CSV กับ DOM แม้ ID/เงื่อนไขจะตรงกัน; รายละเอียดและผลทดสอบอยู่ใน [ANALYSIS.md](ANALYSIS.md) และ [VALIDATION.md](VALIDATION.md)

0.6.6 เพิ่ม read-only orchestrator `npm run ads:agent` ที่ตรวจ device/version/account, navigate, เรียก report setup, เริ่มเก็บ Ads, รอ PostgreSQL capture และสรุปผลวิเคราะห์; เพิ่ม Thai/partial search aliases และ bounded candidate diagnostics. Live probe พบว่า spend ถูกเลือกแต่ final recheck ทำให้หลุด, link clicks ถูก clip และ messaging ไม่มีคอลัมน์เดี่ยวใน UI ไทย

0.6.7 แยก blocking capture fields (ชื่อ, IDs, spend, impressions, results, cost per result, attribution) จาก goal metrics เสริม (link clicks, messaging, purchases/leads/value) เพื่อให้ report setup Save view ที่ใช้งานได้และรายงาน metric ที่ขาดใน `missing_goal_metrics` โดยไม่เดาค่า

0.6.8 แยกผลลัพธ์ generic ออกจากตัวเลือก ROAS ที่ใช้ชื่อซ้ำ และจำ query ที่เลือกสำเร็จเพื่อใช้ใน final recheck

0.6.9 เลือก Spend จาก context `ผลลัพธ์และการใช้จ่าย/เงินใช้จ่าย` และตัดตัวเลือก Spend percentage ที่ใช้ชื่อซ้ำ

0.6.10 เพิ่ม native horizontal wheel fallback สำหรับ Meta grid ที่ DOM scrollLeft ใช้งานไม่ได้ ตรวจ header projection และ horizontal offset ว่าเปลี่ยนจริงก่อนถือว่าอ่านคอลัมน์ใหม่ได้

0.6.11 maximize หน้าต่าง Meta ก่อน start/resume เพื่อเพิ่มโอกาสที่ stable IDs และ metrics อยู่ใน horizontal slice เดียวกัน; ยังไม่อนุญาตให้ join ข้าม slice ด้วยชื่อหรือตำแหน่ง

0.6.12 แก้ vertical cycle ที่เคยหยุดเมื่อ horizontal slice สุดท้ายไม่เปลี่ยนภาพ และใช้ zoom-out ชั่วคราวระหว่างอ่านเพื่อเพิ่มโอกาสที่ Results/Impressions/Spend/IDs อยู่ในภาพเดียว; คืน zoom เดิมเมื่อจบ/pause/error

0.6.13 ลด temporary read zoom จาก 0.7 เป็น 0.5 หลัง live0.6.12 พบว่า ID/Spend อยู่ด้วยกันแต่ Results/Impressions ยังอยู่นอก slice

0.6.14 เพิ่ม `breakdown.prepare` สำหรับมิติ age/gender/platform/placement ผ่าน trusted UI input ภายใต้ report lease; ตัวเลือก exact และ clearing ถูกจำกัด, ไม่รับ selector จาก Backend, และไม่ถือว่า breakdown เท่ากับ filter

0.6.15 ปรับ Breakdown matcher จาก DOM จริง: listitem กับ checkbox แยกกัน, alias `ตำแหน่งโฆษณา`, และ trusted search ภายในเมนูสำหรับมิติที่ถูกซ่อน เช่น เพศ

0.6.16 จำกัดการจับคู่ checkbox ให้อยู่ในคอลัมน์เดียวกับ listitem ของ Breakdown หลัง live0.6.15 คลิก checkbox แถว Ads ที่อยู่แกน Y เดียวกัน

0.6.17 รับ Breakdown trigger label ที่มี suffix จำนวนรายการ เช่น `ข้อมูลแยกย่อย: เลือกแล้ว 1 รายการ`

0.6.18 ใช้ URL parameter เป็นหลักฐานยืนยัน Demographic Breakdown หลัง checkbox rerender และบังคับว่า Age/Gender ซึ่งอยู่ใน `demographics_breakdown` เดียวกันต้องเลือกทีละค่า

0.6.19 พา validated `*_breakdown` query จากหน้าปัจจุบันเข้า job URL และทุกการเปลี่ยนหน้า/vertical cycle; ก่อนหน้านี้ start ตัด Breakdown ออกทำให้ reader เห็นเฉพาะ parent rows

0.6.20 เพิ่ม bounded read-only breakdown row diagnostics เพื่อตรวจว่า Meta ซ้อนค่ามิติใน subrow ใดและมี ID/cells/switch อยู่ใน ancestor ใด ก่อนทำ promotion mapping จากโครงสร้างจริง

0.6.21 map Age/Gender breakdown subrows ตามแกน Y ใต้ stable-ID parent row, อ่าน metric cells จากแถว subrow ตาม header และสร้าง grain แยกมิติโดยไม่ใช้ชื่อหรือตำแหน่งเป็น identity ข้ามหน้า

0.6.22 copy status/result type จาก stable-ID parent ไปยัง breakdown subrow โดยไม่คัดลอกยอดรวม, ยืนยัน row-level breakdown แม้ page base เป็น null, และรอ busy marker ของ Meta ก่อนเปิด Breakdown menu

0.6.23 prune คอลัมน์รายงานส่วนเกินที่ค้างจาก preset เดิมผ่าน trusted UI ก่อน Save, รอ column menu พร้อมสูงสุด 15 วินาที, ตรวจการล้าง search และยืนยันว่าไม่มีคอลัมน์นอก allowlist ก่อนบันทึก; เริ่ม horizontal scan เฉพาะเมื่อมี overflow จริงเพื่อหยุด diagnostic loop หลังอ่าน slice ครบ. Agent แสดง `report_columns.pruned` เพื่อระบุคอลัมน์ที่ถูกนำออก

0.6.24 แก้ live failure ของ 0.6.23 ที่ Meta แสดง Reach สองรายการชื่อเดียวกัน: prune matcher เลือกเฉพาะ exact label ที่ checked อยู่แล้ว, ใช้ trusted input กับ candidate ที่ระบุ และยืนยันการปลดด้วย label + context หลังคลิก. เพิ่ม fixture duplicate Reach เพื่อไม่ให้ unchecked variant ถูกสลับหรือทำให้ matcher เป็น ambiguous

0.6.25 แก้ live failure ของ 0.6.24 ที่ checkbox ที่ต้อง prune ถูก clip อยู่นอก scroll pane แม้ search แคบแล้ว: probe รายงาน scroll container ภายใน dialog, ใช้ trusted mouse wheel เลื่อนเฉพาะ column list, เลือก candidate ที่ checked ตรง label + context และยืนยันสถานะหลังคลิก. Fixture บังคับ list สูง 2 แถวเพื่อทดสอบ clipping จริง

0.6.26 แก้ live failure ของ 0.6.25 ที่ยังหา scroll container ไม่ครบ: รองรับกรณี dialog เองเป็น scroller/fallback และยืนยันจุดคลิกด้วย hit-tested field probe แทนพิกัดจาก checked list อย่างเดียว. Trace เก็บ choice_scroll, match count และสถานะ target หลังคลิก; fixture clipping ผ่าน

0.6.27 แก้ live failure ของ 0.6.26 ที่ Meta เปลี่ยน context ของตัวเลือกหลัง trusted search: prune จับคู่ label + checked state แทน context และยืนยันผลหลังคลิกด้วยการตรวจว่าไม่มี checked choice ที่ใช้ label เดิมเหลืออยู่ จึงไม่สลับกับ duplicate sibling ที่ unchecked. Fixture เปลี่ยน context ของ Reach หลังคลิกและยัง prune ผ่าน; ยังต้อง reload และยืนยันกับ Meta จริง

0.6.28 แก้ live failure ของ 0.6.27 ที่ `report.prepare` สำเร็จแต่ `start` navigate ซ้ำไปยัง reporting URL ทำให้ Meta reset transient column view: เพิ่ม `needsReportingNavigation` ให้ใช้แท็บเดิมเมื่อ host/route/account/level/validated `*_breakdown` ตรงกัน และยัง foreground/maximize แท็บก่อนเริ่มอ่าน. Unit test ครอบคลุม route ต่างระดับ บัญชีต่าง ค่า Breakdown ต่าง/ซ้ำ และ query ที่ไม่ผ่าน allowlist

0.6.29 ปิด false-positive ของ `report.prepare`: ใช้ rendered column headers เป็นรายการคอลัมน์ส่วนเกินที่อาจไม่ถูก render ใน dialog, รองรับ choice row แบบ div/ซ่อนอยู่ใน category, prune ด้วย trusted search/checkbox และตรวจ header จริงหลัง Save. `applied=true` ได้เฉพาะเมื่อ blocking fields ปรากฏบนตารางและไม่มี header ส่วนเกินค้างอยู่; dialog ปิดอย่างเดียวไม่ถือว่าสำเร็จ

0.6.30 แก้ live failure ของ 0.6.29: Meta แสดงแผง `เลือกไว้ N คอลัมน์` พร้อมปุ่มลบต่อแถว ซึ่ง probe แบบ checkbox มองไม่เห็น. เพิ่ม read-only `selected_columns` probe ที่อ่านชื่อคอลัมน์และพิกัดปุ่มลบภายในแผงเท่านั้น แล้ว prune ผ่าน trusted click ทีละรายการพร้อม scroll; fallback checkbox path ยังคงอยู่สำหรับ layout ที่ไม่มีแผงนี้. `ปิด / เปิด` (สถานะการนำส่ง) ถูกเก็บไว้ ไม่ถูกนับเป็นคอลัมน์ส่วนเกิน. Live 0.6.30 ผ่าน column setup/Age mapping และสร้าง 6 Age scopes พร้อม ID/Spend/Impressions/Results/result type; coverage ยัง partial จาก `visible_rows_unchanged` และ Attribution หลายบรรทัด จึงไม่ถือว่า complete หรือเต็มบัญชี

0.6.31 แก้หลักฐาน Age subrow ที่ทำให้เกิด scope เทียม: จับกลุ่มข้อความตาม cell owner (left edge + ความสูงของ cell) แทนการเดาคอลัมน์จากพิกัดของแต่ละบรรทัด จึงเก็บ Attribution หลายบรรทัดครบและไม่ย้ายบรรทัด `หรือการดูในช่วง` ไปเป็นชื่อชุดโฆษณา. เพิ่มการ normalize Attribution ซ้ำ/หลายลำดับใน shared analysis ให้อยู่ใน scope เดียว และเพิ่ม `reporting_bottom_reached` เมื่อ scroll owner อยู่ท้ายตารางจริง โดยไม่รายงานเป็น `visible_rows_unchanged`. Fixture ผ่านทั้ง cell ownership, dedupe และ bottom detection; live 0.6.31 ภายหลังไม่ผ่าน coverage acceptance เพราะ paging ค้างที่หน้าสุดท้าย

0.6.32 แก้ live coverage failure ของ 0.6.31: งานก่อนหน้าทิ้ง virtualized body ไว้ท้ายตาราง งานใหม่จึงจับเฉพาะ Ads ห้าตัวสุดท้ายซ้ำ และ scroll log นับว่า moved เพราะ fingerprint มี `scroll_top`. รุ่นนี้ reset reporting rows ที่ `step === 0`, re-query แถวหลัง repaint ก่อน `scrollIntoView`, และใช้เฉพาะจำนวนแถวกับ stable identities เป็นหลักฐาน paging; body offset ที่เปลี่ยนแต่ identities เดิมจะคืน `reporting_body_moved_rows_unverified`. Fixture ผ่านทั้ง reset-from-bottom และ identity-stable false paging; live acceptance ต้อง reload 0.6.32 และรัน Age ซ้ำ

0.6.32 live หลัง reload ไม่ผ่าน coverage acceptance: 20 snapshots จบ `needs_review`, ยังได้ 2–5 verified Ads ต่อ Age scope จาก 40 แถว และมีเพียงห้า parent Ad IDs. จำนวนแถวที่มองเห็นสลับ 24/21 เพราะแถวหนึ่งหลุดขอบ จึงทำให้ `scroll_log` ทั้ง 19 รายการเป็น false positive. `row_reset` รายงาน `already_at_start` เพราะ diagnostics ไม่พบ body scroller. 0.6.33 จึงบังคับหลักฐาน paging เป็น identity ใหม่ผ่าน `row_fingerprints`, ลดการนับ row count/`scroll_top`/hover เป็น movement, ขยาย native wheel plan ไปยัง gutter ขวาและคอลัมน์ที่ปลอดภัยโดยคง strict control exclusion, จำกัด 10 targets/60 probes/12 วินาที และให้ gutter target มี band index ไม่ซ้ำ. Fixture ผ่านครบ; live acceptance ของ 0.6.33 ยังต้อง reload และรัน Age ใหม่

0.6.33 live หลัง reload ยังไม่ผ่าน: ได้ 1 snapshot, จบ `needs_review`, ยังเป็นห้า parent Ad IDs และ `visible_rows_unchanged`. scroll log แสดง target ทั้ง 10 เป็น metric bands, `body_offsets` ว่างทั้งหมด และไม่ได้ probe gutter/scrollbar เพราะ gutter คำนวณจาก `scopeRect.right` ที่อาจอยู่นอกจอ และ loop gutter ทำงานหลัง metric bands ใช้ budget 10 ครบแล้ว. 0.6.34 จึง probe `[role="scrollbar"]` และ gutter จาก visible right edge (`min(scopeRect.right, innerWidth)`) ก่อน column bands, เพิ่ม `scroll_diagnostics` (scope rect, visible right, scrollbar geometry, body target count) และมี fixture ตารางกว้าง 12 metric columns + scrollbar ที่มองเห็นเพื่อยืนยันว่า body target ยังได้ budget. ต้อง reload 0.6.34 และรัน Age ใหม่ก่อนอ้าง acceptance

0.6.34 live ยังไม่ถึง collection เพราะ `breakdown_input_timeout` สองครั้ง ทั้งที่ URL มี `demographics_breakdown=age` แล้ว: เมนู Breakdown ค้างเปิด, มี Columns search ที่มองเห็น, และ setup ยังวนค้นหาทุกมิติแทนที่จะรับสถานะที่ apply แล้ว. 0.6.35 จึง early-return เมื่อ requested dimensions active ครบและไม่มีมิติอื่น active, ปิดเมนูที่เปิดด้วย guarded Escape, ข้ามมิติที่ไม่ requested/ไม่ active ก่อน search, และตรวจ loading เฉพาะ progressbar/`aria-busy` ที่มองเห็นแทนการสแกน body text ทั้งหน้า. Fixture ยืนยันว่า setup Age ซ้ำไม่สร้าง trusted click เพิ่ม; live acceptance ยังต้อง reload 0.6.36

0.6.35 live ยืนยัน Breakdown fix (`ok=true`, menu ปิด) แต่ collection ด้วย `--no-scan-columns` ค้างที่ `step=1` เกินห้านาทีโดยไม่มี `scroll_log` เพราะ debugger promise ของ native wheel ไม่ resolve และ worker `busy` ค้าง. 0.6.36 จึงห่อ `attach`/`sendCommand`/`detach` ด้วย timeout 6 วินาทีและคืน reason `debugger_*_timeout`; fixture ที่ทำให้ `sendCommand` ไม่ resolve ยืนยันว่ากลับภายใน 20 วินาที. ต้อง reload 0.6.36 และรัน Age ด้วย `--no-scan-columns`

0.6.36 live ผ่านเรื่อง timeout: collection จบโดยไม่ค้าง แต่ได้ snapshot เดียวและ `needs_review`; ทุก paging attempt คืน `visible_rows_unchanged` จึงยังเห็น parent Ad IDs แค่ห้าตัวแรกในหลาย Age scope เทียบ footer 40 แถว. หลักฐาน DOM ชี้ว่า Meta ใช้ custom vertical scrollbar ด้านขวาเป็น `div` แคบ/สูงที่ไม่มี `role="scrollbar"` และไม่ใช่ ancestor ของ rows จึงไม่ปรากฏใน `body_offsets`. 0.6.37 จึงตรวจ custom track/thumb จาก geometry ภายใน reporting scope และส่ง trusted CDP mouse drag ภายใต้ lease/account/job guards ทุกคำสั่ง; นับ movement เฉพาะเมื่อ row fingerprints มี identity ใหม่และคืน `native_scrollbar_drag`. ต้อง reload 0.6.37 แล้วรัน Age ซ้ำก่อนอ้าง coverage/live acceptance

0.6.37 live รอบแรกได้ 8 snapshots และ coverage 26–35 แถวต่อ Age scope แต่ DOM paging ผ่าน 7 ครั้งแล้ว native path timeout ที่ step 8 เพราะ deadline 12 วินาทีสั้นเกินไป. รอบสองบน view เดิมได้ snapshot เดียวและ probe ไม่เห็น scrollbar (`attempted_scrollbar=false`, no candidates) แม้ไม่มีการเปลี่ยน row identity. Fixture/DOM ยืนยันว่า custom scrollbar ของ Meta ถูกเปิดเผยหลัง pointer hover. 0.6.38 จึง re-probe หลัง trusted hover ทุก target, drag thumb ที่เพิ่งปรากฏก่อน wheel, และขยาย overall deadline เป็น 30 วินาทีโดยคง debugger timeout 6 วินาทีต่อคำสั่ง. Live acceptance ต้อง reload 0.6.38 และรัน Age ใหม่

0.6.38 live หลัง reload และเปิด lease ใหม่ยังไม่ผ่าน coverage: one snapshot, `needs_review`, ห้า parent Ad IDs ชุดเดิม, `visible_rows_unchanged` และ `attempted_scrollbar=false`; ไม่มี scrollbar candidates/geometry. `payment_error=true` ยังเป็น diagnostic เท่านั้นและไม่มี payment recommendation. การตรวจ DOM ชี้ว่า custom scrollbar อาจเป็น sibling ของ reporting scope จึงอยู่นอกขอบเขตที่ 0.6.38 ค้นหา. 0.6.39 ค้นหา track ใน reporting ancestors สูงสุดสี่ชั้น, เพิ่ม right-edge hover points ก่อน target budget เต็ม และไม่ส่ง wheel ซ้ำบน hover-only target; fixture วาง track นอก scope และผ่าน trusted hover → drag → identity change → detach. ยังต้อง reload 0.6.39 และรัน Age ด้วย `--no-scan-columns` ก่อนอ้าง coverage/live acceptance

0.6.39 แยก `payment_error` เป็น delivery diagnostic เท่านั้น: เก็บ `delivery_observation_counts.payment_error` และ `analyzeCaptureJob().payment_error` ไว้ดูหลักฐาน แต่ไม่สร้าง recommendation, ไม่จัดอันดับ และไม่บล็อกการประเมินผล เพราะผู้ใช้ยืนยันว่าเมื่อเติมเครดิตโฆษณา ข้อความนี้จะหายไป. ห้ามนำ `payment_error` กลับมาเป็น critical/blocker เว้นแต่ผู้ใช้เปลี่ยนข้อกำหนด

0.6.39 live หลัง reload/lease ผ่านการตั้งคอลัมน์และ Age Breakdown แต่ยังได้หนึ่ง snapshot และ `needs_review`. Diagnostics พบ custom scrollbar จริง (`attempted_scrollbar=true`, track 1102px, thumb 131px) แต่ thumb อยู่ท้ายราง จึงไม่สามารถ drag ลงเพื่อเปิดแถวใหม่ได้. 0.6.40 เพิ่ม native reset ที่ลาก thumb ขึ้นบนสุดก่อน snapshot แรก, เปิดเผย `track_top`/`thumb_top`/`at_top`/`at_bottom`, ยอมรับ reset เฉพาะเมื่อ thumb ถึงบนและ row signature เปลี่ยน, และมี fixture ที่เริ่มจาก thumb ท้ายราง.

0.6.40 live หลัง reload/lease ด้วย job `b344acdc-1d78-467c-a27f-b0056021c642` ดีขึ้นเป็น 8 snapshots, 196 observations และ 35 unique parent Ad IDs แต่ยังจบ `needs_review`; coverage ต่อ Age scope เทียบ footer 40 แถวเป็น 18–24: 34, 25–34: 35, 35–44: 32, 45–54: 26, 55–64: 26 และ 65+: 27 ทุก scope ยัง partial ห้ามรวมยอดหรืออ้าง whole-account coverage. Steps 1–2 เลื่อนด้วย wheel, steps 3–7 ด้วย `scroll_into_view`, step 8 คืน `visible_rows_unchanged`. Native reset ยัง fail ด้วย `reporting_view_changed_before_input` ขณะที่ DOM reset รายงาน `already_at_start`; custom scrollbar ที่ step 8 มี track top 311 สูง 1102, thumb top 1277 สูง 131 และ thumb bottom ห่างท้ายรางเพียง ~5px แต่ `at_bottom` เดิมใช้ tolerance 2px จึงไม่ถูกนับว่าถึงท้าย. `payment_error=true` ยังเป็น diagnostic และไม่มี payment recommendation; `missing_goal_metrics` คือ `link_clicks`, `messaging_conversations`.

0.6.41 แก้จุดที่ทำให้ step สุดท้ายตีความผิด: ใช้ edge tolerance แบบจำกัด 8px สำหรับ native body และ custom scrollbar, ให้ `target_diagnostics.at_bottom` นับ custom scrollbar ที่ถึงท้ายด้วย, และหลัง debugger attach จะ rebase เฉพาะเมื่อ view นิ่งติดกันสอง probe; view ที่ยังเปลี่ยนต่อเนื่องยัง fail closed. Fixtures เพิ่มเคส thumb เหลือช่องว่าง 5px และ repaint หนึ่งครั้งหลัง attach ก่อน reset สำเร็จ. ต้อง reload 0.6.41, เปิด lease ใหม่ และรัน Age ด้วย `--no-scan-columns` ก่อนอ้าง live acceptance

0.6.41 live หลัง reload/lease ด้วย job `047d3c3e-64c5-447c-bdc1-ed25727550a2` ผ่าน native reset (`reset=true`, `native_scrollbar_drag`, `at_top=true`) และ step 8 คืน `reporting_bottom_reached` (`at_bottom=true`, `attempted_scrollbar=true`) แทน `visible_rows_unchanged`; job มี 8 snapshots, 198 raw Age observations, 35 unique parent Ad IDs และ `level_warnings=[]`. `report.prepare messages` ได้ `applied=true`, `missing_required=[]`, `missing_goal_metrics=["link_clicks","messaging_conversations"]`. Analysis สร้าง messaging result group และอันดับทุก Age scope (eligible 8/9/4/2/2/2) โดยไม่มี blocker ด้าน column/identity/timezone/filter; ตัวอย่าง best คือ MLBB ที่ ฿12.08 CPA ใน 18–24 และ MLBB/Free Fire/Rov/PUBG Mobile ที่ ฿7.21 ใน 55–64. Verified rows ต่อ Age คือ 34/35/32/26/26/27 และ footer 40 เป็นยอดรวมของรายงาน ไม่ได้ยืนยันตัวหารแยกต่อ Age; ห้ามอ้าง complete whole-account หรือรวมยอดข้าม Age. `payment_error` ยังเป็น diagnostic และไม่มี recommendation

0.6.41 analysis coverage semantics (core/API/web, ไม่ต้อง reload Extension): `LevelAnalysis.reported_total_scope` ระบุว่า footer อ้างทั้งรายงาน (`report`) หรือตรง scope นี้ (`partition`); Breakdown partition จึงได้ `coverage=lower_bound` แทน `x/40` และ UI แสดง “ยืนยัน ID ได้ N แถว (ขั้นต่ำของกลุ่มนี้)” พร้อม recommendation `partition_total_unverified`. Web panel เพิ่มตัวเลือกยืนยัน timezone, attribution, ไม่มีตัวกรอง และไม่มี Breakdown แล้วส่งเป็น query ให้ `/captures/analysis` เฉพาะค่าที่ผู้ใช้ยืนยัน; live browser check ยืนยันว่าเมื่อเลือก Asia/Bangkok + no filters ระบบแสดง result group และอันดับได้ (ก่อนหน้านี้ web ถูกบล็อกแม้ `ads:agent` จัดอันดับได้). ห้ามนำผลรวมของ Age rows ไปแทนยอดรายงานหรือสร้างตัวหารเฉพาะกลุ่มด้วยการเดา; ต้อง restart API/web เพื่อใช้การเปลี่ยนแปลงนี้

0.6.5 แก้ pane selection ของการเลื่อน, horizontal header/body pairing, vertical row_alignment, parent IDs จากคอลัมน์, visible-only report controls/busy markers และปิดทางยก DOM ที่ไม่ยืนยัน scope ไปเป็น normalized data; เพิ่มการยืนยันว่าไม่มี Breakdown/ตัวกรองโดยผู้ใช้ในฟอร์มตรวจข้อมูลเดิม (default ไม่เลือก) ดู ANALYSIS.md และ VALIDATION.md ก่อนอ้างความพร้อม ต้องยืนยัน runtime/snapshot0.6.5 และผลจริงใหม่ เพราะผล live0.6.4 ด้านล่างยังเป็น failed acceptance ไม่ใช่หลักฐานว่ารุ่นใหม่ผ่าน

Live 0.6.3 หลังผู้ใช้ Reload: inspect ผ่าน แต่ report.prepare ไม่ผ่าน required fields และ native paging ถูกปฏิเสธ `reporting_target_occluded`; ยังไม่รับรองว่าอ่านครบ รุ่น 0.6.4 แก้ตัวเลือกจุดเลื่อนและความถูกต้องของการค้นหา/จับคู่คอลัมน์ ต้องตรวจผลบน Meta หลัง Reload อีกครั้ง ดู VALIDATION.md สำหรับขอบเขตหลักฐาน

Live 0.6.4 ล่าสุด: ยืนยันรุ่นและ report lease แล้ว ตัวเลือกจุดเมาส์ผ่าน guard แต่เลื่อนไม่เผยแถวใหม่ (`visible_rows_unchanged`) ทั้ง 3 ระดับ; Ads ยัง7แถวต่อภาพ/footer40 งานจบ needs_review ตั้งคอลัมน์ซ้ำยัง applied=false ขาด spend/link_clicks/messaging_conversations จึงยังไม่พร้อมประเมินรายแอดจาก DOM จริง การผ่าน fixture ไม่ได้ปิดสองปัญหานี้ ห้ามอ้าง live paging/setup สำเร็จหรือข้าม blockers; ใช้ validated CSV เมื่อต้องการข้อมูลวิเคราะห์ที่ตรวจเงื่อนไขได้

Reliability รอบล่าสุด: อ่าน [ANALYSIS.md ส่วน 0.6.3](ANALYSIS.md#reliability-และการประเมินรายแอด-063) ก่อนแก้ตัววิเคราะห์/reader และอ่าน [ผลประเมินก่อนแก้](ASSESSMENT_2026-11-16.md) เพื่อทราบ regression ที่ต้องรักษา DOM ที่ไม่มี ID หรือบริบท Breakdown/ตัวกรองยังไม่ยืนยันต้องไม่สร้างยอดรวม อันดับ หรือ complete; เทียบชื่อ/ตำแหน่งเพื่อ join ไม่ได้ รายละเอียดเก่าในส่วน 7 เป็นประวัติ ต้องตรวจรุ่น Extension ที่เชื่อมจริงก่อนอ้าง live acceptance. Workflow บอท read-only และข้อจำกัดอยู่ที่ [ADS_AUTOMATION.md](ADS_AUTOMATION.md)

## 1. เป้าหมายและขอบเขต

ระบบช่วยรวบรวมข้อมูล Meta Ads ผ่าน Chrome Extension และนำเข้ารายงาน CSV ลง PostgreSQL เพื่อเตรียมข้อมูลสำหรับวิเคราะห์ ผู้ใช้กำหนดให้ใช้ Extension ควบคุมหน้า Meta เท่านั้น ไม่ใช้ Meta API ส่วน Backend API ในโปรเจกต์นี้เป็น API ของเราเองสำหรับรับคำสั่งและเก็บข้อมูล

ผู้ใช้ต้องการให้ต่อยอดอ่านและดำเนินงานโฆษณาผ่าน UI ได้ แต่ยังไม่มีหลักฐานว่าควบคุม Business Suite ได้ทุกฟังก์ชัน หรือเผยแพร่โฆษณาสำเร็จจริง การทดสอบบัญชีจริงที่ผ่านมาเป็นงานอ่านและปรับมุมมองรายงาน ไม่ได้สร้าง ลบ เผยแพร่ หรือปรับงบโฆษณา

มี deterministic analysis/preview แล้วใน source ไม่ใช่ AI ที่ตัดสินใจยิงแอดเอง อย่าลบโมดูลนี้เพียงเพราะ roadmap รุ่นแรกเลื่อนงาน AI ไว้ภายหลัง

ข้อกำหนดถาวร:

- ไม่เพิ่ม Graph/Marketing API, Meta access token, internal endpoint, network interception หรือการหลบระบบตรวจจับ
- ไม่อ่านหรือส่งออก password, cookie, session credential ของ Meta
- ไม่ข้ามการอนุมัติใน popup หรือเพิ่ม endpoint ให้บอทอนุมัติตัวเอง
- ทำงานในเครื่องเป็นหลัก แต่มี customer/account ownership, role และ token revocation สำหรับการใช้งานหลายลูกค้าบนเครื่องนี้; ยังไม่ได้ออกแบบเป็น public multi-tenant deployment
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
| scripts/ads-agent.ts | Orchestrator read-only: ตรวจ device, navigate, ตั้งคอลัมน์, collect Ads, รอ DB capture และสรุป analysis |
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

Shared command รองรับ start/pause/resume/status, ui.action, ui.navigate, ui.focus, ui.screenshot, report.prepare และ report.collect อ่าน payload จริงจาก control.ts และ BOT.md ก่อนเพิ่มผู้เรียก

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

ทำใน CMD ที่ `C:\BADS\bot-ads` โดยใช้ dependencies ฝั่ง Windows ห้ามใช้ node_modules ร่วม Windows/WSL โดยไม่ติดตั้งใหม่ด้วย npm ของแพลตฟอร์มที่จะรัน หากเรียกจาก WSL ของ workspace นี้ ใช้ `cmd.exe /d /c "npm ..."`

```bat
cd /d C:\BADS\bot-ads
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
cd /d C:\BADS\bot-ads
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

Token ฝั่งเว็บเก็บใน sessionStorage ส่วน account/device preferences อยู่ localStorage อย่านำ token ลง public environment variable หรือ client bundle Local `API_TOKEN` เป็น bootstrap admin และ client token ถูกจำกัดตาม Customer/role. แม้มี tenant isolation แล้ว การเปิด Backend สู่ public network, TLS, identity provider และ production secret management ยังอยู่นอกขอบเขต; อย่าถือว่า public deployment พร้อมใช้งาน

เอกสาร PLAN/VALIDATION มีประวัติหลายรุ่น หากข้อมูลขัดกัน ให้อ่าน source ปัจจุบันและผลทดสอบที่มีวันที่/ขอบเขตชัดเจน แล้วแก้เอกสารให้ตรง อย่าทำให้ความสามารถดูมากกว่าหลักฐาน

## Optimization Loop — migration 010

Migration `010_optimization_loop` adds entity versions, creative metadata,
per-account policies, deterministic recommendations, optimization plans/steps,
action receipts, rollback plans, experiments, outcome observations and campaign
templates. The Recommendation Engine requires a complete Ads scope, one result
type, verified IDs/costs and enough peers; estimated spend is never eligible.

`/#optimization` supports recommendation review, policy editing, plan creation,
plan approval, experiment tracking, Creative metadata, Campaign templates and
latest-capture outcome observation. Plan approval is distinct from local
Extension approval. `automated_meta_mutation` remains false until certified page
adapters and verified readback are implemented. See
[OPTIMIZATION.md](OPTIMIZATION.md).
