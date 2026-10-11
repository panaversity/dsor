-- NEW IN STEP 19: the modes a slip may be used in (DSOR-DEL-07, decisions 129 and 130).
--
-- unattended: the agent logs in as itself, with nobody present, and DSoR reads whose authority it
-- carries from the slip. on_behalf_of: the agent acts beside a person who is logged in, which step
-- 45 builds. An agent's command under a slip that does not allow unattended is refused.
--
-- A slip allows unattended only when it says so: the default is on_behalf_of, which nothing can use
-- yet, so the database never makes a slip usable at night on its own. It was unattended, and a
-- review pointed out that the signer, not the database, decides that (decision 130). The default
-- stays because there is no operation to sign a slip yet, and the tests put the story back by
-- running 014 again, which names no modes; 017 then says del_100 may be used unattended.

ALTER TABLE dsor.delegations
  ADD COLUMN modes TEXT[] NOT NULL DEFAULT ARRAY['on_behalf_of']
  CHECK (cardinality(modes) > 0 AND modes <@ ARRAY['on_behalf_of', 'unattended']);

-- And a slip is signed by someone other than its own agent. One the agent signed for itself would
-- lend it its own authority, which is no one's (decision 130).
ALTER TABLE dsor.delegations
  ADD CONSTRAINT signed_by_someone_else CHECK (delegator <> delegate);
