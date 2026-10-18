-- A version on each invoice and each payment, which the database raises by one
-- at every change of the row (DSOR-CON-01b, DSOR-CNR-03b). `pnpm migrate` runs this file once,
-- as the owner, after 013 (step 21's README, decisions 1 and 2).

-- A whole number, 1 for every row there is now, and for every new row.
ALTER TABLE app.invoices ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE app.payments ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1);

-- The new row's version is the old row's plus one, whatever the writer set. So no writer can
-- forget to raise it, or set one of its own: not the accounts system, not the owner, and not
-- dsor_runtime, which holds no right on the column. It returns the new row, so it never
-- swallows a write (step 16's README, decision 3).
CREATE FUNCTION app.next_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
-- Nobody calls it by hand. The database runs it at each UPDATE.
REVOKE ALL ON FUNCTION app.next_version() FROM PUBLIC;

CREATE TRIGGER invoices_version BEFORE UPDATE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.next_version();
CREATE TRIGGER payments_version BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.next_version();
