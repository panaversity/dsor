-- NEW IN STEP 40c: an event's number is the next one for its resource, kept by the database
-- (DSOR-EVT-01b in specs/dsor/03-execution.md, section 31). The sender delivers a payment's events in
-- the order they were written; this makes that order and their ordering keys always agree. Found by
-- step 40c's review, L4, from step 40: raw SQL by dsor_runtime wrote a payment's #2 before its #1,
-- and the sender delivered #2 first. DSoR's own code numbers each event this way already, under
-- its resource's lock (step 40's README, decision D4). Checked after the row's own checks, so a
-- copy of an event is still refused by them first.
CREATE FUNCTION dsor.outbox_next_number() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.ordering_key <> (SELECT count(*) FROM dsor.outbox o
                           WHERE o.tenant_id = NEW.tenant_id AND o.resource = NEW.resource) THEN
    RAISE EXCEPTION 'event % is number % of %, which is not the next number for it',
      NEW.event_id, NEW.ordering_key, NEW.resource USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER outbox_next_number AFTER INSERT ON dsor.outbox
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_next_number();
