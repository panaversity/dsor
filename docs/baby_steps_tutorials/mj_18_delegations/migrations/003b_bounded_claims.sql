-- Added by the Stage 2 review, 2026-10-01. `pnpm migrate` runs it once, after 003: its name
-- sorts after 003_ and before 004_. 003 has run, so it is history and is not edited (step
-- 10's README, decision 8).

-- A company id had no limit on its length, and a non-member's claim is kept whole under
-- extensions. One refused call left a record of 1,000,433 bytes, which dsor_runtime can
-- never remove: audit flooding, threat T12 in §10.2. The code now keeps only an id of at most
-- 18 digits. This is the second guard, in case the code ever changes: the database refuses
-- an extensions larger than 1 KiB (step 10's README, decision 12). Found by the Stage 2
-- review, and fixed from step 10 on.
-- NOT VALID: the check applies to every new record, and the records already kept are not
-- read again. The log never changes a record, and a branch that already holds a large one
-- would otherwise refuse this file.
ALTER TABLE dsor.audit
  ADD CONSTRAINT audit_extensions_size
  CHECK (extensions IS NULL OR octet_length(extensions::text) <= 1024) NOT VALID;
