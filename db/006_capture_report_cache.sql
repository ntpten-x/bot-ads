CREATE TABLE IF NOT EXISTS capture_job_reports (
  job_id uuid NOT NULL REFERENCES capture_jobs(id) ON DELETE CASCADE,
  context_key text NOT NULL,
  operator_context jsonb NOT NULL DEFAULT '{}',
  analysis jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id, context_key)
);

CREATE INDEX IF NOT EXISTS capture_job_reports_updated_idx
  ON capture_job_reports(job_id, updated_at DESC);
