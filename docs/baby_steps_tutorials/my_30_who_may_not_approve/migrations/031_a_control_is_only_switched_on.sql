-- NEW IN STEP 27: the application may switch a waiting control on, and nothing else (decision 164).
--
-- Migration 028 let the application change a control's status, and nothing said to what. A review
-- set the CFO's control to `retired` in one statement, and user_123's 31,400.00 USD payment was
-- made with no CFO, and nothing on the record said the policy was off. Now a control the
-- application changes must be waiting, a draft or in review, and must end active, with the moment
-- it was switched on. Restrictive, so AND'ed with the company lock; start-up refuses the table
-- without it. Marking one stale, and retiring one, are step 28's, and will say so here.

CREATE POLICY only_switched_on ON dsor.controls AS RESTRICTIVE FOR UPDATE
  USING      (status IN ('draft', 'in_review'))
  WITH CHECK (status = 'active' AND switched_on_at IS NOT NULL);
