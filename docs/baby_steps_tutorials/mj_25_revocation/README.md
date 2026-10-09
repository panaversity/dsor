# Step 25 · Tear up the slip

**New in this step:** the person who signed a permission slip, or a tenant administrator, tears
it up through DSoR. From the next call on, the agent is refused, and the slip's work that waits
for an approval is cancelled, its reservation released (DSOR-DEL-04a to DSOR-DEL-04c).

## In plain words

A permission slip lets an agent act for a person. user_123 signed del_100, so
accounts-payable-fte may read invoices and draft payments for user_123. Until this step, nothing
in DSoR could take that back. The slip ran until its date, 2099.

Now user_123 can *tear up* the slip: one command, `delegation.revoke`, with the slip's URI and a
reason. DSoR checks who is asking, before any work. Only the slip's own signer may tear it up, or a
*tenant administrator*: a person whose job is to look after the company's slips. Anyone else
hears one refusal, and learns nothing about the company's slips from it. Then DSoR marks the slip
revoked, and writes one record of who tore it up, when, and why.

From the next call on, the agent hears `DELEGATION_REVOKED`, for a draft and for a read. Work
under the slip that waits for an approval moves to CANCELLED, and the day gets back the amount
that work held. A torn-up slip never comes back. The agent needs a new slip.

The permission slip is the picture from step 18. Tearing it up takes back everything it
allowed, at once, without asking the agent.

## Why it matters

Wednesday, 10:00. user_123 decides that accounts-payable-fte should stop paying invoices for a
while: VENDOR-44's bank details are in question. del_100 says the agent may draft payments until
2099. Before this step, user_123 had three ways to stop it, and none of them was a control:

- Ask the agent to stop. That is a prompt, and the agent may ignore it (AGENTS.md, critical rule
  2: the agent is untrusted).
- Ask the database's owner to change `dsor.delegations` by hand. That checks no permission and
  leaves no record of who did it, or why.
- Wait until 2099.

## The design, before any code

### How this step was made

On 2026-10-09 the learner read the story of steps 22 to 24, then asked for the design of step
25, before its understanding session. Claude Code wrote it with every choice open: options, the
downside of each, and a recommendation. The learner then asked for the build at once: "first
complete 25 build". So Claude Code took each recommendation, and built the step. Each decision
below says that it was Claude Code's, and each is **for the learner to review** in the session.
A decision the learner changes is changed in the code, with its tests.

The first decision split the map's step 25 in two. This step tears up the slip. Step 25b pulls
the emergency brake, which suspends one agent, or freezes every agent in the company
(DSOR-OPS-01a to 01d).

Then a reviewer who had not seen the conversation attacked the build. It found two problems of
medium weight and five small ones. The fixes changed six decisions. Each of them says "changed by
the review", and "Think it through" tells the whole review.

The specification it relies on, read on 2026-10-09:

- [§13.3](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation): "A permission
  slip can be torn up at any time. After that the agent is refused, and anything it had waiting
  for approval is cancelled." DSOR-DEL-04a, DSOR-DEL-04b, and DSOR-DEL-04c. And: "A command
  already `EXECUTING` when its delegation is revoked runs to a recorded outcome."
- [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds): a revocation takes effect
  within 60 s at L2, and at the "next command; status read from the store, no cache" at L3.
- [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes): `DELEGATION_REVOKED`,
  retry never.
- [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle): CANCELLED means "Withdrawn,
  superseded, or its delegation was revoked or expired". Only PENDING_APPROVAL and APPROVED may
  move to CANCELLED. READY moves only to EXECUTING.
