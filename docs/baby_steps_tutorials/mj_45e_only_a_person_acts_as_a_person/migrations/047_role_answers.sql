-- The answers DSoR keeps from each company's role source: one row for each company and person,
-- the last answer DSoR could use about that person's job (DSOR-IDN-05 and DSOR-IDN-06 in
-- specs/dsor/02-security.md, section 12.1). An answer asked for less than 10 seconds ago is used
-- again, and the company's server is not asked. Every DSoR server reads the same rows, and a
-- restart keeps them (step 45's README, D3 and D8). dsor_runtime never deletes a row: an answer
-- DSoR forgets, after a reply it could not use, leaves the row with no answer.
CREATE TABLE dsor.role_answers (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  person    text NOT NULL CHECK (person <> ''),
  -- The answer as the company's server gave it, after DSoR checked it: tenant, person, status,
  -- roles, and as_of (step 45's README, D4).
  answer    jsonb,
  -- The earlier of the server's as_of and the moment DSoR asked (D13). DSoR's clock, not the
  -- database's: line ③ compares it with DSoR's clock.
  as_of     timestamptz,
  -- The moment DSoR asked. The 10-second reuse runs from here (D3).
  asked_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, person),
  -- An answer and its time go together: both, or neither once DSoR forgets them.
  CHECK ((answer IS NULL) = (as_of IS NULL)),
  -- An answer is about this row's company and person, and no other (D2).
  CHECK (answer IS NULL OR (answer->>'tenant' = tenant_id AND answer->>'person' = person))
);

ALTER TABLE dsor.role_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.role_answers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.role_answers
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

GRANT SELECT ON dsor.role_answers TO dsor_runtime;
GRANT INSERT (tenant_id, person, answer, as_of, asked_at) ON dsor.role_answers TO dsor_runtime;
GRANT UPDATE (answer, as_of, asked_at) ON dsor.role_answers TO dsor_runtime;
