# Step 30 · Who may not approve

**New in this step:** an approval is a second person looking. The person who asked for a proposal,
or who signed the slip an agent asked under, may not approve it; an agent never approves; and a
control that asks for two approvals gets two people, not one person twice.

## In plain words

In step 29 the CFO approves user_123's payment. That works because two people are involved: user_123
asked, and the CFO looked.

Now the CFO may make a payment herself. Her 31,400.00 USD payment is above her own control's line,
so it waits for the CFO. Without this step, she approves it: one person asks, and the same person
says yes. The control is satisfied on paper, and nobody else ever looked.

So §21.9 asks one more question before an approval is kept. Is the approver in the proposal's
**requesting chain**?

```text
cfo_100 asks for prop_N               →  cfo_100 may not approve prop_N
the agent asks under del_300,
  which cfo_100 signed                →  cfo_100 may not approve it either
user_123 asks                         →  cfo_100 approves
```

The chain is read from what the proposal **recorded when it was made**, never from the approval
request, so nobody can name somebody else as the requester; and the slip's signer is read from the
slip itself. A requester the program cannot read is refused to everyone. The refusal is
`SOD_VIOLATION`, short for separation of duties, and a retry cannot help.

Two more rules close the same gap from other sides. An agent never approves, even when its slip
names `proposal:approve`. And a control that asks for two CFO approvals counts **people**: the CFO
approving twice is still one, even when her two requests arrive at the same moment.

## Why it matters

- **One person asks and approves.** The control exists so that a payment above 25,000 USD has a
  second pair of eyes. When the asker can also approve, it has one, and the evidence says it had
  two.
- **Asking through the agent.** The CFO signs a slip for the agent, and the agent asks. The CFO is
  still the one asking, through the agent, so she still may not approve it.
- **A quorum of one.** "Two approvals" kept as two rows by the same person is a single opinion
  counted twice.

## What changed since step 29

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_29_approvals ../my_30_who_may_not_approve
```

| File | What |
| --- | --- |
| `src/approvals.ts` | a proposal to approve carries its requester, as it recorded when it was made, or none when that cannot be read; the quorum counts approvers, not rows |
| `src/operations.ts` | §21.9's `whoMayApprove` refuses an approver in the requesting chain, `SOD_VIOLATION`: the subject, the slip's signer read from the slip, or an actor |
| `src/permissions.ts` | the CFO may make a payment, and so there is something she may not approve |
| `src/main.ts` | the CFO pays 31,400.00 USD herself; it waits for the CFO, and her approval is refused |
| `test/who-may-not-approve.test.ts` | new |
| `test/payments.test.ts`, `test/permissions.test.ts`, `test/main.test.ts` | the CFO's new permission, and the demo's new lines |
| every other file step 29 marked | its `NEW IN STEP 29` markers made plain `STEP 29` |

## Run it

```bash
pnpm install
pnpm start
```

After the CFO approves user_123's payment:

```text
The CFO pays 31,400.00 USD herself. It waits for the CFO, and she may not approve it:

cfo_100               PENDING_APPROVAL         dsor://org_456/proposal/prop_39  waits for 1 by CFO (high-value-payment v8)
                                              until 2026-10-23T14:41:46.822Z
cfo_100               SOD_VIOLATION            retry: never                cfo_100 asked for prop_39, and may not approve it
```

The CFO's payment, `prop_39`, waits for the CFO: her own control holds it, as it holds anyone's. Her
approval is refused `SOD_VIOLATION`, retry `never`, and nothing is kept. The end of org_456's log:

```text
210  move   payment.create@1     cfo_100                PROPOSED prop_39        sha256:3725ea1...
211  ALLOW  payment.create@1     cfo_100                PENDING_APPROVAL        sha256:abccf4f...
212  move   payment.create@1     cfo_100                PENDING_APPROVAL prop_39  sha256:db29cd5...
213  move   proposal.approve@1   cfo_100                PROPOSED prop_40        sha256:b07c159...
214  DENY   proposal.approve@1   cfo_100                SOD_VIOLATION           sha256:b7f4b90...
215  move   proposal.approve@1   cfo_100                DENIED prop_40          sha256:0b4a51e...
org_456: 216 records, chain verifies against the head: true
```

Record 214 is the refusal, a DENY, written before the answer left; her approval request's own
proposal, `prop_40`, ends DENIED. `prop_39` keeps waiting for a CFO who did not ask for it. This
story has only one, so it waits until its 72 hours end.

### The database tier

```bash
cp ../my_29_approvals/.env .env     # then dsor_step29 -> dsor_step30 in both lines
pnpm migrate && pnpm test:db
```

This step adds no migration. Run on Neon on 2026-10-20, on `dsor_step30`: 86 passed and 2 skipped,
as step 29's, because this step adds no table and no command; 86 again after the review's fixes.

## Break it

Three, each measured on the full suite in a copy outside the repository. The two questions the
cross-tenant suite cannot ask `proposal.approve` skip there as they do here, and one more test
skips, because the specification is not beside the copy.

### Break 1 · the person who asked may approve

In `src/operations.ts`, in `whoMayApprove`, make the question `subject === principal.id` never true.

```text
      Tests  6 failed | 1288 passed | 3 skipped (1297)
