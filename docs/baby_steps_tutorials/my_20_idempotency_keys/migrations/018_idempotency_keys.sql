-- NEW IN STEP 20: idempotency keys, DSoR's third kind of paperwork (DSOR-IDM-01b, decision 131).
--
-- Networks fail and clients retry. A command arrives with a key the caller chose, and DSoR claims
-- it with one INSERT: the primary key below lets exactly one request with the same company, caller,
-- operation and key in, whatever arrives at the same moment. The claim keeps the fingerprint of the
-- request, so the same key with a different request is refused, and, once the request is answered,
-- the answer, so the same request again gets the same answer and nothing runs twice.
--
-- answer is NULL while the first request is still being carried out. A request whose answer invites
-- the same key again, because nothing ran, leaves {"released": true}, and the next one with that key
-- and that request takes the claim back, in one UPDATE.

CREATE TABLE dsor.idempotency_keys (
  tenant       TEXT NOT NULL,
  principal    TEXT NOT NULL,
  operation    TEXT NOT NULL,
  key          TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  answer       JSONB,
  PRIMARY KEY (tenant, principal, operation, key)
);

-- The application claims a key and writes its answer, and nothing else. It never deletes a claim,
-- which would let the same request run again, and never changes whose claim it is, or which request
-- it fingerprints.
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
