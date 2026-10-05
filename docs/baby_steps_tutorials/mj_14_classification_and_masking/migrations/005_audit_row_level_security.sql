-- NEW IN STEP 11: the second lock, on DSoR's own log. `pnpm migrate` runs this file once,
-- as the owner, after 004 (step 11's README, decisions 1 and 4).
ALTER TABLE dsor.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.audit FORCE ROW LEVEL SECURITY;

-- Writing: a record carries exactly the company set in its transaction, or none when none
-- is set. IS NOT DISTINCT FROM is =, except that NULL matches NULL. nullif makes an unset
-- company NULL, on a fresh connection and on a reused one (step 11's README, decision 2).
CREATE POLICY audit_write ON dsor.audit FOR INSERT
  WITH CHECK (tenant IS NOT DISTINCT FROM nullif(current_setting('dsor.tenant_id', true), ''));

-- Reading: only the active company's records (DSOR-TEN-02a). A record with no company
-- matches no company, so dsor_runtime writes it and can never read it back, like the
-- letterbox of step 09. The owner reads it, because it holds BYPASSRLS.
CREATE POLICY audit_read ON dsor.audit FOR SELECT
  USING (tenant = nullif(current_setting('dsor.tenant_id', true), ''));
