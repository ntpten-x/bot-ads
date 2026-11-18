CREATE TABLE IF NOT EXISTS api_clients (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK(role IN ('admin','operator','viewer')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_clients_customer_idx
  ON api_clients(customer_id, enabled);
