"use client";
import { useState } from "react";
import useSWR from "swr";
import type {
  CaptureJobAnalysis,
  Delivery,
  RankedRow,
} from "../../../packages/core/src/capture-analysis";
import type { Api, Run } from "../lib/types";
import { time } from "../lib/utils";
import { EmptyRow, Note, Panel, Pill } from "./ui";

type Response = CaptureJobAnalysis & {
  job: {
    id: string;
    status?: string;
    error?: string | null;
    level_warnings?: string[];
    extension_version?: string | null;
    updated_at?: string;
  };
  jobs: { job_id: string; captured_at: string; snapshots: number }[];
};
const levelNames: Record<string, string> = {
  campaigns: "แคมเปญ",
  adsets: "ชุดโฆษณา",
  ads: "โฆษณา",
};
export const deliveryNames: Record<Delivery, string> = {
  payment_error: "ข้อผิดพลาดการชำระเงิน",
  parent_off: "ระดับบนปิดอยู่",
  off: "ปิด",
  limited: "จำกัดการเรียนรู้",
  learning: "กำลังเรียนรู้",
  in_review: "รอตรวจสอบ",
  rejected: "ถูกปฏิเสธ",
  not_delivering: "ไม่ได้นำส่ง",
  completed: "เสร็จสมบูรณ์",
  active: "ใช้งานอยู่",
  unknown: "ไม่ทราบ",
};
const deliveryKind = (d: Delivery) =>
  d === "payment_error" || d === "rejected"
    ? "error"
    : d === "active"
      ? "success"
      : d === "off" || d === "parent_off"
        ? "neutral"
        : "warning";
