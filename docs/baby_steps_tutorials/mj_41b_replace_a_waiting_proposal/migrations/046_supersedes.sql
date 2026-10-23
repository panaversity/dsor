-- A new proposal that replaces a waiting one (DSOR-APR-12 in specs/dsor/03-execution.md,
-- section 26.1; step 41b's README, decisions D4, D9, and D11). The new proposal keeps the address of
-- the one it replaces, proposal.schema.json's supersedes, written once, with the proposal. The claim
-- keeps it too, beside the fingerprint and the mode, so the same key with another supersedes is
-- refused. And a line moves to CANCELLED only with its run. `pnpm migrate` runs this file once, as the
-- owner, after 045.

-- The address of a proposal of the same company, or none. A line never replaces anything: its run
--   does.
ALTER TABLE dsor.proposals ADD COLUMN supersedes text;
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_supersedes_of_company
  CHECK (supersedes IS NULL OR supersedes ~ ('^dsor://' || tenant_id || '/proposal/prop_[0-9a-f-]{36}$'));
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_line_supersedes_nothing
  CHECK (supersedes IS NULL OR run IS NULL);

-- The proposal that replaced one, found by the address it names, as an approval and a release
--   name it in their refusal.
CREATE INDEX proposals_supersedes ON dsor.proposals (tenant_id, supersedes)
  WHERE supersedes IS NOT NULL;

-- dsor_runtime writes it with the proposal, and never changes it: no UPDATE on it, and the trigger
--   below keeps it among the columns that never change.
GRANT INSERT (supersedes) ON dsor.proposals TO dsor_runtime;

-- A claim keeps what its call replaced, beside the fingerprint and the mode. Every claim kept before
--   this migration replaced nothing, so the column may be empty.
ALTER TABLE dsor.idempotency ADD COLUMN supersedes text;
GRANT INSERT (supersedes) ON dsor.idempotency TO dsor_runtime;

-- The trigger's picture, as migration 045 wrote it, with supersedes among the columns that never
-- change, and one rule more: a line moves to CANCELLED only with its run.
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
      NEW.exclusive_over, NEW.run, NEW.manifest_hash, NEW.supersedes)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.operation, OLD.mode, OLD.payload, OLD.payload_hash,
      OLD.resources, OLD.requester, OLD.idempotency_key, OLD.created_at, OLD.expires_at,
      OLD.exclusive_over, OLD.run, OLD.manifest_hash, OLD.supersedes) THEN
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
  --   it becomes APPROVED, EXECUTING, CANCELLED, or COMMITTED only once its run is. The other moves
  --   that stop work, DENIED, EXPIRED, INVALIDATED, FAILED, and OUTCOME_UNKNOWN, need no such check.
  --   CANCELLED joined the list in step 41b (decision D11).
  IF NEW.run IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state THEN
    SELECT r.state INTO run_state FROM dsor.proposals r
     WHERE r.tenant_id = NEW.tenant_id AND NEW.run = 'dsor://' || r.tenant_id || '/proposal/' || r.id;
    IF OLD.state = 'PROPOSED' AND run_state IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'a line leaves PROPOSED only while its run is being proposed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state IN ('APPROVED', 'EXECUTING', 'CANCELLED', 'COMMITTED')
       AND run_state IS DISTINCT FROM NEW.state THEN
      RAISE EXCEPTION 'a line moves to % only with its run', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
