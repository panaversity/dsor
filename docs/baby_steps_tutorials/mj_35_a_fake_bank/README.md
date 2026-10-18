# Step 34 · Connectors

**New in this step:** the company's records sit behind a *connector* that says honestly what its
system can do, and DSoR sends an operation only to a connector that can do what the operation needs
(DSOR-CNR-01a, DSOR-CNR-01b, DSOR-CNR-02).

## In plain words

Until now, DSoR read and wrote the company's records, its invoices, vendors, and payments, straight
from its own database, in the same code as its own records: slips, rules, proposals, and the log.
DSoR never asked what that database could do. It assumed.

A **connector** is DSoR's adapter for one outside system: a database, a bank, an accounting system
such as Xero. Every connector publishes a **declaration**: a short file that says what its system
can do. Can it undo a half-finished job (a *transaction*)? Can it tell a record's version? Will it
refuse a duplicate when it is given the same key twice? Can it be asked later whether a payment went
through? The specification gives the declaration a fixed shape, `connector.schema.json`.

Each operation needs some of those things. A command that must happen all or nothing needs
transactions. A command that runs only "if the invoice is still version 1" needs versions. DSoR
works out what each operation needs from the operation's own contract, its spec sheet since step
03. It compares the needs with the declarations, and it never sends an operation to a connector
that cannot do what the operation needs.

In this step there is one connector, `accounting`: the company's records, in the same database as
DSoR's own store. Nothing a caller sees changes. INV-1008 still waits for the CFO. What changes is
that DSoR now *knows* what it relies on, and checks it before any caller arrives. From step 35 on,
every new system, starting with a bank, is one more connector.

**A connector is not MCP.** MCP is how a call travels, the way an AI agent calls DSoR from the
outside (step 46). A connector is DSoR's own contract with one system behind it: it holds the keys,
and it states what the system guarantees. A connector could even use a bank's own MCP server to
reach the bank. The agent never reaches that server, only DSoR does (DSOR-CNR-04). Whether the
specification allows this is open question 145.

## Why it matters

**A guess about a system is a guess about money.** In step 35 a bank arrives. A bank cannot undo a
payment, and it may not answer whether one went through. Suppose DSoR sent `payment.execute` to it
anyway, assuming what a database can do. The bank stays silent, and DSoR has no way to find out
whether VENDOR-44 was paid 31,400.00 USD. The connector's declaration says this before any money
moves, and DSoR refuses to route there.

**One company's mistake must not stop another.** In a real deployment, each company plugs in its
own system: org_456 its database, org_789 perhaps its own Xero. Suppose org_789's declaration is
wrong, and DSoR refused to start because of it. Then org_456 could not pay INV-1008 either. So a
broken connector that serves only org_789 takes only org_789's calls out of service. Only a broken
*default* connector, which serves every company, stops DSoR from starting.

**A key must never reach the agent.** To reach a database or a bank, DSoR holds a password or a
token. §35 says a connector *publishes* its declaration, so the declaration is no place for a
secret. And a refusal goes back to the caller. If a key ever travelled in either, an agent tricked
by a cleverly worded invoice could use it, and go around DSoR. In this step nothing hands a
declaration to anyone yet. The rule is kept so that nothing has to be taken back when something
does.

**Common mistake:** a connector that says what its author hopes, such as `transactions: true` for a
bank. The declaration is a promise DSoR routes money on, so a capability that is not there is
written `false`, and the operation that needs it is not routed there.

## The design, before any code

### How this step was made

The learner asked to think about what works in production before deciding, then chose to build
first with those choices (2026-10-17). So every decision below is Claude Code's, for the learner to
review, and each says what it costs.

The circled numbers are lines of DSoR's checklist (§21). Line ④ checks whether the caller and the
operation may run at all now: the brake since step 25b, and in this step the connector. Line ⑦
claims the idempotency key. Line ⑨ reads the bound records.

### What each rule says

