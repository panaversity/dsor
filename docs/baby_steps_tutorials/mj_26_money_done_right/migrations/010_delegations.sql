-- The permission slips, in DSoR's own store (DSOR-DEL-01a). `pnpm migrate`
-- runs this file once, as the owner, after 009 (step 18's README, decision 3).

CREATE TABLE dsor.delegations (
  -- The slip's company starts its key, as every company key does (step 11's README,
  -- decision 9). The column is tenant_id, as in the company's tables. The specification's
  -- slip calls the field tenant, and the program reads it under that name.
  tenant_id     text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  id            text NOT NULL,
  delegator     text NOT NULL,
  delegate      text NOT NULL,
  modes         text[] NOT NULL,
  permissions   text[] NOT NULL,
  constraints   jsonb NOT NULL,
  subdelegation jsonb NOT NULL,
  parent        text,
  -- No CHECK on the status or the modes: the program checks every slip it reads against the
  -- specification's own schema, so its rules are typed once (step 18's README, decision 13).
  status        text NOT NULL,
  -- The database's clock decides that a slip is past this time (step 18's README, decision 12).
  expires_at    timestamptz NOT NULL,
  extensions    jsonb,
  PRIMARY KEY (tenant_id, id),
  -- One slip for each agent in each company, whatever its status, so DSoR never chooses
  -- between two (step 18's README, decision 7).
  UNIQUE (tenant_id, delegate)
);

-- The lock of the company's tables, on slips: a slip is read only inside a transaction that
-- set its company (DSOR-TEN-01b; step 11's README, decisions 1 and 2).
ALTER TABLE dsor.delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.delegations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.delegations
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads slips, and never writes one. Nobody signs a slip through DSoR yet
-- (step 18's README, decision 3).
GRANT SELECT ON dsor.delegations TO dsor_runtime;

-- The story's three slips. Each lists only what step 18's operations need, and runs until
-- 2099, so no test stops working when a date passes (step 18's README, decision 12).
-- firm-ap-fte has one slip in each company, with the power its roles gave it before
-- (step 18's README, decisions 2 and 11).
INSERT INTO dsor.delegations
  (tenant_id, id, delegator, delegate, modes, permissions, constraints, subdelegation, status,
   expires_at)
VALUES
  ('org_456', 'del_100', 'user_123', 'accounts-payable-fte', '{unattended}',
   '{invoice:read,payment:create}', '{}', '{"allowed": false}', 'active',
   '2099-12-31T23:59:59Z'),
  ('org_456', 'del_101', 'user_123', 'firm-ap-fte', '{unattended}',
   '{invoice:read,payment:create}', '{}', '{"allowed": false}', 'active',
   '2099-12-31T23:59:59Z'),
  ('org_789', 'del_102', 'user_700', 'firm-ap-fte', '{unattended}',
   '{invoice:read,invoice:issue,payment:create,payment:cancel}', '{}', '{"allowed": false}',
   'active', '2099-12-31T23:59:59Z');
