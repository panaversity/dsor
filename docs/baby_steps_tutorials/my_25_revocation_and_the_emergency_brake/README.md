# Step 25 · Revocation and the emergency brake

**New in this step:** a person can tear up a permission slip, stop one agent, or freeze every agent
in the company, and none of it asks the agent to cooperate.

## In plain words

Two switches, both on DSoR's side, both for people.

**The brake.** `control.suspend` stops one agent in one company, or, given the company's own
address, every agent in it:

```ts
await callOperation(supervisor, "control.suspend", {
  target: "dsor://org_456/agent/accounts-payable-fte",
  suspended: true,
  reason: "paying invoices it should not",
}, { idempotencyKey });
```

From then on, every command the agent sends is refused `AGENT_SUSPENDED` at §21.4, a stage of its own
in the checklist, before anything is decided. It can still read: reading changes nothing. Releasing
the brake is the same command with `suspended: false`, and only a person may send it. The brake is a
record in DSoR's own store, with who pulled it, when and why, and who released it; the agent never
reads that table and nothing it sends can change it.

**Tearing up a slip.** `delegation.revoke` marks a slip revoked, with who and why. Its signer may: for
del_100, `user_123`. After that the agent has no slip, and every command it sends is refused. In the
same statement, every proposal under the slip that was waiting for approval, or approved, is
cancelled, and any amount it held against the day is given back.

**Two locks, not one.** §21.4 refuses a stopped agent's command before anything is decided. But a
person can pull the brake while one of the agent's commands is already past §21.4, on its way to its
handler. So the statement that moves a proposal to EXECUTING asks again, in the same statement: if a
brake is on the agent now, nothing is written, the proposal is DENIED, and the handler never runs. A
prepared command's move to READY asks too.

**Who may, decided before it is recorded.** Only a slip's signer may revoke it, and only a person may
release a brake. Both are decided at §21.9, a stage that reads the validated arguments, before §21.11
records the decision: a refusal is recorded as the DENY it is, never as an ALLOW followed by a
refusal.

## Why it matters

At 3 a.m. the agent starts paying invoices it should not. Until this step there was no switch:
`user_123` could not tear up del_100, only someone editing the database could, and nothing stopped
one agent or every agent at once. And asking the agent to stop is asking the thing that misbehaves to
behave. The brake works because it is not the agent's: DSoR reads it on every command, from a table
the agent cannot touch.

