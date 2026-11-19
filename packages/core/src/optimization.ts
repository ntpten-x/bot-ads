import { z } from "zod";
import {
  nonPerformanceDeliveries,
  type AnalyzedRow,
  type LevelAnalysis,
} from "./capture-analysis";

export const optimizationPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    min_results: z.number().int().min(1).max(100_000).default(5),
    min_spend: z.number().nonnegative().max(100_000_000).default(50),
    min_peer_rows: z.number().int().min(2).max(100).default(3),
    scale_ratio: z.number().min(0.1).max(1).default(0.75),
    pause_ratio: z.number().min(1).max(10).default(1.3),
    max_budget_change_pct: z.number().int().min(1).max(100).default(20),
    require_experiment_for_new: z.boolean().default(true),
    allow_create_campaign_draft: z.boolean().default(true),
  })
  .strict();

export type OptimizationPolicy = z.infer<typeof optimizationPolicySchema>;

export const defaultOptimizationPolicy: OptimizationPolicy =
  optimizationPolicySchema.parse({});

export const optimizationActions = [
  "scale_budget",
  "pause_candidate",
  "duplicate_winner",
  "create_new_test",
  "keep_observing",
] as const;

export type OptimizationAction = (typeof optimizationActions)[number];
export type OptimizationRisk = "low" | "medium" | "high";

export type OptimizationRecommendationDraft = {
  source_key: string;
  entity_type: "ad";
  entity_id: string;
  action: OptimizationAction;
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  confidence: number;
  risk: OptimizationRisk;
  expected_impact: Record<string, unknown>;
};

export type OptimizationEvaluation = {
  eligible_scope: boolean;
  result_type: string | null;
  peers: number;
  median_cost_per_result: number | null;
  recommendations: OptimizationRecommendationDraft[];
  warnings: string[];
};

const money = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2,
  }).format(value);

