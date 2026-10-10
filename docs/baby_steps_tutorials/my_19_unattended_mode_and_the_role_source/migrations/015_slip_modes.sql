-- NEW IN STEP 19: the modes a slip may be used in (DSOR-DEL-07, decision 129).
--
-- unattended: the agent logs in as itself, with nobody present, and DSoR reads whose authority it
-- carries from the slip. on_behalf_of: the agent acts beside a person who is logged in, which step
-- 45 builds. An agent's command under a slip that does not allow unattended is refused.
--
-- The specification's del_100 allows both. A slip grants only what exists, as 014 said of its
-- permissions, so del_100 allows unattended alone until step 45. That is the column's default too,
-- because there is no operation to sign a slip yet, and the tests put the story back by running 014
-- again, which names no modes. The operation that signs slips will name them.

ALTER TABLE dsor.delegations
  ADD COLUMN modes TEXT[] NOT NULL DEFAULT ARRAY['unattended']
  CHECK (cardinality(modes) > 0 AND modes <@ ARRAY['on_behalf_of', 'unattended']);
