"use client";
import { useState } from "react";
import useSWR from "swr";
import type { Api, CaptureDetail, CaptureSummary, Run } from "../lib/types";
import { time } from "../lib/utils";
import { EmptyRow, Note, Panel, Pill } from "./ui";
import CaptureAnalysisPanel from "./capture-analysis-panel";

const statusNames: Record<string, string> = {
  needs_review: "รอตรวจ",
  partially_promoted: "ยกขึ้นบางแถว",
  promoted: "ยกขึ้นเป็นข้อมูลแล้ว",
  rejected: "ปฏิเสธ",
};
const statusKind = (s: string) =>
  s === "promoted" ? "success" : s === "rejected" ? "error" : s === "partially_promoted" ? "neutral" : "warning";
const levelNames: Record<string, string> = { campaigns: "แคมเปญ", adsets: "ชุดโฆษณา", ads: "โฆษณา" };
export const reasonNames: Record<string, string> = {
  stable_id_unverified: "ไม่มี ID จากลิงก์หรือคอลัมน์ ID",
  duplicate_id_in_snapshot: "ID ซ้ำกันหลายแถว",
  parent_campaign_id_unverified: "ไม่มี ID แคมเปญแม่",
  parent_ad_set_id_unverified: "ไม่มี ID ชุดโฆษณาแม่",
  parent_campaign_not_promoted: "แคมเปญแม่ยังไม่ถูกบันทึก",
  parent_ad_set_not_promoted: "ชุดโฆษณาแม่ยังไม่ถูกบันทึก",
  parent_relationship_conflict: "ความสัมพันธ์แม่-ลูกขัดกับข้อมูลเดิม",
  column_mapping_unverified: "ยืนยันการจับคู่คอลัมน์ไม่ได้",
  header_body_scroll_mismatch: "หัวตารางกับแถวเลื่อนไม่ตรงกัน",
  date_range_unverified: "ไม่พบวันที่ชัดเจน",
  currency_unverified: "ยืนยันสกุลเงินไม่ได้",
  currency_conflict: "สกุลเงินในเซลล์ขัดกัน",
  timezone_unverified: "ยืนยันเขตเวลาไม่ได้",
  attribution_unverified: "ยืนยัน Attribution ไม่ได้",
  result_type_unverified: "ไม่ทราบประเภทผลลัพธ์",
  "missing_required_metric:spend": "ไม่มีคอลัมน์ยอดใช้จ่าย",
  "missing_required_metric:impressions": "ไม่มีคอลัมน์อิมเพรสชัน",
  entity_name_missing: "ไม่พบชื่อในแถว",
  csv_observation_exists: "มีข้อมูลจาก CSV ของเงื่อนไขนี้แล้ว",
  account_mismatch: "บัญชีไม่ตรงกับที่ผูกไว้",
  no_rows_separated: "แยกแถวไม่ได้",
  invalid_snapshot_shape: "รูปแบบข้อมูลไม่ถูกต้อง",
  duplicate_grain_in_snapshot: "แถวซ้ำเงื่อนไขเดียวกัน",
};
const reasonText = (r: string) => reasonNames[r] ?? r;

