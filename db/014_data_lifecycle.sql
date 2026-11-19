CREATE TABLE IF NOT EXISTS ad_catalog (
  account_id text NOT NULL,
  level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
  entity_id text NOT NULL,
  parent_ids jsonb NOT NULL DEFAULT '{}',
  name text,
  status_raw text,
  delivery text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  first_job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL,
  last_job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL,
  last_context jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(account_id, level, entity_id)
);

CREATE INDEX IF NOT EXISTS ad_catalog_recent_idx
  ON ad_catalog(account_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ad_catalog_status_idx
  ON ad_catalog(account_id, level, delivery, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS ad_status_history (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL,
  level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
  entity_id text NOT NULL,
  status_raw text NOT NULL,
  delivery text,
  observed_at timestamptz NOT NULL,
  job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ad_status_history_entity_idx
  ON ad_status_history(account_id, level, entity_id, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ad_status_history_event_idx
  ON ad_status_history(
    account_id, level, entity_id, status_raw, observed_at, COALESCE(job_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS ad_performance_monthly (
  account_id text NOT NULL,
  level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
  entity_id text NOT NULL,
  month_start date NOT NULL,
  currency text NOT NULL,
  timezone text NOT NULL,
  attribution text NOT NULL,
  result_type text NOT NULL,
  spend numeric,
  impressions numeric,
  results numeric,
  observations integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(
    account_id, level, entity_id, month_start, currency, timezone,
    attribution, result_type
  )
);

CREATE INDEX IF NOT EXISTS ad_performance_monthly_recent_idx
  ON ad_performance_monthly(account_id, month_start DESC);

CREATE TABLE IF NOT EXISTS data_lifecycle_policy (
  id text PRIMARY KEY CHECK(id='default'),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO data_lifecycle_policy(id,data)
VALUES(
  'default',
  '{"raw_capture_days":30,"failed_capture_days":90,"daily_metrics_days":540,"monthly_metrics_months":36,"entity_version_days":730}'::jsonb
)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS data_lifecycle_runs (
  id uuid PRIMARY KEY,
  mode text NOT NULL CHECK(mode IN ('dry_run','apply')),
  account_id text,
  policy jsonb NOT NULL,
  stats jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_lifecycle_runs_created_idx
  ON data_lifecycle_runs(created_at DESC);

INSERT INTO ad_catalog(
  account_id,level,entity_id,parent_ids,name,first_seen_at,last_seen_at,
  first_job_id,last_job_id,last_context
)
SELECT DISTINCT ON (r.account_id, mapped.level, r.entity_id)
  r.account_id,
  mapped.level,
  r.entity_id,
  r.parent_ids,
  r.name,
  s.captured_at,
  s.captured_at,
  s.job_id,
  s.job_id,
  s.reporting_context
FROM capture_rows r
JOIN capture_snapshots s ON s.id=r.snapshot_id
CROSS JOIN LATERAL (
  SELECT CASE r.level
    WHEN 'campaigns' THEN 'campaign'
    WHEN 'adsets' THEN 'adset'
    WHEN 'ads' THEN 'ad'
  END AS level
) mapped
WHERE r.account_id IS NOT NULL
  AND r.entity_id IS NOT NULL
  AND mapped.level IS NOT NULL
ORDER BY r.account_id, mapped.level, r.entity_id, s.captured_at DESC
ON CONFLICT(account_id, level, entity_id) DO NOTHING;
