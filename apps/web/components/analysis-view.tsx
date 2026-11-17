"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  buildAnalysis,
  goalLabels,
  requiredColumns,
  type AnalysisGoal,
  type AnalysisSource,
} from "../../../packages/core/src/analysis";
import { buildCaptureReview } from "../../../packages/core/src/capture-review";
import { csvSafe } from "../../../packages/core/src/index";
import type { AdRecord, Api, DeviceState, Run } from "../lib/types";
import { download, number } from "../lib/utils";
import { Panel, Pill, EmptyRow } from "./ui";
const labels: Record<string, string> = {
  spend: "ใช้จ่ายจริง",
  impressions: "อิมเพรสชัน",
  link_clicks: "คลิกลิงก์",
  messaging_conversations: "เริ่มสนทนา",
  purchases: "การซื้อ",
  leads: "ลูกค้าเป้าหมาย",
  purchase_value: "มูลค่าการซื้อ",
  ad_id: "Ad ID / ระดับโฆษณา",
  attribution: "Attribution",
  result_type: "ประเภทผลลัพธ์",
  duplicate_grain: "ข้อมูลซ้ำ",
  timezone: "เขตเวลา",
  currency: "สกุลเงิน",
  dom_scope_unverified:
    "หลักฐานบริบทของข้อมูล DOM ยังไม่ครบ ต้องอ่านใหม่หรือนำเข้า CSV ที่ตรวจแล้ว",
  group_quality_blocked: "ชุดรายงานมีข้อมูลซ้ำหรือบริบทไม่ยืนยัน",
  overlapping_interval: "ช่วงวันที่ทับซ้อน",
  nonpositive_spend: "ยอดใช้จ่ายต้องมากกว่า 0 เพื่อเทียบต้นทุน",
  nonpositive_impressions: "ยังไม่มีอิมเพรสชันสำหรับเทียบ",
  link_ctr: "Link CTR",
  link_cpc: "Link CPC",
  cpm: "CPM",
  cost_per_conversion: "ต้นทุนต่อคอนเวอร์ชั่น",
  purchase_roas: "ROAS",
};
const evaluationLabels = {
  blocked: "ยังประเมินไม่ได้",
  insufficient_sample: "ผลลัพธ์ยังน้อย",
  insufficient_peers: "แอดสำหรับเทียบยังน้อย",
  lower_cost: "ต้นทุนต่ำกว่าค่ากลาง",
  typical_cost: "ต้นทุนใกล้ค่ากลาง",
  higher_cost: "ต้นทุนสูงกว่าค่ากลาง",
} as const;
const sourceLabels: Record<AnalysisSource, string> = {
  csv: "CSV",
  dom_capture: "DOM (lower bound)",
  unknown: "ไม่ทราบแหล่ง",
};
const importScopeLabels = {
  verified_for_import: "กระทบยอดไฟล์แล้ว",
  unverified: "ยังไม่กระทบยอด",
  not_applicable: "",
} as const;
const metricLabel = (k: string) => labels[k] ?? k;
function fmt(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : number(n);
}
export default function AnalysisView({
  account,
  api,
  run,
  busy,
  deviceState,
  send,
  fresh,
  onImport,
}: {
  account: string;
  api: Api;
  run: Run;
  busy: boolean;
  deviceState?: DeviceState;
  send: (c: unknown) => Promise<string>;
  fresh: boolean;
  onImport: () => void;
}) {
  const version = deviceState?.state.extension_version;
  const [major, minor] = (version ?? "0.0.0").split(".").map(Number);
  const supportsAnalysis = major > 0 || (major === 0 && minor >= 4);
  const supportsReportInput = major > 0 || (major === 0 && minor >= 5);
  const [goal, setGoal] = useState<AnalysisGoal>("messages");
  const [groupKey, setGroupKey] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<{ records: AdRecord[] }>(
    account ? `/export?account_id=${account}` : null,
    api,
    { revalidateOnFocus: false },
  );
  const report = useMemo(
    () =>
      buildAnalysis(
        (data?.records ?? []).filter((r) => r.level === "ad"),
        goal,
      ),
    [data, goal],
  );
  const group =
    report.groups.find((g) => g.key === groupKey) ?? report.groups[0];
  const rows = group
    ? report.rows.filter(
        (r) =>
          JSON.stringify([
            r.account_id,
            r.level,
            r.date_start,
            r.date_end,
            r.currency,
            r.timezone,
            r.attribution,
            r.result_type,
            r.objective,
            r.source,
            Object.entries(r.breakdown).sort(),
          ]) === group.key,
      )
    : [];
  const capture = useMemo(
    () =>
      buildCaptureReview(
        deviceState?.state.job?.snapshots ?? [],
        account,
        goal,
      ),
    [deviceState, account, goal],
  );
  const latest = capture.captures.at(-1);
  const totalPages = Math.max(1, Math.ceil(rows.length / 25)),
    current = Math.min(page, totalPages);
  async function exportCsv() {
    const { default: Papa } = await import("papaparse");
    const output = rows.map((r) =>
      Object.fromEntries(
        Object.entries({
          account_id: r.account_id,
          campaign_id: r.campaign_id,
          ad_set_id: r.ad_set_id,
          ad_id: r.ad_id,
          ad_name: r.ad_name,
          date_start: r.date_start,
          date_end: r.date_end,
          currency: r.currency,
          timezone: r.timezone,
          attribution: r.attribution,
          result_type: r.result_type,
          objective: r.objective,
          ...r.reported,
          ...Object.fromEntries(
            Object.entries(r.derived).map(([k, v]) => [`calculated_${k}`, v]),
          ),
          readiness: r.readiness,
          missing: r.missing.join("|"),
          evaluation_status: r.evaluation.status,
          evaluation_blockers: r.evaluation.blockers.join("|"),
          evaluation_reasons: r.evaluation.reasons.join(" | "),
          evaluation_next_steps: r.evaluation.next_steps.join(" | "),
          comparable_ads: r.evaluation.comparison?.peer_count,
          median_cost_per_conversion:
            r.evaluation.comparison?.median_cost_per_conversion,
          relative_cost: r.evaluation.comparison?.relative_cost,
        }).map(([k, v]) => [k, csvSafe(v)]),
      ),
    );
    download(
      "\uFEFF" + Papa.unparse(output),
      "meta-analysis.csv",
      "text/csv;charset=utf-8",
    );
  }
  return (
    <>
      <Panel
        title="เตรียมข้อมูลวิเคราะห์"
        subtitle="เลือกเป้าหมาย แล้วตรวจต้นทุน ผลลัพธ์ และสิ่งที่ยังขาด"
      >
        <div className="panel-form">
          <div className="form-grid">
            <div>
              <label htmlFor="analysisGoal">เป้าหมายหลัก</label>
              <select
                id="analysisGoal"
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value as AnalysisGoal);
                  setPage(1);
                }}
              >
                {Object.entries(goalLabels).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="analysisGroup">ชุดรายงานที่เทียบกันได้</label>
              <select
                id="analysisGroup"
                value={group?.key ?? ""}
                onChange={(e) => {
                  setGroupKey(e.target.value);
                  setPage(1);
                }}
              >
                {!report.groups.length ? (
                  <option value="">ยังไม่มีรายงานระดับโฆษณา</option>
                ) : (
                  report.groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.date_start} ถึง {g.date_end} · {g.currency} ·{" "}
                      {g.attribution} · {g.result_type} ·{" "}
                      {g.objective ?? "ไม่ระบุวัตถุประสงค์"} ·{" "}
                      {sourceLabels[g.source]} ·{" "}
                      {JSON.stringify(g.breakdown)}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <p>
            คอลัมน์หลัก: {requiredColumns[goal].map(metricLabel).join(" · ")} พร้อม
            Account / Campaign / Ad Set / Ad ID วันที่ สกุลเงิน เขตเวลา และ
            Attribution
          </p>
          <p className="hint">
            แหล่งยอดหลัก: CSV ที่กระทบยอดแล้ว · พบ CSV{" "}
            {report.source_mix.csv} แถว (กระทบยอดแล้ว{" "}
            {report.verified_import_rows} แถว), DOM{" "}
            {report.source_mix.dom_capture} แถว (หลักฐานเสริม lower bound),
            ไม่ทราบแหล่ง {report.source_mix.unknown} แถว. ระบบแยกชุดตามแหล่งและ
            ไม่บวกยอดข้าม CSV/DOM
          </p>
          <div className="button-group">
            <button
              className="secondary"
              disabled={
                !supportsReportInput ||
                !deviceState?.state.report_input ||
                busy ||
                !fresh ||
                !supportsAnalysis ||
                deviceState?.state.job?.status === "running"
              }
              onClick={() =>
                void run("prepareReport", async () => {
                  await send({ command: "report.prepare", goal });
                })
              }
            >
              ตั้งคอลัมน์วิเคราะห์ใน Meta
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !fresh ||
                !supportsAnalysis ||
                deviceState?.state.job?.status === "running"
              }
              onClick={() =>
                void run("analysisCollect", async () => {
                  await send({
                    command: "start",
                    levels: ["ads"],
                    maxSteps: 12,
                    scan_columns: true,
                  });
                })
              }
            >
              อ่านค่าตาราง Ads
            </button>
            <button className="secondary" onClick={onImport}>
              นำเข้า CSV จาก Meta
            </button>
            <button
              className="secondary"
              disabled={busy || !account}
              onClick={() =>
                void run("analysisRefresh", async () => {
                  await mutate();
                })
              }
            >
              โหลดข้อมูลที่บันทึก
            </button>
            <a className="text-link" href="/analysis-template.csv" download>
              CSV ตัวอย่างคอลัมน์วิเคราะห์
            </a>
          </div>
          {!supportsAnalysis ? (
            <p className="notice-error" role="status">
              ตัวอ่านที่เชื่อมต่อ: {version ?? "ยังไม่รายงานรุ่น"} กรุณา Reload Extension
              เป็น 0.4.0 แล้วเชื่อมต่อใหม่เพื่อเปิดใช้การอ่านค่าวิเคราะห์
            </p>
          ) : (
            <p className="hint">Extension {version} พร้อมอ่านข้อมูลวิเคราะห์</p>
          )}
          {!supportsReportInput || !deviceState?.state.report_input ? (
            <p className="hint">
              ตั้งคอลัมน์อัตโนมัติใช้ Extension 0.5.0 ขึ้นไป
              และต้องกดเปิดเมาส์/คีย์บอร์ดรายงานใน popup ก่อน
            </p>
          ) : null}
          <p className="hint">
            กดตั้งคอลัมน์ก่อน แล้วอ่านตาราง ระบบเพิ่มเฉพาะคอลัมน์ที่พบชื่อแน่นอนในหน้าต่าง Meta
            และรายงานรายการที่หาไม่พบ การตั้งคอลัมน์ไม่เปลี่ยนงบหรือสถานะโฆษณา
          </p>
          <details className="reconciliation">
            <summary>คอลัมน์ที่ต้องเลือกใน Meta และวิธีเก็บให้ครบ</summary>
            <ol>
              <li>เปิดระดับ Ads เลือกช่วงวันที่ที่ต้องการ และตรวจ Attribution</li>
              <li>
                ในคอลัมน์ / Customize columns เพิ่ม IDs ทั้งสามระดับ, Amount spent,
                Impressions, Reach, Frequency, Link clicks, Link CTR, Link CPC,
                CPM, Results และ Cost per result
              </li>
              <li>
                เพิ่ม Messaging conversations started สำหรับข้อความ; Purchases และ
                Purchase conversion value สำหรับยอดขาย; Leads สำหรับลูกค้าเป้าหมาย
              </li>
              <li>
                เพิ่ม Landing page views, Adds to cart, Checkouts initiated,
                Budget และ Attribution setting หากมี
              </li>
              <li>
                ส่งออก CSV แล้วนำเข้าเพื่อตรวจ IDs จำนวนแถว และยอดใช้จ่ายรวม ใช้ Daily
                breakdown หากต้องการแนวโน้มรายวัน
              </li>
            </ol>
            <p>
              ระบบเก็บ Link CTR แยกจาก CTR (ทั้งหมด) และแยก Website purchases จาก
              Purchases ไม่รวมยอดสองชนิดเข้าด้วยกัน
            </p>
          </details>
        </div>
      </Panel>
      <Panel
        className="below-panel"
        title="ผลอ่านผ่าน Extension"
        subtitle="ตรวจหลักฐานจากหน้าจอก่อนนำไปวิเคราะห์"
      >
        <div className="panel-form">
          {deviceState?.state.ui?.report ? (
            <div role="status">
              <p>
                ตั้งคอลัมน์:{" "}
                {deviceState.state.ui.report.applied
                  ? "นำไปใช้แล้ว"
                  : "ต้องตรวจหน้าต่าง Meta"}{" "}
                · พบ {deviceState.state.ui.report.selected.length} คอลัมน์
              </p>
              <p>
                คอลัมน์หลักที่ยังหาไม่พบ:{" "}
                {deviceState.state.ui.report.missing_required
                  .map(metricLabel)
                  .join(", ") || "ไม่มี"}
              </p>
            </div>
          ) : null}
          <p>
            สถานะงาน: {deviceState?.state.job?.status ?? "ยังไม่มีงาน"}{" "}
            {deviceState?.state.job?.error ?? ""}
          </p>
          <p>
            พบ {capture.captures.length} ภาพข้อมูล ·{" "}
            {capture.captures.reduce((n, c) => n + c.rows.length, 0)}{" "}
            แถวที่มีหลักฐานตำแหน่ง (อาจซ้ำระหว่างการเลื่อน)
          </p>
          {latest ? (
            <p>
              ล่าสุด: {latest.page} · ตัวอ่าน {latest.reader_version ?? "รุ่นเก่า"} ·{" "}
              {latest.captured_at}
            </p>
          ) : (
            <p>รอผลจาก Extension 0.4.0 ขึ้นไป หรือใช้ CSV เพื่อจัดเก็บข้อมูลที่ยืนยันแล้ว</p>
          )}
          {capture.warnings.map((w) => (
            <p className="hint" key={w}>
              {w}
            </p>
          ))}
          <button
            className="secondary"
            disabled={!capture.captures.length}
            onClick={() =>
              download(
                JSON.stringify(capture, null, 2),
                "meta-dom-evidence.json",
              )
            }
          >
            ส่งออกหลักฐาน JSON
          </button>
        </div>
        {latest?.rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>แถวที่อ่านได้</th>
                  <th>ค่าที่พบ</th>
                  <th>ค่าหลักที่ขาด</th>
                  <th>หลักฐาน</th>
                </tr>
              </thead>
              <tbody>
                {latest.rows.slice(0, 25).map((r, i) => (
                  <tr key={i}>
                    <td>{r.name ?? r.identity ?? `แถว ${i + 1}`}</td>
                    <td>
                      {Object.entries(r.values).map(([k, v]) => (
                        <div key={k}>
                          {metricLabel(k)}: {fmt(v)}
                        </div>
                      ))}
                    </td>
                    <td>
                      {r.missing.map(metricLabel).join(", ") ||
                        "ครบคอลัมน์หลัก; ยังต้องยืนยันเงื่อนไข"}
                    </td>
                    <td>
                      {r.method}
                      <small>ยังไม่นำเข้า Insights</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
      <Panel
        className="below-panel"
        title="ข้อมูลระดับโฆษณาที่บันทึกแล้ว"
        subtitle="สรุปเฉพาะชุดรายงานที่เลือก แยกค่าจากต้นทางกับค่าคำนวณ"
      >
        <div className="panel-form">
          {error ? (
            <p role="alert" className="notice-error">
              {String(error.message)}
            </p>
          ) : null}
          {group ? (
            <>
              <div className="quality-stats">
                <div>
                  ใช้จ่ายจริง ({group.currency})
                  <strong>{fmt(group.totals.spend)}</strong>
                </div>
                <div>
                  {goalLabels[goal]}
                  <strong>{fmt(group.totals.conversions)}</strong>
                </div>
                <div>
                  ต้นทุนต่อคอนเวอร์ชั่น
                  <strong>{fmt(group.derived.cost_per_conversion)}</strong>
                </div>
                <div>
                  Link CTR (%)<strong>{fmt(group.derived.link_ctr)}</strong>
                </div>
                {goal === "sales" ? (
                  <div>
                    ROAS<strong>{fmt(group.derived.purchase_roas)}</strong>
                  </div>
                ) : null}
              </div>
              <p>
                {rows.filter((r) => !r.missing.length).length} / {rows.length}{" "}
                แถวมีค่าหลักครบสำหรับเป้าหมายนี้ · ความครบทั้งบัญชียังไม่ยืนยัน
              </p>
              <p className="hint">
                ประเมินต้นทุนเทียบแอดในชุดเดียวกันเมื่อมีอย่างน้อย{" "}
                {report.evaluation_policy.min_conversions} คอนเวอร์ชั่นต่อแอด และ{" "}
                {report.evaluation_policy.min_comparable_ads} แอดที่ผ่านเกณฑ์
                เป็นการคัดกรองเชิงพรรณนา ไม่ยืนยันนัยสำคัญทางสถิติหรือกำไร
                และไม่เปลี่ยนงบอัตโนมัติ
              </p>
            </>
          ) : (
            <p>
              {isLoading
                ? "กำลังโหลด…"
                : "ยังไม่มีข้อมูลระดับโฆษณาที่ผ่านการนำเข้า กดนำเข้า CSV เพื่อเริ่มต้น"}
            </p>
          )}
          {report.warnings.map((w) => (
            <p className="hint" key={w}>
              {w}
            </p>
          ))}
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>โฆษณา</th>
                <th>ใช้จ่ายจริง</th>
                <th>คอนเวอร์ชั่น</th>
                <th>CPA คำนวณ</th>
                <th>Link CTR คำนวณ</th>
                <th>ROAS คำนวณ</th>
                <th>ความพร้อม</th>
                <th>ผลประเมินและขั้นตอนถัดไป</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.slice((current - 1) * 25, current * 25).map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{r.ad_name ?? r.ad_id}</strong>
                      <small>
                        {r.ad_id} · {sourceLabels[r.source]}
                        {r.import_reconciliation === "not_applicable"
                          ? ""
                          : ` · ${importScopeLabels[r.import_reconciliation]}`}
                      </small>
                    </td>
                    <td>
                      {fmt(r.reported.spend)}
                      <small>{r.currency}</small>
                    </td>
                    <td>
                      {fmt(r.conversions)}
                      <small>{goalLabels[goal]}</small>
                    </td>
                    <td>{fmt(r.derived.cost_per_conversion)}</td>
                    <td>{fmt(r.derived.link_ctr)}%</td>
                    <td>{fmt(r.derived.purchase_roas)}</td>
                    <td>
                      <Pill kind={r.missing.length ? "warning" : "success"}>
                        {r.missing.length ? "ข้อมูลยังขาด" : "ค่าหลักครบ"}
                      </Pill>
                      <small>{r.missing.map(metricLabel).join(", ")}</small>
                    </td>
                    <td>
                      <Pill
                        kind={
                          r.evaluation.status === "blocked" ||
                          r.evaluation.status === "higher_cost"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {evaluationLabels[r.evaluation.status]}
                      </Pill>
                      <details>
                        <summary>เหตุผลและสิ่งที่ควรตรวจ</summary>
                        {r.evaluation.reasons.map((reason, i) => (
                          <p key={`reason-${i}`}>{reason}</p>
                        ))}
                        {r.evaluation.blockers.length ? (
                          <p>
                            ข้อมูลที่ต้องตรวจ:{" "}
                            {r.evaluation.blockers.map(metricLabel).join(", ")}
                          </p>
                        ) : null}
                        <ol>
                          {r.evaluation.next_steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </details>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow cols={8}>ยังไม่มีข้อมูลที่แสดงได้</EmptyRow>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>
            หน้า {current} / {totalPages}
          </span>
          <div className="button-group">
            <button
              className="secondary"
              disabled={current <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ก่อนหน้า
            </button>
            <button
              className="secondary"
              disabled={current >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป
            </button>
            <button
              className="secondary"
              disabled={!report.rows.length}
              onClick={() =>
                download(JSON.stringify(report, null, 2), "meta-analysis.json")
              }
            >
              ส่งออกชุดวิเคราะห์ JSON
            </button>
            <button
              className="secondary"
              disabled={!rows.length || busy}
              onClick={() => void run("analysisCsv", exportCsv)}
            >
              ส่งออกชุดที่เลือก CSV
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}
