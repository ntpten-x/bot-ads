"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type {
  CaptureJobAnalysis,
  Delivery,
  LevelAnalysis,
} from "../../../packages/core/src/capture-analysis";
import type { Api, DeviceState, Receipt, Run } from "../lib/types";
import type { ReportPreferences } from "../../../packages/core/src/report-preferences";
import type { DomCsvReconciliation } from "../../../packages/core/src/reconciliation";
import { download, number, time } from "../lib/utils";
import {
  buildComposition,
  buildConcentration,
  buildChartRows,
  buildDeliverySummary,
  buildHistogram,
  buildKpis,
  buildReportRows,
  buildScatter,
  buildScopeBars,
  buildTrendGroups,
  deliveryLabels,
  reportMetrics,
  reportViews,
  scopeLabel,
  uniqueValues,
  type CompositionBasis,
  type ReportMetric,
  type ReportSortOrder,
  type ReportView,
} from "../lib/report-studio";
import { Empty, EmptyRow, Icon, Note, Panel, Pill } from "./ui";
import {
  CompositionDonut,
  ConcentrationCurve,
  DistributionHistogram,
  KpiRibbon,
  MetricBars,
  metricText,
  ScatterPlot,
  TrendLineChart,
} from "./report-chart-suite";

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
  report_cached?: boolean;
  report_cached_at?: string;
};

const coverageLabels = {
  complete: "ยอดรวมใน scope ตรงกับจำนวนที่มองเห็น",
  partial: "ยืนยันได้บางส่วน",
  lower_bound: "ยืนยันได้เป็นขั้นต่ำ",
  unknown: "ยังยืนยันจำนวนรวมไม่ได้",
} as const;

const coverageKinds = {
  complete: "success",
  partial: "warning",
  lower_bound: "warning",
  unknown: "neutral",
} as const;

const jobLabels: Record<string, string> = {
  running: "กำลังอ่านข้อมูล",
  paused: "พักการอ่าน",
  needs_review: "ข้อมูลรอตรวจ",
  error: "อ่านไม่สำเร็จ",
};

function storedChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
) {
  const value = localStorage.getItem(key) as T | null;
  return value && choices.includes(value) ? value : fallback;
}

function money(value: number | null, currency: string | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: currency ?? "THB",
    maximumFractionDigits: 2,
  }).format(value);
}

function evidenceLabel(row: LevelAnalysis["rows"][number]) {
  if (row.entity_id && row.mapping === "verified") return "ID + คอลัมน์ยืนยัน";
  if (row.entity_id) return "มี ID · คอลัมน์รอตรวจ";
  return "observation ที่ยังไม่มี ID";
}

function breakdownText(level: LevelAnalysis | undefined) {
  if (!level || level.context.breakdown === null) return "ยังไม่ยืนยัน";
  const entries =
    level.context.breakdown &&
    typeof level.context.breakdown === "object" &&
    !Array.isArray(level.context.breakdown)
      ? Object.entries(level.context.breakdown)
      : [];
  return entries.length
    ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ")
    : "ไม่มี Breakdown";
}

