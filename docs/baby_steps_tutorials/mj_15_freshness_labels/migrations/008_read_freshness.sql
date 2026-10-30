-- NEW IN STEP 15: which connector served a read, in its record. `pnpm migrate` runs this
-- file once, as the owner, after 007 (step 15's README, decision 7).

-- The audit record's own field. NULL on a refusal, which returned nothing it read. The
-- read's mode and time have no field in the record's schema, so they go in extensions,
-- beside step 14's classification.
ALTER TABLE dsor.audit ADD COLUMN connector text;

-- One more slot in the letterbox. Still no UPDATE, no DELETE, no TRUNCATE.
GRANT INSERT (connector) ON dsor.audit TO dsor_runtime;
