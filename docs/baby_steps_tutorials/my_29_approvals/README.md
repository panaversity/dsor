# Step 29 · Approvals

**New in this step:** a person approves a waiting proposal with `proposal.approve`, logged in as
themselves, naming the exact request by its fingerprint; the approval is kept whole, and when every
requirement has its quorum the proposal is APPROVED.

## In plain words

Since step 27, the CFO's control holds user_123's 31,400.00 USD payment at `PENDING_APPROVAL`. It
waits for an approval, and until this step nobody could give one.

Now the CFO can. She logs in to DSoR **herself**, and calls `proposal.approve` with two things: the
proposal's address, `dsor://org_456/proposal/prop_N`, and its **fingerprint**, the payload hash
every receipt for the request carries. A fingerprint is SHA-256 over the request written one exact
way, so she approves *this* request, not one that looks like it:

```text
user_123   payment.create    31,400.00 USD for INV-1008   →  PENDING_APPROVAL, payload_hash sha256:…
cfo_100    proposal.approve  prop_N, the same sha256:…    →  approval apr_1 kept, prop_N APPROVED
```

Four new things make that work:

- **One way to write a request.** JSON can write the same request many ways: fields in another
  order, `4.50` or `4.5`. RFC 8785, the JSON Canonicalization Scheme, picks one. Every command's
  fingerprint is now taken over that text (`src/canonical.ts`).
- **What a proposal waits for, kept.** When a control holds a proposal, its requirements are written
  down then, and never changed: one approval by the CFO, for the CFO's control
  (`dsor.requirements`).
- **The approval, kept whole.** As `approval.schema.json` says it: who, the fingerprint, which
  requirement it satisfies, and when it expires, 72 hours after the proposal started waiting
  (`dsor.approvals`). Added, never changed or removed. When it is the last approval the proposal
  waits for, the same statement moves the proposal to APPROVED and writes that move in the log: all
  three, or none, because `proposal.approve` says it is atomic.
- **Who may approve,** asked at §21.9 before anything is recorded: a person, never an agent and
  never under a slip; the target operation's `approve_permission`, held; a requirement whose role is
  the person's title; a proposal still waiting; and the fingerprint, which must be the stored one.

Nothing carries an APPROVED payment out yet. That is step 31.

## Why it matters

- **A payment waits for good.** Without a way to approve, a control that says "the CFO approves"
  stops every payment above the line forever. A rule nobody can satisfy is a rule people learn to go
  around.
- **Approving one thing, and getting another.** The CFO approves "the payment for INV-1008". If the
  approval named only the proposal, a request changed after she looked would ride on her approval.
  The fingerprint ties her approval to the bytes she saw; any other fingerprint is
  `APPROVAL_MISMATCH`, and nothing is kept.
- **The agent approves for her.** An approval that travels through the requesting agent can be
  forged by it. Only the approver's own login counts, so the agent is refused, whatever its slip
  says.

