-- The holds, the "do not touch" signs DSoR keeps while a payment's outcome is
-- unknown (DSOR-UNK-03b in specs/dsor/03-execution.md, section 25.2). One row for each record held
-- for one proposal, written with step 36's note, before the bank is asked. A hold counts while its
-- proposal is EXECUTING or OUTCOME_UNKNOWN, so nothing ever changes or removes a row: settling the
-- proposal frees the record (step 37's README, decisions D1, D6, and D7).
CREATE TABLE dsor.holds (
  tenant_id   text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  -- The held record's address, as line ⑨ bound it: dsor://org_456/invoice/INV-1002.
  resource    text NOT NULL CHECK (resource ~ '^dsor://org_[0-9]+/[a-z_]+/.+$'),
  proposal_id text NOT NULL,
  -- The database's clock, as for every record (step 09's README, decision 6).
  placed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, resource, proposal_id),
  -- A hold is always a proposal's, in the same company.
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES dsor.proposals (tenant_id, id),
  -- And a record of the hold's own company.
  CHECK (resource LIKE 'dsor://' || tenant_id || '/%')
);

ALTER TABLE dsor.holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.holds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.holds
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.holds TO dsor_runtime;
GRANT INSERT (tenant_id, resource, proposal_id) ON dsor.holds TO dsor_runtime;
