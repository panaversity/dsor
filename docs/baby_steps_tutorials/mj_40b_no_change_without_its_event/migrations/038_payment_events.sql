-- NEW IN STEP 40b: the database ties each payment change to its event, both ways, for every login
-- and every path, DSoR's own work included (DSOR-EVT-01a in specs/dsor/03-execution.md, section 31,
-- and DSOR-EXE-04a, section 21; step 40b's README, decisions D1 to D7). A transaction that drafts a
-- payment commits only with a payment.created about it, and one that marks a payment paid only with
-- a payment.executed about it, each written in that same transaction. An event about a payment
-- needs the payment, and a payment has at most one event of each.

-- D6: the transaction that wrote each event, written by the database. pg_current_xact_id() names
-- the whole transaction, even inside the savepoint the company's code runs in; the hidden column
-- xmin would name the savepoint. No login is granted the column: dsor_runtime's INSERT names six
-- other columns, and its UPDATE names sent_at only.
ALTER TABLE dsor.outbox ADD COLUMN written_xact xid8 NOT NULL DEFAULT pg_current_xact_id();

-- And step 40's guard keeps it, as it keeps every column but sent_at, from the owner too.
CREATE OR REPLACE FUNCTION dsor.outbox_sends() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.event_id, NEW.tenant_id, NEW.type, NEW.resource, NEW.ordering_key, NEW.event,
      NEW.written, NEW.written_at, NEW.written_xact)
     IS DISTINCT FROM
     (OLD.event_id, OLD.tenant_id, OLD.type, OLD.resource, OLD.ordering_key, OLD.event,
      OLD.written, OLD.written_at, OLD.written_xact) THEN
    RAISE EXCEPTION 'an event is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'an event is marked sent once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sent_at IS NULL THEN
    RAISE EXCEPTION 'an event is marked with the time it was sent' USING ERRCODE = 'check_violation';
  END IF;
  NEW.sent_at := clock_timestamp();
  RETURN NEW;
END
$$;

-- D4: once each. A payment is drafted once and paid once, so it has at most one event of each kind.
CREATE UNIQUE INDEX outbox_once_each ON dsor.outbox (tenant_id, resource, type)
  WHERE type IN ('payment.created', 'payment.executed');

-- D1 and D7: a change needs its event, checked at COMMIT. DSoR writes the payment first and the
-- event after, because the event carries the payment as it was stored, so the check waits for the
-- end of the transaction. A change with no event type, such as a cancel, needs none.
CREATE FUNCTION dsor.payment_has_its_event() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  about text := 'dsor://' || NEW.tenant_id || '/payment/' || NEW.id;
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
       SELECT 1 FROM dsor.outbox o
        WHERE o.tenant_id = NEW.tenant_id AND o.resource = about AND o.type = 'payment.created'
          AND o.written_xact = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'payment % was drafted, and this transaction wrote no payment.created about it',
      NEW.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid')
     AND NOT EXISTS (
       SELECT 1 FROM dsor.outbox o
        WHERE o.tenant_id = NEW.tenant_id AND o.resource = about AND o.type = 'payment.executed'
          AND o.written_xact = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'payment % was marked paid, and this transaction wrote no payment.executed about it',
      NEW.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER payment_has_its_event
  AFTER INSERT OR UPDATE OF status ON app.payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dsor.payment_has_its_event();

-- D2, D4, and D7: an event needs its change, checked when the event is written, because the change
-- is there already. A payment.created needs its payment, and a payment.executed needs it paid.
CREATE FUNCTION dsor.event_has_its_change() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.type = 'payment.created' AND NOT EXISTS (
       SELECT 1 FROM app.payments p
        WHERE p.tenant_id = NEW.tenant_id AND p.id = split_part(NEW.resource, '/', 5)
          AND NEW.resource = 'dsor://' || p.tenant_id || '/payment/' || p.id) THEN
    RAISE EXCEPTION 'no payment % was drafted, so payment.created about it is refused',
      NEW.resource USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.type = 'payment.executed' AND NOT EXISTS (
       SELECT 1 FROM app.payments p
        WHERE p.tenant_id = NEW.tenant_id AND p.id = split_part(NEW.resource, '/', 5)
          AND NEW.resource = 'dsor://' || p.tenant_id || '/payment/' || p.id
          AND p.status = 'paid') THEN
    RAISE EXCEPTION '% is not paid, so payment.executed about it is refused',
      NEW.resource USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER event_has_its_change AFTER INSERT ON dsor.outbox
  FOR EACH ROW EXECUTE FUNCTION dsor.event_has_its_change();
