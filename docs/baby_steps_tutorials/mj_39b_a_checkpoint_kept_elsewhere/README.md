# Step 39b · A checkpoint kept elsewhere

**New in this step:** `pnpm checkpoint-audit` signs each chain's last fingerprint and keeps it in a
file outside the database, and `pnpm verify-audit` holds every chain against every checkpoint
(DSOR-AUD-04b, DSOR-AUD-04d).

## In plain words

Since step 39, each record in DSoR's log, `dsor.audit`, carries the fingerprint of the record before
it. Change an old record and the next one gives it away. But the database's *owner*, the login that
made the tables, knows the recipe. The owner can change a record and then write every fingerprint
after it again, and the chain looks whole.

A *checkpoint* is a note of where each chain ended at one moment: its last place and that record's
fingerprint. If the note is kept where the owner cannot change it, a later rewrite shows: the record
at the noted place no longer has the noted fingerprint.

Here the note is a file, and it is *signed*. A signature is made with a *private key*, a secret file
that only the person who takes checkpoints holds. Anyone can check the signature with the matching
*public key*, but nobody can make a new one without the private key. The pair is made with Ed25519,
a signing method built into Node. So the owner can delete a checkpoint, but cannot write one that
the checker accepts.

## Why it matters

A real run on 2026-10-20, on a scratch database filled by `pnpm start`. The careful editor, with the
owner's login, turns org_456's record at place 4 from a refusal into a success, then writes every
fingerprint from place 4 to the end of the chain again, and the chain's head too:

```text
the old record:      4 | invoice.issue@1 | DENY | AUTHORIZATION_DENIED
after the rewrite:   4 | invoice.issue@1 | ALLOW | COMMITTED
no_company: whole, 3 records
org_456: whole, 63 records
org_789: whole, 1 records
not checked: a chain and its head rewritten from an edit on (step 39b), or a new record the owner adds
exit=0
```

`user_123`'s refused call now reads as a call DSoR allowed and committed, and step 39's checker
calls the log whole. Everything the checker reads is inside the database, and the owner can change
everything inside the database.

**Common mistake:** keeping the checkpoint in the database, in a table of its own. The owner
rewrites it with the chain. A checkpoint protects the log only when it lives where the owner's login
cannot reach. The second mistake, which this step made first: signing whatever the chain says today.
A routine checkpoint taken after a rewrite vouches for the rewrite. So the script holds the log
against every checkpoint kept, and checks that the last one it signed is still there, before it
signs again.

## The design, before any code

### How this step was made

