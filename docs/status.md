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

The reference implementation is still empty. Working code does exist elsewhere in this
repository, in the teaching tutorial below, and it is **not** the reference
implementation and does not make `@panaversity/dsor` any more built.

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

## The baby-steps tutorial

[`docs/baby_steps_tutorials/`](baby_steps_tutorials/) holds a teaching sequence of 52
planned steps. Each step is a complete, self-contained project: a copy of the step
before it plus **one** new idea. Steps named `my_NN_*` are a learner's own copies,
built in the open with their reasoning recorded in
[`my_notes/`](baby_steps_tutorials/my_notes/README.md).

Eight of the 52 are built. Test counts are cumulative, because each step inherits the
one before it:

| Step | Tests | The one new idea |
| --- | --- | --- |
| `00_foundation` | 4 | the toolchain, one pure function |
| `my_01_one_invoice_in_memory` | 19 | an entity, frozen, in an array |
| `my_02_canonical_uris` | 36 | every record has one permanent address |
| `my_03_operations_and_contracts` | 71 | a caller names an operation; every operation has a contract |
| `my_04_result_and_error_envelopes` | 104 | every answer has the same outer shape, with a retry class |
| `my_05_who_is_calling` | 132 | who you are comes from the login, never from the arguments |
| `my_06_permissions_deny_by_default` | 156 | deny by default, and "may you" is asked before "does it exist" |
| `my_07_the_pipeline_skeleton` | 179 | the order of the checks becomes a list a test can read |
| `my_08_write_the_decision_first` | 232 | every decision is recorded before the answer, refusals included, in a hash chain |

**What this is not.** Read these as worked examples, not as conformance. Three things
are true of all of them:

- **The tutorial's tests are not run by this repository's CI.** The root
  `vitest.config.ts` collects `packages/*/src/**/*.test.ts` only. `oxlint` and `oxfmt`
  do cover the tutorial, so style is checked and behaviour is not. Each step is
  verified by `pnpm --dir docs/baby_steps_tutorials/<step> check`, by hand. Every step
  now also has a `test/main.test.ts` that runs its demo program as a subprocess, so the
  output each README pastes as proof is checked rather than asserted.
- **Nothing is durable, and nothing is authenticated.** There is no database until
  step 09 and no real login until steps 43 and 44. The invoice store and the audit log
  are arrays in one process, so a restart loses both.
- **A requirement id in a step's test title is a claim about that step, not about
  DSoR.** Step 08's 232 tests name 23 ids in their titles, and each step's README has a
  table saying which halves of which rules it does *not* meet. No L1, L2 or L3
  requirement should be read as implemented on the strength of the tutorial.

The tutorial is also where most of what has been *learned* is written down:
[`my_notes/decisions.md`](baby_steps_tutorials/my_notes/decisions.md) holds 66 dated
decisions and [`my_notes/lessons.md`](baby_steps_tutorials/my_notes/lessons.md) holds
18 lessons, several of them about tests that passed while proving nothing.

## Learning-path stages

The five stages of [`docs/learn/learning-path.md`](learn/learning-path.md) describe the
**reference implementation** in `packages/dsor`. None has been started. The tutorial
above is a separate, parallel path through the same material and does not advance them.

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
fault-injection case in §47 has been run against an implementation.

Two things the tutorial has turned up that belong here rather than in a step's notes:

- The audit record schema requires `identity.mode`, so the *first* step that writes a
  record has to name an identity mode — before delegation exists to make
  `on_behalf_of` meaningful. Step 08 writes `direct` with an empty `actor_chain`. Worth
  checking whether §29 should say what a pre-delegation deployment records.
- `DSOR-EXE-03b`'s sentence covers "the decision **or** intent record", so it is two
  behaviours joined by an `or` and they become buildable many steps apart. It is the
  one place in the spec where a single id could not be met in one piece of work.
- `common.schema.json`'s `correlation.request_id` is a bare `{"type": "string"}` with no
  `minLength`, so an envelope carrying `request_id: ""` validates. `DSOR-COR-01b` says
  DSoR MUST generate a `request_id` when the caller supplies none, and a blank string
  is none — but the schema cannot enforce that half, so every implementation has to
  decide for itself that blank means absent. Found in the tutorial on 2026-10-01: a
  caller passing `""` obtained a `COMMITTED` receipt for a state change with no usable
  correlation id, and the envelope was schema-valid. A `minLength: 1` on that `$def`
  would close it for everyone. The same argument applies to `record_id`, `chain` and
  `result` on `audit-record.schema.json`, which are also bare strings.
