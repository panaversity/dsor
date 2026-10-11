-- NEW IN STEP 17: an invoice names a vendor its company has (decision 126).
--
-- Until now an invoice's vendor was only a word. A payment for an invoice whose vendor is not in
-- public.vendors failed halfway, on the payment's own key to the vendor, after its ALLOW was
-- recorded: a review measured the error leaving the door raw. With this key such an invoice cannot
-- exist, so a payment never meets one.
--
-- After 010, because the vendors the invoices name must be there before the key is checked.

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tenant_id_vendor_fkey FOREIGN KEY (tenant_id, vendor)
  REFERENCES public.vendors (tenant_id, id);
