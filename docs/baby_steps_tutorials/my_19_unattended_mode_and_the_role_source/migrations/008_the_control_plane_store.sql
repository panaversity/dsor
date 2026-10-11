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

-- On a fresh server a new schema gives nobody anything, and these two lines take away nothing. On
-- a server whose administrator set default privileges for schemas, a new schema can hand CREATE to
-- every role and to the application by name; a review measured both (decision 123). So both are
-- taken back here, each named, the way 002 takes CREATE on public back. Only the migrations, run as
-- the owner, put anything in DSoR's schema: a table the application made there would be its own.
REVOKE ALL ON SCHEMA dsor FROM PUBLIC;
REVOKE CREATE ON SCHEMA dsor FROM dsor_runtime;

-- The application may look inside, and that is all. What it may do to each table is the table's
-- own grant, and the log's grants move with it.
GRANT USAGE ON SCHEMA dsor TO dsor_runtime;

ALTER TABLE public.audit SET SCHEMA dsor;
