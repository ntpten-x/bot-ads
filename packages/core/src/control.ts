import { z } from "zod";
const target = {
  snapshot_id: z.uuid(),
  target: z.string().regex(/^node_\d+$/),
};
export const domActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("inspect"),
      max_controls: z.number().int().min(1).max(300).default(150),
    })
    .strict(),
  z.object({ type: z.literal("click"), ...target }).strict(),
  z
    .object({
      type: z.literal("fill"),
      ...target,
      value: z.string().max(20000),
    })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      ...target,
      value: z.string().max(1000),
    })
    .strict(),
  z
    .object({ type: z.literal("check"), ...target, checked: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("press"),
      ...target,
      key: z.enum([
        "Enter",
        "Escape",
        "Tab",
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        " ",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      delta_y: z.number().int().min(-4000).max(4000),
      snapshot_id: z.uuid().optional(),
      target: z
        .string()
        .regex(/^node_\d+$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("upload"),
      ...target,
      filename: z.string().regex(/^[\p{L}\p{N}_. -]{1,150}$/u),
      mime_type: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4"]),
      base64: z
        .string()
        .min(4)
        .max(7_000_000)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .strict(),
]);
export type DomAction = z.infer<typeof domActionSchema>;
export const uiCommandSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("ui.action"),
      action: domActionSchema,
      approval_id: z.uuid().optional(),
    })
    .strict(),
  z.object({ command: z.literal("ui.navigate"), url: z.url() }).strict(),
  z.object({ command: z.literal("ui.focus") }).strict(),
  z.object({ command: z.literal("ui.screenshot") }).strict(),
]);
export const botCommandSchema = z.union([
  z
    .object({
      command: z.literal("breakdown.prepare"),
      dimensions: z
        .array(
          z.enum(["age", "gender", "platform", "placement"]),
        )
        .max(4),
    })
    .strict()
    .refine(
      (value) => new Set(value.dimensions).size === value.dimensions.length,
      {
        message: "Breakdown dimensions must be unique",
      },
    )
    .refine(
      (value) =>
        !(
          value.dimensions.includes("age") &&
          value.dimensions.includes("gender")
        ),
      {
        message:
          "Age and Gender are mutually exclusive demographics breakdowns in Meta",
      },
    ),
  z
    .object({
      command: z.literal("report.prepare"),
      goal: z.enum(["messages", "sales", "leads"]),
    })
    .strict(),
  z
    .object({
      command: z.literal("report.collect"),
      goal: z.enum(["messages", "sales", "leads"]),
      maxSteps: z.number().int().min(1).max(60).default(40),
      scan_columns: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      command: z.literal("start"),
      levels: z
        .array(z.enum(["campaigns", "adsets", "ads"]))
        .min(1)
        .max(3),
      maxSteps: z.number().int().min(1).max(60).default(5),
      scan_columns: z.boolean().optional(),
    })
    .strict(),
  z.object({ command: z.literal("pause") }).strict(),
  z.object({ command: z.literal("resume") }).strict(),
  z.object({ command: z.literal("status") }).strict(),
  uiCommandSchema,
]);
export const commandCollectionSchema = z
  .object({
    phase: z.enum(["collection_started", "collection_completed", "collection_failed"]),
    active: z.boolean(),
    job_id: z.uuid().nullable(),
    job_status: z.string().max(40).nullable(),
  })
  .strict();
export const commandResultSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().max(4000).optional(),
    job: z.unknown().optional(),
    ui: z.unknown().optional(),
    collection: commandCollectionSchema.optional(),
  })
  .passthrough();
export type CommandCollection = z.infer<typeof commandCollectionSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type BreakdownQueryParam = readonly [string, string];
export type ReportingLevel = "campaigns" | "adsets" | "ads";
export function reportingUrl(
  account: string,
  level: ReportingLevel,
  breakdownParams: readonly BreakdownQueryParam[] = [],
) {
  if (!/^\d+$/.test(account)) throw new Error("Valid account required");
  const url = new URL(
    `https://adsmanager.facebook.com/adsmanager/manage/${level}`,
  );
  url.searchParams.set("act", account);
  for (const [key, value] of breakdownParams) {
    if (
      !/^[a-z0-9_]{1,64}_breakdown$/i.test(key) ||
      !/^[a-z0-9_,.-]{1,100}$/i.test(value)
    )
      throw new Error("Invalid reporting breakdown parameter");
    url.searchParams.set(key, value);
  }
  return url;
}
function canonicalBreakdownParams(params: readonly BreakdownQueryParam[]) {
  return params
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
}
export function needsReportingNavigation(
  raw: string,
  account: string,
  level: ReportingLevel,
  breakdownParams: readonly BreakdownQueryParam[] = [],
) {
  let url: URL;
  let expected: URL;
  try {
    url = new URL(raw);
    expected = reportingUrl(account, level, breakdownParams);
  } catch {
    return true;
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(
      url.hostname,
    ) ||
    url.pathname.replace(/\/+$/, "") !== expected.pathname ||
    url.searchParams.getAll("act").length !== 1 ||
    url.searchParams.get("act") !== account ||
    url.searchParams.has("ad_page_id")
  )
    return true;
  const actualBreakdown: BreakdownQueryParam[] = [];
  for (const [key, value] of url.searchParams) {
    if (!/^[a-z0-9_]{1,64}_breakdown$/i.test(key)) continue;
    if (!/^[a-z0-9_,.-]{1,100}$/i.test(value)) return true;
    actualBreakdown.push([key, value]);
  }
  return (
    canonicalBreakdownParams(actualBreakdown) !==
    canonicalBreakdownParams(breakdownParams)
  );
}
export function suiteUrl(raw: string, account: string, requireAccount = false) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !["adsmanager.facebook.com", "business.facebook.com"].includes(url.hostname)
  )
    throw new Error(
      "Only Meta Business Suite and Ads Manager web pages are allowed",
    );
  if (
    !/^\/(adsmanager\/(manage|creation|reporting)(\/|$)|latest(\/|$)|business(\/|$)|settings(\/|$))/.test(
      url.pathname,
    )
  )
    throw new Error("This is not an allowed Business Suite UI route");
  const act = url.searchParams.get("act");
  if ((act && act !== account) || (requireAccount && act !== account))
    throw new Error(
      "Account cannot be verified from this page URL; open Ads Manager with the selected act parameter",
    );
  return url;
}
