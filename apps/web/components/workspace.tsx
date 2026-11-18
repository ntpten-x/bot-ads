"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import useSWR, { SWRConfig } from "swr";
import type {
  Api,
  Bootstrap,
  CommandRow,
  DeviceState,
  ImportRow,
  Receipt,
  Summary,
  Run,
} from "../lib/types";
import { download, humanError, jobNames, number, time } from "../lib/utils";
import { DetailDialog, Icon, Panel, Pill, Note } from "./ui";
const ControlView = dynamic(() => import("./control-view"), {
  loading: () => (
    <Panel title="ควบคุมหน้า Meta">
      <p className="panel-form muted">กำลังโหลดเครื่องมือควบคุม…</p>
    </Panel>
  ),
});
const ImportView = dynamic(() => import("./import-view"), {
  loading: () => (
    <Panel title="นำเข้ารายงาน">
      <p className="panel-form muted">กำลังโหลดเครื่องมือนำเข้า…</p>
    </Panel>
  ),
});
const DataView = dynamic(() => import("./data-view"), {
  loading: () => (
    <Panel title="ข้อมูลและส่งออก">
      <p className="panel-form muted">กำลังโหลดข้อมูล…</p>
    </Panel>
  ),
});
const ReportStudioView = dynamic(() => import("./report-studio-view"), {
  loading: () => (
    <Panel title="สตูดิโอรายงาน">
      <p className="panel-form muted">กำลังเปิดรายงาน Ads…</p>
    </Panel>
  ),
});
const AccountsView = dynamic(() => import("./accounts-view"), {
  loading: () => (
    <Panel title="บัญชีและความพร้อม">
      <p className="panel-form muted">กำลังโหลดบัญชี…</p>
    </Panel>
  ),
});
const OptimizationView = dynamic(() => import("./optimization-view"), {
  loading: () => (
    <Panel title="Optimization loop">
      <p className="panel-form muted">กำลังโหลดข้อเสนอและแผน…</p>
    </Panel>
  ),
});
const AnalysisView = dynamic(() => import("./analysis-view"));
const HistoryView = dynamic(() => import("./history-view"));
const CapturesView = dynamic(() => import("./captures-view"));
type View =
  | "analysis"
  | "overview"
  | "reports"
  | "optimization"
  | "accounts"
  | "control"
  | "import"
  | "data"
  | "captures"
  | "history"
  | "settings";
