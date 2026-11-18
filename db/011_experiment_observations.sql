ALTER TABLE experiment_arms
  ADD COLUMN IF NOT EXISTS entity_ids jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS experiment_observations (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  arm_id uuid NOT NULL REFERENCES experiment_arms(id) ON DELETE CASCADE,
  job_id uuid REFERENCES capture_jobs(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  date_start date,
  date_end date,
  metrics jsonb NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiment_observations_experiment_idx
  ON experiment_observations(experiment_id, arm_id, observed_at DESC);
