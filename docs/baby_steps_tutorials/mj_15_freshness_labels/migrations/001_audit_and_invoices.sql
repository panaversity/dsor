-- The first migration. `pnpm migrate` runs it as the owner, never as
-- dsor_runtime, and it is safe to run twice (step 09's README, decision 13).
-- dsor_runtime itself is created by src/migrate.ts just before this file runs, because
-- its password comes from .env and must never be written in a file that git keeps.

-- Two schemas: a schema is a folder of tables. app holds the company's data, and dsor
-- holds DSoR's own records (step 09's README, decision 2).
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS dsor;

CREATE TABLE IF NOT EXISTS app.invoices (
  id                   text PRIMARY KEY,
  vendor_id            text NOT NULL,
  -- Money is exact: numeric, never a floating-point type, and a three-letter currency
  -- (step 09's README, decision 7).
  amount_value         numeric NOT NULL,
  amount_currency      char(3) NOT NULL,
  open_amount_value    numeric NOT NULL,
  open_amount_currency char(3) NOT NULL,
  status               text NOT NULL CHECK (status IN ('draft', 'issued', 'paid', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS dsor.audit (
  -- The database numbers and times each record: one counter and one clock
  -- (step 09's README, decision 6).
  sequence        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id       text NOT NULL UNIQUE,
  at              timestamptz NOT NULL DEFAULT now(),
  kind            text NOT NULL CHECK (kind = 'decision'),
  operation       text,
  -- AUTHORIZATION is a word SQL keeps for itself, so this column's name is quoted.
  "authorization" text NOT NULL CHECK ("authorization" IN ('ALLOW', 'DENY')),
  result          text NOT NULL,
  reason          text,
  correlation     jsonb NOT NULL
);

-- The letterbox (DSOR-AUD-04a). First take away every privilege dsor_runtime holds on the
-- tables, their columns, the sequences, and the schemas, so that a second run leaves
-- exactly the privileges below. A run does NOT undo a role membership, a role attribute,
-- or a changed table owner: the tests and the program's start-up check catch those
-- (step 09's README, decisions 13 and 17).
REVOKE ALL ON ALL TABLES IN SCHEMA app, dsor FROM dsor_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, dsor FROM dsor_runtime;
REVOKE ALL ON SCHEMA app, dsor FROM dsor_runtime;
-- USAGE lets dsor_runtime see into a schema. It gives no CREATE, so it can never make a
-- table of its own there, and never own one (step 09's README, decision 5).
GRANT USAGE ON SCHEMA app, dsor TO dsor_runtime;
-- The slot and the window: add a record, read records. No UPDATE, no DELETE, no TRUNCATE.
-- INSERT names its columns, and leaves out sequence and at: the database numbers and
-- times each record, and the program cannot choose either (step 09's README, decision 6).
GRANT SELECT ON dsor.audit TO dsor_runtime;
GRANT INSERT (record_id, kind, operation, "authorization", result, reason, correlation)
  ON dsor.audit TO dsor_runtime;
GRANT SELECT ON app.invoices TO dsor_runtime;

-- INV-1008, the running example, stored with its two decimals (step 09's README,
-- decision 7). A second run leaves it as it is.
INSERT INTO app.invoices
  (id, vendor_id, amount_value, amount_currency, open_amount_value, open_amount_currency, status)
VALUES ('INV-1008', 'VENDOR-44', 31400.00, 'USD', 31400.00, 'USD', 'issued')
ON CONFLICT (id) DO NOTHING;
