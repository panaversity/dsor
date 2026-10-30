-- DSoR's own table of links: which principal a person's login is (DSOR-IDN-01 in
-- specs/dsor/02-security.md, section 12; step 43's README, claim C8, decision D5). A login is an
-- issuer, the sign-in service, and a subject, the user's id there. A login proves who you are; this
-- table says which principal that is. `pnpm migrate` runs this file once, as the owner, after 046.

-- No company column: line ① reads it before any company is known, and one person's login is the
--   same person in every company. The companies a login counts in come from issuers.json
--   (decision D6), and the person's roles from DSoR's own table of principals.
CREATE TABLE dsor.logins (
  issuer text NOT NULL CHECK (issuer ~ '^https?://[^\s/]+' AND length(issuer) <= 512),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  principal_id text NOT NULL CHECK (principal_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

-- dsor_runtime reads a link, and nothing else: only the owner adds one, with pnpm link-login, so a
--   program that is broken into cannot make itself anyone.
GRANT SELECT ON dsor.logins TO dsor_runtime;
