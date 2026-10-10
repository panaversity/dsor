-- NEW IN STEP 17: the running example's vendor and payment (decision 125).
--
-- VENDOR-44 is approved in both companies, and PAY-901 is org_456's draft for 31,400.00 USD, paying
-- INV-1008, as in the specification's running example. org_789 holds a PAY-901 too, paying its own
-- INV-1008, for the same reason it holds an INV-1008 (step 12): a command that forgot to say its
-- company would have the other company's row to touch, and the cross-tenant suite asks that it is
-- untouched. Its amount, 7700.00, appears nowhere in org_456's data, so a leak would show.
--
-- Before the lock (011), like 004 before 005, so that any owner can apply it. The tests put the
-- story back by running this file again, which is why every row says ON CONFLICT DO NOTHING.

INSERT INTO public.vendors (tenant_id, id, status) VALUES
  ('org_456', 'VENDOR-44', 'approved'),
  ('org_789', 'VENDOR-44', 'approved')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO public.payments (tenant_id, id, vendor, invoice, amount_value, amount_currency, status) VALUES
  ('org_456', 'PAY-901', 'VENDOR-44', 'INV-1008', 31400.00, 'USD', 'draft'),
  ('org_789', 'PAY-901', 'VENDOR-44', 'INV-1008', 7700.00, 'USD', 'draft')
ON CONFLICT (tenant_id, id) DO NOTHING;
