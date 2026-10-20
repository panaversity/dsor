-- NEW IN STEP 23: the claim keeps how the request was called (DSOR-IDM-01d, decision 138).
--
-- A key names one logical request, and how it was called is part of the request. Without this, a
-- key used to prepare a payment (propose_only), sent again to execute it, was the same request, and
-- the caller was handed the prepared answer and believed it had executed. A validate_only request
-- claims no key, so a claim is for execute or propose_only. Claims made before this migration were
-- all execute.

ALTER TABLE dsor.idempotency_keys
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'execute' CHECK (mode IN ('execute', 'propose_only'));

-- Written with the claim, and never changed: a claim whose mode could be changed is a claim on
-- another request.
GRANT INSERT (mode) ON dsor.idempotency_keys TO dsor_runtime;
