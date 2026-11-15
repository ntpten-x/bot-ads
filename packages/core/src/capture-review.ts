import { z } from "zod";
import { canonicalHeader } from "./metrics";
import { requiredColumns, type AnalysisGoal } from "./analysis";
const captureSchema = z.object({
  account_id: z.string().regex(/^\d+$/),
  reader_version: z.string().optional(),
  page: z.string(),
  captured_at: z.iso.datetime(),
  reporting_context: z
    .object({
      date_range_label: z.string().nullable().optional(),
      attribution: z.string().optional(),
    })
    .optional(),
  row_observations: z
    .array(
      z.object({
        identity: z.string().nullable(),
        name: z.string().nullable(),
        method: z.enum(["semantic", "geometry"]),
        cells: z.array(z.object({ header: z.string(), text: z.string() })),
        warnings: z.array(z.string()),
      }),
    )
    .default([]),
});
const numeric = new Set([
  "spend",
  "impressions",
  "reach",
  "results",
  "link_clicks",
  "purchase_value",
  "link_ctr",
  "link_cpc",
  "cpm",
  "frequency",
  "cost_per_result",
  "messaging_conversations",
  "purchases",
  "leads",
  "landing_page_views",
  "adds_to_cart",
  "checkouts_initiated",
  "website_purchases",
  "website_purchase_value",
  "roas",
  "budget",
]);
function displayNumber(text: string): number | null {
  const s = text
    .trim()
    .replace(/^(฿|\$|THB\s+|USD\s+)/, "")
    .replace(/%$/, "")
    .trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s.replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}
export function buildCaptureReview(
  snapshots: unknown[],
  account: string,
  goal: AnalysisGoal,
) {
  const rejected: number[] = [];
  const captures = snapshots.flatMap((snapshot, i) => {
    const p = captureSchema.safeParse(snapshot);
    if (!p.success || p.data.account_id !== account) {
      rejected.push(i);
      return [];
    }
    const s = p.data;
    return [
      {
        page: s.page,
        captured_at: s.captured_at,
        reader_version: s.reader_version ?? null,
        context: s.reporting_context ?? null,
        rows: s.row_observations.map((row) => {
          const values: Record<string, number | null> = {};
          const ambiguous: string[] = [];
          for (const cell of row.cells) {
            const key = canonicalHeader(cell.header);
            if (!numeric.has(key)) continue;
            if (key in values) {
              values[key] = null;
              ambiguous.push(key);
            } else values[key] = displayNumber(cell.text);
          }
          return {
            ...row,
            values,
            ambiguous,
            missing: requiredColumns[goal].filter(
              (k) => values[k] === undefined || values[k] === null,
            ),
            ready_for_import: false as const,
          };
        }),
      },
    ];
  });
  return {
    account_id: account,
    goal,
    coverage: "visible_only" as const,
    ready_for_import: false as const,
    rejected,
    captures,
    warnings: [
      "ค่าจาก DOM เป็นข้อมูลตรวจทาน ต้องยืนยัน IDs วันที่ สกุลเงิน เขตเวลา และ Attribution ก่อนนำเข้า",
      "ไม่รวมแถวหรือเชื่อมข้อมูลข้ามภาพด้วยชื่อ เพราะชื่อซ้ำได้และตำแหน่งแถวเปลี่ยนได้",
    ],
  };
}
