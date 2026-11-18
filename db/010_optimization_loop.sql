CREATE TABLE IF NOT EXISTS optimization_policies (
  account_id text PRIMARY KEY REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_versions (
  id uuid PRIMARY KEY,
  version_key text NOT NULL UNIQUE,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
  entity_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  name text,
  status text,
  parent_ids jsonb NOT NULL DEFAULT '{}',
  metrics jsonb NOT NULL DEFAULT '{}',
  settings jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL,
  job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entity_versions_entity_idx
  ON entity_versions(account_id, level, entity_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS creative_assets (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  asset_type text NOT NULL,
  title text,
  body text,
  headline text,
  cta text,
  media_hash text,
  metadata jsonb NOT NULL DEFAULT '{}',
  provenance jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, ad_id, asset_type, media_hash)
);
CREATE INDEX IF NOT EXISTS creative_assets_ad_idx
  ON creative_assets(account_id, ad_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS optimization_recommendations (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL,
  scope_key text NOT NULL,
  source_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  title text NOT NULL,
  rationale text NOT NULL,
  evidence jsonb NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  risk text NOT NULL CHECK(risk IN ('low','medium','high')),
  expected_impact jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'suggested'
    CHECK(status IN ('suggested','dismissed','planned','monitoring','completed','failed','stale')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, source_key)
);
CREATE INDEX IF NOT EXISTS optimization_recommendations_account_idx
  ON optimization_recommendations(account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS optimization_plans (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES optimization_recommendations(id) ON DELETE SET NULL,
  title text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','approved','rejected','dispatched','monitoring','verified','failed','cancelled')),
  policy_snapshot jsonb NOT NULL,
  evidence jsonb NOT NULL,
  note text,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS optimization_plans_account_idx
  ON optimization_plans(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS optimization_steps (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES optimization_plans(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','ready_for_local_review','dispatched','verified','failed','skipped')),
  requires_approval boolean NOT NULL DEFAULT true,
  command_id uuid REFERENCES bot_commands(id) ON DELETE SET NULL,
  result jsonb,
  executed_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id, sequence)
);

CREATE TABLE IF NOT EXISTS action_receipts (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES optimization_plans(id) ON DELETE CASCADE,
  step_id uuid REFERENCES optimization_steps(id) ON DELETE SET NULL,
  command_id uuid REFERENCES bot_commands(id) ON DELETE SET NULL,
  before_state jsonb NOT NULL DEFAULT '{}',
  after_state jsonb NOT NULL DEFAULT '{}',
  verification text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_receipts_plan_idx
  ON action_receipts(plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rollback_plans (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES optimization_plans(id) ON DELETE CASCADE,
  step_id uuid REFERENCES optimization_steps(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready'
    CHECK(status IN ('ready','used','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  name text NOT NULL,
  hypothesis text NOT NULL,
  objective text NOT NULL,
  primary_metric text NOT NULL,
  guardrails jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','running','paused','completed','aborted')),
  min_spend numeric,
  min_results integer,
  planned_days integer,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiments_account_idx
  ON experiments(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS experiment_arms (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  label text NOT NULL,
  description text,
  metric_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outcome_observations (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES optimization_plans(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  entity_id text NOT NULL,
  observation_window text NOT NULL,
  job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL,
  before_metrics jsonb NOT NULL DEFAULT '{}',
  after_metrics jsonb NOT NULL DEFAULT '{}',
  delta jsonb NOT NULL DEFAULT '{}',
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outcome_observations_plan_idx
  ON outcome_observations(plan_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS campaign_templates (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_templates_account_idx
  ON campaign_templates(account_id, enabled, created_at DESC);
