-- NEW IN STEP 17: the company's payments, the first company table that DSoR writes.
-- `pnpm migrate` runs this file once, as the owner, after 008 (step 17's README, outcome 1).

CREATE TABLE app.payments (
  -- The database numbers each payment from 901, and writes its id from that number, so the
  -- program writes neither. One counter for every company (step 17's README, decision 15
  -- and "Left open"). An identity column takes its next number with no privilege on the
  -- counter, so dsor_runtime holds none (step 16's README, decision 3).
  number          bigint GENERATED ALWAYS AS IDENTITY (START WITH 901) PRIMARY KEY,
  id              text GENERATED ALWAYS AS ('PAY-' || number::text) STORED UNIQUE,
  tenant_id       text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  invoice_id      text NOT NULL,
  vendor_id       text NOT NULL,
  -- Money is exact, as in app.invoices (step 09's README, decision 7).
  amount_value    numeric NOT NULL,
  amount_currency char(3) NOT NULL,
  -- No default: the program writes draft itself, so dsor_runtime may change the column
  -- (step 17's README, decision 12).
  status          text NOT NULL CHECK (status IN ('draft', 'cancelled')),
  -- The key to the invoice starts with the row's own company, so it can point only at an
  -- invoice of that company (step 11's README, decision 9; step 17's README, decision 16).
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices (tenant_id, id)
);

-- The lock of app.invoices, on payments: a row is read, written, and changed only inside a
-- transaction that set its company (DSOR-TEN-01b, DSOR-RP-01b; step 11's README,
-- decisions 1 and 2). A policy with USING alone checks the rows written too.
ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.payments
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads payments, adds a draft through named columns, and changes the status
-- alone. No DELETE, and no UPDATE of an amount (step 17's README, decision 3). 001 took
-- every privilege away first, but this table did not exist then, so it starts with none.
GRANT SELECT ON app.payments TO dsor_runtime;
GRANT INSERT (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
  ON app.payments TO dsor_runtime;
GRANT UPDATE (status) ON app.payments TO dsor_runtime;