## What changed since step 28

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_28_where_a_rule_came_from ../my_29_approvals
```

| File | What |
| --- | --- |
| `src/canonical.ts` | new — RFC 8785 canonical JSON, written by hand, because `Object.fromEntries` puts number-like keys first |
| `src/requirements.ts`, `migrations/034_what_a_proposal_waits_for.sql` | new — what a waiting proposal waits for, kept when it starts waiting |
| `src/approvals.ts`, `migrations/035_approvals.sql` | new — an approval, checked against its schema, kept only while its proposal waits and its time has not passed, by the one statement that also moves the proposal to APPROVED when it is the last |
| `src/contracts/proposal.approve.json` | new — the command's contract; `payment.create` names `payment:approve` as its `approve_permission` |
| `src/operations.ts` | the fingerprint over canonical JSON; §21.6 checks the address and fingerprint; §21.9's `whoMayApprove`; the handler, which keeps the approval and moves the proposal to APPROVED |
| `src/people.ts` | each person's title: `cfo_100` is the CFO |
| `src/permissions.ts` | both people may ask `proposal:approve`; only the CFO holds `payment:approve`, which approving a payment needs |
| `src/registry.ts`, `src/classification.ts` | a contract may name an `approve_permission`; an approval's receipt and its labels |
| `src/database.ts` | start-up refuses an application login that could change or remove what a proposal waits for, or an approval |
| `src/main.ts` | the CFO approves with the wrong fingerprint, then the right one |
| `test/canonical.test.ts`, `test/requirements.test.ts`, `test/approvals.test.ts`, `test/approval-review.test.ts` | new |
| `test/support/cross-tenant-suite.ts`, `test/main.test.ts` and other test files | the new operation in every list of operations, the suite's two questions it cannot ask, the demo's new lines, and step 28's markers made plain |

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
                                              until 2026-10-23T14:28:53.241Z
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-916  draft      compensatable
                        withheld: amount (clearance)

Finance publishes version 5 of the policy: payments above 20,000 USD need the CFO.

  the sweep marked high-value-payment v8 stale: it cites version 4, and version 5 is in force
  in cfo_100's inbox: Your control high-value-payment v8 cites version 4 of ksor://org_456/finance/payment-approval-policy, and the version in force is version 5. It is marked stale and is still enforced exactly as it is: review it.
user_123              PENDING_APPROVAL         dsor://org_456/proposal/prop_36  waits for 1 by CFO (high-value-payment v8)
                                              until 2026-10-23T14:28:53.254Z

The CFO approves user_123's payment, by its address and its fingerprint:

cfo_100               APPROVAL_MISMATCH        retry: never                that fingerprint is not the one prop_34 was proposed with, so nothing was approved
cfo_100               COMMITTED                dsor://org_456/approval/apr_1  APPROVED   atomic
```

The control is switched on by its owner, and user_123's 31,400.00 USD payment, `prop_34`, waits for
one approval by the CFO. Her first try names the wrong fingerprint: `APPROVAL_MISMATCH`, and nothing
is kept. Her second names `prop_34`'s own: `COMMITTED`, the approval `apr_1` is kept, and `prop_34`
is `APPROVED`. The end of org_456's log:

```text
201  move   proposal.approve@1   cfo_100                PROPOSED prop_37        sha256:ac6143c...
202  DENY   proposal.approve@1   cfo_100                APPROVAL_MISMATCH       sha256:cb59ca2...
203  move   proposal.approve@1   cfo_100                DENIED prop_37          sha256:cbbffd6...
204  move   proposal.approve@1   cfo_100                PROPOSED prop_38        sha256:6feacf9...
205  ALLOW  proposal.approve@1   cfo_100                ALLOWED                 sha256:d9c3fcd...
206  move   proposal.approve@1   cfo_100                READY prop_38           sha256:b3d7cec...
207  move   proposal.approve@1   cfo_100                EXECUTING prop_38       sha256:28caf3e...
208  move   payment.create@1     cfo_100                APPROVED prop_34        sha256:e068829...
209  move   proposal.approve@1   cfo_100                COMMITTED prop_38       sha256:b13b877...
org_456: 210 records, chain verifies against the head: true
```

`proposal.approve` is a command, so each of the CFO's two requests is a proposal of its own,
`prop_37` and `prop_38`, with its own moves. Record 208 is `prop_34`'s move to APPROVED, in her
name, written by the same statement that kept her approval, while her request was EXECUTING.

### The database tier

```bash
cp ../my_28_where_a_rule_came_from/.env .env     # then dsor_step28 -> dsor_step29 in both lines
pnpm migrate && pnpm test:db
```

`pnpm migrate` applies 034 and 035 on a server that has step 28's thirty-three. Run on Neon on
2026-10-20, on `dsor_step29`: 86 passed and 2 skipped, five more than step 28's 81, because the
cross-tenant suite asks `proposal.approve` five of its questions; the two it skips are the ones it
skips here. 86 again after the review's fixes.

## Break it

Three, each measured on the full suite in a copy outside the repository. The two questions the
cross-tenant suite cannot ask `proposal.approve` skip there as they do here, and one more test
skips, because the specification is not beside the copy.

### Break 1 · the fingerprint is not compared

In `src/operations.ts`, in `whoMayApprove`, make the question `given["payload_hash"] !==
target.payloadHash` never true.

