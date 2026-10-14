-- NEW IN STEP 28b: a rule whose policy moved in KSoR. DSoR's sweep marks the version
-- stale_authority, keeps when it did and the version of the policy in force, and leaves the
-- version's owner a notice, in the same transaction (DSOR-CTL-03a). A stale version is in force,
-- so it is a live version too (DSOR-CTL-03b). `pnpm migrate` runs this file once, as the owner,
-- after 023 (step 28b's README, decisions D5 to D7).

-- The fifth status. in_review is still never set (step 28's README, decision D17).
ALTER TABLE dsor.controls DROP CONSTRAINT controls_status_check;
ALTER TABLE dsor.controls ADD CONSTRAINT controls_status_check
  CHECK (status IN ('draft', 'active', 'suspended', 'retired', 'stale_authority'));

-- DSoR's mark, beside the rule's text and never in it: when the sweep first marked the version,
-- by the database's own clock, and the version of the policy that KSoR had in force, with its
-- fingerprint. A version that leaves stale_authority keeps its mark, as history.
ALTER TABLE dsor.controls ADD COLUMN stale_since timestamptz;
ALTER TABLE dsor.controls ADD COLUMN in_force jsonb;
-- The version in force has two fields: a whole number from 1, and a fingerprint of the form
-- common.schema.json gives a hash.
ALTER TABLE dsor.controls ADD CONSTRAINT controls_in_force_shape CHECK (
  in_force IS NULL OR (
    jsonb_typeof(in_force) = 'object'
    AND jsonb_typeof(in_force -> 'version') = 'number'
    AND (in_force ->> 'version') ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(in_force -> 'content_hash') = 'string'
    AND (in_force ->> 'content_hash') ~ '^sha256:[A-Za-z0-9+/=_-]+$'
    AND (in_force - 'version' - 'content_hash') = '{}'::jsonb
  )
);
-- A stale version was switched on, as an active one was, and carries its mark.
ALTER TABLE dsor.controls DROP CONSTRAINT controls_switched_on;
ALTER TABLE dsor.controls ADD CONSTRAINT controls_switched_on CHECK (
  status NOT IN ('active', 'suspended', 'stale_authority')
  OR (reviewed_by IS NOT NULL AND effective_from IS NOT NULL)
);
ALTER TABLE dsor.controls ADD CONSTRAINT controls_stale_marked CHECK (
  status <> 'stale_authority' OR (stale_since IS NOT NULL AND in_force IS NOT NULL)
);

-- One live version for each rule: active, stale, or suspended, one at a time (step 28's README,
-- decision D4). A switch-on retires a stale version as it retires an active one.
DROP INDEX dsor.controls_one_live;
CREATE UNIQUE INDEX controls_one_live ON dsor.controls (tenant_id, id)
  WHERE status IN ('active', 'suspended', 'stale_authority');

-- Step 28's guard of a version's moves, with the moves of a stale version: the sweep's mark, a
-- second mark when the policy moved again, and the owner's suspension or retirement. A stale
-- version never moves back to active (step 28b's README, decision D6). Only a mark names when a
-- version went stale and the version in force. The database writes the time of a first mark
-- itself, so no caller can name a time that shortens or lengthens the grace, and a second mark
-- keeps it. It runs for every role, the owner's too, as before.
CREATE OR REPLACE FUNCTION dsor.control_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.version, NEW.rule, NEW.compiled_by, NEW.drafted_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.version, OLD.rule, OLD.compiled_by, OLD.drafted_at) THEN
    RAISE EXCEPTION 'a version of a rule keeps its text, its number, and who wrote it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('draft', 'active'), ('draft', 'retired'),
      ('active', 'suspended'), ('active', 'retired'),
      ('suspended', 'active'), ('suspended', 'retired'),
      ('active', 'stale_authority'), ('stale_authority', 'stale_authority'),
      ('stale_authority', 'suspended'), ('stale_authority', 'retired')
    ) AS drawn (from_status, to_status)
    WHERE drawn.from_status = OLD.status AND drawn.to_status = NEW.status
  ) THEN
    RAISE EXCEPTION 'a version of a rule does not move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'active'
     AND (NEW.reviewed_by, NEW.effective_from) IS DISTINCT FROM (OLD.reviewed_by, OLD.effective_from)
  THEN
    RAISE EXCEPTION 'only a switch-on names a reviewer and the time it took effect'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'stale_authority'
     AND (NEW.stale_since, NEW.in_force) IS DISTINCT FROM (OLD.stale_since, OLD.in_force) THEN
    RAISE EXCEPTION 'only a mark names when a version went stale, and the version in force'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'stale_authority' THEN
    NEW.stale_since := clock_timestamp();
  ELSIF OLD.status = 'stale_authority' AND NEW.status = 'stale_authority'
     AND (NEW.stale_since IS DISTINCT FROM OLD.stale_since
          OR NEW.in_force IS NOT DISTINCT FROM OLD.in_force) THEN
    RAISE EXCEPTION 'a second mark keeps the time of the first, and names another version in force'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- dsor_runtime may name the version in force too. It never names stale_since: the trigger writes
-- it.
GRANT UPDATE (in_force) ON dsor.controls TO dsor_runtime;

-- The notices to each rule's owner, which DSoR keeps until a mailer sends them, step 40's idea
-- (step 28b's README, decision D5). A notice names its rule by id and version, as a record does,
-- with no key into dsor.controls: a notice stays whatever happens to its rule. Its time is the
-- database's own.
CREATE TABLE dsor.notices (
  notice_id   text PRIMARY KEY CHECK (notice_id ~ '^ntc_[0-9a-f-]{36}$'),
  tenant_id   text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  to_person   text NOT NULL CHECK (to_person <> ''),
  rule_id     text NOT NULL CHECK (rule_id ~ '^[a-z]([a-z0-9-]{0,62}[a-z0-9])?$'),
  version     integer NOT NULL CHECK (version >= 1),
  words       text NOT NULL CHECK (words <> ''),
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  correlation jsonb NOT NULL CHECK (jsonb_typeof(correlation) = 'object')
);

-- The company's lock, as on every table of DSoR's own (DSOR-TEN-01b).
ALTER TABLE dsor.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.notices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.notices
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- dsor_runtime reads the notices and adds one through named columns. No UPDATE and no DELETE: a
-- notice, once written, says what it said.
GRANT SELECT ON dsor.notices TO dsor_runtime;
GRANT INSERT (notice_id, tenant_id, to_person, rule_id, version, words, correlation)
  ON dsor.notices TO dsor_runtime;
