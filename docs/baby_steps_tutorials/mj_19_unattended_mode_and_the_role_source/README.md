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
   authority.** The map gives it to step 45. Met early for the record of an agent's call that
   passed line ③ (decision 7). Not met for a person's own record, nor for a call refused at
   line ③, which names no slip and no subject, as in step 18.
7. **DSOR-IDN-04a and DSOR-IDN-04b accept role facts only from a configured source.** The map
   gives them to step 43. Met early for the absent signer: her roles come only from her own
   company's directory, never from the login table, the request, or another company's
   directory. A role she holds there that `roles.json` does not have grants nothing
   (DSOR-AUT-01b). A caller's own login stays step 43's.
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
| DSOR-IDN-05 | **C1.** Each company has its own role source: a setting and a directory. DSoR does not start without the setting, and with no directory every call from an agent in that company is refused | org_456 and org_789 each have both. Start-up refuses a company with no setting, a setting for a company where no login works, the kinds `scim` and `dsor_assignments`, a bound of `P2D` (over 24 hours), and a duration it cannot read. A bound of zero is the strictest setting, and is allowed: no kept answer ever counts. A company with no directory: every call from its agents gets `INTERNAL_ERROR`, a fault in DSoR's set-up, not an outage |
| DSOR-IDN-05, DSOR-DEL-02 | **C2.** At every call from an agent, DSoR asks the directory of the slip's company about the signer, and her roles there decide line ⑤ | user_123 moves to `ap_clerk` in the directory: the agent's draft is refused at line ⑤ with `AUTHORIZATION_DENIED`, and its read of INV-1008 is answered. She moves back: the draft is made. No restart |
| DSOR-IDN-06 | **C3.** With no answer from the directory, DSoR uses the kept answer only while it is younger than the company's bound. Otherwise line ③ refuses, for commands and for reads | Directory off, kept answer 40 minutes old: the draft is made. 75 minutes old: `FRESHNESS_UNSATISFIABLE`. No kept answer: `FRESHNESS_UNSATISFIABLE`. A millisecond under 60 minutes counts, and exactly 60 minutes does not. An answer "from the future", after the clock went back, never counts. user_123 suspended, moved to `ap_clerk`, or no longer listed, and then the directory goes off: her agent is still refused (§47's test). Every refusal is recorded and leaves no draft |
| DSOR-IDN-06 | **C4.** DSoR waits at most 2 seconds for an answer | A stuck directory: the call is answered after 2 seconds, from the kept answer or with `FRESHNESS_UNSATISFIABLE` |
| DSOR-IDN-06, DSOR-BND-02 | **C5.** Each company's bound is its own | A kept answer 2 hours old is refused in org_456 (1 hour) and used in org_789 (4 hours) |
| DSOR-TEN-02a | **C6.** A kept answer belongs to one company and one person | org_789's directory is off. org_456's kept answer about user_123 never answers for a slip in org_789 |
| (our decision) | **C7.** A signer whom the directory reports as suspended or deprovisioned gives her agent nothing | `DELEGATION_REQUIRED` at line ③, for every operation, recorded |
| DSOR-IDN-03a, DSOR-IDN-04b | **C8.** Only the directory speaks for the absent signer's job: whether she works here, and her roles | user_700 signs a slip in org_456, and org_456's directory does not list user_700: `AUTHORIZATION_DENIED` at line ③. The login table still says `ap_supervisor` for user_123 while the directory says `ap_clerk`: the directory decides |
| DSOR-DEL-10 | **C9.** An agent's record names the source and time of its signer's authority | The draft's record holds `subject_authority: { source: role_source, as_of }`, and `as_of` is the time of the answer used: 02:00 for a fresh one, 01:30 for a kept one. Read back from the database. A person's record is unchanged |
| (our decision) | **C10.** An answer about another person, from another company, or that DSoR cannot read, is a fault and is never used, fresh or kept | `INTERNAL_ERROR`, recorded, with no draft, and the kept answer is forgotten too, so it is not used at the next outage either. Every answer names its company and person, and line ③ checks both at every use. A status `on_leave`, an answer with no list of roles, an answer whose fields sit on its prototype, and one that cannot be copied are faults too. DSoR reads an answer once |
| (our decision) | **C11.** A person who calls for herself does not need the directory | org_456's directory is off, and user_123's own draft is made |
| (our decision) | **C12.** Line ③ asks the directory last, after every check that needs only DSoR's store and the request | With the directory off and no kept answer: arguments that name `del_102` get `AUTHORIZATION_DENIED`, and a torn-up slip gets `DELEGATION_REVOKED`, never `FRESHNESS_UNSATISFIABLE` |
| §13 (step 18's decision 15) | **C13.** Only a person whom DSoR's own table knows signs a slip. *Added by the review* | A slip signed by `firm-ap-fte`, by the agent that holds it, or by somebody DSoR does not know is refused at line ③ with `AUTHORIZATION_DENIED`, before the directory is asked, even when the directory lists them |
| DSOR-IDN-06 (our decision) | **C14.** Older news never replaces newer. *Added by the review* | Question A goes first and is answered late with `ap_supervisor`. Question B goes after it and is answered at once with `ap_clerk`. When the directory then goes off, the kept answer is B's |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. The learner made
decisions 1 to 9 on 2026-10-05, one at a time. For each one, the learner asked for the option
that is closest to production and teaches the most, and chose by those two tests. Decision 10
set up Neon at the start of the build. The build then checked this design against the
specification, the schemas, and step 18's code, before the first test. It found one gap
(decision 11), one question of order (decision 12), and four small fixes, listed after
decision 12.

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
   hours, or when it cannot read the duration. A bound of zero is allowed: §44 lets a company
   set a tighter value, and zero means that no kept answer ever counts. Step 10 made no table of companies, so
   a database row would have needed a new table. *Downside:* production keeps this in DSoR's
   own store, where an admin changes it and the change is recorded. Here a change needs a
   restart.
9. **DSoR waits at most 2 seconds.** A question with no answer after 2 seconds counts as no
   answer. *Downside:* a slow but working directory is treated as down. The 2 seconds is our
   value, in the code, the same for every company.
10. **Neon: delete `step-13`, and make `step-19` from `step-18`.** All ten branches were in use,
    and Neon deletes only a branch with no child branches: `step-13` or `step-18`. The learner
    runs the delete, because deleting data is the learner's own action. *Downside:* step 13's
    folder cannot run its database tests until somebody makes it a branch again, as with step
    14 since step 18's build.
11. **An answer that DSoR cannot read is a fault.** A status DSoR does not know, such as
    `on_leave`, or an answer with no list of roles: line ③ refuses with `INTERNAL_ERROR`. The
    answer is not kept, and the kept answer is forgotten too, because the strange answer may
    be the very news DSoR needs: `on_leave` may mean that she is gone. This is step 18's habit
    for a broken slip (step 18's README, decision 13). The first build refused the strange
    answer but kept the old one, and used it again at the next outage. The review found it,
    and the learner chose to forget it. *Downside:* one garbled answer stops the agent until
    the directory answers clearly again, even if the old answer was still true. An empty list
    of roles is not a fault: she holds no role, and line ⑤ refuses.
12. **Line ③ asks the directory last.** First every check that needs only DSoR's own store and
    the request: the slip is found, valid, alive, and fits, and no other slip is named. Then
    the directory. An outside failure never hides a refusal that DSoR can make by itself, and
    DSoR asks the directory only about calls that could go through. *Downside:* line ③'s code
    splits into two parts, and the order inside one line needs tests of its own (C12).

The four small fixes:

- Step 06's code calls the `roles.json` file a `RoleSource`. From this step, "role source"
  means the directory, as in the specification, so the old type becomes `RoleTableSource`.
- A role that the directory names and `roles.json` does not have grants nothing, by
  DSOR-AUT-01b. It is not a fault, because the answer can be read.
- DSOR-DEL-10 is met only after line ③ (item 6 above).
- Every company that a login in DSoR's table belongs to needs a setting: org_456 and org_789.
  A setting for a company that nobody belongs to stops start-up, as a likely typo.

The review made decisions 13 to 17, and the learner chose each fix (see "Think it through"):

13. **Only a person whom DSoR knows signs a slip.** Step 18 checked that the signer is a person
    of the company, in DSoR's own table (step 18's README, decision 15). The first build of
    this step moved the whole check to the directory, and a real directory lists service
    accounts too. A real run made a draft under a slip signed by an agent. So line ③ checks
    DSoR's own table again: the signer must be a person it knows, before the directory is
    asked. A principal's type is not a role, so the directory still decides her job (decision
    2), and the order of decision 12 holds. *Downside:* two places hold facts about the signer:
    what she is, in DSoR's table, and her job, in the directory. A person DSoR has never seen
    cannot sign, but signing needs a login anyway.
