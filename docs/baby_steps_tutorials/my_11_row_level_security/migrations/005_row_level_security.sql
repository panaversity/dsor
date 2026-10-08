-- NEW IN STEP 11: the second lock. PostgreSQL itself hides every other company's rows.
--
-- Step 10 kept the two companies apart with a WHERE in every query. That is one lock, and the
-- program holds it alone. Measured on step 10's own database, as dsor_runtime:
--
--   SELECT … FROM invoices WHERE id = 'INV-1008'        <- the company forgotten
--   org_456  INV-1008  31400.00  issued
--   org_789  INV-1008  18000.00  draft
--
-- One missing WHERE, and org_456's program holds org_789's invoice. No test failed, because the
-- tests only check the queries that exist today. This file is the lock for the query somebody writes
-- next year.
--
-- Rule DSOR-TEN-01b: tenant isolation MUST be enforced in at least two independent layers: DSoR
-- core, and the connector or store.
-- Rule DSOR-RP-01b: tenant tables MUST use FORCE ROW LEVEL SECURITY.
-- Rule DSOR-RP-01d: a query executed with no tenant setting MUST yield no rows.

-- ENABLE turns the lock on. FORCE is the first trap on the map: by default the table's *owner*
-- skips every policy on its own table, and FORCE makes the owner subject to them too. One honest
-- limit, measured: a superuser skips every policy whatever the table says, and so does a role with
-- BYPASSRLS. Two of this tutorial's three owners are superusers — PGlite's `postgres`, and the
-- local server's `dsor_owner`, which initdb created — so FORCE changes nothing for them. Neon's
-- `neondb_owner` is not: it is a member of `neon_superuser`, and PostgreSQL passes no attribute
-- through membership, so on Neon FORCE is exactly what filters the owner until it runs
-- `SET ROLE neon_superuser`. (This comment first put Neon's owner with the superusers; an
-- evaluation read it against decision 95 and the two could not both be true.) FORCE is here for
-- that owner, for the owner that is not a superuser which `row-level-security.test.ts` creates,
-- and because the rule says so. What keeps the lock honest is that the program never runs as any
-- owner: `database.ts` refuses to start if it does.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;

-- The policy. A row is visible when its company is the one this transaction said.
--
-- `current_setting('dsor.tenant_id', true)`: the second argument means "missing is fine, answer
-- NULL". With no company said the comparison is NULL, NULL is not true, and the row is hidden — so a
-- statement with no company gets no rows (DSOR-RP-01d), which is the safe answer to a forgotten
-- company. Without that `true`, a missing setting is an error instead, which is also safe, and
-- which would turn every catalogue question the start-up check asks into a failure.
--
-- USING is checked on every row a statement reads — including the rows an UPDATE or DELETE looks
-- for — and WITH CHECK on every row a statement writes. The second is spelled out although an ALL
-- policy would use the USING expression for it anyway: it is the half that stops a bug which
-- computed the wrong chain from writing a record into another company's log.
CREATE POLICY tenant_isolation ON public.invoices
  USING      (tenant_id = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('dsor.tenant_id', true));

-- The audit log, the same way. Every record carries its company (`tenant`), and one chain per
-- company was step 10's rule (DSOR-TEN-02a); here the database enforces what the chain name only
-- implied. A refusal with no company is written to every company the caller belongs to, one
-- statement each, each saying its own company — so this policy admits each of them.
ALTER TABLE public.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.audit
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));

-- What the policy checks is `tenant`, and only `tenant`. A first version of this file said the
-- WITH CHECK above "stops a bug which computed the wrong chain from writing a record into another
-- company's log", and a review measured that it does not: from org_456's transaction, a row with
-- tenant org_456 and chain audit:org_789 went in. The two values come from one variable in
-- audit.ts today, so no path writes such a row — and the day one does, org_789's head, filtered by
-- its own tenant, never sees the stray row, computes the same position again, and collides on
-- every write after. A constraint says what the comment could only claim.
ALTER TABLE public.audit
  ADD CONSTRAINT chain_matches_tenant CHECK (chain = 'audit:' || tenant);

-- No GRANT changes. Row-level security sits *under* the grants of 002 and 003: a policy decides
-- which rows a statement may see, and only among the statements the grants already allow. The
-- application still cannot UPDATE the log or INSERT an invoice; now it also cannot see a row that
-- is not its company's.
