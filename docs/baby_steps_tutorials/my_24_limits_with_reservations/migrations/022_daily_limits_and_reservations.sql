-- NEW IN STEP 24: a daily limit, and the reservations that keep it (DSOR-DEL-06a, decision 140).
--
-- A daily limit is a running total, and a running total has a race: fifty payments arrive at once,
-- each reads the total, each finds room, and together they spend past the limit. So the total is
-- never read and then written. Each payment books its amount against the day's total in one
-- statement that adds it only if the total stays within the limit, like booking the last hotel
-- room, and writes a reservation, keyed by its proposal, in the same statement.

-- The slip's daily limit, beside its limit per payment: both halves, or neither.
ALTER TABLE dsor.delegations
  ADD COLUMN daily_limit_value    NUMERIC(18, 2) CHECK (daily_limit_value > 0),
  ADD COLUMN daily_limit_currency TEXT CHECK (daily_limit_currency ~ '^[A-Z]{3}$'),
  ADD CHECK ((daily_limit_value IS NULL) = (daily_limit_currency IS NULL));

-- One running total per slip per day: a calendar day in UTC, on the database's clock.
CREATE TABLE dsor.day_totals (
  tenant     TEXT NOT NULL,
  delegation TEXT NOT NULL,
  day        DATE NOT NULL,
  used_value NUMERIC(18, 2) NOT NULL CHECK (used_value >= 0),
  currency   TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  PRIMARY KEY (tenant, delegation, day),
  FOREIGN KEY (tenant, delegation) REFERENCES dsor.delegations (tenant, id)
);

-- One reservation per proposal, so the same proposal never reserves twice (DSOR-DEL-06b). Held
-- while its proposal may still run; committed when it ran; released, its amount given back to the
-- day, when it did not.
CREATE TABLE dsor.reservations (
  tenant          TEXT NOT NULL,
  proposal        TEXT NOT NULL,
  delegation      TEXT NOT NULL,
  day             DATE NOT NULL,
  amount_value    NUMERIC(18, 2) NOT NULL CHECK (amount_value > 0),
  amount_currency TEXT NOT NULL CHECK (amount_currency ~ '^[A-Z]{3}$'),
  state           TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'committed', 'released')),
  PRIMARY KEY (tenant, proposal),
  FOREIGN KEY (tenant, proposal) REFERENCES dsor.proposals (tenant, id),
  FOREIGN KEY (tenant, delegation, day) REFERENCES dsor.day_totals (tenant, delegation, day)
);

-- The application adds totals and reservations, changes a total's amount and a reservation's state,
-- and deletes nothing. A reservation is always written held; the column's default says so, and the
-- application may not say otherwise. What these rights do not keep (decision 141): with them, the
-- application's own code could change a total's amount, or insert a reservation that booked nothing
-- and release it, and so make room on a full day, as it could write a payment past the limit, since
-- a payment is not tied to its reservation. What the database keeps is the race: requests racing
-- each other never book past the limit, and a proposal never books twice.
REVOKE ALL ON dsor.day_totals, dsor.reservations FROM PUBLIC;
GRANT SELECT ON dsor.day_totals, dsor.reservations TO dsor_runtime;
GRANT INSERT (tenant, delegation, day, used_value, currency) ON dsor.day_totals TO dsor_runtime;
GRANT UPDATE (used_value) ON dsor.day_totals TO dsor_runtime;
GRANT INSERT (tenant, proposal, delegation, day, amount_value, amount_currency)
  ON dsor.reservations TO dsor_runtime;
GRANT UPDATE (state) ON dsor.reservations TO dsor_runtime;

-- The second lock, word for word as 005, 011, 013, 018 and 020 write it.
ALTER TABLE dsor.day_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.day_totals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.day_totals
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));

ALTER TABLE dsor.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.reservations
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));

-- And a settled reservation is never changed (decision 140), as step 20 keeps an answer: restrictive,
-- so AND'ed with the first, an UPDATE may touch only a held one. Without it, a committed payment's
-- reservation could be released, and its amount given back to the day after it was paid. It keeps
-- the reservation, not the total (decision 141). Start-up refuses the table without it.
CREATE POLICY a_settled_reservation_is_kept ON dsor.reservations AS RESTRICTIVE FOR UPDATE
  USING      (state = 'held')
  WITH CHECK (true);
