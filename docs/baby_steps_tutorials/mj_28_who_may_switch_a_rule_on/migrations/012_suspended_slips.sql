-- DSoR suspends a slip when its company's directory reports the signer as
-- suspended, deprovisioned, or not listed, and records the change (DSOR-IDN-07). `pnpm migrate`
-- runs this file once, as the owner, after 011 (step 19b's README, decisions 3, 4, and 10).

-- dsor_runtime may change a slip's status, and nothing else about it: not its signer, its agent,
-- its permissions, or its modes. Row-level security on dsor.delegations keeps every change inside
-- the call's company (step 19b's README, decision 3).
GRANT UPDATE (status) ON dsor.delegations TO dsor_runtime;

-- The log takes a second kind of record: a change to a slip (step 19b's README, decision 4).
ALTER TABLE dsor.audit DROP CONSTRAINT audit_kind_check;
ALTER TABLE dsor.audit ADD CONSTRAINT audit_kind_check
  CHECK (kind IN ('decision', 'delegation_change'));

-- Only a decision says ALLOW or DENY. A change to a slip allows and denies nothing, so its record
-- leaves "authorization" empty. The old check, audit_authorization_check, lets an empty value
-- through, because a CHECK accepts NULL. So the new check below makes every decision say ALLOW or
-- DENY, as NOT NULL did (step 19b's README, decision 10).
ALTER TABLE dsor.audit ALTER COLUMN "authorization" DROP NOT NULL;
ALTER TABLE dsor.audit ADD CONSTRAINT audit_decision_authorization
  CHECK (kind <> 'decision' OR "authorization" IS NOT NULL);
