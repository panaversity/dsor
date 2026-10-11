# Step 21 · Optimistic concurrency

Folder: [`my_21_optimistic_concurrency`](../my_21_optimistic_concurrency/README.md) · 718 tests,
plus 53 in the database tier
Spec: [§23](../../../specs/dsor/03-execution.md#23-concurrency) · `DSOR-CON-01a`, `DSOR-CON-01b`
The database tier, 53 tests, passes on a local PostgreSQL 17 set up like Neon, nineteen migrations
applied, on the final code; on Neon, `dsor_step21` waits for this folder's `.env`. Decisions
[133](decisions.md), [134](decisions.md) and [135](decisions.md).

## What the step is

Every invoice and payment has a version, a whole number from 1, raised by one in the same UPDATE as
every change. A command that changes a record says which version it decided on, as
`expected_version`, and the check is part of the change: `... AND version = $3`. A record that has
moved on is refused with `STALE_STATE`, retry `after_state_refresh`, before any business rule, and
the message does not say what the version is now. Every command's contract declares its strategy:
`invoice.issue` and `payment.cancel` are `optimistic`, `payment.create` is `none`.

## How it was built

Built on the learner's standing instruction: the problem stated first, and every decision taken with
the recommended option ([decision 133](decisions.md)), each open to reversal.

Then the copy, its markers made plain, and the pieces, each red first and committed alone:

1. **The version column**, migration 019, on invoices and payments, and in every read.
2. **The check in the UPDATE**, and the outcome read back in order: stale first, then the status.
3. **The strategy in each contract**, and `expected_version` asked of every optimistic command.
4. **The demo**: the agent issues on the version it read, and two decide on one payment.

## What the build found

**A race between two decisions in one company is the log's, not the version's.** The first race
test sent two commands through the door together, and the second one lost the race for the next
place in the audit log, `EVIDENCE_STORE_UNAVAILABLE`, before the version was ever checked. The race
is now tested at the store, and on a real server over a pool.

**A script that added `expected_version` to every command in the tests added it twice in four
places.** The tests still passed, because the second copy had the same value; it was removed.

## Limits, stated

- Only the application raises the version, so an owner who edits a row by hand leaves it as it was.
- A row deleted and written again starts at 1, and so does every new record, so
  `expected_version: 1` proves nothing was read.
- The read label still has no `resource_version`, so `DSOR-FRS-01a` is met in part.
- Payments have no read operation; the agent knows a payment's version from a receipt.
- `pessimistic` and `connector_managed` are refused at load, not carried out.
- The log records the decision, so a stale command shows as `ALLOW`.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found the check and the raise in one
statement, the version checked before any business rule, and `expected_version` read once and inside
the payload hash. It found, each measured, and all fixed as [decision 134](decisions.md):

- **A version above 2147483647 made the door throw**, logged ALLOW for something that never ran, and
  left a claim with no answer. A version is now a whole number from 1 to 2147483647.
- **The declared strategy was decoration**: nothing read it, and a missing version was recorded as
  ALLOW. §21.6 now asks every optimistic command, and the registry refuses a strategy it does not
  carry out.
- **With the version taken out of the UPDATE, every step-21 test still passed**, because the status
  refused each case. Tests now decide on a draft as the wrong version.
- **`STALE_STATE` said the new version**, which an agent could retry on without reading. It does not.
- **Start-up did not ask about the new rights**, nor about an invoice's vendor and amount.

## Breaking it on purpose

Decision 134's five checkable fixes were each broken once, in a copy, on the whole suite, with the
prediction written first. Three failed as predicted, and two did not, which became
[decision 135](decisions.md): a cancel that ignored the version passed every test on both tiers,
the 20-way race included, because the status alone lets one cancel through; and `STALE_STATE` could
say "(now 2)" past a test that looked only for "version 2". A payment decided on as the wrong version
and a message compared word for word now fail under those breaks. The README's three breaks were
measured twice on the final code, and the two runs agreed: 2, 6 and 1 failing.
