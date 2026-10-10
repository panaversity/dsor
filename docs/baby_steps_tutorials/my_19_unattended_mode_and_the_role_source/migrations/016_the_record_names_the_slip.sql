-- NEW IN STEP 19: a decision record names the slip an agent acted under (DSOR-DEL-10, decision 129).
--
-- An unattended decision is user_123's authority, used by the agent under del_100. The record's
-- identity says the mode and the subject, and this column says which slip: the audit record's
-- schema has had a place for it all along. Empty for a person, who acts under none.
--
-- Step 09's grant on the log names its columns one by one, so this one is granted by name, as 007
-- did for row_count. The application may write it and, like every column of the log, never change
-- it.

ALTER TABLE dsor.audit ADD COLUMN delegation TEXT;

GRANT INSERT (delegation) ON dsor.audit TO dsor_runtime;
