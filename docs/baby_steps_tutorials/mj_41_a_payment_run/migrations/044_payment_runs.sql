-- NEW IN STEP 41: a payment run, kept by the database (DSOR-BAT-01b, DSOR-BAT-02a in
-- specs/dsor/01-model.md, section 8; step 41's README, decisions D4 and D5). A line of a run is a
-- proposal of its own that names its run, by its address. A run keeps its fingerprint, over its lines
-- in their order, and its totals per currency, as proposal.schema.json names them, and per vendor,
-- which the schema has no field for. The address and the fingerprint are written once, with the
-- proposal; the totals once, when the run starts to wait. `pnpm migrate` runs this file once, as the
-- owner, after 043.

ALTER TABLE dsor.proposals ADD COLUMN run text;
ALTER TABLE dsor.proposals ADD COLUMN manifest_hash text;
ALTER TABLE dsor.proposals ADD COLUMN totals jsonb;
ALTER TABLE dsor.proposals ADD COLUMN vendor_totals jsonb;

-- A line names a proposal of its own company; a fingerprint is a SHA-256; a proposal is a run or a
--   line, never both; and only a run has totals.
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_run_of_company
  CHECK (run IS NULL OR run ~ ('^dsor://' || tenant_id || '/proposal/prop_[0-9a-f-]{36}$'));
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_manifest_hash
  CHECK (manifest_hash IS NULL OR manifest_hash ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_run_or_line
  CHECK (run IS NULL OR manifest_hash IS NULL);
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_totals_of_run
  CHECK ((totals IS NULL AND vendor_totals IS NULL) OR manifest_hash IS NOT NULL);

-- A run's lines, found by their run, as an approval and a release move them with it.
CREATE INDEX proposals_lines ON dsor.proposals (tenant_id, run) WHERE run IS NOT NULL;

-- dsor_runtime writes the address and the fingerprint with the proposal, and the totals on the
--   move that starts the wait; the trigger below keeps each to that.
GRANT INSERT (run, manifest_hash) ON dsor.proposals TO dsor_runtime;
GRANT UPDATE (totals, vendor_totals) ON dsor.proposals TO dsor_runtime;

-- The trigger's picture, as migration 029 wrote it, with a line's run and a run's fingerprint among
-- the columns that never change, and a run's totals written once.
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
  RETURN NEW;
END
$$;
