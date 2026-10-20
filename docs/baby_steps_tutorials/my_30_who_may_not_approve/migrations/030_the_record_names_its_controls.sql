-- NEW IN STEP 27: the decision's record names each control evaluated (DSOR-EXE-02, decision 162).
--
-- Its id and version, its outcome, the policy it came from, and why it could not be evaluated when
-- it could not: the schema's `controls`, inside the record's hash like every other field. Granted by
-- name, like every column the application writes.

ALTER TABLE dsor.audit ADD COLUMN controls JSONB;

GRANT INSERT (controls) ON dsor.audit TO dsor_runtime;
