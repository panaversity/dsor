-- A READY proposal can end. Each proposal gets an expiry, and the picture that the
-- trigger keeps gains two moves out of READY: to CANCELLED, when its slip is torn up, and to
-- EXPIRED, when its company's lifetime has passed. §26.2 does not draw these two moves yet: the
-- learner proposed them (open question 90). `pnpm migrate` runs this file once, as the owner,
-- after 019 (step 25c's README, decisions D3, D5, D6, and D7).

-- Each proposal's expiry. A proposal made before this migration expires 7 days after it was made
-- (decision D3). The trigger refuses every change but a state's, so it is paused for this one
-- statement, inside the migration's own transaction, and switched on again at once. Time is counted
-- in hours, never in days: a day of a time zone whose clocks change is 23 or 25 hours long. Found
-- by step 25c's review (finding L6).
ALTER TABLE dsor.proposals ADD COLUMN expires_at timestamptz;
ALTER TABLE dsor.proposals DISABLE TRIGGER proposals_move;
UPDATE dsor.proposals SET expires_at = created_at + interval '168 hours';
ALTER TABLE dsor.proposals ENABLE TRIGGER proposals_move;
ALTER TABLE dsor.proposals ALTER COLUMN expires_at SET NOT NULL;
-- After the proposal was made, and at most 30 days of 24 hours after: §44's longest life for an
-- approval at L2 (DSOR-APR-04a). DSoR's own statement sets it from the database's clock (decision
-- D6).
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_expiry_within_ceiling
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '720 hours');

-- dsor_runtime writes the expiry once, when it adds a proposal (decision D6).
GRANT INSERT (expires_at) ON dsor.proposals TO dsor_runtime;

-- The trigger's picture, as migration 015 wrote it, with the two new moves out of READY. And the
-- expiry is kept as the request is: written once, and never changed by anyone, the owner too
-- (decision D7).
CREATE OR REPLACE FUNCTION dsor.proposal_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PROPOSED' THEN
      RAISE EXCEPTION 'a proposal starts as PROPOSED, not %', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.operation, NEW.mode, NEW.payload, NEW.payload_hash,
      NEW.resources, NEW.requester, NEW.idempotency_key, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.operation, OLD.mode, OLD.payload, OLD.payload_hash,
      OLD.resources, OLD.requester, OLD.idempotency_key, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'only the state of a proposal changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('PROPOSED', 'DENIED'), ('PROPOSED', 'READY'), ('PROPOSED', 'PENDING_APPROVAL'),
      ('READY', 'EXECUTING'), ('READY', 'CANCELLED'), ('READY', 'EXPIRED'),
      ('PENDING_APPROVAL', 'APPROVED'), ('PENDING_APPROVAL', 'REJECTED'),
      ('PENDING_APPROVAL', 'EXPIRED'), ('PENDING_APPROVAL', 'CANCELLED'),
      ('APPROVED', 'EXECUTING'), ('APPROVED', 'EXPIRED'), ('APPROVED', 'REVOKED'),
      ('APPROVED', 'INVALIDATED'), ('APPROVED', 'CANCELLED'),
      ('EXECUTING', 'COMMITTED'), ('EXECUTING', 'FAILED'), ('EXECUTING', 'OUTCOME_UNKNOWN'),
      ('OUTCOME_UNKNOWN', 'COMMITTED'), ('OUTCOME_UNKNOWN', 'FAILED'),
      ('COMPENSATING', 'COMPENSATED'), ('COMPENSATING', 'COMPENSATION_FAILED')
    ) AS drawn (from_state, to_state)
    WHERE drawn.from_state = OLD.state AND drawn.to_state = NEW.state
  ) THEN
    RAISE EXCEPTION 'no move from % to % in the picture of section 26.2', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
