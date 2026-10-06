# Step 19b · Suspended slips

**New in this step:** when a company's directory reports the person who signed a slip as
suspended, deprovisioned, or no longer listed, DSoR suspends every active slip that person
signed in that company, in its own store, and records each change (DSOR-IDN-07).

This step is not on the map of steps. The learner build split it out of step 19 (step 19's
README, decision 6), because it brings a second idea: DSoR's first write to its own slips.

## In plain words

Since step 19, DSoR asks a company's staff directory, at every call from an agent, whether the
person who signed the agent's slip still holds her job. When the directory says she is
suspended, step 19 refuses the call. But the slip itself stays `active` in DSoR's store.

A slip has a status, and `suspended` is one of them. A suspended slip is not torn up: a person
can make it active again, by hand in the database until step 25. But no agent can use it while
it is suspended, even when the signer comes back. DSOR-IDN-07 asks DSoR to suspend every slip of
a signer whom the directory reports as suspended or deprovisioned.

In the office picture: when HR says the signer is suspended, the desk stamps SUSPENDED on each
of her slips, and files a note for each one that says who stamped it, when, and why. The stamps
and the notes happen at the same moment, or none of them happens.

## Why it matters

On Monday at 10:00, HR suspends user_123 while it checks a complaint. On Tuesday at 02:00, her
agent asks to draft a payment for INV-1008, and step 19 refuses it. On Wednesday, HR makes her
active again. On Thursday at 02:00, the agent drafts PAY-901 for 31,400.00 USD. No person
decided that the agent may work again. And the slip table showed `del_100` as `active` the
whole time, so nothing in DSoR's records says that it ever stopped.

## The design, before any code

This section was written by the learner with Claude Code, before any code existed. It starts
from the understanding session of 2026-10-06 ("Step 19b, before design" in `../mj_notes.md`)
and its design questions. The specification it relies on was read on 2026-10-06:

- [§12.1](../../../specs/dsor/02-security.md#121-role-source): DSOR-IDN-07, "When the role
  source reports a delegator as deprovisioned or suspended, DSoR MUST suspend every delegation
  that principal granted." It gives no time bound, and does not say who lifts a suspension.
- [§12](../../../specs/dsor/02-security.md#12-identity-and-principals): DSOR-IDN-03b, "An
  operation MUST NOT read or write across tenants", and the principal types, `system` among
  them.
- [§13.3](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation): DSOR-DEL-04a,
  who may revoke a slip. [§18](../../../specs/dsor/02-security.md#18-operational-controls):
  DSOR-OPS-01d, who may lift an agent's suspension.
- `delegation.schema.json`: a slip's `status` is `active`, `suspended`, `revoked`, or
  `expired`.
- `audit-record.schema.json`: a record's `kind` may be `delegation_change`, and every record
  needs an `identity`.
- [§47](../../../specs/dsor/06-conformance.md#47-verification-approach): "delegator demoted or
  deprovisioned in the role source while an unattended agent runs".

If the code finds the plan wrong, the plan changes here first. The build and the review changed
it in the open: decisions 10 to 16 below. Decision 16 changed this section's word, from "hold"
to "suspend". The learner's own predictions keep the words they used.

### The intent and the outcome

**Intent.** When the directory says that a slip's signer is gone or suspended, her slips in
that company stop at once, in DSoR's own store, with a record of why, and they stay stopped
until a person lifts the suspension.

**Outcome.** What is true when this step is done:

1. On Tuesday at 02:00, `accounts-payable-fte` calls under `del_100`, and the directory says
   that user_123 is suspended. In the same call, `del_100` and `del_101` (her slip for
   `firm-ap-fte`) become `suspended`, with one `delegation_change` record each. The call is
   refused with `DELEGATION_REQUIRED`, as in step 19.
2. At 02:05 `firm-ap-fte` calls under `del_101`. Line ③ refuses it from the slip's own status,
   before the directory is asked.
3. On Thursday the directory says that she is active again. Her agents are still refused: the
   suspensions stay.
4. Her slip in org_789, if she has one, is not touched by org_456's directory.
5. If a record cannot be written, no slip changes, and the call is refused with
   `INTERNAL_ERROR`.

**Not the outcome of this step:**

- Lifting a suspension through DSoR. A person lifts one by hand in the database, as migration
  010 signs slips by hand. An operation for people waits for step 25 (decision 6).
- Finding out between calls. DSoR learns of a suspension only when an agent calls (decision 2).
- Cancelling work that waits for approval under a suspended slip: proposals come in step 22,
  and cancelling waiting work in step 25.

### What the specification asks, and what this step can honestly give

Checked on 2026-10-06:

1. **DSOR-IDN-07 asks DSoR to suspend every delegation of a reported signer.** Met for the
   company whose directory reported her, and only when one of her agents calls (decisions 1
   and 2). "Not listed" counts as gone too (decision 8), which reads the rule more widely than
   its two words.
2. **DSOR-IDN-03b forbids a write across companies.** The suspension changes only the active
   company's slips, and row-level security on `dsor.delegations` stays the second lock.
3. **DSOR-DEL-04a and DSOR-OPS-01d name who may revoke a slip, and who may lift an agent's
   suspension.** No rule names who may lift a slip's suspension. Not built (decision 6), and
   recorded as an open question.
4. **The audit record schema requires an `identity` on every record.** A `delegation_change`
   record names DSoR itself (decision 5).
5. **§28 has no code for a suspended slip** (open question 70). A suspended slip answers
   `DELEGATION_REQUIRED`, as since step 18.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-IDN-07 | **C1.** When the directory reports the signer as suspended, deprovisioned, or not listed, every active slip she signed in this company is suspended in the same call | After `accounts-payable-fte`'s call, `del_100` and `del_101` are `suspended`. The call is refused as in step 19. `firm-ap-fte`'s next call is refused from `del_101`'s status, with the directory asked 0 times |
| DSOR-IDN-07 | **C2.** A suspension survives the signer's return | The directory says `active` again, and both agents are still refused with `DELEGATION_REQUIRED` |
| DSOR-IDN-03b | **C3.** A suspension stays inside the company whose directory reported | user_123's slip in org_789 stays `active`, and org_789's own report changes only org_789's slip. On the database each lock is tested alone: row-level security, and DSoR's own `WHERE`, run by the owner |
| (our decision) | **C4.** The suspensions and their records are one transaction | The second record fails, or the database keeps no row of one: no slip changes, no record stays, and the call answers `INTERNAL_ERROR` |
| (our decision) | **C5.** Each change has a record that names DSoR, the directory's word, and the call that set it off | `kind: delegation_change`, the slip's id, `identity` with mode `direct`, subject `dsor`, an empty actor chain, `subject_authority` from the role source with the answer's time, `result: suspended`, the directory's word in `reason`, and the call's whole correlation: its request id and its agent (decision 14). Read back from the database |
| (our decision) | **C6.** DSoR's runtime login may change a slip's `status`, and only from `active` to `suspended` | As `dsor_runtime`, changing `permissions` is refused, bringing a torn-up slip back to `active` touches no row, and tearing up an active slip is refused (decision 13). `store.json` has the new kind, and start-up checks it |
| (our decision) | **C7.** Two calls at once make one change and one record | Real parallel calls on the database: each slip is `suspended`, with exactly one record |
| (our decision) | **C8.** Only slips whose status is `active` are suspended | A torn-up slip stays `revoked`, and an expired one stays `expired`, with no record, by each lock alone. A slip past its date whose status still says `active` is suspended too |
| (our decision) | **C9.** No suspension is tried for an answer DSoR cannot use, for no answer, or for a person's own call | A status `on_leave` gives step 19's `INTERNAL_ERROR`, and the store is asked for no suspension. So does a directory that is off. user_123's own call asks no directory |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. The learner made
decisions 1 to 8 on 2026-10-06, one at a time, choosing by two tests: the closest to
production, and the deepest understanding. Before them, the learner named the folder
`mj_19b_suspended_slips`, with the spec's own word. Decision 9 set up Neon at the start of the
build. The build then checked this design against the specification, the schemas, and step
19's code, before the first test, and found one gap: decision 10. Planning the program found a
second one: decision 11. Writing the database tests found a third: decision 12. The hostile
review found four more, and the learner chose each fix: decisions 13 to 16.

1. **Only the reporting company's slips.** When org_456's directory reports user_123, her
   slips in org_456 are suspended. Her slip in org_789 is decided by org_789's own directory,
   at org_789's next call. Each company's role source speaks only for that company
   (DSOR-IDN-04a), and an operation never writes across companies (DSOR-IDN-03b). *Downside:*
   it reads "every delegation" as "every delegation in this company", which is our reading
   and goes to the open questions.
2. **Only at a call.** DSoR learns of a suspension when one of her agents calls, as in step
   19. *Downside:* a suspension that starts and ends between two calls is never seen. Suspended
   on Monday, active again on Wednesday, and a weekly run on Thursday: nothing is suspended.
   The production answer, a push from the directory or a regular sweep, waits for a later
   step.
3. **DSoR's runtime login may change `status` only.** `GRANT UPDATE (status)` on
   `dsor.delegations`, and a new kind in `store.json` that start-up checks: read the table,
   and change it through named columns only. The database refuses a change to any other
   column. *Downside:* a right on a column does not limit the words written into it. The
   review found that a bug could write `active` over `revoked`, and decision 13 closes that.
4. **The suspensions and their records are one transaction, at line ③.** Line ③ writes the
   suspensions and their `delegation_change` records together, then refuses. Line ⑪ writes
   the call's own record in its own transaction, as for every call. *Downside:* if line ⑪ then
   fails, the log holds the suspensions' records without the call's own record, and the
   caller hears `EVIDENCE_STORE_UNAVAILABLE`.
5. **The record names DSoR itself.** Mode `direct`, subject `dsor` (DSoR as a principal of type
   `system`), an empty actor chain, and `subject_authority` from the role source, as of the
   directory's answer. Its correlation is the call's (decision 14), and its reason is the
   directory's word, for the people who read the log and never for the agent. *Downside:*
   `dsor` is a name that no login has, so a reader must know that it means DSoR.
6. **No lift through DSoR yet.** In the tests, the database owner lifts a suspension by hand.
   An operation for people waits for step 25, the first step that lets a person change a slip.
   *Downside:* in this step a returning person's agent stays stopped until somebody changes
   the row by hand.
7. **A suspension that cannot be confirmed gives `INTERNAL_ERROR`.** The transaction rolls
   back, so nothing is half-written, and the call's record shows the fault, so a person sees
   it. The message says that DSoR could not confirm the suspension, because a database that
   committed and then lost its answer leaves the slips suspended after all. Found by the
   review: the first message said "could not put". *Downside:* the agent hears "DSoR is
   broken", not "your signer cannot be used", with the retry class `never`.
8. **"Not listed" counts as gone.** When the directory does not list the signer at all, her
   active slips in this company are suspended too, and the call is refused as in step 19, with
   `AUTHORIZATION_DENIED`. Login systems often delete a person who leaves, and a re-created
   account must not quietly revive her agent. *Downside:* it reads DSOR-IDN-07 more widely than
   its two words. And a directory that answers "not listed" by mistake, with a wrong key or a
   slow copy of its people, now suspends every slip whose agent calls, and only a person can
   lift them. In step 19 the same fault refused calls only while it lasted. Found by the review.
9. **Neon: the learner deleted `step-12`, and `step-19b` comes from `step-19`.** All ten
   branches were in use, and only `step-12` and `step-19` had no child branch. *Downside:* step
   12's folder cannot run its database tests until somebody makes it a branch again, as with
   steps 13 and 14.
10. **Only a decision needs `authorization`.** The log's `"authorization"` column is `NOT NULL`
    and must say `ALLOW` or `DENY` (migration 001), and a `delegation_change` record is not a
    decision: nothing was allowed or denied. The new migration drops `NOT NULL`, and adds a
    check that a record of kind `decision` still says `ALLOW` or `DENY`. A `delegation_change`
    record leaves it empty, as the spec's audit-record schema allows. *Downside:* the migration
    changes a rule that step 09 set, and the check reads "if a decision, then required".
11. **The program shows a suspension in memory.** A suspension in the shared database is
    permanent, and nothing in DSoR lifts one (decision 6). If `pnpm start` suspended `del_100`
    on Neon, the next run's first call from the agent would be refused. So the program tells
    the whole story on Neon as before, and for the suspension it builds a second registry with
    the slips and the directory in memory, and says so in its output. The database tests prove
    the real suspensions. *Downside:* `pnpm start` does not show a suspension written to the
    real database.
12. **DSoR's own log reader reads decisions only.** `dsor.audit` now holds two kinds of record,
    and the reader that the program uses, `records` in `src/postgres.ts`, is typed to return
    decisions. A suspension's record has no `authorization`, so it is not a decision. The
    reader adds `kind = 'decision'` to its `WHERE`, and the people who read the records of
    suspensions use SQL, as the database tests do. Found by a test that read the log back with
    DSoR's own reader: it got the call's decision and both suspensions, typed as decisions.
    *Downside:* the program cannot print a suspension's record through DSoR's own reader. A
    reader for people waits for a later step.
13. **The database allows one change: `active` to `suspended`.** Migration 012b adds a
    restrictive row-level security policy on `dsor.delegations`, for `dsor_runtime`'s
    `UPDATE`: it may touch an active slip only, and must leave it `suspended`. Restrictive
    means that it narrows the company's own policy, and both must agree. So a torn-up slip
    stays torn up whatever DSoR's code does, and C8 has two locks, as C3 has. The owner, who
    lifts a suspension by hand, passes every policy. Found by the review, which showed that
    decision 3 alone let a bug write `active` over `revoked`. *Downside:* one more policy that
    start-up does not check. Start-up checks that row-level security is on, not which policies
    exist. The database tests list every policy, and its kind, exactly.
14. **The record carries the call's whole correlation.** Its request id and its agent, as the
    call's own record has them (DSOR-COR-01a). Found by the review: the record carried only the
    request id, which the agent writes itself, and left out `agent_id`. *Downside:* the request
    id is still the agent's own text. An id that DSoR makes for every call would change every
    record, not only these, and waits for a later step.
15. **An answer that says she is not active needs no roles.** DSoR reads the roles of an active
    signer only. A directory often sends none for a person it removed, and step 19 called such
    an answer "something DSoR cannot use", so nothing was suspended, and her agent worked again
    when she came back. Now her slips are suspended. Roles that are there must still be a list
    of words. Found by the review. *Downside:* step 19's check of an answer gets one exception.
16. **The word is "suspend", not "hold".** The design said "hold" and "on hold". In this
    repository, "holds" already names something else: `AGENTS.md` lists them in the
    control-plane store, and the specification uses `RESOURCE_HELD` and `hold_on_unknown` for
    resources held while an outcome is unknown. `AGENTS.md` says not to repurpose a term, so
    the code, the tests, and this README use the rule's own word, which is also the folder's.
    Found by the review. *Downside:* the notes of the understanding session, and the learner's
    predictions below, keep "on hold" as they were written.

What follows from these, with no decision of its own:

- A suspension is tried whenever a usable answer, fresh or kept, says suspended, deprovisioned,
  or not listed. "Only if still active" makes a retry harmless.
- A strange answer (step 19's decision 11) suspends nothing, because DSoR cannot read it. No
  suspension is even tried.
- A torn-up or expired slip is never suspended. A slip past its date whose status still says
  `active` is suspended: line ③ refuses it either way, and if a person later moves its date,
  it stays stopped. Found by the review.
- The build needs a migration: the `UPDATE (status)` right, a wider check on the log's `kind`,
  which accepted only `decision` before this step (migration 001), and decision 10's check. The
  review added a second migration, 012b, for decision 13.
- `store.json` gives `dsor.delegations` a new kind: DSoR's own records that it reads, and
  changes through named columns only. Its right is written as `app.payments` writes its own
  (step 17): `"columns": { "UPDATE": ["status"] }`.
- Line ③ asks the directory as in step 19. When the answer says suspended, deprovisioned, or
  not listed, line ③ writes the suspensions and their records in one transaction, and then
  refuses. It names its own company and signer: the refusal carries only the directory's word
  and time, because DSoR does not trust its own parts to keep a company (step 10's README,
  decision 14). Found by the review.
- The slips in memory, which the unit tests use, learn to suspend a slip, as the database does.
- Every database test and every run of the step uses one Neon branch, and a suspension there is
  permanent. A suspension of user_123's slips would stop every later test and run that uses
  them. So a test that suspends slips uses a signer of its own, a person that only that test
  knows. No suspension reaches user_123's slips there. Found by the build: an earlier version of
  this line gave the reason as "the test files run at the same time", and they run one at a
  time.

### The tests, by claim

Unit tests in `test/suspended-slips.test.ts`, 20 of them, with a slip store and a log in memory:
C1 with all three words and their records, the second agent refused before the directory is
asked, only her own slips, and the store's own answer to a second suspension; decision 15; C2;
C3 in both directions; C4's answer to the caller, and a retry from a kept answer; C8, with a
slip past its date; and C9, where the store counts every suspension asked of it. And in
`test/store-map.test.ts`, the new kind's refusals.

Database tests in `test/suspended-slips.db.test.ts`, 25 of them: C1 and C5 read back; decision
12's reader; C2 with a lift by hand; C3 and C8, each through a real call and by each lock alone;
decision 13's policy; C4 with a record that fails, and with a record the database keeps no row
of, both by fault injection around the real client; C6 as `dsor_runtime`; decision 10's checks
on the log; and C7 with real parallel calls. And `test/rls.db.test.ts` lists the new policy,
and its kind, exactly.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded on 2026-10-06, before
any code, as stories, each with the facts it needs. B1, B2, and B4 match the expected answer.
B3 describes DSoR with "only if still active" still in place. So the build runs each break as a
pair: the learner's case beside the real one.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| B1 | Line ③ still refuses, but writes no suspension. user_123 is suspended on Monday, her agent calls on Tuesday, she is active again on Wednesday, and her agent asks for a draft on Thursday | C2. With B1 nothing is suspended, so on Thursday the draft is made, and `del_100` is `active`: step 19's own gap | The draft is made, and `del_100` stays `active` |
| B2 | The suspension's statement loses its company filter. user_123 also signed `del_103` in org_789, and org_456's directory reports her as suspended | C3. In memory, `del_103` is suspended, and a unit test fails. On the database, row-level security hides org_789's rows from org_456's transaction, so `del_103` stays `active`: the second lock holds | `del_103` stays `active` |
| B3 | The suspension's statement loses "only if still active". `del_101` was torn up last week | C8. `del_101` becomes `suspended`: a torn-up slip turned into a suspended one, which a person could later lift | `del_101` stays `revoked` |
| B4 | The suspensions and their records go in two transactions. The suspensions commit, and then the second record fails | C4. Both slips are `suspended`, and the records' transaction rolled back, so no record says why | Both slips on hold, and no records |

### Left open, and not this step's idea

- Who may lift a suspension, and how: step 25 at the earliest (decision 6).
- A call that heard "suspended" just before a person lifted the suspension, and then suspends
  the slip again. It needs a lift to exist first.
- Finding out between calls: a push from the directory, or a sweep (decision 2).
- Cancelling waiting work under a suspended slip: steps 22 and 25.
- Questions for the specification: who may lift a slip's suspension; whether a report from one
  company's role source reaches the person's slips in another; how fast the slips must change;
  whether "not listed" counts as deprovisioned.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Neon allows ten branches, and all ten
are in use. Only `step-12` and `step-19` have no child branch, and step 19b is built from
`step-19`. So:

1. The learner deletes `step-12` (decision 9). Claude Code deletes no data.
2. Create a branch `step-19b` **from `step-19`**, with `neonctl branches create`.
3. Write `.env` with `neonctl connection-string --role-name neondb_owner`, sending its output
   into the file and never printing it, as step 19 did.
4. Run `pnpm migrate`. Only this step's new migrations run: 012, and 012b, which the review
   added (decision 13).
5. Check without looking: `pnpm test:db` passes, and the transcript holds no `postgresql://`
   with a password in it.

## What changed since step 19

| File | What changed |
| --- | --- |
| `migrations/012_suspended_slips.sql` | **New.** `dsor_runtime` may change a slip's `status`, and no other column (decision 3). The log takes a second kind of record, `delegation_change`, and only a decision must say `ALLOW` or `DENY` (decision 10) |
| `migrations/012b_suspend_only.sql` | **New.** A restrictive policy: `dsor_runtime` may change a slip only from `active` to `suspended` (decision 13) |
| `src/suspensions.ts` | **New.** Line ③'s suspension. When the directory reports the signer as gone, her active slips in this company are suspended, for line ③'s own company and signer, and then the call is refused as in step 19. A suspension that cannot be confirmed gives `INTERNAL_ERROR` (C1, C4, decisions 4 and 7) |
| `src/authority.ts` | The refusal for a signer who is suspended, deprovisioned, or not listed is now a `SignerGone`. It has the same code and message as in step 19, and it also carries the directory's word and the time of its answer (decision 4). An answer that says she is not active needs no roles (decision 15) |
| `src/pipeline.ts` | Line ③ gives a `SignerGone` to the suspension, with its own company, its signer, and the call's correlation, before the refusal goes on |
| `src/slips.ts` | The slip store can now `suspend`. The slips in memory suspend too, and keep the records of their suspensions |
| `src/postgres.ts` | The database's `suspend`: one `UPDATE` that changes only this signer's active slips in this company, and one record for each slip, in one transaction (C7, C8). DSoR's own log reader reads decisions only (decision 12) |
| `src/log.ts` | The record of a suspension, `delegation_change`, which names DSoR itself and carries the call's correlation (decisions 5 and 14) |
| `src/store.ts`, `store.json` | A new kind in the map of the store, `control-written`: DSoR's own records that it reads, and changes through named columns only. `dsor.delegations` is one (decision 3) |
| `src/main.ts` | The night on the database has no suspension now. The suspension is told in memory, with the two slips copied from the database (decision 11) |
| `test/suspended-slips.test.ts`, `test/suspended-slips.db.test.ts` | **New.** C1 to C9 |
| `test/owner-slips.ts` | The owner's program can now suspend a test signer's slips through DSoR's own store, lift the suspensions by hand, read the slips, and remove them. It refuses to suspend or remove the story's people's slips |

Some old tests changed with the step, because this step makes them untrue. Each has a one-line
reason in the test:

- `test/role-source.test.ts`: step 19's ten tests that said "`del_100` stays active" now say
  it is suspended. Its test of a kept answer now uses a store that suspends nothing, because a
  suspension refuses first and would hide the kept answer.
- `test/slips.test.ts`: six stores that the tests make by hand now have a `suspend` that
  suspends nothing.
- `test/store-map.test.ts`, `test/catalogs.ts`: the map's new kind, and the runtime's new
  right on `status`. The new kind's refusals are new tests.
- `test/rls.db.test.ts`: the list of every policy gains `suspend_only`, and each policy's kind:
  permissive or restrictive.
- `test/audit.db.test.ts`: `dsor_runtime`'s list of privileges now includes `UPDATE (status)`.
- `test/program.db.test.ts`: the lines of the suspension in memory, 25 calls and 22 records instead of
  26 and 23, and a check that `del_100` and `del_101` are still `active` after a run.

Four files in `src` and thirteen test files lost only step 19's `NEW IN STEP 19` markers. Their
code did not change. `test/helpers.ts` lost its markers too, and one capital letter that the
removal had put on `ap_clerk`.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_19_unattended_mode_and_the_role_source/src mj_19b_suspended_slips/src
```

```bash
git diff --no-index mj_19_unattended_mode_and_the_role_source/test mj_19b_suspended_slips/test
```

## Run it

From this folder, with `.env` written as in "Before you build":

```bash
pnpm install
```

```bash
pnpm check
```

```bash
pnpm migrate
```

```bash
pnpm start
```

```bash
pnpm test:db
```

`pnpm check` runs the typecheck and 1335 unit tests. `pnpm migrate` runs migrations 012 and
012b, once. `pnpm test:db` runs 190 database tests on Neon, in about 20 minutes from Pakistan.
`pnpm start` takes about a minute.

The program tells step 18's story first, unchanged. Then the night, on the database, and then
the suspension, in memory. This is real output from 2026-10-06, on the final code. The draft's
number comes from the database, and goes up with every run:

```text
night, the agent drafts: answered, PAY-1340
its record's identity: {
  mode: 'unattended',
  subject: 'user_123',
  actor_chain: [ 'accounts-payable-fte' ],
  subject_authority: { as_of: '2026-10-06T14:53:28.814Z', source: 'role_source' }
}
ap_clerk, the agent drafts: AUTHORIZATION_DENIED: "payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now
ap_clerk, the agent reads: answered, INV-1008
ap_supervisor again, the agent reads: answered, INV-1008
directory off, the agent reads: answered, INV-1008
after a restart, the agent reads: FRESHNESS_UNSATISFIABLE: "invoice.get": DSoR has no answer about user_123, who signed slip del_100, from the directory of org_456 that is recent enough
after a restart, user_123 reads: answered, INV-1008
the suspension, in memory, so the database's slips stay active:
  suspended, the agent reads: DELEGATION_REQUIRED: "invoice.get": slip del_100 is signed by user_123, whom the directory of org_456 does not list as active
  del_100 is suspended, on the directory's word: suspended
  del_101 is suspended, on the directory's word: suspended
  the firm's agent reads: DELEGATION_REQUIRED: "invoice.get": slip del_101 is suspended, not active (the directory was asked 0 times)
  active again, the agent reads: DELEGATION_REQUIRED: "invoice.get": slip del_100 is suspended, not active
```

- The night on the database is step 19's, without the suspension. A suspension there would be
  permanent, and the next run's agent would be refused (decision 11).
- The suspension is told in memory, with `del_100` and `del_101` copied from the database. The
  directory says that user_123 is suspended. The agent hears what it heard in step 19, and
  both her slips are suspended, with one record each (outcome 1).
- The firm's agent calls under `del_101`. Line ③ refuses it from the slip's own status, and
  the directory is not asked (outcome 2).
- The directory says that she is active again. Her agent is still refused: the suspension
  stays until a person lifts it (outcome 3).

The log's lines for the night, and the program's last count:

```text
9945 payment.create@1 ALLOW ok org_456
9946 payment.create@1 DENY AUTHORIZATION_DENIED org_456
9947 invoice.get@1 ALLOW ok org_456
9948 invoice.get@1 ALLOW ok org_456
9949 invoice.get@1 ALLOW ok org_456
9950 invoice.get@1 DENY FRESHNESS_UNSATISFIABLE org_456
9951 invoice.get@1 ALLOW ok org_456
25 calls answered, so 25 records were written. dsor_runtime reads 22 of them, in org_456 and org_789, and cannot read the other 3
```

The calls of the suspension in memory have a log in memory, so they are not in this count.
After a run, `del_100` and `del_101` are still `active` in the database, and
`test/program.db.test.ts` checks it.

## Break it

Each break was made in a copy of the step outside the repository, never in the step itself.
Each story ran on the copy's own code, beside the same story on the step as built. Then the
whole unit suite ran on the copy, and the new database tests ran with signers of their own. All
four ran first on the code before the review, against Neon. They ran again on the final code,
after the review's fixes, against a scratch PostgreSQL with the step's own migrations, and the
output below is from that second run. The scripts are not part of the step. The learner
predicted each break before any code existed ("Breaks we will try" above), and each prediction
stands beside the real run here.

**B1: line ③ still refuses, but writes no suspension.** In `src/suspensions.ts`, the call to
`slips.suspend` is gone. user_123 is suspended on Monday, her agent reads on Tuesday, she is
active again on Wednesday, and on Thursday her agent asks for a draft.

```text
the step as built
Tuesday, the agent reads:    DELEGATION_REQUIRED: "invoice.get": slip del_100 is signed by user_123, whom the directory of org_456 does not list as active
Thursday, the agent drafts:  DELEGATION_REQUIRED: "payment.create": slip del_100 is suspended, not active
del_100 is suspended | drafts made: 0

with B1
Tuesday, the agent reads:    DELEGATION_REQUIRED: "invoice.get": slip del_100 is signed by user_123, whom the directory of org_456 does not list as active
Thursday, the agent drafts:  answered, PAY-901
del_100 is active | drafts made: 1
```

On Tuesday the two answers are the same, so the agent cannot tell a suspension from none. 24 of
1335 unit tests fail, and 9 of the 25 new database tests. The learner predicted the draft, and
`del_100` still active. That is what happened. The typecheck also complained, but only because
the parameter `slips` was no longer read. A break that still read it would pass the typecheck.

**B2: the suspension loses its company filter.** `s.tenant === tenant` leaves the memory
store's filter, and `tenant_id = $1` leaves the database's `WHERE`. user_123 also signed
`del_103` in org_789, and org_456's directory reports her as suspended.

```text
the step as built, in memory
del_100 is suspended | del_101 is suspended | del_103 (org_789) is active

with B2, in memory
del_100 is suspended | del_101 is suspended | del_103 (org_789) is suspended
```

On the database, a call's suspension runs inside org_456's transaction, and row-level security
hides org_789's rows from it. So the signer's org_789 slip stayed `active`, and the test of C3
through a real call passed on the broken copy: the second lock held. The test of DSoR's own
filter caught the break. In it the owner, whom no policy stops, runs DSoR's statement, and the
statement suspended her org_789 slip too:

```text
- Expected
+ Received

  {
    "suspended": [
      "del_19b-7373689d-1",
      "del_19b-7373689d-2",
+     "del_19b-7373689d-3",
    ],
  }
```

2 unit tests of C3 fail, and 1 database test. The learner predicted that `del_103` stays
`active`. That is true on the database, because of the second lock. In memory, with no second
lock, it was suspended. Each lock has a test of its own, so a break of one is seen while the
other still holds.

**B3: the suspension loses "only if still active".** `s.status === "active"` leaves the
memory store's filter, and `AND status = 'active'` leaves the database's `WHERE`. `del_101` was
torn up last week, and user_123 is suspended.

```text
the step as built
del_100 is suspended | del_101 is revoked | records of suspensions: del_100

with B3
del_100 is suspended | del_101 is suspended | records of suspensions: del_100, del_101
```

The learner predicted that `del_101` stays `revoked`. That is the answer of the step as built,
not of B3. With B3, the memory store's filter matches every slip she signed, whatever its
status. A torn-up slip becomes a suspended one, and a person who lifts the suspension later
brings back a slip that user_123 tore up herself. 2 unit tests fail: C8, and the store's own
answer to a second suspension.

On the database, B3 is now caught only where no policy stands behind DSoR. Before the review,
it was also caught by the test of two calls at once: the second call suspended both slips
again, and each slip had 2 records. After decision 13, the database's own policy lets an
`UPDATE` touch active slips only, so that test passed on the broken copy, and so did the test
of C8 through a real call: the second lock held. The test of DSoR's own status filter caught
it, run by the owner, whom no policy stops. The statement suspended her torn-up slip (`-4`) and
her expired one (`-5`):

```text
- Expected
+ Received

  {
    "suspended": [
      "del_19b-b429f43e-1",
      "del_19b-b429f43e-2",
+     "del_19b-b429f43e-4",
+     "del_19b-b429f43e-5",
    ],
  }
```

**B4: the suspensions and their records in two transactions.** In `src/postgres.ts`, the
suspension commits right after its `UPDATE`, and the records go in a second transaction. The
second record fails, by fault injection, as in C4's test. What the database held after the
call, for the signer that the test made:

```text
heard: INTERNAL_ERROR: DSoR could not confirm that this agent's slip is suspended, so it refuses the call
slips: suspended, suspended
records of suspensions: 0
```

With the step as built, the same story leaves both slips `active`, and no record. No unit test
fails, because the slips in memory have no transaction to split. 2 database tests catch it: the
test of C4, and the test of a record the database keeps no row of.

```text
  [
    {
      "id": "del_19b-c8209dab-1",
-     "status": "active",
+     "status": "suspended",
    },
    {
      "id": "del_19b-c8209dab-2",
-     "status": "active",
+     "status": "suspended",
    },
  ]
```

The learner predicted both slips on hold, and no records. That is what happened: two suspended
slips, and nothing in the log that says why. The agent hears "could not confirm", and that is
the honest word here: the suspensions stayed, and the error that DSoR got does not say so.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Understand | A session with no code, on 2026-10-06: "Step 19b, before design" in `../mj_notes.md` |
| 2 | Design | "In plain words", "Why it matters", and "The design, before any code": decisions 1 to 8, one per turn, each judged by the learner's two tests, closest to production and deepest understanding. Then the predictions for B1 to B4, asked as stories |
| 3 | Check the design | Against the specification, the schemas, and step 19's code, before the first test. The log's `authorization` could not be empty, so a record of a suspension could not be written: decision 10. Planning the program found that a suspension on Neon would be permanent: decision 11 |
| 4 | Neon | Decision 9: the learner deleted `step-12`, because Claude Code deletes no data. A branch `step-19b` from `step-19`. `.env` written by a command, never shown |
| 5 | Migration and map | Step 19's markers removed. Migration 012, and the map's new kind. Then the four database test files that read the grants or the map ran again |
| 6 | Red | Shells: the new types, and a store method that suspended nothing (then named `hold`), so DSoR behaved as in step 19 and each new test failed on what it checks. Then every new test |
| 7 | Green | `SignerGone`, the new file (then `src/holds.ts`), and the suspension in both stores. The test of DSoR's own reader failed at its own check first. Then decision 12 went to the learner, and its filter made it pass |
| 8 | The program | The night on the database without a suspension, and the suspension in memory. Then `pnpm start` ran once, and the story's slips were read on Neon: still `active` |
| 9 | Break it | Each break in a copy outside the repository, beside the step as built. The learner's prediction about two calls at once was settled with a scratch PostgreSQL: "Think it through" |
| 10 | Review | Two reviewers who had not seen the conversation: one attacked the rules and the code, and one made 33 small breaks in a copy outside the repository, against a scratch PostgreSQL. The learner chose each fix: decisions 13 to 16. Then a second sweep of 18 breaks, breaks B1 to B4 again, and the database suite on Neon, all on the final code |

The build continued from the design in the same session, with the learner's "go" before each
move, and nothing was committed. To start it in a new session:

```text
Build step 19b in learner mode from the design in
docs/baby_steps_tutorials/mj_19b_suspended_slips/README.md.
```

The learner's predictions, and what each break really did, are under "Break it".

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Migration and map | 1 old database test: `DSOR-AUD-04a` types out `dsor_runtime`'s privileges, and it gained `UPDATE (status)` |
| Red | 11 of 14 new unit tests and 8 of 14 new database tests. 10 old unit tests: step 19's "`del_100` stays active" became "is suspended". Six stores that tests make by hand needed the new method (then named `hold`) before the typecheck passed |
| Green | 1 new database test, DSoR's own reader, until decision 12 |
| The program | None. Its database test changed with it: 25 calls, and the slips still `active` after a run |
| The review's fixes | 2 old database tests: step 11's two lists of the row-level security policies, which gained `suspend_only` and each policy's kind. The review's own tests were written with their fixes, not red first. The second sweep shows that each one fails without its fix: 18 breaks, 18 caught |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. On Tuesday at 02:00 the directory says that user_123 is suspended, and her agent's call
   suspends `del_100` and `del_101`. On Thursday the directory says she is active again. What
   does `accounts-payable-fte` hear on Thursday, and from which check?
2. The directory says that user_123 has been deprovisioned. Is `del_100` revoked afterwards?
3. user_123 also signed a slip in org_789. org_456's directory reports her as suspended. What
   is the status of her org_789 slip afterwards?
4. The second `delegation_change` record fails. Which slips are suspended afterwards?
5. A bug in DSoR runs `UPDATE dsor.delegations SET status = 'active' WHERE id = 'del_101'`, as
   `dsor_runtime` inside org_456, the day after user_123 tore `del_101` up. What does the
   database do?

<details>
<summary>Answers</summary>

1. `DELEGATION_REQUIRED`, from line ③'s check of the slip's own status, before the directory
   is asked. The suspension stays until a person lifts it.
2. No. It is `suspended`: DSOR-IDN-07 suspends, for "deprovisioned" too. Only a person tears a
   slip up (DSOR-DEL-04a).
3. Still `active`. Only org_789's own directory speaks for org_789 (decision 1).
4. None. The suspensions and their records are one transaction, so the database undoes them
   all (decision 4), and the call answers `INTERNAL_ERROR` (decision 7).
5. It changes no row. Decision 13's policy lets `dsor_runtime`'s `UPDATE` touch an active slip
   only, and `del_101` is `revoked`. An `UPDATE` that changed an active slip to anything but
   `suspended` would be refused with an error.

</details>

## Think it through

Two reviewers who had not seen the conversation looked at the step once it was green. One
attacked the rules and the code. The other, a sweep, made one small break at a time in a copy
outside the repository, and ran every test against each break. The learner chose each fix:
decisions 13 to 16.

**What the review found, and what changed.**

| # | Found | Fixed by |
| --- | --- | --- |
| R1 | `GRANT UPDATE (status)` let `dsor_runtime` write any word into a slip's status. A bug could bring a torn-up slip back to `active`, and decision 3 said that even a bug could not widen a slip | Decision 13: a restrictive policy, migration 012b, tried first on a scratch database |
| R2 | The record of a suspension carried only the request id, which the agent writes itself, and left out `agent_id`, which DSOR-COR-01a asks every audit record to carry | Decision 14 |
| R3 | No database test had a torn-up or expired slip, so `status <> 'suspended'` passed every test. Nothing tested migration 012's two checks on the log, the new kind's refusals, or a record that the database keeps no row of | New tests. Each one now fails without its fix |
| R4 | The message said that DSoR "could not put" the slip on hold. A database that committed and then lost its answer leaves the slips suspended | Decision 7: "could not confirm" |
| R5 | C8 said "an expired one stays expired", and on the database a slip past its date usually still says `active` | C8's wording, and a test: such a slip is suspended too |
| R6 | A directory that sends no roles for a removed person gave `INTERNAL_ERROR`, so nothing was suspended | Decision 15 |
| R7 | Decision 8's downside left out a directory that answers "not listed" by mistake | Decision 8's text |
| R8 | The suspension took its company and its signer from the refusal, a part of DSoR, and not from line ③ | Line ③ passes its own company and signer (step 10's README, decision 14) |
| R9 | "Hold" already names something else in the specification | Decision 16 |
| R10 | Seven sentences that were untrue or unclear. An analogy whose "same drawer" did not fit, because the slip and its note are in different tables. `Ap_clerk`, which removing a marker had capitalised | Fixed |

**What the sweep found.** The first sweep made 33 small breaks, and a test failed for 24 of
them. 9 survived:

- A suspension was tried on any refusal. It changed nothing, but the tests of C9 checked only
  that nothing changed. Now they count every suspension asked of the store.
- Every suspension happened in org_456. Now a report from org_789's directory is tested.
- Nothing read the store's own answer. Now a second suspension of the same slips answers none.
- Three gaps that the review named too: a record that keeps no row, the new kind's refusals,
  and a decision with no `authorization` (R3).
- Two breaks that change only the order of the ids. They are equivalent: no rule asks for an
  order, and the sort stays only so that the log reads the same way each time.

After the fixes, a second sweep made 18 breaks: the seven survivors that matter, and eleven
breaks of the fixes themselves. Among them were the policy made permissive, which would let
`dsor_runtime` suspend active slips in every company, and the reviewer's `status <> 'suspended'`.
A test failed for each of the 18.

**What the build taught.**

- **Two calls at once.** The learner predicted that the database cancels both. A scratch
  PostgreSQL ran the same two transactions three ways:

  | Run | The second call's `UPDATE` | Records for `del_100` |
  | --- | --- | --- |
  | As built: READ COMMITTED, PostgreSQL's default | waited for the first, then changed nothing | 1 |
  | The learner's case: SERIALIZABLE, which does cancel on a collision | cancelled: `40001 could not serialize access due to concurrent update` | 1 |
  | Without "only if still active" | waited, then changed both slips again | 2 |

  A database does cancel on a collision, but one side always wins, and its records stay. At the
  default level the second `UPDATE` waits, reads the row again, and checks its `WHERE` again:
  `AND status = 'active'` decides. It is the last hotel room: the second clerk finds the hook
  empty.
- **A right on a column limits the column, not the words written into it** (R1). The policy is
  the lock for the words.
- **A test that lists every policy must say each one's kind.** Step 11's list named each
  policy's command, roles, and rule. A permissive `suspend_only` would have passed it, and
  reached every company's active slips. Now the list names the kind too.
- **Migration 012 ran four minutes into the first database run,** so that run proved less than
  it seemed. Running again the four files that the migration touches found the one stale fact:
  `DSOR-AUD-04a`'s list of `dsor_runtime`'s privileges.
- **The database test files run one at a time** (`fileParallelism: false` in
  `vitest.db.config.ts`). So the reason for a signer of its own in each test is that a
  suspension is permanent, not that the files run at the same time.
- **A scratch PostgreSQL for the sweep.** The whole database suite ran in 44 seconds there,
  against 20 minutes on Neon, and breaks that would have suspended the story's slips on the
  shared branch ran safely. It behaved like Neon after two changes: the owner joins
  `pg_write_all_data`, and the cluster checks passwords.

**Left open on purpose.**

- Start-up checks that row-level security is on, not which policies exist (open question 80).
  The database tests list every policy, and its kind, exactly.
- An id for every call that DSoR makes and the agent cannot choose (decision 14, open question
  81).
- A call that read its slip as active just before another call suspended it, and then heard
  "active" from the directory, still runs. The gap is at most DSoR's 2-second wait for the
  directory.
- The questions for the specification: who may lift a slip's suspension, whether one company's
  report reaches the signer's slips in another, how fast the slips must change, and whether
  "not listed" counts as deprovisioned (open questions 76 to 79).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-IDN-07 | When the role source reports a signer as deprovisioned or suspended, DSoR suspends every slip that person granted | [§12.1 Role source](../../../specs/dsor/02-security.md#121-role-source) | Partly: the reporting company's slips, at a call (decisions 1 and 2), and "not listed" too (decision 8). 9 unit tests in [`test/suspended-slips.test.ts`](test/suspended-slips.test.ts), 4 database tests in [`test/suspended-slips.db.test.ts`](test/suspended-slips.db.test.ts), and step 19's 10 tests in [`test/role-source.test.ts`](test/role-source.test.ts) that now say `del_100` is suspended |
| DSOR-IDN-03b | An operation does not read or write across companies | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | The suspensions only: 2 unit tests, one for each direction, and 1 database test |
| DSOR-TEN-01b | A company is kept apart by two layers, DSoR and the store | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | Since this step, for a write to `dsor.delegations` too: 2 database tests, each lock alone. Decision 13 adds a second lock for the status of a slip, with 6 database tests |

## Next

Step 20 · Idempotency keys. Networks fail and clients retry: the caller attaches a unique key,
and DSoR claims it with one database insert.