function eligibleRows(level: LevelAnalysis, policy: OptimizationPolicy) {
  return level.rows.filter(
    (row) =>
      row.entity_id !== null &&
      row.mapping === "verified" &&
      !nonPerformanceDeliveries.has(row.delivery) &&
      row.results !== null &&
      row.results >= policy.min_results &&
      row.cost_per_result !== null &&
      row.spend_source === "column",
  );
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function confidenceFor(
  row: AnalyzedRow,
  peers: number,
  ratio: number,
  policy: OptimizationPolicy,
  coverageComplete: boolean,
) {
  const peerFactor = Math.min(1, peers / Math.max(policy.min_peer_rows * 2, 4));
  const sampleFactor = Math.min(
    1,
    (row.results ?? 0) / Math.max(policy.min_results * 4, 20),
  );
  const differenceFactor = Math.min(1, Math.abs(ratio - 1) / 0.5);
  const qualityFactor = coverageComplete ? 1 : 0.55;
  return Math.round(
    Math.min(
      0.95,
      (0.35 + peerFactor * 0.25 + sampleFactor * 0.2 + differenceFactor * 0.15) *
        qualityFactor,
    ) * 100,
  ) / 100;
}

function rowEvidence(
  row: AnalyzedRow,
  resultType: string,
  medianCost: number | null,
  ratio: number | null,
) {
  return {
    entity_id: row.entity_id,
    name: row.name,
    delivery: row.delivery,
    spend: row.spend,
    results: row.results,
    impressions: row.impressions,
    cost_per_result: row.cost_per_result,
    result_type: resultType,
    peer_median_cost_per_result: medianCost,
    cost_ratio_to_median: ratio,
    budget: row.budget,
    occurrences: row.occurrences,
    mapping: row.mapping,
  };
}

/**
 * Deterministic recommendation policy. This intentionally does not use an LLM:
 * every recommendation must be reproducible from a complete report scope,
 * a common result type and a user-controlled policy.
 */
export function buildOptimizationRecommendations(
  level: LevelAnalysis,
  policyInput: Partial<OptimizationPolicy> = {},
): OptimizationEvaluation {
  const policy = optimizationPolicySchema.parse(policyInput);
  const warnings: string[] = [];
  if (!policy.enabled)
    return {
      eligible_scope: false,
      result_type: null,
      peers: 0,
      median_cost_per_result: null,
      recommendations: [],
      warnings: ["Optimization policy is disabled"],
    };
  if (level.coverage !== "complete")
    warnings.push("Ads coverage must be complete before producing actions");
  if (level.blockers.length)
    warnings.push(`Blocked evidence: ${level.blockers.join(", ")}`);
  const main = level.result_groups[0];
  if (!main)
    return {
      eligible_scope: false,
      result_type: null,
      peers: 0,
      median_cost_per_result: null,
      recommendations: [],
      warnings: [...warnings, "No comparable result group"],
    };
  const rows = eligibleRows(level, policy).filter(
    (row) => row.result_type === main.result_type,
  );
  const medianCost = median(
    rows.map((row) => row.cost_per_result!),
  );
  const eligibleScope =
    level.coverage === "complete" &&
    level.blockers.length === 0 &&
    rows.length >= policy.min_peer_rows &&
    medianCost !== null;
  if (!eligibleScope)
    return {
      eligible_scope: false,
      result_type: main.result_type,
      peers: rows.length,
      median_cost_per_result: medianCost,
      recommendations: [],
      warnings: [
        ...warnings,
        `Need at least ${policy.min_peer_rows} Ads with ${policy.min_results}+ results and verified costs`,
      ],
    };

  const recommendations: OptimizationRecommendationDraft[] = [];
  for (const row of rows) {
    const cost = row.cost_per_result!;
    const ratio = cost / medianCost!;
    const confidence = confidenceFor(
      row,
      rows.length,
      ratio,
      policy,
      level.coverage === "complete",
    );
    const evidence = rowEvidence(row, main.result_type, medianCost, ratio);
    if (ratio <= policy.scale_ratio) {
      const currentBudget =
        row.budget.amount !== null && row.budget.amount > 0
          ? row.budget.amount
          : null;
      const action: OptimizationAction = currentBudget
        ? "scale_budget"
        : "duplicate_winner";
      recommendations.push({
        source_key: `${row.entity_id}:${action}`,
        entity_type: "ad",
        entity_id: row.entity_id!,
        action,
        title:
          action === "scale_budget"
            ? "เพิ่มงบแบบมีขอบเขตจากผลลัพธ์ที่เหนือค่ากลาง"
            : "โคลนผู้ชนะไปทดสอบในชุดใหม่",
        rationale: `ต้นทุนต่อผลลัพธ์ ${money(cost)} ต่ำกว่าค่ากลาง ${money(medianCost!)} ภายในผลลัพธ์ประเภท ${main.result_type}`,
        evidence,
        confidence,
        risk: currentBudget ? "medium" : "low",
        expected_impact: {
          current_budget: currentBudget,
          budget_period: row.budget.period,
          suggested_max_change_pct: policy.max_budget_change_pct,
          basis: "observed_cost_efficiency_not_guaranteed_lift",
        },
      });
      continue;
    }
    if (ratio >= policy.pause_ratio) {
      recommendations.push({
        source_key: `${row.entity_id}:pause_candidate`,
        entity_type: "ad",
        entity_id: row.entity_id!,
        action: "pause_candidate",
        title: "ตรวจสอบก่อนหยุด Ads ที่ต้นทุนสูง",
        rationale: `ต้นทุนต่อผลลัพธ์ ${money(cost)} สูงกว่าค่ากลาง ${money(medianCost!)} อย่างน้อย ${Math.round((ratio - 1) * 100)}%`,
        evidence,
        confidence,
        risk: "medium",
        expected_impact: {
          action: "pause_after_local_review",
          estimated_cost_reduction: "unknown_until_budget_and_volume_reviewed",
        },
      });
      continue;
    }
    if (row.delivery === "off" || row.delivery === "parent_off") {
      recommendations.push({
        source_key: `${row.entity_id}:duplicate_winner`,
        entity_type: "ad",
        entity_id: row.entity_id!,
        action: "duplicate_winner",
        title: "ทดสอบ Ads ที่ปิดอยู่แต่ต้นทุนยังดี",
        rationale: `Ads ปิดอยู่แต่ต้นทุนต่อผลลัพธ์ ${money(cost)} ไม่สูงกว่าค่ากลาง ${money(medianCost!)}`,
        evidence,
        confidence,
        risk: "low",
        expected_impact: {
          suggested_action: "clone_as_paused_draft_for_experiment",
        },
      });
      continue;
    }
    recommendations.push({
      source_key: `${row.entity_id}:create_new_test`,
      entity_type: "ad",
      entity_id: row.entity_id!,
      action: "create_new_test",
      title: "ใช้ Ads นี้เป็นฐานสำหรับ Variant ใหม่",
      rationale: `Ads อยู่ในช่วงกลางของกลุ่ม แต่มีผลลัพธ์ ${row.results} เพียงพอสำหรับสร้างสมมติฐานทดสอบ`,
      evidence,
      confidence: Math.min(confidence, 0.65),
      risk: policy.require_experiment_for_new ? "low" : "medium",
      expected_impact: {
        require_experiment: policy.require_experiment_for_new,
        suggested_variant_dimensions: ["hook", "headline", "creative_format"],
      },
    });
  }
  const priority: Record<OptimizationAction, number> = {
    pause_candidate: 0,
    scale_budget: 1,
    duplicate_winner: 2,
    create_new_test: 3,
    keep_observing: 4,
  };
  recommendations.sort(
    (left, right) =>
      priority[left.action] - priority[right.action] ||
      right.confidence - left.confidence ||
      Number(right.evidence.cost_ratio_to_median ?? 0) -
        Number(left.evidence.cost_ratio_to_median ?? 0),
  );
  return {
    eligible_scope: true,
    result_type: main.result_type,
    peers: rows.length,
    median_cost_per_result: medianCost,
    recommendations: recommendations.slice(0, 50),
    warnings,
  };
}
