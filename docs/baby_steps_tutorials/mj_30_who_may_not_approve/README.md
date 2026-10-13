# Step 30 · Who may not approve

**New in this step:** nobody in a proposal's requesting chain may approve it: not the person who
asked, and not the person who signed the slip of the agent that asked.

## In plain words

Step 29 let a person approve a waiting payment. This step says who may not. The idea is old: split
one payment between two people, so that neither can finish it alone. One person asks for it, and
another person approves it.

Think of the new clerk again. The clerk fills in a payment form, and someone else must sign it. Not
the clerk, and not the supervisor whose permission slip the clerk carries: the clerk acts for that
supervisor. If the supervisor fills in a form themselves, someone else signs that one too. In DSoR
the clerk is the agent, and the supervisor is the person who signed its slip.

Two more rules come with the idea. When one rule asks for two approvers, they must be two different
people. And an agent never approves, as step 29 already holds.

## Why it matters

This step gives org_456 a new rule: above 10,000 USD, an AP supervisor approves. user_123 is
org_456's only AP supervisor, and user_123 signed `del_100`, the permission slip of
`accounts-payable-fte`. The agent drafts INV-1012, 22,750.00 USD. That is below the CFO's line,
25,000 USD, so only the new rule asks: the payment waits for an AP supervisor.

If user_123 could approve it, nobody else would ever look. user_123 could have the agent pay a
vendor that user_123 controls, and then approve the payment. The agent asked, but it asked for
user_123: one person would both ask and approve. Keeping those two jobs apart is, in §16's words,
the oldest control in accounting: "Most internal fraud needs one person to both request and
approve." The specification's own example is this one: user_123 cannot approve a payment that
`accounts-payable-fte` requested under `del_100`.

## The design, before any code

The circled numbers are lines of DSoR's checklist, as in step 29. Line ⑤ checks the caller's
permission, line ⑧ makes the proposal, and line ⑨ is DSoR's own look before any work.

### How this step was made

The learner chose to build first and review afterwards, as for steps 27 to 29. On 2026-10-13 they
asked for step 30 to be built the same way, and to review steps 28, 28b, 29, and 30 together after.
So every decision below is Claude Code's, for the learner to review, and each one says what it
costs. This folder is a copy of step 29.

### What each rule says

