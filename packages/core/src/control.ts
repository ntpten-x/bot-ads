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
      command: z.literal("report.prepare"),
      goal: z.enum(["messages", "sales", "leads"]),
    })
    .strict(),
  z
    .object({
      command: z.literal("start"),
      levels: z
        .array(z.enum(["campaigns", "adsets", "ads"]))
        .min(1)
        .max(3),
      maxSteps: z.number().int().min(1).max(20).default(5),
      scan_columns: z.boolean().optional(),
    })
    .strict(),
  z.object({ command: z.literal("pause") }).strict(),
  z.object({ command: z.literal("resume") }).strict(),
  z.object({ command: z.literal("status") }).strict(),
  uiCommandSchema,
]);
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
