-- The claims of idempotency keys, in DSoR's own store (DSOR-IDM-01b,
-- DSOR-MOD-01). Each row is one key, claimed inside its four walls: the company, the caller,
-- the operation, and the key. `pnpm migrate` runs this file once, as the owner, after 012b
-- (step 20's README, decisions 4, 6, and 12).
CREATE TABLE dsor.idempotency (
  tenant_id       text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  -- The caller's id: an agent's, or a person's.
  principal       text NOT NULL,
  -- The operation's id, without its version (decision 4).
  operation       text NOT NULL,
  -- The key, as line ① checked it: the database checks it a second time (decision 2).
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  -- The fingerprint of the request: SHA-256 over its canonical JSON (decision 5).
  payload_hash    text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  -- The call that made the claim, so a replay's record can name it (decision 8).
  request_id      text NOT NULL,
  -- How the first call's work ended: {"value": ...}, what the command's code returned, or
  -- {"refused": ...}, the refusal it gave (decision 9). Empty until the work is done, in the
  -- same transaction as the claim (decision 6). json, not jsonb: json keeps the text as it was
  -- written, so a replay's fields come back in the first answer's order (decision 12).
  answer          json,
  -- The database's clock says when the claim was made (DSOR-IDM-02).
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal, operation, idempotency_key)
);

-- The lock of the company's tables, on claims: a claim is read and written only inside a
-- transaction that set its company (DSOR-TEN-02a, DSOR-TEN-01b; step 11's README,
-- decisions 1 and 2).
ALTER TABLE dsor.idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.idempotency
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- An answer is written once. An UPDATE may touch a claim whose answer is still empty, and
-- must leave an answer in it. The policy is restrictive, so the company's policy still applies
-- too (decision 12; step 19b's README, decision 13, for slips).
CREATE POLICY answer_once ON dsor.idempotency AS RESTRICTIVE FOR UPDATE TO dsor_runtime
  USING (answer IS NULL) WITH CHECK (answer IS NOT NULL);

-- dsor_runtime reads claims, adds one through named columns, and fills its answer. No DELETE,
-- and no change to a key or a fingerprint. claimed_at is the database's to fill.
GRANT SELECT ON dsor.idempotency TO dsor_runtime;
GRANT INSERT (tenant_id, principal, operation, idempotency_key, payload_hash, request_id)
  ON dsor.idempotency TO dsor_runtime;
GRANT UPDATE (answer) ON dsor.idempotency TO dsor_runtime;