- [§13.4](../../../specs/dsor/02-security.md#134-cumulative-limits): DSOR-DEL-06d releases a
  reservation when its proposal reaches CANCELLED.
- [§11](../../../specs/dsor/02-security.md#11-source-trust-and-the-instruction-boundary):
  DSOR-SRC-02b, "A tenant, principal, or delegation identifier inside operation arguments that
  disagrees with the security context MUST cause `TENANT_MISMATCH` or `AUTHORIZATION_DENIED`."
- [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes): DSOR-ERR-01b, "An
  error MUST NOT reveal the existence or attributes of a resource the caller is not authorized
  to read."
- `delegation.schema.json`: a slip's status is `active`, `suspended`, `revoked`, or `expired`.
  `audit-record.schema.json`: the record kind `delegation_change`.

What step 24 already had: line ③ refuses a slip whose status is `revoked`, with
`DELEGATION_REVOKED`, and reads the slip from the store at every call. What it lacked: a way to
tear a slip up, and the cancelling of its waiting work.

### The intent and the outcome

**Intent.** A person can take back a slip at once, from inside DSoR, and the agent can neither
stop it nor undo it.

**Outcome.** What is true when this step is done:

1. user_123 tears up del_100. The agent's next call, a draft or a read, hears
   `DELEGATION_REVOKED`. One record says who tore it up, when, and why.
2. admin_100, org_456's tenant administrator, can tear up any slip of org_456. Every other person
   may ask, and can tear up only a slip that person signed: cfo_100 can tear up del_150, never del_100. The
   agent cannot ask, an application cannot, and nobody in org_789 can.
3. A proposal under the slip that waits in PENDING_APPROVAL or APPROVED moves to CANCELLED, with
   a record of the move, and its reservation is released. Approvals arrive in step 29, so the
   tests move proposals there by hand, along the picture.
4. A prepared draft, waiting in READY, stays READY with its reservation.
5. A draft already inside its transaction runs to a recorded outcome.
6. The tear-up, the cancellations, the releases, and the records commit together, or none of
   them does.
7. A refused tear-up is a "no" before any work. Its proposal ends DENIED, its record says DENY,
   and a dry run hears what the real call hears.
8. A person who may not tear up a slip hears one answer, whether the slip is there, is not
   there, or is torn up already.

### What each rule says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-DEL-04a | **C1.** The slip's delegator can tear it up | Unit and database: user_123 tears up del_100, and del_190 on the database. cfo_100 tears up del_150, which cfo_100 signed |
| DSOR-DEL-04a | **C2.** A tenant administrator can tear up any slip of the company | Unit: admin_100 tears up del_100, which user_123 signed |
| DSOR-DEL-04a | **C3.** Nobody else can. Line ⑨ refuses a person who did not sign the slip: the CFO, another supervisor, a tenant administrator of org_789 only. Line ⑤ refuses the agent in every mode, and every caller that is not a person. Nobody in org_789 reaches org_456's slips | Unit: each refused, with the slip still active. Database: org_789, through DSoR and by hand |
| DSOR-DEL-04b | **C4.** The next call after the tear-up commits is refused, a read too | Unit and database |
| DSOR-DEL-04c | **C5.** Every PENDING_APPROVAL or APPROVED proposal under the slip moves to CANCELLED, each move with its record by the person who tore up the slip, and no other slip's proposal moves | Unit and database, with proposals moved there by hand |
| DSOR-DEL-06d | **C6.** Each cancelled proposal's reservation is released. A proposal that moved on before its move keeps its reservation | Unit and database |
| §13.3 | **C7.** A draft already inside its transaction when the slip is torn up runs to a recorded outcome | Database: the draft waits on the day's total while the tear-up commits |
| (decision L4) | **C8.** A READY proposal stays READY, with its reservation | Unit and database |
| DSOR-AUD-01 | **C9.** The tear-up is a command: a key, a proposal, and a decision record. Its change leaves one `delegation_change` record, with the person, the reason, and the call | Unit and database |
| (decisions D5, D6) | **C10.** No slip comes back to active. `dsor_runtime` changes a slip's status only. A slip torn up already, or past its date, gives `CONFLICT`. An accident rolls everything back. DSoR's own WHERE keeps each of the tear-up's statements in its company | Database: hand-written SQL as `dsor_runtime`, a tear-up that has an accident, and the owner, whom no policy stops |
| DSOR-EXE-02, DSOR-OPR-05 | **C11.** A refused tear-up is a "no" before any work: its proposal ends DENIED, the record says DENY, and a dry run and a prepared call hear the real call's answer | Unit and database |
| DSOR-ERR-01b | **C12.** A person who may not tear up a slip hears one answer for a slip that is there, one that is not, and one torn up already | Unit |

### Decisions the specification leaves to us

Each one is Claude Code's, taken because the learner asked for the build before answering, and
each is for the learner to review. L1 to L5 were the design's five questions. D1 to D15 came up
while designing and building. The code names them the same way, such as "(step 25's README,
decision D7)".

**The design's five questions**

- **L1. Two steps, not one (Claude Code).** Tearing up a slip and pulling the brake have one goal,
  and two mechanisms: line ③ and the slips here, a new line ④ and a race there. One new idea for
  each step. *Downside:* one more folder, and Part 3 of the map ends at 25b.
- **L2. A tenant administrator is this tutorial's own role, `tenant_admin`, held by a new person,
  admin_100 (Claude Code).** The specification names a tenant administrator in DSOR-DEL-04a, and
  defines no role or permission for one (open question 100). *Downside:* a new name in the story.
- **L3. Every role grants `delegation:revoke` (Claude Code, changed by the review).** Line ⑤ asks
  every caller for the contract's permission. At first only `ap_supervisor` and `tenant_admin`
  held it. Then cfo_100 could not tear up del_150, a slip cfo_100 signed, and DSOR-DEL-04a held only
  because every signer in the story was a supervisor. Now every person may ask, and line ⑨
  decides whose slip it is (D3). A test reads the shipped `roles.json`, and fails when a role is
  without it. *Downside:* the permission no longer says who may tear up which slip. Line ⑨ says
  that.
- **L4. A READY proposal stays READY (Claude Code).** DSOR-DEL-04c names PENDING_APPROVAL and
  APPROVED, the two states the picture lets move to CANCELLED. A prepared draft waits in READY,
  and the picture draws no move from READY to CANCELLED. It can never run, because step 31's
  release checks the slip again. *Downside:* it waits forever, and holds 31,400.00 USD of a slip
  that can spend nothing (open question 90).
- **L5. The expiry half of DSOR-DEL-04c waits for step 29 (Claude Code).** The rule cancels waiting
  work "on revocation or expiry". A slip expires at its date, when nobody acts, so something must
  notice the date. Line ③ already refuses an expired slip, and nothing waits for an approval
  before step 29. *Downside:* DSOR-DEL-04c is met only in part until then.

**Found while designing and building**

- **D1. The tear-up is a command through the checklist (Claude Code).** `delegation.revoke {
  slip, reason }` has a key, a proposal, and a decision record, like any other command. An
  owner's tool would check no permission and leave no record. *Downside:* a person needs a login
  to tear up a slip.
- **D2. DSoR's own work (Claude Code).** Most commands run the company's code, on the company's
  tables. The tear-up changes DSoR's own store. Its work is a second kind of code,
  `src/revocation.ts`, kept in a map of its own, and start-up checks both kinds. It works with
  DSoR's own stores, inside the claim's transaction. The company's code never gets them.
  *Downside:* the registry keeps two kinds of code apart.
- **D3. The signer or a tenant administrator, and one answer for everyone else (Claude Code,
  changed by the review).** Line ⑨ looks at the slip. A person who did not sign it, and is not a
  tenant administrator, hears `AUTHORIZATION_DENIED`: `user_124 may not tear up slip "del_100":
  only its signer or a tenant administrator may`. They hear the same words for a slip that is not
  there, and for one torn up already, so a refusal tells them nothing about the company's slips
  (DSOR-ERR-01b). A tenant administrator may tear up any slip, so they hear `RESOURCE_NOT_FOUND`
  for a slip that is not there. Only the roles of the call's own company count. *Downside:* a
  person who mistypes the id of their own slip hears "may not", not "no such slip".
- **D4. People only, at line ⑤, means a person (Claude Code, changed by the review).** The
  contract says `people_only`, under this tutorial's own name. Line ⑤ then refuses every caller
  whose type is not `human`: an agent, whatever its slip lists, an application, a system, and a
  type that DSoR does not know. At first it refused agents only, and an application that held
  `tenant_admin` tore up del_100. *Downside:* a contract field that the specification does not
  have.
- **D5. Migration 018 replaces step 19b's policy (Claude Code).** Step 19b let `dsor_runtime` move
  a slip from active to suspended only. The tear-up runs as `dsor_runtime` too. So the policy
  `slip_moves` lets a slip move from active or suspended, to suspended or revoked, and nowhere
  else. Nothing comes back to active. *Downside:* the database no longer tells a suspension from a
  tear-up. A bug in the runtime could tear up a slip, where step 19b's database refused it. Both
  stop a slip, and neither can bring one back.
- **D6. The slip's row changes its status only (Claude Code).** Who tore it up, when, and why go
  in one `delegation_change` record, as step 19b's suspension records its own. The change and its
  record are one step, and its statement checks the slip again: still active or suspended, and
  not past its date. *Downside:* to see who tore up a slip, one reads the log, not the slip.
- **D7. Two parts: a check at line ⑨, and a change after line ⑩ (Claude Code, changed by the
  review).** The check looks at the slip and changes nothing. It runs at line ⑨, beside step 24's
  read, inside the claim, and in a dry run too. Its refusal is a "no" before any work, as line
  ⑩'s is: the proposal ends DENIED, and the record says DENY. The change tears up the slip and
  cancels its waiting work, after line ⑩, inside the claim's transaction. At first the check ran
  inside the work, after DSoR had said yes. A refusal was then recorded as ALLOW, its proposal
  went through EXECUTING to FAILED, and a dry run said VALIDATED where the real call refused
  (break B4). *Downside:* the slip is read twice, by the check and by the change's own statement
  (D6).
- **D8. The concurrency strategy is `none` (Claude Code).** The tear-up moves a slip one way only,
  to a final state, and its own statement checks the status. So it asks for no version.
  *Downside:* `none` is open question 86 in its own right.
- **D9. The program tears up a copy of del_100, in memory, and the tests tear up del_190 (Claude
  Code).** A torn-up slip never comes back, and the program runs many times. *Downside:* the
  shared database never shows a torn-up del_100.
- **D10. The cross-tenant suite's example names del_190 (Claude Code).** The suite makes a real
  call with each example, and walks the operations in name order, `delegation.revoke` first. With
  del_100 in the example, it tore up the agent's slip, and every later attack by the agent was
  refused for the wrong reason. *Downside:* the example names the slip of an agent that only the
  tests know.
- **D11. The input names the slip in a field called `slip` (Claude Code, found while
  building).** Line ③ reads a field called `delegation` as the authority the call claims, and
  refuses one that is not the caller's (DSOR-SRC-02b). A person calls under no slip, so a tear-up
  with a `delegation` field was refused at line ③. The tear-up names its *target*, as
  `payment.cancel` names its payment. The review agreed, and asked for the question to be kept:
  read word by word, DSOR-SRC-02b refuses every tear-up (open question 101). *Downside:* the
  specification does not say whether DSOR-SRC-02b covers an operation's target.
- **D12. The tear-up is `atomic` (Claude Code, found while building).** A torn-up slip never
  comes back, so `non_compensatable` fits too. But the contract schema then asks for an approval
  permission and in-flight exclusivity, which arrive in steps 29 and 32. The tear-up is one
  transaction in DSoR's own store, and claims no undo, so `atomic` is true of it as well.
  *Downside:* the label does not say that the tear-up is final.
- **D13. The answer is the slip, and a count (Claude Code, changed by the review).** `{
  tenant_id, id, status, cancelled }`, a row of kind `Delegation`, so the decision record names
  the slip's URI. `cancelled` says how many proposals the tear-up cancelled, and each of them has
  a record that names it. At first the answer listed every cancelled proposal. The answer's size
  limit, 64 KB, is checked after the claim has committed. So with 900 waiting proposals, a tear-up
  that had happened answered with an error. *Downside:* to see which proposals, one reads the
  records.
- **D14. A waiting proposal that moved on is left alone (Claude Code).** The tear-up moves a
  waiting proposal to CANCELLED only from the state it was listed in. A move that finds it moved
  on changes nothing: its reservation stays, and it is not counted. Nothing moves a waiting
  proposal yet. *Downside:* in step 29 an approval in the moment between the list and the move
  could leave an APPROVED proposal under a torn-up slip, which DSOR-DEL-04c forbids. Step 29 must
  keep the two apart.
- **D15. The person moves the cancelled proposals (Claude Code, changed by the review).** Each
  cancelled proposal's record names the person who tore up the slip, in `direct` mode, with their
  login as its source. At first the records named `dsor`, with a login that DSoR does not have,
  and the person appeared only in the cause's words. *Downside:* the record does not say that
  DSoR, not the person, chose which proposals moved.

### The tests, by claim

| Claims | Where |
| --- | --- |
| C1 to C6, C8, C9, C11, C12 | [`test/revocation.test.ts`](test/revocation.test.ts) |
| C1, C3 to C11 | [`test/revocation.db.test.ts`](test/revocation.db.test.ts) |
| C10 | Also [`test/suspended-slips.db.test.ts`](test/suspended-slips.db.test.ts) and [`test/rls.db.test.ts`](test/rls.db.test.ts): step 19b's policy tests, changed to migration 018's rule |

### Breaks we will try, and what we expect

| Break | What we expect |
| --- | --- |
| B1. Who is never checked | A supervisor who did not sign del_100 tears it up, and the agent is refused |
| B2. The tear-up forgets the reservation | A CANCELLED proposal still holds 31,400.00 USD of the day |
| B3. The tear-up writes outside the claim's transaction | An accident after the work leaves the slip torn up, while user_123 heard `INTERNAL_ERROR` |
| B4. The check runs inside the work, after DSoR said yes (added after the review) | A dry run says VALIDATED where the real call refuses, and the refusal's record says ALLOW |

The learner's predictions for these come in the understanding session.

### Left open, and not this step's idea

- The emergency brake: step 25b.
- The expiry half of DSOR-DEL-04c (decision L5).
- A READY proposal under a torn-up slip (decision L4, open question 90).
- Two races that step 29 opens, when approvals arrive. A draft that read the slip at line ③
  before the tear-up could reach PENDING_APPROVAL after the tear-up listed its waiting work, and
  never be cancelled. Step 29 must read the slip again inside the claim, `FOR SHARE`, before
  READY or PENDING_APPROVAL. And an approval could move a proposal between the tear-up's list and
  its move (decision D14).
- A new slip for the same agent. Step 18's decision 7 keeps one slip for each agent and company,
  whatever its status, so a torn-up slip's row blocks a new one. Nobody signs a slip through DSoR
  yet.
- Subdelegation (DSOR-DEL-05a to 05d), and `proposal.cancel` (§26.1).

## Before you build: set up a database

As in step 24: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 018 runs.

## What changed since step 24

| File | What changed |
| --- | --- |
| `contracts/delegation.revoke.json`, `inputs/DelegationRevokeRequest.schema.json`, `examples/delegation.revoke.json` | **New.** The tear-up's contract, its input, and the cross-tenant suite's example |
| `src/revocation.ts` | **New.** DSoR's own work, and the tear-up: the check at line ⑨, then the change and the cancelled work |
| `migrations/018_revocation.sql` | **New.** The policy `slip_moves` in place of `suspend_only` |
| `src/registry.ts`, `src/pipeline.ts` | DSoR's own work in a map of its own, checked at start-up. Its check at line ⑨, in the claim and in a dry run, and its change after line ⑩, with DSoR's stores |
| `src/permissions.ts` | Line ⑤ refuses every caller that is not a person, for a contract that says `people_only` |
| `src/slips.ts`, `src/postgres.ts` | The slips store finds a slip by its id and tears it up, with its record, inside the claim. The database's waiting proposals |
| `src/proposals.ts`, `src/claims.ts`, `src/log.ts` | The proposals that wait under a slip. The claim's stores hold the slips. The record of a tear-up |
| `roles.json`, `classifications.json`, `src/principals.ts` | `delegation:revoke` for every role, `tenant_admin`, and admin_100. The answer's kind |
| `src/main.ts` | The tear-up, told in memory |
| `test/revocation.test.ts`, `test/revocation.db.test.ts` | **New.** The claims C1 to C12 |
| `test/cross-tenant.ts`, `test/owner-slips.ts`, `test/owner-limits.ts` | The suite asks line ⑤'s people-only question. The owner tears up the tests' own slip, and runs the tear-up's three statements with no policy behind them |
| The other tests | The new command in the lists written out in full, the cross-tenant suite's 63 attacks, and step 19b's policy tests changed to migration 018's rule |

```bash
git diff --no-index ../mj_24_limits_with_reservations/src src
git diff --no-index ../mj_24_limits_with_reservations/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-09, shortened. After the day's limit, the program tells the tear-up
in memory:

```text
tearing up the slip, in memory, because a torn-up slip never comes back:
  03:00, the agent prepares a draft: READY
  03:10, the CFO tries to tear up del_100: AUTHORIZATION_DENIED: "delegation.revoke": cfo_100 may not tear up slip "del_100": only its signer or a tenant administrator may
  03:10, user_123 tears up del_100: answered, del_100
  03:11, the agent drafts again: DELEGATION_REVOKED: "payment.create": slip del_100 was torn up
  the prepared draft: READY, and nothing can end it yet
```

## Break it

Each break ran in a copy of this step outside the repository, on 2026-10-09, after the review's
fixes: B1, B2, and B4 in memory, B3 on a local PostgreSQL 17 database of its own. Each scenario
ran first on the step's code as it is ("built"), then once with the break. The output is copied
as it was printed.

**B1. Who is never checked.** In the copy's `src/revocation.ts`, the check of who is asking
became `if (false) {`. user_124, a supervisor of org_456 who did not sign del_100, tears it up:

```text
=== built
user_124, a supervisor who did not sign del_100, tears it up: AUTHORIZATION_DENIED: "delegation.revoke": user_124 may not tear up slip "del_100": only its signer or a tenant administrator may
del_100 is now: active
the agent drafts next: COMMITTED
=== B1, who is never checked
user_124, a supervisor who did not sign del_100, tears it up: COMMITTED
del_100 is now: revoked
the agent drafts next: DELEGATION_REVOKED: "payment.create": slip del_100 was torn up
```

Line ⑤ let user_124 through, because every role may ask (decision L3). Only line ⑨ knows whose
slip it is (decision D3).

**B2. The tear-up forgets the reservation.** In the copy's `src/revocation.ts`, the line that
releases a cancelled proposal's reservation was deleted:

```text
=== built
before the tear-up: a proposal waits in PENDING_APPROVAL, and the day holds 31400.00 USD
after it: the proposal is CANCELLED, its reservation released, and the day holds 0.00 USD
=== B2, the tear-up forgets the reservation
before the tear-up: a proposal waits in PENDING_APPROVAL, and the day holds 31400.00 USD
after it: the proposal is CANCELLED, its reservation held, and the day holds 31400.00 USD
```

The proposal can never run, and its 31,400.00 USD stays counted against the day (DSOR-DEL-06d).

**B3. The tear-up writes outside the claim's transaction.** In the copy's `src/pipeline.ts`, the
tear-up's change got the registry's own slips store, which works in a transaction of its own, in
place of the claim's. Then the connection drops right after the work, and user_123 sends the same
request again, with the same key:

```text
=== built
user_123 tears up del_190, and the connection drops after the work: INTERNAL_ERROR: DSoR hit an unexpected error
del_190 is now: active
records of a tear-up made by that call: 0
user_123 sends the same request again, with the same key: COMMITTED
=== B3, the tear-up writes outside the claim's transaction
user_123 tears up del_190, and the connection drops after the work: INTERNAL_ERROR: DSoR hit an unexpected error
del_190 is now: revoked
records of a tear-up made by that call: 1
user_123 sends the same request again, with the same key: CONFLICT: slip del_190 is torn up already
```

user_123 heard that the call failed. The slip was torn up anyway, a record names a call whose own
decision says `INTERNAL_ERROR`, and the retry hears that the slip is torn up already. One
transaction for the claim, the change, and the records is the design (decision D2).

**B4. The check runs inside the work, after DSoR said yes.** In the copy's `src/pipeline.ts`, line
⑨ no longer runs the check. The work runs it first, as the step did before the review. user_124
asks for a dry run of tearing up del_100, then makes the real call:

```text
=== built
user_124 asks for a dry run of tearing up del_100: AUTHORIZATION_DENIED: "delegation.revoke": user_124 may not tear up slip "del_100": only its signer or a tenant administrator may
then the real call: AUTHORIZATION_DENIED: "delegation.revoke": user_124 may not tear up slip "del_100": only its signer or a tenant administrator may
its decision record: DENY, AUTHORIZATION_DENIED
its proposal moved: PROPOSED → DENIED
=== B4, the check runs inside the work
user_124 asks for a dry run of tearing up del_100: VALIDATED
then the real call: AUTHORIZATION_DENIED: "delegation.revoke": user_124 may not tear up slip "del_100": only its signer or a tenant administrator may
its decision record: ALLOW, AUTHORIZATION_DENIED
its proposal moved: PROPOSED → READY → EXECUTING → FAILED
```

The dry run promised what the real call refused. The record says ALLOW, so a person who looks for
the refusals in the log, by DENY, never sees this one. And the proposal's history says that the
work started (decision D7).

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Design | Every choice written open, before any session, at the learner's request |
| 2 | Decide | The learner asked for the build at once, so Claude Code took each recommendation |
| 3 | Red | `test/revocation.test.ts` and `test/revocation.db.test.ts` first, with a stub of `src/revocation.ts` so the tests load |
| 4 | Green | The contract, line ⑤'s people only, the slips' `get` and `revoke`, the waiting proposals, DSoR's own work, and migration 018 |
| 5 | The old tests | The new command in the lists written out in full, the suite's example, and step 19b's policy tests |
| 6 | The program | The tear-up, told in memory |
| 7 | Break it | B1 to B3 in a copy outside the repository |
| 8 | Review | A sweep of small breaks, and a reviewer who had not seen the conversation |
| 9 | Fix | The review's findings: red tests first, then the code, then a sweep of the fixes, and the breaks again with B4. All under "Think it through" |

To start it in a new session:

```text
Build step 25 in learner mode from the design in
docs/baby_steps_tutorials/mj_25_revocation/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Red | All 23 new unit tests. Most heard `no operation named "delegation.revoke"`, and line ⑤ let an agent through |
| Green, the first run | The contract schema refused `non_compensatable` without an approval permission (decision D12). Then line ③ refused the field `delegation` (decision D11). Then masking refused the plain list (decision D13) |
| The type check | 13 places in 5 test files that built a slips store or a registry by hand |
| The old unit tests | 95 tests in 12 files. 58 of them had one cause: the cross-tenant suite needed an example for the new command |
| The old database tests | 8 tests in 4 files: the suite's counts (3), the program's list of operations (1), the policy written out in full (1), and step 19b's three tests of the old policy (3) |
| Red, the review's fixes | 15 of the 35 unit tests. The answer was a list. A refused call was recorded ALLOW, and a dry run said VALIDATED. The CFO was refused at line ⑤, and an application passed people only. The refusals had the old words |
| The old tests, after the fixes | 14 unit tests in 4 files, and 2 database tests. The suite's 60 attacks became 63 (10 unit, 2 database). The CFO's permissions (3), and the labels written out in full (1) |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. user_123 tears up del_100 at 10:00. At 10:01 the agent reads INV-1008. What does it hear?
2. cfo_100 tries to tear up del_100. Which line refuses, and is there a proposal?
3. user_124, a supervisor of org_456, asks for a dry run of tearing up del_999, a slip that nobody
   has. What does user_124 hear? And admin_100?
4. The agent's prepared draft waits in READY, holding 31,400.00 USD, when del_100 is torn up.
   What happens to the draft, and to the 31,400.00 USD?
5. The connection drops right after the tear-up's work. What does user_123 hear, and is del_100
   torn up?

<details>
<summary>Answers</summary>

1. `DELEGATION_REVOKED`, at line ③. A read is refused too: the agent may do nothing under a
   torn-up slip (DSOR-DEL-04b).
2. Line ⑨. Line ⑤ lets cfo_100 ask, because every role may (decision L3). Line ⑧ makes a proposal
   first. Then line ⑨ finds that cfo_100 did not sign del_100 and is not a tenant administrator. The
   proposal ends DENIED, and the record says DENY (decision D7).
3. user_124 hears `AUTHORIZATION_DENIED`: user_124 may not tear up slip "del_999". These are the
   words user_124 hears for del_100 too, so the refusal tells nothing about which slips exist
   (DSOR-ERR-01b, decision D3). admin_100 may tear up any slip, so admin_100 hears
   `RESOURCE_NOT_FOUND`.
4. Nothing. The draft stays READY, and its reservation stays held: the picture draws no move from
   READY to CANCELLED. It can never run, because step 31's release checks the slip again
   (decision L4).
5. `INTERNAL_ERROR`, and del_100 is not torn up: the change, the records, and the claim rolled
   back together. The same request with the same key runs again (decision D2, break B3).

</details>

## Think it through

### The sweep of small breaks

A sweep makes one small break at a time in a copy of the step, and runs the tests. A break that
leaves every test green shows a rule that no test holds.

The first sweep, before the review, made 35 breaks:

- 26 were killed by the tests meant for them.
- 8 survived. Each was a check that no test reached by itself: the memory store's own status,
  date, and company checks (S1, S2, S4), the database statement's status and date (D1, D2), the
  waiting work of every slip cancelled on the database (D5), a change that touched nothing (R6),
  and the answer's order (R10). R10 changed nothing, so the second sort it broke was removed.
- 1 was killed by accident. K3's run failed in a test that timed out under load, not in a test
  of K3.

Each survivor got a test, and so did K3. The second sweep killed all of them, and two new breaks
of the waiting list's order. Then the review made the answer a count (decision D13), so the order
stopped mattering, and its two tests were removed with it.

### Two mistakes in the sweep

- **Two sweeps ran at once, on one database.** The command that stopped the first sweep looked
  for the wrong words, and missed it. Each sweep then reset the database under the other, and the
  second sweep's first run, with no break at all, failed. A sweep must start green. Now only one
  sweep runs at a time, and the check is `pgrep -f "node sweep.mjs"`.
- **A wait on the server's locks.** Two tests waited for a call to reach line ⑩ by reading the
  list of locks that the whole server holds. Other databases on the same server hold locks too,
  so the wait sometimes ended early. The tests now wait for the call's own line ⑩, through the
  callback that `call` gives each line as it starts.

### The hostile review

| Finding | What it found | What changed |
| --- | --- | --- |
| M1, medium | The check of who is asking ran inside the work, after DSoR had said yes. A refusal was recorded ALLOW, and its proposal went through EXECUTING to FAILED. A dry run said VALIDATED where the real call refused. A refusal told a slip that is not yours apart from a slip that is not there | The check moved to line ⑨ (decision D7). Everyone but a tenant administrator hears one answer (decision D3). Claims C11 and C12, and break B4 |
| M2, medium | "Revocable by its delegator" held only because every signer was a supervisor. cfo_100 could not tear up del_150, which cfo_100 signed | Every role may ask, and line ⑨ decides (decision L3). A test reads the shipped role table |
| L1 | People only refused agents only. An application that held `tenant_admin` tore up del_100 | Line ⑤ refuses every caller that is not a person (decision D4) |
| L2 | The answer listed every cancelled proposal. With 900 of them, a tear-up that had committed answered with an error, because the size limit is checked after the claim | The answer counts them (decision D13) |
| L3 | A draft that waits at line ⑩ when the tear-up commits moves to READY and EXECUTING after it. That fits §44's 60 seconds. But the test's comment quoted §13.3's sentence about a command already EXECUTING, which does not describe it | The comment is right now. Step 29's race is under "Left open" |
| L4 | The record of each cancel named `dsor`, with a login that DSoR does not have | The person who tore up the slip moves them (decision D15) |
| L5 | Read word by word, DSOR-SRC-02b refuses every tear-up | Open question 101 (decision D11) |

The review's own sweep found eight breaks that left every test green. Each has a test now:

- U6 and U7: a move that changed nothing still released the reservation, and was counted.
- U13: people only was tested in one mode only.
- U17: a tenant administrator of another company only.
- U26: a caller type that DSoR does not know.
- B2, B6, and B9: each of the tear-up's three statements, with the company gone from its WHERE.
  Row-level security still held, so no test saw it. The owner, whom no policy stops, now runs the
  three statements beside a slip of org_789 and a proposal that waits under it.

One stays as it is. U15 took the company out of the memory store's waiting list. A move is keyed
by company, so another company's proposal never moves, and now it is never counted.

### The sweep of the fixes

18 breaks, each of which undoes one fix, or breaks a line that only a new test guards:

- 16 were killed by the tests meant for them.
- F12 survived. With the slip's state told before the check of who is asking, user_124 heard
  that a slip user_124 may not touch was torn up already. A test now holds it, and F12 is killed.
- F18 made the claim's check read the slips outside the claim. The in-flight test caught it, by
  a timeout. The extra read waits for a third connection from a pool of two, while the draft's
  claim and the tear-up's claim hold both. So the check reads through the claim's own stores. A
  dry run has no claim, and reads through the registry's.

### Left open on purpose

The list under "Left open, and not this step's idea" above, and one older gap: the records still
do not pass `audit-record.schema.json`, from before this step. Step 25b starts from there.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-DEL-04a | A delegation is revocable by its delegator and by a tenant administrator | [§13.3 Revocation and subdelegation](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation) | Unit tests in [`test/revocation.test.ts`](test/revocation.test.ts): two delegators, a tenant administrator, and every caller refused. Database tests in [`test/revocation.db.test.ts`](test/revocation.db.test.ts) |
| DSOR-DEL-04b | Revocation takes effect for new decisions within the bound of §44 | [§13.3 Revocation and subdelegation](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation) | At L3's bound, the next command: line ③ reads the slip from the store at every call. Unit and database: the next draft and the next read are refused |
| DSOR-DEL-04c | On revocation or expiry, every PENDING_APPROVAL or APPROVED proposal under the delegation moves to CANCELLED | [§13.3 Revocation and subdelegation](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation) | Partly: revocation. Unit and database, with proposals moved there by hand. Expiry waits for step 29 (decision L5) |

## Next

Step 25b · The emergency brake. A person suspends one agent, or freezes every agent in the
company, inside DSoR. Line ④ refuses the agent's next command, and a draft already on its way
cannot slip past the brake (DSOR-OPS-01a to DSOR-OPS-01d).
