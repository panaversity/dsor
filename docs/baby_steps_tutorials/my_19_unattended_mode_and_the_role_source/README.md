# Step 19 · Unattended mode and the role source

**New in this step:** at 2 a.m. nobody is logged in. The agent logs in as itself, DSoR reads whose
authority it carries from the slip, a company directory says whether that person still holds the
job, and the record says all of it.

## In plain words

There are three ways to call DSoR. A person or an application can act for itself: that is `direct`.
An agent can act beside a person who is logged in: `on_behalf_of`, which arrives in step 45. And an
agent can work with nobody present, logged in as itself: `unattended`. The nightly payment run is the
normal case for a digital employee, and nobody is logged in at night.

In `unattended` mode three things are true:

- **The slip must allow it.** A slip says in which modes it may be used. `del_100` allows
  `unattended`; a slip that does not is no slip for an agent alone at night.
- **The subject comes from the slip, never from the request.** The decision is `user_123`'s
  authority, used by the agent under `del_100`. The record says exactly that: the mode `unattended`,
  the subject `user_123`, the agent in the actor chain, the slip by name, and where `user_123`'s
  authority came from, and when.
- **A company directory says what the signer holds right now.** The person whose authority the agent
  carries is asleep and sends no login. So DSoR asks the company's directory at every decision. If the
  directory does not answer, the command is refused with `DEPENDENCY_TIMEOUT`, safe to send again
  once it answers. If its answer is more than 24 hours old, dated in the future, or has no time zone,
  it is refused with `FRESHNESS_UNSATISFIABLE`: wait for a fresh one.

The company directory in this step is a fake: one per company, built from this program's people,
which the tests and the demo can change, make stale, or switch off. A real one is a directory sync
or an identity provider; what DSoR asks of it is the same two things: what does this person hold,
and when was that true?

The record of an agent's command under `del_100` now says, in the fields the audit schema has for
them:

| Field | Says |
| --- | --- |
| `identity.mode` | `unattended` |
| `identity.subject` | `user_123`, taken from the slip |
| `identity.actor_chain` | `accounts-payable-fte`, the agent that logged in |
| `identity.subject_authority` | `role_source`, as of the directory's answer |
| `delegation` | `del_100`, in a column of its own, inside the hash |

The same holds for a refusal once DSoR has found the slip: a slip that does not allow `unattended`,
an expired one, or a directory that gave no usable answer. Everything else stays `direct`: a person,
the agent's own reads, and an agent's command refused before DSoR found an active slip, because no
one's authority was used.

A slip allows `unattended` only when it says so. `del_100` says so in migration 017; a slip that
names no modes allows only `on_behalf_of`, which nothing can use until step 45. And a slip is
signed by someone other than its own agent.

## Why it matters

`user_123` moves to another department on Monday. The company's directory knows by Monday noon.
Before this step DSoR asked this program's own list of people, which never changes while the program
runs, so the agent kept paying vendors under `user_123`'s authority for as long as the program kept
running. And the log said `direct`, subject `accounts-payable-fte`: an auditor reading it would
think the agent had acted on its own authority, when it had used a person's.

Now DSoR asks the directory at every decision, and the record says whose authority was used. If the
directory is down, or its answer is a day old, the agent is refused, not waved through: the last
answer DSoR saw is exactly the out-of-date answer this rule exists to stop.

## What changed since step 18

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_18_delegations ../my_19_unattended_mode_and_the_role_source
```

| File | What |
| --- | --- |
| `migrations/015_slip_modes.sql` | new — a slip's `modes`, never none, from `on_behalf_of` and `unattended`, `on_behalf_of` when a slip names none; and a slip is signed by someone other than its own agent |
| `migrations/016_the_record_names_the_slip.sql` | new — the log's `delegation` column, granted by name |
| `migrations/017_del_100_may_be_used_unattended.sql` | new — `del_100` says it may be used with nobody present; the tests run it again after 014 |
| `src/directory.ts` | new — the fake company directory, one per company, which a test or the demo can change, make stale, or switch off |
| `src/authority.ts` | what a slip's signer holds now, asked of the company's directory; no directory or no answer is one refusal, and an answer that says nothing, has no time zone, is dated in the future or is more than 24 hours old is another |
| `src/delegation.ts` | a slip's modes |
| `src/operations.ts` | §21.3 refuses a slip that does not allow `unattended`, says why the signer's authority could not be established, and refuses under the slip once it has found it; §21.11 records an agent's command under a slip as `unattended` |
| `src/audit.ts` | the record's identity for an unattended decision, and its slip, inside the hash |
| `src/pipeline.ts` | the context carries when the directory knew the signer's authority, and a stage may say what it learned before it refuses |
| `src/database.ts` | start-up refuses an UPDATE granted on any column of the log |
| `src/main.ts` | the record of the agent's command, the directory switched off and stale, and the printed log saying who acted under which slip |
| `test/unattended.test.ts` | new — the modes, the directory, and the record |
| the tests that changed what user_123 holds | through the directory now, not step 18's seam |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the slip's:

```text
At 2 a.m. nobody is logged in. Whose authority did the agent use?

  invoice.issue@1  unattended: user_123's authority, used by accounts-payable-fte under del_100
                   what user_123 holds, from the company's directory as of 2026-10-11T00:24:18.090Z

