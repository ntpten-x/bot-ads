"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { Api, Run } from "../lib/types";
import { number, time } from "../lib/utils";
import { EmptyRow, Note, Panel, Pill } from "./ui";

type ManagedAccount = {
  account_id: string;
  customer_id: string;
  customer_name: string;
  display_name: string | null;
  enabled: boolean;
  report_template: Record<string, unknown>;
  device_count: number;
  fresh_devices: number;
  latest_job_id: string | null;
  latest_job_status: string | null;
  latest_job_error: string | null;
  last_capture_at: string | null;
  normalized_ads: number;
  target_configured: boolean;
  auto_enabled: boolean;
  auto_interval_minutes: number;
  auto_next_run_at: string | null;
  auto_last_run_at: string | null;
  auto_last_status: string | null;
  auto_last_error: string | null;
  status: "ready" | "partial" | "blocked" | "not_tested" | "disabled";
  issues: string[];
  coverage: string | null;
  verified_ads: number;
  reported_ads: number | null;
};

type Customer = {
  id: string;
  name: string;
  enabled: boolean;
  account_count: number;
  created_at: string;
};

type ClientToken = {
  id: string;
  customer_id: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  enabled: boolean;
  created_at: string;
};

type AuditEntry = {
  id: string;
  actor_kind: string;
  actor_name: string | null;
  customer_name: string | null;
  action: string;
  target: string;
  details: Record<string, unknown>;
  created_at: string;
};

const statusLabels: Record<ManagedAccount["status"], string> = {
  ready: "พร้อมใช้งาน",
  partial: "พร้อมบางส่วน",
  blocked: "ต้องแก้ไข",
  not_tested: "ยังไม่ทดสอบ",
  disabled: "ปิดใช้งาน",
};

const statusKinds: Record<ManagedAccount["status"], string> = {
  ready: "success",
  partial: "warning",
  blocked: "error",
  not_tested: "neutral",
  disabled: "neutral",
};

