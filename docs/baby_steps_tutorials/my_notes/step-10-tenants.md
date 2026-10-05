# Step 10 · Tenants

Folder: [`my_10_tenants`](../my_10_tenants/README.md) · 376 tests, plus 9 in the database tier
Spec: [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) · `DSOR-TEN-01a`, `DSOR-IDN-03a`,
`DSOR-SRC-02b`
Both tiers have run: 373 under `pnpm check`, and 9 under `pnpm test:db` against a real server —
the step's own database, `dsor_step10`, four migrations applied, the demo verifying both chains
there too:

```text
pnpm migrate   ->  applied 001_audit.sql … 004_running_example.sql
pnpm test:db   ->  Tests  9 passed (9)
pnpm start     ->  the PostgreSQL at …@localhost:55432/dsor_step10
                   COMMITTED; org_456: 15 records, org_789: 2, both chains verifying
```
Decisions [88 to 92](decisions.md). Lesson [35](lessons.md).

## What the step is

A second company shares the program and the database. Four things become true: every row carries
its company; every request resolves to exactly one company from who is logged in; an address for
another company is refused with words that reveal nothing; each company has its own audit chain.

## How it was built

Explain, ask, build — the order is the rule. The problem was shown from step 09's running program
before a line changed: `getInvoice("INV-1008")` with no company, and a refusal that said "this
program serves org_456". Four decisions were put one at a time in plain words and the learner took
all four recommendations ([decision 88](decisions.md)). A fifth came up in piece 4 and was asked the
same way ([decision 90](decisions.md)).

Then five pieces, each red first, each committed, each broken on purpose:

1. **Resolve the tenant** — §21 step 2, a stage of its own, required by name. The agent gains its
   second company, so "exactly one" has something to bite on.
2. **The address against the request's company**, with a refusal that echoes the address and nothing
   else.
3. **The invoices as rows**, keyed `(tenant_id, id)`, `UPDATE` on `status` alone, the amount cast to
   text so PGlite cannot hand back a number, the database handle shared through `store.ts`.
4. **One audit chain per company**, and a refusal with no company written to every company the
   caller belongs to.
5. **The demo**, run twice for real output: the same number as two invoices, four refusals, two
   chains, and `CONFLICT` on the second run because the invoices are durable now.

## What the build found

**Piece 4 caught piece 2.** The address check lived in the handler, at §21.14 — after the decision is
recorded at §21.11 — so a request refused for another company's address sat in the log as `ALLOWED`.
The test "a mismatching address, once the request has a company, is recorded there" said `expected
'ALLOWED' to be 'TENANT_MISMATCH'`. The check moved to §21.6, for every own top-level string argument that is a `dsor://`
address (nested values are not walked); the handler keeps a re-check that answers `INTERNAL_ERROR`, and a test builds the
only door that can reach it. [Decision 91](decisions.md), [lesson 35](lessons.md).

**Two sabotages were not counts.** Leaving the stage out of the list is refused at *load* by
`assertPipeline`, by name, before any test runs — a shrinking total. Making the key the number alone
is refused at *seed*: the running example holds an `INV-1008` per company and its `ON CONFLICT`
names a key that no longer exists — 174 skipped. Both written up as what they are
([decision 89](decisions.md)).

**A word no test can kill.** `tenant_id TEXT NOT NULL` — the primary key already forbids NULL. It
stays, with a comment saying why.

## Limits, stated

- One lock. The program filters; PostgreSQL does not. Step 11.
- `cross-tenant.test.ts` covers `invoice.get` by hand. The suite that grows with every operation is
  step 12.
- A role is really per company. Nobody here has different roles in different companies, so `role`
  stayed beside `memberships` rather than inside them.
- The map's done-when says "the same not found"; the spec says `TENANT_MISMATCH`. The spec won and
  the README says so.

## Does it run by itself? (2026-10-05)

Copied outside the repository with no `node_modules`, no `.env`, no `.local-database`:

```text
pnpm install --frozen-lockfile   ->  Done in 299ms
pnpm check                       ->  Tests  372 passed | 1 skipped (373)
pnpm start                       ->  COMMITTED; org_456: 15 records, org_789: 2, both verifying
pnpm start (again)               ->  CONFLICT;  org_456: 30 records, org_789: 4, both verifying
pnpm test:db (no server)         ->  Tests  9 skipped (9)
```

The one skip is the schema-equality test that needs the specification beside it, as in step 09.

The first version of this section recorded "30 then 45 records" — a symptom, not the story: the
demo tests left a run behind in `.local-database`, so the clean copy's first `pnpm start` was really
its second. A critic measured it; [decision 92](decisions.md).

## The hostile review

Four reviewers and a critic, after the README was written. Six code fixes and a dozen smaller ones,
every one measured first and sabotaged after — [decision 92](decisions.md). The one that changes an
earlier step's lesson: a principal or tenant planted in the arguments that disagrees with the
security context is **refused** now, where step 05 ignored it, because `DSOR-SRC-02b` says so.
