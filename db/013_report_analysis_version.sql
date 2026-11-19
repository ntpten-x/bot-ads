ALTER TABLE capture_job_reports
  ADD COLUMN IF NOT EXISTS analyzer_version integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS capture_job_reports_analyzer_idx
  ON capture_job_reports(job_id, analyzer_version, updated_at DESC);
