ALTER TABLE api_clients
  ADD COLUMN IF NOT EXISTS all_accounts boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS api_client_accounts (
  client_id uuid NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES managed_accounts(account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(client_id, account_id)
);

CREATE INDEX IF NOT EXISTS api_client_accounts_account_idx
  ON api_client_accounts(account_id, client_id);