- **DSOR-CNR-01a:** "Every connector MUST publish a declaration that validates against
  `connector.schema.json`." ([§35](../../../specs/dsor/05-bindings.md#35-connector-contract))
- **DSOR-CNR-01b:** "An operation MUST NOT be routed to a connector that lacks a capability the
  contract requires, unless the contract defines fallback semantics."
- **DSOR-CNR-02:** "Connector credentials, refresh tokens, private keys, and database passwords MUST
  NOT be exposed to the model or the agent runtime."
- **DSOR-CNR-03a**, met by the schema: "Every connector MUST declare its `write_exclusivity`." It
  says whether DSoR is the only writer (`exclusive`) or others write too (`shared`).

### Decisions (Claude Code's)

- **D1. The company's records go behind the connector, and DSoR's own records stay.** Invoices,
  vendors, and payments are the company's: later they live in Xero or a bank. Slips, rules,
  proposals, approvals, and the log are DSoR's own store, which the specification keeps apart from
  every connector. The `accounting` connector still shares one database, and one transaction, with
  DSoR's own store. Its declaration says so, in this step's own flag
  `org.panaversity.steps.shares_dsor_transaction`. Step 33's promise depends on it: the claim, the
  payment, and the record commit together, or none of them does (DSOR-EXE-04a). *Downside:* one
  login for both, so the connector has no password of its own yet. A separate login would break
  that one transaction, and a payment and its record could then part. That waits for step 36's
  intent record, the note DSoR writes before an action it cannot take back. This step chose
  separate keys at first and dropped them when the build showed the cost (Think it through, F1).
- **D2. What an operation needs comes from its contract.** First, what the contract's own
  `connector_requirements` asks, where a key such as `downstream_idempotency_or_outcome_lookup`
  asks for either of two, as §7's example does. Then what follows from the contract's other lines:
  `atomic` execution needs `transactions`, `optimistic` concurrency needs `optimistic_concurrency`,
  a `current` precondition needs a connector that reads `current` state, and every command needs a
  connector that shares DSoR's transaction (D1). A requirement that names no capability stops
  start-up. *Downside:* the derived needs are this tutorial's reading, not the specification's
  words. A test pins the table, so a change shows in review.
- **D3. Which operations go to a connector.** Each operation with the company's code
  (`invoice.get`, `invoice.list`, `payment.create`, `payment.cancel`); the release,
  `proposal.execute`, which runs one; and the approval, `proposal.approve`, which reads the invoice
  and the vendor it binds. DSoR's other commands, such as `rule.draft`, `rate.load`, and
  `control.suspend`, work on DSoR's own store, and no connector serves them, so they still run while
  a company's connector is out: a person can still pull the brake. *Downside:* the approval is
  named by hand, in `READS_COMPANY_RECORDS`, and the first version of this step forgot it (Think it
  through, F2). A later DSoR command that reads the company's records must be added there.
- **D4. Start-up for the default, line ④ for one company.** The file `connectors.json` lists the
  connectors, and names the one that serves each company, with `"*"` for every company it does not
  name. Start-up checks every declaration against `connector.schema.json` and against the needs.
  A broken default connector stops start-up, because every company would be broken. A broken
  connector that serves named companies only puts those companies out of service, and start-up
  names it as a warning for the people who run DSoR. Line ④ then refuses those companies' calls
  with `CONNECTOR_UNAVAILABLE`, after the brake and before line ⑦ claims the key, so nothing is
  claimed and a retry with the same key is safe once the connector is fixed. That is the retry
  class §28 gives the code, `safe_same_key`. The caller hears fixed words, "org_789's connector is
  out of service", never why: the reason is the declaration's own text. *Downside:* one missing
  capability takes all of that company's operations on its records out of service, queries too,
  not only the one operation that needs it.
