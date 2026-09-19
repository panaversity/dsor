# Implementation status

**This document is the only authority on what is implemented.** The README is the
idea; the specification is the contract; this page is the facts. Last updated:
2026-09-19.

## Specification

**v1.3.1**, draft for review. 266 requirements: 89 at L1, 118 at L2, 25 at L3, 22 in
the reference profile, 12 for the surrounding stack. v1.3.1 is an editorial revision
of v1.3 for students and junior developers; no requirement text differs from v1.3.

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
