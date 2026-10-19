-- The alerts: DSoR's note that a payment's outcome is unknown and needs a person (DSOR-UNK-04b and
-- DSOR-UNK-04c in specs/dsor/03-execution.md, section 25.3). One row for each proposal that moved to
-- OUTCOME_UNKNOWN, written by that move, in its transaction. It is open until alert.escalate_due
-- hands it to the company's named person, and closed by the move out of OUTCOME_UNKNOWN, naming the
-- outcome. Nothing else ever changes, and no row is removed (step 38b's README, decisions D1, D3,
-- D5, and D6).
CREATE TABLE dsor.alerts (
  tenant_id    text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  proposal_id  text NOT NULL,
  -- The database's clock, the move's own time: now() is the transaction's.
  raised_at    timestamptz NOT NULL DEFAULT now(),
  state        text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'escalated', 'closed')),
  escalated_to text,
  escalated_at timestamptz,
  outcome      text CHECK (outcome IN ('COMMITTED', 'FAILED')),
  closed_at    timestamptz,
  -- One alert for one proposal: a proposal goes unknown once.
  PRIMARY KEY (tenant_id, proposal_id),
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES dsor.proposals (tenant_id, id),
  CHECK ((escalated_to IS NULL) = (escalated_at IS NULL)),
  CHECK ((state = 'closed') = (outcome IS NOT NULL)),
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);

-- An alert is evidence that someone was told. It is raised open, by the database's clock. Then it
-- moves open to escalated, with a person, or open or escalated to closed, with an outcome, once
-- each, and the database writes each time. Nothing else changes, even for the owner.
CREATE FUNCTION dsor.alert_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an alert is never removed' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.raised_at := now();
    NEW.state := 'open';
    NEW.escalated_to := NULL;
    NEW.escalated_at := NULL;
    NEW.outcome := NULL;
    NEW.closed_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.proposal_id, NEW.raised_at)
     IS DISTINCT FROM (OLD.tenant_id, OLD.proposal_id, OLD.raised_at) THEN
    RAISE EXCEPTION 'an alert''s company, proposal, and raised_at never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'open' AND NEW.state = 'escalated' AND NEW.escalated_to IS NOT NULL
     AND NEW.outcome IS NULL THEN
    NEW.escalated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.state IN ('open', 'escalated') AND NEW.state = 'closed' AND NEW.outcome IS NOT NULL
     AND NEW.escalated_to IS NOT DISTINCT FROM OLD.escalated_to THEN
    NEW.escalated_at := OLD.escalated_at;
    NEW.closed_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'an alert moves only from open to escalated, or to closed, once each'
    USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER alerts_move BEFORE INSERT OR UPDATE OR DELETE ON dsor.alerts
  FOR EACH ROW EXECUTE FUNCTION dsor.alert_moves();

ALTER TABLE dsor.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.alerts
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.alerts TO dsor_runtime;
GRANT INSERT (tenant_id, proposal_id) ON dsor.alerts TO dsor_runtime;
GRANT UPDATE (state, escalated_to, outcome) ON dsor.alerts TO dsor_runtime;
