-- NEW IN STEP 14: what a read returned, in its record. `pnpm migrate` runs this file once,
-- as the owner, after 006 (DSOR-CLS-05; step 14's README, decision 7).

-- The audit record's own fields: the canonical URIs of the records the answer returned,
-- and how many. URIs and a count, never a value that was read (DSOR-AUD-05a). Both are
-- NULL on a refusal, which returned nothing. The answer's label goes in extensions,
-- which 003 added.
ALTER TABLE dsor.audit ADD COLUMN resources text[];
ALTER TABLE dsor.audit ADD COLUMN row_count integer CHECK (row_count >= 0);

-- Two more slots in the letterbox. Still no UPDATE, no DELETE, no TRUNCATE.
GRANT INSERT (resources, row_count) ON dsor.audit TO dsor_runtime;
