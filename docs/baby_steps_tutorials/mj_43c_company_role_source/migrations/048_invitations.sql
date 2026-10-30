-- The learner's revisions R1, R2, R3, and R7 of step 43: a person joins by an invitation, and
-- unlinking is the off-switch (DSOR-IDN-01 in specs/dsor/02-security.md, section 12; step 43's
-- README, the revised design). `pnpm migrate` runs this file once, as the owner, after 047.
--
-- Until now only the owner added a link, with pnpm link-login. Now DSoR adds one itself, at line ①,
-- when a new login's first call carries an invitation's code. So dsor_runtime may add a link, but
-- only one that an invitation it accepted names: the database checks that, not the program.

-- One invitation: a company's administrator, or the owner with pnpm invite, invites a person of
--   the company. The code leaves DSoR once, in the answer; only its SHA-256 is kept, so a copy of
--   this table cannot be used to join.
CREATE TABLE dsor.invitations (
  tenant_id        text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  id               text PRIMARY KEY
    CHECK (id ~ '^inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  principal_id     text NOT NULL CHECK (principal_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  code_hash        text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  -- A principal's id, or 'owner' for pnpm invite.
  invited_by       text NOT NULL CHECK (invited_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  reason           text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  -- The database's clock, as for every record (step 09's README, decision 6). dsor_runtime cannot
  --   name an end date: seven days, always (decision R1).
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_issuer  text,
  accepted_subject text,
  accepted_at      timestamptz,
  cancelled_by     text CHECK (cancelled_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  cancelled_at     timestamptz,
  CONSTRAINT invitations_accepted CHECK (
    (accepted_issuer IS NULL) = (accepted_subject IS NULL)
    AND (accepted_issuer IS NULL) = (accepted_at IS NULL)),
  CONSTRAINT invitations_cancelled CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
  CONSTRAINT invitations_one_end CHECK (accepted_at IS NULL OR cancelled_at IS NULL)
);

-- An invitation moves once: open to accepted, before it expires, or open to cancelled. Nothing else
--   about it ever changes. The times are the database's.
CREATE FUNCTION dsor.invitation_moves() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.principal_id, NEW.code_hash, NEW.invited_by, NEW.reason,
      NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.principal_id, OLD.code_hash, OLD.invited_by, OLD.reason,
      OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'an invitation is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.accepted_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'an invitation is accepted or cancelled once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.accepted_issuer IS NOT NULL AND NEW.cancelled_by IS NULL THEN
    IF OLD.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'an invitation is accepted before it expires' USING ERRCODE = 'check_violation';
    END IF;
    NEW.accepted_at := clock_timestamp();
  ELSIF NEW.cancelled_by IS NOT NULL AND NEW.accepted_issuer IS NULL THEN
    NEW.cancelled_at := clock_timestamp();
  ELSE
    RAISE EXCEPTION 'an invitation is accepted or cancelled once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invitations_move BEFORE UPDATE ON dsor.invitations
  FOR EACH ROW EXECUTE FUNCTION dsor.invitation_moves();

ALTER TABLE dsor.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.invitations
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.invitations TO dsor_runtime;
GRANT INSERT (tenant_id, id, principal_id, code_hash, invited_by, reason)
  ON dsor.invitations TO dsor_runtime;
GRANT UPDATE (accepted_issuer, accepted_subject, cancelled_by) ON dsor.invitations TO dsor_runtime;

-- The links are kept when they end, so the table is the history of who was whom: an id of its own,
--   the invitation that made it, and who ended it, when. A login has at most one live link.
--   The links pnpm link-login wrote before this file name no invitation; they stay as they are.
ALTER TABLE dsor.logins DROP CONSTRAINT logins_pkey;
ALTER TABLE dsor.logins
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ADD COLUMN invitation_id text REFERENCES dsor.invitations (id),
  ADD COLUMN unlinked_by text CHECK (unlinked_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  ADD COLUMN unlinked_at timestamptz,
  ADD CONSTRAINT logins_unlinked CHECK ((unlinked_by IS NULL) = (unlinked_at IS NULL));
CREATE UNIQUE INDEX logins_one_live ON dsor.logins (issuer, subject) WHERE unlinked_at IS NULL;
-- And a person has at most one live login: found by the review of R1 to R7, finding 1, where an
--   admin invited a person who had a login, redeemed the code with a second sign-up, and was that
--   person too. To change a person's login, unlink it first, which is kept.
CREATE UNIQUE INDEX logins_one_per_person ON dsor.logins (principal_id) WHERE unlinked_at IS NULL;

-- A new link names an invitation that this login accepted, for this person. Read under the
--   company the transaction set, so an invitation of another company is no invitation here.
CREATE FUNCTION dsor.login_links() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.invitation_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM dsor.invitations i
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
CREATE TRIGGER logins_link BEFORE INSERT ON dsor.logins
  FOR EACH ROW EXECUTE FUNCTION dsor.login_links();

-- A link ends once, by someone, at the database's time. Nothing else about it ever changes.
CREATE FUNCTION dsor.login_ends() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.issuer, NEW.subject, NEW.principal_id, NEW.linked_at, NEW.invitation_id)
     IS DISTINCT FROM
     (OLD.id, OLD.issuer, OLD.subject, OLD.principal_id, OLD.linked_at, OLD.invitation_id) THEN
    RAISE EXCEPTION 'a link is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.unlinked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a link ends once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.unlinked_by IS NULL THEN
    RAISE EXCEPTION 'a link ends by someone' USING ERRCODE = 'check_violation';
  END IF;
  NEW.unlinked_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER logins_end BEFORE UPDATE ON dsor.logins
  FOR EACH ROW EXECUTE FUNCTION dsor.login_ends();

GRANT INSERT (issuer, subject, principal_id, invitation_id) ON dsor.logins TO dsor_runtime;
GRANT UPDATE (unlinked_by) ON dsor.logins TO dsor_runtime;