- **DSOR-SOD-01a:** "A principal of type `agent` MUST NOT act as an approver"
  ([§16.1](../../../specs/dsor/02-security.md#161-rules)).
- **DSOR-SOD-02:** "Outside owner-approval mode (§16.2), an approver MUST NOT appear in the
  requesting chain of the proposal: not the subject, not the delegator of any acting agent, not
  any actor" ([§16.1](../../../specs/dsor/02-security.md#161-rules)). The *requesting chain* is
  everyone the request came from:
  - the *subject*: the person the request is for;
  - the *delegator of an acting agent*: the person who signed that agent's slip;
  - an *actor*: an agent that acted in the request.

  *Owner-approval mode* is §16.2's exception for a one-person business, which has nobody else to
  approve. This step does not build it (D9).
- **DSOR-SOD-04c:** "Where a control requires a quorum, the approvals MUST come from distinct
  principals" ([§16.1](../../../specs/dsor/02-security.md#161-rules)). A *quorum* is how many
  people must approve.
- **Beside them:** DSOR-SOD-01b (L3, the third level), "An approver MUST be of type `human`". §16
  counts a person together with every agent acting for them as one *effective principal*. user_123
  and `accounts-payable-fte`, which acts under `del_100`, are one effective principal.

### Decisions (Claude Code)

- **D1. The requesting chain comes from the proposal, never from the approval call.** Line ⑧
  recorded who asked, in a part of the proposal called the *requester*. It names the subject, the
  *actor chain*, which lists the agents that acted, and the slip. DSoR reads the slip's signer from
  its own store of slips. *Downside:* only one slip is read. A chain of slips, one agent handing
  work to another (sub-delegation), is not built, and would name more signers.
- **D2. Three kinds of people may not approve:** the subject, every actor in the chain, and the
  signer of the slip the proposal names. The subject is the person who asked, or, for an agent's
  call, the person who signed its slip. Step 18 records the slip's signer as an agent's subject, so
  the two are the same person in this tutorial. Only a request written by hand, in a test, makes
  them differ. DSoR compares login ids. *Downside:* one person with two logins counts as two people.
  Nothing in this tutorial links two logins to one person.
- **D3. A refusal is `SOD_VIOLATION`, at line ⑨.** It is the specification's code for segregation
  of duties. The check runs after the check of the operation's own approve permission, and before
  the check of the proposal's state. So the no comes before any work. The record says `DENY`, and
  a dry run hears the same. *Downside:* the answer tells the person why. They know it already: they
  asked, or they signed the slip.
- **D4. Checked once, at line ⑨, and not again in the store's approval step.** The *store's
  approval step* is the one place that keeps an approval, under the company's lock (step 29's D9).
  The requester never changes after line ⑧ (step 22's trigger). DSoR's login may change only a
  slip's status, never its signer (step 19b's privileges). So no other call can change the answer
  between line ⑨ and the work. *Downside:* a later step that let a slip's signer change would need
  a second look inside the store's approval step.
- **D5. AP supervisors approve.** The role `ap_supervisor` gains `proposal:approve` and
  `payment:approve`. Without them, user_123 could approve nothing, and the specification's own
  example could never happen. *Downside:* user_123 may now approve payments that a rule asks a
  supervisor for, when someone else asked for them.
- **D6. A third rule in the story.** cfo_100 writes and switches on `supervisor-above-10000`, a rule
  of org_456's own: above 10,000 USD, one AP supervisor approves. *Downside:* in the story's company,
  user_123 is the only AP supervisor and signed the agent's slip. So the agent's payments above
  10,000 USD wait until they expire. That is the price of segregation of duties in a small team.
- **D7. An agent never approves, and every approver is a person (DSOR-SOD-01a, DSOR-SOD-01b).** Step
  29 built both: line ⑤ refuses every caller who is not a person, and line ⑨ looks again. This step
  holds them with tests titled by their own ids, for every agent, and for system and application
  logins. *Downside:* this step's own code holds neither rule. A later change to step 29's guards
  would show only in these tests.
- **D8. A quorum counts distinct people (DSOR-SOD-04c).** Step 29's store counts one person once,
  and the database's unique key keeps one approval for each person and proposal. Agents never
  approve, so distinct approvers are distinct people: one effective principal each. This step holds
  it with tests titled by its id. Since this step's review, the count itself counts people too, not
  approvals (finding L5). *Downside:* a person's two logins count as two, as in D2.
- **D9. Owner-approval mode is not built.** It is the map's exercise (§16.2): the safety nets that
  let a one-person business approve its own agent's work. No company can turn it on, every approval
  keeps `sod_mode: standard`, and DSOR-SOD-02 always applies. *Downside:* a one-person business
  cannot approve its own agent's payments at all.
- **D10. A second AP supervisor lives in the tests only.** The tests plant `user_124`, as step 25's
  tests did, to show the approval that DSOR-SOD-02 allows. The program's story has no second
  supervisor. *Downside:* the program shows only refusals for the supervisor's rule. Step 29's story
  shows an allowed approval: cfo_100's, of the agent's INV-1008.

### The story's numbers

| Who | Asks | DSoR answers |
|---|---|---|
| cfo_100 | writes and switches on `supervisor-above-10000` | active |
| the agent | drafts INV-1012, 22,750.00 USD, under `del_100`, which user_123 signed | waits for an AP supervisor |
| user_123 | approves it | `SOD_VIOLATION`: user_123 signed `del_100`, the slip of the agent that asked |
| cfo_100 | approves it | `AUTHORIZATION_DENIED`: it waits for an AP supervisor, and cfo_100 is not one |
| user_123 | drafts INV-2013, 12,000.00 USD, on their own login | waits for an AP supervisor |
| user_123 | approves it | `SOD_VIOLATION`: user_123 asked for it |
| the agent | approves INV-1012 | `AUTHORIZATION_DENIED` at line ⑤: for people only |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | No one in the requesting chain approves: the person who asked, the slip's signer, or an actor (DSOR-SOD-02) |
| C2 | Someone outside the chain who holds the role approves, as in step 29 |
| C3 | A refusal is `SOD_VIOLATION` before any work: recorded `DENY`, and a dry run hears the same, on the database too |
| C4 | An agent never approves, and every approver is a person (DSOR-SOD-01a, DSOR-SOD-01b) |
| C5 | A quorum counts distinct people (DSOR-SOD-04c) |
| C6 | AP supervisors approve, and a rule may ask for one (D5) |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The slip's signer is not checked | user_123 approves the agent's INV-1012, and it is `APPROVED` | (asked at the review) |
| B2. A person's own request is not checked | user_123 approves INV-2013, which user_123 asked for, and it is `APPROVED` | (asked at the review) |
| B3. A quorum counts approvals, not people | cfo_100 approves twice, and a payment that asks for two CFOs is `APPROVED` | (asked at the review) |
| B4. Both of an agent's guards are gone | the agent approves its own payment | (asked at the review) |

### Left open, and not this step's idea

- Owner-approval mode and its safety nets (DSOR-SOD-05 to DSOR-SOD-13): the map's exercise.
- Incompatible operations on one resource (DSOR-SOD-03a and 03b, L3), and approval limits that
  cover the amount (DSOR-SOD-04a, L3).
- Resolving a role to people at approval time from the company's directory, with the basis
  recorded (DSOR-SOD-04b, L3).
- Checking segregation of duties again at execution (DSOR-APR-03a): step 31 will build it.

## What changed since step 29

| File | What changed |
| --- | --- |
| `src/segregation.ts` | **New.** `inChain`: why a person is in a proposal's requesting chain, in words, or nothing. An actor, the signer of the slip the request names, read from DSoR's store of slips, or the subject |
| `src/approve.ts` | Line ⑨ asks `inChain` after the approve permission and before the proposal's state, and refuses with `SOD_VIOLATION` |
| `src/approvals.ts` | The count of a quorum counts distinct people, not approvals (finding L5) |
| `roles.json` | `ap_supervisor` gains `proposal:approve` and `payment:approve` (D5) |
| `src/main.ts`, `src/pipeline.ts` | The story of who may not approve. A comment at line ⑩ that said segregation of duties was not built, rewritten |
| `test/who-may-not-approve.test.ts`, `test/who-may-not-approve.db.test.ts` | **New.** The claims C1 to C6 |
| `test/rule-world.ts`, `test/helpers.ts` | The supervisor rule, `supervisor-above-10000`, and the AP supervisor's two new permissions |
| The other tests | Step 29's test of user_123 now expects `SOD_VIOLATION`. A rule that asks for an approval nobody can give asks for `ap_clerk` now. The pinned lists of who may call what grow by user_123 and user_700 |

Step 29's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_29_approvals/src src
git diff --no-index ../mj_29_approvals/test test
```

## Run it

As in step 29, the step needs a local PostgreSQL 17 and a database of its own. Its `.env` is
written by a command that prints nothing. Give the step a server of its own if you can:
`pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server, so a second step
migrated on the same server changes the first step's login. This step adds no migration.
Segregation of duties reads what DSoR keeps already: who asked, which line ⑧ writes once into
`dsor.proposals` (step 22), and the slip's signer in `dsor.delegations` (step 18).

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-13. After step 29's approvals, the program tells who may not approve,
in the same world.

```text
who may not approve, in memory, in the same world:
  cfo_100 drafts supervisor-above-10000, a rule of org_456's own: version 1, draft
  cfo_100 switches it on: version 1, active
  the agent drafts INV-1012, 22,750.00 USD: PENDING_APPROVAL, needs ap_supervisor x1 (supervisor-above-10000), until 2026-10-13T15:05:00.000Z
  user_123, who signed del_100, approves it: SOD_VIOLATION: user_123 may not approve proposal prop_4d084c09-18a3-437b-abba-ec265da7be77: user_123 signed slip del_100, which the agent that asked works under
  cfo_100 approves it: AUTHORIZATION_DENIED: cfo_100 holds none of the roles proposal prop_4d084c09-18a3-437b-abba-ec265da7be77 waits for: ap_supervisor
  user_123 drafts INV-2013, 12,000.00 USD, on their own login: PENDING_APPROVAL, needs ap_supervisor x1 (supervisor-above-10000), until 2026-10-13T15:05:00.000Z
  user_123 approves it: SOD_VIOLATION: user_123 may not approve proposal prop_e6d8f8d9-fe07-4069-8c61-6226dc8cbcbe: user_123 asked for it
  the agent approves INV-1012: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and accounts-payable-fte is not a person
  INV-1012's proposal: PENDING_APPROVAL, INV-2013's: PENDING_APPROVAL; org_456 has no AP supervisor outside their chains
```

user_123 hears `SOD_VIOLATION` twice, for two reasons. They signed the slip of the agent that asked
for INV-1012. And they asked for INV-2013 themselves. cfo_100 is outside both chains. But the rule
asks for an AP supervisor, and cfo_100 is not one. The agent never approves.

The company has one AP supervisor, so both payments wait until they expire: decision D6's downside,
in a real run. The last line reads both states from DSoR's store. The program's world keeps the
story's own clock, Tuesday 2026-10-06 at 15:05 UTC, so each payment's time comes a week later.

## Break it

Each break ran on 2026-10-13, in a copy of the step outside the repository. The copy was restored
after each run. A short script told the story against the copy's own code, in memory, in two
worlds.

In the first world, two rules are on: the CFO's above 25,000 USD, and the AP supervisor's above
10,000 USD. The agent drafts INV-1012, and user_123 approves it. user_123 drafts INV-2013, and
approves it. The agent drafts INV-1008. Then two agents try to approve it, each under a slip that
lists both approval permissions: the agent itself, and `firm-ap-fte`, an agent of the story that
works for both companies.

In the second world, the only rule asks for two CFOs above 25,000 USD. The agent drafts INV-1008,
and cfo_100 approves it twice.

Unbroken, the lines that the breaks changed read:

```text
user_123, who signed del_100, approves INV-1012: SOD_VIOLATION: user_123 may not approve proposal prop_…: user_123 signed slip del_100, which the agent that asked works under
user_123 approves INV-2013: SOD_VIOLATION: user_123 may not approve proposal prop_…: user_123 asked for it
the agent, whose del_100 lists both approval permissions, approves its own INV-1008: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and accounts-payable-fte is not a person
firm-ap-fte, under a slip cfo_100 signed listing both, approves INV-1008: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and firm-ap-fte is not a person
cfo_100 approves it again: CONFLICT: cfo_100 approved proposal prop_… already
INV-1008's proposal, by two CFOs: PENDING_APPROVAL, approved by cfo_100
```

The proposal ids are shortened to `prop_…` here: each run makes new ones. The copy had no `.env`
file of any kind, so one test that reads `.env.example` failed in every run of the copy, unbroken
too. The counts below leave it out. They are from the final code, after the review's fixes.

**B1. The slip's signer is not checked.** In `src/segregation.ts`, the comparison with the slip's
signer became `false`:

```text
user_123, who signed del_100, approves INV-1012: SOD_VIOLATION: user_123 may not approve proposal prop_…: the request is user_123's, through slip del_100
```

The design expected `APPROVED`. The next check stopped it, as the design's own D2 says it must: for
an agent's call, DSoR records the slip's signer as the request's subject, and the subject may not
approve either. Only the words changed. Five tests failed. Four read the words. One plants a request
whose subject is not the slip's signer, where the subject check cannot help.

**B2. A person's own request is not checked.** In `src/segregation.ts`, the check of the subject
was gone:

```text
user_123 approves INV-2013: APPROVED
INV-2013's proposal: APPROVED, approved by user_123
```

As the design expected. user_123 asked for INV-2013 and approved it: one person did both, the
failure §16 names. Two tests failed.

**B3. A quorum counts approvals, not people.** In `src/approve.ts` and `src/approvals.ts`, the check
that one person counts once, made when an approval is added, became `false`:

```text
cfo_100 approves it again: PENDING_APPROVAL, still waits for CFO
INV-1008's proposal, by two CFOs: PENDING_APPROVAL, approved by cfo_100 and cfo_100
```

The design expected `APPROVED`. The store kept a second approval by cfo_100, and the count still saw
one person. Since the review, the count itself counts people, not approvals (finding L5). Before
that fix, the same break approved the payment. Five tests failed. On the database, the same break
could not keep the second approval at all. PostgreSQL refused the row: `duplicate key value
violates unique constraint "approvals_once"`. A *unique key* is a rule of a table: no two rows may
hold the same values in its columns, here one company, one proposal, and one approver. Step 29's
migration 026 made it.

**B4. Both of an agent's guards are gone.** In `contracts/proposal.approve.json`, `people_only`
became `false`. In `src/approve.ts`, line ⑨ lost its checks of the identity mode and of the
caller's type:

```text
the agent, whose del_100 lists both approval permissions, approves its own INV-1008: AUTHORIZATION_DENIED: accounts-payable-fte may not approve payment.create@1: it needs payment:approve
firm-ap-fte, under a slip cfo_100 signed listing both, approves INV-1008: AUTHORIZATION_DENIED: firm-ap-fte may not approve payment.create@1: it needs payment:approve
```

The design expected the agent to approve its own payment. A third guard stopped both agents: line
⑨'s check of the approve permission. It asks whether the approver holds `payment:approve` through
their own roles, and an agent holds no role since step 18. What a slip lists does not count there.
DSOR-SOD-04a says an approver must "independently" hold that permission, and this tutorial reads
the word the same way. Thirteen tests failed: each expected the refusal at line ⑤, or at a guard
that was gone.

One more run took the check of the approve permission away too. Then DSOR-SOD-02 stopped the
agent's own request: `SOD_VIOLATION: accounts-payable-fte may not approve proposal prop_…:
accounts-payable-fte acted in the request`. firm-ap-fte acted in nothing. Only the check of the
roles the rule asks for stopped it: `firm-ap-fte holds none of the roles proposal prop_… waits for:
CFO, ap_supervisor`. So for an agent that did not ask, the rule that matters is DSOR-SOD-01a, with
its guards at lines ⑤ and ⑨.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The learner chose to build step 30 too, and to review steps 28, 28b, 29, and 30 together after (2026-10-13) |
| 2 | Decide | D1 to D10, each Claude Code's, each with its downside, for the learner's review |
| 3 | The copy | Step 29 copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | AP supervisors may approve, and a rule may ask for one, red first |
| 5 | Piece B | DSOR-SOD-02 at line ⑨, red first, in memory and on the database |
| 6 | Piece C | Tests titled DSOR-SOD-01a, DSOR-SOD-01b, and DSOR-SOD-04c, for what step 29 holds |
| 7 | Piece D | The program's story, red first |
| 8 | Break it | B1 to B4, in a copy, each restored; and breaks of each piece, in memory and on the database |
| 9 | Review | A reviewer who had not seen the conversation: no high finding, one medium, seven low, and 33 small breaks of its own. 4 of them *survived*: every test still passed. A second reviewer read this README as a beginner would |
| 10 | Fix | M1, L1, L2, L3, L5, and L6, and two survivors of Claude Code's own breaks, in four commits, each test red first or broken on purpose; L4 and L7 recorded; the README's words |

To start it in a new session:

```text
Build step 30 in learner mode from the design in
docs/baby_steps_tutorials/mj_30_who_may_not_approve/README.md.
```

What each move broke, measured. These were not predictions. Each piece was broken on purpose, one
small change at a time, in a copy outside the repository: the unit tests in a copy of their own,
and the database's in a copy with a PostgreSQL server of its own. When a break survives, no test
holds what it broke.

| Move | What failed |
| --- | --- |
| Piece A | 3 tests, red first: cfo_100's draft of the supervisor rule was refused, start-up refused it, and line ⑤ refused user_124. The fourth passed at once: cfo_100 is not an AP supervisor, as step 29 already says. Then 13 old tests: 12 that pin who may call what, and one that took ap_supervisor as a role nobody could approve with. Broken on purpose, 2 ways in memory and 1 on the database: the AP supervisor without each permission. Each made tests fail |
| Piece B | 6 tests in memory and 2 on the database, red first: user_123 approved the agent's INV-1012 and a payment of their own. Broken on purpose, 7 ways in memory and 2 on the database: an actor not checked, the signer taken from the subject, the check moved to the end, the wrong error code, the slip read in another company, and B1 and B2. One survived in memory, and one on the database: see "Found while building" |
| Piece C | 10 tests in memory and 2 on the database, all passing at once: step 29 built what they hold. So the breaks are what test them: B3 and B4 in memory, and B3 on the database. Each made tests fail |
| Piece D | 1 test, red first: the program printed no such story. Broken on purpose: a line of the story left out. It made the test fail |
| M1, one CFO twice at once | 2 database tests, for code that was right. Broken on purpose 3 ways on the database: no lock; no lock and no unique key `approvals_once`; and the store's own check gone. Each made the tests fail. The first version of the tests passed with no lock and no key: see "The hostile review" |
| L2, L3, and the slip in org_789 | 3 new tests and 2 changed, all passing at once. Broken on purpose 4 ways: the chain asked after the state, or before the operation's own permission, only the first actor compared, and the slip read in org_456. Each made its test fail |
| L5, the count | 1 test, red first: two approvals by cfo_100 closed a quorum of two. Broken on purpose: the count counting approvals again. It made the test fail |
| L6, the program's last line | 1 test changed, red first. Broken on purpose: the subject not checked. The line read `INV-2013's: APPROVED`, and the test failed |
| The signer on the database | 1 test, passing at once. Broken on purpose: the signer taken from the request's subject. It made the test fail |

## Check yourself

Use the story: org_456's rule `supervisor-above-10000` asks for one AP supervisor above 10,000.00
USD. user_123 is an AP supervisor, and signed `del_100`, the slip of `accounts-payable-fte`.
cfo_100 is the CFO. user_124, a second AP supervisor, lives in the tests.

1. The agent drafts INV-1012, 22,750.00 USD, and it waits for an AP supervisor. user_123 approves
   it, with the right fingerprint. What does DSoR answer, and what does the decision record say?
2. user_124 drafts INV-2007, 21,000.00 USD, on their own login. Who may approve it: user_123,
   user_124, or cfo_100? Why, for each one?
3. A rule asks for two CFOs. cfo_100 approves twice, with two idempotency keys. What happens to the
   proposal? And what if both calls arrive at the same moment?
4. `firm-ap-fte` works under a slip that cfo_100 signed, which lists `proposal:approve` and
   `payment:approve`. It calls `proposal.approve` on the agent's INV-1008. firm-ap-fte did not ask
   for INV-1008. What stops it, and where?
5. Why does DSoR read the slip's signer from its own store of slips, and never from the approval
   call?

<details>
<summary>Answers</summary>

1. `SOD_VIOLATION`: user_123 signed `del_100`, the slip of the agent that asked. The record says
   `DENY`. The no came at line ⑨, before any work, and the proposal still waits (DSOR-SOD-02, D3).
2. user_123 may: they neither asked nor signed a slip for this request, and they hold the role.
   user_124 may not: they asked for it (`SOD_VIOLATION`). cfo_100 may not: the rule asks for an
   AP supervisor (`AUTHORIZATION_DENIED`).
3. The first approval counts, and the proposal still waits for a second CFO. The second is
   refused, `CONFLICT`: cfo_100 approved it already. At the same moment, the company's lock puts
   the two calls one after the other, and the second finds the first. Four places keep one person
   from counting twice: line ⑨, the store's approval step, the count itself, and the database's
   unique key `approvals_once` (DSOR-SOD-04c).
4. Line ⑤ refuses it first: `proposal.approve` is for people only. If that flag were lost, line ⑨
   refuses it: the call is not in `direct` mode, and the caller is not a person. And beneath those,
   an agent holds no role, so it holds no approve permission of its own (DSOR-SOD-01a, B4).
   DSOR-SOD-02 does not help here: firm-ap-fte is not in the request's chain.
5. Whatever travels with the approval call is the caller's word. DSoR decides who may not approve
   from its own records: the requester, which line ⑧ wrote once, and the slip in its own store.
   DSoR's login can never change a slip's signer (D1, D4).

</details>

## Think it through

### Found while building

- **The subject check covers the signer.** For an agent's call, DSoR records the slip's signer as
  the request's subject. So break B1, the signer not checked, changed only the words. A request
  whose subject is not the signer is planted by hand in a test, to hold the signer check itself.
- **An agent meets more guards than the design named.** B4 took away both guards the design named,
  and a third held: an approver's permissions come from their own roles, and an agent holds none.
- **Two of Claude Code's own breaks survived at first.** With the slip read in org_456 whatever the
  call's company, every test passed: every test of the chain ran in org_456. A test in org_789 holds
  it now: `user_700`, org_789's AP supervisor, signed `del_102`, firm-ap-fte's slip there, and may
  not approve firm-ap-fte's payment. On the database, a signer taken from the request's subject
  passed too, since an agent's request names its signer as the subject. A request planted by hand,
  whose subject is user_124, holds it now.
- **A test that a new permission made weak.** An older test gives a person two roles, ap_supervisor
  and CFO, and checks that both count. Its CFO granted `payment:approve`, which ap_supervisor holds
  now too, so code that read only the first role passed it. Its CFO grants `rule:draft` now.
- **`src/approve.ts` was 185 lines.** The new check went into a file of its own,
  `src/segregation.ts`, so step 30's lesson is one short file.
- **Two slow tests timed out once.** With the machine busy, two start-up tests took over 5 seconds,
  vitest's limit. Both passed alone and in the next full run. Nothing in this step touched them.

### The hostile review

A reviewer who had not seen the conversation read the code at piece D. It broke the code 33 times
in a copy of its own, and attacked it with inputs of its own. It found no high finding, one medium,
and seven low. No attack let an agent, a person in the request's chain, another company, or one
person counted twice produce an approval.

- **M1, fixed with tests: no test sent two approvals at once.** The quorum's tests ran one call
  after another, and AGENTS.md asks for real parallel requests. Two database tests now send two
  approvals by cfo_100 at the same moment: one through DSoR's whole path, and one through the
  store's approval step. Their first version sent the two calls together, and passed with no lock
  and no key at all: the calls did not overlap. So each test now holds the company's lock by hand
  until both calls wait for it. Both calls pass line ⑨'s look, and only the store's approval step
  can stop the second.
- **L1, fixed:** a comment at line ⑩ said segregation of duties was not built.
- **L2, fixed with tests: the order of line ⑨ was not held.** The check could move after the
  proposal's state, or before the operation's own permission, and every test passed. Two tests hold
  decision D3's order now. And a dry run's refusal must equal the real call's, word for word.
- **L3, fixed with a test:** with one actor in the chain, a check of only the first actor passed.
  The test's chain has two actors now.
- **L4, recorded:** the design's expectation for B4 was wrong. The design's table of breaks keeps
  its expectations as they were written before the code, and "Break it" says what happened. D8
  changed after the review, and says so.
- **L5, fixed: the count counted approvals.** One person counted once only because each approval was
  checked when it was added. The count counts distinct people now, so even a store that forgot to
  check could not count one CFO twice (DSOR-SOD-04c, D8).
- **L6, fixed:** the program printed "both wait" as a fixed sentence, which a break would have left
  as it was. It prints the two proposals' states from DSoR's store now.
- **L7, recorded:** the store of slips in memory accepts two slips with one id, which the database's
  key refuses. The check reads a slip by its id. That store came from an earlier step, so the gap is
  reported there, not fixed here. Today the subject check covers it.
- **Four of its breaks survived.** Three became the tests of L2 and L3. The fourth read the slip in
  the company the request names, which is always the call's own company, so nothing differs.

A second reviewer read this README as a beginner would. It found that the first version never said
the idea plainly: split one payment between two people, so that neither can finish it alone. "In
plain words" and "Why it matters" say it now, with the new clerk and a concrete harm. It also found
undefined words, two worlds in one paragraph of "Break it", and two wrong readings of the
specification. Each is fixed: DSOR-SOD-04b is about roles, not logins, and "independently" is this
tutorial's reading of DSOR-SOD-04a.

### Left open on purpose

- **Owner-approval mode.** The safety nets that let a one-person business approve its own agent's
  work (DSOR-SOD-05 to DSOR-SOD-13). They include a fresh login with a second factor, such as a code
  from a phone, a ceiling on the value, a waiting period for a new payee, a view of the payment that
  DSoR makes, and a notice on a second channel. The map's exercise. Until then, a one-person
  business cannot approve its own agent's payments at all (D9).
- **One person, two logins.** DSoR compares login ids, so a person with two logins counts as two
  people (D2). Nothing in this tutorial links two logins to one person.
- **A chain of slips.** One slip is read. An agent that hands work to another agent
  (sub-delegation) would put more signers in the chain (D1).
- **A small team.** When every AP supervisor signed the agent's slip, nobody may approve its
  payments above 10,000 USD, and they wait until they expire (D6). DSoR could warn a company that a
  rule asks for a role that only the slip's signer holds. Nothing does yet: open question 123 in
  [`research/open-questions.md`](../../../research/open-questions.md).
- **Incompatible operations, and approval limits.** One person may not create a vendor and pay it
  (DSOR-SOD-03a and 03b, L3), and an approver's limit must cover the amount (DSOR-SOD-04a, L3).
- **Checking again at execution.** Hours may pass between the approval and the payment. Step 31
  will build `proposal.execute`, which is to check every rule again on live data (DSOR-APR-03a).
  In `propose_only` mode, a command is prepared and not run. A `proposal.approve` call in that mode
  leaves a prepared approval, which `proposal.execute` could later run. Whether line ⑨ looks again
  then, segregation of duties included, is open question 122.
- **One person, two roles.** A person who holds both roles a proposal waits for still satisfies
  both with one approval (step 29's D3, open question 120). DSOR-SOD-04c counts distinct people
  within one rule.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-SOD-01a | A principal of type `agent` never acts as an approver | [§16.1 Rules](../../../specs/dsor/02-security.md#161-rules) | Every agent of the story, in both companies, is refused at line ⑤. With `people_only` gone, it is refused at line ⑨. On the database too. [`test/who-may-not-approve.test.ts`](test/who-may-not-approve.test.ts), [`test/who-may-not-approve.db.test.ts`](test/who-may-not-approve.db.test.ts) |
| DSOR-SOD-02 | Outside owner-approval mode, an approver is not in the requesting chain: not the subject, not the delegator of an acting agent, not an actor | [§16.1 Rules](../../../specs/dsor/02-security.md#161-rules) | Each part of the chain is refused `SOD_VIOLATION` at line ⑨, before any work, in both companies. The record says `DENY`, and a dry run hears the same. On the database, the slip's signer comes from `dsor.delegations`. Owner-approval mode is not built, so the rule always applies. [`test/who-may-not-approve.test.ts`](test/who-may-not-approve.test.ts), [`test/who-may-not-approve.db.test.ts`](test/who-may-not-approve.db.test.ts), [`test/approve.test.ts`](test/approve.test.ts) |
| DSOR-SOD-01b | An approver is of type `human` (L3) | [§16.1 Rules](../../../specs/dsor/02-security.md#161-rules) | System and application logins are refused at line ⑤, and at line ⑨ when `people_only` is gone. [`test/who-may-not-approve.test.ts`](test/who-may-not-approve.test.ts) |
| DSOR-SOD-04c | Where a control requires a quorum, the approvals come from distinct principals (L3) | [§16.1 Rules](../../../specs/dsor/02-security.md#161-rules) | A rule that asks for two CFOs counts cfo_100 once: at line ⑨, in the store's approval step, in the count itself, and on the database with two calls at the same moment. [`test/who-may-not-approve.test.ts`](test/who-may-not-approve.test.ts), [`test/who-may-not-approve.db.test.ts`](test/who-may-not-approve.db.test.ts) |

**Next:** step 31 · Check again at execution. Hours pass between an approval and the payment. Step
31 will build `proposal.execute`, which is to run every check again on live data. It is to run only
the stored request: the caller cannot send a new one (DSOR-APR-03a to DSOR-APR-03c, DSOR-APR-10,
DSOR-APR-13).
