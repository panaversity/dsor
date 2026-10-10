# Step 15 · Freshness labels

**New in this step:** every answer says how old its data is, when it was read and from where, and
the door refuses a `current` label stamped before the request began.

## In plain words

Every answer this program gives was true at one moment. Until now it did not say which moment, or
where it came from. An answer and a copy of that answer kept for an hour looked exactly the same.

Three things change that here:

- **Every read carries a label**, with three parts: the *mode*, how fresh it is; `observed_at`,
  when it was read; and the *connector*, where it was read from. Today the connector is `postgres`,
  the database that holds the invoices, and every read is `current`, which §27 defines as "read
  from the system of record within this request". The label lives in `src/freshness.ts`.
- **The code that reads writes the label.** `getInvoice` and `listInvoices` hand back their rows
  with a label taken just before the query, so the rows are at least as fresh as it says. Only that
  code knows where the rows came from and when. The door, where every answer leaves, does not know, so it cannot write a label. It
  insists on one instead: a single invoice or a page with no label, or with a label that is not one,
  is the program's own error, never to retry (decision 120). A label's time must be exact, like
  `2026-10-10T21:30:05.123Z`, and not later than now. And a query must answer with a read: one that
  answers with a command's receipt, which carries no label, is refused too (decision 121).
- **A value read before this request is never `current`.** The door notes when each request
  begins. A label that says `current` with a time from before that is a saved copy calling itself
  fresh, and the door refuses it (`DSOR-FRS-01b`). It does not quietly change the label: that would
  let the data out and hide the bug that wrote the lie. The same saved copy, honestly labelled
  `observational`, leaves with its label and its time. The door checks when a label was stamped. It
  cannot see whether the code that stamped it really read the database, so the cache a later step
  adds must label its own answers honestly (decision 121).

There are four modes. `current` is read from the system of record within this request.
`bounded_staleness` is no older than an agreed age. `observational` is whatever was saved, with no
promise. `connector_defined` is whatever the connector documents. The specification writes them two
ways: in capitals in §27, and in lowercase in its schemas. This step writes them in lowercase, the
way the contract files already do, so a contract's required mode and an answer's delivered mode can
be compared exactly (decision 120, and open question 51). A label in capitals is not a label here,
and the door refuses it.

The rule also asks for the row's version, "where one exists". No invoice has a version yet: nothing
counts a row's changes until step 21, so the label names none.

## Why it matters

Step 14's demo, the agent's read of INV-1008:

```text
accounts-payable-fte  (internal)               dsor://org_456/invoice/INV-1008  (amount withheld)  issued
                        withheld: amount (clearance)
```

That is all of it: `issued`, with no time and no source. At 09:00 the agent reads INV-1008 and
keeps it in its memory. At 09:30 user_123 pays it, 31,400.00 USD as PAY-901 (payments arrive in
step 17). At 10:00 the agent plans the day's payments from its memory, which still says `issued`.
Nothing tells the agent, or a person checking its work, that its copy is an hour old.

DSoR meets the same problem from the inside. A later step adds a cache, a saved copy kept to answer
faster. If a saved "unpaid" could call itself current, a check that should stop a second payment
would pass. That is why `DSOR-FRS-01b` exists. The door enforces the part it can see before any
cache exists: no label stamped before a request began may say `current`.

## What changed since step 14

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_14_classification_and_masking ../my_15_freshness_labels
```

| File | What |
| --- | --- |
| `src/freshness.ts` | new — the four modes, the label (`mode`, `observed_at`, `connector`), `readNow` for the code that reads, `labelFrom`, which keeps a label's three parts and nothing else, and `cannotBeLabelled`, the door's check |
| `src/invoice.ts` | `getInvoice` and `listInvoices` hand back their rows with a `current` label, taken just before the query; one label per page, because a page is one read |
| `src/operations.ts` | the two queries pass the label on; a single invoice and a page carry `freshness`, in what a handler hands the door and in what leaves; the door notes when a request begins, and refuses a read whose label is missing, is not one, or says `current` with a time from before the request began, and a query that answers with a receipt |
| `src/boundary.ts` | `copyOnce` copies the label once, like a row, and `leaveTheDoor` keeps only its three parts in what leaves |
| `src/main.ts` | under every read the demo prints, a line that says how old it is |
| `test/freshness.test.ts` | new — eighteen tests: the agent's invoice and a page say how old they are; ten labels that are not labels, refused; a query that answers with a receipt, refused; the label that leaves is exactly its three parts; an old value labelled `current`, refused; the same value labelled `observational`, let out; the line at the request's start, to the millisecond; and the time taken before the query |
| `test/main.test.ts` | the demo's label pinned by its shape, and the report two runs are compared on swaps the time for `TIME`, as it swaps hashes for `HASH` |
| seven older test files | read the store through `.value`, and their stand-in handlers label what they hand over |
| everything else | a `NEW IN STEP 14` marker becoming `STEP 14`. Migrations 006 and 007 keep theirs: an applied migration is never edited, because its checksum covers every byte |

512 tests became 531. No new migration: the database tier is still 39.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step is the line under each read:

```text
user_123              (confidential)           dsor://org_456/invoice/INV-1008  31400.00 USD       issued
                        current, read at 2026-10-10T17:41:26.279Z from postgres
