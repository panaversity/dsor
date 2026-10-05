-- NEW IN STEP 10: the invoices, as rows, each carrying its company.
--
-- Step 09 moved the audit log into PostgreSQL and left the invoices in a list on purpose, so that
-- step had one idea. This step's idea is the company, and "a tenant_id on every row" needs rows.
--
-- Rule DSOR-TEN-01a: every tenant-owned resource MUST carry its tenant_id.

CREATE TABLE public.invoices (
  tenant_id       TEXT    NOT NULL,
  id              TEXT    NOT NULL,
  vendor          TEXT    NOT NULL,
  -- Exact, never a float: NUMERIC keeps 31400.00 as 31400.00. The program reads it back as text
  -- and hands it to money(), which is the only way an amount is ever built.
  amount_value    NUMERIC(18, 2) NOT NULL CHECK (amount_value >= 0),
  amount_currency TEXT    NOT NULL CHECK (amount_currency ~ '^[A-Z]{3}$'),
  status          TEXT    NOT NULL CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),

  -- This line is the step. An invoice number alone is not an identity: org_456 and org_789 both
  -- have an INV-1008, and the key says so. Every lookup and every change must name the company.
  PRIMARY KEY (tenant_id, id)
);

-- What the application may do to an invoice, and what it may not. The same shape as 002 for the
-- audit log, with the same reasoning: the narrow GRANT is the guarantee.
--
-- UPDATE is granted column by column, and `status` is the only column on the list. The application
-- may issue an invoice; it may not move one to another company or renumber it. Nothing in this step
-- creates or removes an invoice, so it holds neither INSERT nor DELETE — the running example is
-- inserted by the owner, in 004.
REVOKE ALL ON public.invoices FROM PUBLIC;
GRANT SELECT ON public.invoices TO dsor_runtime;
GRANT UPDATE (status) ON public.invoices TO dsor_runtime;
