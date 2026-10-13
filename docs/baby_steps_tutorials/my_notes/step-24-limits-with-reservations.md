# Step 24 · Limits with reservations

Folder: [`my_24_limits_with_reservations`](../my_24_limits_with_reservations/README.md) · 916 tests,
plus 59 in the database tier
Spec: [§13.4](../../../specs/dsor/02-security.md#134-cumulative-limits) · `DSOR-DEL-06a`,
`DSOR-DEL-06b`, `DSOR-DEL-06c`, `DSOR-DEL-06d` and `DSOR-DEL-06e`, the approval states of `06c` and
`06d` waiting for approvals
The database tier, 59 tests, passes on a local PostgreSQL 17 set up like Neon, twenty-three
migrations applied, on the final code; on Neon, `dsor_step24` waits for this folder's `.env`.
Decisions [140](decisions.md) and [141](decisions.md).

## What the step is

del_100 may spend 200,000.00 USD a day beside 50,000.00 a payment, as the specification's slip has
it. Each payment books its amount against the slip's running total for the day, a calendar day in
UTC, in one statement that adds it only if the total stays within the limit, and writes a
reservation keyed by its proposal from the same statement. The reservation follows its proposal:
held while it may run, committed when it ran, released when it did not, and only when the history
holds the move. A dry run reads the room and books nothing.

## How it was built

Built on the learner's standing instruction: the problem stated first, and every decision taken with
the recommended option ([decision 140](decisions.md)), each open to reversal.

1. **The limit, the day's totals and the reservations**: migrations 022 and 023, `src/reservation.ts`.
2. **§21.10 books, and the door settles.**
3. **Fifty at once on a real server.**
4. **The demo**: ten payments of 25,000.00, one after another.

## What the build found

**Fifty payments at once in one company mostly lose the race for its log.** PGlite made one of fifty
and refused forty-nine `EVIDENCE_STORE_UNAVAILABLE`; a real server over a pool made two or three. So
a unit test of fifty payments through the door passed with one made and proved nothing, and was
removed; the demo sends its payments one after another. And a payment books before its decision is
recorded, so the bookings of requests about to lose the log race count for a moment: one payment in
each real-server run was refused `LIMIT_EXCEEDED` with room left. The limit erred toward refusing.
Since decision 157 they no longer lose it: a record that loses its place tries the next one, and
fifty of fifty were made on a real server.

**The day's 34,500.00 before the demo's ten** includes the 400.00 prepared in step 23's section,
held while it waits at READY, and two payments since cancelled: cancelling does not give an amount
back.

## Limits, stated

- The application's own code could still make room, or pay past the limit: a payment is not tied to
  its reservation.
- Cancelling a payment does not give its amount back to the day.
- One window, a day in UTC; another currency is refused until step 26.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found the booking atomic, a proposal never
booked twice, a settled reservation settled once, bad amounts refused before the limit, and the
tenants apart, and no way for the agent alone past the limit. It found, as
[decision 141](decisions.md):

- **The application's own role could make room on a full day** (measured): written down, with why,
  and the comments that claimed otherwise corrected.
- **A reservation settled when its proposal's last move was not written** (measured): now only when
  the history holds the move.
- **The race through the door could not fail** (measured): now 195,000.00 is booked first, and the
  fifty race for room for one; broken on a real server, three were made. Since decision 157 the fifty
  take turns at the log, and the same break made one, three runs of three: only the store's test of
  fifty reservations sees it now.
- **`reserve()` took any currency, and a settled reservation was "already"**: both fixed, and the
  stage's currency refusal and an answered `TRANSACTION_FAILED` tested.

Broken on purpose: the settle break first failed 8 where 3 were predicted, because it changed two
things; measured again with one change, 3. The README's three breaks were measured twice on the
final code, agreeing: 1, 8 and 6 failing.
