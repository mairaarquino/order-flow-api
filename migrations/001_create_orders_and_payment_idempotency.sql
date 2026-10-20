CREATE TABLE orders (
  id text PRIMARY KEY,
  items jsonb NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  status text NOT NULL CHECK (status IN ('pending_payment', 'paid')),
  created_at timestamptz NOT NULL
);

CREATE TABLE payment_idempotency (
  idempotency_key text PRIMARY KEY,
  order_id text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_idempotency_created_at_idx
  ON payment_idempotency (created_at);
