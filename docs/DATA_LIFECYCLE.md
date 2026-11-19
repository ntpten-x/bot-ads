# Data Lifecycle และ Retention

ระบบไม่เก็บ DOM snapshot ทั้งหมดในน้ำหนักเท่ากัน เพราะบัญชีขนาดใหญ่มี Ads
หลายร้อยรายการและมี snapshot ซ้ำจากการเลื่อนตาราง ระบบแยกข้อมูลเป็น 4 ชั้น:

1. **Ad Catalog**: entity ที่มี stable ID, parent IDs, ชื่อ, สถานะล่าสุด,
   first/last seen และ status history เก็บระยะยาวเพื่อให้รู้ว่ามี Ads อะไรบ้าง
2. **Performance Evidence**: daily observations ที่ผ่าน validation และ monthly
   rollups สำหรับข้อมูลเก่า
3. **Creative versions**: creative metadata เก็บเมื่อ hash/content เปลี่ยน
4. **Raw captures**: DOM/JSON snapshots เก็บช่วงสั้นเพื่อตรวจหลักฐาน

## Policy เริ่มต้น

| ค่า | ค่าเริ่มต้น | ความหมาย |
| --- | ---: | --- |
| `raw_capture_days` | 30 วัน | raw snapshot ที่ promoted แล้วและ job ไม่ได้รันอยู่ |
| `failed_capture_days` | 90 วัน | ใช้เป็นนโยบายสำหรับงานที่ยังมีปัญหา |
| `daily_metrics_days` | 540 วัน | daily observations ก่อนสร้าง monthly rollup |
| `monthly_metrics_months` | 36 เดือน | เก็บ monthly rollup ระยะยาว |
| `entity_version_days` | 730 วัน | prune entity versions เก่าที่ซ้ำ โดยเก็บรายการล่าสุด |

หลักการสำคัญ:

- Ads ที่ปิดหรือ draft ยังอยู่ใน catalog และ status history
- เฉพาะ Ads ที่มีข้อมูลนำส่งและ metrics ที่ผ่าน validation เท่านั้นที่ใช้ใน
  performance ranking
- `payment_error`, `off`, `parent_off` เป็น diagnostic และไม่ถูกนำมาคิด
  KPI/median/ranking/recommendation
- Raw snapshot ที่ `needs_review`, `rejected` หรือ job กำลังรันจะไม่ถูกลบอัตโนมัติ
- Creative และ recommendation/experiment/outcome เป็นข้อมูลเรียนรู้ระยะยาว
- ห้ามลบ monthly rollup เพื่อ "ประหยัดพื้นที่" ก่อนยืนยันว่า daily source
  ถูก rollup สำเร็จ

## Database

Migration `014_data_lifecycle` เพิ่ม:

- `ad_catalog`
- `ad_status_history`
- `ad_performance_monthly`
- `data_lifecycle_policy`
- `data_lifecycle_runs`

`ad_catalog` ถูก upsert จาก stable IDs ระหว่าง materialization แม้แถวจะยังไม่
ผ่าน promotion ด้าน metrics ก็ตาม จึงใช้เป็น catalog ได้โดยไม่ทำให้ unknown
กลายเป็นศูนย์

## API

- `GET /data-lifecycle?account_id=...` แสดง policy, catalog, พื้นที่ raw และ
  รายการที่พร้อม rollup/purge
- `POST /data-lifecycle/preview` เป็น dry-run และบันทึกผลลง
  `data_lifecycle_runs`
- `POST /data-lifecycle/policy` เปลี่ยน policy เฉพาะ local admin

Client token ต้องระบุ `account_id` เพื่อไม่ให้เห็นภาพรวมของ Customer อื่น

## CLI

ตรวจก่อนเสมอ:

```bat
cmd.exe /d /c "npm run data:lifecycle"
```

Apply หลังตรวจผลแล้วเท่านั้น:

```bat
set DATA_LIFECYCLE_APPLY=apply-data-lifecycle
cmd.exe /d /c "npm run data:lifecycle"
```

กำหนดเฉพาะบัญชี:

```bat
set DATA_LIFECYCLE_ACCOUNT=ACCOUNT_ID
cmd.exe /d /c "npm run data:lifecycle"
```

คำสั่ง apply ทำงานใน transaction เดียว:

1. สร้าง/อัปเดต monthly rollup
2. ลบ daily observation เก่าที่ถูก rollup แล้ว
3. ลบ raw snapshot เก่าที่ promoted และ job ไม่ได้รันอยู่
4. prune entity versions ซ้ำโดยเก็บรายการล่าสุด
5. บันทึกผลลง `data_lifecycle_runs`

## สิ่งที่ยังไม่ทำอัตโนมัติ

- ไม่มี cron ลบข้อมูลในรอบนี้; ต้องเรียก dry-run/apply จากผู้ดูแล
- ยังไม่ decompress/archive raw capture ไป object storage
- ยังไม่มี statistical sampling สำหรับ Ads เก่าที่ปิดมานาน
- Retention policy เป็นค่าระดับ local instance ไม่ใช่ per-customer policy

ก่อนเปิดใช้ public multi-tenant ต้องย้าย policy เป็น per-Customer, เพิ่ม backup
verification และกำหนด legal/audit retention แยกตามลูกค้า
