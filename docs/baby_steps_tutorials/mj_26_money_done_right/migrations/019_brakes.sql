-- The emergency brake, in DSoR's own store. Each pull is one row, and its lift is
-- written into the same row, once (DSOR-OPS-01a, DSOR-OPS-01d). `pnpm migrate` runs this file
-- once, as the owner, after 018 (step 25b's README, decisions D5, D6, D9, and D11).
CREATE TABLE dsor.brakes (
  tenant_id   text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  id          text NOT NULL
    CHECK (id ~ '^brk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- The agent it stops. NULL: every agent of the company, a freeze.
  agent       text CHECK (agent <> ''),
  pulled_by   text NOT NULL CHECK (pulled_by <> ''),
  -- The database's clock, never the caller's. The moment of the insert, after the pull waited
  -- for the drafts on their way, not the start of its transaction (decision D11).
  pulled_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason      text NOT NULL CHECK (reason <> ''),
  lifted_by   text CHECK (lifted_by <> ''),
  lifted_at   timestamptz,
  lift_reason text CHECK (lift_reason <> ''),
  PRIMARY KEY (tenant_id, id),
  -- A lift comes after its pull. DSoR's own statement writes lifted_at from the database's
  -- clock, and dsor_runtime holds the column, so this keeps a wrong time out (step 25b's review,
  -- finding L5).
  CONSTRAINT brakes_lift_after_pull CHECK (lifted_at IS NULL OR lifted_at >= pulled_at),
  -- A lift is whole: who, when, and why, or none of them.
  CONSTRAINT brakes_lift_whole
    CHECK ((lifted_by IS NULL) = (lifted_at IS NULL) AND (lifted_at IS NULL) = (lift_reason IS NULL))
);

-- One brake on for each target: at most one for one agent, and one for the whole company, at
-- a time (decision L9). A pull's own statement uses it, with ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX brakes_one_on ON dsor.brakes (tenant_id, (coalesce(agent, '*')))
  WHERE lifted_at IS NULL;

-- The lock of the company's tables: read and written only inside a transaction that set its
-- company (DSOR-TEN-01b; step 11's README, decisions 1 and 2).
ALTER TABLE dsor.brakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.brakes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.brakes
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- A brake starts on, and is lifted once, never put back on by an UPDATE. Restrictive, so the
-- company's rule must agree too.
CREATE POLICY starts_on ON dsor.brakes AS RESTRICTIVE FOR INSERT TO dsor_runtime
  WITH CHECK (lifted_at IS NULL);
CREATE POLICY lifts_once ON dsor.brakes AS RESTRICTIVE FOR UPDATE TO dsor_runtime
  USING (lifted_at IS NULL) WITH CHECK (lifted_at IS NOT NULL);

-- dsor_runtime reads brakes, adds one through named columns, and writes a lift. No DELETE, and no
-- change to who pulled a brake, when, or why. pulled_at is the database's own.
GRANT SELECT ON dsor.brakes TO dsor_runtime;
GRANT INSERT (tenant_id, id, agent, pulled_by, reason) ON dsor.brakes TO dsor_runtime;
GRANT UPDATE (lifted_by, lifted_at, lift_reason) ON dsor.brakes TO dsor_runtime;

-- The log takes a fourth kind of record: a change to an operational control, which
-- audit-record.schema.json names operational_control (decision D6).
ALTER TABLE dsor.audit DROP CONSTRAINT audit_kind_check;
ALTER TABLE dsor.audit ADD CONSTRAINT audit_kind_check
  CHECK (kind IN ('decision', 'delegation_change', 'proposal_transition', 'operational_control'));
