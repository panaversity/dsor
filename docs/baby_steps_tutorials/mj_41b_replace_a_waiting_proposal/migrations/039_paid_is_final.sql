-- Paid is final, and a payment keeps its number and its company, for every login,
-- the owner too (DSOR-EVT-01a in specs/dsor/03-execution.md, section 31; step 40b's README,
-- decision D8). Found by step 40b's review, H1: a payment marked paid with its payment.executed
-- could be set back to draft, in the same transaction or a later one. The accounts system then
-- heard "paid" for money that never left, and the payment could never be paid again, because it
-- already had its one payment.executed. And M1: the owner could give a payment a new number, so its
-- id changed and its events pointed at nothing. Money that left the bank does not come back by an
-- UPDATE; a refund would be an operation of its own, with its own event.
CREATE FUNCTION dsor.payment_stays() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'payment %: a payment''s number never changes, nor its company', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'payment % is paid, and paid is final', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_stay BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION dsor.payment_stays();
