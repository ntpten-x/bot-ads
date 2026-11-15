CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ad_accounts (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE campaigns (account_id text REFERENCES ad_accounts(id), id text, name text, details jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(account_id,id));
CREATE TABLE ad_sets (account_id text, id text, campaign_id text NOT NULL, name text, PRIMARY KEY(account_id,id), FOREIGN KEY(account_id,campaign_id) REFERENCES campaigns(account_id,id));
CREATE TABLE ads (account_id text, id text, ad_set_id text NOT NULL, name text, PRIMARY KEY(account_id,id), FOREIGN KEY(account_id,ad_set_id) REFERENCES ad_sets(account_id,id));
CREATE TABLE ad_creatives (account_id text, ad_id text, details jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,ad_id), FOREIGN KEY(account_id,ad_id) REFERENCES ads(account_id,id));
CREATE TABLE import_jobs (id uuid PRIMARY KEY, account_id text NOT NULL REFERENCES ad_accounts(id), fingerprint text NOT NULL UNIQUE, status text NOT NULL CHECK(status IN ('completed')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE import_files (job_id uuid PRIMARY KEY REFERENCES import_jobs(id), filename text NOT NULL, sha256 text NOT NULL, row_count integer NOT NULL);
-- Keep aggregates separate from genuinely daily observations. A reporting grain includes every comparison condition.
CREATE TABLE insight_observations (grain_key text PRIMARY KEY, account_id text NOT NULL REFERENCES ad_accounts(id), level text NOT NULL, entity_id text NOT NULL, date_start date NOT NULL, date_end date NOT NULL, currency text NOT NULL, timezone text NOT NULL, attribution text NOT NULL, result_type text NOT NULL, data jsonb NOT NULL, last_job_id uuid NOT NULL REFERENCES import_jobs(id), updated_at timestamptz NOT NULL DEFAULT now());
CREATE VIEW insights_daily AS SELECT * FROM insight_observations WHERE date_start = date_end AND NOT (data ? 'breakdown');
CREATE TABLE insight_import_history (job_id uuid REFERENCES import_jobs(id), grain_key text REFERENCES insight_observations(grain_key), data jsonb NOT NULL, PRIMARY KEY(job_id,grain_key));
CREATE TABLE insights_breakdowns (id uuid PRIMARY KEY, job_id uuid REFERENCES import_jobs(id), dimensions jsonb NOT NULL, data jsonb NOT NULL);
CREATE TABLE sync_checkpoints (id uuid PRIMARY KEY, account_id text REFERENCES ad_accounts(id), state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sync_errors (id uuid PRIMARY KEY, account_id text REFERENCES ad_accounts(id), details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE data_quality_reports (job_id uuid PRIMARY KEY REFERENCES import_jobs(id), report jsonb NOT NULL);
