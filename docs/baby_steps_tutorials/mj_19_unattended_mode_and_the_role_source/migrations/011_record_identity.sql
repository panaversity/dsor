-- The record of an agent's call names its slip and its person, in the audit
-- record schema's own fields, identity and delegation. A person's record leaves both empty
-- (step 18's README, decision 8). `pnpm migrate` runs this file once, after 010.
ALTER TABLE dsor.audit ADD COLUMN identity jsonb, ADD COLUMN delegation text;

-- dsor_runtime adds them, as it adds every other column of the log, and never changes them
-- (step 09's README, decision 6).
GRANT INSERT (identity, delegation) ON dsor.audit TO dsor_runtime;
