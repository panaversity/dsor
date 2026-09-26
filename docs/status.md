# Implementation status

**This document is the only authority on what is implemented.** The README is the
idea; the specification is the contract; this page is the facts. Last updated:
2026-09-25.

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
| 07 to 51 | Planned |

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
