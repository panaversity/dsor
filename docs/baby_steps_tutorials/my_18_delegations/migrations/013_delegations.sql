-- NEW IN STEP 18: the permission slip, in DSoR's own store (DSOR-DEL-01a, decision 127).
--
-- A delegation is a slip a person signs for an agent: these permissions, up to this much per
-- payment, until this date. It is DSoR's paperwork, so it lives in dsor, the second kind there after
-- the log, under the same lock as every tenant table. The application reads slips and changes none:
-- there is no operation to sign one yet, so the running example's del_100 comes from a migration
-- (014), as PAY-901 did.

CREATE TABLE dsor.delegations (
  tenant      TEXT NOT NULL,
  id          TEXT NOT NULL,
  -- The person who signed, and the agent the slip is for.
  delegator   TEXT NOT NULL,
  delegate    TEXT NOT NULL,
  -- What the agent may do under it. Never more than the delegator holds at the moment of each
  -- decision: DSoR intersects the two every time, and copies neither into the other.
  permissions TEXT[] NOT NULL CHECK (cardinality(permissions) > 0),
  -- Up to how much per payment, or no limit at all: both halves, or neither.
  per_transaction_limit_value    NUMERIC(18, 2) CHECK (per_transaction_limit_value > 0),
  per_transaction_limit_currency TEXT CHECK (per_transaction_limit_currency ~ '^[A-Z]{3}$'),
  status      TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  -- A time, and never 'infinity' or '-infinity', which the program reads as no time at all, and
  -- whose answer to "is this slip still in force?" a review found wrong (decision 128).
  expires_at  TIMESTAMPTZ NOT NULL CHECK (isfinite(expires_at)),
  PRIMARY KEY (tenant, id),
  CHECK ((per_transaction_limit_value IS NULL) = (per_transaction_limit_currency IS NULL))
);

-- One active slip per agent per company. DSoR finds the slip itself, from the company and the
-- agent, so there must never be two to choose between.
CREATE UNIQUE INDEX one_active_slip_per_agent ON dsor.delegations (tenant, delegate)
  WHERE status = 'active';

REVOKE ALL ON dsor.delegations FROM PUBLIC;
GRANT SELECT ON dsor.delegations TO dsor_runtime;

-- The second lock, word for word as 005 and 011 write it.
ALTER TABLE dsor.delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.delegations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.delegations
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));
