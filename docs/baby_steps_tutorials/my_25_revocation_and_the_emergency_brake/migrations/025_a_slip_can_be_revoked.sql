-- NEW IN STEP 25: a permission slip can be torn up (DSOR-DEL-04a, decision 142).
--
-- Until now the application read slips and wrote none, because a slip it could write is a slip it
-- could sign for itself. It may now do exactly one thing to a slip: mark an active or suspended one
-- revoked, with who revoked it, when and why. It may not bring a revoked slip back, nor change it to
-- anything else, nor change what a slip grants; a second, restrictive policy says so, and start-up
-- asks for it.

ALTER TABLE dsor.delegations
  ADD COLUMN revoked_by     TEXT CHECK (revoked_by <> ''),
  ADD COLUMN revoked_at     TIMESTAMPTZ,
  ADD COLUMN revoked_reason TEXT CHECK (revoked_reason <> ''),
  -- Who revoked it, only on a revoked slip. A slip an owner marked revoked by hand, before this
  -- step, says no who.
  ADD CHECK (revoked_by IS NULL OR status = 'revoked');

GRANT UPDATE (status, revoked_by, revoked_at, revoked_reason) ON dsor.delegations TO dsor_runtime;

-- Restrictive, so AND'ed with the tenant policy: an UPDATE may touch only an active or suspended
-- slip, and may leave it only revoked, with who revoked it, when and why. Without it, the right to
-- revoke would be the right to un-revoke; without the who, a revocation nobody gave (decision 143);
-- without the when and the why, one nobody can explain afterwards (decision 156). Decision 156
-- too: a suspended slip, or its signer could not tear it up before someone made it active again.
CREATE POLICY a_slip_only_becomes_revoked ON dsor.delegations AS RESTRICTIVE FOR UPDATE
  USING      (status IN ('active', 'suspended'))
  WITH CHECK (status = 'revoked' AND revoked_by IS NOT NULL
              AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL);
