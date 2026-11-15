import type { z } from "zod";
import type { botCommandSchema } from "../../../packages/core/src/control";
import type {
  AdRecord,
  ImportInput,
  parseReport,
} from "../../../packages/core/src/index";
export type { AdRecord, ImportInput };
export type Quality = ReturnType<typeof parseReport>;
export type BotCommand = z.infer<typeof botCommandSchema>;
export type Device = {
  id: string;
  account_id: string;
  enabled: string;
  updated_at: string;
  job_status?: string;
};
export type Bootstrap = { accounts: string[]; devices: Device[] };
export type Control = {
  id: string;
  label: string;
  tag: string;
  role: string;
  type?: string;
  value?: string;
  disabled: boolean;
  requires_review: boolean;
  options?: { value: string; label: string }[];
};
export type Snapshot = {
  snapshot_id: string;
  captured_at: string;
  title: string;
  url: string;
  text: string;
  account_verified: boolean;
  controls: Control[];
  controls_truncated?: boolean;
};
export type Lease = { account: string; expires_at: number; remaining: number };
export type Approval = {
  id: string;
  approved: boolean;
  expires_at: number;
  preview: Record<string, unknown>;
};
export type Job = {
  scan_columns?: boolean;
  horizontal_step?: number;
  read_attempts?: number;
  last_wait_reason?: string;
  id: string;
  status: string;
  index: number;
  step: number;
  levels: string[];
  snapshots: unknown[];
  error?: string;
};
export type DeviceState = {
  updated_at: string;
  state: {
    bound_account: string;
    extension_version?: string;
    report_input?: boolean;
    enabled: boolean;
    job?: Job;
    ui?: UiResult;
    control?: Lease;
    approval?: Approval;
  };
};
export type UiResult = {
  report?: {
    goal: string;
    selected: string[];
    missing: string[];
    missing_required: string[];
    applied: boolean;
  };
  outcome: string;
  snapshot?: Snapshot;
  approval_id?: string;
  preview?: Record<string, unknown>;
  data_url?: string;
};
export type CommandRow = {
  id: string;
  status: "pending" | "done" | "error";
  command: BotCommand;
  created_at: string;
  completed_at?: string;
  error?: string;
  outcome?: string;
  approval_id?: string;
};
export type Receipt = CommandRow & {
  result?: { ok: boolean; error?: string; job?: Job; ui?: UiResult };
};
export type ImportRow = {
  id: string;
  created_at: string;
  filename: string;
  row_count: number;
  report: Omit<Quality, "records">;
};
export type Summary = {
  campaigns: number;
  ad_sets: number;
  ads: number;
  observations: number;
  imports: number;
  last_import?: string;
};
export type Api = <T>(path: string, body?: unknown) => Promise<T>;
export type Notify = (message: string, error?: boolean) => void;
export type Run = (label: string, fn: () => Promise<void>) => Promise<void>;
