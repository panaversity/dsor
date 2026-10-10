-- The audit log, as a table.
--
-- Step 08 built this record and kept it in an array, so closing the program lost every decision it
-- had written down. Here it becomes rows, and three of the things step 08 could only promise in a
-- comment become the database's job.
--
-- Read for the specification's own shape: every column below is a field of
-- audit-record.schema.json, and nothing has been added or renamed on the way in.

CREATE TABLE public.audit (
  -- The primary key, which is what makes step 08's record-id finding permanent. A reset there could
  -- hand the same id to two different decisions; a primary key means the second one cannot be written.
  record_id      TEXT        PRIMARY KEY,

  chain          TEXT        NOT NULL,
  sequence       BIGINT      NOT NULL CHECK (sequence >= 0),

  previous_hash  TEXT        NOT NULL CHECK (previous_hash ~ '^sha256:[A-Za-z0-9+/=_-]+$'),
  record_hash    TEXT        NOT NULL CHECK (record_hash  ~ '^sha256:[A-Za-z0-9+/=_-]+$'),

  -- The time the application says the decision was made. It is inside the hash, so it has to be the
  -- application's: the hash is computed before the row exists, and UPDATE is revoked afterwards, so
  -- there is no moment at which the database could stamp it and still be covered.
  at             TIMESTAMPTZ NOT NULL,

  -- The time the database wrote the row, stamped by the database, and not covered by the hash. This
  -- is the independent witness: `setClock()` can still backdate `at`, and a backdated record then
  -- sits here with its two times years apart.
  --
  -- `DEFAULT now()` is what fills it, and a default is not a defence — it applies only when the
  -- INSERT leaves the column out. This comment used to say "which the application cannot set", and
  -- that was false. Measured:
  --
  --   INSERT SUCCEEDED. at=2026-10-04 05:00:00+05  recorded_at=1999-01-01 05:00:00+05
  --
  -- The application forged the witness, because `GRANT INSERT ON audit` covers every column. What
  -- makes the sentence true is the **column-level** grant in `002_runtime_user.sql`, which lists
  -- every column except this one.
  --
  -- Detection, not prevention, for `at` itself. A CHECK that `at` is close to now() would prevent a
  -- backdated `at` and would also refuse an innocent slow request — and a refused audit write means
  -- the operation does not run.
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  tenant         TEXT        NOT NULL,
  kind           TEXT        NOT NULL,

  -- JSONB, because the schema says these are objects and flattening them would be this program
  -- inventing a shape the specification did not ask for. `identity` holds the mode, the subject, the
  -- actor chain and the subject's authority; `correlation` holds the request id.
  identity       JSONB       NOT NULL,
  correlation    JSONB       NOT NULL,

  operation      TEXT,
  payload_hash   TEXT,
  -- Quoted, because AUTHORIZATION is a reserved word in SQL. Keeping the schema's own field name and
  -- paying for the quotes beats renaming it and maintaining a mapping that someone will get wrong.
  "authorization" TEXT       CHECK ("authorization" IN ('ALLOW', 'DENY')),
  result         TEXT        NOT NULL,
  reason         TEXT,

  -- Two records in one chain cannot claim one position. Step 08 takes the next sequence by reading
  -- the length and then writing, which is safe there only because nothing suspends in between — its
  -- own comment says so and says this is where it has to become real. A unique constraint is the
  -- database refusing, which is not the same kind of thing as hoping.
  UNIQUE (chain, sequence)
);

-- There was a `CREATE INDEX audit_chain_sequence ON audit (chain, sequence);` here, with the comment
-- "without this, every read of a chain is a scan of the whole table". It was a duplicate, and the
-- comment was false. `UNIQUE (chain, sequence)` above is implemented *as* an index, so the table
-- already had two with identical columns:
--
--   audit_chain_sequence       INDEX        ON public.audit USING btree (chain, sequence)
--   audit_chain_sequence_key   UNIQUE INDEX ON public.audit USING btree (chain, sequence)
--
-- The second serves every read the first would, so the first bought nothing and cost a write on
-- every INSERT and space on disk. Measured 2026-10-04.
--
-- The lesson, and it is the reason this is a comment and not a silent deletion: a UNIQUE constraint
-- is an index. Reaching for `CREATE INDEX` on the same columns is a reflex worth catching.
