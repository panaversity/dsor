# Step 28 · Where a rule came from

**New in this step:** a control is checked against the policy it came from; when the policy
changes, the control is marked stale and its owner is told, and it is never switched off quietly;
and only the control's owner, a person, may switch it on.

## In plain words

Step 27's CFO control says where it came from: version 4 of
`ksor://org_456/finance/payment-approval-policy`, "Payments above 25,000 USD or equivalent require CFO
approval." KSoR is the company's record of what it knows, its policies among them. Until this step
nothing ever checked that pointer.

Now DSoR runs a **sweep**: for every control in force, it asks KSoR which version of the control's
policy is in force. When finance publishes version 5, "payments above 20,000 USD", the sweep
notices that the control still cites version 4. It marks the control **stale**, writes that in the
company's log, and puts a notice in the inbox of the control's owner, `cfo_100`: review it.

A stale control is **not switched off**. It keeps enforcing exactly what it said, a 25,000 USD line,
and its owner knows. Out of date is still safer than absent. Replacing it with a version that cites the
policy in force needs a command that retires a control, which this step does not build.

And switching a control on is a command now, `control.activate`, which goes through the whole
pipeline and is recorded. Both people in the story hold the permission `control:activate`. What
decides is whether the caller is the control's **owner**, the person it names: the CFO owns the CFO's
control, so user_123 is refused. An agent is refused whatever its permission slip says.

## Why it matters

- **A policy changes and nobody notices.** Finance lowers the line to 20,000 USD. The control keeps
  enforcing 25,000, a payment of 22,000.00 USD goes through with no CFO, and the control still looks
  current. Now the control is marked stale the next time the sweep runs, and its owner is told. The
  line itself moves only when the control is replaced, which waits for a later step.
- **"Stale" read as "off".** Dropping a stale control would turn a policy change into no policy at
  all, until somebody gets round to it. A stale control applies exactly as before.
- **Anyone can switch a control on.** In step 27 the demo called `switchOn` itself. A supervisor
  could switch on the CFO's control, a careless handler one nobody reviewed, and an agent with a slip
  that named the permission could switch one on for itself. Now only the owner, a person, can.

## What changed since step 27

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_27_controls_in_cel ../my_28_where_a_rule_came_from
```

| File | What |
| --- | --- |
| `src/ksor.ts` | new — the fake KSoR, one per company: each policy's version in force, its fingerprint and its text; a test or the demo can publish a new version or switch it off |
| `src/notices.ts` | new — an inbox for each person, which DSoR puts notices in |
| `src/policy-controls.ts` | `noticeStalePolicies`, the sweep; the code each refusal to switch on is told |
| `migrations/032_a_control_can_go_stale.sql` | new — the second lock lets the application mark a control in force stale, and still never retire one |
| `migrations/033_org_789_has_a_control_too.sql` | new — org_789's own control of the same name, so the cross-tenant suite has something a careless command could touch |
| `src/contracts/control.activate.json`, `src/operations.ts`, `src/permissions.ts`, `src/registry.ts`, `src/classification.ts` | the new command: its contract, its handler, §21.9's question about the owner, the permission for both people, its receipt's labels |
| `src/database.ts` | start-up reads migration 032's policy |
| `src/main.ts` | the control switched on by its owner after two refusals; then version 5, the sweep, the CFO's inbox, and a payment still waiting |
| `test/stale-policies.test.ts`, `test/activation.test.ts` | new |
| `test/support/cross-tenant-suite.ts`, `test/support/story.ts` and nine test files | the controls' rows in the suite, org_789's control in the story, and the new operation in every list of operations |

## Run it

```bash
pnpm install
pnpm start
```

After the money section:

```text
org_456's policy: payments above 25,000 USD or equivalent need the CFO. Its control:

user_123              AUTHORIZATION_DENIED     retry: never                only the owner of high-value-payment may switch it on, and user_123 is not
accounts-payable-fte  AUTHORIZATION_DENIED     retry: never                accounts-payable-fte may not call control.activate under del_100: the slip, what user_123 holds now, or the login's scopes leave out control:activate
cfo_100               COMMITTED                dsor://org_456/control/high-value-payment  active     atomic

user_123              VALIDATED                the decision would be REQUIRE_APPROVAL; nothing was done
user_123              PENDING_APPROVAL         dsor://org_456/proposal/prop_34  waits for 1 by CFO (high-value-payment v8)
                                              until 2026-10-22T22:02:36.461Z
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-916  draft      compensatable
                        withheld: amount (clearance)

Finance publishes version 5 of the policy: payments above 20,000 USD need the CFO.

  the sweep marked high-value-payment v8 stale: it cites version 4, and version 5 is in force
  in cfo_100's inbox: Your control high-value-payment v8 cites version 4 of ksor://org_456/finance/payment-approval-policy, and the version in force is version 5. It is marked stale and is still enforced exactly as it is: review it.
user_123              PENDING_APPROVAL         dsor://org_456/proposal/prop_36  waits for 1 by CFO (high-value-payment v8)
                                              until 2026-10-22T22:02:36.472Z