export default function ReportStudioView({
  account,
  api,
  run,
  busy,
  deviceState,
  device,
  send,
  fresh,
  onOpenCaptureSetup,
  onOpenOptimization,
  onImport,
  onRefreshDevice,
}: {
  account: string;
  api: Api;
  run: Run;
  busy: boolean;
  deviceState?: DeviceState;
  device: string;
  send: (command: unknown) => Promise<string>;
  fresh: boolean;
  onOpenCaptureSetup: () => void;
  onOpenOptimization: () => void;
  onImport: () => void;
  onRefreshDevice: () => void;
}) {
  const [selection, setSelection] = useState({ account, job: "" });
  const selectedJob = selection.account === account ? selection.job : "";
  const [scopeKey, setScopeKey] = useState("");
  const [metric, setMetric] = useState<ReportMetric>(() =>
    storedChoice(
      "reportMetric",
      Object.keys(reportMetrics) as ReportMetric[],
      "spend",
    ),
  );
  const [order, setOrder] = useState<ReportSortOrder>(() =>
    storedChoice("reportOrder", ["desc", "asc"], "desc"),
  );
  const [view, setView] = useState<ReportView>(() =>
    storedChoice(
      "reportView",
      Object.keys(reportViews) as ReportView[],
      "compare",
    ),
  );
  const [scatterX, setScatterX] = useState<ReportMetric>("spend");
  const [scatterY, setScatterY] = useState<ReportMetric>("results");
  const [compositionBasis, setCompositionBasis] =
    useState<CompositionBasis>("spend");
  const [trendGroupKey, setTrendGroupKey] = useState("");
  const [query, setQuery] = useState("");
  const [resultType, setResultType] = useState("");
  const [delivery, setDelivery] = useState("");
  const [includeObserved, setIncludeObserved] = useState(false);
  const [goal, setGoal] = useState<"messages" | "sales" | "leads">(() =>
    storedChoice("reportGoal", ["messages", "sales", "leads"], "messages"),
  );
  const [targetCostPerResult, setTargetCostPerResult] = useState("");
  const [targetRoas, setTargetRoas] = useState("");
  const [preferenceNote, setPreferenceNote] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [workflowCommand, setWorkflowCommand] = useState("");
  const [workflowActive, setWorkflowActive] = useState(false);
  const [materializeNote, setMaterializeNote] = useState("");
  const [context, setContext] = useState({
    timezone: "",
    attribution: "",
    result_type: "",
    useTimezone: false,
    useAttribution: false,
    useResultType: false,
    noFilters: false,
    noBreakdown: false,
  });
  const deferredQuery = useDeferredValue(query);
  useEffect(() => {
    setContext({
      timezone: localStorage.getItem("analysisTimezone") ?? "",
      attribution: localStorage.getItem("analysisAttribution") ?? "",
      result_type: localStorage.getItem("analysisResultType") ?? "",
      useTimezone: localStorage.getItem("analysisUseTimezone") === "true",
      useAttribution: localStorage.getItem("analysisUseAttribution") === "true",
      useResultType: localStorage.getItem("analysisUseResultType") === "true",
      noFilters: localStorage.getItem("analysisNoFilters") === "true",
      noBreakdown: localStorage.getItem("analysisNoBreakdown") === "true",
    });
  }, []);
  const params = new URLSearchParams({ account_id: account });
  if (selectedJob) params.set("job_id", selectedJob);
  if (context.useTimezone && context.timezone.trim())
    params.set("timezone", context.timezone.trim());
  if (context.useAttribution && context.attribution.trim())
    params.set("attribution", context.attribution.trim());
  if (context.useResultType && context.result_type.trim())
    params.set("result_type", context.result_type.trim());
  if (context.noFilters) params.set("confirm_no_filters", "true");
  if (context.noBreakdown) params.set("confirm_no_breakdown", "true");
  const workflowReceipt = useSWR<Receipt>(
    device && workflowCommand
      ? `/devices/${device}/commands/${workflowCommand}`
      : null,
    api,
    {
      refreshInterval: workflowActive ? 2_000 : 0,
    },
  );
  const workflowReceiptData = workflowReceipt.data;
  const captureActive =
    workflowReceiptData?.status === "pending" ||
    deviceState?.state.job?.status === "running";
  const analysis = useSWR<Response>(
    account ? `/captures/analysis?${params.toString()}` : null,
    api,
    {
      refreshInterval: captureActive ? 5_000 : 0,
      shouldRetryOnError: false,
    },
  );
  const preferences = useSWR<{
    preferences: ReportPreferences;
    updated_at: string | null;
  }>(account ? `/reports/preferences?account_id=${account}` : null, api, {
    revalidateOnFocus: false,
  });
  useEffect(() => {
    const saved = preferences.data?.preferences;
    if (!saved) return;
    setGoal(saved.goal);
    setTargetCostPerResult(
      saved.target_cost_per_result === null
        ? ""
        : String(saved.target_cost_per_result),
    );
    setTargetRoas(saved.target_roas === null ? "" : String(saved.target_roas));
  }, [preferences.data?.preferences]);
  useEffect(() => {
    const status = workflowReceipt.data?.status;
    if (!workflowActive || !status || status === "pending") return;
    setWorkflowActive(false);
    void analysis.mutate();
    onRefreshDevice();
  }, [
    workflowActive,
    workflowReceipt.data?.status,
    analysis.mutate,
    onRefreshDevice,
  ]);
  const normalized = useSWR<{
    groups: ReturnType<typeof buildTrendGroups>;
  }>(account ? `/insights/trend?account_id=${account}` : null, api, {
    revalidateOnFocus: false,
  });
  const trendGroups = normalized.data?.groups ?? [];
  const trendGroup =
    trendGroups.find((group) => group.key === trendGroupKey) ?? trendGroups[0];
  const adsLevels = useMemo(
    () => analysis.data?.levels.filter((level) => level.level === "ads") ?? [],
    [analysis.data],
  );
  const scope =
    adsLevels.find((level) => level.scope_key === scopeKey) ?? adsLevels[0];
  const reconciliationParams = new URLSearchParams(params);
  reconciliationParams.delete("job_id");
  if (scope) reconciliationParams.set("scope_key", scope.scope_key);
  const reconciliation = useSWR<{
    reconciliation: DomCsvReconciliation[];
  }>(
    analysis.data?.job.id && scope
      ? `/captures/jobs/${analysis.data.job.id}/reconciliation?${reconciliationParams.toString()}`
      : null,
    api,
    { revalidateOnFocus: false },
  );
  const materialization = useSWR<{
    raw_rows: number;
    promoted_rows: number;
    needs_review_rows: number;
    verified_ads: number;
    normalized_ads: number;
    normalized_observations: number;
    reasons: string[];
  }>(
    analysis.data?.job.id
      ? `/captures/jobs/${analysis.data.job.id}/materialization?account_id=${account}`
      : null,
    api,
    { revalidateOnFocus: false },
  );
  const rows = useMemo(
    () =>
      buildReportRows(scope, {
        metric,
        order,
        query: deferredQuery,
        resultType,
        delivery,
        includeObserved,
      }),
    [
      scope,
      metric,
      order,
      deferredQuery,
      resultType,
      delivery,
      includeObserved,
    ],
  );
  const chart = useMemo(() => buildChartRows(rows), [rows]);
  const scopeBars = useMemo(
    () => buildScopeBars(adsLevels, metric),
    [adsLevels, metric],
  );
  const outcomes = useMemo(() => buildDeliverySummary(rows), [rows]);
  const kpis = useMemo(() => buildKpis(rows), [rows]);
  const composition = useMemo(
    () => buildComposition(rows, compositionBasis),
    [rows, compositionBasis],
  );
  const histogram = useMemo(() => buildHistogram(rows, metric), [rows, metric]);
  const scatter = useMemo(
    () => buildScatter(rows, scatterX, scatterY),
    [rows, scatterX, scatterY],
  );
  const concentration = useMemo(() => buildConcentration(rows), [rows]);
  const resultTypes = useMemo(
    () => uniqueValues(scope, "result_type"),
    [scope],
  );
  const deliveries = useMemo(
    () => uniqueValues(scope, "delivery") as Delivery[],
    [scope],
  );
  const selectedMetric = reportMetrics[metric];
  const currency = scope?.context.currency ?? null;
  const jobStatus = deviceState?.state.job?.status;
  const [extensionMajor = 0, extensionMinor = 0, extensionPatch = 0] = (
    deviceState?.state.extension_version ?? "0.0.0"
  )
    .split(".")
    .map(Number);
  const supportsReportWorkflow =
    extensionMajor > 0 ||
    extensionMinor > 6 ||
    (extensionMinor === 6 && extensionPatch >= 47);
  const collecting = jobStatus === "running";
  const canPull =
    !!account &&
    !!deviceState?.state.enabled &&
    !!deviceState.state.report_input &&
    supportsReportWorkflow &&
    fresh &&
    !collecting;

  const updateMetric = (value: ReportMetric) => {
    setMetric(value);
    localStorage.setItem("reportMetric", value);
  };
  const updateOrder = (value: ReportSortOrder) => {
    setOrder(value);
    localStorage.setItem("reportOrder", value);
  };
  const updateView = (value: ReportView) => {
    setView(value);
    localStorage.setItem("reportView", value);
  };
  const updateGoal = (value: typeof goal) => {
    setGoal(value);
    localStorage.setItem("reportGoal", value);
  };
  const targetCost = targetCostPerResult.trim()
    ? Number(targetCostPerResult)
    : null;
  const targetRoasValue = targetRoas.trim() ? Number(targetRoas) : null;
  const activeTarget =
    metric === "cost_per_result"
      ? targetCost && Number.isFinite(targetCost) && targetCost > 0
        ? targetCost
        : null
      : metric === "roas"
        ? targetRoasValue &&
          Number.isFinite(targetRoasValue) &&
          targetRoasValue > 0
          ? targetRoasValue
          : null
        : null;
  const updateContext = (patch: Partial<typeof context>) => {
    const next = { ...context, ...patch };
    setContext(next);
    localStorage.setItem("analysisTimezone", next.timezone);
    localStorage.setItem("analysisAttribution", next.attribution);
    localStorage.setItem("analysisResultType", next.result_type);
    localStorage.setItem("analysisUseTimezone", String(next.useTimezone));
    localStorage.setItem("analysisUseAttribution", String(next.useAttribution));
    localStorage.setItem("analysisUseResultType", String(next.useResultType));
    localStorage.setItem("analysisNoFilters", String(next.noFilters));
    localStorage.setItem("analysisNoBreakdown", String(next.noBreakdown));
  };
  const pullLatest = () =>
    run("report-pull", async () => {
      setWorkflowActive(true);
      try {
        const id = await send({
          command: "report.collect",
          goal,
          maxSteps: 20,
          scan_columns: false,
        });
        setWorkflowCommand(id);
      } catch (error) {
        setWorkflowActive(false);
        throw error;
      }
    });
  const materialize = () =>
    run("report-materialize", async () => {
      if (!analysis.data?.job.id)
        throw new Error("ยังไม่มี capture job สำหรับบันทึกเป็น normalized data");
      const operator = {
        ...(context.useTimezone && context.timezone.trim()
          ? { timezone: context.timezone.trim() }
          : {}),
        ...(context.useAttribution && context.attribution.trim()
          ? { attribution: context.attribution.trim() }
          : {}),
        ...(context.useResultType && context.result_type.trim()
          ? { result_type: context.result_type.trim() }
          : {}),
        ...(context.noFilters ? { confirm_no_filters: true as const } : {}),
        ...(context.noBreakdown ? { confirm_no_breakdown: true as const } : {}),
      };
      const result = await api<{
        status: string;
        snapshots: number;
        rows: number;
        promoted: number;
        unique_observations: number;
        reasons: string[];
      }>(
        `/captures/jobs/${analysis.data.job.id}/review?account_id=${account}`,
        Object.keys(operator).length ? { context: operator } : {},
      );
      setMaterializeNote(
        `บันทึกแล้ว ${result.unique_observations} unique observations (${result.promoted}/${result.rows} raw rows, ${result.snapshots} snapshots)${
          result.reasons.length
            ? ` · ยังติด: ${result.reasons.slice(0, 4).join(", ")}`
            : ""
        }`,
      );
      await Promise.all([
        analysis.mutate(),
        normalized.mutate(),
        materialization.mutate(),
      ]);
      onRefreshDevice();
    });
  const savePreferences = () =>
    run("report-preferences", async () => {
      if (
        (targetCostPerResult.trim() &&
          (targetCost === null ||
            !Number.isFinite(targetCost) ||
            targetCost <= 0)) ||
        (targetRoas.trim() &&
          (targetRoasValue === null ||
            !Number.isFinite(targetRoasValue) ||
            targetRoasValue <= 0))
      )
        throw new Error("เป้าหมาย CPA และ ROAS ต้องเป็นตัวเลขมากกว่า 0");
      const result = await api<{
        preferences: ReportPreferences;
        updated_at: string;
      }>("/reports/preferences", {
        account_id: account,
        preferences: {
          goal,
          target_cost_per_result: targetCost,
          target_roas: targetRoasValue,
        },
      });
      setPreferenceNote(`บันทึกเป้าหมายแล้ว ${time(result.updated_at)}`);
      await preferences.mutate();
    });
  const normalizedReady =
    !!materialization.data &&
    materialization.data.verified_ads > 0 &&
    materialization.data.normalized_ads === materialization.data.verified_ads;
  const targetsReady = targetCost !== null || targetRoasValue !== null;
  const dailyReady = (normalized.data?.groups.length ?? 0) > 0;
  const checklist = [
    {
      label: "Ads coverage",
      ready: scope?.coverage === "complete",
      detail:
        scope?.coverage === "complete"
          ? "จำนวน Ads ตรงกับ scope"
          : "coverage ยังไม่ complete",
    },
    {
      label: "Normalized data",
      ready: normalizedReady,
      detail: materialization.data
        ? `${materialization.data.normalized_ads}/${materialization.data.verified_ads} Ads`
        : "ยังไม่ทราบสถานะ",
    },
    {
      label: "DB report cache",
      ready: analysis.data?.report_cached === true,
      detail: analysis.data?.report_cached
        ? "PostgreSQL cache พร้อมใช้"
        : "กำลังสร้างจาก raw capture",
    },
    {
      label: "Business targets",
      ready: targetsReady,
      detail: targetsReady ? "มี Target CPA หรือ ROAS" : "ยังไม่ได้ตั้งเป้าหมาย",
    },
    {
      label: "Daily trend",
      ready: dailyReady,
      detail: dailyReady ? "มี daily observations" : "ยังไม่มีข้อมูลรายวัน",
    },
    {
      label: "Extension",
      ready: fresh && !!deviceState?.state.report_input,
      detail:
        fresh && deviceState?.state.report_input
          ? "heartbeat และ lease พร้อม"
          : "ต้องเปิด report-input lease",
    },
  ];
  const checklistReady = checklist.filter((item) => item.ready).length;
  const exportCsv = async () => {
    if (!scope || !rows.length) return;
    const { default: Papa } = await import("papaparse");
    const csv = Papa.unparse(
      rows.map((row) => ({
        ad_id: row.entity_id,
        ad_name: row.name,
        delivery: deliveryLabels[row.delivery],
        delivery_text: row.delivery_text,
        result_type: row.result_type,
        spend: row.spend,
        spend_source: row.spend_source,
        impressions: row.impressions,
        results: row.results,
        cost_per_result: row.cost_per_result,
        cpm: row.cpm,
        roas: row.other.roas ?? null,
        evidence: evidenceLabel(row),
        column_mapping: row.mapping,
        occurrences: row.occurrences,
        flags: row.flags.join("|"),
        captured_at: row.provenance.at(-1)?.captured_at,
        reader_version: row.provenance.at(-1)?.reader_version,
      })),
    );
    download("\uFEFF" + csv, "meta-ads-report.csv", "text/csv;charset=utf-8");
  };
  const exportJson = () =>
    download(
      JSON.stringify(
        {
          report: "manual_ads_report",
          generated_at: new Date().toISOString(),
          job: analysis.data?.job,
          scope,
          filters: {
            metric,
            order,
            query,
            result_type: resultType || null,
            delivery: delivery || null,
            include_observed: includeObserved,
          },
          business_targets: {
            goal,
            target_cost_per_result: targetCost,
            target_roas: targetRoasValue,
          },
          csv_reconciliation: reconciliation.data?.reconciliation ?? [],
          rows,
        },
        null,
        2,
      ),
      "meta-ads-report.json",
    );

  return (
    <div className="report-studio">
      <section className="report-command" aria-label="เลือกชุดรายงาน">
        <div className="report-command-main">
          <div>
            <label htmlFor="reportJob">ชุดข้อมูลที่อ่านจาก Ads Manager</label>
            <select
              id="reportJob"
              value={selectedJob}
              onChange={(event) => {
                setSelection({ account, job: event.target.value });
                setScopeKey("");
              }}
            >
              <option value="">งานอ่านล่าสุด</option>
              {analysis.data?.jobs.map((job) => (
                <option key={job.job_id} value={job.job_id}>
                  {time(job.captured_at)} · {job.snapshots} ภาพ
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reportScope">Scope ที่ต้องการดู</label>
            <select
              id="reportScope"
              value={scope?.scope_key ?? ""}
              disabled={!adsLevels.length}
              onChange={(event) => setScopeKey(event.target.value)}
            >
              {!adsLevels.length ? (
                <option value="">ยังไม่มีข้อมูลระดับ Ads</option>
              ) : (
                adsLevels.map((level) => (
                  <option key={level.scope_key} value={level.scope_key}>
                    {scopeLabel(level)} · {level.verified_unique_rows} Ads
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label htmlFor="reportGoal">เป้าหมายของรายงาน</label>
            <select
              id="reportGoal"
              value={goal}
              onChange={(event) =>
                updateGoal(event.target.value as "messages" | "sales" | "leads")
              }
            >
              <option value="messages">ข้อความ</option>
              <option value="sales">ยอดขาย</option>
              <option value="leads">ลูกค้าเป้าหมาย</option>
            </select>
          </div>
        </div>
        <div className="report-command-actions">
          <button
            className="secondary"
            onClick={onOpenCaptureSetup}
            disabled={!account}
          >
            <Icon name="scan" />
            ตั้งค่าคอลัมน์ / เปิดหน้า Ads
          </button>
          <button
            className="secondary"
            onClick={onOpenOptimization}
            disabled={!scope || scope.coverage !== "complete"}
            title="สร้างข้อเสนอจาก scope ที่ coverage complete"
          >
            <Icon name="target" />
            สร้างข้อเสนอ
          </button>
          {deviceState?.state.report_input && supportsReportWorkflow ? (
            <button
              className="primary"
              disabled={!canPull || !!busy}
              onClick={() => void pullLatest()}
              title="อ่านตาราง Ads จากแท็บที่เปิดอยู่ โดยไม่แก้ไขโฆษณา"
            >
              <Icon name="refresh" />
              {collecting ? "กำลังอ่าน…" : "ดึงข้อมูล Ads ใหม่"}
            </button>
          ) : (
            <button
              className="secondary"
              onClick={onOpenCaptureSetup}
              disabled={!account}
            >
              {deviceState?.state.extension_version && !supportsReportWorkflow
                ? "Reload Extension 0.6.47"
                : "เปิดสิทธิ์รายงานใน Extension"}
            </button>
          )}
        </div>
      </section>

      {workflowCommand ? (
        <section
          className={`report-workflow ${
            workflowReceiptData?.status === "error" ? "error" : ""
          }`}
          aria-live="polite"
        >
          <div>
            <span>ลำดับการดึงข้อมูล</span>
            <strong>
              {workflowReceiptData?.status === "pending"
                ? "Extension กำลังเปิดหน้า Ads และตั้งคอลัมน์"
                : workflowReceiptData?.status === "error"
                  ? "ดึงข้อมูลไม่สำเร็จ"
                  : deviceState?.state.job?.status === "running"
                    ? "กำลังอ่านและบันทึก snapshots"
                    : "คำสั่งรายงานจบแล้ว"}
            </strong>
          </div>
          <ol>
            <li
              className={
                workflowReceiptData?.status === "pending" ? "active" : "done"
              }
            >
              เตรียมมุมมอง Ads
            </li>
            <li
              className={
                deviceState?.state.job?.status === "running"
                  ? "active"
                  : workflowReceiptData?.status === "done"
                    ? "done"
                    : ""
              }
            >
              อ่านตาราง
            </li>
            <li
              className={
                analysis.data?.job.status === "needs_review" && !captureActive
                  ? "done"
                  : ""
              }
            >
              บันทึกและแสดงรายงาน
            </li>
          </ol>
          {workflowReceiptData?.error ? (
            <p>{workflowReceiptData.error}</p>
          ) : null}
        </section>
      ) : null}

      {!analysis.data ? (
        <Panel title="รายงานโฆษณา">
          {analysis.isLoading ? (
            <p className="report-loading">กำลังอ่านข้อมูลที่บันทึกไว้…</p>
          ) : analysis.error ? (
            <Empty icon="chart" title="ยังเปิดรายงานไม่ได้">
              {analysis.error.message}. เริ่มอ่าน Ads จากเมนู “ตั้งค่าคอลัมน์ / เปิดหน้า
              Ads” แล้วกลับมาหน้านี้
            </Empty>
          ) : (
            <Empty icon="chart" title="เลือกบัญชีโฆษณาก่อน">
              รายงานจะแสดงงานอ่านและ scope ระดับ Ads ของบัญชีที่เลือก
            </Empty>
          )}
        </Panel>
      ) : !scope ? (
        <Panel title="ยังไม่มีข้อมูลระดับ Ads">
          <Empty icon="scan" title="เริ่มอ่านตาราง Ads">
            เปิดหน้า Ads Manager และตั้งคอลัมน์ ID, Spend, Results และ Impressions ก่อน
            จากนั้นจึงเริ่มอ่านตาราง
          </Empty>
        </Panel>
      ) : (
        <>
          <section className="report-identity" aria-label="คุณภาพขอบเขตข้อมูล">
            <div className="report-identity-lead">
              <span>{scope.context.date_range_label ?? "ไม่ทราบช่วงวันที่"}</span>
              <strong>
                {scope.verified_unique_rows} Ads ที่ยืนยัน ID
                {scope.unresolved_observations
                  ? ` · ${scope.unresolved_observations} observation รอเชื่อมตัวตน`
                  : ""}
              </strong>
              <small>
                {scope.snapshots} ภาพ ·{" "}
                {jobLabels[analysis.data.job.status ?? ""] ??
                  analysis.data.job.status ??
                  "ไม่ทราบสถานะ"}{" "}
                · Extension {analysis.data.job.extension_version ?? "—"}
              </small>
            </div>
            <div className="report-identity-fact">
              <span>Coverage</span>
              <Pill kind={coverageKinds[scope.coverage]}>
                {coverageLabels[scope.coverage]}
              </Pill>
            </div>
            <div className="report-identity-fact">
              <span>Breakdown</span>
              <strong>{breakdownText(scope)}</strong>
            </div>
            <div className="report-identity-fact">
              <span>บริบทการวัด</span>
              <strong>
                {scope.context.currency ?? "สกุลเงินยังไม่ยืนยัน"} ·{" "}
                {scope.context.attribution ?? "Attribution ยังไม่ยืนยัน"}
              </strong>
            </div>
          </section>

          <section className="report-acceptance" aria-label="ความพร้อมของรายงาน">
            <div className="report-acceptance-head">
              <div>
                <span>รายการตรวจความพร้อม</span>
                <strong>
                  {checklistReady}/{checklist.length} ผ่าน
                </strong>
              </div>
              <Pill kind={checklistReady === checklist.length ? "success" : "warning"}>
                {checklistReady === checklist.length
                  ? "พร้อมใช้ตามเกณฑ์"
                  : "ยังมีรายการต้องดำเนินการ"}
              </Pill>
            </div>
            <ul>
              {checklist.map((item) => (
                <li key={item.label} className={item.ready ? "ready" : ""}>
                  <span>{item.ready ? "✓" : "○"}</span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </li>
              ))}
            </ul>
          </section>

          {materialization.data ? (
            <section
              className="report-data-health"
              aria-label="สถานะข้อมูล normalized"
            >
              <div>
                <span>Normalized coverage</span>
                <strong>
                  {materialization.data.normalized_ads} /{" "}
                  {materialization.data.verified_ads} Ads
                </strong>
                <small>
                  {materialization.data.normalized_observations} unique
                  observations · {materialization.data.promoted_rows}/
                  {materialization.data.raw_rows} raw rows
                </small>
                <small>
                  {analysis.data.report_cached
                    ? `Report cache ใน PostgreSQL พร้อมใช้`
                    : "Report cache กำลังถูกสร้างจาก raw capture"}
                </small>
              </div>
              <div
                className="report-data-progress"
                role="img"
                aria-label={`Normalized ${materialization.data.normalized_ads} จาก ${materialization.data.verified_ads} Ads`}
              >
                <i
                  style={{
                    width: `${
                      materialization.data.verified_ads
                        ? (materialization.data.normalized_ads /
                            materialization.data.verified_ads) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div>
                <span>ยังไม่เข้า normalized</span>
                <strong>
                  {Math.max(
                    0,
                    materialization.data.verified_ads -
                      materialization.data.normalized_ads,
                  )}{" "}
                  Ads
                </strong>
                <small>
                  {materialization.data.needs_review_rows} raw rows รอตรวจ
                </small>
              </div>
              <div className="report-data-reasons">
                <span>สาเหตุ</span>
                <strong>
                  {materialization.data.reasons.length
                    ? materialization.data.reasons.join(" · ")
                    : "ไม่มี blockers"}
                </strong>
              </div>
            </section>
          ) : null}

          <details
            className="report-context-confirm"
            open={contextOpen}
            onToggle={(event) => setContextOpen(event.currentTarget.open)}
          >
            <summary>ยืนยันบริบทที่ใช้ตีความรายงาน</summary>
            <div className="report-context-grid">
              <label>
                เขตเวลา (IANA)
                <input
                  value={context.timezone}
                  placeholder="Asia/Bangkok"
                  onChange={(event) =>
                    updateContext({ timezone: event.target.value })
                  }
                />
              </label>
              <label>
                Attribution
                <input
                  value={context.attribution}
                  placeholder="เช่น 7-day click"
                  onChange={(event) =>
                    updateContext({ attribution: event.target.value })
                  }
                />
              </label>
              <label>
                ประเภทผลลัพธ์
                <input
                  value={context.result_type}
                  placeholder="เช่น Messages / Purchases"
                  onChange={(event) =>
                    updateContext({ result_type: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="report-context-checks">
              <label>
                <input
                  type="checkbox"
                  checked={context.useTimezone}
                  onChange={(event) =>
                    updateContext({ useTimezone: event.target.checked })
                  }
                />
                ใช้เขตเวลานี้
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={context.useAttribution}
                  onChange={(event) =>
                    updateContext({ useAttribution: event.target.checked })
                  }
                />
                ใช้ Attribution นี้
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={context.useResultType}
                  onChange={(event) =>
                    updateContext({ useResultType: event.target.checked })
                  }
                />
                ใช้ประเภทผลลัพธ์นี้
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={context.noFilters}
                  onChange={(event) =>
                    updateContext({ noFilters: event.target.checked })
                  }
                />
                ไม่มีตัวกรองรายงาน
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={context.noBreakdown}
                  onChange={(event) =>
                    updateContext({ noBreakdown: event.target.checked })
                  }
                />
                ไม่มี Breakdown
              </label>
            </div>
            <p>
              ระบบใช้เฉพาะค่าที่ติ๊กยืนยันเพื่อตรวจความพร้อมของ scope และไม่แทนค่าที่ Meta
              ไม่ได้แสดงด้วยค่าที่เดาขึ้น
            </p>
            <div className="report-materialize">
              <button
                className="primary"
                disabled={!!busy || !analysis.data?.job.id}
                onClick={() => void materialize()}
              >
                บันทึกเป็นข้อมูลวิเคราะห์
              </button>
              {materializeNote ? <p>{materializeNote}</p> : null}
            </div>
          </details>

          <details className="report-business-target">
            <summary>เป้าหมายธุรกิจและเกณฑ์อ้างอิง</summary>
            <div className="report-business-grid">
              <label>
                ต้นทุนเป้าหมายต่อผลลัพธ์
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={targetCostPerResult}
                  placeholder="เช่น 15"
                  onChange={(event) =>
                    setTargetCostPerResult(event.target.value)
                  }
                />
              </label>
              <label>
                ROAS เป้าหมาย
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={targetRoas}
                  placeholder="เช่น 2.5"
                  onChange={(event) => setTargetRoas(event.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => void savePreferences()}
              >
                บันทึกเป้าหมาย
              </button>
            </div>
            <p>
              เป้าหมายนี้เป็นค่าที่คุณกำหนด ใช้แสดงเส้นอ้างอิงเท่านั้น
              ไม่ใช่คำแนะนำหรือการรับประกันผลกำไร
              {preferenceNote ? ` · ${preferenceNote}` : ""}
            </p>
          </details>

          {analysis.data.job.error ? (
            <div className="report-alert" role="alert">
              งานอ่านจบพร้อมข้อผิดพลาด: {analysis.data.job.error}
            </div>
          ) : null}
          {scope.blockers.length || analysis.data.job.level_warnings?.length ? (
            <details className="report-evidence-note">
              <summary>
                มีข้อจำกัดของหลักฐาน{" "}
                {scope.blockers.length ? `(${scope.blockers.length})` : ""}
              </summary>
              <div>
                {scope.blockers.map((blocker) => (
                  <code key={blocker}>{blocker}</code>
                ))}
                {analysis.data.job.level_warnings?.map((warning, index) => (
                  <p key={`${warning}-${index}`}>{warning}</p>
                ))}
                <p>
                  Coverage หมายถึงความครบของ scope นี้เท่านั้น ไม่ได้ยืนยันว่า
                  รายงานเป็นข้อมูลทั้งบัญชี
                </p>
              </div>
            </details>
          ) : null}

          <KpiRibbon
            ads={kpis.ads}
            verified={kpis.verified}
            observed={kpis.observed}
            spend={kpis.spend}
            results={kpis.results}
            impressions={kpis.impressions}
            costPerResult={kpis.cost_per_result}
            cpm={kpis.cpm}
            currency={currency}
            targetCostPerResult={targetCost}
          />

          <div
            className="report-view-nav"
            role="tablist"
            aria-label="มุมมองรายงาน"
          >
            {(Object.keys(reportViews) as ReportView[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className={view === key ? "active" : ""}
                onClick={() => updateView(key)}
              >
                <strong>{reportViews[key].label}</strong>
                <span>{reportViews[key].question}</span>
              </button>
            ))}
          </div>

          <section className="report-controls" aria-label="ตั้งค่ากราฟและตัวกรอง">
            <div
              className="report-metric-picker"
              role="group"
              aria-label="ตัวชี้วัด"
            >
              {(Object.keys(reportMetrics) as ReportMetric[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={metric === key ? "active" : ""}
                  aria-pressed={metric === key}
                  onClick={() => updateMetric(key)}
                >
                  {reportMetrics[key].label}
                </button>
              ))}
            </div>
            <div className="report-filter-grid">
              <label className="report-search">
                <span className="sr-only">ค้นหา Ads</span>
                <Icon name="search" />
                <input
                  placeholder="ค้นหาชื่อหรือ ID"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <select
                aria-label="กรองประเภทผลลัพธ์"
                value={resultType}
                onChange={(event) => setResultType(event.target.value)}
              >
                <option value="">ทุกประเภทผลลัพธ์</option>
                {resultTypes.map((value) => (
                  <option key={value} value={value ?? ""}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                aria-label="กรองสถานะการนำส่ง"
                value={delivery}
                onChange={(event) => setDelivery(event.target.value)}
              >
                <option value="">ทุกสถานะ</option>
                {deliveries.map((value) => (
                  <option key={value} value={value}>
                    {deliveryLabels[value]}
                  </option>
                ))}
              </select>
              <select
                aria-label="เรียงลำดับ"
                value={order}
                onChange={(event) =>
                  updateOrder(event.target.value as ReportSortOrder)
                }
              >
                <option value="desc">มากไปน้อย</option>
                <option value="asc">น้อยไปมาก</option>
              </select>
              <label className="report-check">
                <input
                  type="checkbox"
                  checked={includeObserved}
                  onChange={(event) => setIncludeObserved(event.target.checked)}
                />
                รวมแถวที่ยังไม่มี ID
              </label>
            </div>
          </section>

          <div className="report-stage">
            <section
              className="report-chart-panel"
              aria-labelledby="reportChartTitle"
            >
              <div className="report-section-head">
                <div>
                  <span>{reportViews[view].label}</span>
                  <h2 id="reportChartTitle">
                    {view === "compare"
                      ? `${selectedMetric.label} ตามโฆษณา`
                      : view === "relationship"
                        ? "ความสัมพันธ์ระหว่างตัวชี้วัด"
                        : view === "distribution"
                          ? `การกระจายของ ${selectedMetric.label}`
                          : view === "composition"
                            ? "องค์ประกอบตามสถานะการนำส่ง"
                            : view === "concentration"
                              ? "Spend และ Results สะสม"
                              : "แนวโน้มรายวัน"}
                  </h2>
                  <p className="report-view-question">
                    {reportViews[view].question}
                  </p>
                </div>
              </div>
              {metric === "spend" && scope.spend_quality === "mixed" ? (
                <p className="report-chart-note">
                  ยอดใช้จ่ายบางแถวเป็นค่าประมาณจาก Results × Cost per result ดูคอลัมน์
                  “หลักฐาน” ในตารางก่อนนำยอดไปใช้
                </p>
              ) : null}

              {view === "compare" ? (
                <>
                  <MetricBars
                    rows={chart.rows}
                    metric={metric}
                    currency={currency}
                    max={chart.max}
                    target={activeTarget}
                  />
                  <p className="report-axis-note">
                    ความยาวแท่งคือค่าที่เลือก ไม่ได้หมายถึง “ดี” หรือ “แย่”.
                    การตีความขึ้นอยู่กับเป้าหมายและบริบทธุรกิจ
                  </p>
                </>
              ) : null}

              {view === "relationship" ? (
                <>
                  <div className="chart-axis-controls">
                    <label>
                      แกน X
                      <select
                        value={scatterX}
                        onChange={(event) =>
                          setScatterX(event.target.value as ReportMetric)
                        }
                      >
                        {(Object.keys(reportMetrics) as ReportMetric[]).map(
                          (key) => (
                            <option key={key} value={key}>
                              {reportMetrics[key].label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      แกน Y
                      <select
                        value={scatterY}
                        onChange={(event) =>
                          setScatterY(event.target.value as ReportMetric)
                        }
                      >
                        {(Object.keys(reportMetrics) as ReportMetric[]).map(
                          (key) => (
                            <option key={key} value={key}>
                              {reportMetrics[key].label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <ScatterPlot
                    points={scatter.points}
                    xMetric={scatterX}
                    yMetric={scatterY}
                    xMax={scatter.xMax}
                    yMax={scatter.yMax}
                    xMedian={scatter.xStats?.median ?? null}
                    yMedian={scatter.yStats?.median ?? null}
                    missing={scatter.missing}
                    currency={currency}
                  />
                </>
              ) : null}

              {view === "distribution" ? (
                <DistributionHistogram
                  bins={histogram.bins}
                  stats={histogram.stats}
                  metric={metric}
                  missing={histogram.missing}
                  currency={currency}
                />
              ) : null}

              {view === "composition" ? (
                <>
                  <div
                    className="composition-controls"
                    role="group"
                    aria-label="ฐานการคำนวณสัดส่วน"
                  >
                    {(
                      [
                        ["spend", "ตาม Spend"],
                        ["results", "ตาม Results"],
                        ["count", "ตามจำนวน Ads"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={compositionBasis === key ? "active" : ""}
                        aria-pressed={compositionBasis === key}
                        onClick={() => setCompositionBasis(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <CompositionDonut
                    segments={composition.segments}
                    total={composition.total}
                    basis={compositionBasis}
                    currency={currency}
                  />
                  {composition.missingRows ? (
                    <p className="report-axis-note">
                      {composition.missingRows} Ads ไม่มีค่าของฐานที่เลือก
                    </p>
                  ) : null}
                </>
              ) : null}

              {view === "concentration" ? (
                <ConcentrationCurve
                  points={concentration.points}
                  spend80={concentration.spend80}
                  results80={concentration.results80}
                  count={concentration.count}
                  missing={concentration.missing}
                />
              ) : null}

              {view === "trend" ? (
                normalized.isLoading ? (
                  <p className="report-loading">กำลังโหลดข้อมูลรายวัน…</p>
                ) : normalized.error ? (
                  <div className="report-chart-empty">
                    โหลด normalized observations ไม่ได้:{" "}
                    {normalized.error.message}
                  </div>
                ) : trendGroup ? (
                  <>
                    <div className="trend-source">
                      <label>
                        ชุดข้อมูลรายวัน
                        <select
                          value={trendGroup.key}
                          onChange={(event) =>
                            setTrendGroupKey(event.target.value)
                          }
                        >
                          {trendGroups.map((group) => (
                            <option key={group.key} value={group.key}>
                              {group.date_start} ถึง {group.date_end} ·{" "}
                              {group.source} · {group.result_type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <dl>
                        <div>
                          <dt>แหล่งข้อมูล</dt>
                          <dd>{trendGroup.source}</dd>
                        </div>
                        <div>
                          <dt>เขตเวลา</dt>
                          <dd>{trendGroup.timezone}</dd>
                        </div>
                        <div>
                          <dt>Attribution</dt>
                          <dd>{trendGroup.attribution}</dd>
                        </div>
                      </dl>
                    </div>
                    <TrendLineChart
                      points={trendGroup.points}
                      metric={metric}
                      currency={trendGroup.currency}
                    />
                  </>
                ) : (
                  <div className="report-trend-empty">
                    <h3>ยังไม่มีชุดข้อมูลรายวันที่เทียบกันได้</h3>
                    <p>
                      Capture ปัจจุบันเป็นยอดรวมตามช่วงเวลา จึงไม่ควรนำมาเรียงเป็น
                      time-series. นำเข้า CSV รายวันที่มี Ad ID, Spend, Results,
                      timezone และ Attribution ให้ตรงกันอย่างน้อยสองวันก่อน
                    </p>
                    <button className="secondary" onClick={onImport}>
                      นำเข้า CSV รายวัน
                    </button>
                  </div>
                )
              ) : null}
            </section>

            <aside className="report-side">
              <section className="report-side-section">
                <span>สถานะการนำส่ง</span>
                <h3>{rows.length} รายการในมุมมองนี้</h3>
                <div className="delivery-stack" aria-hidden="true">
                  {outcomes.map((outcome, index) => (
                    <span
                      key={outcome.delivery}
                      className={`delivery-segment segment-${index % 5}`}
                      style={{ width: `${outcome.width}%` }}
                    />
                  ))}
                </div>
                <dl className="delivery-legend">
                  {outcomes.map((outcome, index) => (
                    <div key={outcome.delivery}>
                      <dt>
                        <span className={`legend-dot segment-${index % 5}`} />
                        {outcome.label}
                      </dt>
                      <dd>{number(outcome.count)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {scopeBars.rows.length > 1 ? (
                <section className="report-side-section">
                  <span>เทียบข้าม Scope</span>
                  <h3>ค่าต่อกลุ่ม Breakdown</h3>
                  <div className="scope-bars">
                    {scopeBars.rows.map((item) => (
                      <button
                        type="button"
                        key={item.level.scope_key}
                        className={
                          item.level.scope_key === scope.scope_key
                            ? "active"
                            : ""
                        }
                        onClick={() => setScopeKey(item.level.scope_key)}
                        aria-label={`เปิด scope ${item.label}`}
                      >
                        <span>{item.label}</span>
                        <i>
                          <b style={{ width: `${item.width}%` }} />
                        </i>
                        <strong>
                          {metricText(
                            item.value,
                            metric,
                            item.level.context.currency,
                          )}
                        </strong>
                      </button>
                    ))}
                  </div>
                  <p>ค่าของแต่ละ scope แยกจากกันและไม่ถูกนำมาบวกกัน</p>
                </section>
              ) : null}

              <section className="report-side-section report-context">
                <span>Reading key</span>
                <dl>
                  <div>
                    <dt>ยอดใช้จ่าย</dt>
                    <dd>
                      {scope.spend_quality === "reported"
                        ? "อ่านจากคอลัมน์ Meta"
                        : scope.spend_quality === "estimated"
                          ? "ประมาณจาก Results × Cost/result"
                          : scope.spend_quality === "mixed"
                            ? "มีทั้งค่าจริงและค่าประมาณ"
                            : "ยังไม่มีค่าใช้จ่าย"}
                    </dd>
                  </div>
                  <div>
                    <dt>เขตเวลา</dt>
                    <dd>{scope.context.timezone ?? "ยังไม่ยืนยัน"}</dd>
                  </div>
                  <div>
                    <dt>ตัวกรอง</dt>
                    <dd>
                      {scope.context.filters === null
                        ? "ยังไม่ยืนยัน"
                        : JSON.stringify(scope.context.filters)}
                    </dd>
                  </div>
                  <div>
                    <dt>ตัวตน Ads</dt>
                    <dd>
                      {scope.dedupe === "id"
                        ? "รวมภาพด้วย ID"
                        : scope.dedupe === "mixed"
                          ? "ID และเนื้อหาภายในงานเดียวกัน"
                          : scope.dedupe === "content_within_job"
                            ? "ยังใช้เนื้อหาแทน ID"
                            : "ยังรวมตัวตนไม่ได้"}
                    </dd>
                  </div>
                </dl>
                <Note>
                  แถวที่ไม่มี ID ยังเป็นหลักฐานที่มนุษย์ตรวจได้ แต่ไม่ใช่จำนวน Ads ที่ยืนยันแล้ว
                </Note>
              </section>
            </aside>
          </div>

          <section
            className="report-reconcile"
            aria-labelledby="reportReconcileTitle"
          >
            <div className="report-reconcile-head">
              <div>
                <h2 id="reportReconcileTitle">ตรวจเทียบ DOM กับ CSV</h2>
                <p>
                  เปรียบเทียบเฉพาะ CSV ที่มีบัญชี ช่วงวันที่ สกุลเงิน เขตเวลา Attribution และ
                  Breakdown ตรงกับ scope นี้
                </p>
              </div>
              <button className="secondary" onClick={onImport}>
                นำเข้า CSV
              </button>
            </div>
            {reconciliation.isLoading ? (
              <p className="report-loading">กำลังตรวจรายการ CSV…</p>
            ) : reconciliation.error ? (
              <p className="report-chart-empty">
                ตรวจเทียบไม่ได้: {reconciliation.error.message}
              </p>
            ) : reconciliation.data?.reconciliation.length ? (
              <div className="table-scroll">
                <table className="report-reconcile-table">
                  <thead>
                    <tr>
                      <th>ไฟล์ CSV</th>
                      <th>ID ตรงกัน</th>
                      <th>DOM เท่านั้น</th>
                      <th>CSV เท่านั้น</th>
                      <th>Spend delta</th>
                      <th>Results delta</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.data.reconciliation.map((item) => (
                      <tr key={item.filename}>
                        <td>
                          <strong>{item.filename}</strong>
                          <small>
                            {item.import_verified
                              ? "ไฟล์มีหลักฐาน import"
                              : "ไม่มีหลักฐาน reconciliation ของไฟล์"}
                          </small>
                        </td>
                        <td>
                          {number(item.matched_ids)} / {number(item.dom_rows)}
                        </td>
                        <td>{number(item.dom_only_ids.length)}</td>
                        <td>{number(item.csv_only_ids.length)}</td>
                        <td>
                          {item.metrics.spend.delta === null
                            ? "—"
                            : money(item.metrics.spend.delta, currency)}
                        </td>
                        <td>
                          {item.metrics.results.delta === null
                            ? "—"
                            : number(item.metrics.results.delta)}
                        </td>
                        <td>
                          <Pill
                            kind={
                              item.status === "matched" ? "success" : "warning"
                            }
                          >
                            {item.status === "matched"
                              ? "กระทบยอดตรง"
                              : "ยังไม่ตรง"}
                          </Pill>
                          {item.notes.length ? (
                            <small>{item.notes.join(" · ")}</small>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="report-reconcile-empty">
                <strong>ยังไม่มี CSV ที่เงื่อนไขตรงกับ scope นี้</strong>
                <span>
                  Export Ads CSV จาก Meta สำหรับช่วงเดียวกับรายงาน แล้วนำเข้าเพื่อตรวจ
                  IDs, Spend และ Results แบบอิสระจาก DOM
                </span>
              </div>
            )}
          </section>

          <Panel
            className="report-table-panel"
            title="ตารางรายละเอียด Ads"
            subtitle={`เรียงตาม ${selectedMetric.label} (${order === "desc" ? "มากไปน้อย" : "น้อยไปมาก"}) · ${rows.length} แถวในมุมมองนี้`}
            action={
              <div className="button-group">
                <button
                  className="secondary"
                  disabled={!rows.length}
                  onClick={() =>
                    void run("report-json", async () => exportJson())
                  }
                >
                  <Icon name="download" />
                  JSON
                </button>
                <button
                  className="primary"
                  disabled={!rows.length}
                  onClick={() =>
                    void run("report-csv", async () => exportCsv())
                  }
                >
                  <Icon name="download" />
                  CSV
                </button>
              </div>
            }
          >
            <div className="table-scroll report-table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>โฆษณา</th>
                    <th>สถานะ</th>
                    <th>ผลลัพธ์</th>
                    <th>ยอดใช้จ่าย</th>
                    <th>อิมเพรสชัน</th>
                    <th>ต้นทุน/ผลลัพธ์</th>
                    <th>CPM</th>
                    <th>ROAS</th>
                    <th>หลักฐาน</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row) => (
                      <tr
                        key={row.key}
                        className={
                          row.identity_state === "observed"
                            ? "observed-row"
                            : undefined
                        }
                      >
                        <td>
                          <strong>{row.name ?? "ไม่มีชื่อโฆษณา"}</strong>
                          <small>{row.entity_id ?? "ID ไม่ยืนยัน"}</small>
                        </td>
                        <td>
                          <Pill
                            kind={
                              row.delivery === "active"
                                ? "success"
                                : row.delivery === "rejected"
                                  ? "error"
                                  : "neutral"
                            }
                          >
                            {deliveryLabels[row.delivery]}
                          </Pill>
                        </td>
                        <td>
                          {row.results === null ? "—" : number(row.results)}
                          <small>{row.result_type ?? "ไม่ทราบประเภท"}</small>
                        </td>
                        <td>
                          {money(row.spend, currency)}
                          {row.spend_source ===
                          "estimate_results_x_cost_per_result" ? (
                            <small>ประมาณ</small>
                          ) : null}
                        </td>
                        <td>
                          {row.impressions === null
                            ? "—"
                            : number(row.impressions)}
                        </td>
                        <td>{money(row.cost_per_result, currency)}</td>
                        <td>{money(row.cpm, currency)}</td>
                        <td>
                          {row.other.roas === undefined
                            ? "—"
                            : number(row.other.roas)}
                        </td>
                        <td className="report-evidence-cell">
                          <strong>{evidenceLabel(row)}</strong>
                          <small>
                            {row.provenance.at(-1)?.reader_version ?? "?"} ·{" "}
                            {row.occurrences} ครั้งในภาพ
                          </small>
                          {row.flags.length ? (
                            <small>{row.flags.join(" · ")}</small>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <EmptyRow cols={9}>
                      ไม่มี Ads ตรงกับตัวกรองหรือตัวชี้วัดที่เลือก
                    </EmptyRow>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="report-table-footer">
              <span>
                อ่านจาก {scope.snapshots} ภาพ · คอลัมน์ที่ยังขาด{" "}
                {scope.missing_columns.length
                  ? scope.missing_columns.join(", ")
                  : "ตามคอลัมน์หลัก"}
              </span>
              <span>
                ข้อมูลดิบและ scope ถูกเก็บใน PostgreSQL โดยไม่แก้ค่า unknown เป็น 0
              </span>
            </footer>
          </Panel>
        </>
      )}
    </div>
  );
}