```

The CFO approves her own payment. The step's own test fails, and so do five of the demo's, because
the demo's `SOD_VIOLATION` line becomes `COMMITTED` and the log has an approval where it had a
refusal.

### Break 2 · the slip's signer may approve

Make the question `signer === principal.id` never true.

```text
      Tests  2 failed | 1292 passed | 3 skipped (1297)
```

Two tests fail, and they fail differently. In the first, the agent asked under a slip the CFO
signed, and she is still refused, as the one who asked: the subject the proposal recorded is the
slip's signer, so only the words show the check is gone. In the second, the recorded subject is not
the slip's signer, and she approves. The rule names the signer of the slip, so the slip is what is
read.

### Break 3 · one person counts as two

In `src/approvals.ts`, in `keepApproval`'s statement, count rows: write `count(*)` where it says
`count(DISTINCT given.approver)`.

```text
      Tests  1 failed | 1293 passed | 3 skipped (1297)
```

One test fails, the one that first drops the table's rule of one approval per person and proposal.
While that rule stands, one person cannot have two rows, so counting rows and counting people give
the same answer. The rule is the first lock and the count the second, and each must hold on its own:
a lock that only ever works behind another is never tested.

## Build it yourself with Claude Code

Copy `my_29_approvals` to a new folder, without its `.env`, and ask:

> Start step 30, who may not approve. Before any code: give the CFO the right to pay, and show me
> her approving her own 31,400.00 USD payment. Then ask me the step's decisions one at a time. Then
> build it a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. Where does DSoR read who asked for a proposal: from the approval request, or from the proposal?
   Why?
2. The agent asks under a slip the CFO signed. May the CFO approve it?
3. A control asks for two CFO approvals. The CFO approves twice. What happens?
4. Why is `SOD_VIOLATION` never worth retrying?

<details>
<summary>Answers</summary>

1. From the proposal, as it recorded when it was made. A request could name anyone as the asker
   (`DSOR-SOD-02`).
2. No. She signed the slip the agent asked under, and the rule names a slip's signer, which DSoR
   reads from the slip itself (`DSOR-SOD-02`).
3. The second is refused `CONFLICT`, and the proposal keeps waiting for a second person, even when
   both arrive at once: the approvals are counted as people (`DSOR-SOD-04c`).
4. Who asked does not change. Only a different person can approve.

</details>

## The rules this step meets

- **[DSOR-SOD-01a · L2]** A principal of type `agent` MUST NOT act as an approver.
- **[DSOR-SOD-02 · L2]** Outside owner-approval mode, an approver MUST NOT appear in the requesting
  chain of the proposal: not the subject, not the delegator of any acting agent, not any actor.
- **[DSOR-SOD-04c · L2]** Where a control requires a quorum, the approvals MUST come from distinct
  principals.

**What this step leaves, said plainly.** Owner-approval mode, where a small company lets the owner
approve their own request, is not built, so it is never allowed (§16.2). A payment that waits for
the one person who may not approve it waits until it expires; nothing tells anyone. The CFO's new
`payment:create` has a cost: she can pay up to her control's 25,000 USD line with nobody else
looking, because a slip's limits bind an agent and a person logged in has none, and a slip she signs
can hand that permission to the agent (decision 170). Nothing carries out an APPROVED proposal yet:
step 31.

**Next:** step 31, carrying out an approved proposal, checking the world again first.
