-- Limits with reservations. Each slip's spending for the day is one total, which
-- one statement grows only while it stays within the limit, and each proposal holds at most one
-- reservation of it (DSOR-DEL-06a, DSOR-DEL-06b). `pnpm migrate` runs this file once, as the owner,
-- after 016 (step 24's README, decisions 3, 4, 5, and 13).

-- The day's total of one slip, in one currency. The day is the database's own: today in UTC.
CREATE TABLE dsor.limit_counters (
  tenant_id  text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  delegation text NOT NULL,
  day        date NOT NULL,
  currency   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- What the day's held and committed reservations add up to. numeric is exact: no float.
  used       numeric NOT NULL CHECK (used >= 0),
  PRIMARY KEY (tenant_id, delegation, day, currency)
);

-- One reservation for each proposal, keyed by it, so the same proposal never reserves twice
-- (DSOR-DEL-06b). It is held while the work runs, then committed or released, once.
CREATE TABLE dsor.reservations (
  tenant_id       text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  proposal_id     text NOT NULL
    CHECK (proposal_id ~ '^prop_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  delegation      text NOT NULL,
  day             date NOT NULL,
  amount_value    numeric NOT NULL CHECK (amount_value > 0),
  amount_currency text NOT NULL CHECK (amount_currency ~ '^[A-Z]{3}$'),
  state           text NOT NULL CHECK (state IN ('held', 'committed', 'released')),
  PRIMARY KEY (tenant_id, proposal_id)
);

-- The lock of the company's tables, on both: read and written only inside a transaction that set
-- its company (DSOR-TEN-02a, DSOR-TEN-01b; step 11's README, decisions 1 and 2).
ALTER TABLE dsor.limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.limit_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.limit_counters
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
ALTER TABLE dsor.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.reservations
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- A reservation starts held, and leaves held once, to committed or released. The policies are
-- restrictive, so the company's policy still applies too, as for a claim's answer (step 20's
-- README, decision 12).
CREATE POLICY starts_held ON dsor.reservations AS RESTRICTIVE FOR INSERT TO dsor_runtime
  WITH CHECK (state = 'held');
CREATE POLICY ends_once ON dsor.reservations AS RESTRICTIVE FOR UPDATE TO dsor_runtime
  USING (state = 'held') WITH CHECK (state IN ('committed', 'released'));

-- dsor_runtime reads both, adds rows through named columns, and changes only a total and a
-- reservation's state. No DELETE, and no change to an amount.
GRANT SELECT ON dsor.limit_counters TO dsor_runtime;
GRANT INSERT (tenant_id, delegation, day, currency, used) ON dsor.limit_counters TO dsor_runtime;
GRANT UPDATE (used) ON dsor.limit_counters TO dsor_runtime;
GRANT SELECT ON dsor.reservations TO dsor_runtime;
GRANT INSERT (tenant_id, proposal_id, delegation, day, amount_value, amount_currency, state)
  ON dsor.reservations TO dsor_runtime;
GRANT UPDATE (state) ON dsor.reservations TO dsor_runtime;
