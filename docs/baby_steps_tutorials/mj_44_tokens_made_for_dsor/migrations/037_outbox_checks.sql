-- Step 40's review, L4: two more things dsor.outbox holds true of every event, beside the checks of
-- migration 036. An event is its company's: its resource is in that company, and its correlation
-- names that company (DSOR-EVT-01d in specs/dsor/03-execution.md, section 31). And an event is
-- never labelled restricted, so a RESTRICTED value is never announced (DSOR-EVT-01c). TypeScript
-- builds every event so; the database refuses a writer that did not (step 40's README, decision D2).
ALTER TABLE dsor.outbox ADD CONSTRAINT outbox_of_its_company CHECK (
  starts_with(resource, 'dsor://' || tenant_id || '/')
  AND event->'correlation'->>'tenant_id' = tenant_id
);
ALTER TABLE dsor.outbox ADD CONSTRAINT outbox_never_restricted CHECK (
  event->>'classification' IN ('public', 'internal', 'confidential')
);
