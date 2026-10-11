-- STEP 10: the running example, as rows.
--
-- The specification's own story — org_456, VENDOR-44, INV-1008 for 31,400.00 USD — and this step's
-- addition: a second company, org_789, with an INV-1008 of its own. The same number on purpose. It
-- is the sharpest proof that a number alone is not an identity, and the leak step 09's store would
-- have had the day a second company existed.
--
-- Written here once, so the tests that put the invoices back to how they started re-run this file
-- rather than keep a second copy of the story — after deleting every row, which is what restores a
-- status. ON CONFLICT only keeps a stray second run from failing; no path exercises it.

INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status) VALUES
  ('org_456', 'INV-1008', 'VENDOR-44', 31400.00, 'USD', 'issued'),
  ('org_456', 'INV-1009', 'VENDOR-44', 2500.00,  'USD', 'draft'),
  ('org_789', 'INV-1008', 'VENDOR-44', 18000.00, 'USD', 'draft'),
  -- STEP 12: org_789 holds every invoice number the examples name, as a draft. The
  -- cross-tenant suite asks, for each operation, that the other company's rows are untouched
  -- after a call with its address — and a careless command can only touch a row that is there.
  -- Without this row the question passed for invoice.issue because org_789 had no INV-1009,
  -- which is not the same as the command being careful; the suite now refuses that hollow pass.
  ('org_789', 'INV-1009', 'VENDOR-44', 9100.00,  'USD', 'draft'),
  -- And one number org_789 alone has, so a test can still ask for an invoice the other company
  -- holds and be told there is no such invoice in yours.
  ('org_789', 'INV-2001', 'VENDOR-44', 4200.00,  'USD', 'draft')
ON CONFLICT (tenant_id, id) DO NOTHING;