const severityKind: Record<string, string> = {
  critical: "error",
  warning: "warning",
  opportunity: "success",
  info: "neutral",
};
const severityNames: Record<string, string> = {
  critical: "เร่งด่วน",
  warning: "ควรทบทวน",
  opportunity: "โอกาส",
  info: "ข้อมูล",
};
const money = (n: number | null, currency: string | null) =>
  n === null
    ? "—"
    : `${currency === "THB" ? "฿" : currency ? `${currency} ` : ""}${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
const num = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("th-TH");
const spendNames: Record<string, string> = {
  reported: "ยอดจริงจากคอลัมน์ของ Meta",
  estimated: "ค่าประมาณจากผลลัพธ์ × ต้นทุนต่อผลลัพธ์",
  mixed: "ยอดใช้จ่ายหลายแหล่งหรือบางรายการยังขาด (ตรวจรายแถว)",
  missing: "ยังไม่มียอดใช้จ่ายที่อ่านได้",
};
const jobNames: Record<string, string> = {
  running: "กำลังอ่าน",
  paused: "พักงาน",
  needs_review: "รอตรวจหลักฐาน",
  error: "อ่านไม่สำเร็จ",
};

export default function CaptureAnalysisPanel({
  account,
  api,
  run,
}: {
  account: string;
  api: Api;
  run: Run;
}) {
  const [selection, setSelection] = useState({ account, job: "" });
  const selectedJob = selection.account === account ? selection.job : "";
  const analysis = useSWR<Response>(
    account
      ? `/captures/analysis?account_id=${account}${selectedJob ? `&job_id=${selectedJob}` : ""}`
      : null,
    api,
    {
      refreshInterval: 30000,
      shouldRetryOnError: false,
    },
  );
  const a = analysis.data;
  return (
    <Panel
      title="วิเคราะห์ประสิทธิภาพจากงานอ่านล่าสุด"
      subtitle={
        a
          ? a.notice
          : "สรุปผลลัพธ์ ต้นทุนต่อผลลัพธ์ สถานะ และคำแนะนำจากตารางที่ Extension อ่านได้"
      }
      action={
        <button
          className="text-button"
          onClick={() =>
            void run(
              "capture-analysis",
              async () => void (await analysis.mutate()),
            )
          }
        >
          รีเฟรช
        </button>
      }
    >
      {!a ? (
        <p className="muted small">
          {analysis.isLoading
            ? "กำลังโหลด…"
            : analysis.error
              ? `โหลดหลักฐานไม่ได้: ${analysis.error.message}`
              : account
                ? "ยังไม่มีงานอ่านจาก Extension"
                : "เลือกบัญชีโฆษณาก่อน"}
        </p>
      ) : (
        <>
          <label htmlFor="captureAnalysisJob">งานอ่านที่ต้องการตรวจ</label>{" "}
          <select
            id="captureAnalysisJob"
            value={selectedJob}
            onChange={(e) => setSelection({ account, job: e.target.value })}
          >
            <option value="">งานล่าสุด</option>
            {a.jobs.map((job) => (
              <option key={job.job_id} value={job.job_id}>
                {time(job.captured_at)} · {job.snapshots} ภาพ
              </option>
            ))}
          </select>
          <p className="small muted">
            งานอ่าน {a.job.id.slice(0, 8)} ·{" "}
            {jobNames[a.job.status ?? ""] ?? a.job.status ?? "?"} · Extension{" "}
            {a.job.extension_version ?? "?"}
            {a.job.updated_at ? ` · ${time(a.job.updated_at)}` : ""} · ตัวตน:{" "}
            {a.data_quality.identity === "verified_ids"
              ? "ยืนยันด้วย ID"
              : "ยังยืนยันจำนวนแอดไม่ได้"}{" "}
            · ยอดใช้จ่าย: {spendNames[a.data_quality.spend] ?? "ยังไม่ยืนยัน"}
          </p>
          {a.job.error ? <Note>งานอ่านมีข้อผิดพลาด: {a.job.error}</Note> : null}
          {a.job.level_warnings?.map((warning, i) => (
            <Note key={i}>{warning}</Note>
          ))}
          <Note>
            แต่ละชุดด้านล่างแยกตามเงื่อนไขรายงาน ห้ามบวกยอดข้ามชุด ภาพจากการเลื่อนคอลัมน์ที่ไม่มี
            ID ยังเชื่อมเป็นแอดเดียวกันไม่ได้ อันดับเป็นเพียงการเปรียบเทียบต้นทุน ไม่ใช่คำสั่งปรับงบ
          </Note>
          {a.levels.map((l) => (
            <div key={l.scope_key} className="capture-analysis-level">
              <h3>
                {levelNames[l.level]} · ยืนยัน ID ได้ {l.verified_unique_rows}
                {l.reported_total_rows !== null
                  ? ` จาก ${l.reported_total_rows}`
                  : ""}{" "}
                แถว{" "}
                <Pill kind={l.coverage === "complete" ? "success" : "warning"}>
                  {l.coverage === "complete"
                    ? "จำนวน ID ตรงกับยอดรวมที่มองเห็น"
                    : l.coverage === "partial"
                      ? "ยังไม่ครบ"
                      : "ยังยืนยันจำนวนแอดไม่ได้"}
                </Pill>
              </h3>
              <p className="small muted">
                หลักฐานดิบ {l.observed_rows} แถวจาก {l.snapshots} ภาพ ·
                ยังเชื่อมตัวตนไม่ได้ {l.unresolved_observations} รายการ ·{" "}
                {spendNames[l.spend_quality]}
              </p>
              <p className="small muted">
                {l.context.date_range_label ?? "ไม่ทราบช่วงวันที่"} · สกุลเงิน{" "}
                {l.context.currency ?? "ไม่ยืนยัน"} · เขตเวลา{" "}
                {l.context.timezone ?? "ไม่ยืนยัน"} · Attribution{" "}
                {l.context.attribution ?? "ไม่ยืนยัน"} ·{" "}
                {l.context.column_preset_label ?? ""}
              </p>
              <p className="small muted">
                Breakdown:{" "}
                {l.context.breakdown == null
                  ? "ยังไม่ยืนยัน"
                  : JSON.stringify(l.context.breakdown)}{" "}
                · ตัวกรอง:{" "}
                {l.context.filters == null
                  ? "ยังไม่ยืนยัน"
                  : JSON.stringify(l.context.filters)}
              </p>
              {l.blockers.length ? (
                <Note>
                  ยังใช้ตัดสินใจไม่ได้: {l.blockers.map(blockerText).join(" · ")}
                </Note>
              ) : null}
              {l.result_groups.map((g) => (
                <p key={g.result_type} className="small">
                  <strong>{g.result_type}</strong>: {num(g.results)} ผลลัพธ์จาก{" "}
                  {g.rows} แถว · ยอดใช้จ่าย {money(g.spend, l.context.currency)}
                  {g.spend_basis === "estimate"
                    ? " (ประมาณ)"
                    : g.spend_basis === "mixed"
                      ? " (บางส่วนประมาณ)"
                      : ""}{" "}
                  · ต้นทุนเฉลี่ยถ่วงน้ำหนัก{" "}
                  {money(g.cost_per_result, l.context.currency)}
                </p>
              ))}
              {l.recommendations.length ? (
                <ul className="capture-recommendations">
                  {l.recommendations.map((r) => (
                    <li key={r.code}>
                      <Pill kind={severityKind[r.severity]}>
                        {severityNames[r.severity]}
                      </Pill>{" "}
                      {r.message}
                      {r.rows.length ? (
                        <small> — {r.rows.join(", ")}</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ชื่อ</th>
                      <th>สถานะ</th>
                      <th>ผลลัพธ์</th>
                      <th>ต้นทุน/ผลลัพธ์</th>
                      <th>อิมเพรสชัน</th>
                      <th>ยอดใช้จ่าย</th>
                      <th>CPM</th>
                      <th>งบประมาณ</th>
                      <th>หลักฐาน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.rows.length ? (
                      [...l.rows]
                        .sort(
                          (x, y) =>
                            (x.cost_per_result ?? Infinity) -
                            (y.cost_per_result ?? Infinity),
                        )
                        .map((r) => (
                          <tr key={r.key}>
                            <td>
                              <strong>{r.name ?? "—"}</strong>
                              <small>{r.entity_id ?? "ไม่มี ID"}</small>
                            </td>
                            <td>
                              <Pill kind={deliveryKind(r.delivery)}>
                                {deliveryNames[r.delivery]}
                              </Pill>
                            </td>
                            <td>{num(r.results)}</td>
                            <td>
                              {money(r.cost_per_result, l.context.currency)}
                            </td>
                            <td>{num(r.impressions)}</td>
                            <td>
                              {money(r.spend, l.context.currency)}
                              {r.spend_source ===
                              "estimate_results_x_cost_per_result" ? (
                                <small>ประมาณ</small>
                              ) : null}
                            </td>
                            <td>{money(r.cpm, l.context.currency)}</td>
                            <td className="small">{r.budget.text ?? "—"}</td>
                            <td className="small">
                              {r.mapping === "verified"
                                ? "ยืนยันคอลัมน์"
                                : r.mapping === "aligned_geometry"
                                  ? "ตำแหน่งตรงหัวตาราง"
                                  : "ไม่ยืนยัน"}
                              {r.unpublished_edits ? " · มีแก้ไขยังไม่เผยแพร่" : ""}
                              {r.flags.length ? (
                                <small>
                                  {r.flags.map(blockerText).join(" · ")}
                                </small>
                              ) : null}
                            </td>
                          </tr>
                        ))
                    ) : (
                      <EmptyRow cols={9}>ไม่มีแถวในระดับนี้</EmptyRow>
                    )}
                  </tbody>
                </table>
              </div>
              {!l.ranking.eligible ? (
                <p className="small muted">
                  ยังไม่มีอันดับที่ผ่านเกณฑ์ ต้องยืนยัน ID บริบทรายงาน คอลัมน์ และจำนวนผลลัพธ์ก่อน
                </p>
              ) : null}
              <RankLine
                title="ต้นทุนต่อผลลัพธ์ต่ำสุด"
                rows={l.ranking.best}
                currency={l.context.currency}
              />
              <RankLine
                title="ต้นทุนต่อผลลัพธ์สูงสุด"
                rows={l.ranking.worst}
                currency={l.context.currency}
              />
              {l.warnings.map((w) => (
                <Note key={w}>{w}</Note>
              ))}
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

const blockerNames: Record<string, string> = {
  stable_id_unverified: "ยังไม่มี ID ที่ยืนยันได้",
  unresolved_identity: "มีหลักฐานที่ยังเชื่อมตัวตนไม่ได้",
  date_range_unverified: "ยังไม่ยืนยันช่วงวันที่",
  currency_unverified: "ยังไม่ยืนยันสกุลเงิน",
  timezone_unverified: "ยังไม่ยืนยันเขตเวลา",
  attribution_unverified: "ยังไม่ยืนยัน Attribution",
  column_mapping_unverified: "ยังไม่ยืนยันคอลัมน์",
  mixed_context: "พบเงื่อนไขรายงานต่างกัน",
  duplicate_id_in_snapshot: "พบ ID ซ้ำในภาพเดียวกัน",
  breakdown_unverified: "ยังไม่ยืนยันการแจกแจงข้อมูล ใช้ CSV ที่ระบุเงื่อนไขครบเพื่อตรวจเทียบ",
  filters_unverified: "ยังไม่ยืนยันตัวกรองบนหน้ารายงาน",
  mixed_reporting_context: "พบเงื่อนไขรายงานต่างกัน",
  conflicting_row_evidence: "ข้อมูลของ ID เดียวกันขัดแย้ง",
  reported_count_conflict: "จำนวนรวมจากต้นทางต่างกันระหว่างภาพ",
  reported_count_mismatch: "จำนวน ID เกินยอดรวมที่ต้นทางแสดง",
  account_unverified: "ยังไม่ยืนยันบัญชี",
  identity_metric_vertical_mismatch: "แถวตัวตนกับตัวเลขเลื่อนแนวตั้งไม่ตรงกัน",
  row_alignment_unverified: "ยังยืนยันแนวแถวตัวตนกับตัวเลขไม่ได้",
};
const blockerText = (value: string) => blockerNames[value] ?? value;

function RankLine({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: RankedRow[];
  currency: string | null;
}) {
  if (!rows.length) return null;
  return (
    <p className="small">
      <strong>{title}:</strong>{" "}
      {rows
        .map(
          (r) =>
            `${r.name ?? "—"} (${money(r.cost_per_result, currency)}, ${num(r.results)} ผลลัพธ์)`,
        )
        .join(" · ")}
    </p>
  );
}
