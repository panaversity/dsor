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
cannot reach. The second mistake: signing whatever the chain says today. A checkpoint taken after a
rewrite vouches for the rewrite, so the script checks every chain before it signs.

## The design, before any code

### How this step was made

On 2026-10-20, after step 39, the learner asked to continue. The problem was shown with the run
above, and the learner decided nine choices, each the recommended option (D1 to D9). Claude Code
decided three details (D10 to D12).

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
| C1 | `pnpm checkpoint-keys` makes an Ed25519 key pair. The private key goes to a file the learner names, outside this folder, readable only by them. The public key goes to `checkpoint-public-key.pem` in this folder, to be committed |
| C2 | `pnpm checkpoint-audit`, as the owner and read only, first checks every chain as step 39 does. If one is broken, it signs nothing and exits 1. Otherwise it writes one signed file in `checkpoints/`: the time, from the database's clock, and every chain with its last place and fingerprint, `no_company` included (DSOR-AUD-04d) |
| C3 | `pnpm verify-audit` reads every checkpoint file. A file whose signature does not verify with the committed public key is named, broken, and not used |
| C4 | For each chain a checkpoint names, the record at the noted place must carry the noted fingerprint. A different fingerprint, or a chain that no longer reaches that place, is broken, and the checkpoint and the place are named. A chain that no checkpoint names yet is reported as "not yet in a checkpoint", not broken |
| C5 | Exit 0: every chain whole and the newest checkpoint 24 hours old or less. Exit 1: anything broken. Exit 2, when nothing is broken but the log could not be fully checked: no checkpoint, the newest older than 24 hours, no public key, or a login that cannot see every record |
| C6 | What it still cannot catch, said in this README and by the script: a change to a record written after the newest checkpoint, a new record the owner adds, and anyone who holds both the owner's login and the private key |

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
  older ones still protect the records before them. *Downside:* more files to read, one line per
  chain in each.
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
  with a field added or missing, two entries for one chain, or a place or fingerprint of the wrong
  form, before it checks the signature. *Downside:* a change in spacing still verifies, because
  only the values are signed; a change to any value does not.
- **D12. One snapshot, and the database's clock** (Claude Code's). The script reads the chains, the
  heads, and the time in one read-only transaction that sees one moment, so the heads and the records
  agree. The checker compares a checkpoint's age with the database's clock too. *Downside:* a
  database whose clock is wrong gives wrong ages.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1 to C5 | `test/checkpoint.test.ts`: checkpoints made and signed in the test, held against chains built in the test, whole and broken each way |
| C2, C4, C5 | `test/checkpoint.db.test.ts` and `test/owner-checkpoint.ts`: the careful editor's rewrite, caught; the newest record removed with its head, caught; a checkpoint refused on a broken log; every chain covered; the two scripts refusing without a key or with a login that cannot see every record |
| C6 | `test/checkpoint.test.ts`: a change after the newest checkpoint passes, said plainly |

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