accounts-payable-fte  (internal)               dsor://org_456/invoice/INV-1008  (amount withheld)  issued
                        withheld: amount (clearance)
                        current, read at 2026-10-10T17:41:26.281Z from postgres
```

Each read says it is `current`, when it was read, in UTC, and where from. Your times will differ:
they change on every run. Every page says it too, once for the whole page. A refusal and a
command's receipt carry no label.

### The database tier

`pnpm check` needs no server. The thirty-nine tests in `pnpm test:db` need two real logins and a
database of this step's own. Copy step 14's `.env` and change the database name in both URLs:

```bash
cp ../my_14_classification_and_masking/.env .env     # then dsor_step14 -> dsor_step15 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first. This folder's own was made on Neon with the owner login already
in step 14's `.env`, by one `CREATE DATABASE dsor_step15`; then `pnpm migrate` applied the seven
migrations. This folder's own run was on Neon: `39 passed` before the step's first edit, and
`39 passed` after its last.

## Break it

Ten, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `531` with `1 skipped`; in the repository it is `531 passed`.

### Break 1 · a fresh read says it is a saved copy

In `src/freshness.ts`, make `readNow` say `observational`.

```text
 Tests  4 failed | 526 passed | 1 skipped (531)
```

The data is as fresh as ever; only the label is wrong, in the safe direction. The two tests that
read a real label notice, and so does the demo's line. The fourth is a stand-in that counts on
`readNow` saying `current`: its hour-old label now says `observational`, which is honest, so it
leaves. A label that undersells is not dangerous, but `DSOR-FRS-01a` asks for the mode actually
delivered.

### Break 2 · the door drops a single invoice's label

In `src/boundary.ts`, in `leaveTheDoor`, leave `freshness` out of a single invoice's answer.

```text
 Tests  19 failed | 511 passed | 1 skipped (531)
```

Nineteen, most of them in the demo's test: the demo prints the label under every read, so it
crashes on its first one. A missing label is loud.

### Break 3 · the door does not insist on a label

In `src/operations.ts`, make `unlabelled` always `undefined`.

```text
 Tests  12 failed | 518 passed | 1 skipped (531)
```

Every check on the label goes at once: the ten labels that are not labels leave, a query that
answered with a receipt leaves with no label at all, and the hour-old `current` leaves too.

### Break 4 · the label leaves whole

In `labelFrom`, hand the label back as it came.

```text
 Tests  1 failed | 529 passed | 1 skipped (531)
```

A label with a row riding along in it leaves with the row, and `31400.00` reaches the agent inside
`freshness`. One test: the one that hands the door such a label.

### Break 5 · capitals count as a mode

In `cannotBeLabelled`, compare the mode without its case: `mode.toLowerCase()`.

```text
 Tests  1 failed | 529 passed | 1 skipped (531)
```

`CURRENT` passes as a mode. Nothing leaks, but an answer's mode can no longer be compared with a
contract's by plain equality, which is why decision 120 chose one spelling.

### Break 6 · an old value may call itself current

In `cannotBeLabelled`, remove the comparison with `startedAt`.

```text
 Tests  2 failed | 528 passed | 1 skipped (531)
```

The hour-old `current` leaves, and so does one stamped a millisecond before the request began.
This is `DSOR-FRS-01b`, gone.

### Break 7 · every old label is refused, honest ones too

Drop `mode === "current"` from the same check, so it refuses any label from before the request.

```text
 Tests  1 failed | 529 passed | 1 skipped (531)
```

The saved copy honestly labelled `observational` is refused. The rule is about a cached value
called current, not about a cached value: a fix that refuses too much is caught as well.

### Break 8 · a query may answer with a receipt

In `cannotBeLabelled`, make the check for a query's receipt never true.

