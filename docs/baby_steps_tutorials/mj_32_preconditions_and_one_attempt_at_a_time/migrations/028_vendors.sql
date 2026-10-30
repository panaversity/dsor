-- NEW IN STEP 32: the company's vendors, the accounts system's records beside its invoices.
-- `pnpm migrate` runs this file once, as the owner, after 027 (step 32's README, decision D1).
-- DSoR reads a vendor's status before a payment, and never writes it: the accounts team approves
-- and suspends vendors in the accounts system, as it issues invoices.

CREATE TABLE app.vendors (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  id        text NOT NULL,
  status    text NOT NULL CHECK (status IN ('approved', 'suspended')),
  -- The row's version, which the database raises at each change, as an invoice's (step 21's
  -- README, decision 2).
  version   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, id)
);

CREATE TRIGGER vendors_version BEFORE UPDATE ON app.vendors
  FOR EACH ROW EXECUTE FUNCTION app.next_version();

-- The lock of app.invoices, on vendors: a row is read only inside a transaction that set its
-- company (DSOR-TEN-01b, DSOR-RP-01b; step 11's README, decisions 1 and 2).
ALTER TABLE app.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.vendors
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads vendors, and nothing more.
GRANT SELECT ON app.vendors TO dsor_runtime;

-- The story's vendors, each approved: the vendors of the invoices of migrations 001, 002, and 006.
INSERT INTO app.vendors (tenant_id, id, status) VALUES
  ('org_456', 'VENDOR-12', 'approved'),
  ('org_456', 'VENDOR-31', 'approved'),
  ('org_456', 'VENDOR-44', 'approved'),
  ('org_789', 'VENDOR-77', 'approved');
