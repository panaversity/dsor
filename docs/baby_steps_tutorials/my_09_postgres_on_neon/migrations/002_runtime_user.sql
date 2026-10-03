-- What the application may do to the log, and what it may not.
--
-- This file is the point of step 09.
--
-- Step 08's chain makes tampering *detectable*: change a record and every fingerprint after it stops
-- matching. What it cannot do is stop the program changing it, because the program holds the array.
-- §30 is blunt about the difference:
--
--     The account DSoR itself runs under has no permission to edit or delete log rows.
--
-- `dsor_runtime` is the account the application connects as. The owner — the account that ran this
-- migration — keeps the right to change the table's shape, and the application never connects as it.
--
-- Rule DSOR-AUD-04a: the DSoR runtime identity MUST NOT be able to update or delete audit records.
--
-- ONE THING TO UNDERSTAND BEFORE READING THE SQL, because I had it backwards.
--
-- I wrote this file believing the REVOKE lines were what made the log safe. They are not. Measured
-- against PostgreSQL 18:
--
--   fresh table, nothing granted:  privileges = (none)
--   after GRANT INSERT, SELECT:    privileges = INSERT, SELECT
--   after REVOKE UPDATE, DELETE:   privileges = INSERT, SELECT   <- unchanged
--
-- A freshly created table grants nothing to anybody, so there is nothing for a REVOKE to take away.
-- **What makes the log safe is the GRANT being narrow, not the REVOKE being present.** A mutation
-- sweep proved it: deleting a REVOKE line left every test passing, because every test started from
-- a fresh table.
--
-- The REVOKEs stay, and the honest reason is below each one. They are a second answer to a question
-- the GRANT already answers, for a database that is not fresh — and `audit-permissions.test.ts`
-- tests them that way, by granting something first so there is something to remove.
--
-- UPDATED 2026-10-04: those tests now kill the mutants, and the sentence above is history rather
-- than a current state. Two of them were still alive until today:
--
--   REVOKE ALL ON audit FROM PUBLIC  ->  REVOKE UPDATE ON audit FROM PUBLIC    301 tests passed
--   REVOKE UPDATE, DELETE, TRUNCATE ... FROM dsor_runtime  ->  deleted          301 tests passed
--
-- The first survived because the test granted only UPDATE to PUBLIC, so the one privilege it
-- checked was the one the narrowed line still removed. The test grants all three now, and the
-- privilege check asks `has_table_privilege` rather than reading the grant catalogue — a catalogue
-- row exists only for a grant made to the role *by name*, and a right arriving through PUBLIC has
-- no such row. Both mutants now fail a test.

-- Add a row, and read rows back. That is the whole of what writing an audit log needs — and it is
-- this line, the narrow one, that the guarantee rests on.
GRANT INSERT, SELECT ON audit TO dsor_runtime;

-- A no-op on a fresh table, and not a no-op on a database somebody has already been administering.
-- A privilege can arrive without anyone granting it to this role: through PUBLIC, or through a role
-- it is a member of. "We never granted it" and "it does not have it" are different statements, and
-- this is the second one.
--
-- TRUNCATE is named explicitly because it is its own privilege, not part of DELETE, and it empties
-- the table in one statement. A log the application can TRUNCATE is not append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON audit FROM dsor_runtime;

-- PUBLIC is every role there is or ever will be, so a privilege granted to PUBLIC reaches
-- dsor_runtime without anybody granting it anything. Also a no-op on a fresh table in PostgreSQL,
-- and the one line here most likely to matter on a database with a history.
REVOKE ALL ON audit FROM PUBLIC;

-- There was a second `GRANT INSERT, SELECT ON audit TO dsor_runtime;` here, with the comment
-- "granted again, because the line above revokes from PUBLIC and dsor_runtime is a member of
-- PUBLIC". That is a false statement about PostgreSQL. `REVOKE ... FROM PUBLIC` revokes the grant
-- made *to PUBLIC*; it does not touch a grant made directly to a role that happens to be a member
-- of it. Measured against PostgreSQL 18:
--
--   after GRANT INSERT, SELECT to the role:   INSERT=true SELECT=true
--   after REVOKE ALL ON audit FROM PUBLIC:    INSERT=true SELECT=true   <- the direct grant survives
--
-- So the line was a no-op in every case, and no test could ever have killed it. Deleting a line
-- that protects nothing is better than keeping it with a reason that is not true, because the next
-- reader would have learned the wrong rule from it.

-- A role that can create tables can create one called `audit` in a schema earlier on its own search
-- path, and then every INSERT lands somewhere nobody is auditing.
--
-- Measured: on PostgreSQL 15 and later this is a no-op, because `public` stopped granting CREATE to
-- PUBLIC in version 15. On 14 and earlier it is the line that closes the hole. Both revokes are kept
-- because a learner may well be pointing this at an older server.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM dsor_runtime;

-- USAGE is permission to *look inside* the schema at all. Without it the application cannot reach
-- the table even holding INSERT on it.
--
-- Measured, and a no-op here: `public` grants USAGE to PUBLIC by default and the line above revokes
-- only CREATE, so dsor_runtime already has USAGE. No test can kill this line, and it is kept for the
-- setup where somebody has revoked USAGE from PUBLIC — which hardened deployments do, and which is
-- the first thing to check if the application ever reports that the table does not exist.
GRANT USAGE ON SCHEMA public TO dsor_runtime;
