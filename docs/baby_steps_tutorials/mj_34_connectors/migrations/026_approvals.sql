-- DSoR's approvals. Each is one person's yes to one waiting proposal, kept whole in
-- approval.schema.json's shape, beside the columns that its keys need. dsor_runtime reads approvals
-- and adds them, and never changes or removes one. One person approves one proposal once, which a
-- unique key keeps (step 29's README, decisions D7 and D8). `pnpm migrate` runs this file once, as
-- the owner, after 025.
CREATE TABLE dsor.approvals (
  tenant_id   text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  id          text NOT NULL
    CHECK (id ~ '^apr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  proposal_id text NOT NULL,
  approver    text NOT NULL CHECK (approver <> ''),
  approval    jsonb NOT NULL,
  -- The database's own clock, which orders a proposal's approvals.
  given_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT approvals_once UNIQUE (tenant_id, proposal_id, approver),
  CONSTRAINT approvals_of_a_proposal FOREIGN KEY (tenant_id, proposal_id)
    REFERENCES dsor.proposals (tenant_id, id),
  -- The columns repeat what the approval says, so they say the same: its id, its company, its
  -- proposal, and its one approver.
  CONSTRAINT approvals_keys CHECK (
    jsonb_typeof(approval) = 'object'
    AND approval ->> 'id' = id
    AND approval ->> 'tenant' = tenant_id
    AND approval ->> 'proposal' = 'dsor://' || tenant_id || '/proposal/' || proposal_id
    AND jsonb_typeof(approval -> 'approvers') = 'array'
    AND jsonb_array_length(approval -> 'approvers') = 1
    AND approval -> 'approvers' -> 0 ->> 'principal' = approver
  )
);

-- The company's lock, as on every table of DSoR's own (DSOR-TEN-01b).
ALTER TABLE dsor.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.approvals
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads the approvals and adds one through named columns. No UPDATE and no DELETE: an
-- approval, once given, says what it said. Revoking one is a later step's (DSOR-APR-04b).
GRANT SELECT ON dsor.approvals TO dsor_runtime;
GRANT INSERT (tenant_id, id, proposal_id, approver, approval) ON dsor.approvals TO dsor_runtime;
