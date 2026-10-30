# Step 18 · Delegations

**New in this step:** the permission slip. The agent acts only under a slip that a person
signed and DSoR keeps, and never with more power than its signer holds (DSOR-DEL-01a,
DSOR-DEL-01b, DSOR-DEL-02).

## In plain words

A *delegation* is a permission slip from a person to an agent. user_123 signs `del_100` for
`accounts-payable-fte`: "you may create payments for org_456, until this date". DSoR keeps the
slip in its own database, and the agent cannot bring a slip of its own. The agent logs in as
itself, with no person beside it, so DSoR takes the person from the slip (the specification
calls such a call `unattended`). The agent may use a right only when the slip lists it and
user_123 still holds it.

## Why it matters

In step 17, the agent's own role, `ap_agent`, held `payment:create`. No person was
responsible for that role, so line ③ of DSoR's checklist, the line for delegations, refused
every command from the agent.

Now picture the role deciding alone. On Monday, user_123 moves to another team and loses
`payment:create`. On Tuesday night, the agent's role still holds it, so the agent drafts
PAY-901 for 31,400.00 USD. The record names no person who allowed it. A slip names the person
who is responsible for the agent, and line ⑤ checks that person's rights at every call. In
this step, DSoR reads those rights when it starts, so Monday's change counts only after a
restart. Step 19 makes it count at the next call.

**Common mistake:** trusting the slip's list alone. `del_100` still says `payment:create` after
user_123 has lost it. Break B1 shows the draft that follows.

## The design, before any code

This section was written by the learner with Claude Code, before any code existed. It starts
from the understanding session of 2026-10-04 ("Step 18, before design" in `../mj_notes.md`)
and its eleven design questions. The specification it relies on was read on 2026-10-05:

- §13: its "In plain words", the example slip `del_100`, DSOR-DEL-01a, DSOR-DEL-01b,
  DSOR-DEL-02, and the sentence after them.
- §13.2: the table of identity modes (the three ways to call DSoR: `direct`, `on_behalf_of`,
  and `unattended`), DSOR-DEL-07, and DSOR-DEL-08.
- `delegation.schema.json`: a slip has an id, a tenant, a delegator (the person who signs it,
  user_123), a delegate (the agent it is for, accounts-payable-fte), at least one mode (how the
  agent may call under it: `unattended`, alone, or `on_behalf_of`, beside a logged-in person),
  at least one permission, constraints, a subdelegation setting (whether the agent may pass the
  slip on to another agent), a status, and an expiry time. All ten are required.

If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** The agent runs a command only under a slip that a person signed and that DSoR
holds. It never gets more power than that person holds at the moment of the call.

**Outcome.** What is true when this step is done:

1. user_123 signs `del_100` for `accounts-payable-fte`, and the agent drafts PAY-901 under it.
2. user_123 loses `payment:create`, and DSoR restarts. The agent's next draft is refused,
   although `del_100` still lists `payment:create`. This meets the "Done when" of step 18 in
   the map of steps (`../readme.md`) only partly: without a restart, the change waits for step
   19 (decision 4).
3. With no slip, or with a slip that is not active, the agent is refused, for reads too
   (decision 2).
4. Nothing in the token or in the request can widen the slip (DSOR-DEL-01b).

**Not the outcome of this step:**

- Limits and their running totals (step 24).
- The company directory that says, at night, whether user_123 still holds the job (step 19).
- Tearing up a slip (the specification says *revoking* it: the slip stays in DSoR's table,
  with the status `revoked`), and cancelling its waiting work (step 25).
- An agent that works beside a logged-in person, `on_behalf_of` (step 45).

### What the specification asks, and what this step can honestly give

Checked on 2026-10-05:

1. **DSOR-DEL-01a asks an agent's command to run under an active slip in DSoR's store.** Step
   17 refused every such command, because no slip existed. Now line ③ finds the slip in
   `dsor.delegations`, for this agent, in this company.
2. **DSOR-DEL-01b asks that what a token carries never widens a slip.** A token's *claims* are
   facts that a login server writes into it, and its *scopes* are permissions written into it.
   This tutorial's tokens are plain ids that carry neither (decision 9). The request envelope
   accepts only `token`, `tenant`, and `request_id`, and refuses any other field (step 10's
   decision 11). So nothing in a token can widen a slip. This holds only because the tokens
   are plain. Tokens signed by a login server, from step 43 on, must show it again.
3. **DSOR-DEL-02 asks for three parts at the moment of the call.** The slip is read at every
   call. The signer's current authority comes from DSoR's role table, as loaded at start-up
   (decision 4). The token's scopes are none (decision 9), and the slip may carry no
   constraints yet (decision 6). So "current" means current as DSoR last loaded its role
   table.
4. **DSOR-DEL-07 asks every `unattended` request for a slip that allows `unattended`.** Every
   call from the agent is `unattended` (decision 1), reads too (decision 2). The map gives this
   rule to step 19, so it arrives early.
5. **DSOR-DEL-08 asks DSoR to take the subject from the slip, never from the request.** The
   *subject* is the person whose authority a call uses. The envelope cannot name a person. An
   argument that names someone else in one of step 05's fields is refused at line ①, and in
   any other field at line ⑥, because every input schema refuses fields it does not list. The
   subject is the slip's delegator. The map gives this rule to step 19, so it arrives early.
6. **DSOR-DEL-09 asks DSoR to refuse when two active slips could cover a call and the request
   names none.** Not met. The
   database keeps one slip per agent and company instead (decision 7).
7. **DSOR-DEL-10 asks every record for the mode, and for the source and time of the subject's
   authority.** Not claimed. An agent's record names its slip, the mode, the subject, and the
   actor chain (the agents that act for the subject: here only `accounts-payable-fte`), but
   not the source and time (decision 8).
8. **DSOR-IDN-07 suspends the slips of a person who has left the company or been suspended.**
   Step 18 cannot see that happen, because nothing tells DSoR. No step on the map names the
   rule.
9. **DSOR-SCH-01 asks every artifact to validate against its schema.** Records and answers
   still do not. Recorded, not claimed.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-DEL-01a | **C1.** An agent's command runs only under an active slip that DSoR finds in its own store, for this agent, in this company | The agent drafts PAY-901 under `del_100`. With no slip: `DELEGATION_REQUIRED`. Torn up: `DELEGATION_REVOKED`. Past its date: `DELEGATION_EXPIRED`. Suspended: `DELEGATION_REQUIRED`. A slip for another agent, or a slip in another company, covers nothing. Each refusal is recorded and leaves no draft |
