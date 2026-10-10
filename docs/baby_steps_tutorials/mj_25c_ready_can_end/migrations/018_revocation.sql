-- A person can tear up a slip through DSoR, and dsor_runtime writes the change (DSOR-DEL-04a).
-- `pnpm migrate` runs this file once, as the owner, after 017 (step 25's README, decision D5).
--
-- Migration 012b let dsor_runtime move a slip from active to suspended, and nowhere else. A
-- tear-up runs as dsor_runtime too, so the rule grows: a slip may move from active or suspended,
-- to suspended or revoked. Still nothing brings a slip back to active, and nothing moves a slip
-- that is revoked or expired. The two policies cannot stand side by side: restrictive policies
-- must all agree, so 012b's would refuse every tear-up. So it goes, and this one takes its place.
--
-- USING picks the rows an UPDATE may touch: active or suspended slips. WITH CHECK checks each row
-- after the change: it must say suspended or revoked. The owner passes every policy.
DROP POLICY suspend_only ON dsor.delegations;
CREATE POLICY slip_moves ON dsor.delegations AS RESTRICTIVE FOR UPDATE TO dsor_runtime
  USING (status IN ('active', 'suspended')) WITH CHECK (status IN ('suspended', 'revoked'));
