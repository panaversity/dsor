# Step 18 · Delegations

**New in this step:** the permission slip. A person signs a slip, DSoR keeps it in its own
store, and the agent's commands run only under it. The agent never gets more power than the
person who signed holds at the moment of the call (DSOR-DEL-01a, DSOR-DEL-01b, DSOR-DEL-02).

## In plain words

A *delegation* is a permission slip from a person to an agent. user_123 signs one for
`accounts-payable-fte`: "you may create payments for org_456, until the date on this slip".
The specification's example slip is called `del_100`.

DSoR keeps the slip in its own database, and that copy is the truth. The agent cannot bring a
slip of its own. Its login token can make the slip smaller for one session, but never bigger.

The slip never gives the agent more than the signer has. If user_123 loses the right to create
payments, the agent loses it too, at its very next request, even though the slip still lists
that right.

At night nobody is logged in. The agent logs in as itself, and DSoR reads from the slip whose
authority the agent carries. The specification calls such a call `unattended`.

## Why it matters

In step 17, the agent's own role, `ap_agent`, held `payment:create`. No person stood behind
that role, so line ③ refused every command from the agent.

Now picture the role deciding alone. On Monday, user_123 moves to another team and loses
`payment:create`. On Tuesday night, the agent's role still holds it, so the agent drafts
PAY-901 for 31,400.00 USD. The record names no person who allowed it. A slip names the person
who answers for the agent, and DSoR checks that person's rights again at every call.

## The design, before any code

This section is written by the learner with Claude Code, before any code exists. It starts
from the understanding session of 2026-10-04 ("Step 18, before design" in `../mj_notes.md`)
and its eleven design questions. The specification it relies on was read on 2026-10-05:

- §13: its "In plain words", the example slip `del_100`, DSOR-DEL-01a, DSOR-DEL-01b,
  DSOR-DEL-02, and the sentence after them.
- §13.2: the table of identity modes, DSOR-DEL-07, and DSOR-DEL-08.
- `delegation.schema.json`: a slip has an id, a tenant, a delegator, a delegate, at least one
  mode, at least one permission, constraints, a subdelegation setting, a status, and an
  expiry time. All ten are required.

If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules are split into claims.

**Intent.** The agent runs a command only under a slip that a person signed and that DSoR
holds. It never gets more power than that person holds at the moment of the call.

**Outcome.** What is true when this step is done:

1. user_123 signs `del_100` for `accounts-payable-fte`, and the agent drafts PAY-901 under it.
2. user_123 loses `payment:create`. The agent's next draft is refused, although `del_100`
   still lists `payment:create`. This is the map's "Done when".
3. With no slip, or with a slip that is not active, the agent is refused, as in step 17.
4. Nothing in the token or in the request can widen the slip (DSOR-DEL-01b).

**Not the outcome of this step:**

- Limits and their running totals (step 24).
- The company directory that says, at night, whether user_123 still holds the job (step 19).
- Tearing up a slip, and cancelling its waiting work (step 25).
- An agent that works beside a logged-in person, `on_behalf_of` (step 45).

### What the specification asks, and what this step can honestly give

Checked on 2026-10-05:

1. **DSOR-DEL-01a asks an agent's command to run under an active slip in DSoR's store.** Step
   17 refused every such command, because no slip existed. Now line ③ finds the slip in
   `dsor.delegations`, for this agent, in this company.
2. **DSOR-DEL-01b asks that token claims and scopes never widen a slip.** This tutorial's tokens
   are plain ids that carry no claims (decision 9), and the closed envelope refuses any added
   field. So nothing in a token can widen a slip. This holds only because the tokens are
   plain. Signed tokens, from step 43 on, must show it again.
3. **DSOR-DEL-02 asks for three parts at the moment of the call.** The slip is read at every
   call. The signer's current authority comes from DSoR's role table, as loaded at start-up
   (decision 4). The token's scopes are none (decision 9), and the slip may carry no
   constraints yet (decision 6). So "current" means current as DSoR last loaded its role
   table.
4. **DSOR-DEL-07 asks every `unattended` request for a slip that allows `unattended`.** Every
   call from the agent is `unattended` (decision 1), reads too (decision 2). Early, from step
   19's list.
5. **DSOR-DEL-08 asks DSoR to take the subject from the slip, never from the request.** The
   envelope cannot name a person, and an argument that names someone else is refused at line
   ① (step 05). The subject is the slip's delegator. Early, from step 19's list.
