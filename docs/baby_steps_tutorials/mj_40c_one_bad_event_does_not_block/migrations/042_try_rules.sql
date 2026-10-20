-- NEW IN STEP 40c: three rules of a failed try, kept by the database (step 40c's README, decisions
-- D3, D4, and D7). Found by step 40c's review:
-- - L1: the alert was raised when an event's tries counted exactly three, so tries written several
--   at once could jump past three, or raise it twice and fail. Now three or more raise it, once.
-- - L2: a try and the mark that sends its event could run side by side, so the alert was raised
--   after the mark had closed nothing, and stayed open on a sent event. Now a try locks its event's
--   row first, so the two run one after the other.
-- - L3: a try could be written for an event held back behind its payment's earlier unsent event,
--   which the sender never tries. Now a try is only for its payment's oldest unsent event.
CREATE OR REPLACE FUNCTION dsor.outbox_tries_written() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  its_resource text;
  its_place bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'a try is never changed or removed' USING ERRCODE = 'check_violation';
  END IF;
  -- The event's row, locked, so its mark waits for this try's transaction, and this try waits for
  --   a mark already under way.
  SELECT o.resource, o.written INTO its_resource, its_place FROM dsor.outbox o
   WHERE o.event_id = NEW.event_id AND o.tenant_id = NEW.tenant_id AND o.sent_at IS NULL
   FOR NO KEY UPDATE;
  IF its_resource IS NULL THEN
    RAISE EXCEPTION 'a try is written only for an unsent event of its own company'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM dsor.outbox e
              WHERE e.tenant_id = NEW.tenant_id AND e.resource = its_resource
                AND e.sent_at IS NULL AND e.written < its_place) THEN
    RAISE EXCEPTION 'a try is written only for its payment''s oldest unsent event'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.tried_at := clock_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION dsor.outbox_try_alerts() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (SELECT count(*) FROM dsor.outbox_tries t
       WHERE t.tenant_id = NEW.tenant_id AND t.event_id = NEW.event_id) >= 3 THEN
    INSERT INTO dsor.event_alerts (tenant_id, event_id, resource, raised_at, state)
    SELECT o.tenant_id, o.event_id, o.resource, now(), 'open' FROM dsor.outbox o
     WHERE o.tenant_id = NEW.tenant_id AND o.event_id = NEW.event_id
    ON CONFLICT (tenant_id, event_id) DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
