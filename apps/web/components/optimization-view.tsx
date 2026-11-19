"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { Api, Run } from "../lib/types";
import { number, time } from "../lib/utils";
import { Empty, Note, Panel, Pill } from "./ui";

type Policy = {
  enabled: boolean;
  min_results: number;
  min_spend: number;
  min_peer_rows: number;
  scale_ratio: number;
  pause_ratio: number;
  max_budget_change_pct: number;
  require_experiment_for_new: boolean;
  allow_create_campaign_draft: boolean;
};

type Scope = {
  job_id: string;
  job_status: string;
  captured_at: string;
  scope_key: string;
  coverage: string;
  blockers: string[];
  verified_ads: number;
  reported_ads: number | null;
  context: {
    date_start: string | null;
    date_end: string | null;
    currency: string | null;
    timezone: string | null;
    attribution: string | null;
  };
};

type Recommendation = {
  id: string;
  account_id: string;
  job_id: string | null;
  scope_key: string;
  entity_id: string;
  action: string;
  title: string;
  rationale: string;
  evidence: {
    name?: string | null;
    delivery?: string;
    spend?: number | null;
    results?: number | null;
    cost_per_result?: number | null;
    peer_median_cost_per_result?: number | null;
    cost_ratio_to_median?: number | null;
  };
  confidence: string | number;
  risk: "low" | "medium" | "high";
  expected_impact: Record<string, unknown>;
  status: string;
  updated_at: string;
};

type Plan = {
  id: string;
  title: string;
  objective: string;
  status: string;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  steps: {
    id: string;
    sequence: number;
    action: string;
    target: string;
    payload: Record<string, unknown>;
    status: string;
    requires_approval: boolean;
  }[];
  receipts?: { id: string; verification: string; created_at: string }[];
  rollbacks?: { id: string; action: string; status: string }[];
};

type Experiment = {
  id: string;
  name: string;
  hypothesis: string;
  primary_metric: string;
  status: string;
  planned_days: number | null;
  observation_count?: number;
  arms: {
    id: string;
    label: string;
    description: string | null;
    entity_ids?: string[];
  }[];
};

type Creative = {
  id: string;
  ad_id: string;
  asset_type: string;
  title: string | null;
  body: string | null;
  headline: string | null;
  cta: string | null;
  updated_at: string;
  latest_metrics?: {
    spend?: number | null;
    results?: number | null;
    cost_per_result?: number | null;
  };
  latest_status?: string | null;
};

type Template = {
  id: string;
  name: string;
  goal: string;
  config: Record<string, unknown>;
  enabled: boolean;
};

type Workspace = {
  scope: Scope | null;
  policy: Policy;
  policy_updated_at: string | null;
  recommendations: Recommendation[];
  plans: Plan[];
  experiments: Experiment[];
  creatives: Creative[];
  templates: Template[];
  outcomes: {
    id: string;
    entity_id: string;
    observation_window: string;
    before_metrics: Record<string, unknown>;
    after_metrics: Record<string, unknown>;
    delta: Record<string, unknown>;
    captured_at: string;
  }[];
  hierarchy_versions: Record<string, number>;
  capability: {
    automated_meta_mutation: boolean;
    reason: string;
  };
};

const actionLabels: Record<string, string> = {
  scale_budget: "เพิ่มงบอย่างมีขอบเขต",
  pause_candidate: "ตรวจก่อนหยุด",
  duplicate_winner: "โคลนผู้ชนะ",
  create_new_test: "สร้าง Variant ทดสอบ",
  keep_observing: "เฝ้าดูต่อ",
  budget_change: "เปลี่ยนงบ",
  pause_ad: "หยุด Ads",
  duplicate_ad: "ทำสำเนา Ads",
  create_campaign_draft: "สร้าง Campaign Draft",
};

const statusLabels: Record<string, string> = {
  suggested: "รอตัดสินใจ",
  dismissed: "ไม่ใช้ข้อเสนอนี้",
  planned: "มีแผนแล้ว",
  monitoring: "กำลังติดตามผล",
  completed: "ยืนยันแล้ว",
  failed: "ไม่ผ่าน",
  draft: "ฉบับร่าง",
  approved: "อนุมัติแผน",
  rejected: "ไม่อนุมัติ",
  dispatched: "ส่งดำเนินการ",
  verified: "ตรวจผลแล้ว",
  pending: "รอดำเนินการ",
  ready_for_local_review: "รอ Local Approval",
};

