# Step 12 · Cross-tenant test suite

Folder: [`my_12_cross_tenant_test_suite`](../my_12_cross_tenant_test_suite/README.md) · 444 tests,
plus 30 in the database tier
Spec: [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) · `DSOR-TEN-02b`, `DSOR-ERR-01b`
Both tiers have run: 444 under `pnpm check`, and 30 under `pnpm test:db` against Neon, the step's
own database `dsor_step12`, five migrations applied. Decisions [99 to 101](decisions.md).

## What the step is

One generated test that calls every operation in the registry with another company's address and
asks six questions of each: refused with `TENANT_MISMATCH`; the same refusal, whole, for a company
that exists and one that does not, and nothing about yours; the other company holds every invoice
number the example names, in the same state for a command; its rows untouched afterwards; exactly
one record for the request in the caller's log, the `DENY`, and nothing in the other company's; and
the example itself works for its own company. The questions are plain functions, and a test lies
to each one. Each contract carries one example
request under `extensions["com.panaversity.tutorial"]`, which is how the suite can call an
operation nobody has written yet. An operation without an example fails the suite by name.

## How it was built

The problem first, measured on a copy of step 11: a third operation with the address nested inside
an argument and the store asked for the address's company — step 11's hand-written suite stayed at
`12 passed` and `user_123` of org_456 was handed org_789's invoice. Two decisions, one at a time
([decision 99](decisions.md)): the example request lives in the contract; the suite runs on PGlite
and in the database tier, with the map's Neon branch recorded as a divergence.

Three pieces, each red first, committed, broken on purpose:

1. **The example request** in each contract, and `exampleRequestOf` reading that one key.
2. **The suite**, as a function in `test/support/`, run by a PGlite file and a database-tier file.
3. **The demo**, walking the registry the same way, its lines pinned from the start.

## What the build found

**A hollow pass.** The first careless-command sabotage left org_789's rows untouched — not because
the command was careful, but because org_789 had no `INV-1009` to touch. The suite now asks, before
the untouched-rows question, that the other company holds every invoice number the example names,
and the seed gives it one. The sabotage then failed four questions instead of three.

**The seed change moved one older test.** With `INV-1009` in both companies, step 10's "an invoice
the other company has is not found in yours" had no number to ask for; org_789 gained `INV-2001`,
which org_456 lacks, and the test asks for that. The step's databases on Neon and locally were
recreated twice, because a migration's checksum covers every byte (lesson 40).

**The demo's counts moved by two**, since the two generated refusals are decisions and land in
org_456's log: 17 records on a fresh run, 34 on the second. Every pin in `main.test.ts` says so.

## Limits, stated

- The move rewrites `dsor://org_456/…` strings found anywhere in the example and nothing else. A
  request that names a company some other way is called unchanged, and only question 6 notices.
- The caller is `user_123` of org_456 throughout. The agent who belongs to both companies, the
  nested-argument limit and the forgetful-validate door stay in step 10's hand-written file.
- A third company in `tenant.ts` is a seed change and nothing else here; the suite tests the
  operations and tenants that exist.
- The map's "fresh Neon branch" is not built. Decision 99.

## The hostile review

Four reviewers, a mutation pass and a critic, while the step was still being written. The
done-when held for a careless author and fell to a hostile one: a refusal-shaped envelope carrying
the other company's row with a cosmetic `DENY` appended passed every question. And a mutation pass
deleted the suite's assertions one at a time without a single failure, because nothing tested the
suite. Both are closed — whole-envelope comparison, exactly one record per request, the questions
as functions with a test that lies to each — and [decision 101](decisions.md) has the rest.
428 became 444, and the critic's two findings — a success answer carrying the other company's
row, and `org_000` free to become real — are closed the same way.
