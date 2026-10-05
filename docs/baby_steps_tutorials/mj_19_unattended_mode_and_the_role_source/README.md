# Step 19 · Unattended mode and the role source

**New in this step:** the role source. When the agent calls at night, DSoR asks the company's
staff directory whether the person who signed the slip still holds her job. When it cannot
get a fresh enough answer, it refuses (DSOR-IDN-05, DSOR-IDN-06).

## In plain words

At 2 a.m. nobody is logged in. The agent `accounts-payable-fte` logs in as itself and works
under `del_100`, the slip that user_123 signed. The specification calls such a call
`unattended`. Since step 18, DSoR takes the person from the slip, never from the request.

The slip is only half of the agent's power. The other half is what user_123 may do *now*. She
is asleep, so her login is not part of the request, and DSoR must ask somebody else. That
somebody is the company's *role source*: usually its staff directory, the system that knows
who works there, and in which job.

Each company connects its own role source. DSoR asks it about the signer at every call from
the agent. If the directory does not answer, DSoR may use the last answer it got, but only
while that answer is younger than a limit the company sets. In this step the limit is one
hour for org_456. With no answer young enough, DSoR refuses.

## Why it matters

In step 18, DSoR read user_123's roles from its own login table, which it loads once at
start-up. On Monday at 10 a.m., she moves to a job where she may only read invoices. Nothing
tells DSoR. That night the agent drafts PAY-901 for 31,400.00 USD under her slip, and the
record says that user_123 allowed it. The specification's own example ends the same way: the
agent "keeps paying vendors under her authority for months" (§12.1).

The second failure is quieter. The directory is down for a day. If DSoR lets the agent through
whenever it cannot ask, then a person who was moved, or fired, keeps an agent that works for
as long as the directory stays down. The threat table of the specification calls this T18,
*stale authority*.

## The design, before any code

