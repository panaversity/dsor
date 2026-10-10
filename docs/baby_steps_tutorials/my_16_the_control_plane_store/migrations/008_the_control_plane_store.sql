-- NEW IN STEP 16: DSoR's paperwork gets a place of its own (DSOR-MOD-01, decision 122).
--
-- The log was public.audit, beside the business's public.invoices, in the schema the business's
-- own tools treat as theirs: an accounting upgrade that resets its tables, or a cleanup that empties
-- public, would take DSoR's evidence with it. It moves into dsor, as it is: every record, the hash
-- chain, the column grants and the row-level security go with the table, and nothing is copied. A
-- record's hash covers its own fields, not the table's name, so the move cannot break the chain.
--
-- Migrations 001 to 007 still say public.audit: an applied migration is never edited, because its
-- checksum covers every byte. This one says where the log went.
--
-- The same database, and not a second one, so that in step 36 a business change and DSoR's record
-- of it can be saved together, or not at all.

CREATE SCHEMA dsor;

-- A new schema gives PUBLIC nothing, unlike public itself; said anyway, so nobody has to know that.
REVOKE ALL ON SCHEMA dsor FROM PUBLIC;

-- The application may look inside, and may create nothing there. What it may do to each table is
-- the table's own grant, and the log's grants move with it.
GRANT USAGE ON SCHEMA dsor TO dsor_runtime;

ALTER TABLE public.audit SET SCHEMA dsor;
