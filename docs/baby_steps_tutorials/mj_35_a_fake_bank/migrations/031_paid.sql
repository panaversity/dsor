-- NEW IN STEP 35: a payment may be paid, once payment.execute has sent it through the company's
-- bank (step 35's README, decision D7). dsor_runtime may already change the status (009), so
-- only the list of allowed statuses grows.
ALTER TABLE app.payments DROP CONSTRAINT payments_status_check;
ALTER TABLE app.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('draft', 'cancelled', 'paid'));
