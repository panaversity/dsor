-- NEW IN STEP 22: proposals, DSoR's fourth kind of paperwork (DSOR-APR-01a, decision 136).
--
-- Every command that gets past the idempotency claim becomes a proposal: a record of what was
-- asked, by whom, and where it is now, like an order-tracking page. Its payload is written once and
-- never changed. Where it is now is its history: every move, with who made it and why, and its
-- state is its last move.
--
-- The application adds to these tables and changes nothing in them. The rules of §26.2 are kept by
-- the database, in constraints, so no code path, careless or not, can write a move that is not on
-- the map, leave a state twice, or leave a finished one.
--
-- STEP 22, decision 157: and every move names its record in the audit log, so no code path
-- can write a move that the log does not have (DSOR-AUD-01). This file was edited in place to add
-- that, as decision 123 did for 008: no database anyone keeps had run it. A database that ran the
-- earlier 020 is refused by `pnpm migrate`'s checksum, and is made again.

-- The map of §26.2: every move a proposal may make. A state with no move out of it is finished.
-- The moves into and out of compensation wait for compensation, which this program does not have.
-- Nobody but the owner may change it: a move out of COMMITTED, added here, would undo the rule.
CREATE TABLE dsor.proposal_map (
  from_state TEXT NOT NULL,
  to_state   TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO dsor.proposal_map (from_state, to_state) VALUES
  ('PROPOSED',         'DENIED'),
  ('PROPOSED',         'READY'),
  ('PROPOSED',         'PENDING_APPROVAL'),
  ('READY',            'EXECUTING'),
  ('PENDING_APPROVAL', 'APPROVED'),
  ('PENDING_APPROVAL', 'REJECTED'),
  ('PENDING_APPROVAL', 'EXPIRED'),
  ('PENDING_APPROVAL', 'CANCELLED'),
  ('APPROVED',         'EXECUTING'),
  ('APPROVED',         'EXPIRED'),
  ('APPROVED',         'REVOKED'),
  ('APPROVED',         'INVALIDATED'),
  ('APPROVED',         'CANCELLED'),
  ('EXECUTING',        'COMMITTED'),
  ('EXECUTING',        'FAILED'),
  ('EXECUTING',        'OUTCOME_UNKNOWN'),
  ('OUTCOME_UNKNOWN',  'COMMITTED'),
  ('OUTCOME_UNKNOWN',  'FAILED');

REVOKE ALL ON dsor.proposal_map FROM PUBLIC;

CREATE SEQUENCE dsor.proposal_numbers;

CREATE TABLE dsor.proposals (
  tenant          TEXT NOT NULL,
  id              TEXT NOT NULL DEFAULT 'prop_' || nextval('dsor.proposal_numbers'),
  operation       TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('execute', 'propose_only')),
  -- The arguments as the text the payload hash was computed from, so the payload can be shown and
  -- hashed again word for word. JSONB would reorder its keys (found in step 20).
  payload         TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  -- Who asked, as the decision record says it: the mode, the subject, the actor chain, the slip.
  requester       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, id)
);

ALTER SEQUENCE dsor.proposal_numbers OWNED BY dsor.proposals.id;

CREATE TABLE dsor.proposal_moves (
  -- The order the moves were written in. Two moves can carry the same time; they cannot share this.
  seq        BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant     TEXT NOT NULL,
  proposal   TEXT NOT NULL,
  -- NULL only for the first move, which is into PROPOSED and nowhere else.
  from_state TEXT,
  to_state   TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor      TEXT NOT NULL CHECK (actor <> ''),
  cause      TEXT NOT NULL CHECK (cause <> ''),
  -- STEP 22, decision 157: the move's record in the company's audit log, written by the
  -- same statement. A move with none, or with one the log does not have, is refused; and a record a
  -- move names cannot be deleted. Not UNIQUE: a place in the log lost to another record would then
  -- be refused here too, and read as the map refusing the move.
  record     TEXT NOT NULL REFERENCES dsor.audit (record_id),
  CHECK ((from_state IS NULL) = (to_state = 'PROPOSED')),
  FOREIGN KEY (tenant, proposal) REFERENCES dsor.proposals (tenant, id),
  -- On the map. A move out of a finished state has nothing here to point at, so it is refused.
  FOREIGN KEY (from_state, to_state) REFERENCES dsor.proposal_map (from_state, to_state),
  -- §26.2 has no loops, so a proposal enters each state at most once...
  UNIQUE (tenant, proposal, to_state),
  -- ...and leaves it at most once. Two moves out of READY cannot both be written, which is how a
  -- proposal runs at most once (DSOR-IDM-04).
  UNIQUE (tenant, proposal, from_state),
  -- And only out of a state it is in: a move out of READY needs the move into READY.
  FOREIGN KEY (tenant, proposal, from_state)
    REFERENCES dsor.proposal_moves (tenant, proposal, to_state)
);

-- Add, and read; never change, never delete. The number comes from the column's default.
REVOKE ALL ON dsor.proposals, dsor.proposal_moves FROM PUBLIC;
REVOKE ALL ON SEQUENCE dsor.proposal_numbers FROM PUBLIC;
GRANT SELECT ON dsor.proposals, dsor.proposal_moves TO dsor_runtime;
GRANT INSERT (tenant, operation, mode, payload, payload_hash, requester, idempotency_key)
  ON dsor.proposals TO dsor_runtime;
-- STEP 22, decision 157: and the record each move names.
GRANT INSERT (tenant, proposal, from_state, to_state, actor, cause, record)
  ON dsor.proposal_moves TO dsor_runtime;
GRANT USAGE ON SEQUENCE dsor.proposal_numbers TO dsor_runtime;

-- The second lock, word for word as 005, 011, 013 and 018 write it.
ALTER TABLE dsor.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.proposals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.proposals
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));

ALTER TABLE dsor.proposal_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.proposal_moves FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON dsor.proposal_moves
  USING      (tenant = current_setting('dsor.tenant_id', true))
  WITH CHECK (tenant = current_setting('dsor.tenant_id', true));
