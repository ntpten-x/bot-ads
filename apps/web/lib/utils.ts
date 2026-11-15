import type { BotCommand } from "./types";
export const time = (v?: string | number) =>
  v
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
export const number = (v?: number) =>
  v === undefined
    ? "—"
    : new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(v);
export function humanError(e: unknown) {
  if (e instanceof Error && e.name === "ZodError")
    return "รูปแบบข้อมูลไม่ถูกต้อง กรุณาตรวจข้อมูลที่กรอก หรืออ่านหน้าใหม่แล้วเลือกคำสั่งอีกครั้ง";
  const m = e instanceof Error ? e.message : String(e);
  if (
    /Failed to fetch|fetch failed|NetworkError|timed out|TimeoutError|Unexpected token/.test(
      m,
    )
  )
    return "เชื่อมต่อ Backend ไม่ได้ ตรวจว่าเปิด npm run dev:api และ Docker อยู่";
  if (m.includes("Enable a UI control session"))
    return "เปิดโหมดควบคุมจาก popup ของ Extension ก่อน";
  if (/Stale snapshot|Target changed/.test(m))
    return "หน้าเว็บเปลี่ยนแล้ว กดอ่านหน้าปัจจุบันเพื่อเลือกเป้าหมายใหม่";
  return m;
}
export function download(
  content: string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function actionName(command: BotCommand) {
  const map: Record<string, string> = {
    start: "เริ่มรวบรวมตาราง",
    "report.prepare": "ตั้งคอลัมน์วิเคราะห์",
    pause: "พักงานอ่านตาราง",
    resume: "อ่านตารางต่อ",
    status: "อ่านสถานะงาน",
    "ui.navigate": "เปิดหน้า Meta",
    "ui.focus": "เปิดแท็บที่ผูกไว้",
    "ui.screenshot": "ภาพหน้าจอ",
  };
  if (command.command === "ui.action") {
    return (
      {
        inspect: "อ่านหน้าปัจจุบัน",
        click: "คลิกองค์ประกอบ",
        fill: "กรอกค่า",
        select: "เลือกค่า",
        check: "เปลี่ยนสถานะตัวเลือก",
        press: "ส่งปุ่มคีย์บอร์ด",
        scroll: "เลื่อนหน้า",
        upload: "อัปโหลดไฟล์",
      } as Record<string, string>
    )[command.action.type];
  }
  return map[command.command] ?? command.command;
}
export function outcomeName(value?: string) {
  return (
    (
      {
        observed: "อ่านหน้าแล้ว",
        dispatched: "ส่งคำสั่งบนหน้าแล้ว ต้องตรวจผล",
        awaiting_local_review: "รอตรวจใน Extension",
        captured: "บันทึกภาพหน้าจอแล้ว",
        navigation_started: "เริ่มเปิดหน้าแล้ว",
        focused: "เปิดแท็บแล้ว",
      } as Record<string, string>
    )[value ?? ""] ??
    value ??
    "—"
  );
}
export const jobNames: Record<string, string> = {
  running: "กำลังรวบรวม",
  paused: "พักงานแล้ว",
  needs_review: "รอตรวจข้อมูลที่อ่านได้",
  error: "อ่านข้อมูลไม่สำเร็จ",
};
