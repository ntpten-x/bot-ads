"use client";
import { useState } from "react";
import type { Api, CommandRow, Receipt, Run } from "../lib/types";
import { actionName, outcomeName, time } from "../lib/utils";
import { EmptyRow, Panel, Pill } from "./ui";
export default function HistoryView({
  device,
  commands,
  refresh,
  api,
  run,
  showDetails,
}: {
  device: string;
  commands: CommandRow[];
  refresh: () => Promise<unknown>;
  api: Api;
  run: Run;
  showDetails: (title: string, data: unknown) => void;
}) {
  const [filter, setFilter] = useState("");
  const rows = commands.filter((c) => !filter || c.status === filter);
  return (
    <Panel
      title="คำสั่งที่ส่งไปยัง Extension"
      subtitle="100 คำสั่งล่าสุดของอุปกรณ์ที่เลือก · ตรวจรับคำสั่งประมาณทุก 30 วินาที"
      action={
        <button
          className="text-button"
          onClick={() =>
            void run("commands", async () => {
              await refresh();
            })
          }
        >
          รีเฟรช
        </button>
      }
    >
      <div className="history-filter">
        <label htmlFor="commandFilter">สถานะ</label>
        <select
          id="commandFilter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">ทั้งหมด</option>
          <option value="pending">รอดำเนินการ</option>
          <option value="done">ทำงานแล้ว</option>
          <option value="error">มีข้อผิดพลาด</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>คำสั่ง</th>
              <th>เวลาที่ส่ง</th>
              <th>สถานะ</th>
              <th>ผลลัพธ์</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{actionName(row.command)}</strong>
                    <small>{row.id.slice(0, 8)}</small>
                  </td>
                  <td>{time(row.created_at)}</td>
                  <td>
                    <Pill
                      kind={
                        row.status === "pending"
                          ? "warning"
                          : row.status === "error"
                            ? "error"
                            : "success"
                      }
                    >
                      {row.status === "pending"
                        ? "รอดำเนินการ"
                        : row.status === "error"
                          ? "มีข้อผิดพลาด"
                          : "ทำงานแล้ว"}
                    </Pill>
                  </td>
                  <td>{row.error ?? outcomeName(row.outcome)}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run("detail", async () => {
                          const r = await api<Receipt>(
                            `/devices/${device}/commands/${row.id}`,
                          );
                          showDetails(actionName(row.command), r);
                        })
                      }
                    >
                      ดูรายละเอียด
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow cols={5}>
                {device ? "ยังไม่มีคำสั่งในสถานะนี้" : "เลือก Extension เพื่อดูประวัติคำสั่ง"}
              </EmptyRow>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
