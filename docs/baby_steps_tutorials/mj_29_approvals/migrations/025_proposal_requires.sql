-- NEW IN STEP 29: a waiting proposal keeps what it waits for, in proposal.schema.json's own field,
-- requires: each rule's id and version, and the approval it asks for. It is written once, on the
-- move from PROPOSED to PENDING_APPROVAL, and never changed after, by anyone, the owner too. An
-- approval satisfies only what the proposal waits for (step 29's README, decision D4). `pnpm
-- migrate` runs this file once, as the owner, after 024.
ALTER TABLE dsor.proposals ADD COLUMN requires jsonb;
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_requires_list
  CHECK (requires IS NULL OR (jsonb_typeof(requires) = 'array' AND jsonb_array_length(requires) > 0));

-- The trigger's picture, as migration 020 wrote it, with what a proposal waits for: none at its
-- start, written on the move to PENDING_APPROVAL, and never changed again.
CREATE OR REPLACE FUNCTION dsor.proposal_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PROPOSED' THEN
      RAISE EXCEPTION 'a proposal starts as PROPOSED, not %', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.requires IS NOT NULL THEN
      RAISE EXCEPTION 'a proposal starts waiting for nothing' USING ERRCODE = 'check_violation';
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
  IF OLD.state = 'PROPOSED' AND NEW.state = 'PENDING_APPROVAL' THEN
    IF NEW.requires IS NULL THEN
      RAISE EXCEPTION 'a proposal that waits for an approval names what it waits for'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.requires IS DISTINCT FROM OLD.requires THEN
    RAISE EXCEPTION 'what a proposal waits for is written once, when it starts to wait'
      USING ERRCODE = 'check_violation';
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

-- dsor_runtime names what a proposal waits for, through the move that the trigger allows it on.
GRANT UPDATE (requires) ON dsor.proposals TO dsor_runtime;
