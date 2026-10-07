# Step 11 · Row-level security

Folder: [`my_11_row_level_security`](../my_11_row_level_security/README.md) · 400 tests, plus 13 in
the database tier
Spec: [§36](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) · `DSOR-TEN-01b`,
`DSOR-RP-01a`, `DSOR-RP-01b`, `DSOR-RP-01c`, `DSOR-RP-01d`
Both tiers have run: 400 under `pnpm check`, and 13 under `pnpm test:db` against a real server —
the step's own database, `dsor_step11`, five migrations applied. Decisions [94 to 96](decisions.md).
Lessons [36 to 38](lessons.md).

## What the step is

A second lock. Step 10 kept the companies apart with a `WHERE` in every query, held by the program
alone. Now PostgreSQL itself hides every other company's rows, on the invoices and on the audit
log, so a query that forgets the company gets one company or nothing. The program says the company
per statement, inside that statement's own transaction, and refuses to start as an account the
lock does not apply to.

## How it was built

The problem first, measured on step 10's database as `dsor_runtime`: a query with no company
returned both companies' `INV-1008`. Three decisions, one at a time ([decision 94](decisions.md)):
both tables; the company said before each statement; a demo that runs the forgotten query.

Then five pieces, each red first, each committed, each broken on purpose:

1. **The stores say the company.** `theDatabase(tenant)` requires it; the connection runs each
   statement with a company inside a transaction that first calls `set_config(…, true)`. Two
   adapters, PGlite and `pg` pool. No store SQL changed.
2. **The lock**, migration 005: `ENABLE`, `FORCE`, one policy per table with `USING` and
   `WITH CHECK`. The test support drops to `dsor_runtime`, with `asTheOwner` for the two seams.
3. **The start-up check** asks questions no privilege check answers: `BYPASSRLS`, membership of a
   role that holds it, ownership of a tenant table or membership of its owner, whether the lock is
   on at all — and, after the review, whether it is exactly the one policy the migration wrote,
   whether a helper's owner skips the lock, and whether the application may read anything beside
   the two tenant tables.
4. **The pool trap**, in the database tier: the leak demonstrated on a real pooled connection, then
   the adapter shown not to do it.
5. **The demo and the README.**

## What the build found

**Sixteen tests went red when the lock arrived**, and every one was raw SQL as the application that
never said whose rows it wanted — the lock answering a test the way it answers a forgotten `WHERE`.
Each now says the company, or runs as the owner.

**The blind spot, measured.** With a store that forgets the company: tests as the application,
well over a hundred fail; tests as PGlite's superuser, a few dozen — and not one of them is a
store's own test. The README carries the counts, measured twice on the final suite.
A superuser skips every policy, so the test support had to drop to `dsor_runtime` the way the
program's door does. Step 09's lesson again, one layer down: it is not enough for the program to
connect as the application; the tests must too.

**A probe corrected a test.** The Neon test first expected a member of `neon_superuser` to see
both companies. Measured: the member is still filtered, because `BYPASSRLS` is a role attribute and
PostgreSQL passes privileges through membership, never attributes. It is one `SET ROLE` away from
not being — step 09's `editor` hole again — and the check refuses the membership by name. The map's
"which ignores row-level security altogether" is true of the role and not of its member; recorded
as a divergence, the map left as written.

**A lock with no policy fails closed.** Removing the audit policy failed 132 tests, not one: a
table with row-level security on and no policy shows nothing and accepts nothing, so every decision
record was refused and every request with it.

**One count moved between runs.** Break 8 measured 6 failures once and 3 twice; the README carries
3, the number two clean runs agree on, and the first run is noted here as the kind of thing a
single measurement cannot tell from a fact.

## Limits, stated

- The owner is a superuser on every route here — PGlite's `postgres`, the local server's
  `dsor_owner`, Neon's `neondb_owner` through `neon_superuser` — and skips the policies whatever
  the table says. `FORCE` is proven with an owner that is not.
- The superuser half of `DSOR-RP-01a` is step 09's privilege check; the new check does not look at
  `rolsuper`, and says so.
- §36 also sets `dsor.principal_id`; nothing reads it, so it is not set.
- One policy per table, for every role. A policy restricted `TO dsor_runtime` would be tighter for
  a future second application account, and is a step of its own.

## The hostile review

One reviewer with PGlite probes, after the README was written. Three windows past the lock that
the first start-up check could not see — a second wide-open policy, a `SECURITY DEFINER` helper
owned by a `BYPASSRLS` role, a view the owner made — each measured as both companies coming back
while the check said the lock was on; and the migration's comment claiming the audit policy bound
the chain, which it did not. All four are closed with a test each, and the check's questions are
now seven. [Decision 96](decisions.md) has the list, including the one finding left as it was and
why. 394 became 400.