```text
      Tests  3 failed | 1276 passed | 3 skipped (1282)
```

The approval with the wrong fingerprint is kept, in the tests and in the demo: the CFO has approved
a request she never saw. Its fingerprint is the only thing tying her approval to those exact bytes.

### Break 2 · every requirement counts as met

In `src/approvals.ts`, in `keepApproval`'s statement, put `false AND` before `r.quorum > (`, so no
requirement is ever short of its quorum.

```text
      Tests  2 failed | 1277 passed | 3 skipped (1282)
```

The CFO's one approval moves a payment to APPROVED though it also waits for the Treasurer. Every
`REQUIRE_*` must be satisfied, not the first one asked (`DSOR-AUT-02c`).

### Break 3 · the approver's title is not asked

In `whoMayApprove`, make `!requirements.some((r) => r.role === principal.title)` never true.

```text
      Tests  1 failed | 1278 passed | 3 skipped (1282)
```

One test notices: a payment that waits only for the Treasurer is no longer refused to the CFO at
§21.9, before anything is written. Holding `payment:approve` says she may approve payments; the
requirement says whose approval this one waits for.

## Build it yourself with Claude Code

Copy `my_28_where_a_rule_came_from` to a new folder, without its `.env`, and ask:

> Start step 29, approvals. Before any code: show me user_123's payment waiting for the CFO with no
> way to approve it, and an approval that names only the proposal riding over a changed request.
> Then ask me the step's decisions one at a time. Then build it a piece at a time, red first, and
> break each piece on purpose.

## Check yourself

1. Why does an approval name a fingerprint, and not only the proposal?
2. The same request is sent with its fields in another order. Is its fingerprint the same?
3. The agent's slip names `proposal:approve`, and user_123 signed it. May the agent approve?
4. Two controls hold a payment: one asks for the CFO, one for the Treasurer. The CFO approves. What
   state is the proposal in?

<details>
<summary>Answers</summary>

1. So the approval binds to the exact request the approver saw. Another fingerprint is
   `APPROVAL_MISMATCH`, and nothing is kept (`DSOR-APR-09`).
2. Yes. The fingerprint is taken over RFC 8785 canonical JSON, which sorts the keys
   (`DSOR-APR-02b`).
3. No. Only a person logged in as themselves approves, never through an agent (`DSOR-APR-05a`).
4. Still `PENDING_APPROVAL`: every requirement needs its quorum (`DSOR-AUT-02c`).

</details>

## The rules this step meets

- **[DSOR-APR-02a · L2]** An approval MUST validate against `approval.schema.json`.
- **[DSOR-APR-02b · L2]** The payload hash MUST be computed over the RFC 8785 (JCS) canonical JSON
  of the stored input.
- **[DSOR-APR-04a · L2]** An approval MUST expire no later than the ceiling of §44 — here 72 hours
  after the proposal started waiting, inside L2's 30 days. L3 would ask 24 hours of a `CRITICAL`
  operation, and this step has none.
- **[DSOR-APR-05a · L2]** `proposal.approve` MUST be accepted only in `direct` identity mode, from
  an approver authenticated to DSoR under their own credentials — here, the person logged in; no
  real login until step 43.
- **[DSOR-APR-07 · L2]** The permission checked for `proposal.approve` MUST be the
  `approve_permission` of the target operation's contract.
- **[DSOR-APR-09 · L2]** `proposal.approve` MUST be refused with `APPROVAL_MISMATCH` unless the
  `payload_hash` supplied equals the stored proposal's payload hash.
- **[DSOR-AUT-02c · L2]** When several `REQUIRE_*` outcomes apply, all of them MUST be satisfied.

**What this step leaves, said plainly.** Nothing carries out an APPROVED proposal: step 31. Who may
*not* approve, the person who asked among them, is step 30: here the CFO could approve a payment she
asked for herself, if she could ask for one, and she cannot yet. An approval cannot be revoked yet
(`DSOR-APR-04b`). Its time is the proposal's 72 hours, whatever the risk.

**Next:** step 30, `who may not approve`: the person who asked, or who signed the slip the agent
asked under, may not approve it, and a quorum of two is two people.