The company's directory is switched off:

accounts-payable-fte  DEPENDENCY_TIMEOUT       retry: safe_same_key        what user_123 holds in org_456 now could not be established: org_456's directory did not answer. Nothing was done; it is safe to send again

It answers again, with what it knew 25 hours ago:

accounts-payable-fte  FRESHNESS_UNSATISFIABLE  retry: after_delay          what user_123 holds in org_456 now could not be established: org_456's directory's answer about user_123 is more than 24 hours old. Nothing was done
```

The first two lines are read from the log: the record of the agent's first command under del_100,
issuing INV-1009, says whose authority it used and when the directory knew it, in UTC. Then two
requests, each one decision. The directory is switched off, and the refusal says the same request
may be sent again once it answers. Then it answers with what it knew 25 hours ago, and the refusal
asks for a wait instead, without telling the agent how old the answer was.

In the printed log further down, each of the agent's records under the slip ends with who acted,
the directory's two refusals included:

```text
28  ALLOW  payment.create@1     user_123               ALLOWED                 sha256:9b380bb...  unattended: by accounts-payable-fte under del_100
33  DENY   payment.create@1     user_123               DEPENDENCY_TIMEOUT      sha256:b561370...  unattended: by accounts-payable-fte under del_100
34  DENY   payment.create@1     user_123               FRESHNESS_UNSATISFIABLE  sha256:c63a457...  unattended: by accounts-payable-fte under del_100
```

### The database tier

`pnpm check` needs no server. The fifty-one tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_18_delegations/.env .env     # then dsor_step18 -> dsor_step19 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step19` through the owner
login. `pnpm migrate` applies the seventeen migrations; on a server that already had step 18's
fourteen, it applies 015 to 017.

## Break it

Six, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `673` with `1 skipped`; in the repository it is `673 passed`.

### Break 1 · a directory that does not answer is taken as the usual answer

In `src/authority.ts`, where the directory did not answer, assume the signer holds what an
accounts-payable supervisor usually holds: replace the line that throws with
`answer = { permissions: ["invoice:read", "invoice:issue", "payment:create", "payment:cancel"], asOf: new Date().toISOString() };`.

```text
 Tests  6 failed | 666 passed | 1 skipped (673)
```

The map's "break it": switch the directory off, and the agent is waved through. The two tests that
switch it off, the record of that refusal, and three of the demo's: its section, the log's counts,
and the one refusal that invites the same request again, which is now a payment. The usual answer is
exactly the answer this step exists to stop: the one DSoR did not get.

### Break 2 · an answer of any age counts

In `src/authority.ts`, change `if (age > STALENESS_BOUND_MS) {` to
`if (age > STALENESS_BOUND_MS && false) {`.

```text
 Tests  4 failed | 668 passed | 1 skipped (673)
```

The 25-hour-old answer passes: its test, the record of its refusal, and two of the demo's. The test
that a stale answer is recorded with the directory's own time still passes, because a payment it
lets through is recorded with that time too. Nothing about the record changes; only the refusal is
gone.

### Break 3 · a slip for use beside a person counts at night

In `src/operations.ts`, change `if (!slip.modes.includes("unattended")) {` to
`if (!slip.modes.includes("unattended") && false) {`.

```text
 Tests  3 failed | 669 passed | 1 skipped (673)
```

The slip for `on_behalf_of` alone, the slip that names no modes, and the record of that refusal.
`del_100` allows `unattended`, so nothing else notices: the check is for the slip that does not.

### Break 4 · the record says the agent acted for itself

In `src/operations.ts`, in `recordTheDecision`, change `...(context.delegation === undefined` to
`...(true`.

```text
 Tests  8 failed | 664 passed | 1 skipped (673)
```

