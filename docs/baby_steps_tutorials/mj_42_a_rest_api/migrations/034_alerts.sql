-- The alerts: DSoR's note that a payment's outcome is unknown and needs a person (DSOR-UNK-04b and
-- DSOR-UNK-04c in specs/dsor/03-execution.md, section 25.3). One row for each proposal that moved to
-- OUTCOME_UNKNOWN. The database raises it itself when the proposal's state changes to
-- OUTCOME_UNKNOWN, and closes it when the state changes on, to COMMITTED or FAILED, in that same
-- transaction, so no write of a proposal's state can leave the two apart. dsor_runtime may only
-- escalate an open alert, through alert.escalate_due. No row is removed (step 38b's README,
-- decisions D1, D3, D5, D6, and D9).
CREATE TABLE dsor.alerts (
  tenant_id    text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  proposal_id  text NOT NULL,
  -- The database's clock: now() is the transaction's start, the time of the move's own record.
  raised_at    timestamptz NOT NULL DEFAULT now(),
  -- No default: dsor_runtime moves it, so the trigger writes 'open' on the insert instead, before
  -- NOT NULL is checked.
  state        text NOT NULL CHECK (state IN ('open', 'escalated', 'closed')),
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

-- An alert is evidence that someone was told. It is raised open, by the database's clock, only for
-- a proposal that is OUTCOME_UNKNOWN. Then it moves open to escalated, with a person, while its
-- proposal is still OUTCOME_UNKNOWN; or open or escalated to closed, with its proposal's own
-- outcome. Once each, and the database writes each time. Nothing else changes, for the owner too,
-- while this trigger is on.
CREATE FUNCTION dsor.alert_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  now_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an alert is never removed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.state INTO now_state FROM dsor.proposals p
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.proposal_id;
  IF TG_OP = 'INSERT' THEN
    IF now_state IS DISTINCT FROM 'OUTCOME_UNKNOWN' THEN
      RAISE EXCEPTION 'an alert is raised only for a proposal whose outcome is unknown'
        USING ERRCODE = 'check_violation';
    END IF;
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
     AND NEW.outcome IS NULL AND now_state = 'OUTCOME_UNKNOWN' THEN
    NEW.escalated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.state IN ('open', 'escalated') AND NEW.state = 'closed'
     AND NEW.outcome IS NOT DISTINCT FROM now_state
     AND NEW.escalated_to IS NOT DISTINCT FROM OLD.escalated_to THEN
    NEW.escalated_at := OLD.escalated_at;
    NEW.closed_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'an alert moves only from open to escalated, or to closed, once each, with its proposal'
    USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER alerts_move BEFORE INSERT OR UPDATE OR DELETE ON dsor.alerts
  FOR EACH ROW EXECUTE FUNCTION dsor.alert_moves();

-- And no TRUNCATE, which a row trigger does not see.
CREATE FUNCTION dsor.alerts_stay() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'an alert is never removed' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER alerts_stay BEFORE TRUNCATE ON dsor.alerts
  FOR EACH STATEMENT EXECUTE FUNCTION dsor.alerts_stay();

-- The proposal's move raises and closes its alert, in its own transaction. With the rights of the
-- function's owner, the migration's login, so dsor_runtime needs no right to raise or close an
-- alert itself. The company's rule still applies: the move runs inside its company.
CREATE FUNCTION dsor.proposal_alerts() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.state = 'OUTCOME_UNKNOWN' AND OLD.state IS DISTINCT FROM 'OUTCOME_UNKNOWN' THEN
    INSERT INTO dsor.alerts (tenant_id, proposal_id) VALUES (NEW.tenant_id, NEW.id);
  ELSIF OLD.state = 'OUTCOME_UNKNOWN' AND NEW.state IN ('COMMITTED', 'FAILED') THEN
    UPDATE dsor.alerts SET state = 'closed', outcome = NEW.state
     WHERE tenant_id = NEW.tenant_id AND proposal_id = NEW.id AND state IN ('open', 'escalated');
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION dsor.proposal_alerts() FROM PUBLIC;
CREATE TRIGGER proposals_alert AFTER UPDATE OF state ON dsor.proposals
  FOR EACH ROW EXECUTE FUNCTION dsor.proposal_alerts();

-- Every proposal already OUTCOME_UNKNOWN when this migration runs gets its alert now, dated now.
-- Before the company's rule is switched on, so the owner's insert needs no company (found by step
-- 38b's review, H2).
INSERT INTO dsor.alerts (tenant_id, proposal_id)
  SELECT tenant_id, id FROM dsor.proposals WHERE state = 'OUTCOME_UNKNOWN';

ALTER TABLE dsor.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.alerts
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.alerts TO dsor_runtime;
GRANT UPDATE (state, escalated_to) ON dsor.alerts TO dsor_runtime;
