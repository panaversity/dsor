-- NEW IN STEP 21: every invoice and payment carries a version (DSOR-CON-01b, decision 133).
--
-- A whole number from 1, raised by one in the same UPDATE as every change. A caller decides on a
-- record as it read it, and says the version it read; if the record has moved on, the command is
-- refused with STALE_STATE. Not the time of the last change, which two changes in one millisecond
-- share; and not a trigger, which start-up refuses on a tenant table.
--
-- The application may raise it, as it may change a status, and nothing else about it changes.

ALTER TABLE public.invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE public.payments ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

GRANT UPDATE (version) ON public.invoices TO dsor_runtime;
GRANT UPDATE (version) ON public.payments TO dsor_runtime;
