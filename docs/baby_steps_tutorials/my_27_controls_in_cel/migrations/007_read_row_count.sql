-- NEW IN STEP 14, decision 109: the record of a read keeps its row count in the field the schema
-- has for it.
--
-- audit-record.schema.json has `row_count`, a whole number of at least 0, beside `resources`.
-- Migration 006 put the count under `extensions` instead, and its comment says so: the schema's own
-- field was missed. `extensions` is for the fields an implementation adds (DSOR-SCH-02), so a
-- checker that follows the specification looked in `row_count` and found nothing.
--
-- 006 is not edited. It has been applied, and a migration's checksum covers every byte, comments
-- included. Its `extensions` column stays, and step 14 writes nothing to it.
ALTER TABLE public.audit
  ADD COLUMN row_count INTEGER CHECK (row_count >= 0);

-- The same lesson as 006. Step 09's GRANT INSERT on the log names its columns one by one, so that
-- the application can never write `recorded_at`, and a column-level grant does not grow with the
-- table. Without this line every record of a read is refused, and so is every confidential read.
-- Nothing else changes: `dsor_runtime` still may not UPDATE, DELETE or TRUNCATE.
GRANT INSERT (row_count) ON public.audit TO dsor_runtime;
