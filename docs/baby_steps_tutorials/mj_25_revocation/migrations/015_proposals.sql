-- Proposals. Every command call that passes line ⑦ becomes one row here, a
-- proposal, whose state moves only along the picture in §26.2 (DSOR-APR-01a), and never out of a
-- final state (DSOR-APR-01c). Each move leaves one record in dsor.audit, in the same
-- transaction (DSOR-APR-01b), the place DSOR-AUD-01 names. `pnpm migrate` runs this file once, as the owner,
-- after 014 (step 22's README, decisions 1 to 15).
-- The guard of an upgrade. A claim answered before this migration keeps no proposal, so its
-- replay could name none, and every retry with its key would hear INTERNAL_ERROR, forever: claims
-- are never removed (step 20's README, decision 11). So this migration runs only on a database
-- whose claims hold no answer yet, such as a database of the step's own. Found by step 22's
-- review (decision 15).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dsor.idempotency WHERE answer IS NOT NULL) THEN
    RAISE EXCEPTION 'dsor.idempotency holds answers recorded before proposals existed, whose replays could name no proposal: migrate a database of its own'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END
$$;

CREATE TABLE dsor.proposals (
  tenant_id       text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  -- prop_ and a random UUID. No counter, so one company's ids say nothing about another's
  -- (decision 10).
  id              text NOT NULL
    CHECK (id ~ '^prop_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- The operation and its contract's version, as the log names it: payment.create@1.
  operation       text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+@[0-9]+$'),
  -- Only execute is built. Step 23 adds propose_only, in migration 016.
  mode            text NOT NULL CHECK (mode = 'execute'),
  -- One of the 17 states of §26.2. Which moves are allowed is the trigger's to say, below.
  state           text NOT NULL CHECK (state IN (
                    'PROPOSED', 'DENIED', 'READY', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED',
                    'EXPIRED', 'CANCELLED', 'REVOKED', 'INVALIDATED', 'EXECUTING', 'COMMITTED',
                    'FAILED', 'OUTCOME_UNKNOWN', 'COMPENSATING', 'COMPENSATED',
                    'COMPENSATION_FAILED')),
  -- The request as line ⑥ checked it, and its fingerprint. Written once: no grant below lets
  -- dsor_runtime change them, and the trigger refuses the owner too.
  payload         jsonb NOT NULL,
  payload_hash    text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  -- The URIs the request names, such as the invoice to pay.
  resources       text[] NOT NULL,
  -- Who asked: the request's security context (decision 11).
  requester       jsonb NOT NULL,
  -- The key line ⑦ claimed for the call that made this proposal.
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  -- The database's clock says when the proposal was made.
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- The lock of the company's tables, on proposals: a proposal is read and written only inside a
-- transaction that set its company (DSOR-TEN-02a, DSOR-TEN-01b; step 11's README, decisions 1
-- and 2).
ALTER TABLE dsor.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.proposals
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads proposals, adds one through named columns, and changes its state. Nothing
-- else: no DELETE, and no change to the request. created_at is the database's to fill.
GRANT SELECT ON dsor.proposals TO dsor_runtime;
GRANT INSERT (tenant_id, id, operation, mode, state, payload, payload_hash, resources, requester,
              idempotency_key)
  ON dsor.proposals TO dsor_runtime;
GRANT UPDATE (state) ON dsor.proposals TO dsor_runtime;

-- The database's guard, beside DSoR's own check in src/proposals.ts (decision 3). A new proposal
-- starts as PROPOSED. A change of state must be a move that §26.2 draws, so a final state, which
-- draws no move out, can never be left. The picture's last line, COMMITTED or FAILED to
-- COMPENSATING, is not drawn: COMMITTED and FAILED are final (decision 1). Nothing but the state
-- ever changes. It returns the row, so it never swallows a write (step 16's README, decision 3).
-- search_path is pinned, so no look-alike of an operator earlier on the path can change the
-- answer (step 16's README, "Think it through").
CREATE FUNCTION dsor.proposal_moves() RETURNS trigger LANGUAGE plpgsql
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
      NEW.resources, NEW.requester, NEW.idempotency_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.operation, OLD.mode, OLD.payload, OLD.payload_hash,
      OLD.resources, OLD.requester, OLD.idempotency_key, OLD.created_at) THEN
    RAISE EXCEPTION 'only the state of a proposal changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('PROPOSED', 'DENIED'), ('PROPOSED', 'READY'), ('PROPOSED', 'PENDING_APPROVAL'),
      ('READY', 'EXECUTING'),
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
-- Nobody calls it by hand. The database runs it at each INSERT and UPDATE.
REVOKE ALL ON FUNCTION dsor.proposal_moves() FROM PUBLIC;
CREATE TRIGGER proposals_move BEFORE INSERT OR UPDATE ON dsor.proposals
  FOR EACH ROW EXECUTE FUNCTION dsor.proposal_moves();

-- The log takes a third kind of record: a move of a proposal, as DSOR-AUD-01 asks (decision 4). Like a
-- change to a slip, it allows and denies nothing, so its "authorization" stays empty (step 19b's
-- README, decision 10).
ALTER TABLE dsor.audit DROP CONSTRAINT audit_kind_check;
ALTER TABLE dsor.audit ADD CONSTRAINT audit_kind_check
  CHECK (kind IN ('decision', 'delegation_change', 'proposal_transition'));