6. **DSOR-DEL-09 asks DSoR to refuse when two active slips could cover a call.** Not met. The
   database keeps one slip per agent and company instead (decision 7).
7. **DSOR-DEL-10 asks every record for the mode, and for the source and time of the subject's
   authority.** Not claimed. An agent's record names its slip, the mode, the subject, and the
   actor chain, but not the source and time (decision 8).
8. **DSOR-IDN-07 suspends a fired person's slips.** Step 18 cannot see a firing, because
   nothing tells DSoR. No step on the map names the rule.
9. **DSOR-SCH-01 asks every artifact to validate against its schema.** Records and answers
   still do not. Recorded, not claimed.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-DEL-01a | **C1.** An agent's command runs only under an active slip that DSoR finds in its own store, for this agent, in this company | The agent drafts PAY-901 under `del_100`. With no slip: `DELEGATION_REQUIRED`. Torn up: `DELEGATION_REVOKED`. Past its date: `DELEGATION_EXPIRED`. Suspended: `DELEGATION_REQUIRED`. A slip for another agent, or a slip in another company, covers nothing. Each refusal is recorded and leaves no draft |
| DSOR-DEL-01b | **C2.** Nothing the agent sends, and no role in its login, widens its slip | An envelope with an added `scopes` field: `VALIDATION_FAILED`. An agent login that holds a role stops start-up, named (decision 11) |
| DSOR-DEL-02 | **C3.** At every call, the agent may use only what its slip lists and its signer holds now, in that company | With user_123's role cut down in a second registry, the agent's draft gets `AUTHORIZATION_DENIED`, while `del_100` still lists `payment:create`. A slip without `payment:cancel`: the agent's cancel is denied, though user_123 holds it. A signer who is not a member of the company gives nothing |
| DSOR-DEL-02 | **C4.** A slip that carries a constraint, or that names a parent slip, is not usable | A slip with a per-payment limit, a running-total limit, a vendor rule, a resource list, or a time window: `DELEGATION_REQUIRED`, and the message names the constraint. A sub-slip, with `parent`: `DELEGATION_REQUIRED`. A slip with `constraints: {}` works |
| DSOR-DEL-07 | **C5.** Every call from the agent, read or command, needs a slip that allows `unattended` | The agent reads INV-1008 under `del_100`. With no slip, the read gets `DELEGATION_REQUIRED`. A slip whose only mode is `on_behalf_of`: `DELEGATION_REQUIRED` for a read and for a command |
| DSOR-DEL-08 | **C6.** The subject comes from the slip, never from the request | The record's subject is `del_100`'s delegator, user_123. An input that names cfo_100 as `subject` is refused at line ① |
| (our decision) | **C7.** An agent's record names its slip and its person. A person's record is unchanged | The draft's record holds `delegation: del_100` and `identity` with `unattended`, user_123, and `["accounts-payable-fte"]`. A call refused at line ③ names no slip and no subject. user_123's own draft has neither field |
| (our decision) | **C8.** `dsor.delegations` is on `store.json` with its own kind, has row-level security by company, and holds one slip per agent and company | Today's catalog matches `store.json`. As `dsor_runtime` in org_456, org_789's slip is invisible. The database refuses a second slip for the same agent and company, whatever its status. The database's clock decides that a slip is past its date |
| (step 17's open list) | **C9.** An agent's command answer is masked, as its reads are | The agent's PAY-901 answer leaves out the amount, and names it in `redactions` |
| (our decision) | **C10.** A slip that breaks the specification's schema is a fault in DSoR's own store | A slip with no modes, or with the permission `payment:*`: `INTERNAL_ERROR`, and the call is recorded. The copied `delegation.schema.json` matches the original |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. The learner
made decisions 1 to 11 on 2026-10-05, one at a time. The build checked this design against
the specification, the schemas, and step 17's code the same day, before the first test, and
found three gaps. The learner changed decision 7, and added decisions 12 and 13.

1. **The agent calls `unattended`, and its slip must allow that mode.** The agent keeps its own
   token, as in step 17. A real run on 2026-10-05 showed that its envelope names no person, and
   that DSoR refuses an envelope that names one. §13.2 calls such a call `unattended`. So DSoR
   takes the person from the slip, never from the request (DSOR-DEL-08). It accepts the call
   only under a slip whose `modes` include `unattended` (DSOR-DEL-07).
   *Downside:* two rules arrive early from step 19. Step 19 keeps the company directory. The
   rule for two slips that could both cover a call (DSOR-DEL-09) has no step on the map yet,
   and `../mj_notes.md` proposes step 19.
2. **Every call from the agent needs a slip, reads too, and `ap_agent` goes away.** DSOR-DEL-07
   names every `unattended` request, not only commands. Under decision 1, every call from the
   agent is `unattended`. So line ③ asks for an active slip that allows `unattended` before any
   call from the agent. The agent holds no role of its own: what it may do comes only from its
   slip. This removes step 06's stand-in role, as step 06's decision 5 expected.
   *Downside:* earlier tests that read as the agent need a slip first. `firm-ap-fte` needs one
   slip in each company it works for, signed by a person of that company.
3. **The slips live in `dsor.delegations`, written by a migration, and DSoR only reads them.**
   §13.1 says the slip lives in DSoR's own database, and the map's layout puts slips in the
   `dsor` schema. The table has row-level security by company, as the log does, and its line on
   `store.json` has a new kind: DSoR's side, a company key, and `SELECT` only. Migration `010`
   writes `del_100` and the other slips. *Downside:* nobody can sign a new slip while DSoR runs,
   and no step on the map adds signing yet. Recorded as a proposal for the map.
4. **The signer's current rights come from DSoR's own role table, at every call.** At line ⑤,
   the agent may use a permission only when its slip lists it and user_123's roles in that
   company grant it now. Those roles come from the table that line ⑤ already uses for people:
   DSoR's login table and `roles.json`. The token's part of DSOR-DEL-02 waits for a decision of
   its own. *Downside:* DSoR reads that table at start-up, so a change counts after a restart.
   The tests show "the next request" with a second registry. Step 19's company directory makes
   a change count at once.
5. **Line ③ finds a usable slip. Line ⑤ checks the permission against what is left.** §21 gives
   line ③ the job to "resolve delegation" and "establish the subject's current authority", and
   line ⑤ the job to "Authorize". So line ③ refuses only when the agent has no usable slip:
   none, or none that allows `unattended`, or none that is active (`DELEGATION_REQUIRED`); past
   its date (`DELEGATION_EXPIRED`); torn up (`DELEGATION_REVOKED`). §28 lists all three codes.
   When a usable slip exists, line ⑤ allows a permission only if the slip lists it and user_123
   holds it now. Otherwise the answer is `AUTHORIZATION_DENIED`, as for a person. In the map's
   "Done when", user_123 has lost `payment:create`, so the agent's draft stops at line ⑤.
   *Downside:* one code covers "the slip does not list it" and "the signer no longer holds it".
   Only the message tells them apart.
6. **Step 18's slips carry no constraints, and a slip that carries one is not usable.** The
   schema lets a slip carry none (`constraints: {}`). Limits are checked from step 24, vendors
   are not built, and no step on the map names the time window. A slip with any constraint
   makes line ③ refuse with `DELEGATION_REQUIRED`, and the message names the constraint. So no
   slip can promise a limit that DSoR does not check, as DSOR-MON-04 and DSOR-CTL-07 already
   resolve the unchecked by refusing. *Downside:* the map's "up to a limit" waits for step 24,
   and a real slip with limits stops working until then. Whether every unchecked constraint
   refuses is still a question for the specification ("Which constraints does DSOR-DEL-02
   cover" in `../mj_notes.md`).
7. **One slip per agent per company, whatever its status, kept by the database.** A unique
   index on `dsor.delegations` allows one slip for each company and agent, so DSoR never has to
   choose between two. Choosing "the first" would let the order of rows decide whose name goes
   on a payment. DSOR-DEL-09, which refuses such a call, waits for a later step (decision 1).
   Changed at the design check: the first version allowed one *active* slip, so torn-up and
   expired slips could pile up beside it. With no usable slip, line ③ could not tell which one
   decides the code, because the specification's slip has no time of signing or tearing. Now
   the one slip's state decides. *Downside:* the agent cannot hold two slips from two people,
   and a torn-up slip blocks a new one, until a later step changes the rule. Step 18 writes
   slips only by migration, so nothing needs a second one yet.
8. **An agent's record names its slip and its person.** The record gains the audit record
   schema's own fields: `delegation` (`del_100`), and `identity` with the mode `unattended`, the
   subject `user_123`, and the actor chain `["accounts-payable-fte"]`, as the specification's
   example record shows. A person's record is unchanged. DSOR-DEL-10, which asks every record
   for the mode and for the source and time of the subject's authority, stays with step 45,
   where the map places it. *Downside:* two shapes of record until step 45, and an agent's
   identity has no source or time yet.
9. **A token narrows nothing yet.** A *scope* is a permission written inside a login token.
   This tutorial's tokens are plain ids, such as `tok_7f3a`, which DSoR looks up in its own
   table, and none carries scopes. So the token's part of DSOR-DEL-02 narrows nothing in this
   step. DSOR-DEL-01b holds because DSoR reads no claim from a token, and the closed envelope
   refuses an added `scopes` field, which a test shows. *Downside:* "no scopes means no
   narrowing" is this tutorial's reading, not the specification's ("What does a token with no
   scopes allow?" in `../mj_notes.md`), until signed tokens arrive with real logins.
10. **The database tests run on Neon, on a branch `step-18` made from `step-17`.** Neon allows
    ten branches, and `main` and `step-09` to `step-17` use all ten. `step-09` keeps the
    changed records for step 39's demo. So the build starts by deleting `step-10`, at the
    learner's yes. *Downside:* step 10's database tests cannot run on Neon again until someone
    makes a fresh branch from `main` and runs its migrations.
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
    use, reads the program's clock. *Downside:* `del_100`'s date differs from the specification's
    example.
13. **Every slip DSoR reads is checked against the specification's schema.** Added at the
    design check. `delegation.schema.json` is copied byte for byte, as steps 03 and 04 copied
    theirs. A real run of that schema on 2026-10-05 refused a slip with no modes and a slip
    with the permission `payment:*`. A slip that fails the check is a fault in DSoR's own store,
    so the call gets `INTERNAL_ERROR`, as steps 14 and 15 answer for their own broken data. A
    valid slip that names a `parent` is a sub-slip. DSOR-DEL-05b says it may grant nothing its
    parent lacks, and step 18 has no such check. So a sub-slip is not usable, and line ③
    answers `DELEGATION_REQUIRED`, naming it, as decision 6 does for constraints. *Downside:* one
    more copied schema and its test. The schema check does not test the `date-time` format, so
    the database's `timestamptz` column must refuse a bad date.

### The tests, by claim

- **C1:** the agent's draft under `del_100` succeeds. With no slip, a torn-up slip, a slip whose
  status is `expired`, a slip whose `expires_at` has passed, and a suspended slip, each call is
  refused with its code, recorded, and leaves no draft. A slip for another agent covers nothing.
  A person who works in both companies signs a slip in org_789, and the agent's call in org_456
  is refused.
- **C2:** an envelope with `scopes`: `VALIDATION_FAILED`. Start-up with an agent login that holds
  a role exits with code 1, named, before `operations:`.
- **C3:** a second registry whose role table no longer gives user_123 `payment:create`: the
  agent's draft gets `AUTHORIZATION_DENIED`, and its record says so. A slip without
  `payment:cancel`: the agent's cancel is denied. A slip in org_456 signed by user_700, who works
  only in org_789: every call is denied.
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
  agent and company is refused by the database, torn up or not. A slip whose `expires_at` has
  passed by the database's clock gets `DELEGATION_EXPIRED`, and one dated 2099 works. The
  owner, whom row-level security does not stop, runs the slip store for org_456
  and finds only org_456's slip, so DSoR's own filter is tested too (DSOR-TEN-01b), as step
  17's payments store is.
- **C9:** the agent's PAY-901 answer has no amount, and `redactions` names `amount`.
- **C10:** a slip with no modes, and a slip with the permission `payment:*`: `INTERNAL_ERROR`,
  recorded, and no draft. The copied `delegation.schema.json` matches the original, as step 03's
  copies do.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions are recorded before any code, as
stories: what the agent hears, and what the database holds after. All four predictions describe
DSoR with the deleted check still in place. So the build runs each break as a pair: the
learner's case beside the real one.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| B1 | Line ⑤ uses the slip's list alone, and skips the signer's current rights. user_123 lost `payment:create`, and the agent asks for a draft | C3. With B1 nothing reads user_123's rights, so the draft is made, with the amount hidden | `AUTHORIZATION_DENIED`, and no draft |
| B2 | Line ③ ignores the slip's modes. The only slip says `on_behalf_of`, and the agent reads INV-1008 at night | C5. With B2 nothing reads the modes, so the read is answered, with the amount hidden | `DELEGATION_REQUIRED` |
| B3 | The slip lookup ignores the company. `firm-ap-fte` has a slip only in org_789, signed by user_700, and asks for a draft in org_456 | C1. In memory, line ③ finds org_789's slip, and line ⑤ answers `AUTHORIZATION_DENIED`, because user_700 holds nothing in org_456: a second lock, shown by a sketch on 2026-10-05. With a signer who works in both companies, a draft would be made. On the database, row-level security also hides the slip (C8) | `DELEGATION_REQUIRED` |
| B4 | Line ③ ignores the slip's status and date. `del_100` is torn up, and the agent asks for a draft | C1. With B4 nothing reads the status, so the torn-up slip passes line ③, line ⑤ allows `payment:create`, and the draft is made, with the amount hidden | `DELEGATION_REVOKED`, and no draft |

### Left open, and not this step's idea

- **Two active slips** (DSOR-DEL-09): no step on the map. The database prevents them (decision 7).
- **The source and time of the subject's authority** (DSOR-DEL-10): step 45 (decision 8).
- **A fired person's slips** (DSOR-IDN-07): no step on the map. Proposed for step 19.
- **Signing a slip through DSoR:** no step on the map. Proposed in `../mj_notes.md`.
- **Constraints:** limits from step 24. Vendors and the time window have no step (decision 6).
- **A change to the role table** counts after a restart, until step 19's directory (decision 4).
- **Token scopes:** with signed tokens, from step 43 on (decision 9).
- **Tearing up a slip, and cancelling its waiting work:** step 25.
- **Subdelegation** (DSOR-DEL-05a to 05d): no step on the map.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup itself,
this way:

1. Delete the branch `step-10`, at the learner's yes (decision 10).
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

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. `del_100` lists `payment:create`, but user_123 lost that right yesterday. What does the agent
   hear when it asks for a draft, and which line answers?
2. In step 17 the agent read invoices with no slip. Why does a read need a slip in step 18?
3. At 2 a.m. the agent calls as itself. Where does DSoR find the person it works for, and why
   never in the request?
4. Why can a slip carry no limit in step 18?
5. Two people each sign a slip for the agent. Why must DSoR not use "the first" one?

<details>
<summary>Answers</summary>

1. `AUTHORIZATION_DENIED`, from line ⑤. Line ③ finds a usable slip. Line ⑤ allows only what the
   slip lists and user_123 holds now, and user_123 no longer holds `payment:create`
   (DSOR-DEL-02).
2. The agent calls as itself, with no person present, so every call is `unattended`. DSOR-DEL-07
   accepts an `unattended` request, read or command, only under a slip that allows it.
3. In the slip: its delegator is the subject (DSOR-DEL-08). A request comes from the agent, and
   DSoR never takes the agent's word for whose authority it carries.
4. Nothing checks a limit until step 24. A slip that promised a limit that nobody checks would
   let the agent pass it, so step 18 refuses any slip that carries one.
5. The order of rows in a table would decide whose name goes on a payment. DSOR-DEL-09 refuses
   such a call instead. Step 18's database allows only one slip per agent and company.

</details>

## Think it through

_To be written after the review._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-DEL-01a | A state-changing command from an agent runs only under an active delegation in DSoR's own store | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | _To be counted._ |
| DSOR-DEL-01b | Token claims and scopes never widen a delegation | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | _To be counted._ |
| DSOR-DEL-02 | At the moment of the call, the agent may do only what all three allow: the signer's current authority, the slip, and the token's scopes | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | _To be counted._ |
| DSOR-DEL-07 | An `unattended` call is accepted only under a slip that allows `unattended` | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | _To be counted._ Early, from step 19 (decision 1) |
| DSOR-DEL-08 | In `unattended` mode, DSoR takes the person from the slip, never from the request | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | _To be counted._ Early, from step 19 (decision 1) |

## Next

Step 19 · Unattended mode and the role source. At 2 a.m., a company directory tells DSoR
whether user_123 still holds the job that the slip depends on.
