# Step 08 · Write the decision first

**New in this step:** before DSoR gives any answer, yes or no, it writes that decision
down in a log (DSOR-EXE-02).

## In plain words

Until now, when DSoR refused a call, the refusal went back to the caller and nothing
remembered it. From this step, every call leaves one **record** in a **log**: who
called, what they asked for, whether the answer was yes or no, why, and which call it
was.

The important word is **before**. The record is written first, and only then is the
answer returned. So no answer reaches a caller unless the log already holds it. There is
one exception: when the log itself is broken, the caller hears that, and nothing can be
written down (decision 4).

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
block runs even when an error is thrown, so it looks safe. But in a server, the answer
can be sent to the caller inside the `try`, before the `finally` starts. If the program
stops at that moment, the caller has the answer and the log has nothing.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of
the specification it relies on was read on 2026-09-27: §21 (DSOR-EXE-02, DSOR-EXE-03b),
§28 (the retry class of `EVIDENCE_STORE_UNAVAILABLE`), and §29 (DSOR-AUD-01, the
paragraph on rejections at steps 1 and 2, and `audit-record.schema.json`). If the code
finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** DSoR keeps evidence of every decision, and the evidence exists before anyone
hears the answer, including every "no". The analogy is the clerk's logbook.

**Outcome.** What is true when this step is done:

1. Every call adds one record to the log, whether the answer was yes or no. The one
   exception is outcome 4, when the log itself cannot take the record.
2. The record is added before the answer leaves `call`.
3. Each record says who called, what they asked for, yes or no, why for a no, and the
   request id.
4. If the log cannot take the record, the answer is a refusal,
   `EVIDENCE_STORE_UNAVAILABLE`, never a "yes".
5. The log only grows. Nothing in the program changes or removes a record.

**Not the outcome of this step.** A log that survives the program stopping (step 09). A
hash chain that shows if an old record was changed (step 39): each record carries a
hash of the record before it, and a hash is a short code worked out from a record's
content, which changes when the content changes. The decision bundle, the complete file
for one decision, and what the agent says about itself (step 33). An identity mode for
the agent (step 18): whether it acts for a person who is present, or on its own.

