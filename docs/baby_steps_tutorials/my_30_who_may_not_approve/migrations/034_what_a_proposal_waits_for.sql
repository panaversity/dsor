-- NEW IN STEP 29: what a waiting proposal waits for, kept (decision 167).
--
-- When a control holds a proposal at PENDING_APPROVAL, the approvals it waits for are written here:
-- which control asked, for whom, and how many. An approval is checked against these rows, and the
-- proposal moves on to APPROVED only when every one has its quorum (DSOR-AUT-02c). Written once, when
-- the proposal starts waiting; the application adds them, and never changes or removes one.

CREATE TABLE dsor.requirements (
  tenant   TEXT NOT NULL,
  proposal TEXT NOT NULL,
  control  TEXT NOT NULL CHECK (control <> ''),
  version  INTEGER NOT NULL CHECK (version > 0),
  role     TEXT NOT NULL CHECK (role <> ''),
  quorum   INTEGER NOT NULL CHECK (quorum > 0),
  PRIMARY KEY (tenant, proposal, control),
  FOREIGN KEY (tenant, proposal) REFERENCES dsor.proposals (tenant, id)
);

REVOKE ALL ON dsor.requirements FROM PUBLIC;
GRANT SELECT ON dsor.requirements TO dsor_runtime;
GRANT INSERT (tenant, proposal, control, version, role, quorum) ON dsor.requirements TO dsor_runtime;

-- The second lock, word for word as the other tenant tables have it.
ALTER TABLE dsor.requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.requirements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.requirements
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));
