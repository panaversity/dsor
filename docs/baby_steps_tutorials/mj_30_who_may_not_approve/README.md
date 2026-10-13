# Step 30 · Who may not approve

**New in this step:** nobody in a proposal's requesting chain may approve it: not the person who
asked, not the person who signed the slip of the agent that asked, and not an agent.

## In plain words

Step 29 let a person approve a waiting payment. This step says who may not. The person who asked
for a payment may not approve it, and neither may the person who signed the permission slip of the
agent that asked: the agent acts for them. An agent never approves, and when a rule asks for two
approvers, they must be two different people.

## Why it matters

user_123 signed `del_100`, the permission slip of `accounts-payable-fte`. The agent drafts
INV-1012, 22,750.00 USD, and a rule sends it to an AP supervisor. user_123 is an AP supervisor. If
user_123 approved it, one person would both ask and approve: the agent asked for user_123. §16
calls this the oldest control in accounting: "Most internal fraud needs one person to both request
and approve." The specification's own example says it plainly: user_123 cannot approve a payment
that `accounts-payable-fte` requested under `del_100`.

## The design, before any code

The circled numbers are lines of DSoR's checklist, as in step 29. Line ⑤ checks the caller's
permission, line ⑧ makes the proposal, and line ⑨ is DSoR's own look before any work.

### How this step was made

The learner chose to build first and review afterwards, as for steps 27 to 29 (2026-10-13: "build
and complete autonomously ... then i will review all 3-4", and then "Build 30 too, review 4"). So
every decision below is Claude Code's, for the learner to review, and each one says what it costs.
This folder is a copy of step 29.

### What each rule says

- **DSOR-SOD-01a:** "A principal of type `agent` MUST NOT act as an approver"
  ([§16.1](../../../specs/dsor/02-security.md#161-rules)).
- **DSOR-SOD-02:** "Outside owner-approval mode (§16.2), an approver MUST NOT appear in the
  requesting chain of the proposal: not the subject, not the delegator of any acting agent, not
  any actor" ([§16.1](../../../specs/dsor/02-security.md#161-rules)). The *requesting chain* is
  everyone the request came from: the person it is for, the person who signed the slip, and every
  agent that acted.
- **DSOR-SOD-04c:** "Where a control requires a quorum, the approvals MUST come from distinct
  principals" ([§16.1](../../../specs/dsor/02-security.md#161-rules)). A *quorum* is how many
  people must approve.
- **Beside them:** DSOR-SOD-01b (L3, the third level), "An approver MUST be of type `human`". §16
  counts a person together with every agent acting for them as one *effective principal*.

### Decisions (Claude Code)

- **D1. The requesting chain comes from the proposal, never from the approval call.** Line ⑧
  recorded who asked: the *subject*, the person the request is for, and the *actor chain*, the
  agents that acted. The proposal also names the slip, whose signer DSoR reads from its own store.
  *Downside:* only one slip is read. A chain of slips, one agent handing work to another
  (sub-delegation), is not built, and would name more signers.
- **D2. Three kinds of people are out.** The subject: the person who asked, or for an agent's call
  the person who signed its slip (step 18 records the signer as the subject). Every actor in the
  chain. And the signer of the slip the proposal names. DSoR compares login ids. *Downside:* one
  person with two logins counts as two people. Linking logins to one person is DSOR-SOD-04b, L3.
- **D3. A refusal is `SOD_VIOLATION`, at line ⑨.** It is the specification's code for segregation
  of duties. The check comes after "may this person approve this operation at all" and before the
  proposal's state, so it is a "no" before any work: the record says `DENY`, and a dry run hears the
  same. *Downside:* the answer tells the person why. They know it already: they asked, or they
  signed the slip.
- **D4. Checked once, at line ⑨, and not again in the store's step.** A proposal's requester never
  changes after line ⑧ (step 22's trigger), and DSoR's login may change only a slip's status, never
  its signer (step 19b's privileges). No other call can change the answer between line ⑨ and the
  work. *Downside:* a later step that let a slip change hands would need a second look inside the
  store's step.
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
  logins. *Downside:* nothing new is built for them.
- **D8. A quorum counts distinct people (DSOR-SOD-04c).** Step 29's store counts one person once,
  and the database keeps one approval for each person and proposal. Agents never approve, so
  distinct approvers are distinct people: one effective principal each. This step holds it with
  tests titled by its id. *Downside:* a person's two logins count as two, as in D2.
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
| user_123 | drafts INV-2013, 12,000.00 USD, as themselves | waits for an AP supervisor |
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
- Checking segregation of duties again at execution (DSOR-APR-03a), step 31.
