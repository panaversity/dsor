# Step 39 · A log nobody can quietly edit

**New in this step:** each record in DSoR's log carries the fingerprint of the record before it, in
one chain per company, written by the database, and `pnpm verify-audit` checks every chain
(DSOR-AUD-04b, DSOR-AUD-04c).

## In plain words

DSoR is a careful clerk between a company's people and AI workers and its real systems. Every
decision it makes, it writes down in its log, `dsor.audit`: who asked, what, under which slip, and
what DSoR answered. Since step 09, DSoR's own login may only add a record to the log, never change
or remove one (DSOR-AUD-04a).

But someone runs the database, and its *owner*, the login that made the tables, can change any row.
A *fingerprint* is a short code computed from a record's contents, here with SHA-256: change one
letter and the fingerprint changes completely. Unlike a finger's, anyone who knows the recipe can
make it again, so a fingerprint alone proves nothing; a chain of them does. In this step each record also holds the fingerprint
of the record before it, so the records form a *chain*. Change an old record and its fingerprint no
longer matches the one the next record holds. The break shows.

Think of a ledger whose pages are numbered, and where each page carries the fingerprint of the page
before it. Tear out a page in the middle or rewrite a line on it, and the next page gives it away.
The last pages can go with nothing to show, and a new last page can be added. And someone who
rewrites every page after the edit, with new fingerprints, makes the chain look whole again.
Keeping the last fingerprint somewhere the owner cannot reach is step 39b's checkpoint.

## Why it matters

A real run on step 38c's database, on 2026-10-20, a scratch database the tests had filled. The
owner edits one old record:

```text
records in dsor.audit: 3355
an old record:          2368 | 2026-10-19 | payment.reconcile@1 | DENY  | AUTHORIZATION_DENIED | user_123
after the owner's edit: 2368 | 2026-10-19 | payment.reconcile@1 | ALLOW | COMMITTED            | user_123
columns that could show the change: (none)
```

A refused call now reads as a settled payment; the same edit gave it the reason "reconciled by the
CFO", which the output does not show. An auditor
reading this log would believe it, and nothing in DSoR could tell them otherwise.

**Common mistake:** computing the fingerprints in DSoR's own code. Every path that writes a record
must then do it right, under a lock, and the database cannot stop one that does not. Two records
written at once could both claim the same predecessor. The second mistake is the one this step
made first: taking the chain's lock as the record goes in. The lock is held to the end of the
transaction, so every call of a company waits for every other.

## The design, before any code

### How this step was made

On 2026-10-20, after step 38c, the learner asked to build this step. The problem was shown with the
run above, and the learner decided five choices, each the recommended option (D0 to D4). The review
found one more choice, and the learner decided it (D8).

### What the rules say

- **DSOR-AUD-04b:** "Audit records MUST be tamper-evident through hash chaining, signed checkpoints,
  or an equivalent mechanism."
- **DSOR-AUD-04c:** "Where audit is partitioned into several chains, every record MUST belong to
  exactly one chain." ([§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention))

The specification allows chains per company: "Chains MAY be partitioned by tenant and shard so
that audit is not a global serialization point." Its audit-record schema already names the fields:
`chain`, `previous_hash`, and `record_hash`. Checkpoints, DSOR-AUD-04d, are step 39b's.

### The claims

| Claim | What it says |
|---|---|
| C1 | Every record, when its transaction commits, gets its chain, its place in the chain, the fingerprint of the record before it, and its own fingerprint, written by the database. DSoR's login cannot write any of the four. A record the trigger cannot write is refused at the commit, never kept without them |
| C2 | One chain for each company, and one for the records that name no company. Two records never share a place or a predecessor, even when written at the same moment |
| C3 | The migration chains every record already in the log, in the order they were written |
| C4 | `pnpm verify-audit`, run as the owner, recomputes every fingerprint and names, for each chain, the first record that does not fit: a field changed, a fingerprint changed, a record removed, records swapped, a record with no chain, or a chain whose head says more than its records |
| C5 | A whole log exits 0; a broken one exits 1; a log it could not check, with a login that cannot see every record, exits 2 |
| C6 | What it cannot catch, said in the README and by the script: a chain and its head rewritten from the edit on, its newest records removed with the head, and a new record the owner adds, with any date (step 39b catches the first two) |

### Decisions

