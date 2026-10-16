-- NEW IN STEP 26: VENDOR-44 bills org_456 in rupees and in pounds (decision 159).
--
-- Until this step every bill was in dollars, like del_100's limits, so DSoR never had to compare
-- two currencies. These two make it. INV-1010, 2,800,000.00 PKR, is 10,000.00 USD at 280 rupees to
-- the dollar: under del_100's limit of 50,000.00 USD a payment. INV-1011, 45,000.00 GBP, is
-- 56,250.00 USD at 0.80 pounds to the dollar: above it, though 45,000 is less than 50,000.
--
-- Rows only. The tests put the story back by deleting every invoice and running this file again,
-- as they run 004, which is why it says ON CONFLICT DO NOTHING. The company is said first, so an
-- owner without BYPASSRLS can apply it under 005's lock too.

SELECT set_config('dsor.tenant_id', 'org_456', true);

INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status) VALUES
  ('org_456', 'INV-1010', 'VENDOR-44', 2800000.00, 'PKR', 'issued'),
  ('org_456', 'INV-1011', 'VENDOR-44', 45000.00,   'GBP', 'issued')
ON CONFLICT (tenant_id, id) DO NOTHING;
