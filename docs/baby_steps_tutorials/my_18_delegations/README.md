# Step 18 · Delegations

**New in this step:** the permission slip. The agent's commands run under a slip a person signed,
and the agent never has more power than that person has right now.

## In plain words

A *delegation* is a permission slip from a person to an agent. It says what the agent may do, up to
how much, and until when. `user_123`, the accounts-payable supervisor, signs one for
`accounts-payable-fte`: it may issue invoices and make and cancel payments, up to 50,000.00 USD a
payment, until the end of 2099. That slip is `del_100`.

Until this step the agent held power of its own. Its role granted it the commands outright, so
nobody had signed for what it did. Now its own role only reads. Every command it sends runs under
its slip, and DSoR works out what the agent may do at the moment of each decision:

- **What the slip grants**, and nothing it does not.
- **Cut down to what the signer holds right now, in that company.** If `user_123` loses a
  permission, the agent loses it on the next request. Nothing is copied into the slip, so there is
  nothing to forget to update.
- **Cut down to the login's scopes**, when it carries any. A scope can only take away. A scope the
  slip does not grant adds nothing.
- **Up to the slip's limit per payment.** 50,000.00 USD passes; 50,000.01 does not, and is refused
  with `LIMIT_EXCEEDED`. An amount in another currency cannot be compared with the limit, so the
  limit is treated as exceeded.

DSoR finds the slip itself, from the company and the agent. Nothing in a request chooses it. There
is one active slip per agent per company. The database makes sure of it, and DSoR asks again at
every decision: two active slips are refused, never chosen between. The slips live in
DSoR's own store, `dsor.delegations`, beside the log, under the same lock as every tenant table.
The application may read them and change none: there is no operation to sign a slip yet, so the
running example's comes from a migration.

Where in the checklist: a stage of its own, §21's third, "resolve the delegation", between finding
the operation and authorizing it. A command from an agent with no active slip is refused there,
`DELEGATION_REQUIRED`; an expired slip, `DELEGATION_EXPIRED`, and so is a slip whose expiry DSoR
cannot read. If the slip, or what its signer holds, cannot be read at all, the command is refused
with `DEPENDENCY_TIMEOUT`, safe to send again, because nothing has run. Every one of these
refusals is recorded, like every decision. The slip's limit is checked later, as part of §21's
tenth step, because it needs the validated amount: the one the payload hash describes.

The agent's own role, `ap_worker`, keeps one permission: `invoice:read`. A person's power is
their role's, cut down to their login's scopes, and an agent's reads are its own role's. Every
command's contract now says it needs a slip, and the program will not start with one that says
it does not. A slip a request names in its
arguments is a claim, and a claim that disagrees with the slip DSoR found is refused.

## Why it matters

On Monday `user_123` moves to another team, and no longer makes payments. Before this step the
agent kept `payment:create` anyway: it was the agent's own role's, and no person's. At 2 a.m. it
would go on paying vendors in a name that no longer had the right, and nothing would notice until
someone read the log.

Now the agent has no payment power of its own. Its power is `del_100`'s, cut down at each decision
to what `user_123` holds then. The next request after the move is refused, and nobody had to
remember to update the slip.

