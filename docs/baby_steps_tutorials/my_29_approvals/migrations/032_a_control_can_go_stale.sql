-- NEW IN STEP 28: the program may mark a control stale, as well as switch one on (decision 165).
--
-- When the policy a control came from changes, DSoR marks the control `stale_authority`: still in
-- force, and flagged for its owner to review (DSOR-CTL-03a, DSOR-CTL-03b). Migration 031's lock let
-- the application move a waiting control to active and nothing else. Now it may also move one in
-- force to stale, and still nothing else: never retire, suspend or rewrite one, and never move a
-- stale one at all. A policy sees the new row only, so it cannot tell a waiting control from one in
-- force when either becomes stale: one that was waiting would then be in force with no case run,
-- which errs toward stopping payments, never toward letting them through (decision 166).

DROP POLICY only_switched_on ON dsor.controls;

CREATE POLICY switched_on_or_marked_stale ON dsor.controls AS RESTRICTIVE FOR UPDATE
  USING      (status IN ('draft', 'in_review', 'active'))
  WITH CHECK (status IN ('active', 'stale_authority') AND switched_on_at IS NOT NULL);
