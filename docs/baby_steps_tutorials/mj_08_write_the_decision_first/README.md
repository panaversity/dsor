# Step 08 · Write the decision first

**New in this step:** before DSoR gives any answer, yes or no, it writes that decision
down in a log (DSOR-EXE-02).

## In plain words

Until now, when DSoR refused a call, the refusal went back to the caller and nothing
remembered it. From this step, every call leaves one **record** in a **log**: who
called, what they asked for, whether the answer was yes or no, why, and which call it
was.

The important word is **before**. The record is written first, and only then is the
answer returned. So nothing reaches a caller that the log does not already hold.

Think of the clerk from [Start here](../../learn/start-here.md), who keeps a logbook of
everything they do. A good clerk writes the entry in the logbook before turning to the
customer to say "approved" or "refused". If the clerk faints in the middle of the
sentence, the logbook already has it. The analogy stops at the paper: a paper logbook
survives a power cut. This step's log lives in the program's memory, so it is gone when
the program stops. It moves into a real database in step 09.

## Why it matters

**A refusal nobody wrote down hides someone trying.** At 2 a.m. `accounts-payable-fte`
calls `invoice.issue`, and DSoR says no. Suppose it tries forty times that night, with
forty different inputs, learning something from each refusal. If only the "yes" answers
are written down, nobody ever sees it. §21 says it plainly: "If refusals are not logged,
you never see an agent probing for a weakness."

**A record written after the answer can be lost.** The caller hears the answer. Then,
before the log line is written, something fails. Later someone asks "what did DSoR
decide?", and the log has nothing. The caller acted on an answer that, as far as the
evidence goes, was never given.

**Common mistake:** §21 names it: "Writing the audit record at the end, inside a
`finally` block. It is too late, and it misses the crash case completely." A `finally`
block runs even when an error is thrown, so it looks safe. It is not safe when the whole
program stops.

## The design, before any code

This section was written before the first test, in a learner session. Every sentence of
the specification it relies on was read on 2026-09-27: §21 (DSOR-EXE-02, DSOR-EXE-03b),
§28 (the retry class of `EVIDENCE_STORE_UNAVAILABLE`), and §29 (DSOR-AUD-01, the
paragraph on rejections at steps 1 and 2, and `audit-record.schema.json`). If the code
finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** DSoR keeps evidence of every decision, and the evidence exists before anyone
hears the answer, including every "no". The analogy is the clerk's logbook.

**Outcome.** What is true when this step is done:

1. Every call adds one record to the log, whether the answer was yes or no.
2. The record is added before the answer leaves `call`.
3. Each record says who called, what they asked for, yes or no, why for a no, and the
   request id.
4. If the log cannot take the record, the answer is a refusal,
   `EVIDENCE_STORE_UNAVAILABLE`, never a "yes".
5. The log only grows. Nothing in the program changes or removes a record.

**Not the outcome of this step.** A log that survives the program stopping (step 09). A
chain of fingerprints that shows if an old record was changed (step 39). The full
decision bundle, and what the agent says about itself (step 33). An identity mode for
the agent (step 18).

**The success signal.** Make something fail after DSoR has decided and before the
answer is returned: line ⑤ says yes, and then the operation's code throws. The
decision's record is still in the log. Then move the log line to the point where the
answer is ready, run the same test, and the record vanishes from the log. This is the
break-it exercise from the map of all steps. (Changed before the first test: see
"Think it through".)

### What the specification asks, and what this step can honestly give

Checked on 2026-09-27:

1. **DSOR-EXE-02 says "durably".** The decision must be "durably recorded before the
   response is returned". A list in memory is not durable. This step meets the second
   half, **before the response**. Durable arrives with the database in step 09.
