-- Each control line ⑩ evaluated, in the decision's record: its id, version, outcome, and the
-- policy it came from, in the audit record's own field (DSOR-EXE-02). NULL on a record that no
-- control governed. `pnpm migrate` runs this file once, as the owner, after 021 (step 27's
-- README, decision D14).
ALTER TABLE dsor.audit ADD COLUMN controls jsonb;

-- One more column that dsor_runtime may write in a new record. Still no UPDATE, no DELETE, no
-- TRUNCATE: a record, once written, stays as it was written.
GRANT INSERT (controls) ON dsor.audit TO dsor_runtime;