- **D5. Nothing in a declaration can carry a key.** An id and a region must be short lowercase
  names, a form of this tutorial's own, stricter than the schema's strings, so neither can hold a
  URL with a password in it. So must every entity and field that `field_fidelity` names. The
  extensions may hold only D1's flag, and the flag is `true` or `false`. `change_detection` may
  hold only its method and its lag. A refusal at start-up never repeats an unknown field's name,
  which may itself be a URL. The database password stays in `DSOR_DB_URL`, in `.env`, as since step
  09, and no answer, record, or bundle names it: a bug's own message never reaches the caller (step
  04, decision 8). *Downside:* a vendor's own extension field is refused until a step needs it.
- **D6. No fallback semantics.** DSOR-CNR-01b allows a contract to define what happens instead,
  but the specification gives no field for it. This step routes no operation to a connector that
  lacks a need, and records the question.

### The story's numbers

| Who | Asks | The connector | DSoR answers |
|---|---|---|---|
| the agent, org_456 | drafts INV-1008, 31,400.00 USD | `accounting`, can undo a job | `PENDING_APPROVAL`, for the CFO, as in step 33 |
| firm-ap-fte, org_789 | drafts INV-2002, 3,300.00 EUR | `accounting-789`, cannot undo a job | `CONNECTOR_UNAVAILABLE` at line ④; nothing claimed, no proposal |
| user_700, org_789 | reads INV-2002 | `accounting-789` | `CONNECTOR_UNAVAILABLE`, in fixed words; the record says DENY |
| cfo_100, org_456 | approves INV-1008, after a restart that took `accounting` out for org_456 | `accounting-456` | `CONNECTOR_UNAVAILABLE`; INV-1008 still `PENDING_APPROVAL` |
| DSoR, at start-up | the default connector cannot undo a job | `accounting`, for every company | refuses to start, naming `payment.cancel` and `proposal.execute` |

### The tests, by claim

| Claim | Tests |
|---|---|
| C1. Every declaration passes the schema; a default that does not, stops start-up; one that serves named companies puts only them out of service | `test/connectors.test.ts` |
| C2. What each operation needs, from its contract; start-up stops when the default lacks it; line ④ refuses a company whose connector lacks it | `test/connectors.test.ts` |
| C3. No key in a declaration, and none in a refusal | `test/connectors.test.ts`, `test/connectors-review.test.ts` |
| The review's findings, each red first | `test/connectors-review.test.ts` |
| C4. On the database: line ④'s refusal leaves no claim, and the same request with the same key runs once the connector is back | `test/connectors.db.test.ts` |

## What changed since step 33

| File | What changed |
| --- | --- |
| `src/connectors.ts`, `connectors.json`, `schemas/connector.schema.json` | **New.** The declaration of the `accounting` connector, the file that says which connector serves each company, the specification's schema copied byte for byte, what each operation needs, the start-up check, and line ④'s check (D1 to D6) |
| `src/registry.ts` | Start-up checks the connectors with the rest, and the registry keeps which connector serves each company (D3, D4) |
| `src/pipeline.ts` | Line ④ looks at the company's connector, after the brake (D4) |
| `src/main.ts` | The story of this step, in worlds of its own |
| `test/connectors.test.ts`, `test/connectors.db.test.ts` | **New.** The claims C1 to C4 |
| `test/connectors-review.test.ts` | **New.** What the review found: each fix, red first, and a test for each break that survived |
| `test/rule-world.ts`, `test/db.ts`, `test/helpers.ts` | A world may be given a connectors file. `NO_PLUGS`, for a registry a test builds by hand |
| `test/permissions.test.ts`, `test/registry.test.ts` | Their hand-built registries name their connectors. Each says "step 34" |