```

user_123 is refused because the control is not theirs; the agent because nothing it holds reaches
`control:activate`; the CFO switches it on. Then finance publishes version 5. The sweep marks the
control stale and tells the CFO, and user_123's next payment above the line still waits, under
version 8. On a second run the control is stale already: the CFO's `control.activate` is a
`CONFLICT`, and the sweep has nothing new to mark. In the log, the sweep's record reads
`stale  (the sweep)  dsor  STALE_AUTHORITY`: DSoR itself made the change, and nobody asked for it.

### The database tier

```bash
cp ../my_27_controls_in_cel/.env .env     # then dsor_step27 -> dsor_step28 in both lines
pnpm migrate && pnpm test:db
```

`pnpm migrate` applies 032 and 033 on a server that has step 27's thirty-one. Run on Neon on 2026-10-20, on `dsor_step28`: 81 passed, six more than step 27's, because the cross-tenant suite asks `control.activate` its six questions; 81 again after the review's fixes.

## Break it

Three, each measured on the full suite in a copy outside the repository, where one test skips
because the specification is not beside it.

### Break 1 · a stale control is dropped

In `src/policy-controls.ts`, in `controlsInForce`, read `status = 'active'` instead of
`status IN ('active', 'stale_authority')`.

```text
      Tests  7 failed | 1224 passed | 1 skipped (1232)
```

Once the policy changes, the CFO's control governs nothing: the payment that should still wait is
made, in the tests and in the demo. "Stale" read as "off".

### Break 2 · the owner is not told

In `noticeStalePolicies`, replace the call to `tell` with a function that does nothing.

```text
      Tests  4 failed | 1227 passed | 1 skipped (1232)
```

The control is marked and the log has its record, and the person who must review it never hears.

### Break 3 · an agent's slip lets it switch a control on

In `src/operations.ts`, at §21.9, make the question `principal.type !== "human"` never true.

```text
      Tests  1 failed | 1230 passed | 1 skipped (1232)
```

Only one test, the agent under a slip that names `control:activate`: everywhere else, §21.5 refuses
the agent first, because nothing it holds reaches the permission. One question is all that stands
between a slip written carelessly and an agent switching on its own rules.

## Build it yourself with Claude Code

Copy `my_27_controls_in_cel` to a new folder, without its `.env`, and ask:

> Start step 28, where a rule came from. Before any code: show me version 5 of the policy published
> and the CFO's control still enforcing 25,000 USD with nobody told, and user_123 switching on a
> control the CFO owns. Then ask me the step's decisions one at a time. Then build it a piece at a
> time, red first, and break each piece on purpose.

## Check yourself

1. The policy changes. Why does DSoR not switch the control off?
2. What three things does the sweep do when a control's policy has moved on?
3. user_123 holds `control:activate`. Why may they not switch on the CFO's control?
4. An agent's slip names `control:activate`, and its signer holds it. What happens?

<details>
<summary>Answers</summary>

1. A control out of date is still safer than none. It keeps enforcing what it said, and its owner is
   told to review it (`DSOR-CTL-03b`).
2. It marks the control `stale_authority`, writes a `control_change` record in the company's log, and
   puts a notice in its owner's inbox (`DSOR-CTL-03a`).
3. The permission says who may ask; §21.9 asks whose control it is. Only its owner, the person it
   names, may switch it on (`DSOR-CTL-02a`).
4. Refused at §21.9: an agent never switches a control on, whatever its slip says (`DSOR-CTL-02b`).

</details>

## The rules this step meets

- **[DSOR-CTL-02a · L2]** A control MUST be activated only by its human control owner — activation
  only: no command modifies, suspends or retires a control yet, so nobody can.
- **[DSOR-CTL-02b · L2]** An agent principal MUST NOT activate a control.
- **[DSOR-CTL-03a · L2]** DSoR MUST detect that the authority a control cites has been superseded,
  and then mark the control `stale_authority` and notify its owner — by a sweep the program runs; the
  demo runs it, since this tutorial has no timer.
- **[DSOR-CTL-03b · L2]** A stale control MUST NOT be dropped or skipped.
- **[DSOR-CTL-04 · L1]** Every decision record identifies each evaluated control by id and version,
  with the authority reference and its version: step 27's record, which a stale control keeps.

**What this step leaves, said plainly.** A stale control enforces what it said, whatever its
`on_stale` says, and `stale_grace` is not counted (`DSOR-CTL-03c`). The sweep has no timer. No command retires a
control, so a stale one cannot be replaced yet, and the line stays where it was. The second lock sees
only the row a control becomes, so the program's own code could move a waiting control straight to
stale, in force with no case run, in place of its owner's tested version: migration 032's comment says
that errs toward refusing, and it does not (decision 166, which says what would close it). A decision
under a stale control records the policy version it cites, not the one in force. The inbox lives in
memory. A waiting payment still waits for an approval nobody can give: step 29.

**Next:** step 29, `approvals`: `proposal.approve`, by an approver logged in as themselves, tied to a
fingerprint of the exact request, and expiring.