- **D0. Chain only; checkpoints in step 39b** (the learner's choice). *Downside:* until 39b, a careful
  editor with the owner's login can rewrite the chain and its head from the edit on, or remove its
  newest records with the head, and the script finds nothing. Adding a new record, with any date,
  is the easiest forgery of all: the trigger chains it like any other, and a checkpoint taken before
  it does not see it either.
- **D1. One chain per company** (the learner's choice). The chain is named by the record's company;
  a record with no company, a call refused before its company was known, goes in a chain of its
  own. *Downside:* more chains to check.
- **D2. The database writes the fingerprints** (the learner's choice). A trigger on `dsor.audit`
  computes them when the record's transaction commits, holding the chain's head only for that
  moment. No path through DSoR's login can keep a record without them; a record kept another way,
  with the trigger off, has no chain, and the checker names it. It first ran as each row went in,
  and that locked a company's calls against each other (see "Found while building"). The trigger
  writes the log with the owner's rights, and the owner must hold BYPASSRLS, as Neon's does; a
  write that changes no row refuses the commit. *Downside:* the recipe is written in SQL, and the
  script must follow it exactly.
- **D3. The migration chains the old records** (the learner's choice). *Downside:* whatever the old
  rows say on the day of the migration is what the chain vouches for.
- **D4. A script, run as the owner** (the learner's choice). `pnpm verify-audit` reads every chain,
  recomputes each fingerprint in TypeScript, and names the first broken record of each chain.
  *Downside:* it uses the owner's login, the one that could edit the log; an auditor would want a
  read-only login of their own.
- **D5. The recipe** (Claude Code's). A record's fingerprint is SHA-256 over the previous
  fingerprint and every column of the record, each written as text with its length in bytes before
  it, so no two records can make the same text. The first record of a chain follows a fingerprint of
  zeros. *Downside:* a column added later must join the recipe, in both places.
- **D6. A place in the chain, and two unique keys** (Claude Code's). Each record gets
  `chain_position`, one more than the record before it in its chain. A unique key is a rule that no
  two rows share these values: the database refuses two records with the same chain and place, or
  the same chain and predecessor. The specification's audit-record schema calls the place in the
  chain `sequence`; here `sequence` is the log's own counter, kept from step 09, and the place is
  `chain_position`. *Downside:* two more columns and two more indexes.
- **D7. The chain of records with no company is named `no_company`** (Claude Code's). *Downside:*
  a company may never be called that, and the id pattern `org_` plus digits already ensures it.
- **D8. A table of chain heads** (the learner's choice, after the review's L1). `dsor.audit_heads`
  holds each chain's last place and fingerprint, and only the owner reads or writes it. The trigger
  locks a chain's row there until the commit ends, so no other login can stall a company's commits,
  as any login could with the first lock. The checker compares each chain with its head, and never
  trusts the head. *Downside:* one more table, a copy of what the chain says.
- **D9. One chain per transaction** (Claude Code's, after the review's L3). A transaction writes
  one company's records, as `inCompany` pins it, so it locks one head; two transactions locking two
  heads in opposite orders would wait for each other for ever. *Downside:* a rule kept by how DSoR
  works today, not by the database.

### The tests, by claim

| Claim | Tests |
|---|---|
| C4, C5 | `test/verify-audit.test.ts`: the checker over chains built in the test, whole and broken each way |
| C1, C2, C4, C5 | `test/audit-chain.db.test.ts`: real records, real parallel writes, the owner's edits, the database's keys, and the script itself |
| C3 | A real run on 2026-10-20: 41 records written under step 38c's schema, chained by migration 035, every chain whole |

### The breaks

The learner chose not to predict. Each break ran on 2026-10-20 in a fresh copy of this folder, with
a fresh database, against `test/verify-audit.test.ts` and `test/audit-chain.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | `authorization` left out of the recipe, in SQL and in TypeScript | 1 | 5 |
| **B2** | The trigger does not lock the chain's head | 0 | 1 |
| **B3** | The checker does not look at the predecessor | 1 | 1 |
| **B4** | The checker does not look at the places | 2 | 1 |
| **B5** | The recipe joins the fields with no lengths | 1 | 9 |
| **B6** | The trigger runs with `dsor_runtime`'s rights | 0 | 14 |
| **B7** | Two records may follow one predecessor | 0 | 1 |
| **B8** | A record the trigger could not write is kept, unchained | 0 | 1 |
| **B9** | The checker runs with a login that cannot see every record | 0 | 1 |

These are the counts after the review's fixes, rerun on 2026-10-20.

B1 is the dangerous one: the denied reconcile turned to `ALLOW` would pass, because the recipe no
longer covers that field, and both recipes agree with each other. A unit test now holds the
recipe's columns against the table's, and a database test changes each column in turn. B7 first passed every test: the lock already keeps one
predecessor per record, so the key behind it had none. A test where the owner tries it now does.

## Break it

The map's exercise, run for real on 2026-10-20, on a database chained by migration 035. The owner
edits one old record, then runs the script:

```text
the old record: 2 | invoice.issue@1 | DENY | AUTHORIZATION_DENIED
after the owner's edit: 2 | invoice.issue@1 | ALLOW | COMMITTED
no_company: whole, 2 records
org_456: broken at place 2, record aud_d01c2ca4-2c0d-4055-b01a-4ff47d4b1c27: its contents do not match its fingerprint
org_789: whole, 1 records
not checked: a chain and its head rewritten from an edit on (step 39b), or a new record the owner adds
exit=1
```

Then the careful editor, who knows the recipe, writes every fingerprint again from the edit on, and
the chain's head too:

```text
no_company: whole, 2 records
org_456: whole, 38 records
org_789: whole, 1 records
not checked: a chain and its head rewritten from an edit on (step 39b), or a new record the owner adds
exit=0
```

The chain cannot see this. That is what step 39b's checkpoint is for.

## What changed since step 38c

| File | What changed |
| --- | --- |
| `migrations/035_audit_chain.sql` | **New.** The four columns, the recipe in SQL, the old records chained, two keys, and the trigger that chains each record at its commit (D1 to D3, D5 to D7) |
| `src/audit-chain.ts` | **New.** The recipe in TypeScript, and the checker (D5) |
| `src/verify-audit.ts`, `package.json` | **New.** `pnpm verify-audit` (D4) |
| `src/store.ts`, `store.json` | The log's kind, `append-only-chained`, which allows its one named trigger; `dsor.audit_heads`, the owner's own |
| `test/verify-audit.test.ts`, `test/audit-chain.db.test.ts`, `test/owner-audit.ts` | **New.** The claims C1 to C6 |
| The other tests | The store map's lists of the log's columns and triggers. Each says "Changed in step 39" |

```bash
git diff --no-index ../mj_38c_the_list_of_alerts/src src
git diff --no-index ../mj_38c_the_list_of_alerts/test test
```

## Run it

As in step 38c: a local PostgreSQL 17 and a database of its own. Migration 035 is new.

```bash
pnpm install
pnpm migrate
pnpm start
pnpm verify-audit
```

`pnpm verify-audit` reads the owner's login, `DSOR_MIGRATION_URL`, from `.env`, and never prints it.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real edit of step 38c's database |
| 2 | Decide | Five choices by the learner; three details by Claude Code |
| 3 | The copy | Step 38c copied, its markers removed |
| 4 | Red | 13 unit tests and 7 database tests, all red |
| 5 | Code | Migration 035, the recipe and the checker, the script |
| 6 | Earlier tests | The store map; then the chain moved to commit time |
| 7 | Break it | B1 to B7, and the map's exercise, for real |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 39 in learner mode from the design in
docs/baby_steps_tutorials/mj_39_a_log_nobody_can_quietly_edit/README.md.
```

## Check yourself

1. The owner turns an old record from `DENY` to `ALLOW`. Which record does `pnpm verify-audit`
   name, and why?
2. The owner turns it over and writes that one record's fingerprint again. Which record is named
   now?
3. Why does each field carry its length in the recipe?
4. Why is the chain written at commit, and not as the record goes in?
5. What can a careful editor still do without being caught, and which step closes it?

<details>
<summary>Answers</summary>

1. That record itself: its contents no longer match its own fingerprint (C4).
2. The record after it: the fingerprint it holds of the record before is the old one, so it no
   longer follows (C4).
3. So no two different records make the same text: without lengths, "ab" then "c" and "a" then
   "bc" join to the same "abc" (D5, break B5).
4. A lock taken at the insert is held to the end of the transaction, so every call of a company
   waited for every other, and two rule drafts locked each other. At commit the lock is held only
   while the transaction ends (D2).
5. Write every fingerprint and the head again from the edit on, or remove the newest records and set
   the head back, or add a new record with any date. Step 39b keeps each chain's last fingerprint
   where the owner cannot reach it, which catches the first two; nothing in the chain catches the
   third (D0, C6).

</details>

## Think it through

### Found while building

- **The chain's lock, taken at the insert, locked a company's calls against each other.** Two rule
  drafts at once each held one lock and waited for the other's; the database stopped one, and its
  caller heard `INTERNAL_ERROR`. Two rate loads changed outcome. The chain is now written by a
  trigger deferred to the commit.
- **The store map refused a trigger on an append-only table.** The log has a kind of its own,
  `append-only-chained`, which allows its one named trigger; every other append-only table still
  allows none.
- **A careful editor really does win.** The second run under "Break it" is real: with the recipe,
  the owner rewrote every fingerprint from the edit on, and the script said whole.

### What the review found

A reviewer who had not seen the conversation read the rules, the code, and this README, ran its own
PostgreSQL with an owner like Neon's, and broke the code in copies. The learner decided the one
finding that needed a choice (D8). Each fix below was undone once in a copy, and its test failed,
except M1, which needs a database written before migration 003b.

| # | What it found | What was done |
|---|---|---|
| H1 | An owner without BYPASSRLS made the trigger's writes change nothing: records were kept with no chain, and the checker, seeing nothing, said "the log holds no record", exit 0 | A write that changes no row refuses the commit; the checker refuses a login that cannot see every record, exit 2 (breaks B8, B9) |
| M1 | Migration 035 failed on a database holding a record written before migration 003b, whose size check is `NOT VALID` | The check is lifted for the chaining and put back as it was |
| M2 | Nothing proved a fingerprint covers the one before it | A test: the next record pointed at a rewritten fingerprint is named |
| M3 | Nothing tied the recipe to every column | A unit test holds the columns against the table's; a database test changes each in turn |
| M4 | A record with no chain, and the `no_company` chain, were never tested on the database | Tests for both |
| M5 | The easiest forgery went unsaid: the owner adds a new record, with any date | Said in C6, D0, the script's output, and "Check yourself" |
| M6 | "No path can keep a record without them" was false | D2 says "no path through DSoR's login" |
| M7 | The migration's chaining had no test | A test runs its block again and checks the order |
| L1 | Any login could take the chain's lock and stall a company's commits | D8: a table of heads, which only the owner can lock (break B2) |
| L2, L4, L5, L8, L9 | Commits out of order untested; a test that needed the whole log clean; one exit code for two meanings; the company check untested; one record named of many with no chain | Tests; the test scoped to org_456; exit 2; a count |
| L3 | Two chains in one transaction could wait for each other for ever | D9 |
| L6, L7 | Three versions of each row; lengths in the database's encoding | One write; UTF-8 bytes |
| L11, L12 | A comment named the wrong cause; `sequence` means another thing in the schema | Corrected; said in D6 |
| Prose | The ledger promised more than it does for the last page; "fingerprint" could be made again by anyone; "key" meant other things | Said plainly |

### Left open on purpose

- **Checkpoints** (step 39b, DSOR-AUD-04d). A rewrite from the edit on, and the newest records
  removed, pass the checker.
- **The checker uses the owner's login.** An auditor would want a read-only login of their own.
- **The checker's read is not recorded.** DSOR-AUD-05b asks that reading audit be authorized and
  audited; `pnpm verify-audit` reads every company's log as the owner and writes nothing.
- **The owner must hold BYPASSRLS.** Neon's does; a deployment whose owner does not refuses every
  record's commit, rather than keep it unchained, and the checker refuses to check.
- **The owner can switch the trigger off**, as migration 020 does for its own change. Records kept
  then have no chain, and the checker names them.
- **Two database tests fail on a throwaway server**, as in steps 34 to 38c.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-AUD-04b | Audit records are tamper-evident through hash chaining | [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | [`test/verify-audit.test.ts`](test/verify-audit.test.ts), [`test/audit-chain.db.test.ts`](test/audit-chain.db.test.ts) |
| DSOR-AUD-04c | Every record belongs to exactly one chain | [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | [`test/verify-audit.test.ts`](test/verify-audit.test.ts), [`test/audit-chain.db.test.ts`](test/audit-chain.db.test.ts) |

**Next:** step 39b, checkpoints kept outside the database.
