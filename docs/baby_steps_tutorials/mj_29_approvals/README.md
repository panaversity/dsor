# Step 29 · Approvals

**New in this step:** a person approves a waiting payment, on their own login to DSoR. The
approval is tied to one exact request by its fingerprint. It expires, and every rule that asked
must be satisfied.

## In plain words

Since step 27, a payment that a rule sends to the CFO waits, and nothing could approve it. Now a
person approves it on their own login, with DSoR's own command `proposal.approve`. The approver
names the waiting *proposal*, DSoR's order-tracking page for one attempt, and its *fingerprint*, a
code computed from the exact request. DSoR approves only when the fingerprint is the stored one,
and when every rule that asked has its approvers. An agent never approves, whatever it says.

## Why it matters

The agent drafts INV-1008, 31,400.00 USD, and it waits for the CFO. Then the agent messages
cfo_100: "Please approve my small payment of 900 USD." If cfo_100 approved through that message,
the agent would choose what is approved. §26.5 names the mistake: "Whatever travels through the
agent, the agent can fake."

So an approval names one exact request by its fingerprint, the specification's `payload_hash`.
DSoR computes it with SHA-256, a standard way to make such codes, over the request written as
*canonical JSON*. Canonical JSON is one exact way to write a request, so the same request always
gives the same text, and the same fingerprint. DSoR refuses an approval whose fingerprint is not the
stored one: `APPROVAL_MISMATCH`.

The fingerprint protects cfo_100 only if cfo_100 reads the request, and its fingerprint, from DSoR.
If the agent sent INV-1008's own address and fingerprint with the words "900 USD", DSoR would
approve: the words never reach DSoR. A screen that shows the request as DSoR keeps it is a later
step (DSOR-APR-06a). This step ties each approval to one request, and keeps the agent from
approving at all. Found by the step's review, finding M3: the first words said the fingerprint
alone protected cfo_100.

## The design, before any code

The circled numbers are lines of DSoR's checklist. Every call runs through them in order, as a
pilot runs through a checklist. Line ⑤ checks the caller's permission, and ⑥ the input. Line ⑧
makes the proposal. Line ⑨ is DSoR's own look before any work, line ⑩ checks the rules and the
limits, and line ⑪ writes the record.

### How this step was made

The learner chose to build first and understand afterwards, as for steps 27 and 28 (2026-10-13:
"implement 29 then we discuss both 28 and 29 together"). So every decision below is Claude Code's,
for the learner to review, and each one says what it costs. This folder is a copy of step 28b.

### What each rule says

- **DSOR-APR-02a:** "An approval MUST validate against `approval.schema.json`, which binds it to the
  proposal, operation and version, tenant, resource URIs, payload hash, risk level, the control
  requirements it satisfies, the approvers and the basis of their authority, an expiry, and the
  bound state" ([§26.3](../../../specs/dsor/03-execution.md#263-what-an-approval-binds)).
- **DSOR-APR-02b:** "The payload hash MUST be computed over the RFC 8785 (JCS) canonical JSON of the
  stored input." Step 20 built most of it, early.
