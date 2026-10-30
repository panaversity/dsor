-- More invoices, so that a list has more than one page. `pnpm migrate`
-- runs this file once, as the owner, after 005 (step 13's README, decision 7).
-- The owner holds BYPASSRLS, so the policy of 004 does not stop these rows.

-- org_456 gets INV-1001 to INV-1012. Its INV-1008, the running example, is already here
-- and stays as it is. org_789 gets INV-2002 to INV-2004. src/invoice.ts holds the same
-- invoices in memory, for the unit tests. A paid or cancelled invoice has nothing open.
INSERT INTO app.invoices
  (tenant_id, id, vendor_id, amount_value, amount_currency,
   open_amount_value, open_amount_currency, status)
VALUES
  ('org_456', 'INV-1001', 'VENDOR-12',  1250.00, 'USD',     0.00, 'USD', 'paid'),
  ('org_456', 'INV-1002', 'VENDOR-44',  8900.50, 'USD',  8900.50, 'USD', 'issued'),
  ('org_456', 'INV-1003', 'VENDOR-31',   450.00, 'USD',     0.00, 'USD', 'paid'),
  ('org_456', 'INV-1004', 'VENDOR-12', 27300.00, 'USD', 27300.00, 'USD', 'issued'),
  ('org_456', 'INV-1005', 'VENDOR-44',  1999.99, 'USD',  1999.99, 'USD', 'draft'),
  ('org_456', 'INV-1006', 'VENDOR-31',   640.00, 'USD',   640.00, 'USD', 'issued'),
  ('org_456', 'INV-1007', 'VENDOR-12', 15000.00, 'USD',     0.00, 'USD', 'paid'),
  ('org_456', 'INV-1009', 'VENDOR-44',  7425.00, 'USD',  7425.00, 'USD', 'issued'),
  ('org_456', 'INV-1010', 'VENDOR-31',   312.40, 'USD',     0.00, 'USD', 'cancelled'),
  ('org_456', 'INV-1011', 'VENDOR-12',  5600.00, 'USD',  5600.00, 'USD', 'draft'),
  ('org_456', 'INV-1012', 'VENDOR-44', 22750.00, 'USD', 22750.00, 'USD', 'issued'),
  ('org_789', 'INV-2002', 'VENDOR-77',  3300.00, 'USD',  3300.00, 'USD', 'issued'),
  ('org_789', 'INV-2003', 'VENDOR-77',   480.25, 'USD',     0.00, 'USD', 'paid'),
  ('org_789', 'INV-2004', 'VENDOR-77', 61000.00, 'USD', 61000.00, 'USD', 'draft');
