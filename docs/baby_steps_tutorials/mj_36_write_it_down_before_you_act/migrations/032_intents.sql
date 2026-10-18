-- NEW IN STEP 36: the intent records, the note DSoR writes before it calls a bank: "I am about to do
-- this" (DSOR-EXE-03a in specs/dsor/03-execution.md, section 21). One for each proposal, written and
-- committed before the bank is asked, and never changed, except once: its outcome, when the work
-- ends. A note with no outcome after a crash is OUTCOME_UNKNOWN (DSOR-EXE-04b; step 36's README,
-- decisions D1 to D3).
CREATE TABLE dsor.intents (
  -- A proposal executes at most once (DSOR-IDM-04), so it has at most one note.
  proposal_id      text PRIMARY KEY
    CHECK (proposal_id ~ '^prop_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  tenant_id        text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  -- What EXE-03a lists: the operation and its version, the payload hash, the idempotency key, the
  -- connector, and the security context. The principal names the claim the key belongs to.
  operation        text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[0-9]+$'),
  payload_hash     text NOT NULL,
  principal        text NOT NULL,
  idempotency_key  text NOT NULL,
  connector        text NOT NULL,
  security_context jsonb NOT NULL CHECK (jsonb_typeof(security_context) = 'object'),
  -- The database's clock, as for every record (step 09's README, decision 6).
  written_at       timestamptz NOT NULL DEFAULT now(),
  outcome          text CHECK (outcome IN ('committed', 'failed', 'outcome_unknown')),
  ended_at         timestamptz,
  CONSTRAINT intents_end CHECK ((outcome IS NULL) = (ended_at IS NULL))
);

-- The note is evidence: only its outcome is ever written after it, once, with its time. No other
-- column changes, and an outcome is never changed or taken back.
CREATE FUNCTION dsor.intent_ends() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.proposal_id, NEW.tenant_id, NEW.operation, NEW.payload_hash, NEW.principal,
      NEW.idempotency_key, NEW.connector, NEW.security_context, NEW.written_at)
     IS DISTINCT FROM
     (OLD.proposal_id, OLD.tenant_id, OLD.operation, OLD.payload_hash, OLD.principal,
      OLD.idempotency_key, OLD.connector, OLD.security_context, OLD.written_at) THEN
    RAISE EXCEPTION 'an intent record is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'an intent record ends once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.outcome IS NULL THEN
    RAISE EXCEPTION 'an intent record ends with an outcome' USING ERRCODE = 'check_violation';
  END IF;
  NEW.ended_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER intents_end BEFORE UPDATE ON dsor.intents
  FOR EACH ROW EXECUTE FUNCTION dsor.intent_ends();

ALTER TABLE dsor.intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.intents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.intents
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.intents TO dsor_runtime;
GRANT INSERT (proposal_id, tenant_id, operation, payload_hash, principal, idempotency_key,
              connector, security_context)
  ON dsor.intents TO dsor_runtime;
GRANT UPDATE (outcome) ON dsor.intents TO dsor_runtime;
