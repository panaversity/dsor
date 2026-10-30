-- NEW IN STEP 26: each company's sheets of exchange rates, in DSoR's own store. A sheet is the rows
-- of one source at one time: how much of each currency one unit of the sheet's base buys, as the
-- source wrote it, and the base's own row at 1 (DSOR-MON-03, DSOR-MON-04). `pnpm migrate` runs this
-- file once, as the owner, after 020 (step 26's README, decisions L1, D2, D3, D5, D6, and D9).
CREATE TABLE dsor.rates (
  tenant_id    text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  source       text NOT NULL CHECK (source <> ''),
  -- When the source published the sheet, as the loader says. The database's clock measures its
  -- age from here (decision D5).
  published_at timestamptz NOT NULL,
  base         text NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  currency     text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- numeric keeps the digits as written: 1.0800 stays 1.0800 (decision D3).
  per_base     numeric NOT NULL,
  -- When DSoR took it, by the database's clock, for the record. Nothing decides by it.
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source, published_at, currency),
  -- A rate of zero would make every amount equal to nothing, and a rate below zero means nothing.
  CONSTRAINT rates_above_zero CHECK (per_base > 0),
  -- One unit of the base buys one unit of the base (decision D9).
  CONSTRAINT rates_base_is_one CHECK (currency <> base OR per_base = 1)
);

-- One base row for each sheet. Each load writes its base's own row, so a second sheet of one
-- source at one time always meets the first here, whatever its base and its currencies: a sheet
-- is written once, and two never mix (decision D6).
CREATE UNIQUE INDEX rates_one_base ON dsor.rates (tenant_id, source, published_at)
  WHERE currency = base;

-- The lock of the company's tables: read and written only inside a transaction that set its
-- company (DSOR-TEN-01b; step 11's README, decisions 1 and 2). Each company keeps its own
-- sheets (decision D2).
ALTER TABLE dsor.rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.rates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.rates
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads the sheets, and adds a sheet through named columns. No UPDATE and no DELETE:
-- a sheet is written once, and a correction is a newer sheet (decision D6). loaded_at is the
-- database's own.
GRANT SELECT ON dsor.rates TO dsor_runtime;
GRANT INSERT (tenant_id, source, published_at, base, currency, per_base) ON dsor.rates
  TO dsor_runtime;