**The success signal**, a test that fails if this step's code is deleted: make something fail after DSoR has decided and before the
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
   That schema requires a hash chain (`chain`, `sequence`, `previous_hash`,
   `record_hash`), which is step 39, and an `identity` with a `mode`. The agent has no
   identity mode until its permission slip in step 18 (step 05's README, decision 8).
   Filling those fields now would mean inventing hashes and a mode. So this step
   does not meet DSOR-AUD-01, and says so. It uses the schema's own field names
   wherever it honestly can.
3. **DSOR-AUD-01 covers command decisions.** A refusal of `invoice.issue` is a command
   decision, with the answer `DENY`, so it is covered. A plain read such as
   `invoice.get` is not. Reads are recorded anyway (decision 2).

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-EXE-02 | **C1.** Every answer `call` gives has a record in the log, except the refusal for a broken log (C4) | One test for each kind of answer: a success, each refusal from steps 04 to 07, and a bug |
| DSOR-EXE-02 | **C2.** A failure between the decision and the answer still leaves a record | Line ⑤ says yes, the code throws at line ⑨, and the record is in the log |
| DSOR-EXE-02 | **C3.** The record holds the outcome and, for a refusal, its reason | `authorization` is `ALLOW` once the call reached its code, else `DENY`. `result` is `ok` or the code the caller heard. `reason` is the refusal's message |
| DSOR-EXE-03b, pulled forward | **C4.** If the log cannot take the record, the answer is `EVIDENCE_STORE_UNAVAILABLE` | A log that refuses to write, and a call that would have succeeded |
| (our decision) | **C5.** The log only grows | Reading the log gives a copy. Nothing outside the log can change or remove a record, and its two functions cannot be replaced |

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
   `EVIDENCE_STORE_UNAVAILABLE`.** That is DSOR-EXE-03b, brought in early. It is an L2
   rule: level 2, for agents that act on their own, one level above the L1 core. No
   record, no answer. §28 gives it the retry class `safe_same_key`: the caller may send
   the same request again. That is true here. For a query, the read at line ⑨ has
   already happened, but its answer is never given, so trying again changes nothing.
   *Downside:* that refusal itself cannot be recorded, because the log is the thing
   that failed.
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
   point 2 of the list above says which fields are missing and why. A `DENY` is not every "no" a
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

The review also attacks the step with the threat that is this step's reason. §10.2 of
the specification lists threats, and this one is T12: "audit tampering, loss of evidence
on crash, audit flooding".

### Left open, and not this step's idea

- **A log that survives the program stopping**, which the program itself may add to but
  never change (DSOR-AUD-04a), and which is never kept only in an agent's memory
  (DSOR-AUD-02a): step 09.
- **Counting refusals with no login, instead of one record each:** step 09, with a real
  store to fill.
- **A hash chain over the log:** step 39.
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
                            EVIDENCE_STORE_UNAVAILABLE. The catch cannot throw either,
                            so nothing skips line ⑪
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
      Tests  475 passed (475)
```

Outside the dsor repository, the three tests that compare the schema copies have no
original to compare with, so they are skipped: `472 passed | 3 skipped`.

## Break it

**Move the log line to where the answer is ready.** This is S1, and the break-it
exercise from the map of all steps. In `src/pipeline.ts`, cut the whole block of line
⑪, from its comment to the end of its `catch`. Then put one line back, at the end of
the `try`, right after the answer is built. `contract` is the operation's contract,
found earlier in the same `try`:

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
      Tests  31 failed | 444 passed (475)
```

Line ⑤ said yes, and then the code threw. The caller heard `INTERNAL_ERROR`, and the
log is empty. Put line ⑪ back, and `pnpm check` is green again.

**Now try S2, §21's common mistake.** Put the line ⑪ block inside a `finally` after
the `catch`, and return the answer from the `try` and from the `catch`. Run
`pnpm test`: all 475 pass. Here, returning is how the answer leaves, and a `finally`
runs before the returned answer reaches the caller. So no test in this step can see a
difference. The difference appears when the answer leaves another way: a server writes
it to the network inside the `try`, and the `finally` comes after. If the program stops
between the two, the caller has the answer and the log has nothing. A log in memory is
lost when the program stops anyway, so there is nothing yet to test. Step 09 writes to a
database, and can stop the program between the decision and the answer.

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
`disk full at /var/dsor/log` at the caller. Move 9 fixed two holes the review found and
closed five gaps in the tests: 475 tests in the end. All of it is under "Think it
through".

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
4. The program stopping after the answer has left and before the `finally` has run. In
   a server, the answer can be sent inside the `try`. If the process dies then, the
   `finally` never runs, and the caller has an answer the log never saw. A record
   written before the answer is already safe when that happens, once the log is durable.
5. DSOR-AUD-01 asks for a record that validates against `audit-record.schema.json`. That
   needs a hash chain (step 39) and an identity mode for every caller, which
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
2. **A failure after DSoR said yes is not a denial.** C3 said every refusal is `DENY`
   with its code as the reason. But "no invoice INV-9999", and a bug in the code, happen
   after DSoR allowed the call. Now
   `authorization` says whether the call reached its code, and `result` says what the
   caller heard. The reason is the refusal's message, so a refusal for an operation
   with no contract still names what was asked for.
3. **No tenant yet.** Decision 5 took `org_456` from the caller at line ①. Finding the
   tenant is line ②, step 10's work, so the record leaves it out.

### What the hostile review found, and what was fixed

Two reviewers who had not seen the build attacked it. One checked the rules against the
code and tried T12 with inputs of its own. The other made 62 small breaks, one at a
time, in a copy outside the repository.

- **A value that throws when DSoR looks at it made `call` throw.** The reviewer's
  request had a `token` that throws a Proxy. A Proxy is an object that runs code of its
  own whenever it is inspected. `toEnvelope` asks "is this a Refusal?", the Proxy threw
  again, the throw escaped `call`, and line ⑪ never ran. Nothing was recorded, and the
  caller saw the Proxy's own message. **Fixed:** the `catch` guards making the
  envelope. If that throws, the answer is the fixed `INTERNAL_ERROR` envelope, and line
  ⑪ records it. The gap is step 04's: its promise that `call` never throws covers
  what JSON can carry, and a Proxy is not JSON. Steps 04 to 07 still have it.
- **The log's `add` could be replaced.** `log.add = () => {}` made every call answer
  with nothing recorded. **Fixed:** the log is frozen, and a test tries it.
- **Five breaks left every test green.** A copy of each record that shared its
  `correlation` passed, because the test matched the request id to `/^req_[0-9a-f]/`,
  and `req_forged` matches that too. A log that took the time once, when it was
  created, passed. Building the record outside line ⑪'s `try` passed: "even a bug
  there" was only a comment. Setting `reachedCode`, the flag that says the call reached its code, before line ⑨'s
  observer passed. A
  broken log whose line ⑪ was never heard passed. **Fixed:** a test for each. Each
  break was run again, and each one is now caught. Seven more breaks changed nothing a
  caller can see, such as the order of a record's fields.
- **Sentences that claimed too much.** "Nothing reaches a caller that the log does not
  already hold" forgot the broken log. "Nothing was done" forgot that a query's read
  has already happened. The reason a `finally` is too late was wrong: the danger is an
  answer sent inside the `try`, before the `finally` runs. "Chain of fingerprints" was
  a new analogy, and is now a hash chain, defined. The success signal, the decision
  bundle, identity mode, L2, and T12 are now defined where they first appear.

### The breaks, run for real

| # | The break | Learner's prediction | Real result |
| --- | --- | --- | --- |
| S1 | The log line at the end of the `try` | caught easily | caught by 31 tests |
| S2 | Line ⑪ in a `finally` block | survives | survives: all 475 pass |
| S3 | Only a success is recorded | caught by many | caught by 27 tests |
| S4 | A broken log, and the answer given anyway | caught by C4 | caught by 7 tests: C4, and the program's log |

All four predictions were right. In the red run, the learner predicted about 5 of the
29 new tests would pass before any code, and 2 did.

### Left open on purpose

- **S2 survives, as designed.** Only a program that stops between the answer leaving
  and the record being written can show it. Step 09 can.
- **A store that writes the record and then fails.** The record says `ALLOW ok`, and
  the caller hears `EVIDENCE_STORE_UNAVAILABLE`. The log in memory cannot do this. A
  database can: it saves the record, and the reply that says so is lost. Step 09.
- **The first half of DSOR-EXE-03b has no test.** "DSoR MUST NOT execute" is about
  commands, and no command runs yet. For a query, the read at line ⑨ has already
  happened when the log fails. What is withheld is the answer. The test comes when a
  command first runs.
- **The observer runs inside line ⑪'s `try`.** An observer that throws at line ⑪
  turns a healthy log into `EVIDENCE_STORE_UNAVAILABLE`. Only tests pass an observer.
- **Whoever passes the log to `call` chooses where the evidence goes.** A log that
  writes nothing, passed in, would record nothing. Here only `main.ts` and the tests
  call `call`. The agent never holds the log: it will reach DSoR only through an
  interface that DSoR builds, from step 42.
- **A record holds text the caller chose.** The `request_id` is stored as sent, any 1
  to 128 characters, so two records can share one. Only `record_id` is unique. A
  refusal's `reason` can hold up to 60 characters of the operation name the caller
  sent. Each record is small, but the log has no limit (decision 3).
- **Five tests were not written red first.** The five that close the review's
  surviving breaks passed at once, because they guard against breaks that were not in
  the code. Each was shown to fail with its break in place.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXE-02 | The decision is durably recorded before the response is returned | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | 19 tests in `test/decision-log.test.ts`, C1 and C2, and 1 in `test/startup.test.ts`. Before the response only: not durable until step 09 |
| DSOR-EXE-03b | If the store cannot accept the decision record, DSoR does not execute, and the caller receives `EVIDENCE_STORE_UNAVAILABLE` | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | 5 tests in `test/decision-log.test.ts`, C4. An L2 rule built early. The caller's half only: no command runs yet |

Not met, and why: DSOR-AUD-01, whose record needs a hash chain (step 39) and an identity
mode for the agent (step 18).

**Next:** step 09, PostgreSQL on Neon.
