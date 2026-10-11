-- NEW IN STEP 20: idempotency keys, DSoR's third kind of paperwork (DSOR-IDM-01b, decision 131).
--
-- Networks fail and clients retry. A command arrives with a key the caller chose, and DSoR claims
-- it with one INSERT: the primary key below lets exactly one request with the same company, caller,
-- operation and key in, whatever arrives at the same moment. The claim keeps the fingerprint of the
-- request, so the same key with a different request is refused, and, once the request is answered,
-- the answer, so the same request again gets the same answer and nothing runs twice.
--
-- answer is NULL while the first request is still being carried out. A request refused before
-- anything ran, with an answer that invites the same key again, leaves {"released": true}, and the
-- next one with that key and that request takes the claim back, in one UPDATE. Only such a refusal:
-- an answer given after a handler ran is kept, whatever it says (decision 132).

CREATE TABLE dsor.idempotency_keys (
  tenant       TEXT NOT NULL,
  principal    TEXT NOT NULL,
  operation    TEXT NOT NULL,
  key          TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The answer as the text it was written, so that the same request is given it again word for
  -- word. JSONB would put its keys in an order of its own (found building this step).
  answer       TEXT,
  PRIMARY KEY (tenant, principal, operation, key)
);

-- The application claims a key and writes its answer, and nothing else. It never deletes a claim,
-- which would let the same request run again, and never changes whose claim it is, or which request
-- it fingerprints. The right to write an answer would be the right to rewrite one; the second
-- policy below takes that back (decision 132).
REVOKE ALL ON dsor.idempotency_keys FROM PUBLIC;
GRANT SELECT ON dsor.idempotency_keys TO dsor_runtime;
GRANT INSERT (tenant, principal, operation, key, payload_hash) ON dsor.idempotency_keys TO dsor_runtime;
GRANT UPDATE (answer, claimed_at) ON dsor.idempotency_keys TO dsor_runtime;

-- The second lock, word for word as 005, 011 and 013 write it.
ALTER TABLE dsor.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.idempotency_keys
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));

-- And an answer once kept is never rewritten (decision 132). The right to write an answer is the
-- right to rewrite one: a review wrote {"released": true} over a kept receipt as the application,
-- and the same request then made a second payment. This second policy is restrictive, so it is
-- AND'ed with the first: an UPDATE may touch only a claim with no answer yet, or a released one.
-- WITH CHECK (true): what an answer becomes is the program's to say; that a kept one is never
-- touched is the database's. Start-up refuses the table without it.
CREATE POLICY an_answer_is_kept ON dsor.idempotency_keys AS RESTRICTIVE FOR UPDATE
  USING      (answer IS NULL OR answer = '{"released": true}')
  WITH CHECK (true);