## What changed since step 24

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_24_limits_with_reservations ../my_25_revocation_and_the_emergency_brake
```

| File | What |
| --- | --- |
| `migrations/024_the_emergency_brake.sql` | new — the brake: one agent, or every agent in a company; who pulled it, when and why, who released it; one at a time per target, a lift final, nothing deleted |
| `migrations/025_a_slip_can_be_revoked.sql` | new — a slip can be marked revoked with who, when and why, and nothing else; a second policy keeps it so |
| `migrations/026_org_789_has_a_slip_too.sql` | new — org_789's own del_100, so the cross-tenant suite has a slip of the same number in both companies |
| `src/controls.ts` | new — pull the brake, release it, and say what stops an agent now |
| `src/delegation.ts` | read one slip by its id; revoke it and cancel what waited under it, in one statement |
| `src/operations.ts` | §21.4 asks the brake; §21.9 asks who may act on the target; the door's move to EXECUTING, and a prepared command's to READY, ask the brake again; the handlers of `control.suspend` and `delegation.revoke` |
| `src/proposal.ts` | the path into EXECUTING must be told the agent, and asks the brake; nothing enters EXECUTING one move at a time |
| `src/pipeline.ts` | twelve stages, the two new ones required by name |
| `src/permissions.ts`, `src/classification.ts`, `src/registry.ts`, `src/contracts/*.json` | `control:suspend` for `user_123` and `cfo_100`, `delegation:revoke` for `user_123`; the two receipts' labels; the two contracts |
| `src/reservation.ts` | a CANCELLED proposal's reservation is released, as every ending §13.4 lists |
| `src/database.ts` | start-up knows eleven tenant tables, expects both new policies word for word, and refuses more rights on slips and brakes than revoking and braking need |
| `src/main.ts` | the brake pulled at 3 a.m. and released, and a month-end freeze |
| `test/brake.test.ts`, `test/revoke.test.ts` | new — the brake, both locks, who may release it; revoking, what it cancels, who may revoke |
| the tests that pin the pipeline | twelve stages, and the stage-order proof by its parts |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the day's payments:

```text
3 a.m.: the agent is paying what it should not. user_123 pulls the brake on it:

user_123              COMMITTED                dsor://org_456/control/ctl_1  brake on   atomic
accounts-payable-fte  AGENT_SUSPENDED          retry: never                accounts-payable-fte is suspended in org_456, by user_123; a person must lift it
accounts-payable-fte  (internal)               dsor://org_456/invoice/INV-1008  (amount withheld)  issued
                        withheld: amount (clearance)
                        current, read at 2026-10-11T19:44:24.135Z from postgres

user_123 lifts it, and the agent's payment goes through:

user_123              COMMITTED                dsor://org_456/control/ctl_1  brake off  atomic
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-913  draft      compensatable
                        withheld: amount (clearance)

Month-end: cfo_100 freezes every agent in org_456, and lifts the freeze after:

cfo_100               COMMITTED                dsor://org_456/control/ctl_2  brake on   atomic
accounts-payable-fte  AGENT_SUSPENDED          retry: never                every agent in org_456 is stopped, by cfo_100; a person must lift it
cfo_100               COMMITTED                dsor://org_456/control/ctl_2  brake off  atomic
```

The agent's payment is refused while the brake is on, and its read still answers: a brake stops state
changes, and reading is not one. The refusal says who pulled the brake, and never why: the reason is a
person's words about the agent, for the people who read the record. Nothing in the agent changed, at
any point; that is the map's "done when".

The demo does not revoke del_100. A slip once revoked stays revoked, and every later run of the demo
needs del_100; revoking is shown in `test/revoke.test.ts` instead.

### The database tier

`pnpm check` needs no server. The sixty-nine tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_24_limits_with_reservations/.env .env     # then dsor_step24 -> dsor_step25 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step25` through the owner
login. `pnpm migrate` applies the twenty-six migrations; on a server that already had step 24's
twenty-three, it applies 024, 025 and 026. This step adds no test of its own to the tier; its two
commands join the cross-tenant suite there, which is why the count rose from fifty-seven. No test
races a brake against a move to EXECUTING on a real server; see what this step leaves, below.

## Break it

Three, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `876` with `1 skipped`; in the repository it is `876 passed`.

### Break 1 · §21.4 asks nothing

The map's "break it" turned round: take the brake out of the checklist. In `src/operations.ts`, in
`checkTheOperationalStatus`, change
`if (principal.type !== "agent" || context.contract?.kind !== "command") {` to the same line with
`|| true` before its `)`.

```text
 Tests  5 failed | 870 passed | 1 skipped (876)
```

Fewer than you might think, and that is the second lock. A stopped agent's payment is still stopped,
by the move to EXECUTING, but after an ALLOW is on the record and a proposal made, and in other words:
the test that reads the log, the one that names who pulled the brake, and the demo's lines. And its
dry run, which reaches no move at all, is now answered "allowed".

### Break 2 · the move to EXECUTING forgets the brake

In `src/operations.ts`, in the door, after the comment
`// STEP 25: and for an agent, not if a brake is on it now (DSOR-OPS-01c).`, change
`principal.type === "agent" ? principal.id : null,` to `null,`.

```text
 Tests  1 failed | 874 passed | 1 skipped (876)
```

One: the brake pulled between the decision and the handler. Every other test pulls it before the
request starts, and §21.4 catches those. The handler runs, and the payment a person stopped is made.

### Break 3 · tearing up a slip cancels nothing waiting under it

In `src/delegation.ts`, in `revokeSlip`, change `WHERE EXISTS (SELECT 1 FROM revoked)` to
`WHERE false AND EXISTS (SELECT 1 FROM revoked)`.

```text
 Tests  2 failed | 873 passed | 1 skipped (876)
```

The slip is revoked, and the payments that were waiting for approval under it, or approved, stay
where they were, ready to run once released, with their amounts still held against the day. The two
tests of what waited.

## Build it yourself with Claude Code

Copy `my_24_limits_with_reservations` to a new folder and ask:

> Start step 25, revocation and the emergency brake. Before any code: show me the agent misbehaving
> at 3 a.m. and everything I could do today to stop it. Then ask me the step's decisions one at a
> time. Then build it a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. The agent is suspended. Can it still read an invoice? Why?
2. A person pulls the brake after the agent's payment has passed §21.4. What stops the payment?
3. Why may `user_123` pull or release the brake, but the agent never release it, even if its slip one
   day granted `control:suspend`?
4. `user_123` revokes del_100 while a payment under it waits for approval. What happens to that
   payment, and to the amount it held against the day?
5. Why is "only the signer may revoke" decided at §21.9 and not in the handler?

<details>
<summary>Answers</summary>

1. Yes. A brake stops state changes, and reading is not one: §21.4 lets a query through.
2. The statement that moves the proposal to EXECUTING asks the brake again, in the same statement.
   Nothing is written, the proposal is DENIED, the caller is told `AGENT_SUSPENDED`, and the handler
   never runs.
3. Releasing a brake is a person's decision (`DSOR-OPS-01d`): §21.9 refuses an agent whatever it holds.
   Pulling a brake only stops things, so it needs nothing more than `control:suspend`.
4. It is cancelled, in the same statement that revokes the slip, and its reservation is released,
   giving its amount back to the day.
5. Because a refusal in the handler comes after §21.11 has recorded ALLOW: the log would say one thing
   and the answer another. At §21.9 the refusal is recorded as the DENY it is.

</details>

## The rules this step meets

- **[DSOR-DEL-04a · L2]** A delegation MUST be revocable by its delegator and by a tenant
  administrator. ([§13.3](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation))
- **[DSOR-DEL-04c · L2]** On revocation or expiry, every proposal created under the delegation that
  is `PENDING_APPROVAL` or `APPROVED` MUST move to `CANCELLED`.
- **[DSOR-OPS-01a · L2]** DSoR MUST provide per-agent suspension and a tenant-wide agent freeze.
  ([§18](../../../specs/dsor/02-security.md#18-operational-controls))
- **[DSOR-OPS-01c · L2]** While a suspension or freeze is active, a proposal from an affected agent
  MUST NOT enter `EXECUTING`.
- **[DSOR-OPS-01d · L2]** A suspension or freeze MUST be lifted only by a human holding
  `control:suspend`.

**What this step leaves, said plainly.** Only a slip's signer may revoke it: a tenant administrator,
who could revoke anyone's, is nobody in the story's cast, so `DSOR-DEL-04a` is met in part.
`DSOR-DEL-04c` asks the same cancellation on a slip's expiry, and nothing watches the clock for it.
Revoking a slip stops new decisions; a command already decided under it runs, and unlike the brake
there is no last check. A brake that commits while a move to EXECUTING is running is not seen by that
move, which reads the brakes as they were when its statement began; no test races the two on a real
server. "A person" is whoever logged in: logins are believed until steps 43 and 44. And a question for
the specification: `DSOR-SRC-02b` refuses a delegation identifier in the arguments that disagrees with
the request's own, and read literally that would stop a delegator from naming the slip they revoke,
which `DSOR-DEL-04a` asks that they can. This step calls the argument `target`, a reading of the rule
and not a change to it, written down in decision 143 for the editor.

Everything earlier steps claimed still holds.

**Stage 3 of the learning path is complete.** **Next:** step 26, `money_done_right` — compare amounts
exactly, in any currency, with a table of exchange rates; when an amount cannot be converted, the
strict answer wins.