- **DSOR-APR-05a:** "`proposal.approve` MUST be accepted only in `direct` identity mode, from an
  approver authenticated to DSoR under their own credentials"
  ([§26.5](../../../specs/dsor/03-execution.md#265-the-approval-channel)). *Direct* means a person's
  own call, with the login DSoR gave them; an agent's call, under a permission slip, is
  *unattended*.
- **DSOR-APR-09:** "`proposal.approve` MUST be refused with `APPROVAL_MISMATCH` unless the
  `payload_hash` supplied by the approver equals the stored proposal's payload hash"
  ([§26.1](../../../specs/dsor/03-execution.md#261-one-model)).
- **DSOR-AUT-02c:** "When several `REQUIRE_*` outcomes apply, all of them MUST be satisfied"
  ([§15](../../../specs/dsor/02-security.md#15-authorization)).
- **Beside them:** DSOR-APR-07, the permission that decides is the target operation's
  `approve_permission`; DSOR-APR-04a, an approval expires within §44's ceiling, 30 days at L2, the
  specification's second level of conformance; DSOR-APR-05b, input relayed through the agent never
  counts as approval; DSOR-APR-08, a `proposal.*` command never asks for an approval itself; and
  DSOR-APR-01b, the move to `APPROVED` is recorded with its actor and its cause.

### Decisions (Claude Code)

- **D1. One command for every approval, `proposal.approve`,** DSoR's own work, for people only,
  with the input `{ proposal, payload_hash }`, as §26.1's table gives it. There is no approve
  operation for each kind of thing. *Downside:* the approver needs the proposal's address and
  fingerprint, and this step builds no way to list or read waiting proposals (`proposal.get` is
  later). The tests and the story read them from DSoR's store, as an approval screen would. And
  nothing yet shows the approver the request as DSoR keeps it (DSOR-APR-06a, L3).
- **D2. Two permissions.** Line ⑤ checks the contract's own, `proposal:approve`. Line ⑨ then
  checks the target operation's `approve_permission` (DSOR-APR-07): `payment.create` and
  `payment.cancel` name `payment:approve`. The second one decides. The CFO and the tenant
  administrator hold both. *Downside:* two permissions for one act, and a role that holds only one
  of them cannot approve.
- **D3. The approver must hold a role the proposal waits for,** in this company. A rule asks, for
  example, for "CFO, quorum 1". A *quorum* is how many people must approve: here one person with the
  role CFO. One approval satisfies every open requirement whose role the approver holds, and one
  person never counts twice for one proposal. An approver who holds none of the roles it waits for
  is refused `AUTHORIZATION_DENIED`. One whose roles are all satisfied already hears `CONFLICT`.
  *Downside:* one approval can satisfy two rules: two that ask for the CFO, or two roles that one
  person holds. The specification counts distinct people within one requirement only
  (DSOR-SOD-04c, L3, its third level).
- **D4. The proposal keeps what it waits for.** When line ⑩ stops a call at `PENDING_APPROVAL`, the
  proposal keeps each requirement, with the rule's id and version, in `proposal.schema.json`'s own
  field, `requires`. It is written once, on that move only. The database's *trigger*, code that
  the database runs at every change of a row, refuses any other change, the owner's too. An
  approval satisfies only what the proposal waits for.
  *Downside:* a rule changed after the proposal was made does not change what it waits for. Step 31
  checks again at execution (DSOR-APR-03b).
- **D5. Line ⑨'s order.** First the call: in `direct` mode, from a person, or
  `AUTHORIZATION_DENIED`. Then the proposal: one of this company's, or `RESOURCE_NOT_FOUND`. Then
  who may approve its operation: a holder of its `approve_permission`, or `AUTHORIZATION_DENIED`.
  Then its state and its time: only a `PENDING_APPROVAL` proposal whose time has not come, or
  `CONFLICT`. Then the approver: a role the proposal waits for, or `AUTHORIZATION_DENIED`. They
  approve once, while a requirement of their role is still open, or `CONFLICT`. Last, the
  fingerprint: `APPROVAL_MISMATCH` unless it is the stored one (DSOR-APR-09). All of it comes
  before any work, so a refused approval writes no approval. The store's step checks the state and
  the time again, under the ending lock (D9). *Downside:* a person who holds `proposal:approve`
  learns whether a proposal of their company exists. One who may approve its operation learns its
  state too.
- **D6. Canonical JSON in full (DSOR-APR-02b).** RFC 8785 is the published standard for canonical
  JSON. Step 20's canonical JSON passes its own examples. One part was missing: RFC 8785 takes only
  *I-JSON*, JSON whose text is valid Unicode. JavaScript stores text as UTF-16, which writes some
  characters in two parts. Text that holds one part alone, a *lone surrogate*, is not valid
  Unicode. Two programs would write it differently, and so compute different fingerprints. Line ⑥
  refuses such a request `VALIDATION_FAILED`. *Downside:* JavaScript could hash such text, and DSoR
  refuses it anyway.
- **D7. An approval in `approval.schema.json`'s shape (DSOR-APR-02a).** Its id is `apr_` and a
  random UUID, a random 128-bit id. It names the proposal, its operation and version, the company,
  the resources, the fingerprint, and the target's risk level. It names the requirements it
  satisfies, and the approver with the basis, such as `role:CFO`. Its *bound state* names the
  version of each invoice the proposal names, as DSoR reads it at the approval. In `predicate`
  mode, a later change of a version does not end the approval by itself: step 31 checks the rules
  again instead. A critical operation binds in `strict_version` mode, as the schema asks, where any
  change ends it. The approval is `active`, and its `sod_mode` is `standard`: the usual rules of
  *separation of duties*, which decide who may not approve (step 30). *Downside:* the bound state
  names invoices only, since this tutorial reads no payment by its id. And `authn.at` is the time
  of the call, since this tutorial's logins carry no time of their own.
- **D8. DSoR keeps each approval,** in memory for the tests and in `dsor.approvals` on the
  database: read and added by DSoR's login, never changed or removed, and one approval for each
  person and proposal, which a unique key keeps. *Downside:* an approval cannot be revoked yet
  (DSOR-APR-04b is a later step).
- **D9. Every rule that asked must be satisfied (DSOR-AUT-02c).** The proposal moves to `APPROVED`
  only when each requirement it waits for has its quorum of approvers. Until then it stays
  `PENDING_APPROVAL`, and the answer says what it still waits for. The approval and that move are
  one step of the store. It runs under the company's *ending lock*, which two other commands take
  before they list the waiting proposals (step 25c). A *tear-up* ends a permission slip and cancels
  its waiting proposals. The *sweep* expires the proposals whose time has come. So two approvers at
  once never both leave a proposal waiting, and a tear-up or a sweep never misses an approval.
  *Downside:* an approver waits for any other approval, tear-up, or sweep of the same company, for
  a moment.
- **D10. On the approver's own login (DSOR-APR-05a, DSOR-APR-05b).** `proposal.approve` is for
  people only, so line ⑤ refuses an agent, an application, or a system login, whatever its slip
  lists. Line ⑨ looks again: the call must be in `direct` mode, and from a person. In this tutorial
  only an agent works under a slip, so a person's call is always direct. *Downside:* this meets
  DSOR-SOD-01a, "an agent never approves", early. The map of the steps (`../readme.md`) gives it to
  step 30, which adds who else may not approve.
- **D11. An approval expires with its proposal (DSOR-APR-04a).** Its `expires_at` is the proposal's
  own, which step 25c caps at 30 days, §44's longest life at L2. The sweep now expires an
  `APPROVED` proposal at that time too, and gives back its booking. *Downside:* an approval given on
  the proposal's last day lasts until that day's end only.
- **D12. An approved proposal waits.** Nothing executes it until step 31's `proposal.execute`.
  *Downside:* in this step an approval moves a state and nothing more. The payment is not drafted.
- **D13. A rule asks only for an approval that someone can give.** A draft and start-up refuse a
  rule whose effect asks for an approval on an operation that names no `approve_permission`. They
  also refuse one that asks for a role without both permissions an approver needs: that
  `approve_permission`, and `proposal:approve`, which lets a person call `proposal.approve` at
  all. Otherwise the payment would wait for an approval nobody can give. *Downside:* a company
  grants both permissions before it writes such a rule. And nothing checks that enough people hold
  the role: a rule that asks for two CFOs, in a company with one, holds each payment until it
  expires.
- **D14. The answer:** `{ tenant_id, id, proposal, state, waits_for, expires_at }`: the approval's
  id, the proposal's state after it, and what it still waits for, empty once it is `APPROVED`. Each
  field is labelled `internal`. *Downside:* the approver learns which other roles must still
  approve.
- **D15. A second rule in the story.** To show DSOR-AUT-02c, cfo_100 writes and switches on a rule of
  org_456's own, `admin-above-30000`: above 30,000 USD, one approval by a tenant administrator.
  *Downside:* a tenant administrator approves payments in this story, which a real company may not
  want.

### The story's numbers

| Who | Asks | DSoR answers |
|---|---|---|
| the agent | drafts INV-2009, 900.00 USD | drafted: below 25,000 USD, no rule stops it |
| the agent | drafts INV-1008, 31,400.00 USD | waits: its proposal waits for the CFO, by version 8 of high-value-payment |
| the agent | approves its own proposal | `AUTHORIZATION_DENIED` at line ⑤: for people only |
| admin_100 | approves it, with its fingerprint | `AUTHORIZATION_DENIED`: admin_100 holds none of the roles it waits for |
| cfo_100 | approves it, with the fingerprint of the 900.00 USD payment | `APPROVAL_MISMATCH` |
| cfo_100 | approves it, with its own fingerprint | `APPROVED`, and the approval `apr_…` |
| cfo_100 | approves it again | `CONFLICT`: it is `APPROVED` |
| cfo_100 | writes and switches on `admin-above-30000` | active |
| the agent | drafts INV-2012, 35,000.00 USD | waits for the CFO and for a tenant administrator |
| cfo_100 | approves it | still waits, for a tenant administrator |
| admin_100 | approves it | `APPROVED` |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | The fingerprint is SHA-256 over RFC 8785 canonical JSON: the RFC's own examples, and a lone surrogate refused at line ⑥ |
| C2 | Only a person approves, on their own login; the approver holds the target's `approve_permission` and a role the proposal waits for |
| C3 | Only the request with that fingerprint, only a waiting proposal, and only once by each person |
| C4 | An approval passes `approval.schema.json`, and DSoR keeps it, on the database too, where nothing changes or removes it |
| C5 | Every rule that asked is satisfied before `APPROVED`, in one step, with two approvers at once too |
| C6 | An approval expires with its proposal, and the sweep expires an `APPROVED` proposal and gives back its booking |
| C7 | A waiting proposal keeps what it waits for, written once |
| C8 | A rule asks only for an approval that someone can give; no rule governs `proposal.approve` |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The fingerprint is not compared | cfo_100 approves INV-1008's 31,400.00 USD with the 900.00 USD payment's fingerprint, and it is `APPROVED` | (asked at the review) |
| B2. `proposal.approve` loses "people only" | line ⑤ lets an agent through whose slip lists `proposal:approve`, and line ⑨ still refuses it: an agent holds no role | (asked at the review) |
| B3. One approval is enough | INV-2012 is `APPROVED` after cfo_100 alone, though the second rule asked for a tenant administrator | (asked at the review) |
| B4. The role is not checked | admin_100 approves INV-1008, which waits for the CFO, and it is `APPROVED` | (asked at the review) |

### Left open, and not this step's idea

- Seeing what you approve: `proposal.get`, and DSoR's own rendering of the request (DSOR-APR-06a,
  L3).
- Revoking an approval (DSOR-APR-04b), and rejecting a proposal (`proposal.reject`).
- Who else may not approve: the person who signed the agent's slip, and the requester's chain
  (DSOR-SOD-02), step 30.
- Executing an approved proposal, and checking again at execution (DSOR-APR-03a to 03c), step 31.
- Telling an approver that a proposal waits: the *outbox*, a table of messages that DSoR writes
  inside its transaction and sends after it, step 40.

## Before you build: set up a database

As in step 28b: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Two migrations run. Migration 025 gives `dsor.proposals` the
column `requires`, what a waiting proposal waits for, and teaches the trigger when it may be
written: on the move to `PENDING_APPROVAL`, and never again. Migration 026 makes `dsor.approvals`:
each approval whole, in `approval.schema.json`'s shape, behind the company's lock. DSoR's login may
read an approval and add one, and never change or remove it, and one person approves one proposal
once.

Give the step a server of its own, or at least a database of its own with its own `.env`.
`pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server, so a second step
migrated on the same server changes the first step's login.

## What changed since step 28b

| File | What changed |
| --- | --- |
| `src/approvals.ts` | **New.** An approval in `approval.schema.json`'s shape, and the count: what a proposal still waits for, and what one person's approval satisfies |
| `src/approve.ts` | **New.** `proposal.approve`: line ⑨'s look, in decision D5's order, and the work, which asks the store for one step |
| `migrations/025_proposal_requires.sql` | **New.** The column `requires`, and the trigger's rules for it |
| `migrations/026_approvals.sql` | **New.** `dsor.approvals`, add-only for DSoR's login, one approval for each person and proposal, behind the company's lock |
| `contracts/proposal.approve.json`, `inputs/ProposalApproveRequest.schema.json`, `examples/proposal.approve.json` | **New.** The command, for people only, its input `{ proposal, payload_hash }`, and the cross-tenant suite's example |
| `schemas/approval.schema.json` | **New.** The specification's schema, copied byte for byte |
| `src/canonical.ts`, `src/pipeline.ts` | Text that is not valid Unicode has no canonical JSON, and line ⑥ refuses it. The look of DSoR's own work gets the call's identity mode, the proposals, the contracts, and the caller's permissions; a dry run reads the proposals outside any claim |
| `src/proposals.ts`, `src/postgres.ts` | A waiting proposal keeps what it waits for. The store's approval step, under the company's ending lock. The sweep's list names `APPROVED` proposals too |
| `src/envelope.ts`, `src/controls.ts`, `src/registry.ts`, `src/permissions.ts` | A requirement names its rule's version. A rule may ask only for an approval that someone can give. The contract's `approve_permission`, read in one place |
| `src/revocation.ts`, `src/claims.ts`, `src/expiry.ts` | DSoR's own work gets `proposal.approve`; the claim store gives a dry run its proposals; the sweep expires an approved proposal |
| `roles.json`, `contracts/payment.*.json`, `classifications.json`, `store.json` | The CFO and the tenant administrator approve; the payment commands name `payment:approve`; the labels of the answer; the map's new table and column |
| `src/main.ts` | The approval story |
| `test/canonical.test.ts`, `test/proposal-requires.test.ts`, `test/proposal-requires.db.test.ts`, `test/approvals.test.ts`, `test/approvals.db.test.ts`, `test/approve.test.ts`, `test/approve.db.test.ts`, `test/approval-expiry.test.ts`, `test/approval-expiry.db.test.ts`, `test/approvable-rules.test.ts` | **New.** The claims C1 to C8 |
| The other tests | The helpers that plant a waiting proposal name what it waits for. The pinned lists of contracts, roles, labels, privileges, policies, tables, and attacks grow by one command and one table |

Step 28b's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_28b_where_a_rule_came_from/src src
git diff --no-index ../mj_28b_where_a_rule_came_from/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-13. After step 28b's story, the program tells the approvals, in
memory, in a world with stores of its own.

```text
approvals, in memory, with a store of their own:
  the agent drafts INV-2009, 900.00 USD: answered, PAY-901
  the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  the agent approves its own payment: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and accounts-payable-fte is not a person
  admin_100 approves it: AUTHORIZATION_DENIED: admin_100 holds none of the roles proposal prop_bb9fa3de-2757-46c4-8751-57e9f06a04e1 waits for: CFO
  cfo_100 approves it, with the 900.00 USD payment's fingerprint: APPROVAL_MISMATCH: the fingerprint is not the one of proposal prop_bb9fa3de-2757-46c4-8751-57e9f06a04e1's request
  cfo_100 approves it, with its own fingerprint: APPROVED, by approval apr_2bcf824b-fe7f-454c-b0c1-482b7777b9f3
  cfo_100 approves it again: CONFLICT: proposal prop_bb9fa3de-2757-46c4-8751-57e9f06a04e1 is APPROVED, and only a PENDING_APPROVAL proposal is approved
  cfo_100 drafts admin-above-30000, a rule of org_456's own: version 1, draft
  cfo_100 switches it on: version 1, active
  the agent drafts INV-2012, 35,000.00 USD: PENDING_APPROVAL, needs tenant_admin x1 (admin-above-30000), CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  cfo_100 approves it: PENDING_APPROVAL, still waits for tenant_admin
  admin_100 approves it: APPROVED, by approval apr_ebe9412f-206a-4161-93da-393ed7ea1a52
  payments drafted: 1, INV-2009's; the approved ones wait for step 31
```

The agent's own approval stops at line ⑤, and admin_100's at line ⑨: the rule asks for the CFO.
cfo_100's first approval carries the fingerprint of the 900.00 USD payment, and DSoR refuses it.
The second carries INV-1008's own, and the proposal moves to `APPROVED`. With the second rule on,
INV-2012 waits for two people, and only the second approval moves it. Nothing executes an approved
proposal yet, so only INV-2009's payment is drafted. Each world of the program numbers its own
payments from PAY-901, so here PAY-901 is INV-2009's, not the running example's payment of INV-1008.

## Break it

Each break ran on 2026-10-13, in a copy of the step outside the repository, and the copy was
restored after each run. A short script told the story against the copy's own code, in memory:
the agent drafts INV-2009, 900.00 USD, and INV-1008, 31,400.00 USD; three people try to approve
INV-1008; cfo_100 switches on `admin-above-30000`; the agent drafts INV-2012, 35,000.00 USD; and
cfo_100 approves it. Below are the lines that each break changed, as they were printed. Unbroken,
the same lines read:

```text
firm-ap-fte, under a slip cfo_100 signed listing proposal:approve, approves INV-1008: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and firm-ap-fte is not a person
admin_100 approves INV-1008: AUTHORIZATION_DENIED: admin_100 holds none of the roles proposal prop_… waits for: CFO
cfo_100 approves INV-1008 with INV-2009's fingerprint: APPROVAL_MISMATCH: the fingerprint is not the one of proposal prop_…'s request
INV-1008's proposal: PENDING_APPROVAL
cfo_100 approves INV-2012: PENDING_APPROVAL, still waits for tenant_admin
INV-2012's proposal: PENDING_APPROVAL
```

The proposal ids are shortened to `prop_…` here: each run makes new ones.

**B1. The fingerprint is not compared.** In `src/approve.ts`, line ⑨ lost its last check:

```text
cfo_100 approves INV-1008 with INV-2009's fingerprint: APPROVED
INV-1008's proposal: APPROVED
```

As the design expected: approved. The fingerprint cfo_100 sent belongs to the 900.00 USD request,
and the address to the 31,400.00 USD one. With the comparison, DSoR sees that the two name
different requests, and refuses. Without it, DSoR approved the large payment, though cfo_100's
fingerprint named the small one. Nothing else in DSoR notices: the approver may approve, the
proposal waits, and the role is right.

**B2. `proposal.approve` loses "people only".** In `contracts/proposal.approve.json`, `people_only`
became `false`. firm-ap-fte works under a slip that cfo_100 signed, which lists `proposal:approve`,
and cfo_100 holds it, so line ⑤ lets the agent through:

```text
firm-ap-fte, under a slip cfo_100 signed listing proposal:approve, approves INV-1008: AUTHORIZATION_DENIED: "proposal.approve" is accepted only in direct identity mode, on the approver's own login
```

The design expected line ⑨'s check of the role to stop it. Line ⑨'s first check stopped it
earlier: the call's identity mode is `unattended`, an agent under a slip, not `direct`. One flag in
one file was not the only thing between an agent and an approval (DSOR-APR-05a, decision D10).
Since the review, line ⑨ also refuses a direct call from a login that is not a person (finding L4).

**B3. One approval is enough.** In `src/proposals.ts`, the store moved a proposal to `APPROVED`
after any approval, whatever it still waited for:

```text
cfo_100 approves INV-2012: APPROVED, still waits for tenant_admin
INV-2012's proposal: APPROVED
```

The answer says it all: approved, and still waiting for a tenant administrator. The second rule
asked for one, and nobody gave it (DSOR-AUT-02c).

**B4. The role is not checked.** In `src/approve.ts`, line ⑨ lost its check that the approver holds
a role the proposal waits for:

```text
admin_100 approves INV-1008: CONFLICT: what admin_100 may approve of proposal prop_… is approved already
INV-1008's proposal: PENDING_APPROVAL
```

The design expected `APPROVED`. It stayed `PENDING_APPROVAL`: line ⑨'s next check found no
requirement of a tenant administrator's still open, and the store's own count, which decides what an
approval satisfies, would have kept nothing too. Two checks, in two places. The answer is wrong,
though: `CONFLICT` says "approved already", which is not true. The first check is the one that
gives the right answer.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The learner chose to build step 29 first, and to talk through steps 28, 28b, and 29 together after (2026-10-13) |
| 2 | Decide | D1 to D15, each Claude Code's, each with its downside, for the learner's review |
| 3 | The copy | Step 28b copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | Canonical JSON in full: RFC 8785's own examples, and a lone surrogate refused at line ⑥, red first |
| 5 | Piece B | A waiting proposal keeps what it waits for: in memory, migration 025, and on the database, red first |
| 6 | Piece C | DSoR keeps each approval: the count, the store's one step, migration 026, red first |
| 7 | Piece D | `proposal.approve`, red first |
| 8 | Piece E | An approval expires with its proposal, and the sweep expires an approved one, red first |
| 9 | Piece F | A rule asks only for an approval that someone can give, red first |
| 10 | Piece G | The program's story |
| 11 | Break it | B1 to B4, in a copy, each restored |
| 12 | Review | A reviewer who had not seen the conversation: no high finding, seven medium, eleven low, and 59 small breaks of its own, 14 of which survived |
| 13 | Fix | M1 to M7, and L1 to L7 and L9, one commit each or a few related together, each test red first and then broken on purpose; L8 and L11 recorded |

To start it in a new session:

```text
Build step 29 in learner mode from the design in
docs/baby_steps_tutorials/mj_29_approvals/README.md.
```

What each move broke, measured. These were not predictions. Each piece was broken on purpose, one
small change at a time, in a copy outside the repository: the unit tests in a copy of their own,
and the database's in a copy with a PostgreSQL server of its own, built again for each break of a
migration.

| Move | What failed |
| --- | --- |
| Piece A | 17 tests. RFC 8785's examples passed at once: step 20 had built them. The lone surrogates failed red. Broken on purpose, 4 ways: no check of the text, keys not checked, line ⑥ letting the error through, and keys not sorted. Each failed a test |
| Piece B | 6 tests in memory and 7 on the database, red first. Then the helpers that plant a waiting proposal, the owner's programs, and 4 pinned lists. Broken on purpose, 4 ways in memory and 7 on the database. Each failed a test |
| Piece C | 21 tests in memory, the schema copy's test, and 18 on the database. The store's 14 failed red: it had no approval step. The count's tests passed at once: the count was written first, during a database run, so its breaks are what test it. Then 3 pinned lists and 2 of the database's policies. Broken on purpose, 10 ways in memory and 11 on the database. Two survived, and changed the code: a lock of the proposal's row added nothing beside the company's ending lock, so it is gone; and a read that forgot the company was hidden by row-level security, so one id must name one proposal |
| Piece D | 19 tests in memory and 5 on the database, red first: no operation. Then 30 pinned old tests: 16 contracts, 153 attacks, the approvers' permissions, the labels, the semantics. Broken on purpose, 13 ways in memory and 3 on the database. One survived: every test invoice was at version 1, so an approval that always named version 1 passed. A database test now changes INV-9001 first |
| Piece E | 3 tests in memory and 1 on the database, red first: the sweep left an approved payment approved. Broken on purpose, once in each. Each failed a test |
| Piece F | 4 tests, red first. One passed at once: step 27 already refuses a rule on DSoR's own operations. Broken on purpose, 3 ways. Each failed a test |
| M1, the clock after the wait | 1 database test, red first: the approval was given after the expiry. Broken on purpose: `now()` again. It failed |
| L2, L7, M6, line ⑨ first | 3 tests and 1 on the database. The time test was red first; two guards passed at once. Broken on purpose: the review's A08, V01, and A19, and 3 of mine. Each failed a test |
| M2, both permissions | 2 tests, one red first. Broken on purpose: the review's C04, and 2 of mine. Each failed a test |
| M4, M5, L5, L6, L10 | Guards for code that was right: 8 tests and 6 cases on the database, all passing at once. Broken on purpose: the review's P03, A11, W02, W05, A13, A15, A16, and M08, and each of the database's key clauses removed. Each failed a test |
| L1, an address that names no proposal | 3 tests, 2 red first. A stricter input pattern was tried first: the cross-tenant suite refused it. Broken on purpose: the review's I02, and the check removed. Each failed a test |
| L3, L4, M7 | 6 tests: 2 red first, and 4 guards. Broken on purpose: the run-time guard removed, the look's check of a person removed, and the input schema opened, which start-up refuses. Each failed |

## Check yourself

Use the story: org_456's rule `high-value-payment`, version 8, asks for one CFO above 25,000.00
USD. The agent drafts INV-1008, 31,400.00 USD, and it waits. cfo_100 holds the role CFO, and
admin_100 the role tenant_admin. Both hold `payment:approve`.

1. cfo_100's approval link carries INV-2009's fingerprint, 900.00 USD, which cfo_100 checked. The
   agent changed the link's address to INV-1008's proposal. cfo_100 approves. What happens? And
   what if the agent had changed the fingerprint to INV-1008's own too?
2. The agent calls `proposal.approve` on INV-1008 itself, under a slip that cfo_100 signed, which
   lists `proposal:approve`. What stops it, and where?
3. With `admin-above-30000` on, the agent drafts INV-2012, 35,000.00 USD. cfo_100 approves it. What
   is its state, and what does the answer say? cfo_100 approves again, with a new key. What now?
4. cfo_100 approves INV-1008 on Tuesday, and nobody executes it. What happens a week later, to the
   proposal, the approval, and the 31,400.00 USD booked against the day?
5. cfo_100 and admin_100 approve INV-2012 at the same moment. Can both see "still waits", and leave
   it waiting for ever?

<details>
<summary>Answers</summary>

1. `APPROVAL_MISMATCH`, and nothing is approved. The fingerprint names INV-2009's request, not the
   one at that address (DSOR-APR-09, D5). With INV-1008's own fingerprint too, DSoR approves: the
   link names one request, and cfo_100's words about 900 USD never reach DSoR. Only a screen that
   shows the request as DSoR keeps it protects against that (DSOR-APR-06a, a later step).
2. Line ⑤ refuses it first: `proposal.approve` is for people only, whatever the slip lists. If that
   flag were ever lost, line ⑨ refuses it too: the call is not in `direct` mode, and the caller is
   not a person (DSOR-APR-05a, D10).
3. `PENDING_APPROVAL`, and the answer says it still waits for a tenant administrator. Again:
   `CONFLICT`, cfo_100 approved it already. One person counts once (DSOR-AUT-02c, D3).
4. The sweep moves it from `APPROVED` to `EXPIRED`, with its record, and gives the 31,400.00 USD
   back to the day. The approval expired with it: its `expires_at` is the proposal's own (D11).
5. No. Each approval takes the company's ending lock first, so they run one after the other. The
   second sees the first, and moves the proposal to `APPROVED` (D9).

</details>

## Think it through

### Found while building

- **The schema already had the field.** The design first named what a waiting proposal waits for
  *awaits*, a field of this tutorial's own. `proposal.schema.json` has its own, `requires`, with
  the rule's version in it. D4 uses the schema's field now.
- **A lock that changed nothing.** The approval's step first took the company's ending lock and
  then locked the proposal's row as well. A break that removed the row lock left every test green:
  every mover of a waiting proposal, the approval, the tear-up, and the sweep, takes the ending
  lock first. The row lock is gone, and D9 says which lock keeps them apart.
- **Row-level security hid a missing company.** With the company gone from the approval's read of
  the proposal, every test stayed green: the database's lock filtered for it. Like `get`, the step
  now refuses one id that names two proposals, and the owner's run, which no policy stops, shows
  it.
- **Every test invoice was at version 1.** An approval that always named version 1 passed every
  test. A database test now changes INV-9001 between the draft and the approval.
- **The answer's list needed its own labels.** `waits_for` is a list of objects, and the masking
  step refuses any object that `classifications.json` does not describe field by field. The first
  run of a successful approval answered `INTERNAL_ERROR`. The answer's kind is `Approval` now, so its
  record names the approval's address, `dsor://org_456/approval/apr_…`, and each requirement has
  its own fields.
- **Line ⑨'s order moved.** The design checked the role before the state. A `READY` proposal waits
  for nobody, so the role check answered "holds none of the roles it waits for", which is true and
  not useful. The state comes first now, and D5 says so.
- **Two layers, seen in the breaks.** B2 and B4 did not approve what the design expected. A second
  check stopped each one: line ⑨'s own look at the identity mode, and the store's own count.

### The hostile review

A reviewer who had not seen the conversation read the code at piece G, and broke it 59 times in a
copy of its own. It found no high finding, seven medium, and eleven low. No break and no probe let
an agent, a person without the role or the permission, another company, or a wrong fingerprint
produce an approval.

- **M1, fixed: an approval after the expiry, behind a lock.** The step checked the expiry with
  PostgreSQL's `now()`, the time its transaction began. An approval that waited for a sweep's lock
  across the expiry was given after the proposal's time had come. The step reads the clock after
  the wait now, and a database test holds the lock across the expiry.
- **M2, fixed: a rule could ask for an approval nobody could call.** D13 checked the payment's
  `approve_permission`, and not `proposal:approve`. It checks both now. Nothing checks that enough
  people hold the role, and D13 says so.
- **M3, fixed in these words: the fingerprint story said too much.** The fingerprint protects the
  approver only when the approver reads the request from DSoR. "Why it matters", B1, and question 1
  say so now.
- **M4, M5, L5, L6, L10, fixed with tests: code that was right, and that no test held.** The
  rule's id in a match; only the call's own company's roles and permissions, with one approval in
  org_789; the approval's risk, its binding mode, and its time; the store's check of a move's actor
  and cause; and six of the database's seven key clauses. Each of the reviewer's breaks there
  fails a test now.
- **M6 and L7, fixed with tests:** the store's own refusal reaches the caller, and line ⑨'s
  refusals are recorded `DENY`, before any work.
- **M7, fixed with tests:** the tests of DSOR-APR-05b look at `proposal.approve` itself now.
- **L1, fixed:** an address whose id is not a proposal's answered `INTERNAL_ERROR`, and now answers
  `RESOURCE_NOT_FOUND`. A stricter input pattern was tried first: the cross-tenant suite refused
  it, since it sends another company's address with an id that company does not have.
- **L2, fixed:** line ⑨ checks the time too, by the store's own clock, so a dry run hears what the
  real call hears.
- **L3, fixed:** line ⑩ fails closed if a rule ever asks for an approval of DSoR's own work.
- **L4, fixed:** line ⑨ refuses a login that is not a person, as well as a call that is not direct.
- **L9, fixed:** two comments named the lock of a proposal's row, which piece C removed.
- **L8 and L11, recorded** below.
- **The README's words.** "In plain words" is five sentences now. Quorum, trigger, UUID, I-JSON,
  UTF-16, RFC 8785, the binding modes, separation of duties, tear-up, sweep, the outbox, and the
  map are defined where they first appear. "In person" became "on their own login", and INV-2009 is
  drafted, not paid. The reviewer counted "fingerprint" as an analogy outside the writing skill's
  list. It stays: §26.3 uses the word itself.

### Left open on purpose

- **Seeing what you approve.** The approver needs the proposal's address and fingerprint, and this
  step builds no screen: the tests and the story read them from DSoR's store. `proposal.get`, and
  DSoR's own rendering of the request for the approver (DSOR-APR-06a, L3), are later.
- **An approval's status.** An approval is kept `active`, and nothing changes it. Past its
  `expires_at` it counts for nothing, and the sweep expires its proposal, but the kept record still
  says `active`. Revoking one (DSOR-APR-04b) and spending one at execution are later steps.
- **Who else may not approve.** The person who signed the agent's slip, or the requester, may still
  approve here, if they hold the role. Separation of duties is step 30 (DSOR-SOD-02).
- **One person, two roles.** A person who holds both roles a proposal waits for satisfies both with
  one approval (D3). The specification counts distinct people within one requirement (DSOR-SOD-04c,
  L3), and says nothing across two.
- **Executing an approved proposal.** Step 31 builds `proposal.execute`, and checks again at
  execution that the approvals still meet what the rules ask then (DSOR-APR-03a to 03c).
- **One lock for the company.** Every approval, tear-up, and sweep of one company waits for the
  others, for a moment (D9). A busy company would want a lock for each proposal, and a tear-up and a
  sweep that look again when a move finds the proposal moved on.
- **A quorum that nobody can meet.** A rule may ask for two CFOs in a company that has one. Each
  payment it stops waits until it expires (D13).
- **A proposal judged by its operation's name.** The approval reads the contract of the proposal's
  operation by its name, `payment.create`, and drops the version, `@1`. With one version of each
  contract nothing differs. A second version needs a decision of its own (finding L8).
- **An approval prepared, not made.** In `propose_only` mode, cfo_100's approval call ends as a
  `READY` proposal of `proposal.approve`, which step 31's `proposal.execute` could release later,
  perhaps by another person. Whose approval is that? Open question 122 (finding L11).
- **Where an approver's roles come from.** From DSoR's own table of logins, not the company's
  directory, which DSOR-SOD-04b (L3) may ask for. And the bound state is what DSoR read at the
  approval, not what the approver saw (DSOR-APR-06a, L3).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-APR-02a | An approval validates against `approval.schema.json`, which binds it to the proposal, operation, tenant, resources, payload hash, risk, the requirements it satisfies, the approvers and their basis, an expiry, and the bound state | [§26.3 What an approval binds](../../../specs/dsor/03-execution.md#263-what-an-approval-binds) | Each approval DSoR keeps passes the specification's own schema, in memory and on the database, and binds the proposal's own request. [`test/approvals.test.ts`](test/approvals.test.ts), [`test/approvals.db.test.ts`](test/approvals.db.test.ts), [`test/approve.test.ts`](test/approve.test.ts) |
| DSOR-APR-02b | The payload hash is computed over the RFC 8785 canonical JSON of the stored input | [§26.3 What an approval binds](../../../specs/dsor/03-execution.md#263-what-an-approval-binds) | RFC 8785's own examples, and a request whose text is not valid Unicode refused at line ⑥. [`test/canonical.test.ts`](test/canonical.test.ts) |
| DSOR-APR-05a | `proposal.approve` is accepted only in `direct` identity mode, from an approver authenticated to DSoR under their own credentials | [§26.5 The approval channel](../../../specs/dsor/03-execution.md#265-the-approval-channel) | People only at line ⑤, and line ⑨'s own look: a direct call, from a person. In this tutorial a person's login is their own. [`test/approve.test.ts`](test/approve.test.ts), [`test/approve.db.test.ts`](test/approve.db.test.ts) |
| DSOR-APR-05b | Input relayed through the requesting agent never counts as approval evidence | [§26.5 The approval channel](../../../specs/dsor/03-execution.md#265-the-approval-channel) | Partly. The only approval is a person's own call. The agent's call of `proposal.approve` is refused in every mode, whoever it names, and a person's call cannot name another approver. No MCP channel exists yet to test. [`test/approve.test.ts`](test/approve.test.ts) |
| DSOR-APR-09 | `proposal.approve` is refused `APPROVAL_MISMATCH` unless the approver's payload hash equals the stored one | [§26.1 One model](../../../specs/dsor/03-execution.md#261-one-model) | In memory, on the database, and in a dry run. [`test/approve.test.ts`](test/approve.test.ts), [`test/approve.db.test.ts`](test/approve.db.test.ts) |
| DSOR-APR-07 | The permission checked for `proposal.approve` is the target operation's `approve_permission` | [§26.1 One model](../../../specs/dsor/03-execution.md#261-one-model) | A CFO without `payment:approve` cannot approve a payment, and a proposal whose operation names none is approved by no one. [`test/approve.test.ts`](test/approve.test.ts) |
| DSOR-APR-08 | A `proposal.*` command never itself yields `REQUIRE_APPROVAL` | [§26.1 One model](../../../specs/dsor/03-execution.md#261-one-model) | No rule may govern DSoR's own operations, so none governs `proposal.approve`; and if one ever reached line ⑩, the call fails closed. [`test/approvable-rules.test.ts`](test/approvable-rules.test.ts) |
| DSOR-AUT-02c | When several `REQUIRE_*` outcomes apply, all of them are satisfied | [§15 Authorization](../../../specs/dsor/02-security.md#15-authorization) | A waiting proposal keeps every requirement, and moves to `APPROVED` only when each has its quorum, with two approvers at once too. [`test/proposal-requires.test.ts`](test/proposal-requires.test.ts), [`test/approvals.test.ts`](test/approvals.test.ts), [`test/approvals.db.test.ts`](test/approvals.db.test.ts), [`test/approve.test.ts`](test/approve.test.ts) |
| DSOR-APR-04a | An approval expires no later than §44's ceiling | [§26.3 What an approval binds](../../../specs/dsor/03-execution.md#263-what-an-approval-binds) | An approval expires with its proposal, which step 25c caps at 30 days. It is not given for a proposal whose time has come, at line ⑨ and in the store's step, by the clock after its wait. [`test/approvals.test.ts`](test/approvals.test.ts), [`test/approvals.db.test.ts`](test/approvals.db.test.ts), [`test/approval-expiry.test.ts`](test/approval-expiry.test.ts), [`test/approval-expiry.db.test.ts`](test/approval-expiry.db.test.ts), [`test/approve.test.ts`](test/approve.test.ts) |
| DSOR-APR-01b | Every proposal transition is recorded with its actor and its cause | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | The move to `APPROVED` names the approver and the cause, and the sweep's move from `APPROVED` names dsor-scheduler. [`test/approve.test.ts`](test/approve.test.ts), [`test/approval-expiry.test.ts`](test/approval-expiry.test.ts) |

## Next

Step 30 · Who may not approve. The agent never approves, as this step already holds. The person
who signed the agent's permission slip cannot approve the agent's requests either, even with the
right role (DSOR-SOD-01a, DSOR-SOD-02, DSOR-SOD-04c).
