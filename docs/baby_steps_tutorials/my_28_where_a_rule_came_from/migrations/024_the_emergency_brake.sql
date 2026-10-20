-- NEW IN STEP 25: the emergency brake, kept by DSoR (DSOR-OPS-01a, decision 142).
--
-- A suspension stops one agent in one company; a freeze, the same record with no agent named, stops
-- every agent in it. Both are refused AGENT_SUSPENDED for every command, and both are kept here, in
-- DSoR's own store, so the brake does not depend on the agent agreeing to stop: the agent never sees
-- this table, and nothing it sends can lift what is in it.
--
-- A record is never deleted, and a lift is final: who pulled the brake, when and why, and who
-- released it and when, stay for the record.

CREATE SEQUENCE dsor.control_numbers;

CREATE TABLE dsor.agent_controls (
  tenant     TEXT NOT NULL,
  id         TEXT NOT NULL DEFAULT 'ctl_' || nextval('dsor.control_numbers'),
  -- The agent it stops, or NULL: every agent in the company, a freeze. Never '*', which stands for
  -- "every agent" in the index below: an agent of that name was a brake the freeze collided with,
  -- a review measured (decision 143).
  agent      TEXT CHECK (agent <> '' AND agent <> '*'),
  imposed_by TEXT NOT NULL CHECK (imposed_by <> ''),
  imposed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reason     TEXT NOT NULL CHECK (reason <> ''),
  -- Both, once it is lifted, or neither while it holds.
  lifted_by  TEXT CHECK (lifted_by <> ''),
  lifted_at  TIMESTAMPTZ,
  PRIMARY KEY (tenant, id),
  CHECK ((lifted_by IS NULL) = (lifted_at IS NULL))
);

ALTER SEQUENCE dsor.control_numbers OWNED BY dsor.agent_controls.id;

-- One brake at a time on each target: pulling it twice is the same brake, not a second one to lift.
-- '*' stands for "every agent", which no agent's name can be.
CREATE UNIQUE INDEX one_brake_per_target ON dsor.agent_controls (tenant, COALESCE(agent, '*'))
  WHERE lifted_at IS NULL;

-- Pull the brake and release it, and nothing else: no deleting, no rewriting who pulled it or why,
-- and no record written already lifted.
REVOKE ALL ON dsor.agent_controls FROM PUBLIC;
REVOKE ALL ON SEQUENCE dsor.control_numbers FROM PUBLIC;
GRANT SELECT ON dsor.agent_controls TO dsor_runtime;
GRANT INSERT (tenant, agent, imposed_by, reason) ON dsor.agent_controls TO dsor_runtime;
GRANT UPDATE (lifted_by, lifted_at) ON dsor.agent_controls TO dsor_runtime;
GRANT USAGE ON SEQUENCE dsor.control_numbers TO dsor_runtime;

-- The second lock, word for word as the other tenant tables have it.
ALTER TABLE dsor.agent_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.agent_controls FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.agent_controls
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));

-- And a lift is final: restrictive, so AND'ed with the first, an UPDATE may touch only a brake still
-- on. Without it, a lifted brake could be put back on with a lift nobody gave, or its lift
-- rewritten. Start-up refuses the table without it.
CREATE POLICY a_lift_is_final ON dsor.agent_controls AS RESTRICTIVE FOR UPDATE
  USING      (lifted_at IS NULL)
  WITH CHECK (true);