Step 33's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_33_the_decision_bundle/src src
git diff --no-index ../mj_33_the_decision_bundle/test test
```

## Run it

As in step 33, the step needs a local PostgreSQL 17 and a database of its own. This step adds no
migration.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-17. After step 33's scenes, the program tells this step's story in
worlds of their own, in memory:

```text
connectors, in memory, in worlds of their own:
  accounting, exclusive: transactions true, optimistic_concurrency true, downstream_idempotency false, outcome_lookup false, events false, batch false, row_level_security true, freshness current
  invoice.get needs: nothing beyond a read
  invoice.list needs: nothing beyond a read
  payment.cancel needs: transactions, optimistic_concurrency, freshness:current, shares_dsor_transaction
  payment.create needs: optimistic_concurrency, freshness:current, shares_dsor_transaction
  proposal.approve needs: transactions, freshness:current, shares_dsor_transaction
  proposal.execute needs: transactions, freshness:current, shares_dsor_transaction
  start-up warns: connectors.json: connector "accounting-789", which serves org_789, is out of service: connector "accounting-789" cannot serve: payment.cancel needs transactions; proposal.approve needs transactions; proposal.execute needs transactions
  org_789's connector cannot undo a job; user_700 reads org_789's INV-2002: CONNECTOR_UNAVAILABLE: invoice.get: org_789's connector is out of service
  the agent drafts org_456's INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  the default connector cannot undo a job: DSoR does not start:
    connectors.json: the default connector is broken: connector "accounting" cannot serve: payment.cancel needs transactions; proposal.approve needs transactions; proposal.execute needs transactions