2. **DSOR-AUD-01 asks for a record that validates against `audit-record.schema.json`.**
   That schema requires a chain of fingerprints (`chain`, `sequence`, `previous_hash`,
   `record_hash`), which is step 39, and an `identity` with a `mode`. The agent has no
   identity mode until its permission slip in step 18 (step 05's README, decision 8).
   Filling those fields now would mean inventing fingerprints and a mode. So this step
   does not meet DSOR-AUD-01, and says so. It uses the schema's own field names
   wherever it honestly can.
3. **DSOR-AUD-01 covers command decisions.** A refusal of `invoice.issue` is a command
   decision, with the answer `DENY`, so it is covered. A plain read such as
   `invoice.get` is not. Reads are recorded anyway (decision 2).

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-EXE-02 | **C1.** Every answer `call` gives has a record in the log | One test for each kind of answer: a success, each refusal from steps 04 to 07, and a bug |
| DSOR-EXE-02 | **C2.** A failure between the decision and the answer still leaves a record | Line ⑤ says yes, the code throws at line ⑨, and the record is in the log |
| DSOR-EXE-02 | **C3.** The record holds the outcome and, for a refusal, its reason | `authorization` is `ALLOW` once the call reached its code, else `DENY`. `result` is `ok` or the code the caller heard. `reason` is the refusal's message |
| DSOR-EXE-03b, pulled forward | **C4.** If the log cannot take the record, the answer is `EVIDENCE_STORE_UNAVAILABLE` | A log that refuses to write, and a call that would have succeeded |
| (our decision) | **C5.** The log only grows | Reading the log gives a copy. Nothing can change or remove a record |

§21 lists the decisions a record must hold: "outcome, controls evaluated, and the reason
for any `DENY`". There are no controls until step 27, so "controls evaluated" is empty
here, and the record says nothing about them.

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **The decision is recorded at line ⑪ of the checklist,** the number §21 gives
   "RECORD DECISION", after the answer is known and before `call` returns it. Every
   answer passes through it: a success, every refusal, and a bug that becomes
   `INTERNAL_ERROR`. *Downside:* a refusal at line ① now travels to line ⑪ before it is
   returned, so the checklist has one more line every refusal must pass.
2. **Every call is recorded, reads too.** DSOR-AUD-01 asks only for command decisions.
   But an agent reading every invoice one by one at 2 a.m. should leave a trace as well.
   This is stricter than the specification, never looser. *Downside:* the log grows with
   every read.
3. **A call with no login gets a record of its own.** §29 allows refusals before the
   tenant is known to be counted instead, "so that an unauthenticated flood cannot fill
   the audit store". In memory, for now, one record each is simpler. *Downside:* a flood
   of calls with no login fills the log. When the log becomes a database in step 09,
   this is worth deciding again.
4. **If the log cannot take the record, the call is refused with
   `EVIDENCE_STORE_UNAVAILABLE`.** That is DSOR-EXE-03b, an L2 rule, brought in early:
   no record, no action. §28 gives it the retry class `safe_same_key`, which is true
   here: nothing was done. *Downside:* that refusal itself cannot be recorded, because
   the log is the thing that failed. The README says so.
5. **A record uses the audit record's own field names where it honestly can:**
   `record_id`, `sequence` (its place in the log), `at`, `kind` (`"decision"`),
   `operation`, `authorization`, `result`, `reason`, and `correlation`. Who called is in
   `correlation`, as step 05 already puts it there.
   - `operation` is the contract's id and version, such as `invoice.get@1`. A name with
     no contract has no version, so `operation` is left out, and the refusal's message
     in `reason` names what was asked for.
   - `authorization` is `ALLOW` once DSoR's checks let the call reach its code at line
     ⑨, and `DENY` for a refusal before that. The specification's own example does the
     same: a payment that ran is `ALLOW`, and what happened is in `result`.
   - `result` is `ok` for a success, and otherwise the code the caller heard, such as
     `RESOURCE_NOT_FOUND`. `reason` is that refusal's message.
   - There is no `tenant`. Finding the tenant is line ②, which step 10 builds.
   *Downside:* the record does not validate against `audit-record.schema.json`, and
   finding 2 above says which fields are missing and why. A `DENY` is not every "no" a
   caller hears: "no invoice INV-9999" is `ALLOW` with the result `RESOURCE_NOT_FOUND`.
6. **The log is a small module with two functions: add a record, and read a copy of all
   records.** Nothing else touches it. *Downside:* a test that needs a broken log must
   be able to swap in one that refuses to write, so the log is passed to `call`, the
   way the registry is.

### The tests, by claim

- **C1:** one record for each kind of answer, with the right `authorization`, `result`,
  and `reason`.
- **C2:** line ⑤ says yes, and then the operation's code throws at line ⑨. The record
  of that call is in the log, `ALLOW` with the result `INTERNAL_ERROR`. With the log
  line moved to where the answer is ready, the same test fails.
- **C3:** a refusal before line ⑨ is `DENY`, with its code as the result and its
  message as the reason. A success is `ALLOW` with the result `ok`, and no reason.
- **C4:** a log that refuses to write turns a call that would succeed into
  `EVIDENCE_STORE_UNAVAILABLE`, and the invoice is never returned.
- **C5:** changing a record read from the log does not change the log. Two calls give
  two records, in order.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| S1 | The log line is moved to the end of the `try`, where the answer is ready, so a throw skips it | C1's refusals, and C2 | caught easily |
| S2 | The record is written in a `finally` block, §21's common mistake | only a test where the whole program stops, which step 09 makes possible | survives |
| S3 | A refusal is not recorded, only a success | C1 | caught by many |
| S4 | When the log cannot write, the answer is given anyway | C4 | caught by C4 |

S2 is the break §21 warns about. In this step it may survive every test. A `finally`
block runs even when an error is thrown, and a log in memory is lost when the program
stops anyway, so there is nothing yet to catch it. Step 09 can: stop the program between
the decision and the answer, start it again, and look in the database.

The review also attacks the step with the §10.2 threat that is this step's reason: T12,
"audit tampering, loss of evidence on crash, audit flooding".

### Left open, and not this step's idea

- **A log that survives the program stopping**, which the program itself may add to but
  never change (DSOR-AUD-04a), and which is never kept only in an agent's memory
  (DSOR-AUD-02a): step 09.
- **Counting refusals with no login, instead of one record each:** step 09, with a real
  store to fill.
- **A chain of fingerprints over the log:** step 39.
- **The record's tenant:** step 10, when line ② finds it.

## What changed since step 07

```text
src/log.ts                  NEW: the decision log. createLog() gives a log with two
                            functions, add and records. The list of records is out of
                            reach of everything else. decisionOf() says what a record
                            holds about one answer (decision 5)
src/pipeline.ts             changed: call() takes the log as its second argument. The
                            try now only works out the answer. Line ⑪, after the
                            catch, writes the record, and then call returns the answer.
                            A log that throws turns any answer into
                            EVIDENCE_STORE_UNAVAILABLE
src/main.ts                 changed: prints the log, one line per record, and calls
                            through a log that cannot write
test/decision-log.test.ts   NEW: the log, by claim (C1 to C5)
test/pipeline.test.ts       changed: every call now ends at line ⑪
test/startup.test.ts        changed: the program prints one record for each call
test/helpers.ts, and every  changed: each call passes a log. This part of the diff is
test that calls call()      mechanical, and was its own commit
src/, test/                 step 07's NEW IN STEP markers are now plain comments
```

There is no new dependency. The record's id comes from `randomUUID()`, which Node
already has, and which step 04 used for request ids.

Every new region is marked `NEW IN STEP 08`. To see the whole diff, run this from
`docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_07_the_pipeline_skeleton/src mj_08_write_the_decision_first/src
git diff --no-index mj_07_the_pipeline_skeleton/test mj_08_write_the_decision_first/test
```

Three choices in the code are worth a look:

- **The `try` only works out the answer.** In step 07, `call` returned from inside the
  `try` and from inside the `catch`. Now both only set `answer`. Line ⑪ comes after the
  `catch`, so a throw anywhere in lines ① to ⑩ ends in the `catch` and still reaches ⑪.
- **Line ⑪ has a `try` of its own.** Whatever the log throws, and even a bug while
  building the record, becomes `EVIDENCE_STORE_UNAVAILABLE`. What the log threw never
  reaches the caller: in a real store, that message can name a server or a path.
- **The log copies twice.** `add` stores a copy of the decision, and `records` hands
  out a copy of the list. A record shares its `correlation` with the answer the caller
  gets, so without the first copy, a caller could change the log by changing the
  answer it was given.

## Run it

From the root of the dsor repository:

```bash
cd docs/baby_steps_tutorials/mj_08_write_the_decision_first
pnpm install
pnpm start
```

The program makes the same eight calls as step 07 and prints the same answers. Then
it prints the log. "…" marks what is left out, and the ids change on every run:

```text
$ node src/main.ts
operations: [ 'invoice.get', 'invoice.issue' ]
…
{
  record_id: 'aud_1713a96d-1e9a-4301-80f3-9deffeaffc30',
  sequence: 1,
  at: '2026-09-27T03:58:14.377Z',
  kind: 'decision',
  operation: 'invoice.get@1',
  authorization: 'ALLOW',
  result: 'ok',
  correlation: {
    request_id: 'req_facdb2bd-eb86-4dfe-8ea5-ec9935687cc4',
    agent_id: 'accounts-payable-fte'
  }
}
1 invoice.get@1 ALLOW ok
2 invoice.get@1 ALLOW RESOURCE_NOT_FOUND
3 invoice.issue@1 DENY AUTHORIZATION_DENIED
4 invoice.get@1 DENY AUTHENTICATION_REQUIRED
5 invoice.get@1 DENY AUTHORIZATION_DENIED
6 invoice.get@1 ALLOW ok
7 invoice.issue@1 DENY UNSUPPORTED_CAPABILITY
8 invoice.issue@1 DENY VALIDATION_FAILED
{
  code: 'EVIDENCE_STORE_UNAVAILABLE',
  message: 'DSoR could not record its decision, so it refuses the call',
  retry: 'safe_same_key',
  correlation: {
    request_id: 'req_82f5a23d-7398-4c36-9716-9be68ff04f21',
    agent_id: 'accounts-payable-fte'
  }
}
```

Eight calls, eight records, and six of them are refusals. Record 2 is `ALLOW`: the
agent may read invoices, so DSoR let the call reach its code, and the code found no
`INV-9999`. The last answer is the same call as record 1, through a log that cannot
write. The invoice was found, and the caller still does not get it.

```bash
pnpm check
```

```text
      Tests  469 passed (469)
```

Outside the dsor repository, the three tests that compare the schema copies have no
original to compare with, so they are skipped: `466 passed | 3 skipped`.

## Break it

**Move the log line to where the answer is ready.** This is S1, and the break-it
exercise from the map of all steps. In `src/pipeline.ts`, cut the whole block of line
⑪, from its comment to the end of its `catch`. Then put one line back, at the end of
the `try`, just after the answer is built:

```ts
    answer = { data, correlation };
    line(11, () => log.add(decisionOf(answer, contract, reachedCode)));
  } catch (thrown) {
```

It looks harmless. A success is still recorded, and the answer is ready when it is.
Run `pnpm start`, and look at the log:

```text
1 invoice.get@1 ALLOW ok
2 invoice.get@1 ALLOW ok
{
  code: 'INTERNAL_ERROR',
  message: 'DSoR hit an unexpected error',
  retry: 'never',
  …
}
```

Eight calls, and two records. Every refusal is thrown, the throw jumps to the `catch`,
and the `catch` skips the log line. The six "no" answers reached their callers and
vanished from the evidence. The full log gives a different answer too: its throw is
now caught as a bug, so the caller hears `INTERNAL_ERROR`, with the retry class
`never`, instead of `EVIDENCE_STORE_UNAVAILABLE`.

Run `pnpm test`. This is the test for the success signal, with "…" for what is left
out:

```text
 FAIL  test/decision-log.test.ts > C2: a failure between the decision and the answer still leaves a record > DSOR-EXE-02: the code throws after line ⑤ said yes, and the call is still recorded
AssertionError: expected [] to strictly equal [ { …(9) } ]

- Expected
+ Received

- [
-   {
-     "at": Any<String>,
-     "authorization": "ALLOW",
…
-     "result": "INTERNAL_ERROR",
-     "sequence": 1,
-   },
- ]
+ []
…
      Tests  28 failed | 441 passed (469)
```

Line ⑤ said yes, and then the code threw. The caller heard `INTERNAL_ERROR`, and the
log is empty. Put line ⑪ back, and `pnpm check` is green again.

**Now try S2, §21's common mistake.** Put the line ⑪ block inside a `finally` after
the `catch`, and return the answer from the `try` and from the `catch`. Run
`pnpm test`: all 469 pass. In one call that runs from start to end, a `finally` runs
before the answer reaches the caller, so no test here can see a difference. The
difference is a program that stops in the middle. Then the `finally` never runs, and
the answer may already be gone. A log in memory is lost in that case anyway, so there
is nothing yet to test. Step 09 writes to a database, and can stop the program between
the decision and the answer.

## Build it yourself with Claude Code

This is how the step was built. Each row is one commit or more:

| # | Move | What you do |
|---|---|---|
| 1 | Copy | Copy your step 07. Change the name and the description in `package.json` |
| 2 | Design first | Write "In plain words", "Why it matters", and "The design, before any code" |
| 3 | Check the design | Read §21, §28, §29, and `audit-record.schema.json` again. Fix the design where they say it is wrong |
| 4 | Make room | Pass a log to `call`, not used yet. Every call site changes, so this is its own commit |
| 5 | Red | Write the tests, one group per claim. Predict which pass before any code |
| 6 | Green | The log, then line ⑪ (DSOR-EXE-02), then the broken log (DSOR-EXE-03b). One commit each |
| 7 | Break it | Run every predicted break. Compare the results with your predictions |
| 8 | Review | A reviewer who has not seen your conversation attacks the step |
| 9 | Fix the review | Change the design first, then red tests, then the code. Run every break again |

Move 3 changed C2, C3, and decision 5 (see "Think it through"). In the red run, 2 of
the 29 new tests passed before any code, and all 8 changed order tests failed. The
learner predicted about 5 would pass, expecting the C4 tests to pass because they say
"no". They failed: nothing said "no" yet. With the log built and line ⑪ in place, only
the 5 C4 tests failed, as the learner predicted, and `call` threw
`disk full at /var/dsor/log` at the caller.

Build your own step 08 from a copy of your step 07. From `docs/baby_steps_tutorials`:

```bash
cp -R my_07_the_pipeline_skeleton my_08_write_the_decision_first
cd my_08_write_the_decision_first
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 08. Design first, and check it
against §21, §29, and audit-record.schema.json before any test. Three questions to
settle with me: in a call that never waits, what can fail between the decision and the
answer? Is a bug a denial? Which fields of the audit record can this step fill without
inventing them?
```

When `pnpm check` is green in your folder, and once the official step 08 exists:

```text
Now compare this folder with ../08_write_the_decision_first. Explain every difference,
and tell me which ones matter and why.
```

## Check yourself

1. Why must a refusal be written down, when nothing happened?
2. Why is the record written before the answer, and not after?
3. The log cannot take a record. DSoR has decided "yes". What does the caller hear, and
   why?
4. §21 calls a `finally` block too late. A `finally` block runs even when an error is
   thrown. So what does it miss?
5. Why does this step not meet DSOR-AUD-01?

<details>
<summary>Answers</summary>

1. A refusal shows someone tried. An agent that tries forty times in one night, learning
   from each refusal, is visible only if the refusals are written down.
2. If the answer goes first and something fails before the record is written, the caller
   acted on a decision that, as far as the evidence goes, was never made.
3. `EVIDENCE_STORE_UNAVAILABLE`. With no record, there is no action: a decision nobody
   can prove was made is what this step exists to prevent.
4. The whole program stopping. A `finally` block runs when an error is thrown, but not
   when the process dies. A record written before the answer is already safe when that
   happens, once the log is durable.
5. DSOR-AUD-01 asks for a record that validates against `audit-record.schema.json`. That
   needs a chain of fingerprints (step 39) and an identity mode for every caller, which
   the agent does not have until step 18. Filling them now would mean inventing them.

</details>

## Think it through

### Changed before the first test

The design above was checked against §21, §29, and `audit-record.schema.json` before
any test was written. Three parts were changed, with the learner, on 2026-09-27:

1. **C2 had no line to fail.** It said: make a line after ⑪ fail. But lines ⑫ to ⑰ are
   only comments, and `call` runs from start to end without waiting for anything. No
   code runs between writing the record and returning the answer, so no test could
   tell C2 from C1. Now the failure comes between the decision and the answer: line ⑤
   says yes, and the code throws at line ⑨. "After ⑪" becomes testable in step 09,
   where writing to the database is something `call` waits for.
2. **A bug is not a denial.** C3 said every refusal is `DENY` with its code as the
   reason. But "no invoice INV-9999" and a bug happen after DSoR allowed the call. Now
   `authorization` says whether the call reached its code, and `result` says what the
   caller heard. The reason is the refusal's message, so a refusal for an operation
   with no contract still names what was asked for.
3. **No tenant yet.** Decision 5 took `org_456` from the caller at line ①. Finding the
   tenant is line ②, step 10's work, so the record leaves it out.

_The rest is written after the review, with the result of every break in the table
above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXE-02 | The decision is durably recorded before the response is returned | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | 16 tests in `test/decision-log.test.ts`, C1 and C2, and 1 in `test/startup.test.ts`. Before the response only: not durable until step 09 |

Not met, and why: DSOR-AUD-01, whose record needs a chain of fingerprints (step 39) and
an identity mode for the agent (step 18). DSOR-EXE-03b is an L2 rule this step builds
early; its row waits for the review.

**Next:** step 09, PostgreSQL on Neon.
