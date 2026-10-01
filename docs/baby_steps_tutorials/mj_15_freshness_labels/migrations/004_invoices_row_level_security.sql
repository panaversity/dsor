-- NEW IN STEP 11: the second lock, on the company's data. `pnpm migrate` runs this file
-- once, as the owner, after 003 (step 11's README, decision 1).

-- Row-level security: PostgreSQL adds the policy below to every query on this table, by
-- itself. FORCE applies it to the table's owner too (DSOR-RP-01b). Nothing inside a table
-- stops a role that holds BYPASSRLS, such as Neon's neondb_owner. The program never runs
-- as one: step 09's start-up check refuses that login (DSOR-RP-01a).
ALTER TABLE app.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoices FORCE ROW LEVEL SECURITY;

-- A row is seen, and could be written, only inside a transaction that set its company
-- (DSOR-TEN-01b). With no company set, the setting is NULL on a fresh connection, and ''
-- on one that has held a company. nullif makes both mean "no company", which matches no
-- row (DSOR-RP-01d; step 11's README, decisions 2 and 5).
CREATE POLICY tenant_isolation ON app.invoices
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
