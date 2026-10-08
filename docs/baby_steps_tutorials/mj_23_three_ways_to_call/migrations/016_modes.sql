-- NEW IN STEP 23: three ways to call. A command is called in execute mode, which does it, in
-- propose_only mode, which makes a proposal that waits READY, or in validate_only mode, a dry run
-- that claims no key and makes no proposal (DSOR-OPR-05, DSOR-OPR-06). `pnpm migrate` runs this
-- file once, as the owner, after 015 (step 23's README, decisions 4 and 13).

-- A claim keeps the mode of its call, beside the fingerprint, so one key sent in two modes is
-- refused (step 23's README, decision 4). Every claim kept before this migration was made in
-- execute mode, the only mode there was, so each one gets execute. Then the default goes, so a
-- new claim must name its mode. A dry run claims nothing, so validate_only is not allowed.
ALTER TABLE dsor.idempotency ADD COLUMN mode text NOT NULL DEFAULT 'execute'
  CHECK (mode IN ('execute', 'propose_only'));
ALTER TABLE dsor.idempotency ALTER COLUMN mode DROP DEFAULT;

-- dsor_runtime writes the mode when it adds a claim, and never changes it: no UPDATE on it.
GRANT INSERT (mode) ON dsor.idempotency TO dsor_runtime;

-- A proposal is made in execute or propose_only mode, the two that proposal.schema.json lists. A
-- dry run makes none. The trigger of migration 015 still refuses any change to the mode.
ALTER TABLE dsor.proposals DROP CONSTRAINT proposals_mode_check;
ALTER TABLE dsor.proposals ADD CONSTRAINT proposals_mode_check
  CHECK (mode IN ('execute', 'propose_only'));