This section was written by the learner with Claude Code, before any code existed. It starts
from the understanding session of 2026-10-05 ("The foundations course, and step 19 before
design" in `../mj_notes.md`) and its design questions. The specification it relies on was
read on 2026-10-05:

- [§12](../../../specs/dsor/02-security.md#12-identity-and-principals): the security context.
  Its `subjectAuthority` says where the subject's authority came from, `token` or
  `role_source`, and as of when.
- [§12.1](../../../specs/dsor/02-security.md#121-role-source): its "In plain words", and
  DSOR-IDN-04a, DSOR-IDN-04b, DSOR-IDN-05, DSOR-IDN-06, and DSOR-IDN-07.
- [§13.2](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire): the table of
  identity modes, DSOR-DEL-07, and DSOR-DEL-08.
- [§21](../../../specs/dsor/03-execution.md#21-command-pipeline): step 3 of the pipeline,
  "Resolve delegation; verify the actor chain; establish the subject's current authority
  (token or role source)".
- [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds): "Staleness of the
  delegator's authority from the role source" may be at most 24 hours for L2, and 1 hour for
  L3. DSOR-BND-02: a company's setting must not loosen that limit.
- `tenant-policy.schema.json`: a company's `role_source` has a `kind` (`scim`, `idp_lookup`,
  or `dsor_assignments`) and a `max_staleness`, and both are required. The example gives
  org_456 `{ kind: scim, max_staleness: PT1H }`. `PT1H` is the standard way to write "one
  hour".
- `security-context.schema.json`: an `unattended` call needs a slip, and the source of its
  subject's authority must be `role_source`.
- `decision-bundle.schema.json`: a record's `identity` requires `subject_authority`, with a
  `source` and an `as_of` time. The example record says `as_of: 2026-09-20T08:45:00Z`, while
  the state in the same record was read at 09:00.
- [§47](../../../specs/dsor/06-conformance.md#47-verification-approach): the test it asks for:
  "delegator demoted or deprovisioned in the role source while an unattended agent runs".

If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** An agent that calls at night uses only the power that its signer holds now, as her
company's own directory says. When DSoR cannot find that out in time, it refuses.

**Outcome.** What is true when this step is done:

1. At 02:00 the agent drafts PAY-901 under `del_100`. DSoR asked org_456's directory, and the
   directory said that user_123 holds `ap_supervisor`. The record says where her authority came
   from and when: `role_source`, as of 02:00.
2. At 02:05 the directory moves user_123 to `ap_clerk`, a job that may only read invoices.
   At 02:10 the agent's next draft is refused at line ⑤ with `AUTHORIZATION_DENIED`, and its
   read of INV-1008 is still answered. Nobody restarted DSoR. This meets the "Done when" of
   step 18 in the map of steps (`../readme.md`) in full.
3. The directory goes down at 02:00. Its last answer came at 01:30. At 02:10 the agent's draft
   is made on that answer, and the record says "as of 01:30". At 02:45 that answer is 75
   minutes old, and line ③ refuses with `FRESHNESS_UNSATISFIABLE`, reads too.
4. The directory says that user_123 is suspended. Line ③ refuses her agent with
   `DELEGATION_REQUIRED`.
5. While org_456's directory is down, user_123's own calls go on, and so does the agent work
   in org_789.

**Not the outcome of this step:**

- Suspending the slips of a person who was suspended or has left, DSOR-IDN-07: step 19b, next
  (decision 6).
- A real directory over a real network. The fake directory runs inside DSoR's program
  (decision 1).
- An operation through which an admin changes a company's setting, and a record of that change
  (decision 8).
- Tokens that expire, so that user_123's own calls also see her new job: step 43.
- A change to `roles.json` itself, which still needs a restart.
- The source and time of the authority in a person's own record: step 45.

### What the specification asks, and what this step can honestly give

Checked on 2026-10-05:

1. **DSOR-IDN-05 asks each company to configure a role source.** org_456 and org_789 each get
   a setting in `role-sources.json`, and a directory of their own. The kind is `idp_lookup`,
   because DSoR asks at the moment of the call (decision 1). The specification's example says
   `scim` for org_456. Ours differs on purpose.
2. **DSOR-IDN-06 asks DSoR to deny the command when the signer's authority cannot be
   established within the bound.** Met, and for reads too (decision 5). The specification names
   no code for this denial, so the code is this tutorial's: `FRESHNESS_UNSATISFIABLE`
   (decision 4).
3. **§44 caps the bound at 24 hours for L2, and DSOR-BND-02 forbids a company's setting beyond
   the cap.** Start-up refuses a longer bound (decision 8). DSOR-BND-01, a conformance
   statement that declares every bound, is not this step's idea.
4. **DSOR-DEL-07 and DSOR-DEL-08, which the map gives to step 19, arrived early in step 18.**
   They stay met. Step 19 adds the other half of DEL-08's idea: the subject's *authority* also
   comes from outside the request, from her company's directory.
5. **DSOR-DEL-02 asks for the signer's *current* authority.** From step 19, "current" means the
   directory's answer at this call, or one that DSoR kept from less than an hour ago. Which
   permissions a role holds still comes from `roles.json`, loaded at start-up.
6. **DSOR-DEL-10 asks every record for the mode, and for the source and time of the subject's
   authority.** The map gives it to step 45. Met early for an agent's record (decision 7), and
   not for a person's own record.
7. **DSOR-IDN-04a and DSOR-IDN-04b accept role facts only from a configured source.** The map
   gives them to step 43. Met early for the absent signer: her roles come only from her own
   company's directory, never from the login table, the request, or another company's
   directory. A caller's own login stays step 43's.
8. **DSOR-IDN-07 asks DSoR to suspend the slips of a person who was suspended or has left.**
   Not met. Step 19 refuses her agent's calls, and the slip stays `active` (decision 6). Step
   19b builds the rule.
9. **DSOR-TEN-02a asks for every cache to be keyed by company.** The kept answers are kept per
   company and per person.
10. **§10.1 trusts the role source, and §10.3 leaves its compromise out of scope.** DSoR still
    refuses an answer about somebody else, as it refuses a slip of somebody else (step 18's
    README, decision 14).

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-IDN-05 | **C1.** Each company has its own role source: a setting and a directory. DSoR does not start without them | org_456 and org_789 each have both. Start-up refuses a company with no setting, the kinds `scim` and `dsor_assignments`, a bound of `P2D` (over 24 hours) or of zero, and a duration it cannot read |
| DSOR-IDN-05, DSOR-DEL-02 | **C2.** At every call from an agent, DSoR asks the directory of the slip's company about the signer, and her roles there decide line ⑤ | user_123 moves to `ap_clerk` in the directory: the agent's draft is refused at line ⑤ with `AUTHORIZATION_DENIED`, and its read of INV-1008 is answered. She moves back: the draft is made. No restart |
| DSOR-IDN-06 | **C3.** With no answer from the directory, DSoR uses the kept answer only while it is younger than the company's bound. Otherwise line ③ refuses, for commands and for reads | Directory off, kept answer 40 minutes old: the draft is made. 75 minutes old: `FRESHNESS_UNSATISFIABLE`. No kept answer: `FRESHNESS_UNSATISFIABLE`. Every refusal is recorded and leaves no draft |
| DSOR-IDN-06 | **C4.** DSoR waits at most 2 seconds for an answer | A stuck directory: the call is answered after 2 seconds, from the kept answer or with `FRESHNESS_UNSATISFIABLE` |
| DSOR-IDN-06, DSOR-BND-02 | **C5.** Each company's bound is its own | A kept answer 2 hours old is refused in org_456 (1 hour) and used in org_789 (4 hours) |
| DSOR-TEN-02a | **C6.** A kept answer belongs to one company and one person | org_789's directory is off. org_456's kept answer about user_123 never answers for a slip in org_789 |
| (our decision) | **C7.** A signer whom the directory reports as suspended or deprovisioned gives her agent nothing | `DELEGATION_REQUIRED` at line ③, for every operation, recorded |
| DSOR-IDN-03a, DSOR-IDN-04b | **C8.** Only the directory speaks for the absent signer | user_700 signs a slip in org_456, and org_456's directory does not list user_700: `AUTHORIZATION_DENIED` at line ③. The login table still says `ap_supervisor` for user_123 while the directory says `ap_clerk`: the directory decides |
| DSOR-DEL-10 | **C9.** An agent's record names the source and time of its signer's authority | The draft's record holds `subject_authority: { source: role_source, as_of }`, and `as_of` is the time of the answer used: 02:00 for a fresh one, 01:30 for a kept one. Read back from the database. A person's record is unchanged |
| (our decision) | **C10.** An answer about another person, or from another company, is a fault and is never used | `INTERNAL_ERROR`, recorded, with no draft |
| (our decision) | **C11.** A person who calls for herself does not need the directory | org_456's directory is off, and user_123's own draft is made |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. The learner made
decisions 1 to 9 on 2026-10-05, one at a time. For each one, the learner asked for the option
that is closest to production and teaches the most, and chose by those two tests.

1. **The role source is a lookup in a fake directory.** Each company's directory is a small
   part of DSoR's program, with its own list of people, their status, their roles, and an off
   switch. At each call from an agent, DSoR asks it about the signer. *Fake* means a stand-in
   that we write ourselves, not a real product. The specification allows three kinds, and two
   were weighed and left: a synced copy (`scim`, the kind that §41's reference profile uses)
   has two moving parts and needs a fake clock in every test, and DSoR's own table
   (`dsor_assignments`) is never stale, so DSOR-IDN-06 could never fire. *Downside:* the
   directory runs in the same program, so "off" is a switch, not a failed network.
2. **Only the absent signer is looked up.** When an agent calls, the facts about the slip's
   signer come from the directory: whether she works in this company (line ③), and which roles
   she holds there (line ⑤). A person who calls for herself keeps the roles of her own login,
   as in steps 06 to 18. This is the specification's split: `token` when the person is in the
   request, `role_source` when she is not. *Downside:* user_123's roles live in two places.
   After she moves job, her own calls keep the old roles until a restart, because this
   tutorial's tokens never expire. Real tokens expire within minutes or hours (step 43).
3. **Ask at every call, and keep the last answer.** DSoR asks the directory at every call from
   an agent. It keeps the last answer for each company and person, with the time it arrived by
   DSoR's own clock. Only when the directory gives no answer does DSoR use the kept one, and
   only while it is younger than the company's bound. So whenever the directory is up, a
   change of job reaches the agent at its next call. *Downside:* during an outage, a change
   from the last hour is not seen. The kept answers live in memory, so after a restart with
   the directory down, every call from an agent is refused.
4. **No fresh answer: line ③ refuses with `FRESHNESS_UNSATISFIABLE`.** The line is the
   specification's: step 3 of its pipeline includes "establish the subject's current
   authority". The code is ours. Its retry class, `after_delay`, says "try again later", which
   fits an outage. `DELEGATION_REQUIRED` and `AUTHORIZATION_DENIED` both say `never`, so a
   2-minute outage would stop the nightly run for good. *Downside:* the specification defines
   this code for a connector that cannot deliver fresh data (DSOR-FRS-02b, in
   [§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency)), and that rule
   also forbids falling back to a cache. Our reading: the bound of DSOR-IDN-06 is the role
   source's own freshness, so a kept answer inside it is fresh enough, not a fallback. This
   goes to the open questions.
5. **Reads are refused too.** Without a fresh answer, DSoR cannot compute DSOR-DEL-02's "the
   slip, and what the signer holds now" for any call. *Downside:* stricter than the words of
   DSOR-IDN-06, which say "command". During an outage the agent cannot even read invoices to
   prepare its work.
6. **A suspended or deprovisioned signer: refuse now, suspend the slip in step 19b.** When the
   directory says that user_123 is suspended or deprovisioned, line ③ refuses her agent with
   `DELEGATION_REQUIRED`, the code that a suspended slip has given since step 18. The slip
   stays `active` in the store. DSOR-IDN-07, which suspends the slip itself and records the
   change, gets a step of its own, 19b, built right after this one. Building it here would
   bring a second idea: DSoR's first write to its own slips, with the old problem of two
   writes in two orders. *Downside:* until step 19b, if she comes back, her agent works again
   at its next call, with no person's review, and the slip table keeps no trace.
7. **An agent's record gains the source and time.** The record's `identity` gains
   `subject_authority: { source: role_source, as_of }`, where `as_of` is the time of the
   answer that DSoR used. A person's record is unchanged. *Downside:* two shapes of record
   until step 45, and DSOR-DEL-10 is met only for agents.
8. **Each company's setting is in a file, checked at start-up.** `role-sources.json` holds
   each company's `role_source`, in the schema's own shape: org_456 `idp_lookup` with `PT1H`,
   the specification's own value, and org_789 `idp_lookup` with `PT4H`. DSoR refuses to start
   when a company has no setting, when the kind is not `idp_lookup`, when the bound is over 24
   hours or zero, or when it cannot read the duration. Step 10 made no table of companies, so
   a database row would have needed a new table. *Downside:* production keeps this in DSoR's
   own store, where an admin changes it and the change is recorded. Here a change needs a
   restart.
9. **DSoR waits at most 2 seconds.** A question with no answer after 2 seconds counts as no
   answer. *Downside:* a slow but working directory is treated as down. The 2 seconds is our
   value, in the code, the same for every company.

### The tests, by claim

Unit tests in `test/role-source.test.ts`, with a fake clock where a claim depends on time:

- **C1:** start-up refuses each broken `role-sources.json`, one case each, and names the
  company and the problem.
- **C2:** the job change of the outcome, call by call: `ap_supervisor` (draft made),
  `ap_clerk` (draft refused at line ⑤, read answered), `ap_supervisor` again (draft made).
- **C3:** directory off with kept answers 40 minutes old, 75 minutes old, and none, for each
  of the five operations. Every refusal is recorded at line ③.
- **C4:** a directory that never answers: the call ends after 2 seconds, both ways.
- **C5:** one kept answer, 2 hours old, in each company.
- **C6:** the cross-company case, with org_789's directory off.
- **C7:** `suspended` and `deprovisioned`, for each operation.
- **C8:** user_700's slip in org_456, and the login table that disagrees with the directory.
- **C10:** a directory part that answers about cfo_100 when asked about user_123, and one that
  answers for org_789 when asked for org_456.
- **C11:** user_123's own draft with her company's directory off.

Database tests in `test/role-source.db.test.ts`: **C9**, the record of a fresh answer and of a
kept answer, read back from the log as `dsor_runtime` reads it. Step 12's cross-tenant suite
and step 18's tests keep running, with each company's directory on.

### Breaks we will try, and what we expect

_The learner's predictions are asked next, one at a time, as a story._

- **B1, the map's: switch the directory off.** org_456's directory is off before the night
  run, so DSoR has no kept answer. Expected: every call from the agent in org_456 is refused
  at line ③ with `FRESHNESS_UNSATISFIABLE`, recorded, with no draft. user_123's own draft is
  made, and the agent's work in org_789 goes on.
- **B2: delete the age check.** Any kept answer counts, however old. Expected: at 02:45 the
  agent drafts a payment on the answer from 01:30, and the record says "as of 01:30".
- **B3: keep answers by person only, not by company.** Expected: with org_789's directory off,
  a slip in org_789 signed by user_123 is answered from org_456's kept answer, and the agent
  drafts in org_789 under a person who does not work there.
- **B4: delete the 2-second limit.** Expected: a stuck directory holds the agent's call open,
  and the agent hears nothing at all.

### Left open, and not this step's idea

- DSOR-IDN-07: step 19b (decision 6).
- A real directory over a network, with its own ways to fail: a wrong answer format, an
  expired credential, half an answer.
- An admin operation that changes a company's setting, and the record of that change.
- A person's own roles going stale in her login: step 43.
- `roles.json` changes still need a restart.
- Open questions for the specification: which code DSOR-IDN-06's denial gives, and how it fits
  DSOR-FRS-02b's "no cache" (decision 4); whether DSOR-IDN-06 covers reads (decision 5).

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup itself,
this way:

1. Delete one old branch, at the learner's yes: all ten branches are in use (decision 10, made
   at the start of the build).
2. Create a branch `step-19` **from `step-18`**, with `neonctl branches create`.
3. Write `.env` with `neonctl connection-string`, sending its output into the file and never
   printing it:
   - `DSOR_MIGRATION_URL`: the owner's string.
   - `DSOR_DB_URL`: the same string, with the user `dsor_runtime` and a new random password
     (letters and digits).

   Give both `sslmode=verify-full`.
4. Run `pnpm migrate`. Only this step's new migrations run, if it has any.
5. Check without looking: `pnpm test:db` passes, and the transcript holds no `postgresql://`
   with a password in it.

## What changed since step 18

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. 02:10. org_456's directory is down. Its last answer came at 01:30 and said `ap_supervisor`.
   The agent asks to draft a payment for INV-1008. What does DSoR answer, and what does the
   record say about user_123's authority?
2. The same night, at 02:45. The agent asks only to read INV-1008. What does it hear, and
   what does the retry class tell it to do?
3. The directory is up. At 02:05 it moved user_123 to `ap_clerk`. At 02:10 the agent asks to
   draft. Which line says no, and why does line ③ say yes?
4. org_456's directory is off all night. At 03:00 user_123 wakes up and drafts a payment for
   INV-1008 herself. What happens?
5. The directory says that user_123 is suspended. What does the agent hear, and what is the
   status of `del_100` in the store afterwards?

<details>
<summary>Answers</summary>

1. The draft is made. The kept answer is 40 minutes old, under org_456's one hour. The record
   says `subject_authority: { source: role_source, as_of: 01:30 }`.
2. Line ③ refuses with `FRESHNESS_UNSATISFIABLE`: the kept answer is 75 minutes old, and reads
   are refused too (decision 5). The retry class is `after_delay`: try again later.
3. Line ⑤, `AUTHORIZATION_DENIED`. Line ③ says yes: the slip is usable, and the directory gave
   a fresh answer that lists user_123 as active in org_456. Line ⑤ asks what the slip lists
   **and** what she holds now. The slip lists `payment:create`, and `ap_clerk` does not hold it.
4. Her draft is made. A person who calls for herself uses her own login, not the directory
   (decision 2).
5. `DELEGATION_REQUIRED`, at line ③. `del_100` is still `active` in the store. Suspending it is
   step 19b's work (decision 6).

</details>

## Think it through

_To be written after the review._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-IDN-05 | Each company configures a role source, from which DSoR reads the current roles of a person who is not in the request | [§12.1 Role source](../../../specs/dsor/02-security.md#121-role-source) | _To be counted._ |
| DSOR-IDN-06 | When the signer's current authority cannot be established within the bound of §44, DSoR denies the command | [§12.1 Role source](../../../specs/dsor/02-security.md#121-role-source) | _To be counted._ |
| DSOR-DEL-07 | An `unattended` call is accepted only under a slip that allows `unattended` | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | Step 18's tests, kept |
| DSOR-DEL-08 | In `unattended` mode, DSoR takes the person from the slip, never from the request | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | Step 18's tests, kept |
| DSOR-DEL-10 | Every record states the mode, and the source and time of the subject's authority | [§13.2 Identity modes on the wire](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) | _To be counted._ Early, from step 45, for agents only (decision 7) |
| DSOR-IDN-04b | A role fact from any other origin is not used in an authorization decision | [§12.1 Role source](../../../specs/dsor/02-security.md#121-role-source) | _To be counted._ Early, from step 43, for the absent signer only |
| DSOR-TEN-02a | Caches are keyed by company | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | _To be counted._ The kept answers |
| DSOR-BND-02 | A company's setting does not loosen a bound of §44 beyond the limit for the level | [§44 Operational bounds](../../../specs/dsor/06-conformance.md#44-operational-bounds) | _To be counted._ The role source's bound only |

## Next

Step 19b · The leaver's slips, this learner build's own step, proposed for the map. When the
directory says that a person was suspended or has left, DSoR suspends every slip she signed,
and records the change (DSOR-IDN-07). Then step 20 · Idempotency keys.