const riskLabels: Record<Recommendation["risk"], string> = {
  low: "ต่ำ",
  medium: "ควรตรวจสอบ",
  high: "ต้องอนุมัติเป็นพิเศษ",
};

function metric(value: unknown, currency = "THB") {
  return typeof value === "number"
    ? new Intl.NumberFormat("th-TH", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value)
    : "—";
}

function confidenceLabel(value: string | number) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

export default function OptimizationView({
  account,
  api,
  run,
  busy,
  advanced,
  onOpenControl,
}: {
  account: string;
  api: Api;
  run: Run;
  busy: boolean;
  advanced: boolean;
  onOpenControl: () => void;
}) {
  const key = account
    ? `/optimization/workspace?account_id=${account}`
    : null;
  const workspace = useSWR<Workspace>(key, api, {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
  });
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [experimentName, setExperimentName] = useState("");
  const [experimentHypothesis, setExperimentHypothesis] = useState("");
  const [experimentMetric, setExperimentMetric] = useState("Cost per result");
  const [creativeAdId, setCreativeAdId] = useState("");
  const [creativeHeadline, setCreativeHeadline] = useState("");
  const [creativeBody, setCreativeBody] = useState("");
  const [creativeCta, setCreativeCta] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateGoal, setTemplateGoal] = useState("messages");
  const [templateBudget, setTemplateBudget] = useState("");
  const [lastRebuild, setLastRebuild] = useState("");

  useEffect(() => {
    if (workspace.data?.policy) setPolicy(workspace.data.policy);
  }, [workspace.data?.policy]);

  const current = workspace.data;
  const recommendations = current?.recommendations ?? [];
  const plans = current?.plans ?? [];
  const experiments = current?.experiments ?? [];
  const outcomes = current?.outcomes ?? [];
  const activeRecommendations = recommendations.filter(
    (item) => item.status === "suggested",
  );
  const highRisk = recommendations.filter(
    (item) => item.risk === "high" && item.status === "suggested",
  ).length;
  const currency = current?.scope?.context.currency ?? "THB";
  const stages = useMemo(
    () => [
      {
        label: "เก็บข้อมูล",
        ready: !!current?.scope,
        detail: current?.scope
          ? `${current.scope.verified_ads} Ads`
          : "ยังไม่มี scope",
      },
      {
        label: "ประเมิน",
        ready: current?.scope?.coverage === "complete",
        detail: current?.scope?.coverage ?? "รอข้อมูล",
      },
      {
        label: "ตัดสินใจ",
        ready: recommendations.length > 0 || plans.length > 0,
        detail: `${activeRecommendations.length} ข้อเสนอใหม่`,
      },
      {
        label: "อนุมัติ",
        ready: plans.some((plan) =>
          ["approved", "dispatched", "monitoring", "verified"].includes(
            plan.status,
          ),
        ),
        detail: `${plans.filter((plan) => plan.status === "draft").length} รออนุมัติ`,
      },
      {
        label: "ติดตามผล",
        ready: outcomes.length > 0,
        detail: `${outcomes.length} observations`,
      },
    ],
    [
      current?.scope,
      recommendations.length,
      activeRecommendations.length,
      plans,
      outcomes.length,
    ],
  );

  const rebuild = () =>
    run("optimization-rebuild", async () => {
      const result = await api<{
        evaluation: { eligible_scope: boolean; warnings: string[] };
        recommendations: unknown[];
      }>("/optimization/recommendations/rebuild", {
        account_id: account,
      });
      setLastRebuild(
        result.evaluation.eligible_scope
          ? `สร้าง ${result.recommendations.length} ข้อเสนอจาก scope ล่าสุด`
          : result.evaluation.warnings[0] ?? "ข้อมูลยังไม่พอสำหรับข้อเสนอ",
      );
      await workspace.mutate();
    });

  const savePolicy = () =>
    run("optimization-policy", async () => {
      if (!policy) return;
      await api("/optimization/policies", {
        account_id: account,
        policy,
      });
      await workspace.mutate();
    });

  const createPlan = (recommendation: Recommendation) =>
    run(`optimization-plan-${recommendation.id}`, async () => {
      await api(`/optimization/recommendations/${recommendation.id}/plan`, {
        account_id: account,
      });
      await workspace.mutate();
    });

  const dismiss = (recommendation: Recommendation) =>
    run(`optimization-dismiss-${recommendation.id}`, async () => {
      await api(`/optimization/recommendations/${recommendation.id}/dismiss`, {
        account_id: account,
      });
      await workspace.mutate();
    });

  const decide = (plan: Plan, approved: boolean) =>
    run(`optimization-decision-${plan.id}`, async () => {
      await api(`/optimization/plans/${plan.id}/decision`, {
        account_id: account,
        approved,
      });
      await workspace.mutate();
    });

  const observe = (plan: Plan) =>
    run(`optimization-observe-${plan.id}`, async () => {
      await api(`/optimization/plans/${plan.id}/observe`, {
        account_id: account,
      });
      await workspace.mutate();
    });

  const recordOutcome = (plan: Plan, status: "verified" | "failed") =>
    run(`optimization-result-${plan.id}`, async () => {
      await api(`/optimization/plans/${plan.id}/result`, {
        account_id: account,
        status,
        evidence: { source: "operator_review" },
      });
      await workspace.mutate();
    });

  return (
    <div
      className={`optimization-view ${advanced ? "advanced-mode" : "simple-mode"}`}
    >
      <section className="optimization-flow" aria-label="วงจรปรับปรุงโฆษณา">
        <div className="optimization-flow-head">
          <div>
            <span>ขั้นตอนทำงาน</span>
            <strong>ตรวจข้อมูล → ดูสิ่งที่ควรทำ → อนุมัติ → วัดผล</strong>
          </div>
          <Pill
            kind={current?.scope?.coverage === "complete" ? "success" : "warning"}
          >
            {current?.scope?.coverage === "complete"
              ? "พร้อมสร้างข้อเสนอ"
              : "ข้อมูลยังไม่พอสำหรับข้อเสนอ"}
          </Pill>
        </div>
        <ol>
          {stages.map((stage, index) => (
            <li key={stage.label} className={stage.ready ? "ready" : ""}>
              <i>{index + 1}</i>
              <span>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="optimization-scope">
          <div>
            <span>บัญชี</span>
            <strong>{account || "ยังไม่เลือก"}</strong>
          </div>
          <div>
            <span>ช่วงรายงาน</span>
            <strong>
              {current?.scope?.context.date_start ?? "—"} ถึง{" "}
              {current?.scope?.context.date_end ?? "—"}
            </strong>
          </div>
          <div>
            <span>ความพร้อม</span>
            <strong>
              {current?.scope?.coverage === "complete"
                ? "พร้อมวิเคราะห์"
                : "ข้อมูลยังไม่ครบ"}
            </strong>
          </div>
          <div className="optimization-technical">
            <span>History versions</span>
            <strong>{number(current?.hierarchy_versions.ad ?? 0)}</strong>
          </div>
          <button
            className="primary"
            disabled={busy || !account}
            onClick={() => void rebuild()}
          >
            สร้างข้อเสนอใหม่
          </button>
        </div>
        {lastRebuild ? <p role="status">{lastRebuild}</p> : null}
      </section>

      <div className="optimization-layout">
        <div className="optimization-main">
          <Panel
            title="สิ่งที่ควรทำตอนนี้"
            subtitle="เรียงจากเรื่องที่ควรตรวจ ทดลอง หรือปรับปรุงก่อน"
            action={
              <span className="ledger-count">
                {activeRecommendations.length} รายการรอพิจารณา
              </span>
            }
          >
            {workspace.isLoading ? (
              <p className="report-loading">กำลังอ่านข้อเสนอ…</p>
            ) : workspace.error ? (
              <Empty title="เปิด Optimization ไม่ได้">
                {workspace.error.message}
              </Empty>
            ) : recommendations.length ? (
              <div className="decision-ledger">
                {recommendations.slice(0, 20).map((item) => (
                  <article
                    key={item.id}
                    className={`decision-row risk-${item.risk}`}
                  >
                    <div className="decision-marker" aria-hidden="true" />
                    <div className="decision-copy">
                      <span>{actionLabels[item.action] ?? item.action}</span>
                      <h3>{item.title}</h3>
                      <p>{item.rationale}</p>
                      <dl>
                        <div>
                          <dt>Ads</dt>
                          <dd>{item.evidence.name ?? item.entity_id}</dd>
                        </div>
                        <div>
                          <dt>Spend / Results</dt>
                          <dd>
                            {metric(item.evidence.spend, currency)} /{" "}
                            {number(item.evidence.results ?? 0)}
                          </dd>
                        </div>
                        <div>
                          <dt>Cost / result</dt>
                          <dd>{metric(item.evidence.cost_per_result, currency)}</dd>
                        </div>
                        <div>
                          <dt>Median</dt>
                          <dd>
                            {metric(
                              item.evidence.peer_median_cost_per_result,
                              currency,
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="decision-side">
                      <Pill
                        kind={
                          item.risk === "high"
                            ? "error"
                            : item.risk === "medium"
                              ? "warning"
                              : "success"
                        }
                      >
                        {confidenceLabel(item.confidence)} confidence
                      </Pill>
                      <small>ความเสี่ยง {riskLabels[item.risk]}</small>
                      <small>{statusLabels[item.status] ?? item.status}</small>
                      {item.status === "suggested" ? (
                        <div className="button-group">
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => void createPlan(item)}
                          >
                            สร้างแผนดำเนินการ
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void dismiss(item)}
                          >
                            ไม่ใช้
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="ยังไม่มีข้อเสนอ">
                กด “สร้างข้อเสนอจาก Capture ล่าสุด” หลังมี Ads coverage complete
                และมี Ads ที่เทียบกันได้อย่างน้อยตามเกณฑ์ policy
              </Empty>
            )}
          </Panel>

          <Panel
            className="optimization-technical"
            title="Experiment register"
            subtitle="กำหนดสมมติฐานและกลุ่มเทียบก่อนนำผู้ชนะไปสร้าง Campaign ใหม่"
          >
            <form
              className="experiment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run("optimization-experiment", async () => {
                  await api("/optimization/experiments", {
                    account_id: account,
                    name: experimentName.trim(),
                    hypothesis: experimentHypothesis.trim(),
                    objective: "messages",
                    primary_metric: experimentMetric,
                    guardrails: ["Spend", "Frequency", "Delivery errors"],
                    min_spend: policy?.min_spend ?? 50,
                    min_results: policy?.min_results ?? 5,
                    planned_days: 7,
                    arms: [
                      { label: "Control", description: "Ads ที่ใช้งานอยู่" },
                      {
                        label: "Variant A",
                        description: "ข้อเสนอใหม่ที่จะทดสอบ",
                      },
                    ],
                  });
                  setExperimentName("");
                  setExperimentHypothesis("");
                  await workspace.mutate();
                });
              }}
            >
              <label>
                ชื่อการทดลอง
                <input
                  required
                  value={experimentName}
                  onChange={(event) => setExperimentName(event.target.value)}
                  placeholder="เช่น Hook ใหม่สำหรับ Messages"
                />
              </label>
              <label>
                สมมติฐาน
                <textarea
                  required
                  rows={3}
                  value={experimentHypothesis}
                  onChange={(event) =>
                    setExperimentHypothesis(event.target.value)
                  }
                  placeholder="ถ้าเปลี่ยน Hook เป็น..., Cost per Messages จะลดลงโดยไม่ทำให้ Frequency สูงขึ้น"
                />
              </label>
              <label>
                Metric หลัก
                <input
                  value={experimentMetric}
                  onChange={(event) => setExperimentMetric(event.target.value)}
                />
              </label>
              <button className="secondary" disabled={busy || !account}>
                สร้าง Experiment
              </button>
            </form>
            <div className="experiment-list">
              {experiments.map((experiment) => (
                <div key={experiment.id}>
                  <span>
                    <strong>{experiment.name}</strong>
                    <small>
                      {experiment.hypothesis} ·{" "}
                      {experiment.observation_count ?? 0} observations
                    </small>
                  </span>
                  <Pill
                    kind={
                      experiment.status === "running"
                        ? "success"
                        : experiment.status === "completed"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {experiment.status}
                  </Pill>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run("optimization-experiment-status", async () => {
                        await api(
                          `/optimization/experiments/${experiment.id}/status`,
                          {
                            account_id: account,
                            status:
                              experiment.status === "running"
                                ? "completed"
                                : "running",
                          },
                        );
                        await workspace.mutate();
                      })
                    }
                  >
                    {experiment.status === "running" ? "จบการทดลอง" : "เริ่ม"}
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <div className="optimization-memory-grid">
            <Panel
              className="optimization-technical"
              title="Creative memory"
              subtitle="เก็บข้อความและ Creative metadata เพื่อเชื่อมผู้ชนะกับรูปแบบที่ใช้ได้"
            >
              <form
                className="compact-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("optimization-creative", async () => {
                    await api("/optimization/creatives", {
                      account_id: account,
                      ad_id: creativeAdId.trim(),
                      asset_type: "copy",
                      headline: creativeHeadline.trim() || undefined,
                      body: creativeBody.trim() || undefined,
                      cta: creativeCta.trim() || undefined,
                      metadata: { source: "manual" },
                    });
                    setCreativeAdId("");
                    setCreativeHeadline("");
                    setCreativeBody("");
                    setCreativeCta("");
                    await workspace.mutate();
                  });
                }}
              >
                <label>
                  Ad ID
                  <input
                    required
                    inputMode="numeric"
                    value={creativeAdId}
                    onChange={(event) => setCreativeAdId(event.target.value)}
                  />
                </label>
                <label>
                  Headline
                  <input
                    value={creativeHeadline}
                    onChange={(event) => setCreativeHeadline(event.target.value)}
                  />
                </label>
                <label>
                  Primary text
                  <textarea
                    rows={2}
                    value={creativeBody}
                    onChange={(event) => setCreativeBody(event.target.value)}
                  />
                </label>
                <label>
                  CTA
                  <input
                    value={creativeCta}
                    onChange={(event) => setCreativeCta(event.target.value)}
                  />
                </label>
                <button className="secondary">บันทึก Creative metadata</button>
              </form>
              <div className="memory-list">
                {current?.creatives.slice(0, 8).map((creative) => (
                  <div key={creative.id}>
                    <strong>{creative.headline ?? creative.title ?? creative.ad_id}</strong>
                    <small>
                      {creative.ad_id} · {creative.cta ?? "ไม่ระบุ CTA"} ·{" "}
                      {time(creative.updated_at)}
                    </small>
                    <small>
                      Cost/result{" "}
                      {metric(
                        creative.latest_metrics?.cost_per_result,
                        currency,
                      )}{" "}
                      · {creative.latest_status ?? "ไม่ทราบสถานะ"}
                    </small>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              className="optimization-technical"
              title="Campaign templates"
              subtitle="โครงตั้งต้นสำหรับ Clone & mutate; ยังไม่ publish จากหน้านี้"
            >
              <form
                className="compact-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("optimization-template", async () => {
                    await api("/optimization/templates", {
                      account_id: account,
                      name: templateName.trim(),
                      goal: templateGoal,
                      config: {
                        daily_budget:
                          templateBudget.trim() === ""
                            ? null
                            : Number(templateBudget),
                        create_as_paused: true,
                        require_experiment: true,
                      },
                    });
                    setTemplateName("");
                    setTemplateBudget("");
                    await workspace.mutate();
                  });
                }}
              >
                <label>
                  ชื่อ Template
                  <input
                    required
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                  />
                </label>
                <label>
                  เป้าหมาย
                  <select
                    value={templateGoal}
                    onChange={(event) => setTemplateGoal(event.target.value)}
                  >
                    <option value="messages">Messages</option>
                    <option value="sales">Sales</option>
                    <option value="leads">Leads</option>
                  </select>
                </label>
                <label>
                  งบรายวันเริ่มต้น
                  <input
                    type="number"
                    min="0"
                    value={templateBudget}
                    onChange={(event) => setTemplateBudget(event.target.value)}
                  />
                </label>
                <button className="secondary">สร้าง Template</button>
              </form>
              <div className="memory-list">
                {current?.templates.slice(0, 8).map((template) => (
                  <div key={template.id}>
                    <strong>{template.name}</strong>
                    <small>
                      {template.goal} · งบ{" "}
                      {template.config.daily_budget === null
                        ? "ยังไม่กำหนด"
                        : metric(template.config.daily_budget, currency)}
                    </small>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <aside className="optimization-rail">
          <Panel
            className="optimization-technical"
            title="Policy & guardrails"
            subtitle="เกณฑ์บังคับก่อนสร้างข้อเสนอ"
          >
            {policy ? (
              <form
                className="optimization-policy"
                onSubmit={(event) => {
                  event.preventDefault();
                  void savePolicy();
                }}
              >
                <label>
                  ผลลัพธ์ขั้นต่ำต่อ Ads
                  <input
                    type="number"
                    min="1"
                    value={policy.min_results}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        min_results: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Spend ขั้นต่ำ
                  <input
                    type="number"
                    min="0"
                    value={policy.min_spend}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        min_spend: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Ads เทียบขั้นต่ำ
                  <input
                    type="number"
                    min="2"
                    value={policy.min_peer_rows}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        min_peer_rows: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Scale เมื่อต้นทุน ≤ median ×
                  <input
                    type="number"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={policy.scale_ratio}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        scale_ratio: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Pause เมื่อต้นทุน ≥ median ×
                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="0.05"
                    value={policy.pause_ratio}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        pause_ratio: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  เปลี่ยนงบสูงสุด (%)
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={policy.max_budget_change_pct}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        max_budget_change_pct: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="report-check">
                  <input
                    type="checkbox"
                    checked={policy.require_experiment_for_new}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        require_experiment_for_new: event.target.checked,
                      })
                    }
                  />
                  บังคับ Experiment ก่อนสร้างใหม่
                </label>
                <button className="secondary" disabled={busy}>
                  บันทึก Guardrails
                </button>
              </form>
            ) : null}
            <Note>
              ข้อเสนอเป็น deterministic จาก coverage และผลลัพธ์ที่ยืนยัน
              ไม่ใช่คำรับประกันผลลัพธ์หรือคำแนะนำให้ปรับงบอัตโนมัติ
            </Note>
          </Panel>

          <Panel
            title="Plans & outcomes"
            subtitle="อนุมัติแผนในระบบก่อน แล้วจึงทำผ่าน Local Approval"
            action={
              <button className="text-button" onClick={onOpenControl}>
                เปิดหน้าควบคุม
              </button>
            }
          >
            <div className="plan-ledger">
              {plans.length ? (
                plans.slice(0, 12).map((plan) => (
                  <article key={plan.id}>
                    <div>
                      <span>{statusLabels[plan.status] ?? plan.status}</span>
                      <strong>{plan.title}</strong>
                      <small>สร้าง {time(plan.created_at)}</small>
                      <small>
                        Rollback {plan.rollbacks?.length ?? 0} · Receipt{" "}
                        {plan.receipts?.length ?? 0}
                      </small>
                    </div>
                    <ol>
                      {plan.steps.map((step) => (
                        <li key={step.id}>
                          <span>{actionLabels[step.action] ?? step.action}</span>
                          <small>
                            Ads {step.target} ·{" "}
                            {statusLabels[step.status] ?? step.status}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {plan.status === "draft" ? (
                      <div className="button-group">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void decide(plan, true)}
                        >
                          อนุมัติแผน
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void decide(plan, false)}
                        >
                          ปฏิเสธ
                        </button>
                      </div>
                    ) : null}
                    {["approved", "dispatched", "monitoring"].includes(
                      plan.status,
                    ) ? (
                      <div className="button-group">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void observe(plan)}
                        >
                          ตรวจผลจาก Capture ล่าสุด
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void recordOutcome(plan, "failed")}
                        >
                          บันทึกว่าไม่ผ่าน
                        </button>
                        {plan.status === "monitoring" ? (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void recordOutcome(plan, "verified")}
                          >
                            ยืนยันว่าผ่าน
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="muted">ยังไม่มีแผน</p>
              )}
            </div>
            <div className="outcome-strip">
              {outcomes.slice(0, 4).map((outcome) => (
                <div key={outcome.id}>
                  <strong>{outcome.entity_id}</strong>
                  <span>
                    Cost delta{" "}
                    {metric(outcome.delta.cost_per_result, currency)}
                  </span>
                  <small>{time(outcome.captured_at)}</small>
                </div>
              ))}
            </div>
            <div className="capability-note">
              <strong>
                {current?.capability.automated_meta_mutation
                  ? "พร้อมส่งคำสั่งอัตโนมัติ"
                  : "ยังไม่เปิด Meta mutation อัตโนมัติ"}
              </strong>
              <span>{current?.capability.reason}</span>
            </div>
          </Panel>
        </aside>
      </div>
      {highRisk ? (
        <div className="optimization-risk-note" role="note">
          มีข้อเสนอความเสี่ยงสูง {highRisk} รายการ ระบบจะไม่สร้างหรือเผยแพร่
          โฆษณาโดยไม่มีการตรวจและอนุมัติจากผู้ใช้
        </div>
      ) : null}
    </div>
  );
}
