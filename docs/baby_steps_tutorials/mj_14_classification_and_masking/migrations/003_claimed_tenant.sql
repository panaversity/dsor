-- NEW IN STEP 10: added after the review. `pnpm migrate` runs it once, after 002.
-- 002 has run, so it is history and is not edited (step 10's README, decision 8).

-- Fields this tutorial adds to a record sit under extensions, keyed by a reverse domain
-- name (DSOR-SCH-02). The first: the company a non-member asked for, kept as a claim and
-- never as the record's tenant (step 10's README, decision 6).
ALTER TABLE dsor.audit ADD COLUMN extensions jsonb;
-- One more slot in the letterbox. Still no UPDATE, no DELETE, no TRUNCATE.
GRANT INSERT (extensions) ON dsor.audit TO dsor_runtime;
