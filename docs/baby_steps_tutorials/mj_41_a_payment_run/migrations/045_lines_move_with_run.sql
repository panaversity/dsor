-- NEW IN STEP 41: the database moves a line only with its run (step 41's README, decision D12,
-- the learner's, after the review's L3). As dsor_runtime, raw SQL could approve a waiting line, or
-- start one, by itself. The trigger's picture, as migration 044 wrote it, with one rule more.
-- `pnpm migrate` runs this file once, as the owner, after 044.

CREATE OR REPLACE FUNCTION dsor.proposal_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  run_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PROPOSED' THEN
      RAISE EXCEPTION 'a proposal starts as PROPOSED, not %', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.requires IS NOT NULL THEN
      RAISE EXCEPTION 'a proposal starts waiting for nothing' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.totals IS NOT NULL OR NEW.vendor_totals IS NOT NULL THEN
      RAISE EXCEPTION 'a run starts with no totals' USING ERRCODE = 'check_violation';
    END IF;
    -- A line is made only by its own run's call, while that run is still being proposed: a run of
    --   the same company, by its address.
    IF NEW.run IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM dsor.proposals r
       WHERE r.tenant_id = NEW.tenant_id AND NEW.run = 'dsor://' || r.tenant_id || '/proposal/' || r.id
         AND r.manifest_hash IS NOT NULL AND r.state = 'PROPOSED') THEN
      RAISE EXCEPTION 'a line is made only with its run, a run of its own company still being proposed'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.operation, NEW.mode, NEW.payload, NEW.payload_hash,
      NEW.resources, NEW.requester, NEW.idempotency_key, NEW.created_at, NEW.expires_at,
      NEW.exclusive_over, NEW.run, NEW.manifest_hash)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.operation, OLD.mode, OLD.payload, OLD.payload_hash,
      OLD.resources, OLD.requester, OLD.idempotency_key, OLD.created_at, OLD.expires_at,
      OLD.exclusive_over, OLD.run, OLD.manifest_hash) THEN
    RAISE EXCEPTION 'only the state of a proposal changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'PROPOSED' AND NEW.state = 'PENDING_APPROVAL' THEN
    IF NEW.requires IS NULL THEN
      RAISE EXCEPTION 'a proposal that waits for an approval names what it waits for'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.requires IS DISTINCT FROM OLD.requires THEN
    RAISE EXCEPTION 'what a proposal waits for is written once, when it starts to wait'
      USING ERRCODE = 'check_violation';
  END IF;
  -- A run's totals, written once, when it starts to wait, and never again.
  IF OLD.state = 'PROPOSED' AND NEW.state IN ('PENDING_APPROVAL', 'READY')
     AND NEW.manifest_hash IS NOT NULL THEN
    IF NEW.totals IS NULL OR NEW.vendor_totals IS NULL THEN
      RAISE EXCEPTION 'a run that waits keeps its totals' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.totals, NEW.vendor_totals) IS DISTINCT FROM (OLD.totals, OLD.vendor_totals) THEN
    RAISE EXCEPTION 'a run''s totals are written once, when it starts to wait'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('PROPOSED', 'DENIED'), ('PROPOSED', 'READY'), ('PROPOSED', 'PENDING_APPROVAL'),
      ('READY', 'EXECUTING'), ('READY', 'CANCELLED'), ('READY', 'EXPIRED'),
      ('READY', 'INVALIDATED'),
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
  -- A line moves with its run: it leaves PROPOSED only while its run is still being proposed, and
  --   it becomes APPROVED, EXECUTING, or COMMITTED only once its run is. The moves that stop work,
  --   DENIED, CANCELLED, EXPIRED, INVALIDATED, FAILED, and OUTCOME_UNKNOWN, need no such check.
  IF NEW.run IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state THEN
    SELECT r.state INTO run_state FROM dsor.proposals r
     WHERE r.tenant_id = NEW.tenant_id AND NEW.run = 'dsor://' || r.tenant_id || '/proposal/' || r.id;
    IF OLD.state = 'PROPOSED' AND run_state IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'a line leaves PROPOSED only while its run is being proposed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state IN ('APPROVED', 'EXECUTING', 'COMMITTED') AND run_state IS DISTINCT FROM NEW.state THEN
      RAISE EXCEPTION 'a line moves to % only with its run', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
