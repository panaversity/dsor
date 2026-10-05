-- NEW IN STEP 10: the running example, as rows.
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
  ('org_789', 'INV-1008', 'VENDOR-44', 18000.00, 'USD', 'draft')
ON CONFLICT (tenant_id, id) DO NOTHING;
