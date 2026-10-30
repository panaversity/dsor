-- NEW IN STEP 14: two columns for the record of a read.
--
-- A read that handed out confidential data is written down with the rows it returned
-- (`resources`, their addresses) and how many (`extensions`, under the tutorial's namespace), as
-- DSOR-CLS-05 asks. Both are optional columns on the same table and inside the same hash chain:
-- the record of a read is an audit record like any other, and audit-record.schema.json already has
-- both fields. Nothing changes for the records written so far, which leave both empty.
ALTER TABLE public.audit
  ADD COLUMN resources  JSONB,
  ADD COLUMN extensions JSONB;

-- Step 09's GRANT on the log is column by column, so that the application can never name
-- `recorded_at`. A column-level grant does not grow with the table: measured, the first version of
-- this file stopped at the ALTER, and every INSERT — decisions included — was refused with
-- "permission denied for table audit". The new columns are granted here, on purpose, and nothing
-- else changes: `dsor_runtime` still may not UPDATE, DELETE or TRUNCATE, which is the whole point —
-- the decision record was written before the handler ran and can never be amended, so what the
-- read returned has to be a second record.
GRANT INSERT (resources, extensions) ON public.audit TO dsor_runtime;
