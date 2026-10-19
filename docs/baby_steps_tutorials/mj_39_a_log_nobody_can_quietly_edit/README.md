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
letter and the fingerprint changes completely. In this step each record also holds the fingerprint
of the record before it, so the records form a *chain*. Change an old record and its fingerprint no
longer matches the one the next record holds. The break shows.

Think of a ledger whose pages are numbered, and where each page carries the fingerprint of the page
before it. Tear out a page or rewrite a line, and the next page gives it away. What this cannot stop
is someone who rewrites every page after the edit, with new fingerprints: the chain looks whole
again. Keeping the last fingerprint somewhere the owner cannot reach is step 39b's checkpoint.

## Why it matters

A real run on step 38c's database, on 2026-10-20. The owner edits one old record:

```text
records in dsor.audit: 3355
an old record:          2368 | 2026-10-19 | payment.reconcile@1 | DENY  | AUTHORIZATION_DENIED | user_123
after the owner's edit: 2368 | 2026-10-19 | payment.reconcile@1 | ALLOW | COMMITTED            | user_123
columns that could show the change: (none)
```

A refused call now reads as a settled payment, with the reason "reconciled by the CFO". An auditor
reading this log would believe it, and nothing in DSoR could tell them otherwise.

**Common mistake:** computing the fingerprints in DSoR's own code. Every path that writes a record
must then do it right, under a lock, and the database cannot stop one that does not. Two records
written at once could both claim the same predecessor.

## The design, before any code

### How this step was made

On 2026-10-20, after step 38c, the learner asked to build this step. The problem was shown with the
run above, and the learner decided five choices, each the recommended option (D0 to D4).

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
| C1 | Every record, as it goes in, gets its chain, its place in the chain, the fingerprint of the record before it, and its own fingerprint, written by the database. DSoR's login cannot write any of the four |
| C2 | One chain for each company, and one for the records that name no company. Two records never share a place or a predecessor, even when written at the same moment |
| C3 | The migration chains every record already in the log, in the order they were written |
| C4 | `pnpm verify-audit`, run as the owner, recomputes every fingerprint and names, for each chain, the first record that does not fit: a field changed, a fingerprint changed, a record removed, or records swapped |
| C5 | A whole log exits 0; a broken one exits 1 |
| C6 | What it cannot catch, said in the README and by the script: a chain rewritten from the edit on, and the newest records removed (step 39b) |

### Decisions

- **D0. Chain only; checkpoints in step 39b** (the learner's choice). *Downside:* until 39b, a careful
  editor with the owner's login can rewrite the chain from the edit on, or remove its newest
  records, and the script finds nothing.
- **D1. One chain per company** (the learner's choice). The chain is named by the record's company;
  a record with no company, a call refused before its company was known, goes in a chain of its
  own. *Downside:* more chains to check.
- **D2. The database writes the fingerprints** (the learner's choice). A trigger on `dsor.audit`
  computes them as each row goes in, holding the chain's lock, so no path can add a record without
  them. *Downside:* the recipe is written in SQL, and the script must follow it exactly.
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
- **D6. A place in the chain, and two keys** (Claude Code's). Each record gets `chain_position`, one
  more than the record before it in its chain. The database refuses two records with the same chain
  and place, or the same chain and predecessor. *Downside:* two more columns and two more indexes.
- **D7. The chain of records with no company is named `no_company`** (Claude Code's). *Downside:*
  a company may never be called that, and the id pattern `org_` plus digits already ensures it.

### The tests, by claim

| Claim | Tests |
|---|---|
| C4, C5 | `test/verify-audit.test.ts`: the checker over chains built in the test, whole and broken each way |
| C1, C2, C3, C4, C5 | `test/audit-chain.db.test.ts`: real records, real parallel writes, the owner's edits, and the script itself |
