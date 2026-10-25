-- Step 43c: a company's own directory, by SCIM. Each company's copy of what its directory pushed:
-- users, groups, and who is in each; and each directory's credential, kept as a hash (DSOR-IDN-04a,
-- DSOR-IDN-05, DSOR-IDN-06; step 43c's README, claim C8, decisions L5, D2, D3, D4, and D6).
-- `pnpm migrate` runs this file once, as the owner, after 049.

-- Each directory's credential: the SHA-256 of the token the owner's pnpm directory-token made, and
--   the company it names. Read by the SCIM door before any company is known, so no company key.
--   dsor_runtime reads it and never writes it: only the owner makes or ends a credential (D3).
--   The column is `company`, not tenant_id: it is what the hash names, not the key of row-level
--   security, which a table read before any company is known cannot have (as dsor.logins).
CREATE TABLE dsor.directory_clients (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  company    text NOT NULL CHECK (company ~ '^org_[0-9]+$'),
  made_at    timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);
-- One live credential per company: a new one ends the old (pnpm directory-token).
CREATE UNIQUE INDEX directory_clients_one_live ON dsor.directory_clients (company)
  WHERE ended_at IS NULL;

-- One user of one company's copy. `id` is DSoR's, given at the first push; `principal_id` is the
--   username of that push, her DSoR id, and never changes; `external_id` is her directory's uuid,
--   and never changes. A deleted user is kept, ended at a time (the learner's L5 and L8).
CREATE TABLE dsor.scim_users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  external_id  uuid NOT NULL,
  principal_id text NOT NULL CHECK (principal_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  user_name    text NOT NULL CHECK (length(user_name) BETWEEN 1 AND 200),
  display_name text CHECK (length(display_name) BETWEEN 1 AND 200),
  active       boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  changed_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX scim_users_one_live_uuid ON dsor.scim_users (tenant_id, external_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX scim_users_one_live_person ON dsor.scim_users (tenant_id, principal_id)
  WHERE deleted_at IS NULL;

-- A new user starts live, and her DSoR id is no other company's, in the copies or in DSoR's own table
--   of people, now or ever (the learner's L5; step 43b's review, finding 1). The id's lock is the one
--   step 43b's person.add takes, so a push and an administrator's add of one id are one after the
--   other.
CREATE FUNCTION dsor.scim_user_starts() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dsor.people/' || NEW.principal_id, 0));
  -- Changed by the review of step 43c, finding 1: or this company had it under another uuid. Slips
  --   and approvals name the id, so a new hire must never inherit a leaver's.
  IF EXISTS (SELECT 1 FROM dsor.scim_users u
              WHERE u.principal_id = NEW.principal_id
                AND (u.tenant_id <> NEW.tenant_id OR u.external_id <> NEW.external_id))
     OR EXISTS (SELECT 1 FROM dsor.people p
                 WHERE p.principal_id = NEW.principal_id AND p.tenant_id <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'the id % is taken', NEW.principal_id USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a user starts live' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.changed_at := NEW.created_at;
  RETURN NEW;
END
$$;
CREATE TRIGGER scim_users_start BEFORE INSERT ON dsor.scim_users
  FOR EACH ROW EXECUTE FUNCTION dsor.scim_user_starts();

-- A user's ids and her company never change; she is deleted once, and a deleted user changes no
--   more. The times are the database's.
CREATE FUNCTION dsor.scim_user_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.external_id, NEW.principal_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.external_id, OLD.principal_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a user''s ids never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted user changes no more' USING ERRCODE = 'check_violation';
  END IF;
  NEW.changed_at := clock_timestamp();
  IF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at := NEW.changed_at; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER scim_users_move BEFORE UPDATE ON dsor.scim_users
  FOR EACH ROW EXECUTE FUNCTION dsor.scim_user_moves();

-- One group of one company's copy, keyed by its directory's uuid, the id the role map names (L3).
--   Its name may change; a deleted group is kept, ended at a time.
CREATE TABLE dsor.scim_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  external_id uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX scim_groups_one_live ON dsor.scim_groups (tenant_id, external_id)
  WHERE deleted_at IS NULL;

CREATE FUNCTION dsor.scim_group_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a group starts live' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.external_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.external_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a group''s ids never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted group changes no more' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at := clock_timestamp(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER scim_groups_move BEFORE INSERT OR UPDATE ON dsor.scim_groups
  FOR EACH ROW EXECUTE FUNCTION dsor.scim_group_moves();

-- One member of one group, both of one company: the keys say so. A member who leaves is kept, ended at
--   a time; one who comes back is a new row.
CREATE TABLE dsor.scim_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  group_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  FOREIGN KEY (tenant_id, group_id) REFERENCES dsor.scim_groups (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES dsor.scim_users (tenant_id, id)
);
CREATE UNIQUE INDEX scim_members_one_live ON dsor.scim_members (group_id, user_id)
  WHERE removed_at IS NULL;

-- A member joins a live group as a live user (decision D6), and leaves once.
CREATE FUNCTION dsor.scim_member_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM dsor.scim_users u
                    WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.user_id AND u.deleted_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM dsor.scim_groups g
                       WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.group_id AND g.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'a member joins a live group as a live user' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a member starts in' USING ERRCODE = 'check_violation';
    END IF;
    NEW.added_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.group_id, NEW.user_id, NEW.added_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.group_id, OLD.user_id, OLD.added_at) THEN
    RAISE EXCEPTION 'a member''s row never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'a member leaves once' USING ERRCODE = 'check_violation';
  END IF;
  NEW.removed_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER scim_members_move BEFORE INSERT OR UPDATE ON dsor.scim_members
  FOR EACH ROW EXECUTE FUNCTION dsor.scim_member_moves();

-- Read across companies, because line ① reads a person's companies before it knows the call's; written
--   only inside the company the transaction set, as step 43b's people are (step 43b's README, D5).
--   Every read of one company's copy names that company (decision D4).
ALTER TABLE dsor.scim_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.scim_users FORCE ROW LEVEL SECURITY;
CREATE POLICY scim_users_read ON dsor.scim_users FOR SELECT USING (true);
CREATE POLICY scim_users_add ON dsor.scim_users FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
CREATE POLICY scim_users_change ON dsor.scim_users FOR UPDATE
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
ALTER TABLE dsor.scim_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.scim_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY scim_groups_read ON dsor.scim_groups FOR SELECT USING (true);
CREATE POLICY scim_groups_add ON dsor.scim_groups FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
CREATE POLICY scim_groups_change ON dsor.scim_groups FOR UPDATE
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
ALTER TABLE dsor.scim_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.scim_members FORCE ROW LEVEL SECURITY;
CREATE POLICY scim_members_read ON dsor.scim_members FOR SELECT USING (true);
CREATE POLICY scim_members_add ON dsor.scim_members FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));
CREATE POLICY scim_members_change ON dsor.scim_members FOR UPDATE
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.directory_clients TO dsor_runtime;
GRANT SELECT ON dsor.scim_users TO dsor_runtime;
GRANT INSERT (tenant_id, external_id, principal_id, user_name, display_name, active)
  ON dsor.scim_users TO dsor_runtime;
GRANT UPDATE (user_name, display_name, active, deleted_at) ON dsor.scim_users TO dsor_runtime;
GRANT SELECT ON dsor.scim_groups TO dsor_runtime;
GRANT INSERT (tenant_id, external_id, name) ON dsor.scim_groups TO dsor_runtime;
GRANT UPDATE (name, deleted_at) ON dsor.scim_groups TO dsor_runtime;
GRANT SELECT ON dsor.scim_members TO dsor_runtime;
GRANT INSERT (tenant_id, group_id, user_id) ON dsor.scim_members TO dsor_runtime;
GRANT UPDATE (removed_at) ON dsor.scim_members TO dsor_runtime;

-- When DSoR last heard from a company's directory: the latest ALLOW record of that directory's login
--   in that company, read as dsor_runtime inside a transaction that sets the company, as every read
--   of the audit is (decision D2). No function of the owner's answers it: step 16's map refuses a
--   SECURITY DEFINER function dsor_runtime may run, a door around row-level security. The index keeps
--   the read short.
CREATE INDEX audit_directory_heard ON dsor.audit (tenant, ((correlation->>'principal_id')), at)
  WHERE "authorization" = 'ALLOW';
