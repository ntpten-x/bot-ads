"use client";
import { useEffect, useRef, type ReactNode } from "react";
const paths: Record<string, string[]> = {
  home: ["M3 10 12 3l9 7", "M5 9v11h5v-6h4v6h5V9"],
  pointer: ["m5 3 14 10-7 1-3 7Z", "m13 14 5 6"],
  upload: ["M12 16V3", "m7 8 5-5 5 5", "M4 15v5h16v-5"],
  download: ["M12 3v13", "m7 11 5 5 5-5", "M4 16v5h16v-5"],
  database: [
    "M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3Z",
    "M4 6v12c0 2 4 3 8 3s8-1 8-3V6",
    "M4 12c0 2 4 3 8 3s8-1 8-3",
  ],
  clock: ["M12 8v5l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"],
  settings: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    "m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3Z",
  ],
  logout: ["M10 4H4v16h6", "M9 12h12", "m17 8 4 4-4 4"],
  refresh: ["M20 8a8 8 0 1 0 0 8", "M20 3v6h-6"],
  external: ["M14 3h7v7", "M21 3 10 14", "M10 4H4v16h16v-6"],
  plug: ["M8 3v5", "M16 3v5", "M5 8h14", "M7 8v4a5 5 0 0 0 10 0V8", "M12 17v5"],
  info: ["M12 11v6", "M12 7v.1", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"],
  scan: ["M8 3H3v5", "M16 3h5v5", "M21 16v5h-5", "M8 21H3v-5", "M7 12h10"],
  image: ["M3 4h18v16H3Z", "m3 16 5-5 4 4 4-5 5 6", "M8 8h.1"],
  check: ["m5 12 4 4 10-10", "M21 12a9 9 0 1 1-9-9"],
  target: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    "M12 2v3",
    "M12 19v3",
    "M2 12h3",
    "M19 12h3",
  ],
  search: ["M21 21l-6-6", "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0"],
  chart: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
};
export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {(paths[name] ?? paths.info).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
export function Pill({
  children,
  kind = "neutral",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return <span className={`pill ${kind}`}>{children}</span>;
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  icon = "scan",
  title,
  children,
}: {
  icon?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function EmptyRow({
  cols,
  children,
}: {
  cols: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={cols} className="empty-cell">
        {children}
      </td>
    </tr>
  );
}
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="inline-note">
      <Icon name="info" />
      {children}
    </p>
  );
}
export function DetailDialog({
  detail,
  onClose,
}: {
  detail: { title: string; data: unknown } | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail && !ref.current?.open) ref.current?.showModal();
    else if (!detail) ref.current?.close();
  }, [detail]);
  return (
    <dialog ref={ref} onClose={onClose}>
      <div className="dialog-head">
        <h2>{detail?.title}</h2>
        <button
          onClick={() => ref.current?.close()}
          className="icon-button"
          aria-label="ปิดรายละเอียด"
        >
          ×
        </button>
      </div>
      <div className="dialog-body">
        <pre>{detail ? JSON.stringify(detail.data, null, 2) : ""}</pre>
      </div>
    </dialog>
  );
}
