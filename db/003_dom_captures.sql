-- Raw DOM captures reported by the Chrome Extension. These are evidence, not normalized insights.
CREATE TABLE capture_jobs (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  account_id text NOT NULL,
  levels jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL,
  error text,
  level_warnings jsonb NOT NULL DEFAULT '[]',
  extension_version text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE capture_snapshots (
  id uuid PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  job_id uuid REFERENCES capture_jobs(id),
  device_id uuid NOT NULL,
  bound_account text NOT NULL,
  account_id text,
  page text NOT NULL,
  level text,
  captured_at timestamptz NOT NULL,
  reader_version text,
  format text,
  coverage text,
  column_alignment text,
  reporting_context jsonb NOT NULL DEFAULT '{}',
  warnings jsonb NOT NULL DEFAULT '[]',
  row_count integer NOT NULL,
  review_status text NOT NULL CHECK(review_status IN ('needs_review','partially_promoted','promoted','rejected')),
  review_reasons jsonb NOT NULL DEFAULT '[]',
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX capture_snapshots_account_idx ON capture_snapshots(bound_account, captured_at DESC);
CREATE TABLE capture_rows (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES capture_snapshots(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  account_id text,
  level text,
  entity_id text,
  identity_source text,
  parent_ids jsonb NOT NULL DEFAULT '{}',
  name text,
  method text NOT NULL,
  column_mapping text,
  cells jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]',
  review_status text NOT NULL CHECK(review_status IN ('needs_review','promoted','rejected')),
  review_reasons jsonb NOT NULL DEFAULT '[]',
  operator_context jsonb,
  grain_key text,
  promoted_job_id uuid REFERENCES import_jobs(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, row_index)
);
CREATE INDEX capture_rows_entity_idx ON capture_rows(account_id, level, entity_id);
