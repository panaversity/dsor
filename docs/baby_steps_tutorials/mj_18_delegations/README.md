# Step 18 · Delegations

**New in this step:** the permission slip. A person signs a slip, DSoR keeps it in its own
store, and the agent's commands run only under it. The agent never gets more power than the
person who signed holds at the moment of the call (DSOR-DEL-01a, DSOR-DEL-01b, DSOR-DEL-02).

## In plain words

A *delegation* is a permission slip from a person to an agent. user_123 signs one for
`accounts-payable-fte`: "you may create payments for org_456 until 31 December 2026". The
specification's example slip is called `del_100`.

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

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. The learner
makes them one at a time.

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
7. **One active slip per agent per company, kept by the database.** A unique index on
   `dsor.delegations` allows one `active` slip for each company and agent, so DSoR never has to
   choose between two. Choosing "the first" would let the order of rows decide whose name goes
   on a payment. DSOR-DEL-09, which refuses such a call, waits for a later step (decision 1).
   *Downside:* the agent cannot hold two slips from two people until that step, which must
   drop the index to show DSOR-DEL-09.
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

_Next session: the rules split into claims, the tests by claim, and the learner's story
predictions for the breaks._

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

_To be written with the design._

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
