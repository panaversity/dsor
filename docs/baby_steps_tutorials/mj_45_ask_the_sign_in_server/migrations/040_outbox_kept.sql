-- The outbox keeps its events, and the database alone names the transaction that
-- wrote each one, for every login, the owner too (DSOR-EVT-01a in specs/dsor/03-execution.md,
-- section 31; step 40b's README, decision D9). Found by step 40b's review, M1: the owner wrote an
-- event with written_xact 42, which migration 038 set only as a default, and the owner could delete
-- or truncate events, so a paid payment could be left with no event. The owner can still switch a
-- trigger off, which no table guard prevents (step 40b's README, "Left open on purpose").

-- Every new event is stamped with this transaction's id, whatever the writer gave.
CREATE FUNCTION dsor.outbox_stamps() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.written_xact := pg_current_xact_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER outbox_stamp BEFORE INSERT ON dsor.outbox
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_stamps();

-- And no event is removed, one by one or all at once.
CREATE FUNCTION dsor.outbox_keeps() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'an event is never removed' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER outbox_keep BEFORE DELETE ON dsor.outbox
  FOR EACH ROW EXECUTE FUNCTION dsor.outbox_keeps();
CREATE TRIGGER outbox_stay BEFORE TRUNCATE ON dsor.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION dsor.outbox_keeps();
