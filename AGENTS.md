# Instructions for AI contributors

อ่าน [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) ก่อนเริ่มงาน และอ่านเอกสารเฉพาะโมดูลที่กำลังแก้ โค้ดจริงและผลทดสอบล่าสุดเป็นหลักเมื่อ roadmap เก่าขัดกัน

- Meta access ต้องผ่าน Chrome Extension และหน้าเว็บเท่านั้น ห้ามเพิ่ม Meta Graph/Marketing API, endpoint ภายใน, การดัก network หรือการดึง cookie/session/password
- Frontend ใช้ Next.js พอร์ต 9321; Backend ของเราใช้ 4318; PostgreSQL ใช้ 5432 ทุกบริการเป็น local ตามค่าเริ่มต้น
- รูปแบบหลัก: shared Zod contract → Backend queue → Extension ตรวจ device/account/tab/สิทธิ์ → inspect → action → observe → บันทึกผล ห้ามข้าม local lease หรือ popup approval
- CSV ที่ผ่าน validation เป็นทางหลักของ normalized insights; DOM capture เป็นหลักฐานดิบ ไม่ใช่ข้อมูลครบทั้งบัญชี ห้ามเปลี่ยน unknown เป็น 0 หรือใช้ชื่อซ้ำ/ตำแหน่งเซลล์เป็น stable ID
- แยกผลทดสอบ fixture ออกจาก Meta จริง และแยก dispatched/clicked ออกจาก published/delivering; `needs_review` ไม่ใช่ complete
- อ่าน git status ก่อนแก้ เก็บการเปลี่ยนแปลงของผู้อื่นไว้ แก้ source ไม่แก้ dist เป็นงานถาวร และอย่าลดเวอร์ชันตามเอกสารเก่า
- Workspace นี้ใช้ dependencies ฝั่ง Windows: ใช้ CMD หรือ `cmd.exe /d /c "npm ..."` จาก WSL ห้ามติดตั้ง Linux dependencies ทับ node_modules ชุดเดียวกัน
- เลือกตรวจเฉพาะงานที่เปลี่ยนตามคู่มือ; docs-only ไม่ต้อง rebuild หรือเปิด Meta จริง `npm run build` ลบและสร้าง dist/extension ใหม่
- ห้าม commit .env, token, ข้อมูลลูกค้า, account/device จริง, reports, screenshots, browser profile หรือ generated artifacts ใช้ placeholder ในเอกสาร
- เพิ่ม migration ใหม่และลงทะเบียนใน scripts/migrate.ts แทนการแก้ migration ที่ใช้ไปแล้ว ห้ามล้างฐานข้อมูลจริงเพื่อทดสอบ
- อย่า force push หรือย้อนการแก้ไขของผู้ใช้อื่น รายงานสิ่งที่เปลี่ยน หลักฐานทดสอบ และข้อจำกัดตามจริงก่อนปิดงาน
