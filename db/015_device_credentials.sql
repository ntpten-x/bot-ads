CREATE TABLE IF NOT EXISTS device_credentials (
  device_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS device_credentials_account_idx
  ON device_credentials(account_id, enabled);