| DSOR-DEL-01b | **C2.** Nothing the agent sends, and no role in its login, widens its slip | An envelope with an added `scopes` field: `VALIDATION_FAILED`. An agent login that holds a role stops start-up, named (decision 11) |
| DSOR-DEL-02 | **C3.** At every call, the agent may use only what its slip lists and its signer holds now, in that company | With user_123's role cut down, and DSoR built again (a second registry, as after a restart), the agent's draft gets `AUTHORIZATION_DENIED`, while `del_100` still lists `payment:create`. A slip without `payment:cancel`: the agent's cancel is denied, though user_123 holds it |
| DSOR-DEL-02 | **C4.** A slip that carries a constraint, or that names a parent slip, is not usable | A slip with a per-payment limit, a running-total limit, a vendor rule, a resource list, or a time window: `DELEGATION_REQUIRED`, and the message names the constraint. A sub-slip, with `parent`: `DELEGATION_REQUIRED`. A slip with `constraints: {}` works |
| DSOR-DEL-07 | **C5.** Every call from the agent, read or command, needs a slip that allows `unattended` | The agent reads INV-1008 under `del_100`. With no slip, the read gets `DELEGATION_REQUIRED`. A slip whose only mode is `on_behalf_of`: `DELEGATION_REQUIRED` for a read and for a command |
| DSOR-DEL-08 | **C6.** The subject comes from the slip, never from the request | The record's subject is `del_100`'s delegator, user_123. An input that names cfo_100 as `subject` is refused at line ① |
| (our decision) | **C7.** An agent's record names its slip and its person. A person's record is unchanged | The draft's record holds `delegation: del_100` and `identity` with `unattended`, user_123, and `["accounts-payable-fte"]`. A call refused at line ③ names no slip and no subject. user_123's own draft has neither field |
| (our decision) | **C8.** `dsor.delegations` is on `store.json` with its own kind, has row-level security by company, and holds one slip per agent and company | Today's catalog matches `store.json`. As `dsor_runtime` in org_456, org_789's slip is invisible. The database refuses a second slip for the same agent and company, whatever its status. The database's clock decides that a slip is past its date |
| (step 17's open list) | **C9.** An agent's command answer is masked, as its reads are | The agent's PAY-901 answer leaves out the amount, and names it in `redactions` |
| (our decision) | **C10.** A slip that breaks the specification's schema is a fault in DSoR's own store | A slip with no modes, or with the permission `payment:*`: `INTERNAL_ERROR`, and the call is recorded. The copied `delegation.schema.json` matches the original |
| DSOR-SRC-02b (the map gives its slip part to step 18) | **C11.** A slip that the arguments name must be the one DSoR found. *Added by the review* | The agent naming `del_102` in the arguments: `AUTHORIZATION_DENIED` at line ③, recorded, with no draft. A person naming any slip is refused too. `delegator` or `on_behalf_of` naming cfo_100 is refused at line ① |
| DSOR-IDN-03a | **C12.** The slip's signer is a person who works in this company. *Added by the review* | A slip in org_456 signed by user_700, who works only in org_789: every operation is refused at line ③, and the record names no subject |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. The learner
made decisions 1 to 11 on 2026-10-05, one at a time. The build checked this design against
the specification, the schemas, and step 17's code the same day, before the first test, and
found three gaps. The learner changed decision 7, and added decisions 12 and 13. Setting up
Neon changed decision 10. The build made decisions 14 to 16 alone while it built, and 17 to
19 after the review. Each one says so.

1. **The agent calls `unattended`, and its slip must allow that mode.** The agent keeps its own
   token, as in step 17. A real run on 2026-10-05 showed that its envelope names no person, and
   that DSoR refuses an envelope that names one. §13.2 calls such a call `unattended`. So DSoR
   takes the person from the slip, never from the request (DSOR-DEL-08). It accepts the call
   only under a slip whose `modes` include `unattended` (DSOR-DEL-07).
   *Downside:* two rules arrive early from step 19. Step 19 still brings the company directory. The
   rule for two slips that could both cover a call (DSOR-DEL-09) has no step on the map yet,
   and `../mj_notes.md` proposes step 19.
2. **Every call from the agent needs a slip, reads too, and `ap_agent` goes away.** DSOR-DEL-07
   names every `unattended` request, not only commands. Under decision 1, every call from the
   agent is `unattended`. So line ③ asks for an active slip that allows `unattended` before
   line ⑤ looks at any call from the agent. The agent holds no role of its own: what it may do
   comes only from its slip. This removes step 06's stand-in role, as step 06's decision 5
   expected.
   *Downside:* earlier tests that read as the agent need a slip first. `firm-ap-fte` needs one
   slip in each company it works for, signed by a person of that company.
3. **The slips live in `dsor.delegations`, written by a migration, and DSoR only reads them.**
   §13.1 says the slip lives in DSoR's own database, and the map's layout puts slips in the
   `dsor` schema. The table has row-level security by company, as the log does, and its line on
   `store.json` has a new kind: DSoR's side, a company key, and `SELECT` only. Migration `010`
   writes three slips: `del_100` (user_123 for accounts-payable-fte, in org_456), `del_101`
   (user_123 for firm-ap-fte, in org_456), and `del_102` (user_700 for firm-ap-fte, in
   org_789). *Downside:* nobody can sign a new slip while DSoR runs,
   and no step on the map adds signing yet. Recorded as a proposal for the map.
4. **The signer's current rights come from DSoR's own role table, read at start-up and checked
   at every call.** At line ⑤,
   the agent may use a permission only when its slip lists it and user_123's roles in that
   company grant it now. Those roles come from the files that line ⑤ already uses for people:
   the login table in `src/principals.ts`, and `roles.json`. The token's part of DSOR-DEL-02
   waits for a decision of its own. *Downside:* DSoR reads those files at start-up, so a change
   counts after a restart. The tests stand in for the restart with a second registry: DSoR
   built again from the changed role table. Step 19's company directory makes a change count
   at once.
5. **Line ③ finds a usable slip. Line ⑤ checks the permission against what is left.** §21 gives
   line ③ the job to "resolve delegation" and "establish the subject's current authority", and
   line ⑤ the job to "Authorize". So line ③ refuses when the agent has no usable slip. No
   slip, a slip that is not active, or one that does not allow `unattended` gets
   `DELEGATION_REQUIRED`. A slip past its date gets `DELEGATION_EXPIRED`, and a torn-up one
   `DELEGATION_REVOKED`. §28 lists all three codes. Decisions 6, 13, 14, 17, and 18 add more
   refusals at line ③.
   When a usable slip exists, line ⑤ allows a permission only if the slip lists it and user_123
   holds it now. Otherwise the answer is `AUTHORIZATION_DENIED`, as for a person. In the map's
   "Done when", user_123 has lost `payment:create`, so the agent's draft stops at line ⑤.
   *Downside:* one code covers "the slip does not list it" and "the signer no longer holds it".
   Only the message tells them apart.
6. **Step 18's slips carry no constraints, and a slip that carries one is not usable.** The
   schema lets a slip carry none (`constraints: {}`). Limits are checked from step 24, vendors
   are not built, and no step on the map names the time window. A slip with any constraint
   makes line ③ refuse with `DELEGATION_REQUIRED`, and the message names the constraint. So no
   slip can promise a limit that DSoR does not check. This is fail closed, as in DSOR-MON-04
   and DSOR-CTL-07: when DSoR cannot check something, the safe answer wins. *Downside:* the
   map's "up to a limit" waits for step 24,
   and a real slip with limits stops working until then. Whether every unchecked constraint
   refuses is still a question for the specification ("Which constraints does DSOR-DEL-02
   cover" in `../mj_notes.md`).
7. **One slip per agent per company, whatever its status, kept by the database.** A unique
   index on `dsor.delegations` allows one slip for each company and agent, so DSoR never has to
   choose between two. Choosing "the first" would let the order of rows decide whose rights the
   agent uses, and whose name the record carries. DSOR-DEL-09, which refuses such a call, waits
   for a later step (decision 1). Changed at the design check: the first version allowed one
   *active* slip, so torn-up and expired slips could collect beside it. With no usable slip, line ③ could not tell which one
   decides the code, because the specification's slip has no time of signing or tearing. Now
   the one slip's state decides. *Downside:* the agent cannot hold two slips from two people,
   and a torn-up slip, which stays in the table as `revoked`, blocks a new one, until a later
   step changes the rule. Step 18 writes
   slips only by migration, so nothing needs a second one yet.
8. **An agent's record names its slip and its person.** The record gains the audit record
   schema's own fields: `delegation` (`del_100`), and `identity` with the mode `unattended`, the
   subject `user_123`, and the actor chain `["accounts-payable-fte"]`, as the specification's
   example record shows. A person's record is unchanged. DSOR-DEL-10, which asks every record
   for the mode and for the source and time of the subject's authority, stays with step 45,
   where the map places it. *Downside:* two shapes of record until step 45, and an agent's
   identity has no source or time yet.
9. **A token narrows nothing yet.** §13.1 lets a login token make a slip smaller for one
   session, never bigger. A *scope* is a permission written inside a login token.
   This tutorial's tokens are plain ids, such as `tok_7f3a`, which DSoR looks up in its own
   table, and none carries scopes. So the token's part of DSOR-DEL-02 narrows nothing in this
   step. DSOR-DEL-01b holds because DSoR reads no claim from a token, and the request envelope
   refuses an added `scopes` field, which a test shows. *Downside:* "no scopes means no
   narrowing" is this tutorial's reading, not the specification's ("What does a token with no
   scopes allow?" in `../mj_notes.md`), until tokens signed by a login server arrive (step 43).
10. **The database tests run on Neon, on a branch `step-18` made from `step-17`.** Neon allows
    ten branches, and `main` and `step-09` to `step-17` use all ten. So the build starts by
    deleting `step-14`, at the learner's yes. Changed when the build set up Neon: the first
    version deleted `step-10`. But Neon cannot delete a branch that has child branches (its
    "Manage branches" page, read on 2026-10-05), and `step-10` is the parent of `step-11`. Only
    `step-14` and `step-17` had no children, and step 18 grows from `step-17`. *Downside:* step
    14's database tests cannot run on Neon again until someone makes a fresh branch from `main`
    and runs its migrations.
11. **An agent login that holds a role stops start-up.** Decision 2 takes the agent's own role
    away. So each agent's line in DSoR's login table lists its companies with no roles. Start-up
    refuses an agent that holds any role, and names it, as it has refused an unknown role since
    step 06. So an agent's power can come only from a slip, and line ⑤ never weighs a role
    against a slip. `firm-ap-fte` still gets different power in each company, from each
    company's slip. *Downside:* old tests that plant agents with roles change, and
    `firm-ap-fte` loses its `ap_supervisor` role in org_789.
12. **The database's clock decides that a slip is past its date, and usable slips are dated
    2099.** Added at the design check. The specification's `del_100` expires on 2026-12-31. A
    real run on 2026-10-05 counted 88 days to go. From 2027-01-01, a slip with that date would
    give every call from the agent `DELEGATION_EXPIRED`, and every test that expects the agent
    to act would fail. So `del_100` and the other usable slips are dated 2099-12-31, and the
    expired test slip carries a date in the past. The slip store compares `expires_at` with the
    database's `now()` inside the read's transaction, as the log takes its times from the
    database's clock (step 09's README, decision 6). The memory store, which only the unit tests
    use, reads the program's clock. If a store hands back a slip without saying whether its
    date has passed, line ③ counts the date as passed (added by the review). *Downside:*
    `del_100` differs from the specification's example. It allows only `unattended`, lists only
    `invoice:read` and `payment:create`, carries no constraints (decision 6), and runs until
    2099.
13. **Every slip DSoR reads is checked against the specification's schema.** Added at the
    design check. `delegation.schema.json` is copied byte for byte, as steps 03 and 04 copied
    theirs. A real run of that schema on 2026-10-05 refused a slip with no modes and a slip
    with the permission `payment:*`. A slip that fails the check is a fault in DSoR's own store,
    so the call gets `INTERNAL_ERROR`, as steps 14 and 15 answer for their own broken data. A
    valid slip that names a `parent` is a sub-slip. DSOR-DEL-05b says it may grant nothing its
    parent lacks, and step 18 has no such check. So a sub-slip is not usable, and line ③
    answers `DELEGATION_REQUIRED`, naming it, as decision 6 does for constraints. The review
    added two rules. The database keeps the time `infinity`, which JavaScript cannot write, so
    the store leaves such a time out, and the schema check refuses the slip. And an empty id or
    an empty signer makes a slip broken, because the record would name no slip, or no person.
    *Downside:* one more copied schema and its test. The check does not test the `date-time`
    format: the database's `timestamptz` column refuses a time it cannot read.
14. **The build's decision: line ③ checks that the slip it got is this agent's, in this
    company.** The store asks for the agent's slip in the active company, and row-level
    security filters too. But a store with a bug could still hand accounts-payable-fte the slip
    `del_102`, which is firm-ap-fte's, in org_789.
    So line ③ checks the slip it gets: its `tenant` must be the active company, and its
    `delegate` must be the caller. If not, the call gets `INTERNAL_ERROR`, because DSoR's own
    store answered wrongly (DSOR-TEN-01b). Since step 10, DSoR answers the same way when an
    operation's code hands back another company's row (step 10's README, decision 14). Made
    by the build, and not asked of the learner. B3 showed that this check catches a store that
    forgets the company. *Downside:* a third check on the company, beside DSoR's own `WHERE` and
    row-level security (step 11's two locks), and one more `INTERNAL_ERROR` to explain.
15. **The build's decision: only a person signs a slip.** §13 calls a slip "a permission slip
    from a human to an agent". The signer's current rights come from DSoR's login table
    (decision 4). A slip whose `delegator` is an agent, an application, or a name the table
    does not hold grants nothing, so every call under it gets `AUTHORIZATION_DENIED`. Made by
    the build, and not asked of the learner. Line ⑤ made this check at first. Since the
    review, line ③ makes it, with decision 18's. *Downside:* a slip signed by an application
    cannot work, even if a later step wants one.
16. **The build's decision: the tests' agent `intake-fte` gets a slip of its own, `del_190`.**
    The tests of steps 14 and 15 plant `intake-fte` to try clearances and kinds of caller.
    Every call from an agent now needs a slip (decision 2), so the shared test registries
    hold `del_190`, from user_123, beside the story's three slips. Migration 010 does not
    write it, because only the tests know `intake-fte`. Made by the build, and not asked of
    the learner. *Downside:* the unit tests' store holds one slip more than the database.
17. **The build's decision, after the review: a slip that the arguments name must be the one
    line ③ found.** DSOR-SRC-02b refuses a company, a person, or a slip named in the
    arguments that differs from the security context. Steps 05 and 10 built the first two.
    The map's step 05 entry gives the third to step 18, but step 18's own entry does not list
    it, and the design missed it. The review found it: an agent that named `del_102` got
    `VALIDATION_FAILED` from line ⑥, after lines ③ and ⑤ had run. Now line ③ looks where steps
    05 and 10 look, at the top of the input and inside `correlation`, for `delegation`,
    `delegation_id`, and `delegationId`: the record's own word, the token claim of §37, and
    §12's security context. Anything there but the slip that line ③ found gets
    `AUTHORIZATION_DENIED`. A person calls under no slip, so for a person anything there is
    refused. And the slip's own word for its person, `delegator`, and §13.2's mode,
    `on_behalf_of`, join step 05's list at line ①. *Downside:* another spelling, such as
    `slip_id`, is refused only by line ⑥, with `VALIDATION_FAILED`, as in steps 05 and 10.
18. **The build's decision, after the review: the slip's signer must be a person who works in
    this company.** DSOR-IDN-03a asks each request to resolve to one company "in which the
    subject holds a membership". Until step 18 the subject was the caller, and step 10 checks
    the caller. Now the subject of an agent's call is the slip's signer (DSOR-DEL-08). So line
    ③ checks the signer too: a person, with a membership in the active company. If not, the
    call gets `AUTHORIZATION_DENIED`, and its record names no slip. This takes over decision
    15's check. The review found the gap: line ⑤ refused such a call, but its record named
    user_700 as the subject of a call in org_456, where user_700 does not work. *Downside:*
    line ③ reads DSoR's login table, which step 19 replaces with the company directory.
19. **The build's decision, after the review: one name, one login.** Line ③ finds a slip's
    signer by name, in DSoR's login table. If two logins both said user_123, one as AP
    supervisor and one with no role, the order of the table would decide whether the agent may
    draft PAY-901. Decision 7 refuses that for slips. So start-up refuses
    two logins that name one principal, and names it, as it has refused a role written twice
    since step 06. *Downside:* one principal cannot appear twice in the table, even on
    purpose with two tokens and different roles.

### The tests, by claim

- **C1:** the agent's draft under `del_100` succeeds. With no slip, a torn-up slip, a slip whose
  status is `expired`, a slip whose `expires_at` has passed, and a suspended slip, each call is
  refused with its code, recorded, and leaves no draft. A slip for another agent covers nothing.
  A person who works in both companies signs a slip in org_789, and the agent's call in org_456
  is refused.
- **C2:** an envelope with `scopes`: `VALIDATION_FAILED`. Start-up with an agent login that holds
  a role exits with code 1, named, before `operations:`.
- **C3:** a second registry (DSoR built again, as after a restart) whose role table no longer
  gives user_123 `payment:create`: the agent's draft gets `AUTHORIZATION_DENIED`, and its record
  says so. A slip without `payment:cancel`: the agent's cancel is denied.
- **C4:** one slip for each of the five constraint fields: `DELEGATION_REQUIRED`, and the message
  names the field. A sub-slip with `parent`: `DELEGATION_REQUIRED`. `constraints: {}`: the draft
  is made.
- **C5:** the agent's read under `del_100` is answered, with the amount left out. With no slip, the
  read is refused. With a slip whose only mode is `on_behalf_of`, the read and the draft are
  refused.
- **C6:** the record's subject is user_123. An input with `"subject": "cfo_100"` is refused at
  line ①, and no slip is looked up.
- **C7:** the draft's record holds `delegation` and `identity`. A record of a refusal at line ③
  holds neither. user_123's own draft's record holds neither.
- **C8:** the database test that today's catalog matches `store.json`, with `dsor.delegations`. As
  `dsor_runtime` in org_456, a read of org_789's slip finds no row. A second slip for the same
  agent and company is refused by the database, whether or not it is revoked. A slip whose `expires_at` has
  passed by the database's clock gets `DELEGATION_EXPIRED`, and one dated 2099 works. The
  owner, whom row-level security does not stop, runs the slip store for org_456
  and finds only org_456's slip, so DSoR's own filter is tested too (DSOR-TEN-01b), as step
  17's payments store is.
- **C9:** the agent's PAY-901 answer has no amount, and `redactions` names `amount`.
- **C10:** a slip with no modes, and a slip with the permission `payment:*`: `INTERNAL_ERROR`,
  recorded, and no draft. The copied `delegation.schema.json` matches the original, as step 03's
  copies do.
- **C11** (added by the review): the agent names `del_102` in `delegation`, `delegation_id`,
  `delegationId`, and `correlation.delegation_id`: `AUTHORIZATION_DENIED` at line ③, recorded,
  and no draft. Naming its own `del_100`: line ⑥ refuses the field. user_123 naming `del_100`:
  refused at line ③. `delegator` or `on_behalf_of` set to cfo_100: refused at line ①.
- **C12** (added by the review): a slip in org_456 signed by user_700, who works only in
  org_789, refuses each of the five operations at line ③, and the record names no subject. A
  slip signed by an agent, an application, or a name DSoR does not know: refused at line ③.

The review, and the second reviewer's sweep of small breaks, added tests to C1, C3, C4, C5,
C7, C8, and C10, each named under "Think it through".

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions are recorded before any code, as
stories: what the agent hears, and what the database holds after. All four predictions describe
DSoR as built, with every check in place. So the build runs each break as a pair: DSoR as
built beside the break.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| B1 | Line ⑤ uses the slip's list alone, and skips the signer's current rights. user_123 lost `payment:create`, and the agent asks for a draft | C3. With B1 nothing reads user_123's rights, so the draft is made, with the amount hidden | `AUTHORIZATION_DENIED`, and no draft |
| B2 | Line ③ ignores the slip's modes. The only slip says `on_behalf_of`, and the agent reads INV-1008 at night | C5. With B2 nothing reads the modes, so the read is answered, with the amount hidden | `DELEGATION_REQUIRED` |
| B3 | The slip lookup ignores the company. `firm-ap-fte` has a slip only in org_789, signed by user_700, and asks for a draft in org_456 | C1. In memory, line ③ finds org_789's slip, and line ⑤ answers `AUTHORIZATION_DENIED`, because user_700 holds nothing in org_456: another check that stops it, shown by a short throwaway program on 2026-10-05. With a signer who works in both companies, a draft would be made. On the database, row-level security also hides the slip (C8). *Changed by the build:* decision 14's check came later, so line ③ now answers `INTERNAL_ERROR` first | `DELEGATION_REQUIRED` |
| B4 | Line ③ ignores the slip's status and date. `del_100` is torn up, and the agent asks for a draft | C1. With B4 nothing reads the status, so the torn-up slip passes line ③, line ⑤ allows `payment:create`, and the draft is made, with the amount hidden | `DELEGATION_REVOKED`, and no draft |

### Left open, and not this step's idea

- **Two active slips** (DSOR-DEL-09): no step on the map. The database prevents them (decision 7).
- **The source and time of the subject's authority** (DSOR-DEL-10): step 45 (decision 8).
- **The slips of a person who has left the company or been suspended** (DSOR-IDN-07): no step
  on the map. Proposed for step 19.
- **Signing a slip through DSoR:** no step on the map. Proposed in `../mj_notes.md`.
- **Constraints:** limits from step 24. Vendors and the time window have no step (decision 6).
- **A change to the role table** counts after a restart, until step 19's directory (decision 4).
- **Token scopes:** with signed tokens, from step 43 on (decision 9).
- **Tearing up a slip, and cancelling its waiting work:** step 25.
- **Subdelegation** (DSOR-DEL-05a to 05d): no step on the map.
- **A draft before its record** (DSOR-EXE-03b): the agent's draft, like user_123's since step
  17, is saved before its record. If the record fails, the draft stays, and the agent hears
  `INTERNAL_ERROR`, never that a retry is safe. Step 36. Found by the review.
- **A refusal at line ③ names its slip only in its message** (decision 8): the record's
  `delegation` field stays empty. So a search for every decision under `del_100` misses the
  refusals that show an agent trying a torn-up slip. DSOR-DEL-10 asks every decision record
  for the identity mode, and the map gives it to step 45. Found by the review.
- **An agent with no slip can still learn which operations exist:** "which operation?" comes
  before line ③ (step 07's order). So an unknown name gets `UNSUPPORTED_CAPABILITY`, and a known
  one `DELEGATION_REQUIRED`. Found by the review.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup itself,
this way:

1. Delete the branch `step-14`, at the learner's yes (decision 10).
2. Create a branch `step-18` **from `step-17`**, with `neonctl branches create`.
3. Write `.env` with `neonctl connection-string`, sending its output into the file and never
   printing it:
   - `DSOR_MIGRATION_URL`: the owner's string.
   - `DSOR_DB_URL`: the same string, with the user `dsor_runtime` and a new random password
     (letters and digits).

   Give both `sslmode=verify-full`.
4. Run `pnpm migrate`. Only this step's new migrations run.
5. Check without looking: `pnpm test:db` passes, and the transcript holds no `postgresql://`
   with a password in it.

## What changed since step 17

| File | What changed |
| --- | --- |
| `migrations/010_delegations.sql` | **New.** The table `dsor.delegations`: the company key first, row-level security by company, `SELECT` only for `dsor_runtime`, and a unique key that keeps one slip per agent and company. It writes the story's three slips, dated 2099 (decisions 3, 7, and 12) |
| `migrations/011_record_identity.sql` | **New.** Two columns of the log, `identity` and `delegation`, and `dsor_runtime`'s right to write them (decision 8) |
| `schemas/delegation.schema.json` | **New.** The specification's slip schema, copied byte for byte (decision 13) |
| `src/slips.ts` | **New.** The slip's shape, the check against the schema, and the slips in memory for the unit tests |
| `src/delegation.ts` | Line ③: every call from an agent needs a usable slip, found in DSoR's own store, for this agent, in this company, and signed by a person who works there. Each way a slip can fail has its code (C1, C4, C5, C10, C12, and decision 14). Any slip the arguments name must be that slip (C11) |
| `src/permissions.ts` | Line ⑤: an agent may use only what its slip lists and its signer holds now (C3, decisions 4 and 5). Start-up refuses an agent that holds a role (decision 11) |
| `src/principals.ts`, `roles.json` | The agents hold no role, and `ap_agent` is gone. `principalNamed` finds the person who signed a slip, and start-up refuses two logins with one name (decision 19). Step 05's list of names gains `delegator` and `on_behalf_of` (decision 17) |
| `src/pipeline.ts` | Line ③ hands the slip it found to line ⑤ and to the record |
| `src/log.ts`, `src/postgres.ts` | An agent's record names its slip and its person (decision 8). `createDbSlips` reads one slip inside the company's transaction, and the database's clock decides its date (decision 12) |
| `store.json`, `src/store.ts` | A fifth kind, `control-read`, and `dsor.delegations` in `store.json` (decision 3) |
| `src/registry.ts`, `src/main.ts` | The registry holds the slip store. The program's agent drafts a payment under `del_100` |
| `test/slips.test.ts`, `test/slips.db.test.ts`, `test/owner-slips.ts` | **New.** C1 to C12, and decisions 7, 8, 11 to 15, and 19 |
| `test/helpers.ts`, `test/cross-tenant.ts` | The story's slips, and the slips that every shared test registry holds (decision 16). The cross-company suite asks line ③ which agents may attack |

Many old tests changed with the step, because they typed out the old configuration, or used
an agent with no slip. Each change has a one-line reason in the test, and "Build it yourself"
counts them, move by move.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_17_vendors_and_payments/src mj_18_delegations/src
git diff --no-index mj_17_vendors_and_payments/test mj_18_delegations/test
```

## Run it

```bash
pnpm install
pnpm migrate      # only 010 and 011 run
pnpm start
pnpm check        # typecheck and the unit tests: 1222
pnpm test:db      # the database tests: 163, about 15 minutes on Neon
```

The new parts of `pnpm start`, run on 2026-10-05. The agent's `invoice.issue` used to stop at
line ③, because the agent had no slip. Now line ③ finds `del_100`, and line ⑤ refuses,
because the slip does not list `invoice:issue`:

```text
{
  code: 'AUTHORIZATION_DENIED',
  message: '"invoice.issue" needs invoice:issue, which slip del_100 does not list',
  retry: 'never',
  correlation: {
    request_id: 'req_85f404d7-bf4f-4503-b204-482372524c50',
    agent_id: 'accounts-payable-fte'
  }
}
```

The agent drafts a payment under `del_100`. The database numbers each draft, so this branch,
after many runs, is at PAY-1178. The agent's clearance is `internal`, so the amount is left
out:

```text
{
  data: {
    tenant_id: 'org_456',
    id: 'PAY-1178',
    invoice_id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    status: 'draft'
  },
  classification: 'internal',
  redactions: [ { field: 'amount', reason: 'clearance', treatment: 'omitted' } ],
  semantics: 'compensatable',
  correlation: {
    request_id: 'req_718ea05e-5ba2-43b5-982f-0634f4c3aabb',
    agent_id: 'accounts-payable-fte'
  }
}
```

The first record the program prints is the agent's read of INV-1008. It ends with the two new
fields:

```text
  identity: {
    mode: 'unattended',
    subject: 'user_123',
    actor_chain: [ 'accounts-payable-fte' ]
  },
  delegation: 'del_100'
}
```

And among the log's lines, the agent's two calls under the slip:

```text
8113 invoice.issue@1 DENY AUTHORIZATION_DENIED org_456
…
8127 payment.create@1 ALLOW ok org_456
18 calls answered, so 18 records were written. dsor_runtime reads 15 of them, in org_456 and org_789, and cannot read the other 3
```

## Break it

Each break was run for real on 2026-10-05, in a copy of the step outside the repository, so
the step folder never changed. Each story ran twice: on the step as built, then on the
broken copy. The stories use the stores in memory, as the unit tests do, so "the payments
store" is the store in memory. Then the broken copy ran the whole unit suite. The outputs
and counts below come from the finished step, after the review.

| # | The break | Caught by | The learner's prediction (DSoR as built) | With the break |
| --- | --- | --- | --- | --- |
| B1 | Line ⑤ uses the slip's list alone, and skips the signer's current rights | 1 unit test: the map's "Done when" | `AUTHORIZATION_DENIED`, and no draft | The draft is made |
| B2 | Line ③ ignores the slip's modes | 2 unit tests, both C5's | `DELEGATION_REQUIRED` | The read is answered |
| B3 | The slip lookup ignores the company | 52 unit tests. On the database, 1 test: the owner's test of DSoR's own filter | `DELEGATION_REQUIRED` | `INTERNAL_ERROR`, and no draft |
| B4 | Line ③ ignores the slip's status and its date | 9 unit tests: C1's four refusals, the slip both torn up and past its date, and decision 12's four tests of the clock | `DELEGATION_REVOKED`, and no draft | The draft is made |

Each prediction is what DSoR as built answers, and each "as built" run below shows it. A
break asks what is left when the check is gone.

**B1.** user_123 has lost `payment:create`. `del_100` still lists it. With B1, line ⑤ reads
the slip's list and stops there:

```text
as built:
  lines that ran: 1, 2, 3, 5, 11
  the caller hears: AUTHORIZATION_DENIED: "payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now
  drafts in the payments store: none
with B1:
  lines that ran: 1, 2, 3, 5, 6, 9, 11
  the caller hears: PAY-901 draft, amount left out
  drafts in the payments store: PAY-901 draft
```

One test caught it: the map's "Done when", user_123 loses `payment:create`. Before the
review, a second test caught it too, a slip signed by someone who works in another company.
Since decision 18, line ③ refuses that slip before line ⑤ looks.

**B2.** The agent's only slip allows `on_behalf_of`. At night it reads INV-1008. With B2,
line ③ does not read the modes:

```text
as built:
  lines that ran: 1, 2, 3, 11
  the caller hears: DELEGATION_REQUIRED: "invoice.get": slip del_100 does not allow unattended calls
with B2:
  lines that ran: 1, 2, 3, 5, 6, 9, 11
  the caller hears: INV-1008, amount left out
```

Masking still hides the amount from the agent, as it did in step 17's B2.

**B3.** `firm-ap-fte` holds one slip, `del_102`, in org_789, signed by user_700. It asks for a
draft in org_456. With B3, the lookup forgets "in this company":

```text
as built:
  lines that ran: 1, 2, 3, 11
  the caller hears: DELEGATION_REQUIRED: "payment.create" needs a slip: firm-ap-fte holds no person's slip in org_456
  drafts in the payments store: none
with B3:
  lines that ran: 1, 2, 3, 11
  the caller hears: INTERNAL_ERROR: the store answered with a slip of someone else
  drafts in the payments store: none
```

The design expected line ⑤ to catch B3. But the build added decision 14 later: line ③
checks that the slip it got is this agent's, in this company. So line ③ catches it first.
Two more runs remove the checks one at a time. With B3, and decision 14's check removed,
line ③ still refuses, because of decision 18: user_700 does not work in org_456.

```text
  lines that ran: 1, 2, 3, 11
  the caller hears: AUTHORIZATION_DENIED: "payment.create": slip del_102 is signed by user_700, who is not a person in org_456
  drafts in the payments store: none
```

And when the slip's signer works in both companies, no check is left. A slip from org_789
makes a draft in org_456:

```text
  lines that ran: 1, 2, 3, 5, 6, 9, 11
  the caller hears: PAY-901 draft, amount left out
  drafts in the payments store: PAY-901 draft
```

52 unit tests fail with B3, and 54 without decision 14's check. With the company forgotten,
the store in memory gives the firm's agent the first slip it holds in any company. In org_789
that is org_456's `del_101`, so the firm's agent fails in org_789 too: 34 tests of the
cross-company suite, and 18 in six other files.

On the database, B3 makes the slip store's `WHERE` ignore the company: `tenant_id = $1`
becomes `$1::text IS NOT NULL`, which is always true. The database suite ran on a local
PostgreSQL. Only 1 of 163 tests failed: the owner's test of DSoR's own filter. The owner holds
`BYPASSRLS`, so no policy filters for it, and the store found two slips for `firm-ap-fte`:

```text
Error: owner-slips.ts failed: Error: dsor.delegations holds 2 slips for one agent in one company
```

Every other test reads as `dsor_runtime`, and row-level security still hid org_789's slip.
That is why the owner's test exists: without it, B3 on the database would pass every test.

**B4.** user_123 tore up `del_100`. The agent asks for a draft. With B4, line ③ does not read
the status or the date:

```text
as built:
  lines that ran: 1, 2, 3, 11
  the caller hears: DELEGATION_REVOKED: "payment.create": slip del_100 was torn up
  drafts in the payments store: none
with B4:
  lines that ran: 1, 2, 3, 5, 6, 9, 11
  the caller hears: PAY-901 draft, amount left out
  drafts in the payments store: PAY-901 draft
```

Nine unit tests fail: C1's four refusals (torn up, expired by its status, past its date, and
suspended), a slip both torn up and past its date, and decision 12's four tests of the clock.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Understand | A session with no code, on 2026-10-04: step 17's three misses, checked again with real runs, then the questions of "Step 18, before design" in `../mj_notes.md` |
| 2 | Design | "In plain words", "Why it matters", and "The design, before any code": decisions 1 to 11, one per turn, each with a sentence of the specification or a real run. Then the predictions for B1 to B4, asked as stories |
| 3 | Check the design | Against the specification, the schemas, and step 17's code, before the first test. Three gaps went to the learner, one at a time: decision 7 changed, and decisions 12 and 13 were added |
| 4 | Neon | `step-10` could not be deleted, so `step-14` was, at the learner's yes (decision 10). A branch `step-18` from `step-17`. `.env` written by a command, never shown. Then `pnpm migrate`, and both suites green before any change: 1140 unit tests, 142 database tests |
| 5 | Configuration | Migrations 010 and 011, the kind `control-read`, and the copied schema. No check reads them yet |
| 6 | Red | Shells: code with the new shape and step 17's behaviour, so a new test fails on what it checks, not on a missing file. Then every new test |
| 7 | Green | One requirement per commit: line ③ (DSOR-DEL-01a, DSOR-DEL-07, DSOR-DEL-08), line ⑤ (DSOR-DEL-02, with decision 11), then the record (decision 8) |
| 8 | Break it | Each break in a copy outside the repository, beside the step as built, with the whole unit suite. B3 also on a local PostgreSQL |
| 9 | Review | Reviewers who have not seen the conversation, each in a copy outside the repository, on a local PostgreSQL |

The prompt that started the build:

```text
Build step 18 in learner mode from the design in
docs/baby_steps_tutorials/mj_18_delegations/README.md.
```

After the configuration, the learner asked the build to finish alone and to come back when
the step was ready to ship. So the build made decisions 14 to 19 without asking, and each one
says so.

The learner's predictions, and what each break really did, are under "Break it".

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Configuration | 5 old tests: 2 unit tests and 3 database tests that type out the store's map, the log's privileges, and the tables with row-level security |
| Red | 35 of 47 new unit tests, and 4 of 10 new database tests. No old test |
| Line ③ | 87 old unit tests and 4 old database tests. The cross-company suite's setup code, its `beforeAll` hook, also ran out of its 180 seconds, so vitest skipped its 5 tests |
| Line ⑤ | 15 old unit tests |
| The record | 5 old unit tests, and 1 old database test, found on the local PostgreSQL |
| The review's fixes | 16 of 20 new unit tests, and 2 of 4 new database tests. 4 of step 18's own tests changed: decision 15's three now expect line ③, and one more checks the record and the rows |
| The sweep's tests | 15 new unit tests and 7 new database tests. None failed: each passes on the code, and fails on the break it was written for |

## Check yourself

1. `del_100` lists `payment:create`. Yesterday user_123 lost that right, and DSoR has restarted
   since. What does the agent hear when it asks for a draft, and which line answers?
2. In step 17 the agent read invoices with no slip. Why does a read need a slip in step 18?
3. At 2 a.m. the agent calls as itself. Where does DSoR find the person it works for, and why
   never in the request?
4. Why does step 18 refuse a slip that carries a limit?
5. Two people each sign a slip for the agent. Why must DSoR not use "the first" one?

<details>
<summary>Answers</summary>

1. `AUTHORIZATION_DENIED`, from line ⑤. Line ③ finds a usable slip. Line ⑤ allows only what the
   slip lists and user_123 holds now, and user_123 no longer holds `payment:create`
   (DSOR-DEL-02). Without the restart, DSoR still holds yesterday's role table, and the draft
   is made. Step 19 removes that gap (decision 4).
2. The agent calls as itself, with no person present, so every call is `unattended`. DSOR-DEL-07
   accepts an `unattended` request, read or command, only under a slip that allows it.
3. In the slip: its delegator is the subject (DSOR-DEL-08). A request comes from the agent, and
   DSoR never takes the agent's word for whose authority it carries.
4. Nothing checks a limit until step 24. A slip that promised a limit that nobody checks would
   let the agent go over it. So line ③ refuses any slip with a constraint, with
   `DELEGATION_REQUIRED` (decision 6).
5. The order of rows in a table would decide whose rights the agent uses, and whose name the
   record carries. DSOR-DEL-09 refuses such a call instead. Step 18's database allows only one
   slip per agent and company.

</details>

## Think it through

**While building,** the build made decisions 14 to 16 alone, and found these:

- **A test that copies the log's `INSERT` broke, and only the database suite could see it.** Step
  09's test of a log whose `INSERT` keeps no row swaps in its own `INSERT`, with the log's
  twelve columns. Decision 8 made them fourteen, so the swapped statement failed on its
  fourteen values. The test counts the rows its `INSERT` kept, and saw none run, so it
  failed instead of passing for the wrong reason. The local PostgreSQL found it first. The
  test now copies all fourteen columns.
- **The cross-company database suite takes 3 to 4 minutes on Neon.** Its 84 calls each wait
  for the database several times, and every call from an agent now reads its slip first.
  Step 17 gave its hook 180 seconds. In step 18 it ran out twice, and vitest reported its 5
  tests as *skipped*, not failed. A run that counts only failures misses that, and the build
  first did. The hook now has 600 seconds.
- **A stall that was not there.** vitest's JSON report starts a file's clock after its
  `beforeAll` hook, so a slow hook can look like a pause between files. Timed inside the
  hook, the cross-company suite took 194 seconds alone: a slow suite, not a stall.
- **What was removed from earlier steps.** Step 06's stand-in role, `ap_agent`, as its decision
  5 expected. `firm-ap-fte` lost its roles in both companies: its power in each comes from that
  company's slip. On Neon, the branch `step-14` is gone (decision 10).
- **Old tests that changed:** counted by move under "Build it yourself". Each has a one-line
  reason in the test.

**The review.** Two reviewers who had not seen the conversation worked in copies outside the
repository, against a local PostgreSQL. One read the rules and attacked the step with inputs
of its own. It found no way for the agent to widen its slip, to use another agent's or
another company's slip, or to pass a torn-up, suspended, out-of-date, constrained, or
sub-slip. Every strange value it put in a slip, such as a `null` in `modes` or the status
`Active`, was refused: it failed closed. Findings 9 and 14 below were the exceptions. What it
did find:

| Finding | What was done |
| --- | --- |
| **1.** The agent's draft is saved before its record (DSOR-EXE-03b), as user_123's has been since step 17. Step 18 lets the agent reach that path | **Recorded** under "Left open": step 36 |
| **2.** A slip named in the arguments reached line ⑥ as an unknown field, and got `VALIDATION_FAILED`, not DSOR-SRC-02b's `AUTHORIZATION_DENIED` | **Fixed** (decision 17), red first |
| **3.** Every test compared the record's person with a constant. Hard-coding user_123 left every test green | **Test added:** firm-ap-fte's record under `del_102` names user_700, in memory and on the database |
| **4.** The part of decision 14's check that compares the slip's agent with the caller could be deleted with every test green | **Test added:** a store that hands `del_101` to accounts-payable-fte |
| **5.** No test showed that the database's clock decides: a slip dated 2001 is past by both clocks | **Test added:** with the program's clock in 2100, `del_100` still works on the database |
| **6.** Item 5 of "What the specification asks" said every argument that names a person is refused at line ①, but a name outside step 05's list reaches line ⑥. And "which operation?" runs before line ③, so an agent with no slip learns which operations exist | **README fixed.** That an agent with no slip can still learn which operations exist went to "Left open" |
| **7.** The opening said a lost right counts "at its very next request", and left out the restart | **README fixed** |
| **8.** A slip signed by someone who works only in another company was refused at line ⑤, but its record named that person as the subject (DSOR-IDN-03a) | **Fixed** (decision 18), red first |
| **9.** A slip whose time is `infinity` failed by accident, with DSoR's message for a bug | **Fixed** (decision 13): the store leaves such a time out, and the schema check refuses the slip |
| **10.** A store that did not say whether a slip was past its date let the draft through | **Fixed** (decision 12) |
| **11.** A refusal at line ③ names its slip only in its message | **Recorded** under "Left open" |
| **12.** With two logins for one name, the order of the table decided the signer's power | **Fixed** (decision 19) |
| **13.** No test made the slip store fail. A test said "every call is denied", and tried one read only. One test checked neither the record nor the rows | **Tests added** |
| **14.** An empty slip id let the draft through, with a record that named no slip | **Fixed** (decision 13) |

The review's red run: 20 new unit tests. 16 failed, for the holes in the code. 4 passed at
once, because the code was right and only a test was missing. On the database, 2 of 4 new
tests failed. A hole in the code fails first. A hole in the tests passes first.

The other reviewer broke the code 95 times, one small change at a time, in its own copy. The
tests caught 70 breaks, and 25 left every test green. 4 of the 25 change nothing that anyone
can see. 21 were real holes in the tests. For each, the reviewer wrote a test that fails on
its break and passes on the code. One was the hole the first reviewer had found (finding 4).
The worst of the others:

| Break that every test let through | What could go wrong | Test added |
| --- | --- | --- |
| On the way from the database, the code that turns a row into a slip, `slipOf`, drops the slip's constraints, its parent, or its modes | A slip in the database with a 100.00 USD limit, a sub-slip, or a slip for `on_behalf_of` only would work. The unit tests proved these rules only on slips in memory | The same three rules, on the database |
| The schema check deletes fields it does not know, or turns the text `"false"` into `false` | A constraint the schema does not know would vanish, and the agent would draft with no limit | Three more broken slips for C10 |
| The database's store stops refusing two rows for one agent and company | If someone narrowed the unique key, the order of rows would choose the slip (decision 7) | A store that answers with two rows |
| The kind `control-read` allows writes, or the slips' line changes kind | A line in `store.json` and a `GRANT` would let DSoR write its own slips | The kind's tests, and the slips' line pinned |
| DSoR's own log drops the slip and the person when it reads a record back | An auditor who reads through DSoR would see the agent's call with no slip and no person | The record read back, for the agent and for user_123 |

The smaller ones:

- which code wins when a slip is both torn up and past its date (torn up);
- an agent's role in its second company;
- the very instant of `expires_at`, in memory;
- the check on the company id in the table;
- a broken `subdelegation`, on the database;
- an agent with no slip, asked directly for its permissions.

15 unit tests and 7 database tests came from the sweep.

**The README review.** A third reviewer read this README as a student would, against the
`write-for-learners` skill. It found the restart left out in five places, "In plain words"
three times too long, the four predictions marked "wrong" although each one was DSoR's real
answer as built, a dozen terms used before they were defined, "lock" counted three ways, and
"torn up" where the slip stays in the table. All were fixed.

**Analogies.** The permission slip is on the house list, and so is "fail closed". Two images
are not, and are flagged for review: a slip *torn up*, for a revoked one, which this README
says stays in the table where that matters; and *lock*, which it keeps for step 11's two locks
on a company.

**What step 19 starts from.**
- Every call from an agent is `unattended`, and DSOR-DEL-07 and DSOR-DEL-08 arrived early.
  Step 19 adds the company directory, so a change to user_123's job counts at the next call,
  not at the next restart (decision 4).
- Slips are written only by migration 010. Nobody can sign or tear up a slip while DSoR runs.
- A slip with a constraint or a parent is refused until limits (step 24) and subdelegation (no
  step on the map yet).
- "Left open, and not this step's idea" lists the rest.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-DEL-01a | A state-changing command from an agent runs only under an active delegation in DSoR's own store | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | `test/slips.test.ts`, 20 tests: the agent drafts PAY-901 under `del_100`. With no slip, a torn-up slip, one expired by its status, one past its date, and a suspended one, the draft is refused at line ③, recorded, and not made. A slip both torn up and past its date is refused as torn up. A broken slip gets `INTERNAL_ERROR` in nine ways (C10). A slip for another agent, or in another company, covers nothing. A person needs no slip. Line ③ refuses before line ⑤. `test/delegation.test.ts`, 6 tests from step 17, now run with no slips in the store. `test/slips.db.test.ts`, 1 test: the draft on the database. `test/schemas.test.ts`, 1 test: the copied schema. `test/payments.test.ts`, 1 test: a query's code writes nothing |
| DSOR-DEL-01b | Token claims and scopes never widen a delegation | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | `test/slips.test.ts`, 1 test: an envelope that adds `scopes` is refused, and nothing is drafted. **Partly:** this tutorial's tokens are plain ids that carry no claims (decision 9), so no test can give a token a scope until signed tokens arrive |
| DSOR-DEL-02 | At the moment of the call, the agent may do only what all three allow: the signer's current authority, the slip, and the token's scopes | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | `test/slips.test.ts`, 11 tests: user_123 loses `payment:create`, and after a restart the agent's draft is refused, though `del_100` still lists it (the map's "Done when"). A slip without `payment:cancel`. An agent's own role never counts, and an agent with no slip may do nothing. `firm-ap-fte` may cancel in org_789 and not in org_456. The five constraints and a sub-slip make a slip unusable (C4). `test/tenants.test.ts`, 3 tests: in each company, the firm's agent may do only what its slip there and its signer allow. `test/slips.db.test.ts`, 2 tests: a limit and a sub-slip, on the database. **Partly:** the signer's rights come from DSoR's role table as loaded at start-up (decision 4), and the token narrows nothing (decision 9) |
| DSOR-DEL-07 | An `unattended` call is accepted only under a slip that allows `unattended` | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | `test/slips.test.ts`, 4 tests: the agent reads INV-1008 under `del_100`. With no slip, the read is refused. A slip whose only mode is `on_behalf_of` refuses a read and a draft. `test/slips.db.test.ts`, 1 test: the same slip on the database. Early, from step 19 (decision 1) |
| DSOR-DEL-08 | In `unattended` mode, DSoR takes the person from the slip, never from the request | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | `test/slips.test.ts`, 4 tests: the store is asked for the caller's own slip, in the active company. An input that names cfo_100 as `subject` is refused at line ①, and no slip is looked up. The draft's record names `del_100`, `unattended`, user_123, and the agent, and firm-ap-fte's names `del_102` and user_700. `test/slips.db.test.ts`, 2 tests: firm-ap-fte's record on the database, and DSoR's own log reading the agent's record back. Early, from step 19 (decision 1) |
| DSOR-SRC-02b | A company, a person, or a slip named in the arguments that differs from the security context is refused | [§11 Source trust](../../../specs/dsor/02-security.md#11-source-trust-and-the-instruction-boundary) | `test/slips.test.ts`, 8 tests: the agent naming `del_102` in four places is refused at line ③, recorded, with no draft. Naming its own slip passes line ③. A person naming any slip is refused. `delegator` and `on_behalf_of` naming cfo_100 are refused at line ① (C11, decision 17). **Partly:** the slip part only. Steps 05 and 10 built the rest |
| DSOR-IDN-03a | Each request resolves to one company in which the subject holds a membership | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/slips.test.ts`, 5 tests: a slip in org_456 signed by user_700, who works only in org_789, refuses each of the five operations at line ③, and the record names no subject (C12, decision 18). **Partly:** the subject part only. Step 10 checks the caller |

Also built, as this tutorial's decisions, and proved in `test/slips.test.ts`,
`test/slips.db.test.ts`, and `test/store-map.test.ts`:

- An agent's record names its slip and its person (C7, decision 8).
- `dsor.delegations` is in `store.json`, with row-level security, one slip per agent and
  company, and the database's clock (C8, decisions 3, 7, and 12).
- An agent's command answer is masked, as its reads are (C9).
- Every slip is checked against the specification's schema (C10, decision 13).
- Start-up refuses an agent that holds a role (decision 11), and two logins with one name
  (decision 19).
- Line ③ checks that the store's slip is this agent's, in this company (decision 14).

## Next

Step 19 · Unattended mode and the role source. At 2 a.m., a company directory tells DSoR
whether user_123 still holds the job that the slip depends on.
