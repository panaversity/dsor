-- NEW IN STEP 27: the company's policy, as controls written in CEL (decision 162).
--
-- A control is a policy sentence translated into a condition a program can evaluate, kept with its
-- owner, the policy it came from, and the test cases that must pass before it is switched on (§17).
-- Each version is a row of its own, and its record is never rewritten: a change is a new version.
-- The application reads controls, and may change a control's status and when it was switched on,
-- and nothing else. Who may switch one on is step 28's.
--
-- Not to be confused with dsor.agent_controls, step 25's emergency brake, which §18 calls
-- operational controls. These are §17's.

CREATE TABLE dsor.controls (
  tenant         TEXT NOT NULL,
  id             TEXT NOT NULL CHECK (id <> ''),
  version        INTEGER NOT NULL CHECK (version > 0),
  -- The operation it governs, so a decision reads only the controls on its own operation.
  operation      TEXT NOT NULL CHECK (operation <> ''),
  status         TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'active', 'stale_authority',
                                                 'suspended', 'retired')),
  -- Everything else control.schema.json says a control is: its condition, effect, authority,
  -- owner, test cases and the rest. Never its status, which is the column above, the one part that
  -- changes; and the same id, version and operation as the columns, so the two cannot disagree.
  record         JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object' AND NOT (record ? 'status')),
  switched_on_at TIMESTAMPTZ,
  PRIMARY KEY (tenant, id, version),
  CHECK (record->>'id' = id AND record->'version' = to_jsonb(version)
         AND record->>'operation' = operation)
);

-- One version of a control in force at a time.
CREATE UNIQUE INDEX one_version_in_force ON dsor.controls (tenant, id)
  WHERE status IN ('active', 'stale_authority');

-- Read, and change a status; nothing else.
REVOKE ALL ON dsor.controls FROM PUBLIC;
GRANT SELECT ON dsor.controls TO dsor_runtime;
GRANT UPDATE (status, switched_on_at) ON dsor.controls TO dsor_runtime;

-- The second lock, word for word as the other tenant tables have it.
ALTER TABLE dsor.controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.controls FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.controls
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));
