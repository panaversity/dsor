-- NEW IN STEP 19: del_100 may be used with nobody present (DSOR-DEL-07, decision 130).
--
-- A slip allows unattended only when it says so, and 015's default allows only on_behalf_of. The
-- running example's del_100 says so here, in a file of its own, because the tests put the story
-- back by running 014 and then this one, and 015 cannot run twice. The specification's del_100
-- allows both modes; this one allows unattended alone until step 45 builds on_behalf_of.
--
-- After the lock, so this file says its company first, as 014 does.

SELECT set_config('dsor.tenant_id', 'org_456', true);

UPDATE dsor.delegations SET modes = ARRAY['unattended']
 WHERE tenant = 'org_456' AND id = 'del_100';
