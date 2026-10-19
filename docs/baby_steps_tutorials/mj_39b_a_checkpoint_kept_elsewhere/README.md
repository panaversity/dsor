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
  name, so the checker makes the same text again. *Downside:* a file that is changed by even one
  space no longer verifies, which is the point, but it can surprise.
- **D12. One snapshot, and the database's clock** (Claude Code's). The script reads the chains, the
  heads, and the time in one read-only transaction that sees one moment, so the heads and the records
  agree. The checker compares a checkpoint's age with the database's clock too. *Downside:* a
  database whose clock is wrong gives wrong ages.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1 to C5 | `test/checkpoint.test.ts`: checkpoints made and signed in the test, held against chains built in the test, whole and broken each way |
| C2, C4, C5 | `test/checkpoint.db.test.ts`: the owner's rewrite of step 39's "Why it matters", caught; a checkpoint refused on a broken log; every chain covered |
| C6 | `test/checkpoint.test.ts`: a change after the newest checkpoint passes, said plainly |

### The breaks, and the learner's predictions

Each break below will be run for real on a fresh copy, and its real result written here.

| Break | What it removes | The learner's prediction |
|---|---|---|
| **B1** | The checker compares a checkpoint's place, not its fingerprint | (to ask) |
| **B2** | The checker does not check the signature | (to ask) |
| **B3** | The checkpoint leaves out the `no_company` chain | (to ask) |
| **B4** | The checker ignores the checkpoint's age | (to ask) |
| **B5** | `pnpm checkpoint-audit` signs a broken log | (to ask) |
| **B6** | The checker reads only the newest checkpoint | (to ask) |