```

`payment.create` does not need `transactions`: its contract says `compensatable`, which means a
later command, `payment.cancel`, can undo it. It still needs DSoR's transaction (D1). The reason
org_789's connector is out of service is in start-up's warning, for the people who run DSoR. The
caller hears only that it is out.

`pnpm check` runs the type check, then the unit tests. `pnpm test:db` runs the database tests.

## Break it

Each break ran on 2026-10-17 in a copy of this folder outside the repository, never in the folder
itself, and a fresh copy was made for each. A short script told three scenes:

- **S1:** org_789's connector cannot undo a job, and firm-ap-fte drafts org_789's INV-2002.
- **S2:** the default connector cannot undo a job, and DSoR starts.
- **S3:** the default connector's extensions hold a database URL, and DSoR starts.

Unbroken:

```text
S1, org_789's connector cannot undo a job; firm-ap-fte drafts INV-2002: CONNECTOR_UNAVAILABLE; proposals in org_789: 0; payments drafted: 0
S2, the default connector cannot undo a job: connectors.json: the default connector is broken: connector "accounting" cannot serve: payment.cancel needs transactions; proposal.execute needs transactions
S3, the default connector's extensions hold a URL: connectors.json: the default connector is broken: connector 1: its extensions may hold only org.panaversity.steps.shares_dsor_transaction
```

These breaks ran before the review, so `proposal.approve` is not yet in S2's list.

| Break | What changed | The scenes | The tests that failed |
|---|---|---|---|
| **B1** | Line ④ does not look at the connector | S1: `COMMITTED`; 1 proposal, 1 payment drafted in org_789, through a connector that cannot undo a job | 2: the org_789 draft and the org_789 query |
| **B2** | A broken default connector is only out of service, and start-up goes on | S2 and S3: `DSoR started` | 9, every start-up refusal of the default connector |
| **B3** | `atomic` no longer needs `transactions` | S1: `COMMITTED`, 1 payment drafted; S2: `DSoR started` | 4, the needs table among them |
| **B4** | The extensions may hold anything | S3: `DSoR started`, with a URL inside its declaration | 1 |

During B4's run, three tests of the cross-company suite (step 12) also failed while two other
suites shared the machine. Run again alone, the suite passed, 88 of 88. They are not B4's.

**On the database (C4):** the test proves that line ④'s refusal leaves no claim behind, and that
the same request with the same key is drafted once the connector is back. Why line ④ and not later:
a claim keeps the answer it ended with, and a replay gives it back (step 20). A refusal after line
⑦ would be kept with its key, so the retry that `safe_same_key` promises could not run. That break
was not run in this step.

## Build it yourself with Claude Code

Claude Code built the step in these moves.

| # | Move | What was done |
|---|---|---|
| 1 | Explore | The learner asked why DSoR needs connectors when banks will ship MCP servers. Answered: MCP is how a call travels, a connector is DSoR's contract with one system. Open question 145 |
| 2 | Production first | Six choices checked against how real systems run, before any code. Two changed: per-company connectors refuse at line ④ instead of stopping start-up, and the password test became an alarm, not the lock |
| 3 | Decide | D1 to D6, Claude Code's, as the learner chose to build first. D1 changed during the build: a separate login would break step 33's one transaction (F1) |
| 4 | The copy | Step 33 copied, its markers removed |
| 5 | Red, then green | 22 tests written first; 17 failed against a stub that checked nothing, for the right reasons; the code turned them green |
| 6 | The database | A throwaway PostgreSQL 17: C4's test, and the whole database suite |
| 7 | Break it | B1 to B4, run for real, in copies of the folder |
| 8 | Review | A reviewer who had not seen the conversation, with the threat table and 41 small breaks in a copy of its own |
| 9 | Fix | F2 to F6, red first, each with its test |

To start it in a new session:

```text
Build step 34 in learner mode from the design in
docs/baby_steps_tutorials/mj_34_connectors/README.md.
```
## Check yourself

1. org_789's connector says `transactions: false`. user_700 reads INV-2002. What do they hear, and
   is anything claimed or drafted?
2. The default connector says `transactions: false`. What happens when DSoR starts, and why does it
   not only take the payments out of service?
3. A contract asks `connector_requirements: { downstream_idempotency_or_outcome_lookup: true }`. The
   connector says `downstream_idempotency: false` and `outcome_lookup: true`. Is the operation
   routed there?
4. Why does `accounting` share DSoR's transaction in this step, and what would break if it had its
   own login today?
5. A teammate writes the database URL into the declaration's `region`, "so it is all in one place".
   What does DSoR do, and why does it matter?

<details>
<summary>Answers</summary>

1. `CONNECTOR_UNAVAILABLE`, at line ④, with the retry class `safe_same_key`. Nothing is claimed,
   no proposal is made, and nothing is drafted. The record says DENY (D4).
2. DSoR does not start, and it names each operation that needs `transactions`. The default serves
   every company the file does not name, so every company would be broken, and a DSoR that started
   anyway would be running on a promise it knows is false (D4).
3. Yes. The key asks for either of the two, and the connector has one of them (D2).
4. The claim, the payment, and the record commit in one transaction, so a payment never exists
   without its record (DSOR-EXE-04a). A login of its own is a connection of its own, and no
   transaction spans two connections. Until step 36's intent record, a payment and its record could
   then part (D1).
5. DSoR refuses to start: a region must be a short lowercase name. The declaration is published,
   so a key in it is a key handed to anyone who reads it, the agent included (D5, DSOR-CNR-02).

</details>

## Think it through

### Found while building

- **F1. A login of its own would have split a payment from its record.** The first plan gave the
  connector its own database login. But step 33 saves the claim, the payment, and the record in
  one transaction, and a second login is a second connection, which no transaction spans. So D1
  keeps one login until step 36's intent record. The learner had agreed to separate keys; this is
  the change, and its reason.
- **Line ④ ran twice.** The first version checked the connector in a second line ④ of its own.
  Forty older tests list the lines a call ran, and they saw a ④ too many. The brake and the
  connector are now one line ④, the brake first.
- **The contract already has `connector_requirements`.** Reading `operation-contract.schema.json`
  found the field, and §7's example `downstream_idempotency_or_outcome_lookup`. D2 reads it before
  it works anything out.
- **The program's first scene asked the wrong caller.** firm-ap-fte holds no slip in the program's
  world, so line ③ refused it before line ④ was reached. The scene asks user_700, a person of
  org_789.

### What the review found

A reviewer who had not seen the conversation read the step against the four rules, attacked it
with inputs of its own, and made 41 small breaks in a copy of the folder.

- **F2. `proposal.approve` was not routed.** An approval reads the invoice and the vendor it binds
  (`src/approve.ts`), through the connector, and cfo_100 approved while org_456's connector was out
  of service. A test even said it was not routed. Now it is, by name (D3).
- **F3. A refusal repeated the declaration's text.** Line ④'s message said *why* the connector was
  out of service, which is the declaration's own words. A URL written as a field's name reached
  the agent and the record. The caller now hears fixed words, and the reason goes to start-up's
  warnings (D4).
- **F4. Three fields could still carry a key:** `change_detection`, which the schema leaves open;
  `field_fidelity`'s names; and the flag, which was never checked to be `true` or `false` (D5).
- **F5. What a contract asks, read exactly.** Breaks survived for `false` meaning "not required",
  for `freshness` as a requirement, and for `bounded_staleness`. Each has a test now.
- **F6. Line ④'s order and reach.** Breaks survived that put the connector before the brake, or
  refused DSoR's own commands too, so nobody could pull the brake during an outage. Each has a
  test, and so do a dry run, `propose_only`, a release, and a replay. `NO_PLUGS`, which lets every
  call through, moved from `src` to the tests. The code's decision numbers now match this README.

Fifteen breaks had left every test green. Eleven now have a test aimed at each, though the
reviewer's breaks were not run again against the fixes. Two are left, both small: a looser check
of the file's shape, which still fails closed, and a duplicate id missed when its first copy is
broken. Two are equivalent: the schema already refuses a requirement that is not `true` or
`false`, and the refusal's label is never applied at line ④.

### Left open on purpose

- **Routing is by name only.** Every company's records still live in the one database, behind the
  same code, whichever connector the file names. A connector here is a declaration and a check.
  Code of its own per connector starts with the bank, in step 35.
- **The flag is the connector's own word.** Nothing checks that `accounting` really shares DSoR's
  transaction. It does, because it is the same database. A connector to another system must say
  `false`, and then no command goes there until step 36.
- **A replay during an outage is refused.** Line ④ comes before line ⑦, so a call that already ran
  is not given back while its company's connector is out, though its answer is in DSoR's own
  store. The brake does the same. Open question 147.
- **No fallback semantics.** DSOR-CNR-01b allows a contract to define them, and the schema has no
  field for them. Open question 146.
- **A warning is only printed.** No one is told when a company's connector goes out of service.
  Watching a connector's health belongs with the bank's breaker, in step 35.
- **Two database tests fail on a throwaway server.** On a local PostgreSQL that accepts any
  password, the test "a log with the wrong password" logs in anyway, and an owner that belongs to
  no other role fails "refuses to run as the owner". Step 33 fails both the same way on that
  server. On the learner's own server both pass.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-CNR-01a | Every connector publishes a declaration that passes `connector.schema.json` | [§35](../../../specs/dsor/05-bindings.md#35-connector-contract) | [`test/connectors.test.ts`](test/connectors.test.ts), [`test/connectors-review.test.ts`](test/connectors-review.test.ts) |
| DSOR-CNR-01b | No operation goes to a connector that lacks what its contract requires | [§35](../../../specs/dsor/05-bindings.md#35-connector-contract) | [`test/connectors.test.ts`](test/connectors.test.ts), [`test/connectors-review.test.ts`](test/connectors-review.test.ts), [`test/connectors.db.test.ts`](test/connectors.db.test.ts) |
| DSOR-CNR-02 | A connector's credentials never reach the model or the agent | [§35](../../../specs/dsor/05-bindings.md#35-connector-contract) | [`test/connectors.test.ts`](test/connectors.test.ts), [`test/connectors-review.test.ts`](test/connectors-review.test.ts) |
| DSOR-CNR-03a | Every connector says whether it is the only writer | [§35](../../../specs/dsor/05-bindings.md#35-connector-contract) | [`test/connectors.test.ts`](test/connectors.test.ts) |

**Next:** step 35, a fake bank: a second connector, with switches for slow, broken, and silent.
