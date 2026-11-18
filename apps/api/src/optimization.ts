import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type {
  AnalyzedRow,
  LevelAnalysis,
} from "../../../packages/core/src/capture-analysis.js";
import {
  buildOptimizationRecommendations,
  defaultOptimizationPolicy,
  optimizationActions,
  optimizationPolicySchema,
  type OptimizationRecommendationDraft,
} from "../../../packages/core/src/optimization.js";
import { assertManagedAccountEnabled } from "./accounts.js";

type StoredAnalysis = { levels?: LevelAnalysis[] };

const accountSchema = z.string().regex(/^\d+$/);
const jobSchema = z.uuid();

function coverageRank(level: LevelAnalysis) {
  return (
    (level.coverage === "complete" ? 1000 : level.coverage === "lower_bound" ? 500 : 0) +
    level.verified_unique_rows -
    level.blockers.length * 10
  );
}

async function loadReportScope(
  pool: Pool,
  account: string,
  requestedJob?: string,
  requestedScope?: string,
) {
  const job = requestedJob
    ? (
        await pool.query(
          `SELECT id,status,first_seen_at,updated_at,extension_version
           FROM capture_jobs WHERE id=$1 AND account_id=$2`,
          [requestedJob, account],
        )
      ).rows[0]
    : (
        await pool.query(
          `SELECT j.id,j.status,j.first_seen_at,j.updated_at,j.extension_version
           FROM capture_jobs j
           WHERE j.account_id=$1
             AND EXISTS(SELECT 1 FROM capture_job_reports r WHERE r.job_id=j.id)
           ORDER BY j.updated_at DESC
           LIMIT 1`,
          [account],
        )
      ).rows[0];
  if (!job) return null;
  const reports = await pool.query(
    `SELECT analysis,updated_at FROM capture_job_reports
     WHERE job_id=$1 ORDER BY updated_at DESC`,
    [job.id],
  );
  const levels = reports.rows
    .flatMap((row) => (row.analysis as StoredAnalysis)?.levels ?? [])
    .filter(
      (level) =>
        level.level === "ads" &&
        (!requestedScope || level.scope_key === requestedScope),
    )
    .sort((left, right) => coverageRank(right) - coverageRank(left));
  const level = levels[0];
  if (!level) return null;
  return { job, level };
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function auditOptimization(
  pool: Pool,
  req: unknown,
  account: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  const auth =
    (
      req as {
        auth?: {
          kind?: string;
          id?: string | null;
          customer_id?: string | null;
        };
      }
    ).auth ?? {};
  const customer =
    auth.customer_id ??
    (
      await pool.query(
        "SELECT customer_id FROM managed_accounts WHERE account_id=$1",
        [account],
      )
    ).rows[0]?.customer_id ??
    null;
  await pool.query(
    `INSERT INTO admin_audit_log(
       id,actor_kind,actor_client_id,customer_id,action,target,details
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      auth.kind ?? "system",
      auth.kind === "client" ? (auth.id ?? null) : null,
      customer,
      action,
      target,
      JSON.stringify({ account_id: account, ...details }),
    ],
  );
}

function planSteps(action: string, recommendation: Record<string, any>) {
  if (action === "scale_budget")
    return [
      {
        action: "budget_change",
        target: recommendation.entity_id,
        payload: {
          entity_type: recommendation.entity_type,
          max_change_pct:
            recommendation.expected_impact?.suggested_max_change_pct ?? 20,
          current_budget: recommendation.expected_impact?.current_budget ?? null,
          budget_period: recommendation.expected_impact?.budget_period ?? null,
        },
      },
    ];
  if (action === "pause_candidate")
    return [
      {
        action: "pause_ad",
        target: recommendation.entity_id,
        payload: {
          entity_type: recommendation.entity_type,
          rationale: recommendation.rationale,
        },
      },
    ];
  if (action === "duplicate_winner")
    return [
      {
        action: "duplicate_ad",
        target: recommendation.entity_id,
        payload: {
          entity_type: recommendation.entity_type,
          create_as_paused: true,
          source_evidence: recommendation.evidence,
        },
      },
    ];
  if (action === "create_new_test")
    return [
      {
        action: "create_campaign_draft",
        target: recommendation.entity_id,
        payload: {
          source_entity_type: recommendation.entity_type,
          require_experiment: true,
          suggested_dimensions:
            recommendation.expected_impact?.suggested_variant_dimensions ?? [],
        },
      },
    ];
  return [];
}

function rollbackFor(step: { action: string; target: string; payload: any }) {
  if (step.action === "pause_ad")
    return { action: "resume_ad", target: step.target, payload: {} };
  if (step.action === "budget_change")
    return {
      action: "restore_budget",
      target: step.target,
      payload: {
        previous_budget: step.payload?.current_budget ?? null,
        budget_period: step.payload?.budget_period ?? null,
      },
    };
  if (step.action === "duplicate_ad")
    return {
      action: "pause_created_copy",
      target: step.target,
      payload: { note: "Pause the newly created draft after verifying its ID" },
    };
  if (step.action === "create_campaign_draft")
    return {
      action: "cancel_new_draft",
      target: step.target,
      payload: { note: "Keep the new campaign paused or delete it after review" },
    };
  return null;
}

async function getPlan(pool: Pool, account: string, planId: string) {
  const plan = await pool.query(
    `SELECT * FROM optimization_plans WHERE id=$1 AND account_id=$2`,
    [planId, account],
  );
  if (!plan.rowCount) return null;
  const steps = await pool.query(
    `SELECT * FROM optimization_steps WHERE plan_id=$1 ORDER BY sequence`,
    [planId],
  );
  const [receipts, rollbacks] = await Promise.all([
    pool.query(
      "SELECT * FROM action_receipts WHERE plan_id=$1 ORDER BY created_at DESC",
      [planId],
    ),
    pool.query(
      "SELECT * FROM rollback_plans WHERE plan_id=$1 ORDER BY created_at DESC",
      [planId],
    ),
  ]);
  return {
    ...plan.rows[0],
    steps: steps.rows,
    receipts: receipts.rows,
    rollbacks: rollbacks.rows,
  };
}

async function syncIntelligenceAssets(
  pool: Pool,
  account: string,
  jobId: string,
  scope: LevelAnalysis,
) {
  for (const row of scope.rows) {
    if (!row.entity_id) continue;
    const observedAt =
      row.provenance.at(-1)?.captured_at ?? new Date().toISOString();
    await pool.query(
      `INSERT INTO entity_versions(
         id,version_key,account_id,level,entity_id,observed_at,name,status,
         metrics,source,job_id,evidence
       ) VALUES($1,$2,$3,'ad',$4,$5,$6,$7,$8,'report_cache',$9,$10)
       ON CONFLICT(version_key) DO NOTHING`,
      [
        randomUUID(),
        fingerprint([account, jobId, scope.scope_key, row.entity_id]),
        account,
        row.entity_id,
        observedAt,
        row.name,
        row.delivery,
        JSON.stringify({
          spend: row.spend,
          results: row.results,
          impressions: row.impressions,
          cost_per_result: row.cost_per_result,
          cpm: row.cpm,
          budget: row.budget,
        }),
        jobId,
        JSON.stringify({
          scope_key: scope.scope_key,
          result_type: row.result_type,
          provenance: row.provenance,
          flags: row.flags,
        }),
      ],
    );
  }
  const creatives = await pool.query(
    `SELECT a.id AS ad_id,a.name,a.ad_set_id,s.name AS ad_set_name,
            s.campaign_id,camp.name AS campaign_name,c.details
     FROM ads a
     JOIN ad_sets s ON s.account_id=a.account_id AND s.id=a.ad_set_id
     JOIN campaigns camp ON camp.account_id=s.account_id AND camp.id=s.campaign_id
     LEFT JOIN ad_creatives c ON c.account_id=a.account_id AND c.ad_id=a.id
     WHERE a.account_id=$1
       AND a.id = ANY($2::text[])`,
    [account, scope.rows.flatMap((row) => row.entity_id ?? [])],
  );
  for (const creative of creatives.rows) {
    for (const parent of [
      {
        level: "campaign",
        entity_id: creative.campaign_id,
        name: creative.campaign_name,
        parent_ids: {},
      },
      {
        level: "adset",
        entity_id: creative.ad_set_id,
        name: creative.ad_set_name,
        parent_ids: { campaign_id: creative.campaign_id },
      },
    ]) {
      await pool.query(
        `INSERT INTO entity_versions(
           id,version_key,account_id,level,entity_id,observed_at,name,status,
           parent_ids,metrics,source,job_id,evidence
         ) VALUES($1,$2,$3,$4,$5,now(),$6,NULL,$7,'{}','hierarchy',$8,$9)
         ON CONFLICT(version_key) DO NOTHING`,
        [
          randomUUID(),
          fingerprint([account, jobId, scope.scope_key, parent.level, parent.entity_id]),
          account,
          parent.level,
          parent.entity_id,
          parent.name,
          JSON.stringify(parent.parent_ids),
          jobId,
          JSON.stringify({ ad_id: creative.ad_id }),
        ],
      );
    }
    const details = creative.details ?? {};
    await pool.query(
      `INSERT INTO creative_assets(
         id,account_id,ad_id,asset_type,title,body,headline,cta,
         media_hash,metadata,provenance
       ) VALUES($1,$2,$3,'copy',$4,$5,$6,$7,'metadata',$8,$9)
       ON CONFLICT(account_id,ad_id,asset_type,media_hash) DO UPDATE SET
         title=COALESCE(excluded.title,creative_assets.title),
         body=COALESCE(excluded.body,creative_assets.body),
         headline=COALESCE(excluded.headline,creative_assets.headline),
         cta=COALESCE(excluded.cta,creative_assets.cta),
         metadata=creative_assets.metadata || excluded.metadata,
         provenance=creative_assets.provenance || excluded.provenance,
         updated_at=now()`,
      [
        randomUUID(),
        account,
        creative.ad_id,
        creative.name,
        details.body ?? null,
        details.headline ?? null,
        details.cta ?? null,
        JSON.stringify(details),
        JSON.stringify({ source: "ad_creatives", job_id: jobId }),
      ],
    );
  }
}

export function optimizationRoutes(pool: Pool) {
  const router = Router();

  router.get("/optimization/policies", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const result = await pool.query(
      "SELECT data,updated_at FROM optimization_policies WHERE account_id=$1",
      [account],
    );
    let policy = defaultOptimizationPolicy;
    if (result.rowCount) {
      const parsed = optimizationPolicySchema.safeParse(result.rows[0].data);
      if (parsed.success) policy = parsed.data;
    }
    res.json({
      account_id: account,
      policy,
      updated_at: result.rows[0]?.updated_at ?? null,
    });
  });

  router.post("/optimization/policies", async (req, res) => {
    const body = z
      .object({
        account_id: accountSchema,
        policy: optimizationPolicySchema,
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const result = await pool.query(
      `INSERT INTO optimization_policies(account_id,data)
       VALUES($1,$2)
       ON CONFLICT(account_id) DO UPDATE SET data=excluded.data,updated_at=now()
       RETURNING updated_at`,
      [body.account_id, JSON.stringify(body.policy)],
    );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_policy_updated",
      body.account_id,
      body.policy,
    );
    res.json({
      account_id: body.account_id,
      policy: body.policy,
      updated_at: result.rows[0].updated_at,
    });
  });

  router.post("/optimization/recommendations/rebuild", async (req, res) => {
    const body = z
      .object({
        account_id: accountSchema,
        job_id: jobSchema.optional(),
        scope_key: z.string().max(5000).optional(),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const selected = await loadReportScope(
      pool,
      body.account_id,
      body.job_id,
      body.scope_key,
    );
    if (!selected) {
      res.status(409).json({
        error:
          "No cached Ads report scope is ready. Materialize a capture before rebuilding recommendations.",
      });
      return;
    }
    const policyResult = await pool.query(
      "SELECT data FROM optimization_policies WHERE account_id=$1",
      [body.account_id],
    );
    const parsedPolicy = optimizationPolicySchema.safeParse(
      policyResult.rows[0]?.data,
    );
    const policy = parsedPolicy.success
      ? parsedPolicy.data
      : defaultOptimizationPolicy;
    const evaluation = buildOptimizationRecommendations(selected.level, policy);
    await syncIntelligenceAssets(
      pool,
      body.account_id,
      selected.job.id,
      selected.level,
    );
    const stored = [];
    for (const recommendation of evaluation.recommendations) {
      const scopedSourceKey = `${selected.level.scope_key}:${recommendation.source_key}`;
      const result = await pool.query(
        `INSERT INTO optimization_recommendations(
           id,account_id,job_id,scope_key,source_key,entity_type,entity_id,
           action,title,rationale,evidence,confidence,risk,expected_impact,status
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'suggested')
         ON CONFLICT(account_id,source_key) DO UPDATE SET
           job_id=excluded.job_id,
           scope_key=excluded.scope_key,
           title=excluded.title,
           rationale=excluded.rationale,
           evidence=excluded.evidence,
           confidence=excluded.confidence,
           risk=excluded.risk,
           expected_impact=excluded.expected_impact,
           status=CASE
             WHEN optimization_recommendations.status IN ('suggested','stale')
               THEN 'suggested'
             ELSE optimization_recommendations.status
           END,
           updated_at=now()
         RETURNING *`,
        [
          randomUUID(),
          body.account_id,
          selected.job.id,
          selected.level.scope_key,
          scopedSourceKey,
          recommendation.entity_type,
          recommendation.entity_id,
          recommendation.action,
          recommendation.title,
          recommendation.rationale,
          JSON.stringify(recommendation.evidence),
          recommendation.confidence,
          recommendation.risk,
          JSON.stringify(recommendation.expected_impact),
        ],
      );
      stored.push(result.rows[0]);
    }
    const sourceKeys = evaluation.recommendations.map(
      (recommendation) =>
        `${selected.level.scope_key}:${recommendation.source_key}`,
    );
    await pool.query(
      `UPDATE optimization_recommendations
       SET status='stale',updated_at=now()
       WHERE account_id=$1 AND job_id=$2 AND scope_key=$3
         AND status='suggested'
         AND NOT (source_key = ANY($4::text[]))`,
      [body.account_id, selected.job.id, selected.level.scope_key, sourceKeys],
    );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_recommendations_rebuilt",
      selected.job.id,
      {
        scope_key: selected.level.scope_key,
        eligible_scope: evaluation.eligible_scope,
        recommendations: stored.length,
      },
    );
    res.json({
      account_id: body.account_id,
      job: selected.job,
      scope: {
        scope_key: selected.level.scope_key,
        coverage: selected.level.coverage,
        blockers: selected.level.blockers,
        verified_ads: selected.level.verified_unique_rows,
        context: selected.level.context,
      },
      evaluation: {
        eligible_scope: evaluation.eligible_scope,
        result_type: evaluation.result_type,
        peers: evaluation.peers,
        median_cost_per_result: evaluation.median_cost_per_result,
        warnings: evaluation.warnings,
      },
      recommendations: stored,
    });
  });

  router.get("/optimization/recommendations", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const status = z
      .string()
      .max(30)
      .optional()
      .parse(req.query.status || undefined);
    const result = await pool.query(
      `SELECT * FROM optimization_recommendations
       WHERE account_id=$1 AND ($2::text IS NULL OR status=$2)
       ORDER BY updated_at DESC LIMIT 200`,
      [account, status ?? null],
    );
    res.json(result.rows);
  });

  router.post(
    "/optimization/recommendations/:id/dismiss",
    async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const body = z
        .object({ account_id: accountSchema, note: z.string().max(1000).optional() })
        .strict()
        .parse(req.body);
      await assertManagedAccountEnabled(pool, body.account_id);
      const result = await pool.query(
        `UPDATE optimization_recommendations
         SET status='dismissed',updated_at=now()
         WHERE id=$1 AND account_id=$2 AND status IN ('suggested','stale')
         RETURNING *`,
        [id, body.account_id],
      );
      if (!result.rowCount) {
        res.status(409).json({ error: "Recommendation cannot be dismissed" });
        return;
      }
      await auditOptimization(
        pool,
        req,
        body.account_id,
        "optimization_recommendation_dismissed",
        id,
        { note: body.note ?? null },
      );
      res.json(result.rows[0]);
    },
  );

  router.post(
    "/optimization/recommendations/:id/plan",
    async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const body = z
        .object({
          account_id: accountSchema,
          note: z.string().max(2000).optional(),
        })
        .strict()
        .parse(req.body);
      await assertManagedAccountEnabled(pool, body.account_id);
      const recommendation = await pool.query(
        `SELECT * FROM optimization_recommendations
         WHERE id=$1 AND account_id=$2 AND status IN ('suggested','planned')`,
        [id, body.account_id],
      );
      if (!recommendation.rowCount) {
        res.status(404).json({ error: "Recommendation not found" });
        return;
      }
      const rec = recommendation.rows[0];
      if (rec.action === "create_new_test" && rec.risk === "high") {
        res.status(409).json({
          error: "High-risk campaign creation requires a separate policy review",
        });
        return;
      }
      const steps = planSteps(rec.action, rec);
      if (!steps.length) {
        res.status(409).json({ error: "This recommendation has no executable plan" });
        return;
      }
      const planId = randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO optimization_plans(
             id,account_id,recommendation_id,title,objective,status,
             policy_snapshot,evidence,note
           )
           SELECT $1,$2,$3,$4,$5,'draft',COALESCE(p.data,$6),$7,$8
           FROM optimization_recommendations r
           LEFT JOIN optimization_policies p ON p.account_id=r.account_id
           WHERE r.id=$3`,
          [
            planId,
            body.account_id,
            id,
            rec.title,
            rec.action,
            JSON.stringify(defaultOptimizationPolicy),
            JSON.stringify({ recommendation: rec }),
            body.note ?? null,
          ],
        );
        for (const [index, step] of steps.entries()) {
          await client.query(
            `INSERT INTO optimization_steps(
               id,plan_id,sequence,action,target,payload,status,requires_approval
             ) VALUES($1,$2,$3,$4,$5,$6,'pending',true)`,
            [
              randomUUID(),
              planId,
              index + 1,
              step.action,
              step.target,
              JSON.stringify(step.payload),
            ],
          );
          const rollback = rollbackFor(step);
          if (rollback)
            await client.query(
              `INSERT INTO rollback_plans(id,plan_id,action,payload)
               VALUES($1,$2,$3,$4)`,
              [
                randomUUID(),
                planId,
                rollback.action,
                JSON.stringify(rollback),
              ],
            );
        }
        await client.query(
          `UPDATE optimization_recommendations
           SET status='planned',updated_at=now() WHERE id=$1`,
          [id],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await auditOptimization(
        pool,
        req,
        body.account_id,
        "optimization_plan_created",
        planId,
        { recommendation_id: id, action: rec.action },
      );
      res.status(201).json(await getPlan(pool, body.account_id, planId));
    },
  );

  router.get("/optimization/plans", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const result = await pool.query(
      `SELECT p.*,COALESCE(
         jsonb_agg(jsonb_build_object(
           'id',s.id,'sequence',s.sequence,'action',s.action,'target',s.target,
           'payload',s.payload,'status',s.status,
           'requires_approval',s.requires_approval,
           'command_id',s.command_id,'result',s.result
         ) ORDER BY s.sequence) FILTER (WHERE s.id IS NOT NULL),
         '[]'::jsonb
       ) AS steps,
       (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
        FROM action_receipts r WHERE r.plan_id=p.id) AS receipts,
       (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
        FROM rollback_plans r WHERE r.plan_id=p.id) AS rollbacks
       FROM optimization_plans p
       LEFT JOIN optimization_steps s ON s.plan_id=p.id
       WHERE p.account_id=$1
       GROUP BY p.id
       ORDER BY p.created_at DESC LIMIT 100`,
      [account],
    );
    res.json(result.rows);
  });

  router.post("/optimization/plans/:id/decision", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z
      .object({
        account_id: accountSchema,
        approved: z.boolean(),
        note: z.string().max(2000).optional(),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const result = await pool.query(
      `UPDATE optimization_plans SET
         status=$3,
         note=COALESCE($4,note),
         approved_at=CASE WHEN $3='approved' THEN now() ELSE approved_at END,
         updated_at=now()
       WHERE id=$1 AND account_id=$2 AND status='draft'
       RETURNING *`,
      [
        id,
        body.account_id,
        body.approved ? "approved" : "rejected",
        body.note ?? null,
      ],
    );
    if (!result.rowCount) {
      res.status(409).json({ error: "Only draft plans can be decided" });
      return;
    }
    await pool.query(
      `UPDATE optimization_steps SET status=$2
       WHERE plan_id=$1 AND status='pending'`,
      [id, body.approved ? "ready_for_local_review" : "skipped"],
    );
    if (!body.approved && result.rows[0].recommendation_id)
      await pool.query(
        "UPDATE optimization_recommendations SET status='suggested',updated_at=now() WHERE id=$1",
        [result.rows[0].recommendation_id],
      );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      body.approved ? "optimization_plan_approved" : "optimization_plan_rejected",
      id,
      { note: body.note ?? null },
    );
    res.json(await getPlan(pool, body.account_id, id));
  });

  router.post("/optimization/plans/:id/result", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z
      .object({
        account_id: accountSchema,
        status: z.enum(["verified", "failed"]),
        note: z.string().max(2000).optional(),
        evidence: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const plan = await getPlan(pool, body.account_id, id);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    const firstStep = plan.steps[0];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE optimization_steps SET status=$2,verified_at=now()
         WHERE id=$1`,
        [firstStep?.id, body.status],
      );
      await client.query(
        `INSERT INTO action_receipts(
           id,plan_id,step_id,before_state,after_state,verification,evidence
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          id,
          firstStep?.id ?? null,
          JSON.stringify(plan.evidence),
          JSON.stringify(body.evidence),
          body.status,
          JSON.stringify({ note: body.note ?? null, source: "manual_observation" }),
        ],
      );
      await client.query(
        `UPDATE optimization_plans
         SET status=$2,completed_at=now(),updated_at=now()
         WHERE id=$1`,
        [id, body.status],
      );
      if (plan.recommendation_id)
        await client.query(
          `UPDATE optimization_recommendations
           SET status=$2,updated_at=now() WHERE id=$1`,
          [
            plan.recommendation_id,
            body.status === "verified" ? "completed" : "failed",
          ],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await auditOptimization(
      pool,
      req,
      body.account_id,
      `optimization_plan_${body.status}`,
      id,
      { note: body.note ?? null, evidence: body.evidence },
    );
    res.json(await getPlan(pool, body.account_id, id));
  });

  router.post("/optimization/plans/:id/observe", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z
      .object({ account_id: accountSchema })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const plan = await getPlan(pool, body.account_id, id);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    const target = plan.steps[0]?.target;
    if (!target) {
      res.status(409).json({ error: "Plan has no target entity" });
      return;
    }
    const latest = await loadReportScope(pool, body.account_id);
    const row = latest?.level.rows.find((item) => item.entity_id === target);
    if (!latest || !row) {
      res.status(409).json({
        error: "Target Ads was not found in the latest verified Ads report",
      });
      return;
    }
    const before =
      (plan.evidence as { recommendation?: { evidence?: Record<string, unknown> } })
        .recommendation?.evidence ?? {};
    const after = {
      spend: row.spend,
      results: row.results,
      impressions: row.impressions,
      cost_per_result: row.cost_per_result,
      delivery: row.delivery,
    };
    const delta = {
      spend:
        row.spend !== null && typeof before.spend === "number"
          ? row.spend - before.spend
          : null,
      results:
        row.results !== null && typeof before.results === "number"
          ? row.results - before.results
          : null,
      cost_per_result:
        row.cost_per_result !== null &&
        typeof before.cost_per_result === "number"
          ? row.cost_per_result - before.cost_per_result
          : null,
    };
    const observation = await pool.query(
      `INSERT INTO outcome_observations(
         id,plan_id,account_id,entity_id,observation_window,
         job_id,before_metrics,after_metrics,delta
       ) VALUES($1,$2,$3,$4,'latest_capture',$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        id,
        body.account_id,
        target,
        latest.job.id,
        JSON.stringify(before),
        JSON.stringify(after),
        JSON.stringify(delta),
      ],
    );
    await pool.query(
      `UPDATE optimization_plans SET status='monitoring',updated_at=now()
       WHERE id=$1 AND status IN ('approved','dispatched','monitoring')`,
      [id],
    );
    if (plan.recommendation_id)
      await pool.query(
        "UPDATE optimization_recommendations SET status='monitoring',updated_at=now() WHERE id=$1",
        [plan.recommendation_id],
      );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_outcome_observed",
      id,
      { entity_id: target, job_id: latest.job.id, delta },
    );
    res.json(observation.rows[0]);
  });

  router.get("/optimization/experiments", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const result = await pool.query(
      `SELECT e.*,COALESCE(
         jsonb_agg(jsonb_build_object(
           'id',a.id,'label',a.label,'description',a.description,
           'metric_snapshot',a.metric_snapshot,'entity_ids',a.entity_ids
         ) ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL),
         '[]'::jsonb
       ) AS arms,
       (SELECT count(*)::int FROM experiment_observations eo
        WHERE eo.experiment_id=e.id) AS observation_count
       FROM experiments e
       LEFT JOIN experiment_arms a ON a.experiment_id=e.id
       WHERE e.account_id=$1
       GROUP BY e.id
       ORDER BY e.created_at DESC`,
      [account],
    );
    res.json(result.rows);
  });

  router.post("/optimization/experiments", async (req, res) => {
    const body = z
      .object({
        account_id: accountSchema,
        name: z.string().trim().min(1).max(160),
        hypothesis: z.string().trim().min(1).max(3000),
        objective: z.string().trim().min(1).max(120),
        primary_metric: z.string().trim().min(1).max(120),
        guardrails: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
        min_spend: z.number().nonnegative().nullable().default(null),
        min_results: z.number().int().nonnegative().nullable().default(null),
        planned_days: z.number().int().min(1).max(365).nullable().default(null),
        arms: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              description: z.string().max(1000).optional(),
              entity_ids: z
                .array(z.string().regex(/^\d+$/))
                .max(100)
                .default([]),
            }),
          )
          .min(2)
          .max(4),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO experiments(
           id,account_id,name,hypothesis,objective,primary_metric,
           guardrails,min_spend,min_results,planned_days
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          body.account_id,
          body.name,
          body.hypothesis,
          body.objective,
          body.primary_metric,
          JSON.stringify(body.guardrails),
          body.min_spend,
          body.min_results,
          body.planned_days,
        ],
      );
      for (const arm of body.arms)
        await client.query(
          `INSERT INTO experiment_arms(
             id,experiment_id,label,description,entity_ids
           ) VALUES($1,$2,$3,$4,$5)`,
          [
            randomUUID(),
            id,
            arm.label,
            arm.description ?? null,
            JSON.stringify(arm.entity_ids),
          ],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_experiment_created",
      id,
      {
        name: body.name,
        primary_metric: body.primary_metric,
        arms: body.arms.map((arm) => arm.label),
      },
    );
    res.status(201).json({ id });
  });

  router.post("/optimization/experiments/:id/status", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z
      .object({
        account_id: accountSchema,
        status: z.enum(["draft", "running", "paused", "completed", "aborted"]),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const result = await pool.query(
      `UPDATE experiments SET
         status=$3,
         starts_at=CASE WHEN $3='running' THEN COALESCE(starts_at,now()) ELSE starts_at END,
         ends_at=CASE WHEN $3 IN ('completed','aborted') THEN COALESCE(ends_at,now()) ELSE ends_at END,
         updated_at=now()
       WHERE id=$1 AND account_id=$2
       RETURNING *`,
      [id, body.account_id, body.status],
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Experiment not found" });
      return;
    }
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_experiment_status",
      id,
      { status: body.status },
    );
    res.json(result.rows[0]);
  });

  router.get("/optimization/experiments/:id/observations", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const owns = await pool.query(
      "SELECT 1 FROM experiments WHERE id=$1 AND account_id=$2",
      [id, account],
    );
    if (!owns.rowCount) {
      res.status(404).json({ error: "Experiment not found" });
      return;
    }
    const result = await pool.query(
      `SELECT * FROM experiment_observations
       WHERE experiment_id=$1 ORDER BY observed_at DESC`,
      [id],
    );
    res.json(result.rows);
  });

  router.post("/optimization/experiments/:id/observations", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z
      .object({
        account_id: accountSchema,
        arm_id: z.uuid(),
        job_id: jobSchema.optional(),
        observed_at: z.iso.datetime().optional(),
        date_start: z.iso.date().optional(),
        date_end: z.iso.date().optional(),
        metrics: z.record(z.string(), z.unknown()),
        evidence: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const owns = await pool.query(
      `SELECT 1 FROM experiments e
       JOIN experiment_arms a ON a.experiment_id=e.id
       WHERE e.id=$1 AND e.account_id=$2 AND a.id=$3`,
      [id, body.account_id, body.arm_id],
    );
    if (!owns.rowCount) {
      res.status(404).json({ error: "Experiment arm not found" });
      return;
    }
    const result = await pool.query(
      `INSERT INTO experiment_observations(
         id,experiment_id,arm_id,job_id,observed_at,date_start,date_end,
         metrics,evidence
       ) VALUES($1,$2,$3,$4,COALESCE($5,now()),$6,$7,$8,$9)
       RETURNING *`,
      [
        randomUUID(),
        id,
        body.arm_id,
        body.job_id ?? null,
        body.observed_at ?? null,
        body.date_start ?? null,
        body.date_end ?? null,
        JSON.stringify(body.metrics),
        JSON.stringify(body.evidence),
      ],
    );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_experiment_observation",
      id,
      {
        arm_id: body.arm_id,
        metrics: body.metrics,
      },
    );
    res.status(201).json(result.rows[0]);
  });

  router.get("/optimization/creatives", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const result = await pool.query(
      `SELECT c.*,ev.metrics AS latest_metrics,ev.status AS latest_status
       FROM creative_assets c
       LEFT JOIN LATERAL (
         SELECT metrics,status FROM entity_versions e
         WHERE e.account_id=c.account_id AND e.level='ad' AND e.entity_id=c.ad_id
         ORDER BY observed_at DESC LIMIT 1
       ) ev ON true
       WHERE c.account_id=$1 ORDER BY c.updated_at DESC LIMIT 200`,
      [account],
    );
    res.json(result.rows);
  });

  router.post("/optimization/creatives", async (req, res) => {
    const body = z
      .object({
        account_id: accountSchema,
        ad_id: z.string().regex(/^\d+$/),
        asset_type: z.enum(["copy", "image", "video", "carousel"]),
        title: z.string().max(300).optional(),
        body: z.string().max(5000).optional(),
        headline: z.string().max(500).optional(),
        cta: z.string().max(200).optional(),
        media_hash: z.string().max(128).optional(),
        metadata: z.record(z.string(), z.unknown()).default({}),
        provenance: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const result = await pool.query(
      `INSERT INTO creative_assets(
         id,account_id,ad_id,asset_type,title,body,headline,cta,
         media_hash,metadata,provenance
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(account_id,ad_id,asset_type,media_hash) DO UPDATE SET
         title=excluded.title,body=excluded.body,headline=excluded.headline,
         cta=excluded.cta,metadata=excluded.metadata,provenance=excluded.provenance,
         updated_at=now()
       RETURNING *`,
      [
        randomUUID(),
        body.account_id,
        body.ad_id,
        body.asset_type,
        body.title ?? null,
        body.body ?? null,
        body.headline ?? null,
        body.cta ?? null,
        body.media_hash ?? "metadata",
        JSON.stringify(body.metadata),
        JSON.stringify({ ...body.provenance, source: "manual_metadata" }),
      ],
    );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_creative_updated",
      result.rows[0].id,
      { ad_id: body.ad_id, asset_type: body.asset_type },
    );
    res.status(201).json(result.rows[0]);
  });

  router.get("/optimization/templates", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    const result = await pool.query(
      `SELECT * FROM campaign_templates
       WHERE account_id=$1 ORDER BY enabled DESC,updated_at DESC`,
      [account],
    );
    res.json(result.rows);
  });

  router.post("/optimization/templates", async (req, res) => {
    const body = z
      .object({
        account_id: accountSchema,
        name: z.string().trim().min(1).max(160),
        goal: z.string().trim().min(1).max(120),
        config: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    await assertManagedAccountEnabled(pool, body.account_id);
    const result = await pool.query(
      `INSERT INTO campaign_templates(id,account_id,name,goal,config)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [
        randomUUID(),
        body.account_id,
        body.name,
        body.goal,
        JSON.stringify(body.config),
      ],
    );
    await auditOptimization(
      pool,
      req,
      body.account_id,
      "optimization_template_created",
      result.rows[0].id,
      { name: body.name, goal: body.goal },
    );
    res.status(201).json(result.rows[0]);
  });

  router.get("/optimization/workspace", async (req, res) => {
    const account = accountSchema.parse(req.query.account_id);
    await assertManagedAccountEnabled(pool, account);
    let scope = null;
    try {
      const latest = await loadReportScope(pool, account);
      if (latest)
        scope = {
          job_id: latest.job.id,
          job_status: latest.job.status,
          captured_at: latest.job.updated_at,
          scope_key: latest.level.scope_key,
          coverage: latest.level.coverage,
          blockers: latest.level.blockers,
          verified_ads: latest.level.verified_unique_rows,
          reported_ads: latest.level.reported_total_rows,
          context: latest.level.context,
        };
    } catch {
      scope = null;
    }
    const [
      policy,
      recommendations,
      plans,
      experiments,
      creatives,
      templates,
      outcomes,
      versions,
    ] = await Promise.all([
      pool.query(
        "SELECT data,updated_at FROM optimization_policies WHERE account_id=$1",
        [account],
      ),
      pool.query(
        `SELECT * FROM optimization_recommendations
         WHERE account_id=$1 AND status<>'stale'
         ORDER BY CASE risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                  confidence DESC,updated_at DESC LIMIT 100`,
        [account],
      ),
      pool.query(
        `SELECT p.*,COALESCE(
           jsonb_agg(jsonb_build_object(
             'id',s.id,'sequence',s.sequence,'action',s.action,'target',s.target,
             'payload',s.payload,'status',s.status,
             'requires_approval',s.requires_approval,
             'command_id',s.command_id,'result',s.result
           ) ORDER BY s.sequence) FILTER (WHERE s.id IS NOT NULL),
           '[]'::jsonb
         ) AS steps,
         (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
          FROM action_receipts r WHERE r.plan_id=p.id) AS receipts,
         (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
          FROM rollback_plans r WHERE r.plan_id=p.id) AS rollbacks
         FROM optimization_plans p
         LEFT JOIN optimization_steps s ON s.plan_id=p.id
         WHERE p.account_id=$1
         GROUP BY p.id ORDER BY p.created_at DESC LIMIT 30`,
        [account],
      ),
      pool.query(
        `SELECT e.*,COALESCE(
           jsonb_agg(jsonb_build_object(
             'id',a.id,'label',a.label,'description',a.description,
             'metric_snapshot',a.metric_snapshot,'entity_ids',a.entity_ids
           ) ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL),
           '[]'::jsonb
         ) AS arms,
         (SELECT count(*)::int FROM experiment_observations eo
          WHERE eo.experiment_id=e.id) AS observation_count
         FROM experiments e
         LEFT JOIN experiment_arms a ON a.experiment_id=e.id
         WHERE e.account_id=$1
         GROUP BY e.id ORDER BY e.created_at DESC LIMIT 20`,
        [account],
      ),
      pool.query(
        `SELECT c.*,ev.metrics AS latest_metrics,ev.status AS latest_status
         FROM creative_assets c
         LEFT JOIN LATERAL (
           SELECT metrics,status FROM entity_versions e
           WHERE e.account_id=c.account_id AND e.level='ad' AND e.entity_id=c.ad_id
           ORDER BY observed_at DESC LIMIT 1
         ) ev ON true
         WHERE c.account_id=$1 ORDER BY c.updated_at DESC LIMIT 50`,
        [account],
      ),
      pool.query(
        `SELECT * FROM campaign_templates
         WHERE account_id=$1 ORDER BY enabled DESC,updated_at DESC LIMIT 30`,
        [account],
      ),
      pool.query(
        `SELECT * FROM outcome_observations
         WHERE account_id=$1 ORDER BY captured_at DESC LIMIT 30`,
        [account],
      ),
      pool.query(
        `SELECT level,count(*)::int AS versions
         FROM entity_versions WHERE account_id=$1 GROUP BY level`,
        [account],
      ),
    ]);
    const parsedPolicy = optimizationPolicySchema.safeParse(
      policy.rows[0]?.data,
    );
    res.json({
      account_id: account,
      scope,
      policy: parsedPolicy.success ? parsedPolicy.data : defaultOptimizationPolicy,
      policy_updated_at: policy.rows[0]?.updated_at ?? null,
      recommendations: recommendations.rows,
      plans: plans.rows,
      experiments: experiments.rows,
      creatives: creatives.rows,
      templates: templates.rows,
      outcomes: outcomes.rows,
      hierarchy_versions: Object.fromEntries(
        versions.rows.map((row) => [row.level, row.versions]),
      ),
      capability: {
        recommendation_engine: true,
        plan_and_approval: true,
        experiment_tracking: true,
        creative_metadata: true,
        outcome_observation: true,
        automated_meta_mutation: false,
        reason:
          "Action execution still requires a certified Extension adapter and local popup approval",
      },
    });
  });

  return router;
}
