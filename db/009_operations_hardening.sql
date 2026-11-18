CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY,
  actor_kind text NOT NULL,
  actor_client_id uuid REFERENCES api_clients(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_customer_idx
  ON admin_audit_log(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_collection_schedules (
  account_id text PRIMARY KEY REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL DEFAULT 60
    CHECK(interval_minutes BETWEEN 15 AND 10080),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_command_id uuid REFERENCES bot_commands(id) ON DELETE SET NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_collection_schedules_due_idx
  ON account_collection_schedules(enabled, next_run_at)
  WHERE enabled=true;
