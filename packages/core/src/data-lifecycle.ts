import { z } from "zod";

export const dataLifecyclePolicySchema = z
  .object({
    raw_capture_days: z.number().int().min(7).max(3650).default(30),
    failed_capture_days: z.number().int().min(30).max(3650).default(90),
    daily_metrics_days: z.number().int().min(90).max(3650).default(540),
    monthly_metrics_months: z.number().int().min(12).max(120).default(36),
    entity_version_days: z.number().int().min(90).max(3650).default(730),
  })
  .strict();

export type DataLifecyclePolicy = z.infer<typeof dataLifecyclePolicySchema>;

export const defaultDataLifecyclePolicy: DataLifecyclePolicy =
  dataLifecyclePolicySchema.parse({});

export function lifecycleCutoffs(
  policy: DataLifecyclePolicy,
  now = new Date(),
) {
  const date = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const monthly = new Date(now);
  monthly.setUTCMonth(monthly.getUTCMonth() - policy.monthly_metrics_months);
  return {
    raw_capture_before: date(policy.raw_capture_days).toISOString(),
    failed_capture_before: date(policy.failed_capture_days).toISOString(),
    daily_metrics_before: date(policy.daily_metrics_days)
      .toISOString()
      .slice(0, 10),
    monthly_metrics_before: monthly.toISOString().slice(0, 10),
    entity_versions_before: date(policy.entity_version_days).toISOString(),
  };
}
