export type Delivery =
  | "payment_error"
  | "parent_off"
  | "off"
  | "limited"
  | "learning"
  | "in_review"
  | "rejected"
  | "not_delivering"
  | "completed"
  | "active"
  | "unknown";

/**
 * Delivery states that describe why an Ad is not part of a current
 * performance comparison. They remain available for diagnostics and audit,
 * but must never affect medians, rankings or optimization recommendations.
 */
export const nonPerformanceDeliveries: ReadonlySet<Delivery> = new Set([
  "payment_error",
  "off",
  "parent_off",
]);

const deliveryRules: [RegExp, Delivery][] = [
  [
    /ข้อผิดพลาดในการชำระเงิน|payment (?:issue|error|failed|method)/i,
    "payment_error",
  ],
  [
    /^(?:(?:แคมเปญ|ชุดโฆษณา)(?:ปิด(?:ใช้งาน)?(?:อยู่)?|(?:is )?off|inactive|paused|disabled)|(?:campaign|ad set) (?:is )?(?:off|inactive|paused|disabled))$/i,
    "parent_off",
  ],
  [
    /^(?:ปิด(?:ใช้งาน)?(?:อยู่)?|off|inactive|paused|disabled)$/i,
    "off",
  ],
  [/จำกัดการเรียนรู้|learning limited/i, "limited"],
  [/กำลังเรียนรู้|^learning$/i, "learning"],
  [/ระหว่างการตรวจสอบ|อยู่ระหว่างตรวจสอบ|in review/i, "in_review"],
  [/ถูกปฏิเสธ|rejected|disapproved/i, "rejected"],
  [/ไม่ได้นำส่ง|ไม่มีการนำส่ง|not delivering/i, "not_delivering"],
  [/เสร็จสมบูรณ์|^completed$/i, "completed"],
  [/ใช้งานอยู่|^active$/i, "active"],
];

export function parseDelivery(text: string | null | undefined): Delivery {
  const first = (text ?? "").split("\n")[0].replace(/\s+/g, " ").trim();
  if (!first || first === "—" || first === "–") return "unknown";
  return deliveryRules.find(([re]) => re.test(first))?.[1] ?? "unknown";
}
