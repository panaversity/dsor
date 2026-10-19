-- The chain of DSoR's log (DSOR-AUD-04b and DSOR-AUD-04c in specs/dsor/03-execution.md, section
-- 30). Each record of dsor.audit holds its chain, its company's or no_company; its place in the
-- chain; the fingerprint of the record before it; and its own fingerprint, SHA-256 over that one
-- and every column of the record. A trigger writes all four when the record's transaction
-- commits, holding the chain's head only for that moment. A record DSoR's login writes cannot be
-- kept without them, and dsor_runtime can write none of them. The records already here are chained
-- first, in the order they were written. src/audit-chain.ts is the same recipe in TypeScript, and
-- pnpm verify-audit checks every chain with it (step 39's README, decisions D1 to D3, D5 to D9).
-- A chain rewritten from an edit on, its newest records removed, or a new record the owner adds
-- are step 39b's to catch, or no chain's.
ALTER TABLE dsor.audit
  ADD COLUMN chain          text,
  ADD COLUMN chain_position bigint,
  ADD COLUMN previous_hash  text,
  ADD COLUMN record_hash    text;

-- Each chain's head: its last place and that record's fingerprint. Only the owner reads or writes
-- it, so only the owner's trigger can hold its lock: an advisory lock, which any login may take,
-- let dsor_runtime stall a company's commits (found by step 39's review, L1; decision D8). It is a
-- copy of what the chain says, and the checker compares the two, never trusts it.
CREATE TABLE dsor.audit_heads (
  chain          text PRIMARY KEY,
  chain_position bigint NOT NULL,
  record_hash    text NOT NULL
);

-- The text a fingerprint covers: each part with its length in UTF-8 bytes before it, a null as
-- "-", joined by "|". recipeText in src/audit-chain.ts is the same (found by step 39's review,
-- L7: octet_length alone counts in the database's encoding).
CREATE FUNCTION dsor.audit_text(VARIADIC parts text[]) RETURNS text LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp AS $$
  SELECT string_agg(CASE WHEN p IS NULL THEN '-'
                         ELSE octet_length(convert_to(p, 'UTF8'))::text || ':' || p END, '|'
                    ORDER BY i)
    FROM unnest(parts) WITH ORDINALITY AS t(p, i)
$$;

-- A record's fingerprint, from the one before it and every column, in FIELD_SQL's order.
CREATE FUNCTION dsor.audit_fingerprint(r dsor.audit) RETURNS text LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(r.previous_hash || E'\n' || dsor.audit_text(
    r.chain,
    r.chain_position::text,
    r.sequence::text,
    r.record_id,
    to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    r.kind,
    r.operation,
    r."authorization",
    r.result,
    r.reason,
    r.correlation::text,
    r.tenant,
    r.extensions::text,
    r.resources::text,
    r.row_count::text,
    r.connector,
    r.identity::text,
    r.delegation,
    r.controls::text,
    r.decision_bundle
  ), 'UTF8')), 'hex')
$$;

-- The records already in the log, chained in the order they were written (decision D3). Step
-- 003b's size check is NOT VALID, so old oversized records stay; an UPDATE checks it again, so it
-- is lifted for the chaining and put back as it was (found by step 39's review, M1).
ALTER TABLE dsor.audit DROP CONSTRAINT IF EXISTS audit_extensions_size;
-- The chaining begins. test/owner-audit.ts runs this block again, so it is tested.
DO $$
DECLARE
  r dsor.audit;
  current_chain text := NULL;
  place bigint;
  previous text;
BEGIN
  FOR r IN SELECT * FROM dsor.audit ORDER BY coalesce(tenant, 'no_company'), sequence LOOP
    IF current_chain IS DISTINCT FROM coalesce(r.tenant, 'no_company') THEN
      IF current_chain IS NOT NULL THEN
        INSERT INTO dsor.audit_heads VALUES (current_chain, place, previous);
      END IF;
      current_chain := coalesce(r.tenant, 'no_company');
      place := 0;
      previous := 'sha256:' || repeat('0', 64);
    END IF;
    place := place + 1;
    r.chain := current_chain;
    r.chain_position := place;
    r.previous_hash := previous;
    r.record_hash := dsor.audit_fingerprint(r);
    UPDATE dsor.audit
       SET chain = r.chain, chain_position = r.chain_position,
           previous_hash = r.previous_hash, record_hash = r.record_hash
     WHERE sequence = r.sequence;
    IF NOT FOUND THEN RAISE EXCEPTION 'audit record % could not be chained', r.sequence; END IF;
    previous := r.record_hash;
  END LOOP;
  IF current_chain IS NOT NULL THEN
    INSERT INTO dsor.audit_heads VALUES (current_chain, place, previous);
  END IF;
END
$$;
-- The chaining ends.
ALTER TABLE dsor.audit
  ADD CONSTRAINT audit_extensions_size
  CHECK (extensions IS NULL OR octet_length(extensions::text) <= 1024) NOT VALID;

-- The four stay empty from the insert to the commit, inside the record's own transaction, which
-- no other transaction sees; the commit's trigger fills them, so every record DSoR's login keeps
-- has all four. A record kept another way, with the trigger off, has none, and the checker names it
-- (decision D2).
ALTER TABLE dsor.audit
  -- A record's chain is its company's, or no_company's (decision D7).
  ADD CONSTRAINT audit_chain_is_company
    CHECK (chain IS NULL OR chain = coalesce(tenant, 'no_company')),
  -- Two records never share a place, or a predecessor, in one chain (decision D6).
  ADD CONSTRAINT audit_one_place UNIQUE (chain, chain_position),
  ADD CONSTRAINT audit_one_successor UNIQUE (chain, previous_hash);

-- At the commit of the record's transaction: its chain, its place after the chain's head, the
-- head's fingerprint, and its own, in one write. Deferred to the commit, so the head's lock is held
-- only while the transaction ends, never while it does its work: taken at the insert, a lock was
-- held to the end of every call, made a company's calls wait for each other, and locked two rule
-- drafts against each other (found while building; decision D2). Of two records committed at once,
-- the second waits for the head, then follows the first. A transaction writes one company's
-- records, as inCompany pins it, so it locks one head (found by step 39's review, L3).
-- The trigger writes dsor.audit with the owner's rights, and the owner must hold BYPASSRLS: the
-- log forces row-level security, and has no rule that lets anyone UPDATE it. A write that changes
-- no row is refused, so the commit fails rather than keep a record with no chain (found by step
-- 39's review, H1).
CREATE FUNCTION dsor.audit_chains() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r dsor.audit := NEW;
  named text := coalesce(NEW.tenant, 'no_company');
  head dsor.audit_heads;
BEGIN
  INSERT INTO dsor.audit_heads VALUES (named, 0, 'sha256:' || repeat('0', 64))
    ON CONFLICT (chain) DO NOTHING;
  SELECT * INTO head FROM dsor.audit_heads WHERE chain = named FOR UPDATE;
  r.chain := named;
  r.chain_position := head.chain_position + 1;
  r.previous_hash := head.record_hash;
  r.record_hash := dsor.audit_fingerprint(r);
  UPDATE dsor.audit
     SET chain = r.chain, chain_position = r.chain_position,
         previous_hash = r.previous_hash, record_hash = r.record_hash
   WHERE sequence = NEW.sequence;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit record % could not be chained: the owner cannot write it', NEW.sequence;
  END IF;
  UPDATE dsor.audit_heads SET chain_position = r.chain_position, record_hash = r.record_hash
   WHERE chain = named;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION dsor.audit_chains() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER audit_chain AFTER INSERT ON dsor.audit
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dsor.audit_chains();