```text
 Tests  1 failed | 529 passed | 1 skipped (531)
```

`invoice.get` answering with a command's receipt leaves with no label, and its read is not written
down.

### Break 9 · the label is stamped after the reply

In `getInvoice`, take the label again after the query returns.

```text
 Tests  1 failed | 529 passed | 1 skipped (531)
```

The label claims a round trip more freshness than is true. One test, with a connection that answers
50 ms late, sees it.

### Break 10 · the demo stops saying how old a read is

In `src/main.ts`, make `howOld` return nothing.

```text
 Tests  1 failed | 529 passed | 1 skipped (531)
```

The demo's lines look like step 14's again. One test, the one that pins the label under the
agent's INV-1008.

Restore each break and confirm `pnpm check` prints `531 passed` again.

## Build it yourself with Claude Code

Copy `my_14_classification_and_masking` to a new folder and ask:

> Start step 15, freshness labels. Before any code: run step 14's demo and show me what an answer
> says about how old its data is, and where that goes wrong for the agent. Then ask me the step's
> decisions one at a time. Then build it a piece at a time, red first, and break each piece on
> purpose.

## Check yourself

1. The agent reads INV-1008. What does the answer now say about how old it is?
2. Why does the code that reads write the label, and not the door?
3. A handler hands back a value it read an hour ago, labelled `current`. What happens, and why
   does the door not change the label to `observational` and let it out?
4. Why is there no `resource_version` in the label?
5. The specification writes `CURRENT`. Why does this step write `current`, and what happens to a
   label in capitals?

<details>
<summary>Answers</summary>

1. `current`, the time of the read, and `postgres`: three parts, in the answer's `freshness`. The
   time is this program's own clock, taken just before the query, so the data is at least that fresh.
2. Only the code that read knows where the rows came from and when. The door sees every answer but
   not its source, so a label written by the door would call everything `current`, a saved copy
   included, which is the lie `DSOR-FRS-01b` forbids. The door insists on a label instead, and
   refuses a read without one.
3. The door refuses it as the program's own error, never to retry: `current` means read within
   this request, and this was read an hour before the request began. Changing the label would let
   the data out and hide the bug that wrote the lie. A handler that labels the same value
   `observational` is telling the truth, and its answer leaves with that label.
4. The rule asks for one "where one exists", and no invoice has a version until step 21, optimistic
   concurrency. Adding one here would be step 21's idea in this step.
5. The schemas write the modes in lowercase, and so do this program's contracts, so an answer's
   mode and a contract's required mode can be compared without translating (decision 120). A label
   in capitals is not one of the four as this program spells them, and the door refuses it like any
   other label that is not a label.

</details>

## The rules this step meets

- **[DSOR-FRS-01a · L1]** Every query result MUST state `observed_at`, the `resource_version` where
  one exists, the connector, and the freshness mode actually delivered. Every single invoice and
  every page carries `freshness`: `mode`, `observed_at` and `connector`. No invoice has a version,
  so there is no `resource_version` to state. The door refuses a read whose label is missing or is
  not one, and a query that answers with a receipt.
  ([§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency))
- **[DSOR-FRS-01b · L1]** DSoR MUST NOT label a cached value `CURRENT`. Nothing in this program
  caches yet, so every read is `current` and true. The door refuses a `current` label stamped before
  the request began, whichever handler wrote it. It cannot see whether the code that stamped a
  label really read the database, so the cache a later step adds must label its own answers.

**What this step leaves, said plainly.** There is no cache, so `bounded_staleness`,
`observational` and `connector_defined` appear only in tests, in labels a handler could write. The
time in a label is this program's clock, taken just before the query, not the database's, so
that the label's time and the request's start are on one clock. A clock moved backwards during a
request could make an honest read look older than the request: the door would refuse it with retry
`never`, though a second try would succeed. A command's receipt and an error carry no label: §27's
first rule is about query results. The record of a read does not record how fresh the read was. `decision-bundle.schema.json` writes the modes in
capitals, so the day this program writes decision bundles, it translates at that one place (open
question 51).

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-FRS-02a` | Preconditions of `HIGH` and `CRITICAL` commands on `CURRENT` reads. Nothing reads a contract's preconditions until the controls arrive. L2. |
| `DSOR-FRS-02b` | `FRESHNESS_UNSATISFIABLE` when the connector cannot deliver the freshness asked for. The one connector here always reads live. L2. |

Everything earlier steps claimed still holds.

**Next:** step 16, `the_control_plane_store` — DSoR gets a place of its own for its paperwork.
Step 15 completes stage 2.
