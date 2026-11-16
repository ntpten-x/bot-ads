import { z } from "zod";
import {
  uiCommandSchema,
  suiteUrl,
} from "../../../packages/core/src/control.js";
import { operateDom } from "./dom-control.js";
type Binding = { tabId: number; account: string; enabled: boolean };
const controlSchema = z.object({
  tabId: z.number().int(),
  account: z.string(),
  expires_at: z.number(),
  remaining: z.number().int(),
});
const pendingSchema = z.object({
  id: z.uuid(),
  digest: z.string(),
  expires_at: z.number(),
  approved: z.boolean(),
  preview: z.record(z.string(), z.unknown()),
});
async function tabFor(binding: Binding, write = false) {
  if (!binding.enabled) throw new Error("Bot control disabled");
  const tab = await chrome.tabs.get(binding.tabId);
  suiteUrl(tab.url ?? "", binding.account, write);
  if (tab.status !== "complete")
    throw new Error("Page loading; inspect again after load");
  return tab;
}
async function permission(binding: Binding) {
  const permit = controlSchema.safeParse(
    (await chrome.storage.session.get("uiControl")).uiControl,
  ).data;
  if (
    !permit ||
    permit.tabId !== binding.tabId ||
    permit.account !== binding.account ||
    permit.expires_at < Date.now() ||
    permit.remaining < 1
  )
    throw new Error(
      "Enable a UI control session in the popup before changing Meta",
    );
  return permit;
}
async function hash(value: unknown) {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(data)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function uiSession(
  command: "enable" | "disable" | "status" | "approve" | "reject",
  binding?: Binding,
  approvalId?: string,
) {
  if (command === "enable") {
    if (!binding) throw new Error("Bind a tab first");
    await tabFor(binding, true);
    const control = {
      tabId: binding.tabId,
      account: binding.account,
      expires_at: Date.now() + 15 * 60_000,
      remaining: 100,
    };
    await chrome.storage.session.set({ uiControl: control });
    return { control };
  }
  if (command === "disable") {
    await chrome.storage.session.remove(["uiControl", "uiApproval"]);
    return {};
  }
  const pending = pendingSchema.safeParse(
    (await chrome.storage.session.get("uiApproval")).uiApproval,
  ).data;
  if (command === "approve" || command === "reject") {
    if (
      !pending ||
      pending.id !== approvalId ||
      pending.expires_at < Date.now()
    )
      throw new Error("Review expired; inspect and request the action again");
    if (command === "reject") {
      await chrome.storage.session.remove("uiApproval");
      return {};
    }
    pending.approved = true;
    await chrome.storage.session.set({ uiApproval: pending });
    return { approval: pending };
  }
  return {
    control: controlSchema.safeParse(
      (await chrome.storage.session.get("uiControl")).uiControl,
    ).data,
    approval: pending,
    last: (await chrome.storage.local.get("uiState")).uiState,
  };
}
let operating = false;
export async function controlUi(raw: unknown, binding: Binding) {
  if (operating) throw new Error("UI operation in progress");
  operating = true;
  try {
    const command = uiCommandSchema.parse(raw);
    const tab = await tabFor(binding);
    if (command.command === "ui.focus") {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(binding.tabId, { active: true });
      return { ui: { outcome: "focused" } };
    }
    if (command.command === "ui.navigate") {
      const url = suiteUrl(command.url, binding.account);
      await chrome.tabs.update(binding.tabId, { url: url.href });
      await chrome.storage.session.remove("uiApproval");
      return {
        ui: {
          outcome: "navigation_started",
          url: url.href,
          requires_verification: true,
        },
      };
    }
    if (command.command === "ui.screenshot") {
      if (!tab.active)
        throw new Error("Focus the bound tab before taking a screenshot");
      const data = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 65,
      });
      const after = await chrome.tabs.get(binding.tabId);
      if (!after.active || after.url !== tab.url)
        throw new Error("Active tab changed during capture");
      return {
        ui: {
          outcome: "captured",
          url: tab.url,
          captured_at: new Date().toISOString(),
          mime_type: "image/jpeg",
          data_url: data,
        },
      };
    }
    const action = command.action;
    const mutation = !["inspect", "scroll"].includes(action.type);
    const session = mutation ? await permission(binding) : undefined;
    if (mutation) await tabFor(binding, true);
    const [previewResult] = await chrome.scripting.executeScript({
      target: { tabId: binding.tabId },
      func: operateDom,
      args: [
        {
          account: binding.account,
          action,
          execute: false,
          allow_commit: false,
        },
      ],
    });
    const preview = previewResult.result;
    if (!preview) throw new Error("No DOM response");
    if (preview.outcome === "failed") throw new Error(preview.error);
    if (action.type === "inspect") {
      await chrome.storage.local.set({ uiState: preview });
      return { ui: preview };
    }
    let allowCommit = false;
    if (preview.requires_review) {
      const digest = await hash({
        account: binding.account,
        tabId: binding.tabId,
        action,
        url: preview.url,
        target: preview.target,
        context: preview.context,
      });
      const pending = pendingSchema.safeParse(
        (await chrome.storage.session.get("uiApproval")).uiApproval,
      ).data;
      if (
        command.approval_id &&
        pending?.id === command.approval_id &&
        pending.approved &&
        pending.digest === digest &&
        pending.expires_at > Date.now()
      ) {
        allowCommit = true;
        await chrome.storage.session.remove("uiApproval");
      } else {
        if (command.approval_id)
          throw new Error(
            "Approval no longer matches page or action; inspect again",
          );
        const approval = {
          id: crypto.randomUUID(),
          digest,
          expires_at: Date.now() + 2 * 60_000,
          approved: false,
          preview: { ...preview, account: binding.account },
        };
        await chrome.storage.session.set({ uiApproval: approval });
        return {
          ui: {
            outcome: "awaiting_local_review",
            approval_id: approval.id,
            preview: approval.preview,
          },
        };
      }
    }
    // Recheck the lease after preview and consume before dispatch. Failed actions are not retried.
    if (session) {
      const fresh = await permission(binding);
      await chrome.storage.session.set({
        uiControl: { ...fresh, remaining: fresh.remaining - 1 },
      });
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: binding.tabId },
      func: operateDom,
      args: [
        {
          account: binding.account,
          action,
          execute: true,
          allow_commit: allowCommit,
        },
      ],
    });
    if (result.result?.outcome === "failed")
      throw new Error(result.result.error);
    if (!result.result)
      throw new Error("Action outcome unknown; inspect before any retry");
    await chrome.storage.local.set({ uiState: result.result });
    return { ui: result.result };
  } finally {
    operating = false;
  }
}
