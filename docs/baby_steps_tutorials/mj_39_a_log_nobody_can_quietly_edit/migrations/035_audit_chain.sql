-- The chain of DSoR's log (DSOR-AUD-04b and DSOR-AUD-04c in specs/dsor/03-execution.md, section
-- 30). Each record of dsor.audit holds its chain, its company's or no_company; its place in the
-- chain; the fingerprint of the record before it; and its own fingerprint, SHA-256 over that one
-- and every column of the record. A trigger writes all four when the record's transaction
-- commits, holding the chain's lock only for that moment, so no path can keep a record without
-- them, and dsor_runtime can write none of them.
-- The records already here are chained first, in the order they were written. src/audit-chain.ts
-- is the same recipe in TypeScript, and pnpm verify-audit checks every chain with it (step 39's
-- README, decisions D1 to D3 and D5 to D7). A chain rewritten from an edit on, or its newest
-- records removed, is step 39b's to catch.
ALTER TABLE dsor.audit
  ADD COLUMN chain          text,
  ADD COLUMN chain_position bigint,
  ADD COLUMN previous_hash  text,
  ADD COLUMN record_hash    text;

-- The text a fingerprint covers: each part with its length in bytes before it, a null as "-",
-- joined by "|". recipeText in src/audit-chain.ts is the same.
CREATE FUNCTION dsor.audit_text(VARIADIC parts text[]) RETURNS text LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp AS $$
  SELECT string_agg(CASE WHEN p IS NULL THEN '-' ELSE octet_length(p)::text || ':' || p END, '|'
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

-- The records already in the log, chained in the order they were written (decision D3).
DO $$
DECLARE
  r record;
  current_chain text := NULL;
  place bigint;
  previous text;
BEGIN
  FOR r IN SELECT sequence, coalesce(tenant, 'no_company') AS named FROM dsor.audit
           ORDER BY coalesce(tenant, 'no_company'), sequence LOOP
    IF current_chain IS DISTINCT FROM r.named THEN
      current_chain := r.named;
      place := 0;
      previous := 'sha256:' || repeat('0', 64);
    END IF;
    place := place + 1;
    UPDATE dsor.audit SET chain = current_chain, chain_position = place, previous_hash = previous
     WHERE sequence = r.sequence;
    UPDATE dsor.audit a SET record_hash = dsor.audit_fingerprint(a)
     WHERE sequence = r.sequence RETURNING record_hash INTO previous;
  END LOOP;
END
$$;

-- The four stay empty from the insert to the commit, inside the record's own transaction, which
-- no other transaction sees; the commit's trigger fills them, so every record that is kept has all
-- four. The checker names any record that has none as broken (decision D2).
ALTER TABLE dsor.audit
  -- A record's chain is its company's, or no_company's (decision D7).
  ADD CONSTRAINT audit_chain_is_company
    CHECK (chain IS NULL OR chain = coalesce(tenant, 'no_company')),
  -- Two records never share a place, or a predecessor, in one chain (decision D6).
  ADD CONSTRAINT audit_one_place UNIQUE (chain, chain_position),
  ADD CONSTRAINT audit_one_successor UNIQUE (chain, previous_hash);

-- At the commit of the record's transaction: its chain, its place after the chain's last, that
-- one's fingerprint, and its own. Deferred to the commit, so the chain's lock is held only while
-- the transaction ends, never while it does its work: taken at the insert, the lock was held to the
-- end of every call, made a company's calls wait for each other, and locked two rule drafts
-- against each other (found while building; step 39's README, decision D2). Of two records
-- committed at once, the second waits, then follows the first. With the rights of the function's
-- owner, the migration's login, so the chain's last record is found in every company's rows.
CREATE FUNCTION dsor.audit_chains() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  named text := coalesce(NEW.tenant, 'no_company');
  last_place bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dsor.audit/' || named, 0));
  SELECT a.chain_position, a.record_hash INTO last_place, last_hash
    FROM dsor.audit a
   WHERE a.chain = named AND a.chain_position IS NOT NULL
   ORDER BY a.chain_position DESC LIMIT 1;
  UPDATE dsor.audit
     SET chain = named,
         chain_position = coalesce(last_place, 0) + 1,
         previous_hash = coalesce(last_hash, 'sha256:' || repeat('0', 64))
   WHERE sequence = NEW.sequence;
  UPDATE dsor.audit a SET record_hash = dsor.audit_fingerprint(a) WHERE sequence = NEW.sequence;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION dsor.audit_chains() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER audit_chain AFTER INSERT ON dsor.audit
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dsor.audit_chains();
