# Implementation status

**This document is the only authority on what is implemented.** The README is the
idea; the specification is the contract; this page is the facts. Last updated:
2026-10-09.

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

## Baby steps

The [baby steps](baby_steps_tutorials/readme.md) are teaching code: small, separate
projects that build DSoR's ideas one at a time. They are not the reference
implementation, and their tests do not count toward `pnpm coverage:req`. CI runs
`pnpm check` inside every step, and `pnpm guard` checks each step's rule ids, the
schema patterns it copies, and [`rules-met.md`](baby_steps_tutorials/rules-met.md).

The table lists the `mj_` learner builds. Steps 01 to 15 also have a second learner's
builds, `my_01` to `my_15`, described in the next section.

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
| 09 · Postgres on Neon | Planned. A learner build, `mj_09_postgres_on_neon`, tests DSOR-AUD-04a (an L2 rule) and DSOR-AUD-02a against a real PostgreSQL on a Neon branch, with `pnpm test:db`, which CI does not run. It makes step 08's DSOR-EXE-02 durable. Of learning-path stage 1's four "done when" checks it meets three; a query's answer still has no schema (open question 19). Since step 16's review (2026-10-03), the log refuses a write that the database took but kept no row of, and the start-up check reads PostgreSQL's own names whatever the search path says, from step 09 to step 16. It is not the official step |
| 10 · tenants | Planned. A learner build, `mj_10_tenants`, tests DSOR-TEN-01a, DSOR-IDN-03a, DSOR-IDN-03b (reading only), DSOR-SRC-02b (the tenant half), and DSOR-ERR-01b, with a second company, `org_789`, on a Neon branch. It is DSoR's own lock on companies only: the database's lock, DSOR-TEN-01b, is step 11. Its tenant filter in SQL is guarded by `pnpm test:db` alone, which CI does not run. Since the Stage 2 review (2026-10-01), an operation's code reads through a store bound to the active company, an answer holding another company's row is refused, and a company id has at most 18 digits. It is not the official step |
| 11 · row-level security | Planned. A learner build, `mj_11_row_level_security`, tests DSOR-TEN-01b, DSOR-RP-01a, DSOR-RP-01b, DSOR-RP-01c, DSOR-RP-01d, and DSOR-TEN-02a for the audit table only, with PostgreSQL's row-level security on a Neon branch, through `pnpm test:db`, which CI does not run. The database's lock stops a query that forgets the company or a company left on a connection, not a program that holds `dsor_runtime`'s login and sets any company. Since the Stage 2 review (2026-10-01), a transaction counts only when its `COMMIT` really committed, and the guard for tenant tables covers every schema, view, and function. It is not the official step |
| 12 · the cross-tenant test suite | Planned. A learner build, `mj_12_cross_tenant_test_suite`, tests DSOR-TEN-02b: one generated suite attacks every operation in the registry from `org_456` and from `org_789`, and runs in `pnpm check`, so CI runs it on every push. It proves step 10's one URI check for every operation, and each operation's own code only as far as a same-company call's answer shows it. It does not attack the database's lock: no foreign company reaches a read. Since the Stage 2 review (2026-10-01), the suite searches every answer for values only the other company holds, and proves its own judge through fake DSoRs. It is not the official step |
| 13 · bounded queries | Planned. A learner build, `mj_13_bounded_queries`, tests DSOR-QRY-01: `invoice.list` gives at most 10 rows whatever the caller asks, says `capped` when it cuts the limit, and gives a cursor for the next page. Every query's result is capped at 64 KiB, measured after line ⑨. Both numbers are the tutorial's, written in code, because the contract has no field for them (open questions 43 and 45). Step 12's suite checks a list by its rows, since a list takes no URI (open question 42). Nothing limits how many pages a caller reads: that is DSOR-CLS-04b, an L2 rule no step builds yet. The list's SQL is guarded by `pnpm test:db`, which CI does not run. Since the Stage 2 review (2026-10-01), the suite walks every page of a list, and the list's code reads through the bound company store. It is not the official step |
| 14 · classification and masking | Planned. A learner build, `mj_14_classification_and_masking`, tests DSOR-CLS-01, DSOR-CLS-02a (the clearance half), DSOR-CLS-02b, DSOR-CLS-03, and DSOR-CLS-05 (without the actor chain, which waits for step 18). Every field has a label in `classifications.json`, a field with no label is `confidential`, and both agents have the clearance `internal`. Right after line ⑨, an agent's answer leaves out every field above its clearance and lists them, every successful answer carries its label (a refusal carries none yet: open question 46), and a refusal from an operation's code is masked too. Every read that returns data is recorded with the URIs it returned and how many, by migration `007`. People are not masked. Not built: the tenant's egress policy, tokens (DSOR-CLS-02c), and row budgets (DSOR-CLS-04b). A label is not checked against the value its field holds (open question 50). The record of a read is guarded by `pnpm test:db`, which CI does not run. Since the Stage 2 review (2026-10-01), labels apply at every depth, and a clearance that is not one of the four labels reads as `public`. It is not the official step |
| 15 · freshness labels | Planned. A learner build, `mj_15_freshness_labels`, tests DSOR-FRS-01a (without a resource version, which waits for step 21) and DSOR-FRS-01b (against a cache planted in the tests: DSoR has none). Every successful query answer states its mode, `observed_at`, and connector; the label comes from the store through the bound store, the operation's code never writes it, and several reads give the stalest. The record of a read keeps the label. It runs on a fresh Neon branch made from `main`. Learning-path stage 2 is complete. It is not the official step |
| 16 · the control-plane store | Planned. A learner build, `mj_16_the_control_plane_store`, gives DSoR's own store a map, `store.json`, and refuses to start on a database that does not match it. It names a table or other relation the map does not list, one privilege too many or too few, a column the database fills in that the map lets the program write, a rule, a trigger, a `SECURITY DEFINER` function the program may run, and a company table without forced row-level security. Its tests name DSOR-AUD-04a and DSOR-RP-01b, which steps 09 and 11 first proved. DSOR-MOD-01 is claimed for audit evidence only, carried by the tests of steps 09 and 10; no test is titled with it. It runs on a Neon branch made from `step-15`. It is not the official step |
| 17 · vendors and payments | Planned. A learner build, `mj_17_vendors_and_payments`, runs DSoR's first commands. `payment.create` drafts a payment for an issued invoice, for the open amount and to the vendor that DSoR reads itself. `payment.cancel` cancels a draft, and nothing else. Every command declares its execution semantics, and its answer states them from the contract (DSOR-EXE-05a, DSOR-EXE-05b, the answer in this tutorial's shape). Start-up refuses an undo list that names nothing DSoR can run (DSOR-EXE-05c, partly: the undo runs today's checklist). Line ③ refuses every command an agent calls, because no delegation exists until step 18 (DSOR-DEL-01a, partly). The draft commits before its record: a failed record leaves a draft behind until step 36, and the caller hears `INTERNAL_ERROR`, never that a retry is safe. Payments live in `app.payments`, migration 009, on a Neon branch made from `step-16`. Vendors as records of their own wait for a later step. It is not the official step |
| 18 · delegations | Planned. A learner build, `mj_18_delegations`, gives the agent a person's permission slip. Every call from an agent, a read too, runs only under a slip that DSoR finds in its own `dsor.delegations` (migration 010), for this agent in this company: active, allowing `unattended`, valid against the specification's schema, with no constraint and no parent, and signed by a person who works in the company (DSOR-DEL-01a, DSOR-DEL-07, and DSOR-IDN-03a for the subject). A torn-up slip gives `DELEGATION_REVOKED`, one past its date by the database's clock `DELEGATION_EXPIRED`, and the other cases `DELEGATION_REQUIRED`, `AUTHORIZATION_DENIED`, or, for a slip that breaks the schema, `INTERNAL_ERROR`. At line ⑤ the agent may use only what its slip lists and its signer's roles grant, from DSoR's role table as loaded at start-up (DSOR-DEL-02, partly: tokens carry no scopes, and a slip with a constraint is refused). The subject is the slip's signer, never the request's (DSOR-DEL-08), and an agent's record names its slip and its person (migration 011). A slip named in the arguments must be the one found (DSOR-SRC-02b). Agents hold no role: `ap_agent` is gone, and start-up refuses an agent with a role, or two logins with one name. One slip per agent and company, by a unique key: DSOR-DEL-09 is not built. Slips are written only by migration. The agent's draft is saved before its record, as user_123's is, until step 36. It runs on a Neon branch made from `step-17`. It is not the official step |
| 19 · unattended mode and the role source | Planned. A learner build, `mj_19_unattended_mode_and_the_role_source`, gives each company a role source: a setting in `role-sources.json`, checked at start-up against the tenant-policy schema and §44's 24 hours (DSOR-IDN-05; DSOR-BND-02, partly), and a fake directory inside the program, not a network service. At every call from an agent, line ③ checks that DSoR's own table knows the signer as a person, then asks the slip's company's directory about her, last, waiting at most 2 seconds. With no answer, a kept answer counts only while it is under the company's bound; otherwise line ③ refuses with `FRESHNESS_UNSATISFIABLE`, a code this tutorial chose, for reads too (DSOR-IDN-06, partly). Kept answers are per company and person (DSOR-TEN-02a, for them), older news never replaces newer, and an answer DSoR cannot use is `INTERNAL_ERROR` and drops the kept answer. Line ⑤ uses the directory's roles, so a job change reaches the agent at its next call with no restart (DSOR-DEL-02; DSOR-IDN-04b, partly). An agent's record names the source and the time of its signer's authority (DSOR-DEL-10, partly). A suspended or deprovisioned signer's agent is refused, but the slip stays active: DSOR-IDN-07 waits for a step of its own, 19b. It adds no table, and runs on a Neon branch made from `step-18`. It is not the official step |
| 20 to 51 | Planned |

## The baby-steps tutorial

[`docs/baby_steps_tutorials/`](baby_steps_tutorials/) holds a teaching sequence of 52
planned steps. Each step is a complete, self-contained project: a copy of the step
before it plus **one** new idea. Steps named `my_NN_*` are a learner's own copies,
built in the open with their reasoning recorded in
[`my_notes/`](baby_steps_tutorials/my_notes/README.md). Steps named `mj_NN_*` are a second
learner's copies, listed step by step in the table above, with notes in
[`mj_notes.md`](baby_steps_tutorials/mj_notes.md).

In the `my_` track, sixteen of the 52 are built. Test counts are cumulative, because each step inherits the
one before it:

| Step | Tests | The one new idea |
| --- | --- | --- |
| `00_foundation` | 4 | the toolchain, one pure function |
| `my_01_one_invoice_in_memory` | 19 | an entity, frozen, in an array |
| `my_02_canonical_uris` | 36 | every record has one permanent address |
| `my_03_operations_and_contracts` | 72 | a caller names an operation; every operation has a contract |
| `my_04_result_and_error_envelopes` | 104 | every answer has the same outer shape, with a retry class |
| `my_05_who_is_calling` | 133 | who you are comes from the login, never from the arguments |
| `my_06_permissions_deny_by_default` | 157 | deny by default, and "may you" is asked before "does it exist" |
| `my_07_the_pipeline_skeleton` | 181 | the order of the checks becomes a list a test can read |
| `my_08_write_the_decision_first` | 234 | every decision is recorded before the answer, refusals included, in a hash chain |
| `my_09_postgres_on_neon` | 327 | the audit log moves into PostgreSQL, and the application — the account the program actually connects as — may not rewrite it |
| `my_10_tenants` | 376 | a second company shares the program and the database: every row carries its company, every request is inside exactly one, another company's address is refused without revealing anything |
| `my_11_row_level_security` | 412 | the second lock: PostgreSQL itself hides every other company's rows, told the company per statement inside its own transaction, and the program refuses to start as an account the lock does not apply to |
| `my_12_cross_tenant_test_suite` | 444 | one generated test that calls every operation in the registry with another company's address, from an example request each contract carries, and fails by name for an operation it cannot call |
| `my_13_bounded_queries` | 468 | invoice.list, with the size of the answer the server's: a maximum page size and result size on every query, a cursor that is an address, and a door that refuses an oversize answer whatever handler produced it |
| `my_14_classification_and_masking` | 512 | every field labelled, the agent cleared for internal, a field above it left out of the answer and listed before the answer leaves, every answer labelled, and a read that handed out confidential data written down with its rows and their count |
| `my_15_freshness_labels` | 524 | every answer says how old its data is, when it was read and from where, in a label the code that read writes; the door refuses a read with no label, and a `current` label stamped before the request began |

**What this is not.** Read these as worked examples, not as conformance. Three things
are true of all of them:

- **Each step's own `pnpm check` runs in CI, and its database tests do not.** The root
  `vitest.config.ts` collects `packages/*/src/**/*.test.ts` only, so a separate CI job,
  "Baby steps", runs `pnpm --dir docs/baby_steps_tutorials/<step> check` inside every
  step folder, on Ubuntu and Windows. A step's `pnpm test:db`, which needs a real
  PostgreSQL, is run by hand. Every `my_` step also has a `test/main.test.ts` that runs its
  demo program as a subprocess, so the output each README pastes as proof is checked
  rather than asserted.
- **Nothing is authenticated, and only the audit log is durable.** There is no real
  login until steps 43 and 44. From step 09 the audit log is in PostgreSQL and survives
  a restart; from step 10 the invoices are rows there too. Up to step 09 the invoice store is
  an array in one process.
- **Step 10 is one lock, not two.** The program filters by company; PostgreSQL does not yet.
  Its database tier (nine tests, the same as step 09's) has been run against a local
  PostgreSQL 17 with two real logins and a database of the step's own, on 2026-10-05; the
  four migrations applied and the demo ran against that server, both chains verifying.
- **`my_09` has a second test tier.** `pnpm check` proves its guarantees against
  PostgreSQL compiled to WebAssembly, in-process, so they hold on a fresh checkout.
  `pnpm test:db` covers what one in-process connection cannot do — logging in as a
  second user, two writers racing, and the program's own `openTheDatabase` pointed at a
  real server, owner and application both, and the program's own writer under real
  parallelism. Those nine have been run, against a local
  PostgreSQL 17 with two real logins, on 2026-10-04; without a server they report
  `9 skipped` rather than passing quietly.
- **A requirement id in a step's test title is a claim about that step, not about
  DSoR.** `my_08`'s 234 tests name 22 ids in their titles, and each step's README has a
  table saying which halves of which rules it does *not* meet. No L1, L2 or L3
  requirement should be read as implemented on the strength of the tutorial.

The tutorial is also where most of what has been *learned* is written down:
[`my_notes/decisions.md`](baby_steps_tutorials/my_notes/decisions.md) holds 122 dated
decisions and [`my_notes/lessons.md`](baby_steps_tutorials/my_notes/lessons.md) holds
41 lessons, several of them about tests that passed while proving nothing. The `mj_` track
keeps its own in [`mj_notes.md`](baby_steps_tutorials/mj_notes.md).

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
