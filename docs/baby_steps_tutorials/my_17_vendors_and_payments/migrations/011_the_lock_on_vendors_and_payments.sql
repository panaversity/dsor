-- NEW IN STEP 17: the second lock on the two new tables, word for word as 005 wrote it for the
-- invoices (decision 125). Start-up compares each policy with that text, so a policy written any
-- other way would stop the program, which is the point.

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.vendors
  USING      (tenant_id = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('dsor.tenant_id', true));

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.payments
  USING      (tenant_id = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('dsor.tenant_id', true));