## What changed since step 17

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_17_vendors_and_payments ../my_18_delegations
```

| File | What |
| --- | --- |
| `migrations/013_delegations.sql` | new — `dsor.delegations`: who signed, for which agent, which permissions, up to how much per payment, the status and an expiry that must be a time; one active slip per agent per company; the second lock; the application reads and writes none |
| `migrations/014_delegations_running_example.sql` | new — `del_100`, written with its company said, for an owner the lock holds; it expires at the end of 2099, not 2026 as the specification's does, so the tutorial keeps working |
| `src/delegation.ts` | new — finding an agent's active slip, none, one or more than one, and the agent's power under it |
| `src/authority.ts` | new — what a person holds in a company right now, from a source a test can replace |
| `src/operations.ts` | the stage at §21.3, which refuses a slip it cannot read as `DEPENDENCY_TIMEOUT`; authorize asks the slip's power for an agent's command, and refuses one that reaches it with no slip resolved; the limit at §21.10, `LIMIT_EXCEEDED`; a planted slip id that disagrees is refused |
| `src/registry.ts`, `src/contracts/*.json` | every command's contract says it needs a slip, and the registry refuses one that says not |
| `src/payment.ts` | an amount in cents, exactly, for the limit |
| `src/login.ts` | a login may carry `scopes`, read as data; they only ever narrow |
| `src/pipeline.ts` | the context carries the scopes, the slip and the power; both new stages are required, in their order |
| `src/permissions.ts` | the agent's own role reads, and nothing more |
| `src/database.ts` | start-up knows five tenant tables, and refuses an application that may write a slip, itself, one `SET ROLE` away, or through a helper function |
| `src/main.ts` | the slip, a payment above its limit refused, and the done-when: user_123 loses a permission and the agent's next request is refused |
| `test/delegations.test.ts` | new — the slip, the stage, the scopes, the limit, and a slip named in the arguments |
| the tests that pin the pipeline, the agent's role and the demo | the two new stages, `invoice:read` alone, and two more refusals in the log |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the payments:

```text
Under whose authority? The agent's commands run under a permission slip:

  del_100  user_123 for accounts-payable-fte: invoice:issue, payment:create, payment:cancel
           up to 50000.00 USD a payment, until 2099-12-31

accounts-payable-fte  LIMIT_EXCEEDED           retry: after_delay          60000.00 USD is above del_100's limit of 50000.00 USD a payment

user_123 moves to another team, and no longer holds payment:create:

accounts-payable-fte  AUTHORIZATION_DENIED     retry: never                accounts-payable-fte may not call payment.create under del_100: the slip, what user_123 holds now, or the login's scopes leave out payment:create
```

The first two lines are the slip as DSoR holds it. Then two requests, each one decision. The first is
above the slip's limit. Before the second, the demo plays the company directory's part, through the
role source a test can replace, and says `user_123` no longer holds `payment:create`: the same
agent, the same slip, the same kind of request, refused. Step 19 gives the program a directory of
its own.

### The database tier

`pnpm check` needs no server. The fifty-one tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_17_vendors_and_payments/.env .env     # then dsor_step17 -> dsor_step18 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step18` through the owner
login. `pnpm migrate` applies the fourteen migrations; on a server that already had step 17's
twelve, it applies 013 and 014, and the slips arrive with del_100 in them.

## Break it

Eight, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `645` with `1 skipped`; in the repository it is `645 passed`.

### Break 1 · the agent's own role makes payments again

In `src/permissions.ts`, give `ap_worker` back `invoice:issue`, `payment:create` and
`payment:cancel`.

```text
 Tests  1 failed | 643 passed | 1 skipped (645)
```

Only the test that pins what each role grants. Nothing else notices, because an agent's command no
longer asks the agent's role at all: its power is the slip's. That test is the one place the agent
could get power nobody signed for, on the day a later step asks the role again.

### Break 2 · the slip's power forgets to ask what the signer holds now

In `src/delegation.ts`, delete `signerHoldsNow.includes(permission) &&` from `effectiveAuthority`.

```text
 Tests  4 failed | 640 passed | 1 skipped (645)
```

The step's "done when": user_123 loses `payment:create`, and the agent's next payment goes through.
The slip in org_789, where user_123 holds nothing, now lends `invoice:issue`. And two of the demo's
tests: its payment after the move is committed, so the refusal is missing and the log's counts change.

### Break 3 · the login's scopes are ignored

In `src/delegation.ts`, replace `(scopes === undefined || scopes.includes(permission)),` with
`true,`.

```text
 Tests  2 failed | 642 passed | 1 skipped (645)
```

The test that narrows the agent with scopes, and the one that hands it an empty list: both get the
whole slip. The test of a scope the slip does not grant still passes, because scopes could never
add anything; ignoring them only stops them taking away.

### Break 4 · an expired slip still counts

In `src/operations.ts`, change `if (!(until > Date.now())) {` to
`if (!(until > Date.now()) && false) {`.

```text
 Tests  2 failed | 642 passed | 1 skipped (645)
```

The slip that expired in 2020, and the one whose expiry is a year after 9999, which JavaScript
cannot read. Both pay.

### Break 5 · the limit is compared as text

In `src/operations.ts`, change `if (centsOf(amount) > centsOf(limit)) {` to
`if (amount.value > limit.value) {`.

```text
 Tests  1 failed | 643 passed | 1 skipped (645)
```

As text, "50000.01" is above "50000.00", and so is "60000.00", so the demo and the first limit test
still pass. "100000.00" sorts before "50000.00", because "1" comes before "5", and a payment of
100,000.00 USD goes through. One test sends it; without that test, nothing would notice.

### Break 6 · a slip named in the arguments is ignored

In `src/operations.ts`, change `for (const key of ["delegation", "delegation_id"]) {` to
`for (const key of [] as string[]) {`.

```text
 Tests  2 failed | 642 passed | 1 skipped (645)
```

The agent's request that names `del_999`, and the person's that names `del_100`: both run. Nothing
reads the planted id, so nothing worse happens; but a claim that disagrees with what DSoR found is
refused and recorded, because it is evidence of a caller trying something.

### Break 7 · authorize judges an agent's command by its role when no slip was resolved

In `src/operations.ts`, add `&& false` to the condition that refuses an agent's command which
reaches `authorize` with no slip resolved.

```text
 Tests  1 failed | 643 passed | 1 skipped (645)
```

Only the test that makes §21.3 do nothing. Every real request has its slip resolved, so the guard
is for the day the stage is skipped: the agent's command is then judged by its own role, which
only reads, and refused for the wrong reason.

### Break 8 · the application may write a slip

In `migrations/013_delegations.sql`, grant `SELECT, INSERT` where it grants `SELECT`.

```text
 Tests  30 failed | 614 passed | 1 skipped (645)
```

The program refuses to start: twenty of the demo's tests, seven of the database's, two of the
start-up lock's, and one of the slip's. An application that could write a slip could sign one for
itself.

## Build it yourself with Claude Code

Copy `my_17_vendors_and_payments` to a new folder and ask:

> Start step 18, delegations. Before any code: show me where the agent's power comes from today,
> and what happens to it when user_123 loses a permission. Then ask me the step's decisions one at a
> time. Then build it a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. Where does the agent's power to make a payment come from now, and where did it come from before?
2. `user_123` loses `payment:create`. What has to change in the slip for the agent to lose it too?
3. A login carries the scope `payment:approve`, which the slip does not grant. What does the agent
   gain?
4. Why is the slip found by DSoR, and never named by the request?
5. Why is an amount in another currency refused, when it might be well under the limit?

<details>
<summary>Answers</summary>

1. From `del_100`, a slip `user_123` signed, cut down at each decision to what `user_123` holds
   then and to the login's scopes. Before, from the agent's own role, which nobody had signed for.
2. Nothing. DSoR asks what `user_123` holds at every decision and copies it nowhere, so the next
   request is refused.
3. Nothing. Scopes only take away: a permission is held when the slip grants it, the signer holds
   it now, and the scopes, if any, name it.
4. A request is a claim, and the agent is untrusted. If it could choose its slip, it could choose the
   one with the most power. DSoR finds the one active slip for this agent in this company, and a
   request that names another is refused.
5. The limit is in USD, and comparing EUR with it needs a conversion this step does not have. A
   comparison that cannot convert resolves restrictively (`DSOR-MON-04`): the limit is treated as
   exceeded, and the payment is refused with `LIMIT_EXCEEDED`.

</details>

## The rules this step meets

- **[DSOR-DEL-01a · L2]** A state-changing command from an agent principal MUST be evaluated under
  an active delegation held in the DSoR control-plane store.
  ([§13.1](../../../specs/dsor/02-security.md#131-authority-of-the-delegation-record))
- **[DSOR-DEL-01b · L2]** Token claims and scopes MUST NOT widen a delegation.
- **[DSOR-DEL-02 · L2]** Effective authority MUST be computed at decision time as the intersection
  of the delegator's current authority, the delegation's grants and constraints, and the token
  scopes.

**What this step leaves, said plainly.** The decision record still says the agent acted for itself:
which slip, whose authority and in which mode are step 19's, which records an agent's command as
`unattended`, with the slip's signer as its subject. The signer's current permissions come from
this program's own list of people, which a running program never changes: the demo and the tests
change them through the role source's seam, and step 19 replaces it with a company directory that
can be out of date, or down. Limits over a day, time windows and approved vendors only are
constraints the specification's `del_100` has and this one does not, until steps 24 and 32. And
there is no operation to sign, suspend or revoke a slip; revoking one, and cancelling what waits
under it, is step 25's. The limit finds a payment's amount by the argument's name, `amount`, and a
later command that names its money otherwise would pass it; a contract names its input schema and
not its fields, so nothing can check that yet. `LIMIT_EXCEEDED` carries the retry class
`after_delay`, the specification's, which fits a daily total; for a limit on one payment, waiting
changes nothing.

Everything earlier steps claimed still holds.

**Next:** step 19, `unattended_mode_and_the_role_source` — at 2 a.m. nobody is logged in, the agent
logs in as itself, and a company directory says whether the person who signed still holds the job.