On 2026-10-20, after step 39, the learner asked to continue. The problem was shown with the run
above, and the learner decided nine choices, each the recommended option (D1 to D9). Claude Code
decided three details (D10 to D12). The hostile review then made the owner's routine checkpoint
vouch for a rewrite, and showed two more ways past the checker; the learner decided four more
choices (D12 changed, D13, D14, and the database's id in C2), and Claude Code one more detail (D15).

### What the rules say

- **DSOR-AUD-04b:** "Audit records MUST be tamper-evident through hash chaining, signed checkpoints,
  or an equivalent mechanism."
- **DSOR-AUD-04d:** "Every audit chain MUST be covered by each checkpoint."
  ([§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention))

The specification adds: "Implementations SHOULD anchor checkpoints outside the control-plane store."
Its table of limits, [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds), sets the checkpoint interval at
24 hours or less for L2.

### The claims

| Claim | What it says |
|---|---|
| C1 | `pnpm checkpoint-keys` makes an Ed25519 key pair. The private key goes to a file the learner names, outside the repository, readable only by them. The public key goes to `checkpoint-public-key.pem` in this folder, to be committed, and an existing one is replaced only with `--replace` |
| C2 | `pnpm checkpoint-audit`, as the owner and read only, holds the log against every checkpoint kept, as `pnpm verify-audit` does, and checks that the folder's newest checkpoint is the last one this key signed. If anything is broken or missing, it signs nothing and exits 1. Otherwise it writes one signed file: the database's id and name, the time by this computer's clock, the checkpoint before it, and every chain with its last place and fingerprint, `no_company` included (DSOR-AUD-04d) |
| C3 | `pnpm verify-audit` reads every checkpoint file. A file that is not exactly a checkpoint, field for field, whose signature does not verify with the committed public key, of another database, dated after the checker's clock, or that does not follow the checkpoint before it, is named, broken, and not used to vouch for the log |
| C4 | For each chain a checkpoint names, the record at the noted place must carry the noted fingerprint. A different fingerprint, or a chain that no longer reaches that place, is broken, and the checkpoint and the place are named. A chain that no checkpoint names yet is reported as "not yet in a checkpoint", not broken |
| C5 | Exit 0: every chain whole and the newest checkpoint 24 hours old or less by the checker's own clock. Exit 1: anything broken, or a log that is not a plain table. Exit 2, when nothing is broken but the log could not be fully checked: no checkpoint, the newest older than 24 hours, no public key, or a login that cannot see every record |
| C6 | What it still cannot catch, said in this README and by the script: a change to a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, and anyone who holds both the owner's login and the private key |

### Decisions

- **D1. A signed file** (the learner's choice). *Downside:* the file sits on a disk someone manages.
  The signature stops a forged checkpoint, not a deleted one.
- **D2. An Ed25519 key pair** (the learner's choice). The private key signs; the public key only
  checks. Node's `node:crypto` has it, so there is no new dependency. *Downside:* one more secret
  file to keep safe, and to keep apart from the owner's login.
- **D3. A script, run by hand** (the learner's choice). `pnpm checkpoint-audit`, at least once every
  24 hours; in production, a scheduled job. *Downside:* if nobody runs it, there is no protection.
  D6 makes the checker say so.
- **D4. A mismatch is broken, exit 1** (the learner's choice). The same exit as step 39's breaks.
- **D5. A chain newer than every checkpoint is allowed, and reported** (the learner's choice). A
  company's first record can come after the last checkpoint. *Downside:* that chain is protected only
  by step 39's chain until the next checkpoint.
- **D6. No checkpoint, or one older than 24 hours: not checked, exit 2** (the learner's choice).
  *Downside:* a new database answers exit 2 until its first checkpoint.
- **D7. Every checkpoint kept is checked** (the learner's choice). Delete the newest file, and the
  older ones still protect the records before them. The review showed the other half: delete the
  older file instead, after a routine checkpoint vouched for a rewrite. D13 closes that. *Downside:*
  more files to read, one line per chain in each.
- **D8. The public key is committed** (the learner's choice). Swapping it shows in git history, out
  of the owner's reach. The private key's path is `DSOR_CHECKPOINT_KEY` in `.env`, and only
  `pnpm checkpoint-audit` reads it. *Downside:* each learner's copy has its own key, and a new key
  pair makes every older checkpoint fail its signature.
- **D9. A checkpoint whose signature fails is broken, exit 1** (the learner's choice). It is evidence
  that someone touched the anchor. *Downside:* after a new key pair, the old checkpoint files must be
  moved away.
- **D10. Never sign a broken log** (Claude Code's). `pnpm checkpoint-audit` runs step 39's checker
  first and signs only when every chain is whole and matches its head. *Downside:* while the log is
  broken, no new checkpoint can be taken, until a person decides what to do.
- **D11. The file and what is signed** (Claude Code's). One JSON file per checkpoint, named by its
  time, in `checkpoints/`, which git ignores: the checkpoints belong to the learner's own database.
  The signed text is the checkpoint as JSON, its fields in a fixed order and its chains sorted by
  name, so the checker makes the same text again from the file's values. The checker refuses a file
  with a field added or missing, two entries for one chain, a time that is no real moment, or a
  place, fingerprint, or signature of the wrong form, before it checks the signature. Anything in
  the folder that is not a regular file of at most 1 MB is named and never read. *Downside:* a
  change in spacing still verifies, because only the values are signed; a change to any value does
  not.
- **D12. One snapshot, and the checker's own clock** (Claude Code's, then the learner's after the
  review's H2). The scripts read the chains and the heads in one read-only transaction that sees one
  moment, so the heads and the records agree. A checkpoint's time and its age come from the clock of
  the computer that runs the script, never the database's, which the owner controls: the review
  named a function `now()` of the owner's own and got a checkpoint dated 2099. A checkpoint dated
  more than 5 minutes after the checker's clock is broken, and `pnpm checkpoint-audit` refuses when
  the database's clock and the computer's differ by more than 5 minutes. *Downside:* a computer whose
  clock is wrong refuses to work.
- **D13. Each checkpoint follows the one before it** (the learner's choice, after the review's H1).
  A checkpoint names the fingerprint of the checkpoint before it, and the signer keeps a note of the
  last one it signed, in a `.last` file beside the private key. Before it signs, the log must hold
  against every checkpoint kept, and the folder's newest checkpoint must be that last one. So the
  owner cannot rewrite the chain, delete the older checkpoints, and wait for a routine checkpoint to
  vouch for the rewrite. The checker names a checkpoint that does not follow the one before it in
  the folder; the oldest may follow one removed, so old checkpoints can be cleared. *Downside:* one
  more small file to keep with the key; lose it, and the signer follows whatever newest checkpoint
  it finds.
- **D14. One person holds the owner's login and the key, for learning only** (the learner's choice,
  after the review's M4). `pnpm checkpoint-audit` reads both from one `.env`, and says every time
  that in production another person signs, with a read-only login. *Downside:* in this step, the
  signer could also rewrite the log and sign over it; C6 says so.
- **D15. The checker trusts as little of the database as it can** (Claude Code's, after the review's
  H2 and H3). Every read runs with PostgreSQL's own functions first, so an owner's `now()` or
  `to_char()` is never found. The log and its heads are read only when both are plain tables with no
  rule: the review put a view in place of the log that showed the checker the old rows. Anything else
  is broken, exit 1, because no migration of DSoR's makes it. A checkpoint names its database, the
  server's own id and the database's name, so one key cannot vouch for another database's log.
  *Downside:* an owner who controls the database server itself can still lie to it; C6 says so.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1, C3 | `test/checkpoint-files.test.ts`: the key pair, the private key outside the repository, the files on the disk |
| C2 | `test/checkpoint-take.test.ts`: what a checkpoint notes, and when the signer refuses |
| C3 to C5 | `test/checkpoint-check.test.ts`: checkpoints made and signed in the test, held against chains built in the test, whole and broken each way |
| C2, C4, C5 | `test/checkpoint.db.test.ts` and `test/owner-checkpoint.ts`: the careful editor's rewrite, caught, and refused a checkpoint; the newest record removed with its head, caught; every chain covered; the owner's `now()` and a view in place of the log, refused; the two scripts refusing without a key or with a login that cannot see every record |
| C6 | `test/checkpoint-check.test.ts`: a change after the newest checkpoint passes, said plainly |

### The learner's predictions

Asked on 2026-10-20, before any code. Each was settled by a real run under "Break it": all four
were right.

| # | The story | The learner's prediction |
|---|---|---|
| P1 | A checkpoint at 09:00, when org_456 ends at place 63. At 10:00 the owner turns place 4 from DENY to ALLOW and rewrites every fingerprint after it, and the head | org_456 broken at place 63, exit 1 |
| P2 | The same rewrite, and the owner also edits the 09:00 checkpoint file to hold the new fingerprint | The file's signature fails, exit 1 |
| P3 | The owner deletes every checkpoint file, then rewrites the chain | Not checked, exit 2 |
| P4 | After the 09:00 checkpoint, org_456 writes place 64; the owner edits place 64 and rewrites its fingerprint and the head | Whole, exit 0: nothing outside the database knows place 64 |

### The breaks

Each break ran on 2026-10-20, after the review's fixes, in a copy of this folder outside the
repository, with a fresh database, against the three unit test files and `test/checkpoint.db.test.ts`.
B7 to B14 break the review's fixes.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The checker compares a checkpoint's place, not its fingerprint | 3 | 2 |
| **B2** | The checker does not check the signature | 3 | 1 |
| **B3** | The checkpoint leaves out the `no_company` chain | 5 | 1 |
| **B4** | The checker ignores the checkpoint's age | 2 | 0 |
| **B5** | A broken log is signed | 3 | 0 |
| **B6** | The checker reads only the newest checkpoint | 1 | 0 |
| **B7** | The signer ignores its note of the last checkpoint it signed | 2 | 1 |
| **B8** | A checkpoint dated after the checker's clock is used | 1 | 0 |
| **B9** | The reads do not put PostgreSQL's own functions first | 0 | 1 |
| **B10** | A view in place of the log is read | 0 | 1 |
| **B11** | Another database's checkpoint is used | 1 | 0 |
| **B12** | A planted entry in the folder is read | 1 | 0 |
| **B13** | `..secret.pem` counts as outside the repository | 1 | 0 |
| **B14** | The checker does not check that each checkpoint follows the one before | 1 | 0 |

The review's sixteen changes that first passed every test were run the same way; each now fails at
least one test.

B6 passed every test twice. First, the test gave the checker the newest file first, and the script
reads them oldest first. Then, after the review, the newer checkpoint in the test named no previous
one, so the link check caught it, and a checker that read only the newest still failed for that
reason alone. B3 first passed the database tests: a fresh database held no record of `no_company`.
Each test was fixed, and the counts above are from the rerun.

## Break it

The four stories, and the review's routine checkpoint, run for real on 2026-10-20 on the final code,
on a fresh scratch database filled by `pnpm start`. The key pair and the checkpoints were kept in a
scratch folder outside the repository, named by `DSOR_CHECKPOINT_KEY` and `DSOR_CHECKPOINT_DIR`.
Every time below is UTC, the clock the scripts use, so a run in the evening of 2026-10-20 in
Pakistan reads 2026-10-19. First the keys, a checkpoint, and a check:

```text
$ pnpm checkpoint-keys ~/dsor-keys/private.pem
private key written: ~/dsor-keys/private.pem. Keep it secret; set DSOR_CHECKPOINT_KEY to it in .env
public key written: checkpoint-public-key.pem. Commit it
$ pnpm checkpoint-audit
checkpoint written: 2026-10-19T23-34-41.731Z.json, 3 chains
for learning only: whoever signs here also holds the owner's login; in production another person signs, with a read-only login
$ pnpm verify-audit
checkpoint 2026-10-19T23-34-41.731Z.json: signature holds
no_company: whole, 3 records
org_456: whole, 63 records
org_789: whole, 1 records
not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key
exit=0
```

The private key file reads `-rw-------`: only its owner can read it.

**P4.** `pnpm start` runs again, so org_456 grows past the checkpoint. The owner turns a refusal at
place 124 into a success and rewrites from there:

```text
a record after the checkpoint: 124 | invoice.get@1 | DENY | FRESHNESS_UNSATISFIABLE
after the rewrite:             124 | invoice.get@1 | ALLOW | COMMITTED
checkpoint 2026-10-19T23-34-41.731Z.json: signature holds
no_company: whole, 6 records
org_456: whole, 126 records
org_789: whole, 2 records
not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key
exit=0
```

The learner was right: nothing outside the database knows place 124. That is why a checkpoint must
be taken at least every 24 hours, and more often where the log matters more.

**P1.** The careful editor of "Why it matters", now with a checkpoint behind the chain:

```text
the old record:     4 | invoice.issue@1 | DENY | AUTHORIZATION_DENIED
after the rewrite:  4 | invoice.issue@1 | ALLOW | COMMITTED
checkpoint 2026-10-19T23-34-41.731Z.json: signature holds
no_company: whole, 6 records
org_456: broken at place 63, record aud_efc4bf47-1ffe-4977-8682-589ff47f9207: its fingerprint is not the one checkpoint 2026-10-19T23-34-41.731Z.json noted
org_789: whole, 2 records
not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key
exit=1
```

The checker names place 63, not place 4: the checkpoint knows where the chain ended, not which
record was changed. Every record from 4 to 63 is now in doubt, and a person compares them with
another copy, such as a backup.

**The routine checkpoint.** The next day's `pnpm checkpoint-audit` runs on the rewritten log. Before
the review, it signed it:

```text
org_456: broken at place 63: its fingerprint is not the one checkpoint 2026-10-19T23-34-41.731Z.json noted
not taken: the log or a checkpoint is broken, and a new checkpoint would vouch for the break
exit=1
```

**P2.** The owner edits the checkpoint file, so that it holds org_456's new fingerprint at place 63:

```text
checkpoint 2026-10-19T23-34-41.731Z.json: broken: its signature does not match the committed public key
no_company: whole, 6 records
org_456: whole, 126 records
org_789: whole, 2 records
no_company: not yet in a checkpoint
org_456: not yet in a checkpoint
org_789: not yet in a checkpoint
not checked: there is no checkpoint whose signature holds
not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key
exit=1
```

**P3.** The owner deletes every checkpoint file instead:

```text
no_company: whole, 6 records
org_456: whole, 126 records
org_789: whole, 2 records
no_company: not yet in a checkpoint
org_456: not yet in a checkpoint
org_789: not yet in a checkpoint
not checked: there is no checkpoint
not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key
exit=2
```

Never exit 0. The script cannot prove the log was rewritten, so it does not say "broken"; it cannot
vouch for it either, so it does not say "whole". And the next routine checkpoint, which would start
a fresh line of checkpoints over the rewrite, is refused, because the signer's note names the
checkpoint that was deleted:

```text
not taken: the newest checkpoint this key signed, 2026-10-19T23-34-41.731Z.json, is not the newest in the folder
exit=1
```

## What changed since step 39

| File | What changed |
| --- | --- |
| `src/checkpoint.ts` | **New.** A checkpoint of every chain of one database, following the one before it, never of a broken log; its signed text; signing; its file (D10, D11, D13) |
| `src/checkpoint-parse.ts` | **New.** One checkpoint file, field for field, and its signature (D9, D11) |
| `src/checkpoint-check.ts` | **New.** Every chain held against every checkpoint of this database that may be used; the links; the exit codes (D4 to D7, D12, D13) |
| `src/checkpoint-signer.ts` | **New.** The signer's note of its last checkpoint, and when it refuses (D13) |
| `src/checkpoint-db.ts` | **New.** One moment of the log, read with PostgreSQL's own functions, from plain tables only (D12, D15) |
| `src/checkpoint-files.ts` | **New.** The key pair, outside the repository; the keys; the checkpoint files, read only when they are small regular files (D8, D11) |
| `src/checkpoint-keys.ts`, `src/checkpoint-audit.ts`, `package.json` | **New.** `pnpm checkpoint-keys` and `pnpm checkpoint-audit` (C1, C2, D14) |
| `src/verify-audit.ts` | Holds the log against the checkpoints, by this computer's clock (C3 to C6) |
| `.gitignore` | `checkpoints/` |
| `test/checkpoint-take.test.ts`, `test/checkpoint-check.test.ts`, `test/checkpoint-files.test.ts`, `test/checkpoints.ts` | **New.** The claims C1 to C6, without a database |
| `test/checkpoint.db.test.ts`, `test/owner-checkpoint.ts`, `test/db.ts` | **New.** The claims on the database, and the owner's attacks |

No migration: nothing in the database changes.

```bash
git diff --no-index ../mj_39_a_log_nobody_can_quietly_edit/src src
git diff --no-index ../mj_39_a_log_nobody_can_quietly_edit/test test
```

## Run it

As in step 39: a local PostgreSQL 17 and a database of its own. Then, once:

```bash
pnpm install
pnpm migrate
pnpm checkpoint-keys ~/dsor-keys/checkpoint-private.pem
git add checkpoint-public-key.pem
```

Put `DSOR_CHECKPOINT_KEY=` and the private key's path in `.env`. Then, at least every 24 hours:

```bash
pnpm checkpoint-audit
pnpm verify-audit
```

`pnpm checkpoint-audit` reads the owner's login, `DSOR_MIGRATION_URL`, and the private key's path
from `.env`, and never prints either. `pnpm verify-audit` does not read the private key at all.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real rewrite that step 39's checker calls whole |
| 2 | Decide | Nine choices by the learner; three details by Claude Code |
| 3 | Predict | Four stories, asked before any code |
| 4 | The copy | Step 39 copied, its markers removed |
| 5 | Red | 23 unit tests and the database tests, against stubs |
| 6 | Code | The checkpoint, the check, the files, the two scripts |
| 7 | Break it | P1 to P4, and B1 to B6, for real |
| 8 | Review | A reviewer who had not seen the conversation, who got past the checker three ways |
| 9 | Decide again | Four choices by the learner, for the review's findings |
| 10 | Red, then code | The review's tests, then the fixes; P1 to P4 and every break run again |

To start it in a new session:

```text
Build step 39b in learner mode from the design in
docs/baby_steps_tutorials/mj_39b_a_checkpoint_kept_elsewhere/README.md.
```

## Check yourself

1. Why does a checkpoint kept in the database protect nothing?
2. The owner rewrites org_456 from place 4 on. The newest checkpoint noted place 63. Which place
   does `pnpm verify-audit` name, and why not place 4?
3. The owner deletes every checkpoint file. Why does the script exit 2, and not 0 or 1?
4. Why is the public key committed, and the private key kept outside this folder?
5. What can the owner still change without being caught?
6. The owner rewrites the chain, deletes every checkpoint file, and waits for the next routine
   checkpoint. Why is it refused?

<details>
<summary>Answers</summary>

1. The owner can change everything in the database, so the owner rewrites the checkpoint with the
   chain ("Common mistake").
2. Place 63: the checkpoint knows only where the chain ended and that record's fingerprint. A
   rewrite from place 4 changes every fingerprint after it, so place 63's changed too (C4, P1).
3. It cannot prove the log was changed, so not 1; it cannot vouch that it was not, so not 0 (D6,
   P3).
4. The public key only checks signatures, so anyone may read it, and git shows any change to it.
   The private key makes signatures; in the folder, git could carry it to everyone (D2, D8, C1).
5. A record written after the newest checkpoint, and a new record the owner adds. A database server
   that shows the checker other rows than it shows everyone. And anyone who holds both the owner's
   login and the private key can do anything (C6, P4).
6. The signer keeps a note of the last checkpoint it signed, beside the private key. That checkpoint
   is no longer the newest in the folder, so the signer refuses to start a new line of checkpoints
   over the rewrite (D13).

</details>

## Think it through

### Found while building

- **A careful editor really does win against step 39 alone.** The run under "Why it matters" is
  real: with the recipe, the owner rewrote every fingerprint from place 4 on, and step 39's checker
  said whole.
- **"There is no checkpoint" read as false beside a forged file.** The note now says "no checkpoint
  whose signature holds" when files are there but none can be used.
- **Two breaks first passed every test.** B6: the test gave the checker the newest file first, and
  the script reads them oldest first. B3: a fresh database held no record of `no_company`, so a
  checkpoint without that chain matched. Both tests were fixed.

### What the review found

A reviewer who had not seen the conversation read the rules, the code, and this README, attacked a
copy on a database of its own, and broke the code one change at a time. It got `pnpm verify-audit`
to say exit 0 after a change a checkpoint covered, three ways. The learner decided the four findings
that needed a choice (D12, D13, D14, and the database's id). Each fix was then broken once in a copy,
and its tests failed (see the breaks above).

| # | What it found | What was done |
|---|---|---|
| H1 | The owner rewrote the chain; the routine `pnpm checkpoint-audit` signed the rewritten log; the owner deleted the older checkpoint; exit 0 | The signer holds the log against every checkpoint first, follows its own last checkpoint, and each checkpoint names the one before (D13) |
| H2 | The age ran on the database's clock: an owner's own `now()` gave a checkpoint dated 2099 that never grew old | The checker's own clock; a checkpoint dated after it is broken; the scripts use PostgreSQL's own functions only (D12, D15) |
| H3 | A view in place of the log showed the checker, and only the checker, the old rows | The log and its heads are read only as plain tables with no rule; C6 says what is left (D15) |
| M1 | A folder, a 2 GB file, or a pipe named `.json` in the checkpoints folder made the script stop, exit 2, or hang | Each entry must be a regular file of at most 1 MB, or it is named broken |
| M2 | One key, two databases: another database's checkpoint was used | A checkpoint names its database; another's is broken |
| M3 | `..secret.pem` counted as outside the folder, and this README's own example wrote the key inside the repository | Outside the whole repository; the example moved to `~/dsor-keys/` |
| M4 | The signer must also hold the owner's login | Said by the script and in D14 |
| L1, L2 | D11 said a changed space fails; D12 called a wrong clock an accident | Corrected |
| L3 | A signature with letters added still verified | The signature's form is checked |
| L4 | A second key pair silently replaced the public key | Only with `--replace` |
| L5 | Places compared as text would put 9 after 12, and no test said so | A chain of twelve |
| L7 | The README's dates and the commits' times disagreed | The times are UTC, and the README says so |
| Mutations | Sixteen one-line changes left every test green: reading only the oldest checkpoint, ignoring the heads, overwriting a file, each form rule, no public key counted as vouched for, reading one file only, and others | A test for each, run against its change |

### Left open on purpose

- **On Windows, "owner only" is the folder's job.** `makeKeyPair` writes the private key with the
  permission bits `0600`, readable by its owner only. Windows has no such bits: Node writes none and
  reports `0666`, and who may read the key is decided by the folder's access list. So the test checks
  the bits everywhere but Windows. Keep the key in a folder only you can read, such as your own user
  folder. Found by CI on `windows-latest`, 2026-10-25.
- **The checker trusts the database server.** A superuser of the server, or a changed PostgreSQL,
  can show the checker other rows. Only a copy of the log kept elsewhere, such as a backup or a
  stream to another system, answers that.
- **One person holds the owner's login and the private key** (D14). In production, another person
  signs, with a login that can only read the log. That login is a migration and a role of its own.
- **A new record the owner adds, and changes after the newest checkpoint.** A checkpoint cannot see
  them. The interval, 24 hours at L2, is how long that window stays open.
- **The checkers' reads are not recorded.** DSOR-AUD-05b asks that reading audit be authorized and
  audited; both scripts read every company's log as the owner and write nothing to it.
- **The checkpoints folder sits beside `.env` by default.** `DSOR_CHECKPOINT_DIR` can name another
  disk; in production it is a place the database's owner cannot write, such as storage that keeps
  every version.
- **Lose the `.last` note, and the signer can no longer tell that checkpoints were deleted.** It
  follows the newest one it finds. The note lives beside the private key, so whoever keeps the key
  safe keeps the note too.
- **Two of the review's surviving changes have no test:** dropping REPEATABLE READ in the scripts
  (a race between the records and the heads), and `verify-audit.ts` passing no heads. Step 39's
  database tests catch the second; the first needs a write between two reads, at the right moment.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-AUD-04b | Audit records are tamper-evident through hash chaining and signed checkpoints | [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | [`test/checkpoint-take.test.ts`](test/checkpoint-take.test.ts), [`test/checkpoint-check.test.ts`](test/checkpoint-check.test.ts), [`test/checkpoint-files.test.ts`](test/checkpoint-files.test.ts), [`test/checkpoint.db.test.ts`](test/checkpoint.db.test.ts) |
| DSOR-AUD-04d | Every audit chain is covered by each checkpoint | [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | [`test/checkpoint-take.test.ts`](test/checkpoint-take.test.ts), [`test/checkpoint.db.test.ts`](test/checkpoint.db.test.ts) |

**Next:** step 40, events with an outbox.