const navigation: {
  id: View;
  label: string;
  icon: string;
  title: string;
  description: string;
}[] = [
  {
    id: "overview",
    label: "ภาพรวม",
    icon: "home",
    title: "ภาพรวมการทำงาน",
    description: "เชื่อมต่อ Extension และเริ่มรวบรวมข้อมูลโฆษณา",
  },
  {
    id: "reports",
    label: "สตูดิโอรายงาน",
    icon: "chart",
    title: "รายงานโฆษณาแบบมองเห็น",
    description:
      "ดูกราฟแท่ง ตาราง และบริบทของข้อมูล Ads เพื่อวิเคราะห์ด้วยตนเอง",
  },
  {
    id: "optimization",
    label: "Optimization Loop",
    icon: "target",
    title: "Optimization และการทดลอง",
    description:
      "เปลี่ยนหลักฐานจาก Ads เป็นข้อเสนอ แผนอนุมัติ การทดลอง และผลลัพธ์ที่วัดได้",
  },
  {
    id: "accounts",
    label: "บัญชีและสุขภาพ",
    icon: "check",
    title: "บัญชีโฆษณาและความพร้อม",
    description:
      "ตรวจ Device, coverage, normalized Ads และ acceptance ของแต่ละบัญชี",
  },
  {
    id: "control",
    label: "ควบคุมหน้า Meta",
    icon: "pointer",
    title: "ควบคุมหน้า Meta",
    description: "อ่านหน้าปัจจุบัน แล้วเลือกสิ่งที่ต้องการให้ Extension ทำ",
  },
  {
    id: "import",
    label: "นำเข้ารายงาน",
    icon: "upload",
    title: "นำเข้ารายงานโฆษณา",
    description: "ตรวจเงื่อนไขและความครบถ้วนของไฟล์ก่อนบันทึก",
  },
  {
    id: "analysis",
    label: "ข้อมูลวิเคราะห์",
    icon: "database",
    title: "ข้อมูลสำหรับวิเคราะห์โฆษณา",
    description: "ตรวจค่าใช้จ่าย คอนเวอร์ชั่น และความพร้อมของข้อมูลรายโฆษณา",
  },
  {
    id: "data",
    label: "ข้อมูลและส่งออก",
    icon: "database",
    title: "ข้อมูลและการส่งออก",
    description: "ค้นหาข้อมูลที่จัดเก็บ และเตรียมไปวิเคราะห์ต่อ",
  },
  {
    id: "captures",
    label: "ข้อมูลจาก Extension",
    icon: "database",
    title: "ข้อมูลดิบจาก Extension",
    description: "ตรวจข้อมูลที่ Extension อ่านจากหน้า Meta และสถานะการยกขึ้นเป็นข้อมูลวิเคราะห์",
  },
  {
    id: "history",
    label: "ประวัติคำสั่ง",
    icon: "clock",
    title: "ประวัติคำสั่ง",
    description: "ติดตามคำสั่งที่ส่งไปยัง Extension และผลที่ได้รับ",
  },
  {
    id: "settings",
    label: "ตั้งค่าและวิธีใช้",
    icon: "settings",
    title: "ตั้งค่าและวิธีใช้งาน",
    description: "เชื่อมต่อระบบและทำความเข้าใจขอบเขตการควบคุม",
  },
];
async function request<T>(
  token: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "เชื่อมต่อ Backend ไม่ได้ ตรวจว่าเปิด npm run dev:api และ Docker อยู่",
    );
  }
  if (
    response.status === 422 &&
    path === "/imports/validate" &&
    result.valid === false
  )
    return result;
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("รหัสเชื่อมต่อไม่ถูกต้อง กรุณาตรวจ API_TOKEN ในไฟล์ .env");
    const details = Array.isArray(result.details)
      ? result.details
          .slice(0, 5)
          .map(
            (d: { path?: string[]; message?: string }) =>
              `${d.path?.join(".") ?? ""}: ${d.message ?? ""}`,
          )
          .join("; ")
      : "";
    throw new Error(
      details || result.error || `คำขอล้มเหลว (${response.status})`,
    );
  }
  return result;
}
export default function Workspace() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    setToken(sessionStorage.getItem("collectorToken") ?? "");
    setReady(true);
  }, []);
  const logout = useCallback(() => {
    sessionStorage.removeItem("collectorToken");
    setToken("");
    setInput("");
  }, []);
  if (!ready)
    return <div className="loading-screen">กำลังเปิด Meta Workspace…</div>;
  if (token)
    return (
      <SWRConfig
        key={token}
        value={{
          provider: () => new Map(),
          revalidateOnFocus: true,
          errorRetryCount: 1,
        }}
      >
        <Dashboard token={token} logout={logout} />
      </SWRConfig>
    );
  return (
    <div className="login-wrap">
      <section className="login-panel">
        <div className="brand-symbol">
          m<span>↗</span>
        </div>
        <h1>Meta Workspace</h1>
        <p className="muted">
          พื้นที่เดียวสำหรับอ่านข้อมูล สั่งงาน Extension
          <br />
          และจัดเก็บรายงานโฆษณาของคุณ
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setConnecting(true);
            setError("");
            try {
              await request(input.trim(), "/health");
              sessionStorage.setItem("collectorToken", input.trim());
              setToken(input.trim());
              setInput("");
            } catch (e) {
              setError(humanError(e));
            } finally {
              setConnecting(false);
            }
          }}
        >
          <label htmlFor="loginToken">รหัสเชื่อมต่อระบบ</label>
          <input
            id="loginToken"
            type="password"
            autoComplete="off"
            required
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="API_TOKEN จากไฟล์ .env"
          />
          <p className="hint">
            ใช้รหัสของระบบนี้จากไฟล์ C:\BF\.env ไม่ใช่รหัส Facebook
          </p>
          <button className="primary wide" type="submit" disabled={connecting}>
            {connecting ? "กำลังเชื่อมต่อ…" : "เข้าสู่หน้าระบบ"}
            <span aria-hidden="true">↗</span>
          </button>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <div className="login-foot">
          <span className="status-dot" />
          ทำงานในเครื่องของคุณ · ควบคุม Meta ผ่าน Extension
        </div>
      </section>
      <aside className="login-guide">
        <span className="eyebrow">เริ่มต้นใช้งาน</span>
        <h2>
          เชื่อมต่อครั้งเดียว
          <br />
          แล้วเริ่มทำงานได้เลย
        </h2>
        <ol>
          <li>
            เปิด Backend ด้วย <code>npm run dev:api</code>
          </li>
          <li>กรอกรหัส API_TOKEN เพื่อเข้าระบบ</li>
          <li>เปิดรับคำสั่งบอทใน Chrome Extension</li>
        </ol>
        <p>
          การสั่งงาน Meta เกิดผ่านหน้าเว็บในเบราว์เซอร์
          <br />
          ไม่มีการเชื่อมต่อ Meta API
        </p>
      </aside>
    </div>
  );
}
function Dashboard({ token, logout }: { token: string; logout: () => void }) {
  const api: Api = useCallback(
    (path, body) => request(token, path, body),
    [token],
  );
  const [view, setView] = useState<View>("overview");
  const [account, setAccount] = useState("");
  const [accountInput, setAccountInput] = useState("");
  const [device, setDevice] = useState("");
  const [manualDevice, setManualDevice] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [detail, setDetail] = useState<{ title: string; data: unknown } | null>(
    null,
  );
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 16000 : 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  const run: Run = useCallback(
    async (label, fn) => {
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        notify(humanError(e), true);
      } finally {
        setBusy("");
      }
    },
    [notify],
  );
  const health = useSWR("/health", api, { refreshInterval: 15000 });
  const bootstrap = useSWR<Bootstrap>("/dashboard", api, {
    refreshInterval: 15000,
  });
  const summary = useSWR<Summary>(
    account ? `/accounts/${account}/summary` : null,
    api,
    { refreshInterval: 15000 },
  );
  const deviceStatus = useSWR<DeviceState | null>(
    device ? `/devices/${device}/state` : null,
    api,
    { refreshInterval: 5000 },
  );
  const commandList = useSWR<CommandRow[]>(
    device ? `/devices/${device}/commands` : null,
    api,
    { refreshInterval: 4000 },
  );
  const importList = useSWR<ImportRow[]>(
    account ? `/imports?account_id=${account}` : null,
    api,
    { refreshInterval: view === "import" ? 15000 : 0 },
  );
  const latestUi = commandList.data?.find(
    (c) => c.status === "done" && c.outcome,
  );
  const receipt = useSWR<Receipt>(
    device && latestUi ? `/devices/${device}/commands/${latestUi.id}` : null,
    api,
  );
  const ds = deviceStatus.data;
  const fresh =
    !!ds?.state.enabled && Date.now() - Date.parse(ds.updated_at) < 90000;
  useEffect(() => {
    const a =
        new URLSearchParams(location.search).get("account") ??
        localStorage.getItem("collectorAccount") ??
        "",
      d = localStorage.getItem("collectorDevice") ?? "";
    if (/^\d+$/.test(a)) {
      setAccount(a);
      setAccountInput(a);
    }
    if (/^[0-9a-f-]{36}$/i.test(d)) setDevice(d);
    setInitialized(true);
    const id = location.hash.slice(1);
    if (navigation.some((n) => n.id === id)) setView(id as View);
  }, []);
  useEffect(() => {
    if (!initialized || !bootstrap.data) return;
    const online = bootstrap.data.devices.filter(
      (d) =>
        d.enabled === "true" && Date.now() - Date.parse(d.updated_at) < 90000,
    );
    if (account) {
      const selected = bootstrap.data.devices.find((d) => d.id === device);
      if (!device || (selected && selected.account_id !== account)) {
        const match = online.find((d) => d.account_id === account);
        if (match) setDevice(match.id);
      }
      return;
    }
    const d = online.find((d) => d.id === device) ?? online[0];
    if (d) {
      setAccount(d.account_id);
      setAccountInput(d.account_id);
      if (!device) setDevice(d.id);
    }
  }, [initialized, account, bootstrap.data, device]);
  useEffect(() => {
    if (initialized) {
      localStorage.setItem("collectorAccount", account);
      localStorage.setItem("collectorDevice", device);
    }
  }, [account, device, initialized]);
  const changeView = (id: View) => {
    setView(id);
    history.replaceState(null, "", `#${id}`);
  };
  const applyAccount = () => {
    if (!/^\d+$/.test(accountInput)) {
      notify("Account ID ต้องเป็นตัวเลขเท่านั้น", true);
      return;
    }
    setAccount(accountInput);
    const bound = bootstrap.data?.devices.find((d) => d.id === device);
    if (bound && bound.account_id !== accountInput)
      setDevice(
        bootstrap.data?.devices.find((d) => d.account_id === accountInput)
          ?.id ?? "",
      );
  };
  const chooseDevice = (id: string) => {
    setDevice(id);
    const d = bootstrap.data?.devices.find((d) => d.id === id);
    if (d) {
      setAccount(d.account_id);
      setAccountInput(d.account_id);
    }
  };
  const refresh = async () => {
    await Promise.all([
      health.mutate(),
      bootstrap.mutate(),
      summary.mutate(),
      deviceStatus.mutate(),
      commandList.mutate(),
      importList.mutate(),
    ]);
  };
  const send = async (command: unknown) => {
    if (!account) throw new Error("เลือกบัญชีโฆษณาด้านบนก่อน");
    if (!device) throw new Error("เลือก Extension ที่เชื่อมต่อก่อน");
    const bound =
      ds?.state.bound_account ??
      bootstrap.data?.devices.find((d) => d.id === device)?.account_id;
    if (bound && bound !== account)
      throw new Error("บัญชีไม่ตรงกับบัญชีที่ผูกใน Extension");
    const r = await api<{ id: string }>(`/devices/${device}/commands`, command);
    notify("ส่งคำสั่งแล้ว รอ Extension ตรวจรับประมาณ 30 วินาที");
    await commandList.mutate();
    return r.id;
  };
  const current = navigation.find((n) => n.id === view)!;
  const s = summary.data;
  const error =
    health.error ?? bootstrap.error ?? deviceStatus.error ?? summary.error;
  return (
    <>
      <a className="skip" href="#main">
        ข้ามไปเนื้อหา
      </a>
      <div className="workspace">
        <aside className="sidebar">
          <a
            className="brand"
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              changeView("overview");
            }}
          >
            <span className="brand-small">m↗</span>
            <span>
              Meta<span className="brand-sub">Workspace</span>
            </span>
          </a>
          <nav aria-label="เมนูหลัก">
            {navigation.map((n) => (
              <button
                key={n.id}
                className={view === n.id ? "active" : ""}
                aria-current={view === n.id ? "page" : undefined}
                onClick={() => changeView(n.id)}
              >
                <Icon name={n.icon} />
                {n.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-label">
              <span className="status-dot" />
              ระบบภายในเครื่อง
            </div>
            <p>อ่านและควบคุมผ่าน Extension</p>
            <button onClick={logout} className="text-button">
              <Icon name="logout" />
              ออกจากระบบ
            </button>
          </div>
        </aside>
        <div className="page-shell">
          <header className="topbar">
            <div className="topbar-title">
              <span className="muted">พื้นที่ทำงาน</span>
              <strong>{current.label}</strong>
            </div>
            <div className="topbar-actions">
              <Pill
                kind={
                  health.error ? "error" : health.data ? "success" : "neutral"
                }
              >
                {health.error
                  ? "เชื่อมต่อไม่ได้"
                  : health.data
                    ? "ระบบพร้อมใช้งาน"
                    : "กำลังเชื่อมต่อ"}
              </Pill>
              <button
                className="icon-button"
                aria-label="รีเฟรชข้อมูล"
                title="รีเฟรชข้อมูล"
                disabled={!!busy}
                onClick={() => void run("refresh", refresh)}
              >
                <Icon name="refresh" />
              </button>
              <button className="mobile-logout text-button" onClick={logout}>
                ออก
              </button>
            </div>
          </header>
          <main id="main">
            <div className="page-heading">
              <div>
                <h1>{current.title}</h1>
                <p className="muted">{current.description}</p>
              </div>
              <a
                className="button secondary"
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns${account ? "?act=" + account : ""}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="external" />
                เปิด Ads Manager
              </a>
            </div>
            {error ? (
              <div role="alert" className="notice-error">
                {humanError(error)}{" "}
                {String(error).includes("รหัส") ? (
                  <button className="text-button" onClick={logout}>
                    เชื่อมต่อใหม่
                  </button>
                ) : null}
              </div>
            ) : null}
            <section className="context-bar" aria-label="เลือกบัญชีและอุปกรณ์">
              <div>
                <label htmlFor="account">บัญชีโฆษณา</label>
                <form
                  className="input-with-button"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyAccount();
                  }}
                >
                  <input
                    id="account"
                    list="accounts"
                    inputMode="numeric"
                    placeholder="กรอก Account ID"
                    value={accountInput}
                    onChange={(e) => setAccountInput(e.target.value)}
                    onBlur={() => {
                      if (
                        accountInput !== account &&
                        /^\d+$/.test(accountInput)
                      )
                        applyAccount();
                    }}
                  />
                  <datalist id="accounts">
                    {bootstrap.data?.accounts.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                  <button className="subtle" type="submit">
                    เลือก
                  </button>
                </form>
              </div>
              <div className="device-field">
                <label htmlFor="device">Chrome Extension</label>
                <select
                  id="device"
                  value={device}
                  onChange={(e) => chooseDevice(e.target.value)}
                >
                  <option value="">เลือก Extension ที่เชื่อมต่อ</option>
                  {bootstrap.data?.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      บัญชี {d.account_id} • {d.id.slice(0, 8)}
                    </option>
                  ))}
                  {device &&
                  !bootstrap.data?.devices.some((d) => d.id === device) ? (
                    <option value={device}>
                      อุปกรณ์ {device.slice(0, 8)} (รอสถานะ)
                    </option>
                  ) : null}
                </select>
              </div>
              <div className="context-state">
                <Pill kind={fresh ? "success" : device ? "warning" : "neutral"}>
                  {fresh
                    ? "เชื่อมต่อแล้ว"
                    : device
                      ? "ยังไม่ยืนยันการเชื่อมต่อ"
                      : "ยังไม่เชื่อมต่อ"}
                </Pill>
                <small>
                  {ds
                    ? `สถานะล่าสุด ${time(ds.updated_at)}`
                    : "เปิดรับคำสั่งจาก Extension ก่อน"}
                </small>
              </div>
            </section>
            {view === "overview" ? (
              <>
                <div className="setup-banner" hidden={fresh}>
                  <span className="banner-icon">
                    <Icon name="plug" />
                  </span>
                  <div>
                    <h2>เริ่มจากเชื่อมต่อ Chrome Extension</h2>
                    <p>
                      เปิด Ads Manager → เปิด Extension → กรอกบัญชีและรหัส →
                      เปิดรับคำสั่งบอท แล้วกลับมารีเฟรชหน้านี้
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => changeView("settings")}
                  >
                    ดูวิธีเชื่อมต่อ
                  </button>
                </div>
                <div className="section-head">
                  <h2>ข้อมูลในฐานข้อมูล</h2>
                  <span className="muted small">เฉพาะบัญชีที่เลือก</span>
                </div>
                <div className="stats-strip">
                  {[
                    ["Campaigns", s?.campaigns],
                    ["Ad Sets", s?.ad_sets],
                    ["Ads", s?.ads],
                    ["รายการสถิติ", s?.observations],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{number(value as number | undefined)}</strong>
                    </div>
                  ))}
                </div>
                <div className="overview-grid">
                  <Panel title="ทำงานต่อจากตรงนี้">
                    {[
                      {
                        view: "reports" as View,
                        icon: "chart",
                        title: "เปิดสตูดิโอรายงาน",
                        description:
                          "ดู Spend, Results, Impressions และสถานะ Ads ในกราฟและตาราง",
                      },
                      {
                        view: "control" as View,
                        icon: "pointer",
                        title: "อ่านหรือควบคุมหน้า Meta",
                        description: "เลือกปุ่มและช่องกรอกจากหน้าที่ Extension มองเห็น",
                      },
                      {
                        view: "import" as View,
                        icon: "upload",
                        title: "นำเข้ารายงานย้อนหลัง",
                        description: "เลือก CSV ตรวจสอบข้อมูล แล้วบันทึกลงฐานข้อมูล",
                      },
                      {
                        view: "data" as View,
                        icon: "download",
                        title: "ดูข้อมูลและส่งออก",
                        description: "ค้นหา กรอง และดาวน์โหลดข้อมูลเพื่อวิเคราะห์ต่อ",
                      },
                    ].map((task) => (
                      <button
                        key={task.view}
                        className="task-row"
                        onClick={() => changeView(task.view)}
                      >
                        <span className="task-icon">
                          <Icon name={task.icon} />
                        </span>
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.description}</p>
                        </div>
                        <span aria-hidden="true">›</span>
                      </button>
                    ))}
                  </Panel>
                  <Panel title="สถานะระบบ">
                    <dl className="status-list">
                      {[
                        [
                          "Backend / Database",
                          health.data
                            ? "พร้อมใช้งาน"
                            : health.error
                              ? "เชื่อมต่อไม่ได้"
                              : "กำลังตรวจสอบ",
                        ],
                        ["Extension", fresh ? "เชื่อมต่อแล้ว" : "ยังไม่มีสถานะใหม่"],
                        [
                          "งานอ่านตาราง",
                          jobNames[ds?.state.job?.status ?? ""] ?? "ยังไม่มีงาน",
                        ],
                        ["การนำเข้าทั้งหมด", number(s?.imports)],
                        ["นำเข้าล่าสุด", time(s?.last_import)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <Note>จำนวนที่จัดเก็บยังไม่ยืนยันว่าครบทั้งบัญชี</Note>
                  </Panel>
                </div>
              </>
            ) : null}
            {view === "control" ? (
              <ControlView
                key={device}
                account={account}
                device={device}
                deviceState={ds ?? undefined}
                commands={commandList.data ?? []}
                receipt={receipt.data}
                send={send}
                run={run}
                busy={!!busy}
                fresh={fresh}
              />
            ) : null}
            {view === "reports" ? (
              <ReportStudioView
                key={account}
                account={account}
                api={api}
                run={run}
                busy={!!busy}
                deviceState={ds ?? undefined}
                device={device}
                send={send}
                fresh={fresh}
                onOpenCaptureSetup={() => changeView("analysis")}
                onOpenOptimization={() => changeView("optimization")}
                onImport={() => changeView("import")}
                onRefreshDevice={() => void deviceStatus.mutate()}
              />
            ) : null}
            {view === "optimization" ? (
              <OptimizationView
                key={account}
                account={account}
                api={api}
                run={run}
                busy={!!busy}
                onOpenControl={() => changeView("control")}
              />
            ) : null}
            {view === "accounts" ? (
              <AccountsView
                account={account}
                api={api}
                run={run}
                onSelect={(nextAccount) => {
                  setAccount(nextAccount);
                  setAccountInput(nextAccount);
                  const nextDevice = bootstrap.data?.devices.find(
                    (item) =>
                      item.account_id === nextAccount &&
                      Date.now() - Date.parse(item.updated_at) < 90000,
                  );
                  if (nextDevice) setDevice(nextDevice.id);
                  changeView("reports");
                }}
              />
            ) : null}
            {view === "analysis" ? (
              <AnalysisView
                key={account}
                account={account}
                api={api}
                run={run}
                busy={!!busy}
                deviceState={ds ?? undefined}
                send={send}
                fresh={fresh}
                onImport={() => changeView("import")}
              />
            ) : null}
            {view === "import" ? (
              <ImportView
                key={account}
                account={account}
                api={api}
                run={run}
                busy={!!busy}
                notify={notify}
                imports={importList.data ?? []}
                refresh={() => importList.mutate()}
                onSaved={() =>
                  void Promise.all([summary.mutate(), importList.mutate()])
                }
                showDetails={(title, data) => setDetail({ title, data })}
              />
            ) : null}
            {view === "data" ? (
              <DataView
                key={account}
                account={account}
                api={api}
                run={run}
                busy={!!busy}
                showDetails={(title, data) => setDetail({ title, data })}
              />
            ) : null}
            {view === "captures" ? (
              <CapturesView
                key={account}
                account={account}
                api={api}
                run={run}
                busy={!!busy}
                notify={notify}
              />
            ) : null}
            {view === "history" ? (
              <HistoryView
                device={device}
                commands={commandList.data ?? []}
                refresh={() => commandList.mutate()}
                api={api}
                run={run}
                showDetails={(title, data) => setDetail({ title, data })}
              />
            ) : null}
            {view === "settings" ? (
              <div className="settings-grid">
                <Panel title="เชื่อมต่อ Chrome Extension">
                  <div className="panel-form">
                    <ol className="setup-steps">
                      {[
                        [
                          "ติดตั้งหรือ Reload Extension",
                          "เปิด chrome://extensions → Developer mode → Load unpacked → C:\\BF\\dist\\extension",
                        ],
                        [
                          "เปิดบัญชีโฆษณาที่ต้องการ",
                          "เปิด Ads Manager ที่มี act=AccountID ใน URL",
                        ],
                        [
                          "เปิดรับคำสั่งบอท",
                          "เปิด popup ของ Extension กรอกบัญชีและรหัส Backend ชุดเดียวกับหน้านี้ แล้วกดเปิดรับคำสั่งบอท",
                        ],
                        [
                          "เลือกอุปกรณ์ในหน้าระบบ",
                          "กดรีเฟรชแล้วเลือก Extension ด้านบน หากยังไม่แสดง สามารถใส่ Device ID เองด้านล่างได้",
                        ],
                      ].map(([title, description]) => (
                        <li key={title}>
                          <strong>{title}</strong>
                          <p>{description}</p>
                        </li>
                      ))}
                    </ol>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                            manualDevice,
                          )
                        ) {
                          notify("Device ID ต้องเป็น UUID จาก Extension", true);
                          return;
                        }
                        setDevice(manualDevice);
                        setManualDevice("");
                        notify("เลือก Device ID แล้ว รอสถานะจาก Extension");
                      }}
                    >
                      <label htmlFor="manualDevice">
                        เพิ่ม Device ID ด้วยตนเอง
                      </label>
                      <div className="input-with-button">
                        <input
                          id="manualDevice"
                          value={manualDevice}
                          onChange={(e) =>
                            setManualDevice(e.target.value.trim())
                          }
                          placeholder="Device UUID จาก Extension"
                        />
                        <button className="secondary">เพิ่ม</button>
                      </div>
                    </form>
                  </div>
                </Panel>
                <Panel title="สิ่งที่ควรรู้ก่อนสั่งงาน">
                  <div className="panel-form guide-copy">
                    <h3>โหมดอ่านและโหมดควบคุม</h3>
                    <p>
                      อ่านหน้าและรวบรวมตารางได้ทันทีที่เชื่อมต่อ การคลิก กรอก
                      หรืออัปโหลดต้องเปิดโหมดควบคุม 15 นาทีจาก Extension
                    </p>
                    <h3>การเผยแพร่และการอนุมัติ</h3>
                    <p>
                      คำสั่งสำคัญที่ระบบระบุได้ต้องอนุมัติใน popup ก่อน
                      หน้าระบบไม่สามารถอนุมัติแทนคุณได้ ฟอร์มบางชนิดอาจบันทึกอัตโนมัติ
                      จึงควรตรวจบัญชีและค่าทุกครั้ง
                    </p>
                    <h3>ข้อจำกัดของข้อมูล</h3>
                    <p>
                      อ่านเฉพาะส่วนที่แสดงบนเว็บ ใช้ CSV เป็นแหล่งหลักของข้อมูลย้อนหลัง
                      ข้อมูลที่บันทึกได้ยังไม่ยืนยันความครบทั้งบัญชี
                    </p>
                    <h3>ข้อมูลและความเป็นส่วนตัว</h3>
                    <p>
                      รหัสเชื่อมต่อเก็บใน session ของแท็บนี้ ออกจากระบบเพื่อลบรหัส
                      ไม่มีการอ่าน cookie หรือใช้ Meta API
                    </p>
                    <div className="button-group">
                      <button
                        className="secondary"
                        onClick={() =>
                          void run("health", async () => {
                            await api("/health");
                            notify("Backend และ PostgreSQL พร้อมใช้งาน");
                          })
                        }
                      >
                        ตรวจสถานะระบบ
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          download(
                            JSON.stringify(
                              {
                                account_id: account,
                                device_id: device,
                                frontend: location.origin,
                                backend: "http://127.0.0.1:4318",
                                extension_state: ds?.updated_at,
                              },
                              null,
                              2,
                            ),
                            "connection-info.json",
                          )
                        }
                      >
                        ส่งออกข้อมูลการเชื่อมต่อ
                      </button>
                    </div>
                  </div>
                </Panel>
              </div>
            ) : null}
          </main>
          <footer className="page-footer">
            <span>
              Meta Workspace <span className="muted">/ ระบบในเครื่อง</span>
            </span>
            <span>ควบคุม Meta ผ่าน Chrome Extension</span>
          </footer>
        </div>
      </div>
      {toast ? (
        <div className="toast-region" role="status" aria-live="polite">
          <div className={`toast${toast.error ? " error" : ""}`}>
            <span>{toast.message}</span>
            <button aria-label="ปิดข้อความ" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        </div>
      ) : null}
      <DetailDialog detail={detail} onClose={() => setDetail(null)} />
    </>
  );
}
