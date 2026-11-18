import { z } from "zod";

export const reportPreferencesSchema = z
  .object({
    goal: z.enum(["messages", "sales", "leads"]).default("messages"),
    target_cost_per_result: z.number().positive().nullable().default(null),
    target_roas: z.number().positive().nullable().default(null),
  })
  .strict();

export type ReportPreferences = z.infer<typeof reportPreferencesSchema>;

export const defaultReportPreferences: ReportPreferences = {
  goal: "messages",
  target_cost_per_result: null,
  target_roas: null,
};