Each break ran on 2026-10-20 in a copy of this folder outside the repository, with a fresh
database, against `test/checkpoint.test.ts` and `test/checkpoint.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The checker compares a checkpoint's place, not its fingerprint | 2 | 1 |
| **B2** | The checker does not check the signature | 3 | 1 |
| **B3** | The checkpoint leaves out the `no_company` chain | 3 | 1 |
| **B4** | The checker ignores the checkpoint's age | 1 | 0 |
| **B5** | `pnpm checkpoint-audit` signs a broken log | 2 | 1 |
| **B6** | The checker reads only the newest checkpoint | 1 | 0 |

B6 first passed every test: the test gave the checker the newest file first, and the script reads
them oldest first, so a checker that read only the last file read the old one. B3 first passed the
database tests: a fresh database held no record of `no_company`. Both tests were fixed, and the
counts above are from the rerun.

## Break it

The four stories, run for real on 2026-10-20, on a fresh scratch database filled by `pnpm start`.
The key pair and the checkpoints were kept in a scratch folder, through `DSOR_CHECKPOINT_KEY` and
`DSOR_CHECKPOINT_DIR`. First the keys, a checkpoint, and a check:

```text
$ pnpm checkpoint-keys ../keys/private.pem
private key written: ../keys/private.pem. Keep it secret; set DSOR_CHECKPOINT_KEY to it in .env
public key written: checkpoint-public-key.pem. Commit it
$ pnpm checkpoint-audit
checkpoint written: 2026-10-19T23-06-18.944Z.json, 3 chains
$ pnpm verify-audit
checkpoint 2026-10-19T23-06-18.944Z.json: signature holds
no_company: whole, 3 records
org_456: whole, 63 records
org_789: whole, 1 records
not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key
exit=0
```

The file's name is its time in UTC. The private key file reads `-rw-------`: only its owner can
read it.

**P4.** `pnpm start` runs again, so org_456 grows past the checkpoint. The owner turns a refusal at
place 124 into a success and rewrites from there:

```text
P4, a record after the checkpoint: 124 | invoice.get@1 | DENY | FRESHNESS_UNSATISFIABLE
after the rewrite:                 124 | invoice.get@1 | ALLOW | COMMITTED
checkpoint 2026-10-19T23-06-18.944Z.json: signature holds
no_company: whole, 6 records
org_456: whole, 126 records
org_789: whole, 2 records
not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key
exit=0
```

The learner was right: nothing outside the database knows place 124. That is why a checkpoint must
be taken at least every 24 hours, and more often where the log matters more.

**P1.** The careful editor of "Why it matters", now with a checkpoint behind the chain:

```text
P1, the old record:  4 | invoice.issue@1 | DENY | AUTHORIZATION_DENIED
after the rewrite:   4 | invoice.issue@1 | ALLOW | COMMITTED
checkpoint 2026-10-19T23-06-18.944Z.json: signature holds
no_company: whole, 6 records
org_456: broken at place 63, record aud_6eacfaed-fef1-4cca-a1a4-4bf7ea15bbe5: its fingerprint is not the one checkpoint 2026-10-19T23-06-18.944Z.json noted
org_789: whole, 2 records
not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key
exit=1
```

The checker names place 63, not place 4: the checkpoint knows where the chain ended, not which
record was changed. Every record from 4 to 63 is now in doubt, and a person compares them with
another copy, such as a backup.

**P2.** The owner also edits the checkpoint file, so that it holds org_456's new fingerprint at
place 63:

```text
checkpoint 2026-10-19T23-06-18.944Z.json: broken: its signature does not match the committed public key
no_company: whole, 6 records
org_456: whole, 126 records
org_789: whole, 2 records
no_company: not yet in a checkpoint
org_456: not yet in a checkpoint
org_789: not yet in a checkpoint
not checked: there is no checkpoint whose signature holds
not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key
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
not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key
exit=2
```

Never exit 0. The script cannot prove the log was rewritten, so it does not say "broken"; it cannot
vouch for it either, so it does not say "whole".

## What changed since step 39

| File | What changed |
| --- | --- |
| `src/checkpoint.ts` | **New.** A checkpoint of every chain, never of a broken log; its signed text; signing; its file (D10, D11) |
| `src/checkpoint-check.ts` | **New.** Every chain held against every checkpoint whose signature holds; the exit codes (D4 to D7, D9) |
| `src/checkpoint-files.ts` | **New.** The key pair, the keys, the checkpoint files, and one moment of the log (D8, D12) |
| `src/checkpoint-keys.ts`, `src/checkpoint-audit.ts`, `package.json` | **New.** `pnpm checkpoint-keys` and `pnpm checkpoint-audit` (C1, C2) |
| `src/verify-audit.ts` | Holds the log against the checkpoints, in one moment (C3 to C6) |
| `.gitignore` | `checkpoints/` |
| `test/checkpoint.test.ts`, `test/checkpoint.db.test.ts`, `test/owner-checkpoint.ts`, `test/db.ts` | **New.** The claims C1 to C6 |

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
| 8 | Review | A reviewer who had not seen the conversation |

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
5. A record written after the newest checkpoint, and a new record the owner adds. And anyone who
   holds both the owner's login and the private key can do anything (C6, P4).

</details>
