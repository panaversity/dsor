-- NEW IN STEP 29: approvals, kept whole (DSOR-APR-02a, decision 167).
--
-- One row for each person who approved a waiting proposal: who, and the approval itself, as
-- approval.schema.json says it, with its number and its status kept beside it, as a control's status
-- is. Added, and never changed or removed: an approval nobody can rewrite is one an auditor can read.
-- One for each person and proposal.

CREATE SEQUENCE dsor.approval_numbers;

CREATE TABLE dsor.approvals (
  tenant      TEXT NOT NULL,
  id          TEXT NOT NULL DEFAULT 'apr_' || nextval('dsor.approval_numbers'),
  proposal    TEXT NOT NULL,
  approver    TEXT NOT NULL CHECK (approver <> ''),
  -- The approval, as the schema says it, but for its id and its status, the columns' to give.
  record      JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'
                                    AND NOT (record ? 'id') AND NOT (record ? 'status')),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant, id),
  UNIQUE (tenant, proposal, approver),
  FOREIGN KEY (tenant, proposal) REFERENCES dsor.proposals (tenant, id)
);

ALTER SEQUENCE dsor.approval_numbers OWNED BY dsor.approvals.id;

REVOKE ALL ON dsor.approvals FROM PUBLIC;
REVOKE ALL ON SEQUENCE dsor.approval_numbers FROM PUBLIC;
GRANT SELECT ON dsor.approvals TO dsor_runtime;
GRANT INSERT (tenant, proposal, approver, record) ON dsor.approvals TO dsor_runtime;
GRANT USAGE ON SEQUENCE dsor.approval_numbers TO dsor_runtime;

-- The second lock, word for word as the other tenant tables have it.
ALTER TABLE dsor.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.approvals
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));
