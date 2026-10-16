-- NEW IN STEP 33: the decision bundles, one file of facts for each decision about a command, from
-- line ④ on. Each is kept whole, in decision-bundle.schema.json's shape, beside the columns its
-- keys need, and written in the same transaction as the record that names it: both or neither
-- (step 33's README, decisions D2 and D3). dsor_runtime adds a bundle and reads one, in its own
-- company only, and never changes or removes one. `pnpm migrate` runs this file once, as the
-- owner, after 029.
CREATE TABLE dsor.decision_bundles (
  decision_id text PRIMARY KEY
    CHECK (decision_id ~ '^dec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  tenant_id   text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  bundle      jsonb NOT NULL,
  -- The database's own clock gives the bundle its time, as it gives a record its time: the
  -- transaction's start, which the record shares (step 09's README, decision 6).
  sealed_at   timestamptz NOT NULL DEFAULT now(),
  -- The columns repeat what the bundle says, so they say the same. The time is the column's
  -- alone, so a bundle cannot carry a time of its own.
  CONSTRAINT decision_bundles_keys CHECK (
    jsonb_typeof(bundle) = 'object'
    AND bundle ->> 'decision_id' = decision_id
    AND bundle ->> 'tenant' = tenant_id
    AND NOT bundle ? 'sealed_at'
  )
);

-- The company's lock, as on every table of DSoR's own (DSOR-TEN-01b, DSOR-TEN-02a).
ALTER TABLE dsor.decision_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.decision_bundles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.decision_bundles
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads the bundles and adds one through named columns. No UPDATE and no DELETE: a
-- bundle, once sealed, says what it said (DSOR-AUD-04a, which this tutorial reads as covering a
-- bundle).
GRANT SELECT ON dsor.decision_bundles TO dsor_runtime;
GRANT INSERT (decision_id, tenant_id, bundle) ON dsor.decision_bundles TO dsor_runtime;

-- The record names its bundle, in the audit record's own field. A record can name only a bundle
-- that is kept: the bundle is written first, in the same transaction.
ALTER TABLE dsor.audit ADD COLUMN decision_bundle text
  CONSTRAINT audit_names_a_bundle REFERENCES dsor.decision_bundles (decision_id);
GRANT INSERT (decision_bundle) ON dsor.audit TO dsor_runtime;