14. **An answer is as of the time DSoR asked, and older news never replaces newer.** Two calls
    can ask at nearly the same moment, and the earlier question can be answered later. Its
    answer is not kept over the newer one. *Downside:* a call that waited for a slow answer
    is decided by that answer, though a newer one came in meanwhile.
15. **An answer from the future never counts.** If the computer's clock goes back, a kept
    answer would look younger than it is. Such an answer counts as too old. *Downside:* after a
    clock correction, every kept answer is useless until the directory answers again.
16. **Messages name no bound and no status.** "Suspended" and "deprovisioned" get one message,
    because which one she is, is a fact about a person that the agent may not read
    (DSOR-ERR-01b). And the company's bound is not in any message. *Downside:* the record keeps
    the message the caller heard, so the log no longer says which of the two statuses it was.
17. **DSoR reads an answer once.** It copies the answer first, and every check and every use
    reads that copy, as line ① copies the input (step 07's README, decision 9). A field on
    the answer's prototype is lost in the copy, so such an answer is a fault. *Downside:* the
    copy costs a little time at every call.

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
- **C10:** a directory part that answers about cfo_100 when asked about user_123, one that
  answers for org_789 when asked for org_456, a kept answer from another company, a status
  `on_leave`, and an answer with no roles.
- **C11:** user_123's own draft with her company's directory off.
- **C12:** with the directory off and no kept answer, arguments that name `del_102`, and a
  torn-up slip.
- **C13:** a slip signed by `firm-ap-fte`, by `accounts-payable-fte`, and by `user_999`, each
  listed by the directory, refused before the directory is asked.
- **C14:** two questions whose answers arrive in the wrong order.
- **Added by the review and the sweep:** the minute before the bound and the bound itself, a
  clock that went back, §47's job change and suspension followed by an outage, a directory
  that throws at once, answers at 1.999 and 2.001 seconds, no timer left behind, a company with
  no directory, a duration with minutes and seconds, a settings file that says `null`, an
  answer read once, and an answer whose fields sit on its prototype.

Database tests in `test/role-source.db.test.ts`: **C9**, the record of a fresh answer and of a
kept answer, read back from the log as `dsor_runtime` reads it. Step 12's cross-tenant suite
and step 18's tests keep running, with each company's directory on.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded on 2026-10-05, before
any code, as stories with a fact card: what the agent hears, and what the database holds after.
B1 and B2 match the expected answer. B3 follows the broken lookup to its end, but leaves out
the check that stays (C10). B4 describes DSoR with its 2-second limit still in place. So the
build runs each break as a pair: the learner's case beside the real one.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| B1 | The map's own: org_456's directory is off from the start of the night, so DSoR has no kept answer. At 02:00 the agent asks for a draft for INV-1008. No code changes | C3. Line ③ refuses with `FRESHNESS_UNSATISFIABLE`, recorded, with no draft. user_123's own draft is made (C11), and the agent's work in org_789 goes on | Line ③, `FRESHNESS_UNSATISFIABLE`, and no draft |
| B2 | Line ③ no longer checks the age of a kept answer. The directory answered at 01:30 and went off at 02:00. At 02:45 the agent asks for a draft | C3. With B2 any kept answer counts, so the draft is made, and its record says "as of 01:30" | The draft is made, and its record says "as of 01:30" |
| B3 | DSoR keeps answers by person only, not by company. C10's check stays. At 01:30 org_456's directory answered about user_123. org_789's directory is off. At 02:10 `firm-ap-fte` asks for a draft in org_789 under `del_103`, a test slip that user_123 signed there | C6. The lookup finds org_456's answer, C10's check sees the wrong company, and line ③ refuses with `INTERNAL_ERROR`, with no draft. Without C10's check, a draft would be made in org_789 | A draft is made in org_789 |
| B4 | DSoR waits for the directory with no time limit. The directory answered at 01:30. From 02:00 it is stuck: it takes every question and never answers. At 02:10 the agent asks for a draft | C4. With B4 the call stays open: the agent hears nothing, and nothing is drafted or recorded | The draft is made, and its record says "as of 01:30" |

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

1. The learner deletes the branch `step-13` (decision 10):
   `npx -y neonctl@8.0.2 branches delete step-13 --project-id <project>`.
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

| File | What changed |
| --- | --- |
| `role-sources.json` | **New.** Each company's role source, in the schema's own shape: org_456 `idp_lookup` with `PT1H`, org_789 `idp_lookup` with `PT4H` (decision 8) |
| `schemas/tenant-policy.schema.json` | **New.** The specification's tenant policy schema, copied byte for byte. Start-up checks each setting against its `role_source` part |
| `src/directory.ts` | **New.** The fake directory: its people, their status and roles, and a switch for on, off, and stuck (decision 1) |
| `src/authority.ts` | **New.** The start-up check of the settings (C1). Line ③'s last question: ask the directory of the slip's company, wait at most 2 seconds, keep each good answer per company and person, use a kept one only within the bound, and refuse in four ways (C2 to C10, decisions 3 to 6, 9, and 11) |
| `src/delegation.ts` | The check of the slip's signer leaves the slip check. The directory answers it now (decision 2) |
| `src/pipeline.ts` | Line ③ asks the role source last, after the named-slip check (decision 12), and hands its answer to line ⑤ and to the record |
| `src/permissions.ts` | Line ⑤ takes the signer's roles from line ③, not from DSoR's login table. Step 06's `RoleSource` becomes `RoleTableSource` |
| `src/log.ts` | An agent's record gains `subject_authority` (decision 7) |
| `src/registry.ts` | Start-up checks the settings with everything else, and the registry holds the role source |
| `src/main.ts` | The night: the agent's record, a job change, a suspension, a directory that goes off, and a restart |
| `roles.json` | `ap_clerk`, which may only read invoices: the job that user_123 moves to in the story |
| `test/role-source.test.ts`, `test/role-source.db.test.ts` | **New.** C1 to C12 |
| `test/helpers.ts`, `test/db.ts`, `test/cross-tenant.ts`, and eleven more test files | Every registry that lets an agent call gets the story's directories. The cross-company suite asks line ③'s new part too |

Some old tests changed with the step, because they typed out the old role table or the old
record, or asked line ⑤ in its old way. Each change has a one-line reason in the test, and
"Build it yourself" counts them, move by move.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_18_delegations/src mj_19_unattended_mode_and_the_role_source/src
```

```bash
git diff --no-index mj_18_delegations/test mj_19_unattended_mode_and_the_role_source/test
```

## Run it

_To be written when the code exists._

## Break it

Each break was made in a copy of the step outside the repository, never in the step itself,
and run as a story on the copy's own code, with the clock set by the story. The script is
not part of the step. Then the whole unit suite ran on the copy. The learner predicted each
story before any code existed ("Breaks we will try" above). Each prediction stands beside the
real run here.

**B1, the map's own: switch the directory off.** No code changes. org_456's directory is
off from the start, so DSoR has no kept answer.

```text
02:00 agent, payment.create INV-1008 (org_456's directory off, nothing kept)
   hears: FRESHNESS_UNSATISFIABLE: "payment.create": no answer about user_123, who signed slip del_100, came from the directory of org_456 within PT1H
   drafts in memory: 0
02:01 user_123 herself, payment.create INV-1008
   hears: answered (PAY-901)
02:02 firm-ap-fte in org_789, invoice.get INV-1008
   hears: answered (INV-1008)
```

The learner predicted line ③, `FRESHNESS_UNSATISFIABLE`, and no draft. That is what happened.
The agent was refused, not waved through, which is what the map asks.

**B2: delete the age check.** In `src/authority.ts`, the condition becomes `last ===
undefined`, so any kept answer counts, however old.

```text
01:30 agent, invoice.get (directory on, answer kept)
   hears: answered (INV-1008)
02:45 agent, payment.create INV-1008 (directory off)
   hears: answered (PAY-901)
   record: ok, as of 2026-10-06T01:30:00.000Z
   drafts in memory: 1
```

6 of 1289 unit tests fail: the five tests of C3 with a kept answer 75 minutes old, and C5's test
of each company's bound. The learner predicted the draft, with a record "as of 01:30". That
is what happened.

**B3: keep answers by person only.** In `src/authority.ts`, `keptKey` leaves the company out.
C10's check of every answer stays.

```text
01:30 firm-ap-fte in org_456 under del_101, invoice.get (answer about user_123 kept)
   hears: answered (INV-1008)
02:10 firm-ap-fte in org_789 under del_103 (signed by user_123), payment.create INV-2001
   hears: INTERNAL_ERROR: the directory of org_789 answered with something DSoR cannot use
   drafts in memory: 0
```

1 of 1289 unit tests fails: C6's test, which expects `FRESHNESS_UNSATISFIABLE`. The learner
predicted a draft in org_789. The broken lookup does find org_456's answer about user_123, as
the learner traced. But that answer still names org_456, and line ③ checks the company of every
answer before it uses one. So the second check refused the call. Without it, the learner's
answer would be right.

**B4: delete the 2-second limit.** In `src/authority.ts`, DSoR waits for the directory's
answer alone. The directory is stuck from 02:00: it takes every question and never answers.

```text
01:30 agent, invoice.get (directory on, answer kept)
   hears: answered (INV-1008)
02:10 agent, payment.create INV-1008 (directory stuck)
   hears: NOTHING after 10 seconds, the call is still open
   drafts in memory: 0
```

The same story on the step as built:

```text
02:10 agent, payment.create INV-1008 (directory stuck)
   hears: answered (PAY-901)
   record: ok, as of 2026-10-06T01:30:00.000Z
```

2 of 1289 unit tests fail: C4's two tests. The learner predicted the draft, with a record "as
of 01:30": that is what the step as built does, after 2 seconds. With the limit deleted, DSoR
waits for ever, and one stuck directory silently stops the whole night's work.

Each copy was put back and checked to be the same as the step, byte for byte, after its break.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Understand | A session with no code, on 2026-10-05, after a course on the specification from the start: "The foundations course, and step 19 before design" in `../mj_notes.md` |
| 2 | Design | "In plain words", "Why it matters", and "The design, before any code": decisions 1 to 9, one per turn, each judged by two tests the learner named, closest to production and deepest understanding. Then the predictions for B1 to B4, asked as stories with a fact card |
| 3 | Check the design | Against the specification, the schemas, and step 18's code, before the first test. One gap (decision 11) and one question of order (decision 12) went to the learner. Four small fixes followed from the rules |
| 4 | Neon | Decision 10: the learner deletes `step-13`. A branch `step-19` from `step-18`. `.env` written by a command, never shown |
| 5 | Markers and configuration | Step 18's markers removed. The settings file, the schema copy, `ap_clerk`, and the renamed type. No check reads them yet |
| 6 | Red | Shells: code with the new shape and step 18's behaviour, so a new test fails on what it checks, not on a missing file. The story's directories in every registry. Then every new test |
| 7 | Green | `src/authority.ts` and the record. The learner predicted one story of C10 before the run, and the run agreed |
| 8 | The program | The night in `pnpm start`. The learner predicted the restart before it was written |
| 9 | Break it | Each break in a copy outside the repository, beside the step as built, with the whole unit suite |
| 10 | Review | Reviewers who have not seen the conversation, each in a copy outside the repository |

The build continued from the design in the same session, with the learner's "go" before each
move. To start it in a new session:

```text
Build step 19 in learner mode from the design in
docs/baby_steps_tutorials/mj_19_unattended_mode_and_the_role_source/README.md.
```

The learner's predictions, and what each break really did, are under "Break it".

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Configuration | 1 old unit test, which types out `roles.json` |
| Red | 57 of 66 new unit tests. While the shells went in, 40 old unit tests failed until they were fixed: 38 in the cross-company suite, which asks line ③ itself, and 2 that asked line ⑤ in its old way. None changed what it proves |
| Green | 5 old unit tests, which type out an agent's record exactly. The record gained `subject_authority` (decision 7) |
| The program | None |

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

Two reviewers who had not seen the conversation attacked the finished build, each in its own
way, before this section was written. One read the rules, the code, and the tests as an
attacker would, and ran probes of its own. The other made 87 small breaks in a copy of the
step, one at a time, and ran the tests after each. The learner chose what to do with every
finding, on 2026-10-05.

### What the hostile review found

| # | Finding | What was done |
| --- | --- | --- |
| H1 | After an answer DSoR cannot use, the old kept answer stayed, and counted again at the next outage. That broke decision 11's own reason. The learner's prediction of this story matched the code, and so did a test, so both were wrong together | Fixed: the kept answer is forgotten too (decision 11). The test now expects `FRESHNESS_UNSATISFIABLE` |
| H2 | Step 18's rule that only a person signs a slip was gone: a real run drafted under a slip signed by an agent that the directory listed | Fixed: line ③ checks DSoR's own table first (decision 13, C13) |
| M1 | An older answer that arrived late replaced a newer kept one | Fixed (decision 14, C14) |
| M2 | A clock that went back made an old kept answer look young | Fixed (decision 15) |
| M3 | Messages told the agent whether its signer was suspended or deprovisioned, and showed the company's bound | Fixed (decision 16) |
| M4 | No test of §47's own case: the signer demoted or suspended, and then the directory goes off | Tests added |
| L1 | C1 said that DSoR does not start without a directory. It does, and refuses every call from an agent | README corrected, test added |
| L2 | Decision 3 says "under" the bound, and the code counted an answer exactly at the bound | Fixed, and tested a millisecond either side |
| L3 | DSoR read each answer three times, so an answer could change between the check and the use | Fixed (decision 17) |
| L4 | No tests for a directory that throws at once, or for the two sides of the 2-second edge | Tests added. A question to a stuck directory is never cancelled: left open, below |

### What the sweep found

87 small breaks. The tests caught 64 and missed 23. 15 of the 23 change nothing that matters:
another order of messages, an extra message beside a refusal, a case that start-up already
makes impossible, or a copy that nothing changes. 8 were real gaps, and each now has a test
that fails on its break and passes on the step: an answer that refuses, followed by an outage
(two breaks), the bound itself, minutes in a duration, a directory that throws at once, the
2-second timer left running, a company with no directory, and a settings file that says
`null`.

### Removed from step 18, and why

- Line ③ no longer reads whether the signer works in the company from DSoR's login table. Her
  company's directory answers that now (decision 2). DSoR's table still says whether she is a
  person (decision 13).
- Step 06's type `RoleSource` is now `RoleTableSource`, because "role source" now means the
  directory, as in §12.1.

### Left open on purpose

- DSOR-IDN-07, suspending the slips of a person who left: step 19b, next (decision 6).
- A question to a stuck directory is never cancelled, so each call leaves one question open.
  The fake costs nothing to leave open. A real client over a network needs a way to cancel.
- The specification's pattern for a duration accepts `PT` and `P1DT`, which the ISO 8601
  standard does not. This step accepts what the specification's schema accepts, and reads
  `PT` as zero.
- A company with no directory starts, and refuses every call from its agents with
  `INTERNAL_ERROR`. A check at start-up would make every test registry name its directories.
- An admin operation that changes a setting, with a record of the change. A real directory
  over a network. A person's own roles going stale in her login (step 43). `roles.json`
  changes still need a restart. The source and time in a person's own record (step 45).

### Questions for the specification

Recorded for `research/open-questions.md` at the hand-over:

- Which code does DSOR-IDN-06's denial give? And is a kept answer inside its bound the
  "cache" that DSOR-FRS-02b forbids, for the code this step borrowed (decision 4)?
- Does DSOR-IDN-06, which says "command", cover an agent's reads (decision 5)?
- Should the duration pattern accept `PT` and `P1DT`?

The next step starts from this list: step 19b builds DSOR-IDN-07.

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
