"use client";
import { useEffect, useRef, useState } from "react";
import {
  importSchema,
  canonicalHeader,
  analysisColumns,
} from "../../../packages/core/src/index";
import type {
  Api,
  ImportInput,
  ImportRow,
  Notify,
  Quality,
  Run,
} from "../lib/types";
import { exportRecordsCsv } from "../lib/export";
import { download, number, time } from "../lib/utils";
import { Empty, EmptyRow, Icon, Panel, Pill } from "./ui";
export default function ImportView({
  account,
  api,
  run,
  busy,
  notify,
  imports,
  refresh,
  onSaved,
  showDetails,
}: {
  account: string;
  api: Api;
  run: Run;
  busy: boolean;
  notify: Notify;
  imports: ImportRow[];
  refresh: () => Promise<unknown>;
  onSaved: () => void;
  showDetails: (title: string, data: unknown) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const version = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Quality | null>(null);
  const [input, setInput] = useState<ImportInput | null>(null);
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<
    Record<string, (typeof analysisColumns)[number] | "__raw__">
  >({});
  useEffect(() => {
    let cancelled = false;
    setHeaders([]);
    setMapping({});
    if (file && file.size <= 10_000_000)
      void Promise.all([file.text(), import("papaparse")])
        .then(([csv, { default: Papa }]) => {
          if (!cancelled)
            setHeaders(
              (Papa.parse<string[]>(csv, { preview: 1 }).data[0] ?? []).slice(
                0,
                200,
              ),
            );
        })
        .catch(() => {
          if (!cancelled) setHeaders([]);
        });
    return () => {
      cancelled = true;
    };
  }, [file]);
  function invalidate() {
    version.current++;
    setReport(null);
    setInput(null);
  }
  async function validate() {
    if (!/^\d+$/.test(account)) throw new Error("เลือกบัญชีโฆษณาด้านบนก่อน");
    if (!file) throw new Error("เลือก CSV ก่อน");
    if (file.size > 10_000_000) throw new Error("ไฟล์ใหญ่เกิน 10 MB");
    const generation = version.current;
    const fields = new FormData(form.current!);
    const rows = String(fields.get("rows") ?? "").trim(),
      spend = String(fields.get("spend") ?? "").trim();
    const payload = importSchema.parse({
      filename: file.name,
      csv: await file.text(),
      expected_account_id: account,
      column_mapping: mapping,
      number_format: fields.get("numberFormat") ?? "plain",
      context: {
        timezone: fields.get("timezone"),
        attribution: fields.get("attribution"),
        result_type: fields.get("resultType"),
      },
      expected: {
        ...(rows ? { rows: Number(rows) } : {}),
        ...(spend ? { spend: Number(spend) } : {}),
      },
    });
    const r = await api<Quality>("/imports/validate", payload);
    if (generation !== version.current) return;
    setReport(r);
    setInput(r.valid ? payload : null);
    notify(
      r.valid
        ? "ตรวจไฟล์แล้ว ตรวจเงื่อนไขและข้อจำกัดก่อนบันทึก"
        : "พบข้อผิดพลาดในไฟล์ กรุณาแก้ตามรายการ",
      !r.valid,
    );
  }
  const knownWarning = (v: string) =>
    (
      ({
        "Coverage of the entire account is unverified; only this file is validated.":
          "ตรวจเฉพาะไฟล์นี้ ยังไม่ยืนยันว่าครบทั้งบัญชี",
        "Reach is non-additive. Results are comparable only with matching result type and attribution.":
          "ห้ามรวม Reach โดยตรง และต้องใช้ Results ที่ชนิดผลลัพธ์กับ Attribution ตรงกัน",
        "Source reconciliation is incomplete: supply expected row count and spend.":
          "ยังตรวจเทียบต้นทางไม่ครบ แนะนำระบุจำนวนแถวและ Spend รวม",
        "Period aggregates detected; these are not daily insights.":
          "พบยอดรวมช่วงเวลา ข้อมูลเหล่านี้ไม่ใช่สถิติรายวัน",
        "Results missing in some rows; missing values remain null, not zero.":
          "บางแถวไม่มี Results ระบบจะเก็บเป็นไม่มีข้อมูล ไม่เติมเลขศูนย์",
        "Creative details missing for some ads.":
          "บางโฆษณาไม่มีรายละเอียด Creative",
      }) as Record<string, string>
    )[v] ?? v;
  return (
    <>
      <div className="import-grid">
        <Panel
          title="ไฟล์รายงาน"
          action={
            <a className="text-link" href="/sample-report.csv" download>
              ดาวน์โหลด CSV ตัวอย่าง
            </a>
          }
        >
          <form
            ref={form}
            className="panel-form"
            onChange={invalidate}
            onSubmit={(e) => {
              e.preventDefault();
              void run("validate", validate);
            }}
          >
            <label
              className={`file-drop${dragging ? " dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                invalidate();
                setFile(e.dataTransfer.files[0] ?? null);
              }}
              htmlFor="csvFile"
            >
              <span>
                <Icon name="upload" />
              </span>
              <strong>{file ? file.name : "เลือกไฟล์ CSV หรือลากมาวาง"}</strong>
              <span>
                {file
                  ? `${number(file.size / 1000)} KB`
                  : "รายงานจาก Meta ภาษาไทยหรืออังกฤษ · สูงสุด 10 MB"}
              </span>
              <input
                id="csvFile"
                type="file"
                accept=".csv,text/csv"
                required={!file}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {headers.length ? (
              <details className="reconciliation">
                <summary>จับคู่คอลัมน์จากไฟล์ ({headers.length} คอลัมน์)</summary>
                <p className="hint">
                  ชื่อไทยและอังกฤษที่รู้จักจับคู่อัตโนมัติ เปลี่ยนได้ตามหัวคอลัมน์จริง ห้ามจับคู่ CTR
                  (ทั้งหมด) เป็น Link CTR
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>คอลัมน์ต้นทาง</th>
                        <th>ฟิลด์ที่จัดเก็บ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headers.map((h, i) => (
                        <tr key={i}>
                          <td>{h}</td>
                          <td>
                            <select
                              aria-label={`จับคู่ ${h}`}
                              value={
                                mapping[h] ??
                                (analysisColumns.includes(
                                  canonicalHeader(
                                    h,
                                  ) as (typeof analysisColumns)[number],
                                )
                                  ? canonicalHeader(h)
                                  : "__raw__")
                              }
                              onChange={(e) => {
                                invalidate();
                                setMapping((m) => {
                                  const next = { ...m };
                                  if (e.target.value)
                                    next[h] = e.target.value as
                                      | (typeof analysisColumns)[number]
                                      | "__raw__";
                                  else delete next[h];
                                  return next;
                                });
                              }}
                            >
                              <option value="__raw__">เก็บในข้อมูลต้นฉบับ</option>
                              {analysisColumns.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
            <div className="form-grid">
              <label>
                Timezone
                <input name="timezone" defaultValue="Asia/Bangkok" required />
              </label>
              <label>
                Attribution
                <input
                  name="attribution"
                  placeholder="เช่น 7-day click"
                  required
                />
              </label>
              <label className="span-two">
                ชนิดผลลัพธ์
                <input
                  name="resultType"
                  placeholder="เช่น leads หรือ messaging_conversation"
                  required
                />
              </label>
            </div>
            <label>
              รูปแบบตัวเลขในไฟล์
              <select name="numberFormat" defaultValue="plain">
                <option value="plain">1234.56 (ไม่มี comma คั่นหลักพัน)</option>
                <option value="grouped_dot">
                  1,234.56 (comma คั่นหลักพัน จุดทศนิยม)
                </option>
              </select>
            </label>
            <details className="reconciliation" open>
              <summary>ตรวจเทียบกับรายงานต้นทาง (แนะนำ)</summary>
              <div className="form-grid">
                <label>
                  จำนวนแถว
                  <input
                    name="rows"
                    type="number"
                    min="1"
                    placeholder="ไม่รวมแถวสรุป"
                  />
                </label>
                <label>
                  Spend รวม
                  <input
                    name="spend"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="เงื่อนไขเดียวกับ CSV"
                  />
                </label>
              </div>
            </details>
            <div className="button-group">
              <button type="submit" className="primary" disabled={busy}>
                ตรวจสอบข้อมูล
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !report?.valid || !input}
                onClick={() =>
                  void run("save", async () => {
                    if (!input) return;
                    const r = await api<{ job_id: string; duplicate: boolean }>(
                      "/imports",
                      input,
                    );
                    notify(
                      r.duplicate
                        ? "ไฟล์นี้บันทึกไว้แล้ว ไม่เพิ่มข้อมูลซ้ำ"
                        : "บันทึกข้อมูลลงฐานข้อมูลแล้ว",
                    );
                    onSaved();
                  })
                }
              >
                บันทึกลงฐานข้อมูล
              </button>
            </div>
          </form>
        </Panel>
        <Panel
          title="ผลการตรวจสอบ"
          action={
            <button
              className="icon-button"
              disabled={!report}
              aria-label="ดาวน์โหลดผลตรวจ"
              title="ดาวน์โหลดผลตรวจ"
              onClick={() =>
                download(JSON.stringify(report, null, 2), "quality-report.json")
              }
            >
              <Icon name="download" />
            </button>
          }
        >
          <div className="quality-report" aria-live="polite">
            {report ? (
              <>
                <div
                  className={`quality-result${report.valid ? "" : " invalid"}`}
                >
                  <h3>
                    {report.valid ? "ผ่านการตรวจรูปแบบข้อมูล" : "พบข้อผิดพลาดในไฟล์"}
                  </h3>
                  <p>
                    {report.valid
                      ? "ตรวจรายการด้านล่างก่อนบันทึก"
                      : "แก้ข้อมูลตามรายการ แล้วตรวจสอบใหม่อีกครั้ง"}
                  </p>
                </div>
                <div className="quality-stats">
                  <div>
                    แถวที่อ่านได้<strong>{number(report.summary.rows)}</strong>
                  </div>
                  <div>
                    Spend ในไฟล์<strong>{number(report.summary.spend)}</strong>
                  </div>
                </div>
                {report.errors.length ? (
                  <>
                    <h3>สิ่งที่ต้องแก้ไข ({report.errors.length})</h3>
                    <ul className="issue-list errors">
                      {report.errors.slice(0, 50).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                    {report.errors.length > 50 ? (
                      <p className="hint">ดาวน์โหลดผลตรวจเพื่อดูข้อผิดพลาดทั้งหมด</p>
                    ) : null}
                  </>
                ) : null}
                <h3>ข้อจำกัดที่ต้องทราบ</h3>
                <ul className="issue-list">
                  {report.warnings.map((w, i) => (
                    <li key={i}>{knownWarning(w)}</li>
                  ))}
                </ul>
                {report.valid ? (
                  <div className="button-group">
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          JSON.stringify(
                            { coverage: "unverified", records: report.records },
                            null,
                            2,
                          ),
                          "validated-records.json",
                        )
                      }
                    >
                      ส่งออกข้อมูล JSON
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run("validatedCsv", () =>
                          exportRecordsCsv(report.records),
                        )
                      }
                    >
                      ส่งออกข้อมูล CSV
                    </button>
                  </div>
                ) : null}
                <details>
                  <summary>ตัวอย่างข้อมูลที่ตรวจแล้ว 3 แถว</summary>
                  <pre>
                    {JSON.stringify(report.records.slice(0, 3), null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <Empty icon="check" title="ยังไม่มีข้อมูลที่ตรวจสอบ">
                เลือกบัญชีและไฟล์ กรอกเงื่อนไขรายงาน
                <br />
                แล้วกดตรวจสอบข้อมูล
              </Empty>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        className="below-panel"
        title="ประวัติการนำเข้าของบัญชีนี้"
        action={
          <button
            className="text-button"
            onClick={() =>
              void run("imports", async () => {
                await refresh();
              })
            }
          >
            รีเฟรช
          </button>
        }
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ไฟล์รายงาน</th>
                <th>วันเวลานำเข้า</th>
                <th>แถว</th>
                <th>ความครบถ้วน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imports.length ? (
                imports.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.filename}</strong>
                      <small>{row.id.slice(0, 8)}</small>
                    </td>
                    <td>{time(row.created_at)}</td>
                    <td>{number(row.row_count)}</td>
                    <td>
                      <Pill kind="warning">ยังไม่ยืนยันทั้งบัญชี</Pill>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          showDetails(`ผลตรวจ ${row.filename}`, row.report)
                        }
                      >
                        ดูรายละเอียด
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow cols={5}>
                  {account
                    ? "ยังไม่มีประวัติการนำเข้าของบัญชีนี้"
                    : "เลือกบัญชีโฆษณาเพื่อดูประวัติ"}
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
