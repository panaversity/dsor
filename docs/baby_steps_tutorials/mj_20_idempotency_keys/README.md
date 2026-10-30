# Step 20 · Idempotency keys

**New in this step:** a command carries a key that its caller chose, and DSoR claims the key
with one database insert, in the same transaction as the command's work. A retry with the same
key gets the recorded answer, and never a second payment (DSOR-IDM-01a to DSOR-IDM-01d).

## In plain words

Networks fail, and clients retry. When a client asks DSoR for a payment and the answer is lost
on the way back, the client cannot know whether the payment exists. So it asks again. Before
this step, DSoR could not tell that second request from new work, and drafted a second payment.

An *idempotency key* is a name for one piece of work, which the caller makes and sends with the
command. *Idempotent* means that the second time changes nothing more than the first time did.
DSoR *claims* the key: it writes the key into its own store, where only one request can write
it. Beside the key it writes the request's *fingerprint*, a short code computed from the
request's content: the same request always gives the same code, and a different request a
different one. The claim, the work, and the answer are written in one transaction, so all three
are kept, or none of them. A second request with the same key and the same request is a
*replay*: it gets the first answer, and nothing runs again. The same key with a different
request is refused.

In the office picture, this is the new clerk with his ledger. Each company has a ledger, and
each sender has a page in it. For each letter he writes one entry: the letter's reference
number, the payment, and his answer, together. If he is interrupted halfway, he strikes the
entry out, and nothing was paid. When a letter comes with a number that is already on that
sender's page, he copies out his answer and pays nothing. When the number is there for a
different letter, he refuses it.

## Why it matters

Friday, 02:05. accounts-payable-fte asks DSoR for a draft payment for INV-1008, with the request
id `req_fri_0205`. DSoR writes PAY-901, 31,400.00 USD to VENDOR-44. The network drops the answer.
At 02:06 the agent sends the same request again, with the same request id. Step 19b writes
PAY-902, a second draft of 31,400.00 USD for the same invoice, and its log holds two records
with one request id. The learner predicted this at the start of step 20's understanding session,
and a run of step 19b's own code agreed.

The contract already asked for a key: `"idempotency": { "required": true }`, since step 17. No
line of the checklist read one.

## The design, before any code

This section was written by Claude Code before any code existed. The learner was away and asked
for steps 20 and 21 to be built, so Claude Code made each decision itself, by the learner's two
tests: the closest to production, and the deepest understanding. Each decision is marked as
this tutorial's decision, and each has its downside, for the learner to check later.

The understanding session for step 20 started on 2026-10-07 and stopped after part 1, when the
learner had to go: "Step 20, understanding" in `../mj_notes.md`. The specification it relies on
was read on 2026-10-07:

- [§22](../../../specs/dsor/03-execution.md#22-idempotency): DSOR-IDM-01a to DSOR-IDM-01d,
  DSOR-IDM-02, and the common mistake: "Checking 'does this key exist?' and then inserting it,
  as two steps."
- [§21](../../../specs/dsor/03-execution.md#21-command-pipeline): line ⑦, "IDEMPOTENCY CLAIM —
  atomic; a replay returns the recorded status", after line ⑥ computes the payload hash.
- [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes): the retry classes,
  `safe_same_key` among them, and `IDEMPOTENCY_CONFLICT` with the class `never`.
- [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds): idempotency records are
  kept at least 24 hours at L2.
- [§14](../../../specs/dsor/02-security.md#14-multi-tenancy): DSOR-TEN-02a, "idempotency records
  … MUST be keyed by tenant".
- DSOR-APR-02b, in [§26](../../../specs/dsor/03-execution.md#26-proposals-and-approvals): a payload hash is SHA-256 over
  the RFC 8785 canonical JSON of the input.

If the code finds the plan wrong, the plan changes here first. It did once: decision 9 was
reversed during the build, when §22 was read again. "Think it through" says why.

### The intent and the outcome

**Intent.** A command that a client sends twice, because an answer was lost, does its work once.
The second request hears the first answer.

**Outcome.** What is true when this step is done:

1. accounts-payable-fte sends `payment.create` for INV-1008 with the key `pay-INV-1008-a`. DSoR
   claims the key, drafts PAY-901, and records the answer, in one transaction.
2. The agent sends the same request with the same key again. DSoR answers PAY-901, the
   recorded answer, and drafts nothing. The record of the second call says it was a replay, and
   names the first call.
3. The agent sends the same key for a different invoice. DSoR refuses with
   `IDEMPOTENCY_CONFLICT`.
4. Fifty requests with one key, at the same moment, make one draft.
5. A command with no key is refused, and its code does not run.
6. A refusal from the command's code is kept with the claim, and a retry with the key hears it
   again. A failure that is not a refusal keeps no claim.

**Not the outcome of this step:**

- Keys for the outside systems behind a connector (DSOR-IDM-03, L3, a later step).
- A proposal that executes at most once, keyed by its own id (DSOR-IDM-04, step 22).
- A second request for the same invoice with a *new* key. A key protects against a retry, not
  against new work for the same intent: in-flight exclusivity, §25.1, a later step.
- Deleting old claims. They are kept, which meets the minimum of 24 hours (decision 11).

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-IDM-01a | **C1.** A command whose contract requires a key, and carries none, is refused at line ⑦ | `payment.create` with no key gets `VALIDATION_FAILED`. Its code does not run, no draft is made, and the record says `DENY` |
| DSOR-IDM-01b | **C2.** The key is claimed by one atomic insert, scoped to the company, the caller, the operation, and the key | Fifty parallel requests with one key make one draft, on a real database |
| DSOR-IDM-01c | **C3.** Same key and same request: the recorded answer, and the code does not run again | The second call answers PAY-901, no second draft exists, and the code ran once |
| DSOR-IDM-01d | **C4.** Same key and a different request: `IDEMPOTENCY_CONFLICT` | The key sent for INV-1009 after INV-1008 is refused, with the retry class `never`, and nothing is drafted |
| DSOR-IDM-01b, DSOR-TEN-02a | **C5.** The same key text in another company, from another caller, or for another operation is another claim | firm-ap-fte's `pay-INV-1008-a` in org_789 drafts its own payment. user_123's own draft with the agent's key text is her own. A cancel with the create's key text runs. On the database, org_789 cannot see org_456's claims |
| (our decision) | **C6.** The claim, the command's work, and its recorded answer commit together, or none of them does | A draft that fails leaves no claim, so a retry with the same key drafts. A recorded answer that fails leaves no draft. Code that drafts and then answers with a row of org_789 leaves no draft and no claim |
| DSOR-IDM-01c | **C11.** A refusal from the code is an outcome, kept and replayed. An accident is not | INV-1005, a draft invoice, is refused twice with one key, and the code runs once. Code that drafts and then refuses leaves no draft, and the refusal in the claim. A lost connection, or a refusal whose class is `safe_same_key`, keeps no claim, and the retry runs the code again |
| DSOR-IDM-01c | **C12.** A replay passes every line before ⑦ again | After user_123's slips are suspended, the agent's replay is refused at line ③, not answered (§22: "A replay that now fails steps 3–5 … returns that error") |
| (our decision) | **C7.** A key must be well formed, and a query takes none | A key of 129 characters, an empty key, or a key with a space is refused at line ①. `invoice.get` with a key is refused |
| DSOR-IDM-02 | **C8.** A claim is kept at least 24 hours | A claim made 25 hours ago still replays |
| (our decision) | **C9.** A retry after a lost record is safe with the same key | When the log fails after a keyed command ran, the caller hears `EVIDENCE_STORE_UNAVAILABLE` with the retry class `safe_same_key`, and the retry with the key replays, with one draft |
| (our decision) | **C10.** A replay's record names the first call | The record carries the key, and `replay_of` with the first call's request id |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR, made by Claude Code while the learner
was away. Each has a downside.

1. **The key travels in the request envelope, as `idempotency_key`.** It sits beside the request
   id, which also says something about the call and not about the work. It is not part of the
   input, so it never enters the request's fingerprint. *Downside:* the MCP binding of a later
   step carries the key as a tool argument (§38), and must move it into the envelope.
2. **A key is 1 to 128 characters: letters, digits, and `.`, `_`, `:`, `-`.** It is checked at
   line ①, as the request id is. These characters are safe in a log, a URL, and a database
   index. *Downside:* a client whose keys hold other characters, such as the `+` and `/` of
   base64, must change how it makes them.
3. **A command must carry a key, and a query must carry none.** Both are checked at line ⑦,
   after DSoR finds the operation's code, so every earlier refusal comes first. §21 runs line ⑦
   for commands only, so a query with no key skips it, and a query with a key runs it only to be
   refused. A key on a query is a field that DSoR does not read, and step 10's rule refuses
   those. Start-up refuses a command whose contract does not say `"required": true`, and a query
   whose contract does, so the contract never promises what line ⑦ does not do. *Downside:* a
   client that sends a key on every request must leave it off its reads.
4. **A claim's scope is the company, the caller's id, the operation's id, and the key.** One
   key text in another scope is another claim. The operation's version is not part of the
   scope: a retry across a new version of a contract is still a retry of the same work.
   *Downside:* if a new version changed what the work does, a retry gets the old version's
   answer.
5. **The fingerprint is SHA-256 over canonical JSON of line ①'s copy of the input,** written
   `sha256:` and 64 hex digits, made at line ⑥, as §21 places it. SHA-256 is a standard hash:
   it turns any text into 64 hex digits, and two different texts practically never get the
   same digits. *Canonical JSON* is one fixed way to write a value as text, so that equal
   values always give equal text: each object's keys in order, and no spaces. The order is that
   of the keys' UTF-16 code units, the 16-bit numbers that JavaScript keeps text in, as RFC
   8785 says. It is written with a list, not a function that calls itself, so any depth that
   JSON can carry is written. Step 29 is planned to build canonicalization in full; this step
   builds the part it needs, early. *Downside:* until then, a request that leaves a field out
   and a request that sends that field's default would have two fingerprints. No input of this
   step has a default.
6. **The claim, the command's reads and writes, and its recorded answer are one transaction.**
   The claim goes in first, with `INSERT … ON CONFLICT DO NOTHING`: an insert that adds the row,
   or, when the primary key already holds one, adds nothing and does not fail. The code then
   runs with the company's stores bound to that transaction, inside a *savepoint*: a mark inside
   the transaction that it can roll back to, which undoes what came after the mark and keeps
   what came before. The code's answer goes into the claim. The company check of step 10 runs
   inside too, so code that answers with another company's row keeps nothing. A failure
   anywhere rolls back all three, so a retry starts clean. A second request with the same key
   waits on the database's primary key until the first one ends. *Downside:* the transaction
   stays open while the code runs. That is right for a draft in the same database, and wrong
   for a call to a bank, which later steps are planned to handle with intent records and
   unknown outcomes.
7. **A replay gets the recorded outcome, shaped again by the checklist.** The claim records what
   the code said, unmasked: the value it returned, or the refusal it gave. A replay skips the
   code at line ⑨, and the checklist checks the company, masks, and measures the recorded value
   as it did the first time, with the retry's own correlation. A kept refusal is masked as it
   leaves too, for the caller's clearance now. Line ⑦'s own refusals name only the operation,
   so they are labelled public, and masking never hides them. *Downside:* if the labels change
   between the two calls, the replay is masked by the new labels. It is the same data, and not
   always the same bytes.
8. **The record of each keyed call names its key, and a replay's record names the first call,**
   under this tutorial's namespace in `extensions`: `idempotency: { key, replay_of }`.
   *Downside:* the audit record's schema has no field for a key, so a reader must know the
   tutorial's namespace.
9. **A refusal from the code is an outcome, and the claim keeps it. An accident keeps no claim.**
   Reversed during the build ("Think it through"). §22 says: "A recorded `DENY` is replayed like
   any other result." When the code refuses, the savepoint undoes whatever the code wrote, and
   the claim keeps the refusal: its code, its message, and its label. A retry with the key hears
   the same refusal, and the code does not run. Anything thrown that is not a refusal, such as a
   bug or a lost connection, rolls back the claim with the work. So does a refusal whose retry
   class is `safe_same_key`, because that class tells the caller that a retry with the same key
   runs again. *Downside:* after the state changes, for example when INV-1005 is issued, the
   caller needs a new key to try again.
10. **A lost record after a keyed command is `EVIDENCE_STORE_UNAVAILABLE`, `safe_same_key`.** In
    step 17, a command whose record failed after its code ran answered `INTERNAL_ERROR` with
    `never`, because a retry could draft twice (step 17's README, decision 17). Now the retry
    with the same key replays, so §28's own class for that code is true. *Downside:* the log can
    hold a replay's record for a first call that it never recorded.
11. **Claims are kept, not deleted, in this step.** DSOR-IDM-02 asks for at least 24 hours at L2.
    Keeping every claim meets it. *Downside:* the table only grows. A clean-up that keeps the
    minimum waits for a later step.
12. **An answer is written once, by the database's own rule.** A restrictive policy lets
    `dsor_runtime` update a claim only while its answer is empty, and only to fill it. The answer
    is `json`, not `jsonb`: `json` keeps the text as it was written, so a replay's fields come
    back in the first answer's order. It holds `{"value": …}` or `{"refused": …}`. The store
    map gets a new kind, `control-claimed`: DSoR's own records that it adds through named columns
    and finishes once. *Downside:* one more policy that start-up does not read (open question 80).
13. **The database tests run on a local PostgreSQL 17.** All ten Neon branches are in use, and
    deleting one is the learner's (step 19b's decision 9). The local database is configured as
    Neon behaves for these tests: the owner may write everything, and passwords are checked.
    *Downside:* step 20 has no Neon branch yet. The learner can delete `step-11`, which has no
    child, and make `step-20` from `step-19b`.

What follows from these, with no decision of its own:

- The program's command calls carry keys, and its story shows a lost answer, a retry, and a key
  reused for another invoice.
- Every test that runs a command's code sends a key. A test that is refused before line ⑦ needs
  none.
- The memory store of claims, for the unit tests, has no transaction. A draft written before a
  failure stays in memory, so the database tests prove C6.
- The log's `extensions` grow by one small object. The database's 1,024-byte limit on them still
  holds.

### The tests, by claim

Unit tests in `test/idempotency.test.ts`: C1, C3, C4, C5 in memory, C7, C9, C10, C11, C12, the
fingerprint, the start-up checks, and two calls at once in memory.

Database tests in `test/idempotency.db.test.ts`: C2 with fifty parallel requests, C3, C4, C5
against row-level security, C6 by fault injection around the real client, C8, C11 with code
that drafts and then refuses, and the policy that writes an answer once. The new grants and the
policy are in `test/audit.db.test.ts` and `test/rls.db.test.ts`.

### Breaks we will try, and what we expect

The learner was away, so these carry no predictions. The learner can predict them later, as
stories, before reading "Break it".

| # | The break | Expected to be caught by |
| --- | --- | --- |
| B1 | Check for the key, then insert it, as two steps (the map's break) | C2: fifty parallel requests make more than one draft |
| B2 | The claim's scope loses the company | C5: firm-ap-fte's key in org_789 meets org_456's claim, and is refused |
| B3 | The claim commits in a transaction of its own, before the work | C6: a draft that fails leaves a claim with no answer behind, and the retry cannot draft |
| B4 | The fingerprint is not compared | C4: the key sent for INV-1009 replays PAY-901, the answer for INV-1008 |

What really happened is under "Break it". B1 made one draft, not more, because the table's
primary key still held, and nine callers heard `INTERNAL_ERROR`. B2 was caught only by a test
added during the build.

### Left open, and not this step's idea

- New work for the same invoice under a new key: in-flight exclusivity, §25.1.
- Keys passed on to a connector's system: DSOR-IDM-03.
- A clean-up of claims older than the minimum.
- DSOR-IDM-01a names commands "in `execute` or `propose_only` mode". This step has one mode,
  `execute`. Step 23 is planned to add the others, and a `validate_only` call needs no key.
- A claim held by a call whose program died while its transaction was open. PostgreSQL rolls
  the transaction back when it notices that the connection is gone. When a whole host is lost,
  that can take as long as the connection's keepalive settings allow, and a second request
  with the key waits until then. A deployment sets `lock_timeout` and
  `idle_in_transaction_session_timeout`; this step sets neither.
- The claim relies on PostgreSQL's default isolation, `READ COMMITTED`. Under `REPEATABLE READ`,
  a request that waited for another with the same key would fail with a serialization error,
  and hear `INTERNAL_ERROR`, not the recorded answer.
- An outcome that is unknown, `OUTCOME_UNKNOWN`, which a later step's bank can give. The claim
  would keep it, and the savepoint would undo the local writes of a side effect that may have
  happened. Step 33 is planned to decide it, with the intent record.

## Before you build: set up a database

All ten Neon branches are in use (decision 13). Until the learner frees one:

1. A local PostgreSQL 17, started with `LC_ALL=C` and `-c unix_socket_directories=''`.
2. An owner login with `BYPASSRLS`, `CREATEROLE`, and membership of `pg_write_all_data`, as
   Neon's owner has, and `scram-sha-256` for every login but the cluster's own.
3. A database of the step's own, owned by that login, and `.env` written by a command that
   prints nothing: `DSOR_MIGRATION_URL` for the owner, and `DSOR_DB_URL` for `dsor_runtime`.
4. `pnpm migrate`. Migration 013 runs.

On Neon later: delete `step-11`, which has no child, make `step-20` from `step-19b`, write
`.env` with `neonctl connection-string --role-name neondb_owner`, and run `pnpm migrate`.

## What changed since step 19b

| File | What changed |
| --- | --- |
| `src/claims.ts` | **New.** The claim's scope and line ⑦'s two checks, which throws are outcomes, the claims in memory, and the start-up check of every contract's flag |
| `src/canonical.ts` | **New.** Canonical JSON and the payload hash, `sha256:` and 64 hex digits |
| `src/postgres.ts` | The claims in `dsor.idempotency`: one `INSERT … ON CONFLICT DO NOTHING`, the work inside a savepoint, the outcome written once. The invoice and payment stores run their statements through a *runner*: on the pool, as before, or inside the claim's transaction |
| `src/pipeline.ts` | Line ① reads the key once, line ⑥ makes the fingerprint, and line ⑦ claims the key and runs the code inside the claim. A replay's outcome is checked and masked again. A lost record after a keyed command is `EVIDENCE_STORE_UNAVAILABLE` |
| `src/request.ts` | `idempotency_key` in the envelope, and its form |
| `src/log.ts` | The record names the key, and a replay names the first call |
| `src/registry.ts` | The registry holds the claims, and start-up checks every contract's `idempotency.required` |
| `src/store.ts`, `store.json` | The kind `control-claimed`, and the table `dsor.idempotency` in the map |
| `src/main.ts` | Keys on every command, a lost answer and its retry, a reused key, and a retry after the restart |
| `migrations/013_idempotency.sql` | **New.** The table, its row-level security, the policy `answer_once`, and the grants |
| `test/idempotency.test.ts`, `test/idempotency.db.test.ts`, `test/owner-claims.ts` | **New.** The claims C1 to C12 |
| `test/cross-tenant.ts` | Every command the suite sends carries a key, so the suite still reaches each command's code |
| The other tests | A key on every command that reaches line ⑦, and line ⑦ in the lines a command runs |

```bash
git diff --no-index ../mj_19b_suspended_slips/src src
git diff --no-index ../mj_19b_suspended_slips/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

The new lines, from a real run on 2026-10-07 (the payment numbers grow with every run):

```text
night, the agent drafts: answered, PAY-915
02:10, the agent drafts, and the answer is lost: answered, PAY-916
02:11, the retry with the same key hears: answered, PAY-916
the same key, for INV-1008: IDEMPOTENCY_CONFLICT: the idempotency_key was used for a different request to "payment.create"
...
after a restart, user_123's retry of her draft: answered, PAY-913 draft
```

The tests, on 2026-10-07: `pnpm test` ran 1388 unit tests in 51 files, and `pnpm test:db` ran
217 database tests in 19 files, against the local PostgreSQL 17 of decision 13. All passed.

PAY-916 is answered twice and drafted once. The last line is user_123's first draft, PAY-913.
She cancelled it during the run, and DSoR restarted after that. Her retry still hears "draft":
the claim keeps the answer she was given, not the payment as it is now.

## Break it

Each break was made in a copy of this step, on a local PostgreSQL, and run for real on
2026-10-07. The outputs below are copied from those runs. Two small scripts printed the stories:
`fifty.ts` sends fifty requests with one key at the same moment, and `retry.ts` makes the first
draft fail once, then retries twice with the same key. They lived in the copy, not in this
folder.

**B1. Look for the key, then insert it, as two steps.** §22's common mistake. In
`createDbClaims`, a `SELECT` for the key comes first, and a plain `INSERT` follows when it finds
none. The fifty requests:

```text
fifty requests with one key heard: { INTERNAL_ERROR: 9, 'answered PAY-902': 41 }
new drafts in app.payments: 1
```

One draft, because the table's primary key still stopped the second `INSERT`. But nine callers
looked before the winner had committed, and their `INSERT` failed on the primary key. They
heard `INTERNAL_ERROR` instead of PAY-902. The test that caught it:

```text
× DSOR-IDM-01b: fifty parallel requests from the agent with one key create one payment
AssertionError: expected [ 'INTERNAL_ERROR', 'PAY-901' ] to have a length of 1 but got 2
```

Then the same break with no primary key on the table, as a first draft of this design might
have it:

```text
fifty requests with one key heard: {
  'answered PAY-901': 1,
  'answered PAY-908': 1,
  ...
  'answered PAY-902': 41,
  ...
}
new drafts in app.payments: 10
```

Ten drafts of 31,400.00 USD for one invoice: 314,000.00 USD. Ten, because the program's pool
holds ten connections, and ten transactions looked at the same moment. The `SELECT` protected
nothing. The primary key did all the work, and `ON CONFLICT DO NOTHING` lets it do that work
without an error.

**B2. The claim's scope loses the company.** In memory, the scope is the caller, the operation,
and the key:

```text
× DSOR-IDM-01b: firm-ap-fte sends one key in org_456 and in org_789, and drafts in each
AssertionError: expected 'IDEMPOTENCY_CONFLICT' to match object { tenant_id: 'org_789', …(1) }
```

On the database, the primary key and the `WHERE` lose `tenant_id`:

```text
× DSOR-IDM-01b: firm-ap-fte sends one key in org_456 and in org_789, and drafts in each
AssertionError: expected 'INTERNAL_ERROR' to match /^PAY-\d+$/
```

On the database, row-level security still hid org_456's claim from org_789, so org_789 heard no
data of org_456. But its own draft was refused. One test caught B2 in both tiers. That test was
added during the build: the first version only sent the key text from two different callers, and
the caller is a part of the scope of its own, so it could not see a missing company.

**B3. The claim commits in a transaction of its own, before the work.** Three tests:

```text
× step 20's decision 6: code that drafts and answers with a row of org_789 leaves no draft and no claim
× step 20's decision 6: the draft fails: no claim and no draft stay, and a retry with the key drafts once
× step 20's decision 6: the recorded answer fails: no draft and no claim stay
AssertionError: expected [ { …(4) } ] to strictly equal []
+     "answer": null,
```

Each failed call leaves a claim with no answer. What the agent hears, with `retry.ts`:

```text
02:05, the draft fails: INTERNAL_ERROR
02:06, the retry with the same key: INTERNAL_ERROR
02:07, the retry with the same key: INTERNAL_ERROR
```

The key can never be used again. Every retry finds a claim with no answer. The unbroken code,
the same script:

```text
02:05, the draft fails: INTERNAL_ERROR
02:06, the retry with the same key: answered PAY-901
02:07, the retry with the same key: answered PAY-901
```

**B4. The fingerprint is not compared.** One key, for INV-1008 and then for INV-1009:

```text
the agent asks for INV-1008 with one key: answered PAY-917, for INV-1008
the agent asks for INV-1009 with one key: answered PAY-917, for INV-1008
```

The agent believes that INV-1009 has its draft. Nobody drafts INV-1009's 7,425.00 USD. A test in
each tier caught it:

```text
× DSOR-IDM-01d: the key sent again for INV-1009 is refused with IDEMPOTENCY_CONFLICT, and nothing more is drafted
AssertionError: expected { data: { …(5) }, …(4) } to match object { code: 'IDEMPOTENCY_CONFLICT', …(1) }
```

The unbroken code answers the second request
`IDEMPOTENCY_CONFLICT: the idempotency_key was used for a different request to "payment.create"`.

After each break, the copy was restored from this folder, and its tests were green again.

## Build it yourself with Claude Code

This is how the step was built. The learner was away for all of it, and asked Claude Code to
take every decision itself.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | A session with no code, on 2026-10-07. Part 1 of 5, the lost answer, was done, with the learner's prediction right. The learner stopped at part 2: "Step 20, understanding" in `../mj_notes.md` |
| 2 | Design | "In plain words", "Why it matters", and "The design, before any code": decisions 1 to 13, each judged by the learner's two tests, closest to production and deepest understanding. No predictions for B1 to B4: the learner was away |
| 3 | Database | All ten Neon branches are in use, so a local PostgreSQL 17, set up as Neon behaves for these tests (decision 13) |
| 4 | Migration and map | Step 19b's markers removed. Migration 013, and the map's new kind. The four files that type out the store were changed with it: the catalog, the map's test, the grants, and the policies |
| 5 | Red | *Shells*: first versions of the new code, with the right names and types, that do nothing new yet. Claims that run the work every time, canonical JSON in the input's own order, and no key check, so DSoR behaved as in step 19b. Then the new tests |
| 6 | Green | The fingerprint, the claims in memory, the runner and the claims on the database, line ① to line ⑪, and the start-up check. Reading §22 again reversed decision 9 |
| 7 | The old tests | Every command that reaches line ⑦ now needs a key. The cross-tenant suite still passed without keys, while it tested less: it now sends a key with every command |
| 8 | The program | Keys on every command, a part of each key for the run, and three stories: the lost answer, the reused key, and the retry after the restart |
| 9 | Break it | Each break in a copy outside the repository, on a local PostgreSQL. B2 showed that no test could see a missing company, so one was added |
| 10 | Review | A reviewer who had not seen the conversation attacked the rules and the code, and made 35 small breaks in a copy. Claude Code fixed or recorded each finding. Then a sweep of 32 breaks ran on the fixed code: the review's survivors, and breaks of the fixes themselves. Both are under "Think it through" |

To start it in a new session:

```text
Build step 20 in learner mode from the design in
docs/baby_steps_tutorials/mj_20_idempotency_keys/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Red | 19 of the first 27 new unit tests, each for the reason it names. The database tests were written before the green code, and first ran after it. Breaks B1 to B4 show that they fail without the code they test |
| Green | 1 new unit test: decision 9's, when the decision was reversed. It was rewritten, with five tests for the new rule |
| The old tests | 48 unit tests in 7 files and 12 database tests in 3 files: each sent a command with no key, and heard `"payment.create" needs an idempotency_key in the request envelope` |
| The program | Its database test: 29 calls now, 26 records readable, and the three new stories |
| The review's fixes | None of the old tests. The review's own tests were written with their fixes, not red first. The sweep shows that each one fails without its fix |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. 02:10. The agent's draft for INV-1009 is answered PAY-916, and the answer is lost. 02:11. The
   agent sends the same request with the same key. What does it hear, and how many drafts for
   INV-1009 exist after?
2. The agent sends the same key again, for INV-1008. What does it hear, from which line, and
   what does the record say?
3. The agent's draft for INV-1005, a draft invoice, is refused with `CONFLICT`. An hour later
   somebody issues INV-1005, and the agent sends the same request with the same key. What does
   it hear? What must it do to pay INV-1005?
4. A later step's bank connector refuses with `CONNECTOR_UNAVAILABLE`, whose retry class is
   `safe_same_key`. The agent retries with the same key. Does the command's code run again?
5. The agent drafts PAY-901 with a key. Then org_456's directory suspends user_123, and DSoR
   suspends her slips. The agent sends the same request with the same key. What does it hear?

<details>
<summary>Answers</summary>

1. PAY-916, the answer DSoR recorded. One draft. Line ⑦ finds the claim with the same
   fingerprint, and the code at line ⑨ does not run (DSOR-IDM-01c).
2. `IDEMPOTENCY_CONFLICT`, with the retry class `never`, from line ⑦: the key is claimed with
   another fingerprint (DSOR-IDM-01d). The record says `DENY`, because the code did not run, and
   it names the key.
3. `CONFLICT` again, the recorded refusal. The code does not run, so DSoR does not see that the
   invoice is issued now (decision 9). To pay INV-1005, the agent sends a new key.
4. Yes. The claim never keeps a refusal whose class is `safe_same_key`, because that class tells
   the caller that a retry with the same key runs again. The claim is rolled back with the work
   (decision 9).
5. `DELEGATION_REQUIRED`, from line ③. A replay passes every line before ⑦ again, so the
   recorded answer never reaches a caller that DSoR would refuse now (§22).

</details>

## Think it through

A reviewer who had not seen the conversation attacked the step once it was green. It read the
rules against the code and the tests, sent inputs of its own, and made 35 small breaks in a
copy outside the repository, against a database of its own. Claude Code chose each fix, because
the learner was away.

**What the review found, and what changed.**

| # | Found | Fixed by |
| --- | --- | --- |
| R1 | `pnpm guard` was red: the key's pattern did not say where it came from | The comment above it says `not copied`, and why |
| R2 | On the database, the caller and the operation could leave the primary key and the statements, and every test passed. With the caller gone, user_123's own draft heard the agent's PAY-902 | Two database tests: user_123's draft with the agent's key text, and her cancel with her draft's key, each retried afterwards |
| R3 | DSoR's own company check in the claim's statements had no test of its own: row-level security hid its absence | `test/owner-claims.ts store` runs the claim store as the owner, whom no policy stops. A replay that reads two claims is a bug, never a choice |
| R4 | An `INTERNAL_ERROR` refusal, which DSoR throws for its own faults, would be kept with the claim, against decision 9's own words | It keeps no claim now. The review also asked to drop every refusal whose class is not `never`. That was not taken: §22 replays a recorded `DENY`, and a new attempt uses a new key, and only `safe_same_key` promises a retry with the same key (open question 82) |
| R5 | The key pattern with the flag `m`, `i`, or `u` passed every test, and let a key end in a new line, or hold the Kelvin sign | Four more bad keys, and a comment that says why the pattern has no flag |
| R6 | Each conflict closed a working connection, so any caller could make DSoR open a new one at every call | The conflict is refused after its transaction ends. A test counts the pool's connections over ten conflicts |
| R7 | A value that JSON cannot keep was kept on the database as `{}`, and every retry failed, while memory let the retry run again | Both stores refuse it before the claim is kept |
| R8 | No database test read a replay's record | One does now. `replay_of` names the caller's own request id (open question 85) |
| R9 | The test of DSOR-IDM-02 aged a claim by 25 hours, which proves decision 11, not the rule's 24 hours | 23 hours and 59 minutes for the rule, 25 hours for decision 11 |
| R10 | No `lock_timeout`, and a host that is lost holds its claim until PostgreSQL notices | "Left open" |
| R11 | Seven more breaks survived: the keys' order by language, `jsonb` for the answer, no database check of the key, line ⑪'s message for a conflict, the version in the scope, and two that need defence in depth | A test for each of the first five. The masking of a kept refusal moved to where every answer leaves (decision 7) |
| R12 | Unclear code: the memory store started the work before it set the claim, and `decisionOf` had `claimed`, a company, beside `claim`, a key | The claim is set first, and the parameter is `idempotency` |
| R13 | The README: the clerk wrote the number before he paid, which is break B3, and kept one book for every sender, which is B2. "Walls" and a "burned" key were metaphors outside the house list. Eight terms were used before they were defined, and three sentences spoke of unbuilt work in the present | The ledger entry, written whole, on the sender's page in each company's ledger. "Scope", the specification's word. Each term defined where it first appears |

**What the sweep found.** The review's 35 breaks left 15 survivors, and one more break was caught
only by the wording of a message (R2, R3, R5, R8, and R11). After the fixes, a second sweep made
32 breaks on the fixed code:

- 13 of those survivors and the weak catch, with the caller pair together;
- 4 breaks of the review's other fixes: the conflict inside the transaction, the empty value,
  the `INTERNAL_ERROR` refusal, and a 24-hour test whose owner's command aged nothing;
- 14 breaks of the claim's own pieces, among them the savepoint, the policy `answer_once`, the
  fingerprint of the input as sent, and the start-up check.

The first try of that sweep found one survivor: the 24-hour test passed when the owner's command
aged nothing. After that fix, a test failed for each of the 32: 16 in the unit tests, and 16 in
the claims' database file. Three of the review's survivors stay on purpose. The claim's stores
check their own company, and no caller can reach that check past `companyOf`, so it is a second
lock with no test. The start-up check of a field that the contract schema already requires is
equivalent. And the second masking of a kept refusal is gone: masking now happens once, where
every answer leaves.

**What the build taught.**

- **§22 reversed a decision.** Decision 9 first said that a refusal from the code keeps no
  claim. §22's last paragraph says the opposite: "A recorded `DENY` is replayed like any other
  result". The reason is a late copy of a request. The agent's draft for INV-1005 is refused;
  the agent drafts it later under a new key; then a copy of the first request, which the
  network held back, arrives. If the first refusal were not kept, that copy would draft a
  second payment.
- **A suite can pass while it tests less.** Without keys, every command the cross-tenant suite
  sent stopped at line ⑦, and the suite still passed: a refusal at line ⑦ is not a finding.
  It now sends a key with every command, so its same-company calls reach the code again.
- **The primary key saved the money in B1.** Looking before inserting added nothing but nine
  errors. Without the primary key, ten drafts.
- **A test that two callers pass cannot see a missing company.** B2 slipped through until one
  caller, firm-ap-fte, sent one key in both of its companies.
- **A refusal kept masked could outlive the caller's clearance.** The claim now keeps what the
  code said, and masking happens as each answer leaves, as it does for a replay's value.
- **A test can pass when the thing it describes never happens.** Nothing deletes a claim, so
  the 24-hour test passed even when the claim was not aged at all. It now reads the claim's
  age from the database's clock.
- **Keys for tests must differ between runs** when the database keeps every run's claims.
  Without a part for the run, the second run replayed the first run's drafts.

**Left open on purpose:** a clean-up of old claims; keys for the systems behind a connector
(DSOR-IDM-03); new work for the same invoice under a new key (§25.1); the modes of step 23; an
unknown outcome (open question 84); and the time limits and the isolation level under "Left
open" in the design.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-IDM-01a | Every state-changing command must carry an idempotency key | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | For the one mode this step has, `execute`. 3 unit tests in [`test/idempotency.test.ts`](test/idempotency.test.ts): a command with no key is refused at line ⑦ and its code does not run, and start-up refuses a contract that does not require a key. 1 database test in [`test/idempotency.db.test.ts`](test/idempotency.db.test.ts) |
| DSOR-IDM-01b | The key is claimed by an atomic insert, scoped to the company, the calling principal, the operation, and the key, and the insert stores the payload hash | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | 5 database tests: fifty parallel requests with one key make one draft, and each part of the scope is a claim of its own, each retried. 4 unit tests, the same scope in memory |
| DSOR-IDM-01c | The same key and the same payload hash return the recorded result, without running again | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | 6 unit tests and 2 database tests: the recorded answer, the code run once, a kept refusal, the answer as it was given, and a replay refused at line ③ when authority changed |
| DSOR-IDM-01d | The same key and a different payload hash are refused with `IDEMPOTENCY_CONFLICT` | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | 1 unit test and 1 database test: the key sent again for INV-1009 |
| DSOR-IDM-02 | Idempotency records are kept at least as long as §44's minimum, 24 hours at L2 | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency), [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds) | Met by keeping every claim (decision 11). 1 database test: a claim 23 hours and 59 minutes old, by the database's clock, still replays. 2 database tests that `dsor_runtime` cannot remove or change a claim |
| DSOR-TEN-02a | Idempotency records, among others, are keyed by tenant | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | Since this step, for `dsor.idempotency`: the primary key starts with the company. 1 database test from org_789 under row-level security, and 1 of DSoR's own lock alone, `DSOR-TEN-01b`, with the claim store run by the owner. The table's row-level security, its policies, and its grants are in [`test/rls.db.test.ts`](test/rls.db.test.ts) and [`test/audit.db.test.ts`](test/audit.db.test.ts) |

## Next

Step 21 · Optimistic concurrency. "I decided based on version 18. If the record has moved on,
refuse."
