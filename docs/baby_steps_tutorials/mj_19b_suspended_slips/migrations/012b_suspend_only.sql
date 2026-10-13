-- NEW IN STEP 19b: dsor_runtime may make one change to a slip, and no other: from active to
-- suspended. Migration 012 lets it write a slip's status, and without this policy it could write
-- any word there: a bug could bring a torn-up slip back to active. Found by step 19b's review.
-- `pnpm migrate` runs this file once, as the owner, after 012 (step 19b's README, decision 13).
--
-- The policy is restrictive, so it does not replace the company's policy: both must agree.
-- USING picks the rows an UPDATE may touch: active slips only. WITH CHECK checks each row after
-- the change: it must say suspended. The owner, who lifts a suspension by hand, passes every
-- policy.
CREATE POLICY suspend_only ON dsor.delegations AS RESTRICTIVE FOR UPDATE TO dsor_runtime
  USING (status = 'active') WITH CHECK (status = 'suspended');
