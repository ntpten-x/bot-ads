CREATE TABLE IF NOT EXISTS report_preferences (
  account_id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
