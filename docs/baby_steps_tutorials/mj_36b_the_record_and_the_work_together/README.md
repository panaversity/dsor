# Step 36b · The record and the work together

**New in this step:** a command's decision record and its bundle commit in the same database
transaction as its work and its outcome. A change never exists without the record that explains
it, and a record that cannot be written takes the change with it (DSOR-EXE-04a, DSOR-EXE-03b).

## In plain words

Every call DSoR answers leaves a **decision record** in `dsor.audit`, with a **bundle**, the full
file of why it was allowed (steps 08 and 33). Until this step, a command wrote two things, one
after the other:

```text
transaction 1:  claim the key  →  draft PAY-901  →  proposal COMMITTED  →  COMMIT ✔
transaction 2:  the decision record and its bundle                       →  COMMIT ✔
                                   ▲
                     a crash here: PAY-901 exists, and no record says who allowed it
```

A shop that rings up a sale, and only a moment later writes the carbon copy in the receipt book,
has the same gap: if the lights go out in between, the money is in the till and no receipt says
who sold what.

This step moves the record into transaction 1. The claim keeps its outcome, then the record and
its bundle are written through the claim's own transaction, then everything commits once. Either
the draft and its record both exist, or neither does.

## Why it matters

**A draft that nothing explains.** user_123 drafts PAY-901, 31,400.00 USD for VENDOR-44. The
server dies after the draft commits and before the record does. An auditor finds PAY-901 in
`app.payments`, a proposal `COMMITTED`, and no record: no "allowed by rule high-value-payment,
version 8", no login, no slip. The payment may be fine. Nobody can show it.

The caller is not misled: no answer left, and a retry with the same key replays the draft. The gap
is in the evidence, and evidence is what DSoR is for.

**Common mistake:** writing the record "inside the same function" as the work, but through
another connection. It looks like one step and is two transactions. Break B2 below does exactly
that, and only a crash at the right COMMIT shows it.

## The design, before any code

### How this step was made

36b was split from step 36 at the learner's request (2026-10-18). The learner decided four choices,
one at a time (D1 to D4). The tests were written first and shown red on step 36's code, then the
change was built, then broken on purpose.

The circled numbers are lines of DSoR's checklist (§21). Line ⑦ claims the key, line ⑧ makes the
proposal, lines ⑨ and ⑩ decide it, and line ⑪ writes the record.

### What each rule says

- **DSOR-EXE-04a:** "Where the connector's store and the control-plane store share a transaction,
  the state change, the final outcome, and the outbox entry MUST commit atomically."
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- **DSOR-EXE-03b:** "If the control-plane store cannot accept the decision or intent record, DSoR
  MUST NOT execute; the caller receives `EVIDENCE_STORE_UNAVAILABLE`."

The state change and the final outcome, the draft and the proposal's last move, already committed
together since step 22. The outbox is step 40's. What this step adds is the evidence of that
outcome, the record and its bundle, in the same transaction: the promise step 17 made in a comment,
"until step 36 commits the two together".

### Decisions

