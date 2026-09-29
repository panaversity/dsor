-- NEW IN STEP 10: a second company moves in. `pnpm migrate` runs this file once, as the
-- owner, after 001 (step 10's README, decision 8). 001 is never edited: it has run, so it
-- is history.

-- Every invoice row carries its company (DSOR-TEN-01a). The rows already here are
-- org_456's, the only company step 09 knew. Then the company becomes required.
ALTER TABLE app.invoices ADD COLUMN tenant_id text;
UPDATE app.invoices SET tenant_id = 'org_456';
ALTER TABLE app.invoices ALTER COLUMN tenant_id SET NOT NULL;
-- The form of a tenant id that this tutorial chose in step 02, so the table cannot hold a
-- name such as acme.
ALTER TABLE app.invoices
  ADD CONSTRAINT invoices_tenant_id_form CHECK (tenant_id ~ '^org_[0-9]+$');

-- The key becomes (company, id), so both companies can have an INV-1008 (step 10's
-- README, decision 5). invoices_pkey is the name Postgres gave 001's key.
ALTER TABLE app.invoices DROP CONSTRAINT invoices_pkey;
ALTER TABLE app.invoices ADD PRIMARY KEY (tenant_id, id);

-- org_789's invoices: its own INV-1008, and INV-2001, which org_456 does not have. These
-- are this step's own, not the specification's running example (decision 5).
INSERT INTO app.invoices
  (tenant_id, id, vendor_id, amount_value, amount_currency,
   open_amount_value, open_amount_currency, status)
VALUES
  ('org_789', 'INV-1008', 'VENDOR-77', 99000.00, 'USD', 99000.00, 'USD', 'issued'),
  ('org_789', 'INV-2001', 'VENDOR-77', 12500.00, 'USD', 12500.00, 'USD', 'issued');

-- Every audit record names the company it was made in. Empty for a refusal made before
-- DSoR has checked a company (step 10's README, decision 6).
ALTER TABLE dsor.audit ADD COLUMN tenant text CHECK (tenant ~ '^org_[0-9]+$');
-- The letterbox gains one slot: dsor_runtime may write this column too. Still no UPDATE,
-- no DELETE, no TRUNCATE.
GRANT INSERT (tenant) ON dsor.audit TO dsor_runtime;
