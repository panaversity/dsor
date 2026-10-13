-- Each company's rules, in DSoR's own store: one row for each version of a rule, with its status,
-- and the rule's text as its draft wrote it (DSOR-CTL-02a). `pnpm migrate` runs this file once, as
-- the owner, after 022 (step 28's README, decisions D2 to D4, D14, and D17).
CREATE TABLE dsor.controls (
  tenant_id      text NOT NULL CHECK (tenant_id ~ '^org_[0-9]+$'),
  -- A rule's id is the last part of its address, dsor://org_456/rule/high-value-payment: lower-case
  -- words joined by dashes, from a letter to a letter or a digit, at most 64 characters (step 28's
  -- README, decision D7; step 28's review, finding L16).
  id             text NOT NULL CHECK (id ~ '^[a-z]([a-z0-9-]{0,62}[a-z0-9])?$'),
  version        integer NOT NULL CHECK (version >= 1),
  -- The four statuses this step builds. in_review is never set, and stale_authority arrives with
  -- step 28b (step 28's README, decision D17).
  status         text NOT NULL CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
  -- The rule's text: every field of control.schema.json but the six that the row keeps in
  -- columns of their own. dsor_runtime may never change it: a change is a new version
  -- (step 28's README, decision D2).
  rule           jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'),
  -- The person who wrote the draft.
  compiled_by    text NOT NULL CHECK (compiled_by <> ''),
  -- The database's clock, when the draft was written.
  drafted_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- The owner who switched the version on, and when, by the database's clock (step 28's README,
  -- decision D12).
  reviewed_by    text CHECK (reviewed_by <> ''),
  effective_from timestamptz,
  PRIMARY KEY (tenant_id, id, version),
  -- An active or a suspended version was switched on, so it names its reviewer, and when, as
  -- control.schema.json asks.
  CONSTRAINT controls_switched_on CHECK (
    status NOT IN ('active', 'suspended')
    OR (reviewed_by IS NOT NULL AND effective_from IS NOT NULL)
  ),
  -- A version takes effect after its draft is written.
  CONSTRAINT controls_effect_after_draft
    CHECK (effective_from IS NULL OR effective_from >= drafted_at),
  -- The six fields are the row's own: the rule's text never holds them, so the two cannot differ.
  CONSTRAINT controls_text_only CHECK (
    NOT (rule ?| ARRAY['id', 'version', 'status', 'compiled_by', 'reviewed_by', 'effective_from'])
  )
);

-- One live version for each rule: active or suspended, one at a time (step 28's README, decision
-- D4). A switch-on retires the live version first, in the same transaction.
CREATE UNIQUE INDEX controls_one_live ON dsor.controls (tenant_id, id)
  WHERE status IN ('active', 'suspended');

-- The lock of the company's tables: read and written only inside a transaction that set its
-- company (DSOR-TEN-01b; step 11's README, decisions 1 and 2).
ALTER TABLE dsor.controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsor.controls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dsor.controls
  USING (tenant_id = nullif(current_setting('dsor.tenant_id', true), ''));

-- A version starts as a draft, never switched on (step 28's README, decision D11). A retired
-- version never moves again, and no version moves back to draft (step 28's README, decision D13).
-- Restrictive, so the company's rule must agree too.
CREATE POLICY starts_as_draft ON dsor.controls AS RESTRICTIVE FOR INSERT TO dsor_runtime
  WITH CHECK (status = 'draft' AND reviewed_by IS NULL AND effective_from IS NULL);
CREATE POLICY moves_on ON dsor.controls AS RESTRICTIVE FOR UPDATE TO dsor_runtime
  USING (status <> 'retired') WITH CHECK (status <> 'draft');

-- The database's guard of a version's moves, beside DSoR's own picture in src/rulebook.ts, as
-- step 22's guards the moves of a proposal. A draft is switched on or retired. An active version
-- is suspended or retired. A suspended one is switched on again or retired. A retired one never
-- moves. Only a switch-on names a reviewer and the time it took effect, so the owner of record,
-- which DSoR reads from that history, cannot be forged by a move. Nothing else of a version ever
-- changes. It runs for every role, the owner's too, and returns the row, so it never swallows a
-- write. search_path is pinned, as for step 22's guard (step 28's README, decisions D10 and D13;
-- step 28's review, finding L14).
CREATE FUNCTION dsor.control_moves() RETURNS trigger LANGUAGE plpgsql
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
      ('suspended', 'active'), ('suspended', 'retired')
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
  RETURN NEW;
END
$$;
-- Nobody calls it by hand. The database runs it at each UPDATE.
REVOKE ALL ON FUNCTION dsor.control_moves() FROM PUBLIC;
CREATE TRIGGER controls_move BEFORE UPDATE ON dsor.controls
  FOR EACH ROW EXECUTE FUNCTION dsor.control_moves();

-- dsor_runtime reads the rules, adds a draft through named columns, and moves a version through
-- named columns. No DELETE, and no change to a version's text or to who wrote it. drafted_at is
-- the database's own.
GRANT SELECT ON dsor.controls TO dsor_runtime;
GRANT INSERT (tenant_id, id, version, status, rule, compiled_by) ON dsor.controls TO dsor_runtime;
GRANT UPDATE (status, reviewed_by, effective_from) ON dsor.controls TO dsor_runtime;

-- The log takes a fifth kind of record: a change to a company's rule, which
-- audit-record.schema.json names control_change (step 28's README, decision D14).
ALTER TABLE dsor.audit DROP CONSTRAINT audit_kind_check;
ALTER TABLE dsor.audit ADD CONSTRAINT audit_kind_check
  CHECK (kind IN ('decision', 'delegation_change', 'proposal_transition', 'operational_control',
                  'control_change'));

-- The story's rule: org_456's high-value-payment, version 8, active since 2026-09-01, as
-- controls.json writes it. A test keeps the two equal (step 28's README, decision D3).
INSERT INTO dsor.controls
  (tenant_id, id, version, status, rule, compiled_by, drafted_at, reviewed_by, effective_from)
VALUES
  ('org_456', 'high-value-payment', 8, 'active', '
  {
    "operation": "payment.create",
    "condition": "dsor_exceeds(state.invoice.open_amount, dsor_money(\"25000\", \"USD\"))",
    "effect": {
      "require_approval": {
        "role": "CFO",
        "quorum": 1
      }
    },
    "authority": {
      "system": "ksor",
      "uri": "ksor://org_456/finance/payment-approval-policy",
      "rule": "high-value-payment",
      "version": 4,
      "content_hash": "sha256:9f2c1e7ab4d0"
    },
    "owner": "cfo_100",
    "on_stale": "require_approval",
    "stale_grace": "P7D",
    "tests": [
      {
        "state": {
          "invoice": {
            "open_amount": {
              "value": "25000.00",
              "currency": "USD"
            }
          }
        },
        "expect": "ALLOW"
      },
      {
        "state": {
          "invoice": {
            "open_amount": {
              "value": "25000.01",
              "currency": "USD"
            }
          }
        },
        "expect": "REQUIRE_APPROVAL"
      },
      {
        "state": {
          "invoice": {
            "open_amount": {
              "value": "50000000.00",
              "currency": "PKR"
            }
          }
        },
        "rates": {
          "PKR": "280"
        },
        "expect": "REQUIRE_APPROVAL"
      },
      {
        "state": {
          "invoice": {
            "open_amount": {
              "value": "6000000.00",
              "currency": "PKR"
            }
          }
        },
        "rates": {
          "PKR": "280"
        },
        "expect": "ALLOW"
      },
      {
        "state": {
          "invoice": {
            "open_amount": {
              "value": "100.00",
              "currency": "XXX"
            }
          }
        },
        "expect": "REQUIRE_APPROVAL"
      }
    ]
  }
  '::jsonb, 'policy-compiler-fte', '2026-08-28T00:00:00Z', 'cfo_100', '2026-09-01T00:00:00Z');
