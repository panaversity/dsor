-- An event the receiver refuses is kept and tried again, and a person hears of it
-- (DSOR-EVT-01a in specs/dsor/03-execution.md, section 31; step 40c's README, decisions D2 to D5,
-- D7, and D8). Each failed try is a row of dsor.outbox_tries, written by the sender in its run's
-- transaction and never changed. The database raises one alert in dsor.event_alerts on an event's
-- third failed try, and closes it in the transaction that marks the event sent. The specification
-- says nothing about an event that keeps failing; these are this tutorial's rules.

-- The log of failed tries: the event, the database's time, and the receiver's reason.
CREATE TABLE dsor.outbox_tries (
  try        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  event_id   text NOT NULL REFERENCES dsor.outbox (event_id),
  -- The database's clock, written by the guard below, whatever the writer gave.
  tried_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason     text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200)
);
CREATE INDEX outbox_tries_of_event ON dsor.outbox_tries (tenant_id, event_id);

-- A try is written only for an unsent event of its own company, stamped by the database's clock,
-- and never changed or removed, for the owner too.
CREATE FUNCTION dsor.outbox_tries_written() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'a try is never changed or removed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dsor.outbox o
                  WHERE o.event_id = NEW.event_id AND o.tenant_id = NEW.tenant_id
                    AND o.sent_at IS NULL) THEN
    RAISE EXCEPTION 'a try is written only for an unsent event of its own company'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.tried_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER outbox_tries_written BEFORE INSERT OR UPDATE OR DELETE ON dsor.outbox_tries
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_tries_written();
CREATE FUNCTION dsor.outbox_tries_stay() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'a try is never changed or removed' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER outbox_tries_stay BEFORE TRUNCATE ON dsor.outbox_tries
  FOR EACH STATEMENT EXECUTE FUNCTION dsor.outbox_tries_stay();

ALTER TABLE dsor.outbox_tries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.outbox_tries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.outbox_tries
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
GRANT SELECT ON dsor.outbox_tries TO dsor_runtime;
GRANT INSERT (tenant_id, event_id, reason) ON dsor.outbox_tries TO dsor_runtime;

-- The alerts: one for each event that failed three times. Raised and closed by the database only.
CREATE TABLE dsor.event_alerts (
  tenant_id  text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  event_id   text NOT NULL REFERENCES dsor.outbox (event_id),
  -- The payment the event is about, so a person sees which payment waits.
  resource   text NOT NULL,
  raised_at  timestamptz NOT NULL,
  state      text NOT NULL CHECK (state IN ('open', 'closed')),
  closed_at  timestamptz,
  -- One alert for one event: its third failed try raises it, and no later one.
  PRIMARY KEY (tenant_id, event_id),
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);

-- An alert is raised open, by the database's clock, only for an unsent event with three failed
-- tries or more. It moves once, from open to closed, only when its event is sent. Nothing else
-- changes, and nothing is removed, for the owner too.
CREATE FUNCTION dsor.event_alerts_move() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  about text;
  sent timestamptz;
  tries bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an alert is never removed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT o.resource, o.sent_at INTO about, sent FROM dsor.outbox o
   WHERE o.tenant_id = NEW.tenant_id AND o.event_id = NEW.event_id;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO tries FROM dsor.outbox_tries t
     WHERE t.tenant_id = NEW.tenant_id AND t.event_id = NEW.event_id;
    IF about IS NULL OR sent IS NOT NULL OR tries < 3 THEN
      RAISE EXCEPTION 'an event''s alert is raised only after its third failed try, while it is unsent'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.resource := about;
    NEW.raised_at := now();
    NEW.state := 'open';
    NEW.closed_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.event_id, NEW.resource, NEW.raised_at)
     IS DISTINCT FROM (OLD.tenant_id, OLD.event_id, OLD.resource, OLD.raised_at) THEN
    RAISE EXCEPTION 'an alert''s company, event, payment, and raised_at never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'open' AND NEW.state = 'closed' AND sent IS NOT NULL THEN
    NEW.closed_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'an alert moves once, from open to closed, and closes only when its event is sent'
    USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER event_alerts_move BEFORE INSERT OR UPDATE OR DELETE ON dsor.event_alerts
  FOR EACH ROW EXECUTE FUNCTION dsor.event_alerts_move();
CREATE FUNCTION dsor.event_alerts_stay() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'an alert is never removed' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER event_alerts_stay BEFORE TRUNCATE ON dsor.event_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION dsor.event_alerts_stay();

ALTER TABLE dsor.event_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.event_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.event_alerts
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
GRANT SELECT ON dsor.event_alerts TO dsor_runtime;

-- The third failed try raises the event's alert, and the mark that sends the event closes it, each
-- in its own transaction. With the rights of the functions' owner, the migration's login, so
-- dsor_runtime needs no right to raise or close an alert itself, as step 38b's alerts are raised.
CREATE FUNCTION dsor.outbox_try_alerts() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (SELECT count(*) FROM dsor.outbox_tries t
       WHERE t.tenant_id = NEW.tenant_id AND t.event_id = NEW.event_id) = 3 THEN
    INSERT INTO dsor.event_alerts (tenant_id, event_id, resource, raised_at, state)
    SELECT o.tenant_id, o.event_id, o.resource, now(), 'open' FROM dsor.outbox o
     WHERE o.tenant_id = NEW.tenant_id AND o.event_id = NEW.event_id;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION dsor.outbox_try_alerts() FROM PUBLIC;
CREATE TRIGGER outbox_try_alert AFTER INSERT ON dsor.outbox_tries
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_try_alerts();

CREATE FUNCTION dsor.outbox_closes_alert() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE dsor.event_alerts SET state = 'closed'
   WHERE tenant_id = NEW.tenant_id AND event_id = NEW.event_id AND state = 'open';
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION dsor.outbox_closes_alert() FROM PUBLIC;
CREATE TRIGGER outbox_close_alert AFTER UPDATE OF sent_at ON dsor.outbox
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_closes_alert();
