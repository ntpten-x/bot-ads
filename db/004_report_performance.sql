-- Indexes for scoped report queries and Extension command dispatch.
CREATE INDEX IF NOT EXISTS insight_observations_account_level_date_idx
  ON insight_observations(account_id, level, date_start, date_end);

CREATE INDEX IF NOT EXISTS capture_snapshots_job_captured_idx
  ON capture_snapshots(job_id, captured_at);

CREATE INDEX IF NOT EXISTS capture_rows_job_status_idx
  ON capture_rows(snapshot_id, review_status);

CREATE INDEX IF NOT EXISTS bot_commands_pending_device_idx
  ON bot_commands(device_id, created_at, id)
  WHERE status='pending';
