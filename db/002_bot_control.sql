CREATE TABLE bot_commands (id uuid PRIMARY KEY, device_id uuid NOT NULL, command jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','error')), result jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE INDEX ON bot_commands(device_id,created_at) WHERE status='pending';
CREATE TABLE bot_devices (id uuid PRIMARY KEY, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
