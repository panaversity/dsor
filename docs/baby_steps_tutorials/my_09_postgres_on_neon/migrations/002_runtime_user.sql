-- What the application may do to the log, and what it may not.
--
-- This file is the whole point of step 09.
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

-- Add a row, and read rows back. That is the whole of what writing an audit log needs.
GRANT INSERT, SELECT ON audit TO dsor_runtime;

-- And nothing else. REVOKE rather than simply not granting, because a role can inherit a privilege
-- from PUBLIC or from a role it is a member of — "we never granted it" is not the same statement as
-- "it does not have it". This says it does not have it.
REVOKE UPDATE, DELETE, TRUNCATE ON audit FROM dsor_runtime;

-- TRUNCATE is in that list on purpose. It is not DELETE, it has its own privilege, and it empties the
-- table. A log the application can empty in one statement is not append-only, whatever else is true.

-- PUBLIC is every role there is or ever will be. A privilege granted to PUBLIC reaches dsor_runtime
-- without anybody granting it anything, so the two lines above can be perfectly correct and still not
-- hold. This closes that door for the table and for the schema it lives in.
REVOKE ALL ON audit FROM PUBLIC;
GRANT INSERT, SELECT ON audit TO dsor_runtime;

-- The schema too: CREATE on a schema lets a role make its own tables, and a role that can create a
-- table can create one called `audit` in a schema that comes earlier on its search path.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM dsor_runtime;
GRANT USAGE ON SCHEMA public TO dsor_runtime;