Every record of an agent's command goes back to `direct`, subject `accounts-payable-fte`, no slip:
the record tests, the planted-identity tests, the refusals' records, and two of the demo's. The
payments still run. A wrong record changes nothing a caller sees, which is why it needs tests of
its own.

### Break 5 · the subject comes from the request

In `src/operations.ts`, change `delegator: context.delegation.delegator,` to
`delegator: String(context.given?.["subject"] ?? context.delegation.delegator),`.

```text
 Tests  2 failed | 670 passed | 1 skipped (673)
```

The two tests that plant a subject in the arguments: the record now blames `cfo_100` for the agent's
payment. The payment itself is unchanged, so only the record shows it, which is what `DSOR-DEL-08`
is about.

### Break 6 · migration 016 forgets its grant

In `migrations/016_the_record_names_the_slip.sql`, delete the `GRANT INSERT (delegation)` line.

```text
 Tests  284 failed | 388 passed | 1 skipped (673)
```

Every record names the column, even when it is empty, and step 09's grant on the log names its
columns one by one. So no decision can be written, a person's included, and the program refuses to
carry anything out: the evidence rule from step 09, at work.

## Build it yourself with Claude Code

Copy `my_18_delegations` to a new folder and ask:

> Start step 19, unattended mode and the role source. Before any code: show me what the log says
> about the agent's payment at 2 a.m., and where DSoR learns what user_123 holds. Then ask me the
> step's decisions one at a time. Then build it a piece at a time, red first, and break each piece on
> purpose.

## Check yourself

1. At 2 a.m. the agent makes a payment under `del_100`. Who is the subject of the decision, and
   where did DSoR learn it?
2. The company's directory has been down since midnight. What happens to the agent's next payment,
   and why not use the last answer DSoR saw?
3. The directory answers, but its answer is from 25 hours ago. What happens, and what would change
   if it were from 23 hours ago?
4. `user_123` is logged in and the directory is down. Can `user_123` cancel a payment? Why is that
   different from the agent?
5. An agent's request carries `subject: "cfo_100"` in its arguments. What does the record say?

<details>
<summary>Answers</summary>

1. `user_123`, the slip's signer, taken from `del_100` in DSoR's own store. The agent is in the
   actor chain, and the slip is named on the record.
2. It is refused with `DEPENDENCY_TIMEOUT`, safe to send again once the directory answers. The last
   answer could be months old, which is exactly the answer the rule exists to stop: `user_123` may
   have changed jobs since.
3. More than 24 hours is no answer: refused with `FRESHNESS_UNSATISFIABLE`, which asks for a wait
   rather than an immediate retry. At 23 hours the answer counts, and the payment runs.
4. Yes. The directory is asked only about a person who is not in the request, the slip's signer. A
   person who is logged in is judged by this program's own list, standing in for what a real login
   would carry.
5. `user_123`. The subject comes from the slip, never from the request, and nothing reads the
   planted one.

</details>

## The rules this step meets

- **[DSOR-DEL-07 · L2]** An `unattended` request MUST be accepted only under a delegation whose
  `modes` include `unattended`.
  ([§13.2](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire))
- **[DSOR-DEL-08 · L2]** In `unattended` mode DSoR MUST take the subject from the delegation
  record, never from the request.
- **[DSOR-IDN-05 · L2]** Each tenant MUST configure a role source from which DSoR can read the
  current roles of a principal who is not present in the request.
  ([§12.1](../../../specs/dsor/02-security.md#121-role-source))
- **[DSOR-IDN-06 · L2]** When the delegator's current authority cannot be established within the
  staleness bound, DSoR MUST deny the command.

**What this step leaves, said plainly.** The directory is a fake in memory; a real one is a
directory sync or an identity provider, and connecting one is outside this tutorial. When the
directory says a signer has left or is suspended, DSoR refuses the agent but does not suspend the
signer's slips, which `DSOR-IDN-07` asks for and a later step builds. `on_behalf_of`, the agent beside
a person who is logged in, is step 45's. A person who is logged in is judged by this program's list
of people and the slip's signer by the directory, two sources for one person, until a real login in
steps 43 and 44. The record's `subject_authority.as_of` has no way to say an authority was never
established, so a refusal before the directory gave a time carries the decision's own: a question for
the specification. And an agent's reads run under its own role, with no slip, recorded `direct`.

Everything earlier steps claimed still holds.

**Next:** step 20, `idempotency_keys` — networks fail and clients retry, and a retried payment must
not be a second payment.
