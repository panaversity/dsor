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
answer is returned. The decision's record is still in the log. Then move the log line
after that point, run the same test, and the refusal vanishes from the log. This is the
break-it exercise from the map of all steps.

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
| DSOR-EXE-02 | **C2.** The record is written before the answer leaves `call` | A failure after the decision and before the answer leaves the record in the log |
| DSOR-EXE-02 | **C3.** The record holds the outcome and, for a refusal, its reason | `authorization` is `DENY` and `reason` holds the refusal's code |
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
   `record_id`, `sequence` (its place in the log), `at`, `tenant` (`org_456` once the
   caller is known, and left out before), `kind` (`"decision"`), `operation` (such as
   `invoice.get@1`), `authorization` (`ALLOW` or `DENY`), `result`, `reason`, and
   `correlation`. Who called is in `correlation`, as step 05 already puts it there.
   *Downside:* the record does not validate against `audit-record.schema.json`, and
   finding 2 above says which fields are missing and why.
6. **The log is a small module with two doors: add a record, and read a copy of all
   records.** Nothing else touches it. *Downside:* a test that needs a broken log must
   be able to swap in one that refuses to write, so the log is passed to `call`, the
   way the registry is.

### The tests, by claim

- **C1:** one record for each kind of answer, with the right `authorization`, `result`,
  and `reason`.
- **C2:** a test makes a line after ⑪ fail. The decision's record is in the log. With
  the log line moved after that failure, the same test fails.
- **C3:** a refusal's record holds its code as the reason. A success's record holds
  `ALLOW`.
- **C4:** a log that refuses to write turns a call that would succeed into
  `EVIDENCE_STORE_UNAVAILABLE`, and the invoice is never returned.
- **C5:** changing a record read from the log does not change the log. Two calls give
  two records, in order.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| S1 | The log line is moved after the answer is returned | C1, every test that reads the log | caught easily |
| S2 | The record is written in a `finally` block, §21's common mistake | only a test where the whole program stops, which step 09 makes possible | to predict |
| S3 | A refusal is not recorded, only a success | C1 | to predict |
| S4 | When the log cannot write, the answer is given anyway | C4 | to predict |

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

## What changed since step 07

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

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

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXE-02 | The decision is durably recorded before the response is returned | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | _to be counted_, before the response only: not durable until step 09 |

Not met, and why: DSOR-AUD-01, whose record needs a chain of fingerprints (step 39) and
an identity mode for the agent (step 18). DSOR-EXE-03b is an L2 rule this step builds
early; its row waits for the review.

**Next:** step 09, PostgreSQL on Neon.