- **D1. Every command that runs** (the learner's choice). Every command's first call writes its
  record in the transaction that keeps its outcome. For a command that calls a bank, that is the
  transaction after step 36's checkpoint, the one that ends the work. *Downside:* the code after the
  claim, which shapes the answer, masks it, and checks its size, now runs inside the claim's
  transaction, so the transaction stays open a moment longer.
- **D2. Whatever the claim keeps** (the learner's choice). A draft, a proposal `DENIED` at lines ⑨
  and ⑩, one that waits for the CFO, and one `READY` in `propose_only` mode: each commits with its
  record. A call refused at lines ① to ⑦ keeps nothing but its record, so that record keeps its own
  transaction. A replay changes nothing, so its record is written afterwards, as before.
- **D3. No record, no change** (the learner's choice). A record that cannot be written rolls back
  the claim, the proposal, and the work. The caller hears `EVIDENCE_STORE_UNAVAILABLE`: "DSoR could
  not record its decision, so it kept nothing of the work, and a retry with the same idempotency_key
  runs it again". After the bank was asked, nothing can be rolled back: the answer is
  `OUTCOME_UNKNOWN`, as step 36's review fix gives, and the record of that answer follows.
  *Downside:* memory has no transaction. In the unit tests' memory world, the draft the code wrote
  stays in memory's payments, and a retry drafts a second one. The database tests show the real
  behaviour.
- **D4. Both attacks** (the learner's choice). An owner trigger makes `dsor.audit` refuse one
  decision record, and a real process is killed with `SIGKILL` at the claim's COMMIT, after its
  record was written. Both were run on step 36's code first, and failed there.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1. A record that cannot be written keeps nothing of the work: no claim, no proposal; the same key runs again | `test/sealed.test.ts`, `test/sealed.db.test.ts` |
| C2. A waiting proposal goes with its record too | `test/sealed.test.ts`, `test/sealed.db.test.ts` |
| C3. After the bank was asked, a refused record is `OUTCOME_UNKNOWN`, and the record that follows says so | `test/sealed.test.ts`, `test/sealed.db.test.ts` |
| C4. A process killed at the claim's COMMIT, after the record was written, leaves nothing | `test/sealed.db.test.ts` |
| The review's findings, each with its test | `test/sealed.test.ts`, `test/sealed.db.test.ts` |

## What changed since step 36

| File | What changed |
| --- | --- |
| `src/pipeline.ts` | The code after the claim is three functions, `afterClaim`, `tail`, and `finish`; the claim runs `sealWith`, which shapes the answer and writes line ⑪'s record through the claim's transaction; line ⑪ skips a record already kept (D1 to D3) |
| `src/claims.ts`, `src/postgres.ts` | A claim takes a seal, runs it on every first call before it commits, and says when it did; the claim's transaction is handed to the log (D1, D2) |
| `src/log.ts`, `src/postgres.ts` | The log can write into a transaction it is given (D1) |
| `test/sealed.test.ts`, `test/sealed.db.test.ts`, `test/crash-at-the-record.ts`, `test/owner-records.ts` | **New.** The claims C1 to C4 |
| Five earlier tests | A record that fails now keeps nothing. Each says "Changed in step 36b" |

```bash
git diff --no-index ../mj_36_write_it_down_before_you_act/src src
git diff --no-index ../mj_36_write_it_down_before_you_act/test test
```

## Run it

As in step 36: a local PostgreSQL 17 and a database of its own. No new migration.

```bash
pnpm install
pnpm migrate
pnpm start
pnpm test:db
```

The program's story is the same as step 36's: nothing a caller hears changes on a good day. The
difference shows only when the record fails, so the proof is the database tests. From a real run
on 2026-10-18, the four tests of `test/sealed.db.test.ts` on step 36's code, then on this step's:

```text
step 36's code:
  × killed with SIGKILL ... no draft, no proposal, no claim, and no record       expected [ { …(2) } ] to strictly equal []
  × the record of user_123's draft is refused: ... no draft, no proposal          expected [ { …(2) } ] to strictly equal []
  × the record of the agent's INV-1008, which waits for the CFO, is refused       expected [ { …(2) } ] to strictly equal []
  × the record of a send is refused, once: OUTCOME_UNKNOWN ...                    expected EVIDENCE_STORE_UNAVAILABLE
this step's code:
  Tests  4 passed (4)
```

Each `[ { …(2) } ]` is a proposal that outlived its record: the orphan this step removes.

## Break it

Each break ran on 2026-10-18 in a fresh copy of this folder, with a fresh database.

| Break | What changed | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The claim never runs the seal: the record is written afterwards, as in step 36 | 3 of 3 | 4 of 4 |
| **B2** | The log writes in a transaction of its own, inside the claim | 0 | 1: the crash at the claim's COMMIT |
| **B3** | A record that cannot be written is ignored, and the work commits | 3 of 3 | 2 |

B2 is the common mistake above. It passed every test at first: the crash test killed the first
COMMIT after the record, which under B2 was the log's own. The test now kills the next COMMIT on the
connection that kept the claim's answer, so a record committed apart is found without its work.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | The problem | A draft committed before its record; a crash between leaves a change nothing explains |
| 2 | Decide | Four choices, one at a time, by the learner |
| 3 | Red | 3 unit tests and 4 database tests, red on step 36's code |
| 4 | Build | The seal in both claim stores; the pipeline's tail as functions; the log writes into a given transaction |
| 5 | Earlier tests | Five tests that pinned the old rule moved with D3 |
| 6 | Break it | B1 to B3, in copies of the folder |
| 7 | Review | A reviewer who had not seen the conversation |
| 8 | Fix | F1 to F3, each with its test, red first; N1 and N2 as new guards |

To start it in a new session:

```text
Build step 36b in learner mode from the design in
docs/baby_steps_tutorials/mj_36b_the_record_and_the_work_together/README.md.
```

## Check yourself

1. Before this step, what could a crash leave behind that no record explains?
2. The database refuses the record of user_123's draft. What does user_123 hear, and what is left
   in the database?
3. Why is a record written by the log through another connection, at the same moment, not enough?
4. The record of a send is refused after the bank sent the money. Why is the answer not
   `EVIDENCE_STORE_UNAVAILABLE` with nothing kept?
5. A call refused at line ③ for having no slip: does its record need the claim's transaction?

<details>
<summary>Answers</summary>

1. A committed draft and its proposal, with no decision record and no bundle.
2. `EVIDENCE_STORE_UNAVAILABLE`, "kept nothing of the work". No draft, no proposal, no claim. The
   same key later runs it again (D3).
3. Two connections are two transactions. The record commits on its own, and if the claim's COMMIT
   then fails, the record names a draft that does not exist (B2).
4. The money may have left, and nothing undoes it. The claim and the note were committed at step 36's
   checkpoint, so the honest answer is `OUTCOME_UNKNOWN` (D3).
5. No. It keeps nothing but its record, so the record is the whole of what it writes (D2).

</details>

## Think it through

### Found while building

- **A proposal's moves write into `dsor.audit` too**, inside the claim, as `proposal_transition`
  rows. The first owner trigger refused those, so two tests passed on step 36's code for the wrong
  reason, and the first crash watcher killed the claim itself instead of the record. The trigger now refuses only
  `kind = 'decision'`, and the watcher looks for the bundle's INSERT, which only the decision record
  writes.
- **A deadlock in a small pool.** A release reads its proposal again after the claim. Inside the
  seal that read went through the pool, while the claim held a connection: two releases at once on
  a pool of two each waited for the other's. It reads through the claim's own transaction now.
- **A record that fails twice.** If the record of the work fails, and then the record of that
  refusal fails too, the caller still hears "kept nothing of the work", not the words for a call
  refused before its code.

### What the review found

A reviewer who had not seen the conversation confirmed the main fix: a refused record and a real
crash at the claim's COMMIT both leave nothing. It found two defects, both from what the seal
writes into the call's notes for the record before the COMMIT, and never took back:

- **F1 (high). After the bank was asked, a caller could hear "kept nothing".** The record of a send
  failed in the seal, the answer became `OUTCOME_UNKNOWN`, and then the record of that failed too.
  The words said "kept nothing of the work, and a retry runs it again", though the money may have
  left. Now only the claim's own "kept nothing" refusal says that. Here the caller hears that the
  command ran and a retry cannot run it twice, and the same key hears `OUTCOME_UNKNOWN`.
- **F2 (high). A COMMIT that failed after the seal left a false record.** The seal had noted the
  proposal, the draft, and "committed" for the record. The COMMIT failed, everything rolled back,
  and the record written afterwards still named them. Now the seal keeps a copy of those notes
  first, and puts them back whenever its work was not kept.
- **F3. Memory and the database disagreed after the checkpoint.** In memory, a seal that failed
  after the bank had already moved the proposal to `COMMITTED` and ended the note. Memory now seals
  before the proposal's last move, so it is left `EXECUTING` with its note open, as on the
  database.
- **F4. One request, two records,** when a COMMIT reaches the database and its answer is lost: the
  sealed record is kept, and the record of the error follows. Left open (below).
- **N1, N2. Missing tests.** A `DENIED` call and a `READY` call whose record is refused, and a
  release whose record is refused: each has a test now. They passed at once; they guard the paths a
  later change could break.

### Left open on purpose

- **The outbox** (step 40). DSOR-EXE-04a names it, and no event is published yet.
- **A replay's record** is written after the replay, in its own transaction, as before. A replay
  changes nothing, so a crash leaves only a missing line for a call that changed nothing.
- **Memory keeps the draft** a refused call wrote (D3). Only the database rolls it back.
- **A COMMIT whose answer is lost** (the review's F4). The work and its record may be kept, and
  the record of the error that follows names nothing of them. A retry with the same key gives back
  what was kept.
- **Two database tests fail on a throwaway server**, as in steps 34 to 36: one that accepts any
  password, and an owner that belongs to no other role. On the learner's own server both pass.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-EXE-04a | The change, its outcome, and (since this step) its record commit together | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | [`test/sealed.test.ts`](test/sealed.test.ts), [`test/sealed.db.test.ts`](test/sealed.db.test.ts) |
| DSOR-EXE-03b | No record, no execution: the work is not kept | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | [`test/sealed.db.test.ts`](test/sealed.db.test.ts) |

**Next:** step 37, outcome unknown: hold the payment and the invoice while nobody knows.
