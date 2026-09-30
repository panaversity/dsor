# Implementation status

**This document is the only authority on what is implemented.** The README is the
idea; the specification is the contract; this page is the facts. Last updated:
2026-10-01.

## Specification

**v1.4.0**, draft for review. 268 requirements: 89 at L1, 118 at L2, 25 at L3, 22 in
the reference profile, 14 for the surrounding stack. v1.4.0 adds DSOR-CTX-07 and
DSOR-CTX-08 and splits the reference context store into Graphiti (memory) and
OpenViking (skills and resources). No L1, L2, L3, or RP requirement and no schema
differs from v1.3.

Neither Graphiti nor OpenViking is integrated, installed, or tested in this
repository. The bindings in §40 are a design, checked against both projects'
public documentation on 2026-09-19 and not against running software.

## Packages

| Package | State |
| --- | --- |
| `@panaversity/dsor-spec` | Working, unpublished. 13 artifact schemas plus shared definitions, one validated example each, the generated requirement registry, loaders, and an exact-decimal money reference used by the tests |
| `@panaversity/dsor` | **Not started.** Exports one constant. There is no pipeline, no connector, no store, no server |

## What the tests prove today

- Every example validates against its schema; 16 deliberately broken documents are
  rejected (`packages/spec/src/schemas.test.ts`).
- The `high-value-payment` control passes its own test vectors in a CEL evaluator,
  including a foreign currency and an unconvertible one; the naive condition is shown
  to let 50,000,000 PKR through (`packages/spec/src/control-cel.test.ts`).
- The `payment.execute` preconditions refuse a second payment of an invoice while the
  first is in flight.

These are checks of the specification's own examples. They are not an implementation
of any requirement. `pnpm coverage:req` counts test titles, and most of the ids it
reports today are named by these example checks.

## Baby steps

The [baby steps](baby_steps_tutorials/readme.md) are teaching code: small, separate
projects that build DSoR's ideas one at a time. They are not the reference
implementation, and their tests do not count toward `pnpm coverage:req`. CI runs
`pnpm check` inside every step, and `pnpm guard` checks each step's rule ids, the
schema patterns it copies, and [`rules-met.md`](baby_steps_tutorials/rules-met.md).

| Step | State |
| --- | --- |
| 00 · foundation | Built. Tools only; no rule |
| 01 · one invoice in memory | Planned. A learner build, `mj_01_one_invoice_in_memory`, tests DSOR-MON-01; it is not the official step |
| 02 · canonical URIs | Planned. A learner build, `mj_02_canonical_uris`, tests DSOR-RID-01a, and DSOR-RID-01b for the tenant part only; it is not the official step |
| 03 · operations and contracts | Planned. A learner build, `mj_03_operations_and_contracts`, tests DSOR-OPR-01, DSOR-OPR-02a, and DSOR-OPR-02b; it is not the official step |
| 04 · result and error envelopes | Planned. A learner build, `mj_04_result_and_error_envelopes`, tests DSOR-ERR-01a, DSOR-COR-01b, and DSOR-SCH-01 for error envelopes only; it is not the official step |
| 05 · who is calling | Planned. A learner build, `mj_05_who_is_calling`, tests DSOR-IDN-01, DSOR-SRC-02a for who is calling only, and DSOR-SRC-02b for a principal only; it is not the official step |
| 06 · permissions, denied by default | Planned. A learner build, `mj_06_permissions_deny_by_default`, tests DSOR-AUT-01a and DSOR-AUT-01b; it is not the official step |
| 07 · the pipeline skeleton | Planned. A learner build, `mj_07_the_pipeline_skeleton`, tests DSOR-EXE-01a for lines ①, ⑤, ⑥, and ⑨, and DSOR-OPR-04a for its one interface, `call`; it is not the official step |
| 08 · write the decision first | Planned. A learner build, `mj_08_write_the_decision_first`, tests DSOR-EXE-02 before the response only (its log is in memory, so not durable), and DSOR-EXE-03b, an L2 rule, for the caller's half only; it is not the official step |
| 09 · Postgres on Neon | Planned. A learner build, `mj_09_postgres_on_neon`, tests DSOR-AUD-04a (an L2 rule) and DSOR-AUD-02a against a real PostgreSQL on a Neon branch, with `pnpm test:db`, which CI does not run. It makes step 08's DSOR-EXE-02 durable. Of learning-path stage 1's four "done when" checks it meets three; a query's answer still has no schema (open question 19). It is not the official step |
| 10 · tenants | Planned. A learner build, `mj_10_tenants`, tests DSOR-TEN-01a, DSOR-IDN-03a, DSOR-IDN-03b (reading only), DSOR-SRC-02b (the tenant half), and DSOR-ERR-01b, with a second company, `org_789`, on a Neon branch. It is DSoR's own lock on companies only: the database's lock, DSOR-TEN-01b, is step 11. Its tenant filter in SQL is guarded by `pnpm test:db` alone, which CI does not run. It is not the official step |
| 11 · row-level security | Planned. A learner build, `mj_11_row_level_security`, tests DSOR-TEN-01b, DSOR-RP-01a, DSOR-RP-01b, DSOR-RP-01c, DSOR-RP-01d, and DSOR-TEN-02a for the audit table only, with PostgreSQL's row-level security on a Neon branch, through `pnpm test:db`, which CI does not run. The database's lock stops a query that forgets the company or a company left on a connection, not a program that holds `dsor_runtime`'s login and sets any company. It is not the official step |
| 12 · the cross-tenant test suite | Planned. A learner build, `mj_12_cross_tenant_test_suite`, tests DSOR-TEN-02b: one generated suite attacks every operation in the registry from `org_456` and from `org_789`, and runs in `pnpm check`, so CI runs it on every push. It proves step 10's one URI check for every operation, and each operation's own code only as far as a same-company call's answer shows it. It does not attack the database's lock: no foreign company reaches a read. It is not the official step |
| 13 · bounded queries | Planned. A learner build, `mj_13_bounded_queries`, tests DSOR-QRY-01: `invoice.list` gives at most 10 rows whatever the caller asks, says `capped` when it cuts the limit, and gives a cursor for the next page. Every query's result is capped at 64 KiB, measured after line ⑨. Both numbers are the tutorial's, written in code, because the contract has no field for them (open questions 43 and 45). Step 12's suite checks a list by its rows, since a list takes no URI (open question 42). Nothing limits how many pages a caller reads: that is DSOR-CLS-04b, an L2 rule no step builds yet. The list's SQL is guarded by `pnpm test:db`, which CI does not run. It is not the official step |
| 14 to 51 | Planned |

## Learning-path stages

| Stage | State |
| --- | --- |
| 1 — A gatekeeper for one entity (L1) | Not started |
| 2 — Many companies, sensitive data (L1) | Not started |
| 3 — An agent that acts alone (L2) | Not started |
| 4 — Rules and approvals (L2) | Not started |
| 5 — Actions that cannot be undone (L3) | Not started |

## Known gaps in the specification

Tracked in [`research/open-questions.md`](../research/open-questions.md). The most
important: the §44 ceilings are proposals that no deployment has measured, and no
fault-injection case in §47 has been run, because nothing is built yet.
