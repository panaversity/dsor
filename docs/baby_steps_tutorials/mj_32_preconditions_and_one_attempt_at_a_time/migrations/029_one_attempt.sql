-- NEW IN STEP 32: one attempt at a time, kept by the database too. A proposal names the record its
-- operation is exclusive over, written once with it, and the key proposals_one_attempt keeps a
-- second proposal of one operation in flight over one record from being kept (DSOR-EXC-01; step 32's
-- README, decision D7). Line ⑨'s lock and look refuse the second first, with CONFLICT. This key is
-- the backstop, for a look that a bug skipped. `pnpm migrate` runs this file once, as the owner,
-- after 028.

ALTER TABLE dsor.proposals ADD COLUMN exclusive_over text;

-- dsor_runtime writes it once, with the proposal, and never changes it: the column is in no
-- UPDATE grant, and the trigger below keeps it as it was written.
GRANT INSERT (exclusive_over) ON dsor.proposals TO dsor_runtime;

-- The operation without its version, so a new version of the contract does not open a second door.
CREATE UNIQUE INDEX proposals_one_attempt
  ON dsor.proposals (tenant_id, split_part(operation, '@', 1), exclusive_over)
  WHERE exclusive_over IS NOT NULL
    AND state IN ('READY', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'OUTCOME_UNKNOWN');

-- The trigger's picture, as migration 027 wrote it, with exclusive_over among the columns that
-- never change.
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
      NEW.resources, NEW.requester, NEW.idempotency_key, NEW.created_at, NEW.expires_at,
      NEW.exclusive_over)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.operation, OLD.mode, OLD.payload, OLD.payload_hash,
      OLD.resources, OLD.requester, OLD.idempotency_key, OLD.created_at, OLD.expires_at,
      OLD.exclusive_over) THEN
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
  RETURN NEW;
END
$$;