export default function AccountsView({
  account,
  api,
  run,
  onSelect,
}: {
  account: string;
  api: Api;
  run: Run;
  onSelect: (account: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [newAccountId, setNewAccountId] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientRole, setClientRole] = useState("operator");
  const [issuedToken, setIssuedToken] = useState("");
  const auth = useSWR<{
    kind: string;
    role: "admin" | "operator" | "viewer";
    customer_id: string | null;
    customer_name: string | null;
  }>("/auth/me", api, { revalidateOnFocus: false });
  const customers = useSWR<Customer[]>("/customers", api, {
    revalidateOnFocus: false,
  });
  const accounts = useSWR<ManagedAccount[]>(`/managed-accounts`, api, {
    refreshInterval: 15000,
  });
  const clients = useSWR<ClientToken[]>(
    auth.data?.kind === "local-admin" && selectedCustomer
      ? `/customers/${selectedCustomer}/clients`
      : null,
    api,
    { revalidateOnFocus: false },
  );
  const audit = useSWR<AuditEntry[]>(
    auth.data?.kind === "local-admin" ? "/audit-log?limit=30" : null,
    api,
    { revalidateOnFocus: false },
  );
  useEffect(() => {
    if (selectedCustomer || !customers.data?.length) return;
    setSelectedCustomer(customers.data[0].id);
  }, [customers.data, selectedCustomer]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (accounts.data ?? []).filter(
      (item) =>
        (!status || item.status === status) &&
        (!needle ||
          item.account_id.includes(needle) ||
          item.customer_name.toLowerCase().includes(needle) ||
          item.display_name?.toLowerCase().includes(needle)),
    );
  }, [accounts.data, query, status]);
  return (
    <div className="accounts-view">
      <Note>
        สถานะนี้คำนวณจากงานอ่านล่าสุดของแต่ละบัญชี. บัญชีที่ยังไม่ผ่าน acceptance
        สามารถเชื่อมต่อได้ แต่ไม่ควรใช้รายงานเป็นข้อมูลปิดยอดจนกว่าจะแก้รายการที่แจ้ง
      </Note>
      {auth.data?.kind === "local-admin" ? (
        <details className="customer-admin">
          <summary>จัดการ Customer, บัญชี และ Client Token</summary>
          <div className="customer-admin-grid">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run("customer-create", async () => {
                  const created = await api<Customer>("/customers", {
                    name: customerName.trim(),
                  });
                  setCustomerName("");
                  await Promise.all([customers.mutate(), audit.mutate()]);
                  setSelectedCustomer(created.id);
                });
              }}
            >
              <label>
                Customer ใหม่
                <input
                  required
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="ชื่อลูกค้า"
                />
              </label>
              <button className="secondary">สร้าง Customer</button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run("customer-account", async () => {
                  await api(
                    `/customers/${selectedCustomer}/accounts`,
                    {
                      account_id: newAccountId.trim(),
                      ...(newAccountName.trim()
                        ? { display_name: newAccountName.trim() }
                        : {}),
                    },
                  );
                  setNewAccountId("");
                  setNewAccountName("");
                  await Promise.all([
                    accounts.mutate(),
                    customers.mutate(),
                    audit.mutate(),
                  ]);
                });
              }}
            >
              <label>
                Customer
                <select
                  required
                  value={selectedCustomer}
                  onChange={(event) => setSelectedCustomer(event.target.value)}
                >
                  {customers.data?.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Account ID
                <input
                  required
                  inputMode="numeric"
                  value={newAccountId}
                  onChange={(event) => setNewAccountId(event.target.value)}
                />
              </label>
              <label>
                ชื่อที่แสดง
                <input
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                  placeholder="เช่น Customer A"
                />
              </label>
              <button className="secondary">เพิ่มบัญชีให้ Customer</button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run("customer-client", async () => {
                  const created = await api<{
                    token: string;
                    token_notice: string;
                  }>(`/customers/${selectedCustomer}/clients`, {
                    name: clientName.trim(),
                    role: clientRole,
                  });
                  setClientName("");
                  setIssuedToken(created.token);
                  await Promise.all([clients.mutate(), audit.mutate()]);
                });
              }}
            >
              <label>
                Client token
                <input
                  required
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="ชื่อผู้ใช้หรือระบบ"
                />
              </label>
              <label>
                สิทธิ์
                <select
                  value={clientRole}
                  onChange={(event) => setClientRole(event.target.value)}
                >
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button className="secondary">ออก Token ใหม่</button>
            </form>
          </div>
          {issuedToken ? (
            <div className="issued-token">
              <strong>Token แสดงเพียงครั้งเดียว</strong>
              <code>{issuedToken}</code>
              <button
                className="text-button"
                onClick={() => setIssuedToken("")}
              >
                ซ่อน
              </button>
            </div>
          ) : null}
          <div className="customer-controls">
            <div className="customer-control-head">
              <div>
                <strong>Customer และ Client Token</strong>
                <small>
                  ปิด Customer เพื่อหยุดทุก token ของลูกค้ารายนั้นทันที
                </small>
              </div>
            </div>
            <div className="table-scroll">
              <table className="customer-control-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>บัญชี</th>
                    <th>สถานะ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customers.data?.map((customer) => (
                    <tr
                      key={customer.id}
                      className={
                        customer.id === selectedCustomer ? "selected" : ""
                      }
                    >
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelectedCustomer(customer.id)}
                        >
                          {customer.name}
                        </button>
                        <small>{customer.id}</small>
                      </td>
                      <td>{number(customer.account_count)}</td>
                      <td>
                        <Pill kind={customer.enabled ? "success" : "neutral"}>
                          {customer.enabled ? "เปิด" : "ปิด"}
                        </Pill>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run("customer-toggle", async () => {
                              await api(`/customers/${customer.id}`, {
                                enabled: !customer.enabled,
                              });
                              await Promise.all([
                                customers.mutate(),
                                accounts.mutate(),
                                audit.mutate(),
                              ]);
                            })
                          }
                        >
                          {customer.enabled ? "ปิด Customer" : "เปิด Customer"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="client-token-list">
              <strong>Token ของ Customer ที่เลือก</strong>
              {clients.data?.length ? (
                clients.data.map((client) => (
                  <div key={client.id}>
                    <span>
                      <b>{client.name}</b>
                      <small>
                        {client.role} · ออกเมื่อ {time(client.created_at)}
                      </small>
                    </span>
                    <Pill kind={client.enabled ? "success" : "neutral"}>
                      {client.enabled ? "ใช้งาน" : "เพิกถอน"}
                    </Pill>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run("client-toggle", async () => {
                          await api(
                            `/customers/${selectedCustomer}/clients/${client.id}`,
                            { enabled: !client.enabled },
                          );
                          await Promise.all([clients.mutate(), audit.mutate()]);
                        })
                      }
                    >
                      {client.enabled ? "เพิกถอน" : "เปิดอีกครั้ง"}
                    </button>
                  </div>
                ))
              ) : (
                <small>
                  {clients.isLoading
                    ? "กำลังโหลด token…"
                    : "ยังไม่มี Client Token"}
                </small>
              )}
            </div>
          </div>
        </details>
      ) : null}
      <Panel
        title="บัญชีโฆษณาและความพร้อม"
        subtitle="แยก customer, Device, coverage, normalized Ads และ acceptance ต่อบัญชี"
        action={
          <button
            className="text-button"
            onClick={() => void run("accounts", async () => void (await accounts.mutate()))}
          >
            รีเฟรช
          </button>
        }
      >
        <div className="accounts-filters">
          <input
            aria-label="ค้นหาบัญชีหรือ customer"
            placeholder="ค้นหา Customer / Account ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="กรองสถานะบัญชี"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table className="accounts-table">
            <thead>
              <tr>
                <th>Customer / บัญชี</th>
                <th>Extension</th>
                <th>Coverage</th>
                <th>Ads / Normalized</th>
                <th>เป้าหมาย</th>
                <th>อ่านอัตโนมัติ</th>
                <th>Acceptance</th>
                <th>อ่านล่าสุด</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((item) => (
                  <tr
                    key={item.account_id}
                    className={
                      item.account_id === account ? "selected" : undefined
                    }
                  >
                    <td>
                      <strong>{item.display_name ?? item.account_id}</strong>
                      <small>
                        {item.customer_name} · {item.account_id}
                      </small>
                    </td>
                    <td>
                      {item.fresh_devices ? (
                        <Pill kind="success">ออนไลน์</Pill>
                      ) : item.device_count ? (
                        <Pill kind="warning">ไม่ส่ง heartbeat</Pill>
                      ) : (
                        <Pill kind="neutral">ยังไม่มี Device</Pill>
                      )}
                      <small>{item.device_count} Device</small>
                    </td>
                    <td>
                      {item.coverage ?? "—"}
                      <small>
                        {item.latest_job_error ??
                          item.latest_job_status ??
                          "ยังไม่มีงาน"}
                      </small>
                    </td>
                    <td>
                      {item.verified_ads} / {item.normalized_ads}
                      <small>
                        Reported {item.reported_ads ?? "—"}
                      </small>
                    </td>
                    <td>{item.target_configured ? "ตั้งแล้ว" : "ยังไม่ตั้ง"}</td>
                    <td>
                      <Pill kind={item.auto_enabled ? "success" : "neutral"}>
                        {item.auto_enabled
                          ? `ทุก ${item.auto_interval_minutes} นาที`
                          : "ปิด"}
                      </Pill>
                      <small>
                        {item.auto_enabled && item.auto_next_run_at
                          ? `ครั้งถัดไป ${time(item.auto_next_run_at)}`
                          : item.auto_last_status ?? "read-only report.collect"}
                      </small>
                      {item.auto_last_error ? (
                        <small>{item.auto_last_error}</small>
                      ) : null}
                    </td>
                    <td>
                      <Pill kind={statusKinds[item.status]}>
                        {statusLabels[item.status]}
                      </Pill>
                      {item.issues.length ? (
                        <small>{item.issues.slice(0, 2).join(" · ")}</small>
                      ) : null}
                    </td>
                    <td>{time(item.last_capture_at ?? undefined)}</td>
                    <td>
                      <Pill kind={item.enabled ? "success" : "neutral"}>
                        {item.enabled ? "เปิด" : "ปิด"}
                      </Pill>
                    </td>
                    <td>
                      <div className="account-actions">
                        <button
                          className="text-button"
                          disabled={!item.enabled}
                          onClick={() => onSelect(item.account_id)}
                        >
                          เปิดรายงาน
                        </button>
                        {auth.data?.role === "admin" ? (
                          <>
                            <button
                              className="text-button"
                              onClick={() =>
                                void run("account-schedule", async () => {
                                  await api(
                                    `/managed-accounts/${item.account_id}/schedule`,
                                    {
                                      enabled: !item.auto_enabled,
                                      interval_minutes:
                                        item.auto_interval_minutes || 60,
                                    },
                                  );
                                  await accounts.mutate();
                                })
                              }
                            >
                              {item.auto_enabled
                                ? "หยุดอ่านอัตโนมัติ"
                                : "อ่านอัตโนมัติ"}
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                void run("account-toggle", async () => {
                                  await api(
                                    `/managed-accounts/${item.account_id}`,
                                    { enabled: !item.enabled },
                                  );
                                  await Promise.all([
                                    accounts.mutate(),
                                    audit.mutate(),
                                  ]);
                                })
                              }
                            >
                              {item.enabled ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow cols={10}>
                  {accounts.isLoading
                    ? "กำลังโหลดบัญชี…"
                    : accounts.error
                      ? accounts.error.message
                      : "ไม่พบบัญชีตามเงื่อนไข"}
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
        <p className="accounts-count">
          แสดง {number(rows.length)} จาก {number(accounts.data?.length ?? 0)} บัญชี
        </p>
      </Panel>
      {auth.data?.kind === "local-admin" ? (
        <details className="audit-log">
          <summary>ประวัติการเปลี่ยนสิทธิ์และการอ่านอัตโนมัติ</summary>
          {audit.data?.length ? (
            <div className="audit-list">
              {audit.data.map((entry) => (
                <div key={entry.id}>
                  <span>
                    <strong>{entry.action}</strong>
                    <small>
                      {entry.customer_name ?? "Local Workspace"} · {entry.target}
                    </small>
                  </span>
                  <span>
                    <small>
                      {entry.actor_name ?? entry.actor_kind} ·{" "}
                      {time(entry.created_at)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p>{audit.isLoading ? "กำลังโหลดประวัติ…" : "ยังไม่มีประวัติ"}</p>
          )}
        </details>
      ) : null}
    </div>
  );
}
