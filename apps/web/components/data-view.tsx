"use client";
import { useDeferredValue, useMemo, useState } from "react";
import useSWR from "swr";
import type { AdRecord, Api, Run } from "../lib/types";
import { exportRecordsCsv } from "../lib/export";
import { download, number } from "../lib/utils";
import { EmptyRow, Icon, Panel } from "./ui";
const PAGE_SIZE = 25;
export default function DataView({
  account,
  api,
  run,
  busy,
  showDetails,
}: {
  account: string;
  api: Api;
  run: Run;
  busy: boolean;
  showDetails: (title: string, data: unknown) => void;
}) {
  const { data, error, isLoading, mutate } = useSWR<{
    coverage: string;
    records: AdRecord[];
  }>(account ? `/export?account_id=${account}` : null, api, {
    revalidateOnFocus: false,
  });
  const [query, setQuery] = useState(""),
    [level, setLevel] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  const search = useDeferredValue(query.toLowerCase());
  const records = useMemo(
    () =>
      data?.records.filter(
        (r) =>
          (!level || r.level === level) &&
          (!from || r.date_start >= from) &&
          (!to || r.date_end <= to) &&
          (!search ||
            [
              r.campaign_id,
              r.campaign_name,
              r.ad_set_id,
              r.ad_set_name,
              r.ad_id,
              r.ad_name,
            ].some((v) => v?.toLowerCase().includes(search))),
      ) ?? [],
    [data, level, from, to, search],
  );
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)),
    current = Math.min(page, pages);
  const visible = records.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return (
    <Panel
      title="ข้อมูลที่บันทึกไว้"
      subtitle="แสดง observation ล่าสุดของแต่ละเงื่อนไข สูงสุด 10,000 รายการ"
      action={
        <button
          className="secondary"
          disabled={!account || busy}
          onClick={() =>
            void run("data", async () => {
              await mutate();
            })
          }
        >
          <Icon name="refresh" />
          โหลดข้อมูล
        </button>
      }
    >
      <div className="data-filters">
        <label className="search-field">
          <span>
            <Icon name="search" />
          </span>
          <input
            aria-label="ค้นหาข้อมูล"
            placeholder="ค้นหาชื่อ หรือ ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          value={level}
          aria-label="กรองระดับ"
          onChange={(e) => {
            setLevel(e.target.value);
            setPage(1);
          }}
        >
          <option value="">ทุกระดับ</option>
          <option value="campaign">Campaign</option>
          <option value="adset">Ad Set</option>
          <option value="ad">Ad</option>
        </select>
        <label className="date-filter">
          ตั้งแต่
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="date-filter">
          ถึง
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <div className="inline-note data-note">
        <Icon name="info" />
        Spend ในแต่ละแถวอาจเป็นคนละช่วงเวลา Attribution และ Breakdown
        จึงไม่รวมยอดข้ามเงื่อนไข
      </div>
      {error ? (
        <p className="notice-error" role="alert">
          {String(error.message)}
        </p>
      ) : null}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>รายการโฆษณา</th>
              <th>ระดับ</th>
              <th>ช่วงรายงาน</th>
              <th>Spend</th>
              <th>Impressions</th>
              <th>Results</th>
              <th>เงื่อนไขการวัดผล</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((r, i) => (
                <tr key={`${r.ad_id ?? r.ad_set_id ?? r.campaign_id}-${i}`}>
                  <td>
                    <strong>
                      {r.ad_name ?? r.ad_set_name ?? r.campaign_name}
                    </strong>
                    <small>{r.ad_id ?? r.ad_set_id ?? r.campaign_id}</small>
                  </td>
                  <td>
                    {
                      { ad: "Ad", adset: "Ad Set", campaign: "Campaign" }[
                        r.level
                      ]
                    }
                  </td>
                  <td>
                    {r.date_start}
                    <small>
                      {r.date_start === r.date_end
                        ? "รายวัน"
                        : `ถึง ${r.date_end}`}
                    </small>
                  </td>
                  <td>
                    {number(r.spend)} <small>{r.currency}</small>
                  </td>
                  <td>{number(r.impressions)}</td>
                  <td>
                    {number(r.results)}
                    <small>{r.result_type}</small>
                  </td>
                  <td>
                    {r.attribution}
                    <small>
                      {r.timezone}
                      {r.breakdown
                        ? ` • ${Object.entries(r.breakdown)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(", ")}`
                        : ""}
                    </small>
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => showDetails("รายละเอียดข้อมูลโฆษณา", r)}
                    >
                      รายละเอียด
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow cols={8}>
                {isLoading
                  ? "กำลังโหลดข้อมูล…"
                  : !account
                    ? "เลือกบัญชีโฆษณาก่อน"
                    : "ไม่พบข้อมูลตามเงื่อนไขนี้"}
              </EmptyRow>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span className="muted">
          {data
            ? `${number(records.length)} รายการจากทั้งหมด ${number(data.records.length)} รายการที่โหลด`
            : "ยังไม่มีข้อมูลที่โหลด"}
        </span>
        <div className="button-group">
          <button
            className="secondary"
            disabled={!records.length}
            onClick={() =>
              download(
                JSON.stringify(
                  {
                    coverage: "unverified",
                    filters: { level, from, to, query },
                    records,
                  },
                  null,
                  2,
                ),
                "meta-observations.json",
              )
            }
          >
            <Icon name="download" />
            ส่งออก JSON
          </button>
          <button
            className="secondary"
            disabled={!records.length || busy}
            onClick={() => void run("csv", () => exportRecordsCsv(records))}
          >
            ส่งออก CSV
          </button>
        </div>
      </div>
      {pages > 1 ? (
        <div className="pagination">
          <button
            disabled={current === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ก่อนหน้า
          </button>
          <span>
            หน้า {current} / {pages}
          </span>
          <button
            disabled={current === pages}
            onClick={() => setPage((p) => p + 1)}
          >
            ถัดไป
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
