-- The outbox: DSoR's events not yet delivered to other systems (DSOR-EVT-01a in
-- specs/dsor/03-execution.md, section 31). DSoR writes an event here in the same transaction as the
-- change it reports, so the two commit together or not at all. A sender reads it later, company by
-- company, delivers each event, and marks it sent, once. No row is ever removed (step 40's README,
-- decisions D1, D2, D4, and D8).
CREATE TABLE dsor.outbox (
  event_id     text PRIMARY KEY CHECK (event_id ~ '^evt_[0-9a-f-]{36}$'),
  tenant_id    text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  type         text NOT NULL
    CHECK (type IN ('payment.created', 'payment.executed', 'proposal.approved')),
  resource     text NOT NULL,
  -- The event's number among its resource's events, 1, 2, 3, in the order they commit (D4).
  ordering_key integer NOT NULL CHECK (ordering_key > 0),
  -- The whole event, as it will be delivered. TypeScript checked it against event.schema.json.
  event        jsonb NOT NULL,
  -- The order the events were written in, which the sender delivers them in. The database fills it.
  written      bigint GENERATED ALWAYS AS IDENTITY,
  -- The database's clock, as for every record (step 09's README, decision 6).
  written_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  -- The columns the database checks are the event's own: one event, never two stories.
  CONSTRAINT outbox_is_its_event CHECK (
    event->>'event_id' = event_id
    AND event->>'tenant' = tenant_id
    AND event->>'type' = type
    AND event->>'resource' = resource
    AND event->'ordering_key' = to_jsonb(ordering_key)
    AND event->>'origin' = 'dsor'
  ),
  -- A resource's events are numbered once each.
  CONSTRAINT outbox_one_number UNIQUE (tenant_id, resource, ordering_key)
);

-- The sender reads a company's unsent events, oldest first.
CREATE INDEX outbox_unsent ON dsor.outbox (tenant_id, written) WHERE sent_at IS NULL;

-- An event is evidence of what DSoR told the world: only its sent_at is ever written after it,
-- once, by the database's clock. No other column changes, and a mark is never changed or taken back.
CREATE FUNCTION dsor.outbox_sends() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.event_id, NEW.tenant_id, NEW.type, NEW.resource, NEW.ordering_key, NEW.event,
      NEW.written, NEW.written_at)
     IS DISTINCT FROM
     (OLD.event_id, OLD.tenant_id, OLD.type, OLD.resource, OLD.ordering_key, OLD.event,
      OLD.written, OLD.written_at) THEN
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
CREATE TRIGGER outbox_send BEFORE UPDATE ON dsor.outbox
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_sends();

ALTER TABLE dsor.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.outbox
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.outbox TO dsor_runtime;
GRANT INSERT (event_id, tenant_id, type, resource, ordering_key, event)
  ON dsor.outbox TO dsor_runtime;
GRANT UPDATE (sent_at) ON dsor.outbox TO dsor_runtime;
