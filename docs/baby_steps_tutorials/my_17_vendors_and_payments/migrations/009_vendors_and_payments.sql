-- NEW IN STEP 17: two more record types, the vendors a company pays and the payments it makes
-- (decision 125).
--
-- A payment is the first record a command creates instead of changing. `payment.create` makes one
-- as a draft, and `payment.cancel` takes it back: the first effect in this program that can be
-- undone, which is what a command's contract now has to say (DSOR-EXE-05a).
--
-- They are the business's records, so they live in public, beside the invoices, and like the
-- invoices every row names its company and every key starts with it (DSOR-TEN-01a).

CREATE TABLE public.vendors (
  tenant_id TEXT NOT NULL,
  id        TEXT NOT NULL,
  -- Step 31 suspends VENDOR-44 between an approval and the payment it approved.
  status    TEXT NOT NULL CHECK (status IN ('approved', 'suspended')),
  PRIMARY KEY (tenant_id, id)
);

-- A payment's number comes from the database, never from the caller. A caller who names the
-- number can pick one that exists; a sequence hands each request the next one, and two requests
-- at once get two different numbers. That is also why a retried request makes a second payment
-- today: telling a retry from a new request is step 20's idempotency key, not this.
--
-- It starts at 902 because PAY-901 is the running example's own draft (010).
CREATE SEQUENCE public.payment_numbers START WITH 902;

CREATE TABLE public.payments (
  tenant_id       TEXT NOT NULL,
  id              TEXT NOT NULL DEFAULT 'PAY-' || nextval('public.payment_numbers'),
  -- The invoice's own vendor, copied when the payment is made: a payment cannot name one vendor
  -- and pay another's invoice. The two keys below make the database say so too.
  vendor          TEXT NOT NULL,
  invoice         TEXT NOT NULL,
  -- Exact, never a float, and above zero: a payment of nothing, or of less than nothing, is a
  -- mistake. NUMERIC(18, 2) rounds a third decimal away, so the program refuses one first.
  amount_value    NUMERIC(18, 2) NOT NULL CHECK (amount_value > 0),
  amount_currency TEXT NOT NULL CHECK (amount_currency ~ '^[A-Z]{3}$'),
  -- A draft can be cancelled. Approval, execution and the rest arrive with the steps that build
  -- them, and each widens this list.
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'cancelled')),
  PRIMARY KEY (tenant_id, id),
  -- With the company inside each key, a payment can only point at its own company's vendor and
  -- invoice, whatever the program does.
  FOREIGN KEY (tenant_id, vendor) REFERENCES public.vendors (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice) REFERENCES public.invoices (tenant_id, id)
);

ALTER SEQUENCE public.payment_numbers OWNED BY public.payments.id;

-- What the application may do, and no more. A fresh table grants nothing, so these REVOKEs take
-- away nothing on a fresh server; they are here for one that is not (decision 123).
REVOKE ALL ON public.vendors FROM PUBLIC;
REVOKE ALL ON public.payments FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.payment_numbers FROM PUBLIC;

-- Read the vendors, and change nothing about them.
GRANT SELECT ON public.vendors TO dsor_runtime;

-- Make a draft, read the payments, and change a payment's status, nothing else. The number and the
-- status of a new payment are the database's to choose, so INSERT names neither, and a payment's
-- company, vendor, invoice and amount never change once it is made.
GRANT SELECT ON public.payments TO dsor_runtime;
GRANT INSERT (tenant_id, vendor, invoice, amount_value, amount_currency) ON public.payments TO dsor_runtime;
GRANT UPDATE (status) ON public.payments TO dsor_runtime;

-- The column default calls nextval, and nextval checks the caller's right on the sequence.
GRANT USAGE ON SEQUENCE public.payment_numbers TO dsor_runtime;
