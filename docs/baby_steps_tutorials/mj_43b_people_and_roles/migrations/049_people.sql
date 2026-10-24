-- Step 43b: each company's people, and the roles they hold there, in DSoR's own tables (DSOR-IDN-01,
-- DSOR-IDN-05 in specs/dsor/02-security.md, section 12; step 43b's README, claims C1 to C8). Line ①
-- reads them for a person on the call, and the role source dsor_assignments reads them for an absent
-- signer. `pnpm migrate` runs this file once, as the owner, after 048.

-- One person in one company. A person who leaves is kept, ended by someone, at a time; a person who
--   comes back is a new row (decision D6). A person has at most one live row in a company.
CREATE TABLE dsor.people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  principal_id text NOT NULL CHECK (principal_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  -- A principal's id, or 'owner' for the story's first rows and pnpm grant.
  added_by     text NOT NULL CHECK (added_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  reason       text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  added_at     timestamptz NOT NULL DEFAULT now(),
  removed_by   text CHECK (removed_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  removed_at   timestamptz,
  CONSTRAINT people_removed CHECK ((removed_by IS NULL) = (removed_at IS NULL))
);
CREATE UNIQUE INDEX people_one_live ON dsor.people (tenant_id, principal_id) WHERE removed_at IS NULL;

-- A person is removed once, by someone, at the database's time. Nothing else about them changes.
CREATE FUNCTION dsor.person_leaves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.principal_id, NEW.added_by, NEW.reason, NEW.added_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.principal_id, OLD.added_by, OLD.reason, OLD.added_at) THEN
    RAISE EXCEPTION 'a person''s row is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a person is removed once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.removed_by IS NULL THEN
    RAISE EXCEPTION 'a person is removed by someone' USING ERRCODE = 'check_violation';
  END IF;
  NEW.removed_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER people_leave BEFORE UPDATE ON dsor.people
  FOR EACH ROW EXECUTE FUNCTION dsor.person_leaves();

-- One role given to one member. A grant that needs a second administrator (needs_confirm) counts
--   only once someone else confirms it, within seven days. An ended grant is kept.
CREATE TABLE dsor.role_grants (
  id            text PRIMARY KEY
    CHECK (id ~ '^grt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  tenant_id     text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  principal_id  text NOT NULL CHECK (principal_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  role          text NOT NULL CHECK (role ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  asked_by      text NOT NULL CHECK (asked_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  reason        text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  needs_confirm boolean NOT NULL,
  asked_at      timestamptz NOT NULL DEFAULT now(),
  -- Set by the database: seven days for a grant that needs a confirm, none otherwise.
  expires_at    timestamptz,
  confirmed_by  text CHECK (confirmed_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  confirmed_at  timestamptz,
  ended_by      text CHECK (ended_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  ended_at      timestamptz,
  CONSTRAINT role_grants_confirmed CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT role_grants_ended CHECK ((ended_by IS NULL) = (ended_at IS NULL)),
  CONSTRAINT role_grants_confirm_needed CHECK (needs_confirm OR confirmed_by IS NULL),
  CONSTRAINT role_grants_expiry CHECK (needs_confirm = (expires_at IS NOT NULL))
);
-- At most one live grant of a role to a person in a company: active, or pending and not expired.
--   A pending grant past its seven days is ended by the next grant of the same role.
CREATE UNIQUE INDEX role_grants_one_live ON dsor.role_grants (tenant_id, principal_id, role)
  WHERE ended_at IS NULL;

-- A new grant names an active member of its own company, and starts unconfirmed and live. Read under
--   the company the transaction set, so a member of another company is no member here.
CREATE FUNCTION dsor.role_grant_starts() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dsor.people p
                  WHERE p.tenant_id = NEW.tenant_id AND p.principal_id = NEW.principal_id
                    AND p.removed_at IS NULL) THEN
    RAISE EXCEPTION 'a role is granted only to an active person of its company'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.confirmed_by IS NOT NULL OR NEW.ended_by IS NOT NULL THEN
    RAISE EXCEPTION 'a grant starts unconfirmed and live' USING ERRCODE = 'check_violation';
  END IF;
  NEW.expires_at := CASE WHEN NEW.needs_confirm THEN now() + interval '7 days' END;
  RETURN NEW;
END
$$;
CREATE TRIGGER role_grants_start BEFORE INSERT ON dsor.role_grants
  FOR EACH ROW EXECUTE FUNCTION dsor.role_grant_starts();

-- A grant moves once each way: confirmed once, by someone who neither asked nor gets the role,
--   before it expires; ended once. Nothing else about it changes. The times are the database's.
CREATE FUNCTION dsor.role_grant_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.principal_id, NEW.role, NEW.asked_by, NEW.reason,
      NEW.needs_confirm, NEW.asked_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.principal_id, OLD.role, OLD.asked_by, OLD.reason,
      OLD.needs_confirm, OLD.asked_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a grant is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'an ended grant moves no more' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    IF OLD.confirmed_by IS NOT NULL OR NOT OLD.needs_confirm
       OR OLD.expires_at <= clock_timestamp() OR NEW.ended_by IS NOT NULL THEN
      RAISE EXCEPTION 'a grant is confirmed once, while it waits' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_by IN (OLD.asked_by, OLD.principal_id) THEN
      RAISE EXCEPTION 'a grant is confirmed by someone who neither asked nor gets the role'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.confirmed_at := clock_timestamp();
  ELSIF NEW.ended_by IS NOT NULL THEN
    NEW.ended_at := clock_timestamp();
  ELSE
    RAISE EXCEPTION 'a grant is confirmed or ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER role_grants_move BEFORE UPDATE ON dsor.role_grants
  FOR EACH ROW EXECUTE FUNCTION dsor.role_grant_moves();

-- The story's people, with step 43's roles, as the first rows (decision D2). Written before the
--   tables are locked by company, as the earlier migrations seed the invoices.
INSERT INTO dsor.people (tenant_id, principal_id, added_by, reason) VALUES
  ('org_456', 'cfo_100',   'owner', 'the story''s people (step 43b''s README, decision D2)'),
  ('org_456', 'user_123',  'owner', 'the story''s people (step 43b''s README, decision D2)'),
  ('org_456', 'admin_100', 'owner', 'the story''s people (step 43b''s README, decision D2)'),
  ('org_789', 'user_700',  'owner', 'the story''s people (step 43b''s README, decision D2)'),
  ('org_789', 'admin_700', 'owner', 'the story''s people (step 43b''s README, decision D2)');
INSERT INTO dsor.role_grants (id, tenant_id, principal_id, role, asked_by, reason, needs_confirm)
SELECT 'grt_' || gen_random_uuid(), tenant_id, principal_id, role, 'owner',
       'the story''s people (step 43b''s README, decision D2)', false
  FROM (VALUES ('org_456', 'cfo_100', 'CFO'), ('org_456', 'user_123', 'ap_supervisor'),
               ('org_456', 'admin_100', 'tenant_admin'), ('org_789', 'user_700', 'ap_supervisor'),
               ('org_789', 'admin_700', 'tenant_admin')) AS story (tenant_id, principal_id, role);

-- Read across companies, because line ① reads a person's companies before it knows which one the
--   call works in; written only inside the company the transaction set (decision D5).
ALTER TABLE dsor.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.people FORCE ROW LEVEL SECURITY;
CREATE POLICY people_read ON dsor.people FOR SELECT USING (true);
CREATE POLICY people_add ON dsor.people FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
CREATE POLICY people_change ON dsor.people FOR UPDATE
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
ALTER TABLE dsor.role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.role_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY role_grants_read ON dsor.role_grants FOR SELECT USING (true);
CREATE POLICY role_grants_add ON dsor.role_grants FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
CREATE POLICY role_grants_change ON dsor.role_grants FOR UPDATE
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.people TO dsor_runtime;
GRANT INSERT (tenant_id, principal_id, added_by, reason) ON dsor.people TO dsor_runtime;
GRANT UPDATE (removed_by) ON dsor.people TO dsor_runtime;
GRANT SELECT ON dsor.role_grants TO dsor_runtime;
GRANT INSERT (id, tenant_id, principal_id, role, asked_by, reason, needs_confirm)
  ON dsor.role_grants TO dsor_runtime;
GRANT UPDATE (confirmed_by, ended_by) ON dsor.role_grants TO dsor_runtime;

-- The review of step 43's revisions, R-M2: a link and an invitation name only an active person of
--   their company. The database now knows the companies of a person.
CREATE OR REPLACE FUNCTION dsor.login_links() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.invitation_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM dsor.invitations i
         JOIN dsor.people p ON p.tenant_id = i.tenant_id AND p.principal_id = i.principal_id
                           AND p.removed_at IS NULL
        WHERE i.id = NEW.invitation_id AND i.principal_id = NEW.principal_id
          AND i.accepted_issuer = NEW.issuer AND i.accepted_subject = NEW.subject) THEN
    RAISE EXCEPTION 'a login is linked only by an invitation it accepted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.unlinked_by IS NOT NULL THEN
    RAISE EXCEPTION 'a link starts live' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION dsor.invitation_names_a_person() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dsor.people p
                  WHERE p.tenant_id = NEW.tenant_id AND p.principal_id = NEW.principal_id
                    AND p.removed_at IS NULL) THEN
    RAISE EXCEPTION 'an invitation names an active person of its company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invitations_name_a_person BEFORE INSERT ON dsor.invitations
  FOR EACH ROW EXECUTE FUNCTION dsor.invitation_names_a_person();