export default function CapturesView({
  account,
  api,
  run,
  busy,
  notify,
}: {
  account: string;
  api: Api;
  run: Run;
  busy: boolean;
  notify: (message: string, error?: boolean) => void;
}) {
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState("");
  const [timezone, setTimezone] = useState("");
  const [attribution, setAttribution] = useState("");
  const list = useSWR<CaptureSummary[]>(
    account ? `/captures?account_id=${account}${status ? `&status=${status}` : ""}` : null,
    api,
    { refreshInterval: 30000 },
  );
  const detail = useSWR<CaptureDetail>(selected ? `/captures/${selected}` : null, api);
  const rows = list.data ?? [];
  return (
    <div className="captures-grid">
      <CaptureAnalysisPanel account={account} api={api} run={run} />
      <Panel
        title="ข้อมูลดิบจาก Extension"
        subtitle="ทุกครั้งที่ Extension อ่านตาราง ระบบบันทึกลง PostgreSQL อัตโนมัติ แถวที่ยืนยัน ID วันที่ สกุลเงิน เขตเวลา Attribution และคอลัมน์ครบเท่านั้นที่ถูกยกขึ้นเป็นข้อมูลวิเคราะห์"
        action={
          <button className="text-button" onClick={() => void run("captures", async () => void (await list.mutate()))}>
            รีเฟรช
          </button>
        }
      >
        <div className="history-filter">
          <label htmlFor="captureFilter">สถานะ</label>
          <select id="captureFilter" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {Object.entries(statusNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ระดับ</th>
                <th>เวลาที่อ่าน</th>
                <th>แถว</th>
                <th>มี ID</th>
                <th>ยกขึ้นแล้ว</th>
                <th>สถานะ</th>
                <th>เหตุผล</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((c) => (
                  <tr key={c.id} className={c.id === selected ? "selected" : undefined}>
                    <td>
                      <strong>{levelNames[c.level ?? ""] ?? c.page}</strong>
                      <small>
                        {c.reader_version ?? "?"} · {c.coverage ?? "?"}
                      </small>
                    </td>
                    <td>{time(c.captured_at)}</td>
                    <td>{c.row_count}</td>
                    <td>{c.rows_with_id}</td>
                    <td>{c.promoted_rows}</td>
                    <td>
                      <Pill kind={statusKind(c.review_status)}>{statusNames[c.review_status] ?? c.review_status}</Pill>
                    </td>
                    <td className="small">{c.review_reasons.slice(0, 3).map(reasonText).join(", ")}</td>
                    <td>
                      <button className="text-button" onClick={() => setSelected(c.id)}>
                        ดูแถว
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow cols={8}>
                  {account ? (list.isLoading ? "กำลังโหลด…" : "ยังไม่มีข้อมูลที่ Extension อ่าน") : "เลือกบัญชีโฆษณาก่อน"}
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      {detail.data ? (
        <Panel
          title={`แถวที่อ่านได้ · ${levelNames[detail.data.level ?? ""] ?? detail.data.page}`}
          subtitle={`ช่วงวันที่: ${detail.data.reporting_context?.date_range_label ?? "ไม่ทราบ"} · สกุลเงิน: ${detail.data.reporting_context?.currency ?? "unverified"} · เขตเวลา: ${detail.data.reporting_context?.timezone ?? "unverified"} · การจัดแนวคอลัมน์: ${detail.data.column_alignment ?? "?"}`}
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>ID</th>
                  <th>ชื่อ</th>
                  <th>คอลัมน์</th>
                  <th>สถานะ</th>
                  <th>เหตุผล</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.rows.map((r) => (
                  <tr key={r.row_index}>
                    <td>{r.row_index + 1}</td>
                    <td>
                      {r.entity_id ?? "—"}
                      <small>{r.identity_source ?? "ไม่ยืนยัน"}</small>
                    </td>
                    <td>{r.name ?? "—"}</td>
                    <td className="small">{r.cells.map((c) => `${c.header}: ${c.text.split("\n")[0]}`).join(" · ")}</td>
                    <td>
                      <Pill kind={statusKind(r.review_status)}>{statusNames[r.review_status] ?? r.review_status}</Pill>
                    </td>
                    <td className="small">{r.review_reasons.map(reasonText).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-form">
            <Note>
              ยืนยันเขตเวลาและ Attribution จากหน้าตั้งค่าบัญชีโฆษณาได้เหมือนการนำเข้า CSV ส่วน ID วันที่ และสกุลเงินต้องมาจากหน้า Meta เท่านั้น
            </Note>
            <label htmlFor="captureTimezone">เขตเวลา (IANA เช่น Asia/Bangkok)</label>
            <input id="captureTimezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            <label htmlFor="captureAttribution">Attribution</label>
            <input id="captureAttribution" value={attribution} onChange={(e) => setAttribution(e.target.value)} />
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run("review", async () => {
                  const context = {
                    ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
                    ...(attribution.trim() ? { attribution: attribution.trim() } : {}),
                  };
                  const r = await api<{ status: string; promoted: number; rows: number }>(
                    `/captures/${selected}/review`,
                    Object.keys(context).length ? { context } : {},
                  );
                  notify(`ตรวจซ้ำแล้ว: ยกขึ้น ${r.promoted}/${r.rows} แถว (${statusNames[r.status] ?? r.status})`);
                  await Promise.all([detail.mutate(), list.mutate()]);
                })
              }
            >
              ตรวจซ้ำและยกแถวที่ครบเงื่อนไข
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
