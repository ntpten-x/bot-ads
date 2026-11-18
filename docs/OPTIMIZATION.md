# Optimization Loop

สถานะ: recommendation, planning, experiment tracking, creative metadata,
campaign template, approval record และ outcome observation ทำงานแล้ว.
Automated Meta mutation ยังปิดอยู่โดยตั้งใจ; การเปลี่ยนสถานะ งบ หรือสร้าง/เผยแพร่
โฆษณาต้องมี certified Extension adapter และ local popup approval ก่อน.

## วงจรข้อมูล

```text
Ads report (coverage complete)
  → deterministic recommendation
  → evidence + confidence + risk
  → optimization plan
  → plan approval
  → manual/local-approved Extension action
  → latest report observation
  → action receipt + rollback record
```

ระบบไม่ใช้ LLM ตัดสินใจว่า Ads ใดควรหยุดหรือเพิ่มงบ. Recommendation Engine ใช้
กฎที่ตรวจซ้ำได้:

- scope ต้องเป็น Ads level
- coverage ต้อง `complete` และไม่มี blockers
- ใช้ผลลัพธ์ประเภทเดียวกัน ไม่รวม Messages กับ Purchases
- แต่ละ Ads ต้องมี stable ID, verified mapping, Results และ Spend จากคอลัมน์
- ต้องมี peers อย่างน้อยตาม `min_peer_rows`
- Median CPA/Cost per result คำนวณภายใน scope เดียวกัน
- Spend ที่ estimate จาก Results × Cost/result ไม่ใช้สร้างคำสั่งปรับงบ
- ถ้าข้อมูลไม่พอ ระบบคืน warnings และไม่สร้างข้อเสนอ

## Recommendation

Action ที่ระบบสร้างได้:

| Action | ความหมาย |
| --- | --- |
| `scale_budget` | ต้นทุนต่ำกว่า median ตาม policy และมี Budget ที่อ่านได้; ยังไม่เปลี่ยนงบเอง |
| `duplicate_winner` | Ads มีประสิทธิภาพดีหรือปิดอยู่แต่ต้นทุนดี เหมาะทำสำเนาเป็น Draft เพื่อทดลอง |
| `pause_candidate` | ต้นทุนสูงกว่า median ตาม policy; ต้องตรวจ volume และบริบทก่อนหยุด |
| `create_new_test` | Ads อยู่ระดับกลาง ใช้เป็นฐานสร้าง Variant พร้อม Experiment |

ทุกข้อเสนอเก็บ `evidence`, `confidence`, `risk` และ `expected_impact`. ค่า
expected impact ไม่ใช่คำรับประกันผลลัพธ์.

## Policy

Policy เก็บต่อ Account:

- `min_results`
- `min_spend`
- `min_peer_rows`
- `scale_ratio`
- `pause_ratio`
- `max_budget_change_pct`
- `require_experiment_for_new`
- `allow_create_campaign_draft`

Default ไม่ได้หมายถึงค่าที่เหมาะกับทุกธุรกิจ ผู้ใช้ต้องปรับตามเป้าหมายและปริมาณ
ข้อมูลของ Account.

## Data model

Migration `010_optimization_loop` เพิ่ม:

- `entity_versions`: Campaign/Ad Set/Ad snapshot และ hierarchy ที่รู้จาก Ads capture
- `creative_assets`: copy metadata และ media hash โดยไม่อ่านไฟล์หรือ credential จาก Meta
- `optimization_policies`
- `optimization_recommendations`
- `optimization_plans`
- `optimization_steps`
- `action_receipts`
- `rollback_plans`
- `experiments`, `experiment_arms` และ `experiment_observations`
- `outcome_observations`
- `campaign_templates`

## APIs

| Endpoint | หน้าที่ |
| --- | --- |
| `GET /optimization/workspace?account_id=` | รวม scope, policy, recommendations, plans, experiments, creatives, templates และ outcomes |
| `POST /optimization/recommendations/rebuild` | สร้างข้อเสนอใหม่จาก cached Ads report |
| `POST /optimization/recommendations/:id/plan` | สร้าง plan และ rollback record จาก recommendation |
| `POST /optimization/plans/:id/decision` | อนุมัติหรือปฏิเสธ plan |
| `POST /optimization/plans/:id/observe` | เทียบ Target Ads กับ Capture ล่าสุด |
| `POST /optimization/plans/:id/result` | บันทึกผลตรวจระดับ plan |
| `POST /optimization/experiments` | สร้าง hypothesis และ arms |
| `POST /optimization/creatives` | เก็บ Creative metadata |
| `POST /optimization/templates` | สร้าง Campaign template |

ทุก request ที่ระบุ Account ถูกตรวจ Customer ownership และ disabled-account gate
จาก middleware เดิม.

Policy changes, recommendation rebuilds/dismissals, plan creation/decision,
outcome records, experiments, Creative metadata and Campaign templates are
written to `admin_audit_log` with actor and customer context.

## UI

เมนู **Optimization Loop** แสดง:

- pipeline: เก็บข้อมูล → ประเมิน → ตัดสินใจ → อนุมัติ → ติดตามผล
- Decision ledger พร้อม Ads ID, Spend, Results, CPA, peer median และ confidence
- Policy editor
- Plan และ rollback/receipt count
- Outcome observation
- Experiment register
- Creative memory
- Campaign templates

หน้า Report Studio มีปุ่ม **สร้างข้อเสนอ** เฉพาะเมื่อ scope coverage complete.

## Safety boundary

- Plan approval ไม่เท่ากับ Meta action approval
- ทุก mutation ในอนาคตต้องใช้ typed Extension command และ popup approval
- ห้าม retry แบบ blind หลังผล action ไม่ชัดเจน
- High-risk campaign creation ต้องมี Experiment และการตรวจจากผู้ใช้
- ไม่มี Meta Graph/Marketing API, cookie/session extraction หรือ network interception
- ระบบยังไม่ประกาศว่า “สร้างและเผยแพร่โฆษณา” สำเร็จ จนกว่าจะมี adapter
  ที่ทดสอบกับหน้า Meta จริงและ verified readback

## ขั้นต่อไป

1. certified adapters สำหรับ Pause, Duplicate และ Budget change
2. readback หลัง action และ auto-created `action_receipts`
3. Campaign Composer adapter สำหรับ Draft
4. Experiment metric ingestion และ statistical guardrails
5. policy learning จาก outcome ต่อ Account โดยไม่ข้าม Account/scope
