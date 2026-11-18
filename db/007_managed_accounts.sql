CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS managed_accounts (
  account_id text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  display_name text,
  enabled boolean NOT NULL DEFAULT true,
  report_template jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS managed_accounts_customer_idx
  ON managed_accounts(customer_id, enabled, account_id);

INSERT INTO customers(id,name)
VALUES ('77a6dc50-d619-4d05-bc19-4d515e30db5b','Local Workspace')
ON CONFLICT(id) DO NOTHING;

INSERT INTO managed_accounts(account_id,customer_id)
SELECT account_id,'77a6dc50-d619-4d05-bc19-4d515e30db5b'
FROM (
  SELECT id AS account_id FROM ad_accounts
  UNION
  SELECT state->>'bound_account' AS account_id
  FROM bot_devices
  WHERE state->>'bound_account' IS NOT NULL
) accounts
ON CONFLICT(account_id) DO NOTHING;
