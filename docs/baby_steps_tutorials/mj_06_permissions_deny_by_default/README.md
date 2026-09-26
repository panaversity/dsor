# Step 06 · Permissions, denied by default

**New in this step:** what a caller may do comes from its roles, and anything not
granted is refused (DSOR-AUT-01a, DSOR-AUT-01b).

## In plain words

Step 05 found out *who* is calling. This step decides *what they may do*.

A **permission** is a short string in the form `<resource>:<action>`, such as
`invoice:read` or `invoice:issue`. Every operation's contract already names the one it
needs: `invoice.get` needs `invoice:read`, and `invoice.issue` needs `invoice:issue`.

A **role** is a named set of permissions, such as `ap_supervisor`. A principal holds
roles in each company it belongs to, and it holds the permissions of those roles, and
nothing else. In this tutorial, DSoR keeps both tables itself: which roles each
principal has, and which permissions each role grants. A real deployment may also read
a principal's roles from the company directory, or from a trusted login token (§12.1).

When a call arrives, DSoR compares the permission the contract needs with the
permissions the caller holds. The permission check has two answers. If the caller holds
the permission, the call goes on. If not, it is refused with `AUTHORIZATION_DENIED`.
There is no "allowed because nobody said no". In this tutorial, "holds" means the very
same text (decision 2).

Think of office **keycards**. The login token from step 05 is the card, and each
operation is a door. The card holds only a number. Each time you touch a door, it asks
the security desk's list which access groups the card belongs to, and whether one of
them opens this door. An access group is a role. A door installed tomorrow is in no
group's list, so it opens for no card until security adds it. The analogy stops at the
door. Once a door opens, it does not care what you do in the room. DSoR checks every
call, and later steps check more about each one, such as the amount.

## Why it matters

**Allowed unless refused means allowed by accident.** Next month someone adds
`payment.execute`. Suppose DSoR allowed any operation it had not been told to refuse.
`accounts-payable-fte` was set up only to read invoices, but on the day the new
operation appears it could pay VENDOR-44 31,400.00 USD. Nobody refused it, because
nobody thought to. Refusing everything that was not granted is called **deny by
default**. The new operation is safe on its first day, although nobody thought of it.

**Almost the same is not the same.** `invoice:*` is not a permission: the
specification's pattern refuses it. `invoice:issue.propose` does not grant
`invoice:issue` (§7.3). And in this tutorial, permissions are compared whole, so
`invoice:issue` does not grant `invoice:read` either (decision 2). Every "almost the
same" rule would be one more way to grant something by accident.

**Common mistake:** checking permissions only for operations someone thought were
dangerous, and letting the rest through. The dangerous operation is the one added after
the check was written.

## The design, before any code

This section was written before the first test, in a learner session. Every sentence of
the specification it relies on was read on 2026-09-26: §7.3 (the `.propose` suffix),
§12, §13, §13.1, and §15. If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** Step 05 knows who is calling. Step 06 decides what they may do, and the
default answer is no. The principle is **deny by default**: what nobody granted is
refused. When something is missing or broken, such as a role the table does not have or
a contract that names no permission, the answer is no as well: the electric door that
stays locked when the power fails.

**Outcome.** What a caller sees when this step is done:

1. A caller whose roles grant `invoice:read` gets INV-1008.
2. A caller without the permission an operation needs gets `AUTHORIZATION_DENIED`,
   retry `never`.
3. An operation added tomorrow is refused to everyone until someone grants it.
4. The permission needed comes from the operation's contract. What the caller holds
   comes from DSoR's own tables. Neither ever comes from the caller.
5. "Not allowed" and "not built yet" are different answers. A caller without
   `invoice:issue` is denied `invoice.issue`. A caller who holds it hears "not built
   yet".

**Not the outcome of this step.** "The strictest rule wins" (DSOR-AUT-02b, step 27).
Approvals (step 29). What `.propose` allows (step 23). Which company a call works in
(step 10). An agent's permission slip and its limits (step 18).

**The success signal.** Add a new contract, `invoice.void`, whose permission nobody
holds, and change nothing else. Every caller is denied. The new operation was never
refused by anyone. Nobody ever granted it.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-AUT-01a | **C1.** Every permission is `<resource>:<action>`, with `.propose` allowed at the end. The role table and every contract are checked against the specification's own pattern at start-up | A role granting `Invoice:Read` or `invoice:*` stops start-up |
| DSOR-AUT-01a | **C2.** A caller holds the permissions of its roles, and only those | Each principal's permissions, worked out from its roles |
| DSOR-AUT-01b | **C3.** A call whose permission the caller does not hold is refused | `AUTHORIZATION_DENIED`, retry `never` |
| DSOR-AUT-01b | **C4.** An operation nobody was granted is denied to everyone | The success signal, `invoice.void` |
| DSOR-AUT-01b | **C5.** The order is: who is calling, then what the caller sent (step 05), then the contract, then the permission, then "is it built" | A reader is denied `invoice.issue`. A holder of `invoice:issue` hears "not built yet" |
| DSOR-AUT-01b | **C6.** Permissions never come from the caller | A list of permissions in the input changes nothing |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **Roles sit on the principal's membership in `org_456`,** as §12's membership holds
   roles. **The table of what each role grants is a JSON file, `roles.json`, checked at
   start-up,** like step 03's contracts. *Downside:* one more file to load, and one more
   way for start-up to refuse.
2. **Only an exact match grants a permission.** No wildcards and no hierarchy.
   `invoice:issue` does not imply `invoice:read`. *Downside:* a role lists every
   permission it grants, in full. Nothing is implied, so nothing is granted by accident.
3. **`invoice:issue.propose` does not grant `invoice:issue`.** §7.3 says a principal
   holding only the `.propose` form may run the command in `propose_only` mode only. In
   that mode, DSoR prepares the command, and a person releases it later. The mode
   arrives in step 23. Until then, holding only `.propose` means denied. *Downside:*
   until step 23, a caller who holds only the `.propose` form cannot even prepare work.
4. **A principal naming a role that is not in the table stops start-up.** That is a
   typo, and a typo should be found before any caller arrives, not denied quietly at
   2 a.m. *Downside:* one wrong role name stops the program for every caller, not only
   for the principal who holds it.
5. **The agent holds a stand-in role of its own, `ap_agent`, which grants
   `invoice:read` and nothing else.** The specification gives an agent no way to act on
   its own authority. §13.2 has no `direct` mode for an agent, and DSOR-DEL-07 accepts
   an agent that calls alone only under a permission slip, reads included. Both are L2
   rules, and permission slips arrive in step 18. At L1, no rule says how an agent calls
   ([open question 25](../../../research/open-questions.md#found-by-the-baby-steps-added-2026-09-26)).
   This tutorial needs agent reads before step 18: step 14 hides sensitive fields from
   an agent that reads an invoice. So the agent gets the smallest role there is, and
   every command still waits for its permission slip. This tutorial expects step 18 to
   remove the role. *Downside:* the agent holds a permission that no person signed for.
   And anyone who can ask the agent can read what it reads. If the CFO role granted
   nothing, `cfo_100` would be denied INV-1008, and could still get it by asking the
   agent (threat T3, left open).
6. **The starting roles.** `accounts-payable-fte`: `ap_agent`, which grants
   `invoice:read`. `user_123`: `ap_supervisor`, which grants `invoice:read` and
   `invoice:issue`. `cfo_100`: `CFO`, which grants `invoice:read`. *Downside:* these are
   not real policy. They are enough to test both sides of every claim, and no more.

### The tests, by claim

- **C1:** start-up is refused for a role granting `Invoice:Read`, `invoice:*`,
  `invoice`, or an empty string, and for a principal naming a role not in the table.
  It is refused too for a table that is not JSON, and for a role whose permissions are
  not a list. The program itself exits with code 1 and names the problem. A contract
  that needs `Invoice:Read` is refused as well, by step 03's schema check.
- **C2:** each principal's permissions, worked out from its roles, are exactly the
  table's. Only the roles in `org_456` count.
- **C3:** `cfo_100` and `accounts-payable-fte` are each denied `invoice.issue`. The
  refusal is `AUTHORIZATION_DENIED` with retry `never`. Holding `invoice:read` does not
  grant an operation that needs `invoice:read_all`.
- **C4:** with `invoice.void` added, all three callers are denied it.
- **C5:** `user_123`, who holds `invoice:issue`, hears "not built yet". A reader hears
  `AUTHORIZATION_DENIED`. A caller holding only `invoice:issue.propose` is denied.
- **C6:** `{ "permissions": ["invoice:issue"] }` and `{ "roles": ["ap_supervisor"] }` in
  the input change nothing. Neither does a list of permissions in the request envelope,
  beside the token.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| Q1 | "Is it built" is checked before the permission | C5 | survives |
| Q2a | A held permission counts when it starts with the one needed: `held.startsWith(needed)` | C5, the `.propose` test | survives |
| Q2b | A held permission counts when the one needed starts with it: `needed.startsWith(held)` | C3, the `invoice:read_all` test | survives |
| Q3 | A role missing from the table is skipped instead of stopping start-up | C1 | survives |
| Q4 | A list of permissions in the input is added to what the caller holds | C6 | survives |

The review also attacks the step with two threats from
[§10.2](../../../specs/dsor/02-security.md#102-threats-and-mitigations): T2, an agent
reaching past its task, which this step answers for roles, and T3, an agent used to
reach authority its caller lacks, which waits for delegations in step 18.

The keycard analogy is new. The review checks that it fits and does not mislead.

### Left open, and not this step's idea

- **The strictest answer winning** (DSOR-AUT-02b): step 27. **Approvals:** step 29.
  DSOR-AUT-02a and DSOR-AUT-02c are in no step of the map yet.
- **What `.propose` allows** (`propose_only` mode): step 23.
- **An agent's authority from a person's permission slip**, and its limits: step 18.
- **Roles in more than one company:** step 10.

## What changed since step 05

```text
roles.json                     NEW: what each role grants (decision 6)
src/permissions.ts             NEW: readRoles() reads the role table, and checkRoles()
                               checks it and every role a principal holds.
                               permissionsOf() works out what a caller holds, and
                               checkPermission() denies a call whose permission the
                               caller does not hold
src/registry.ts                changed: buildRegistry() takes the role table and names
                               its problems with the contracts' problems. call() checks
                               the permission after the contract, before "is it built"
src/principals.ts              changed: the agent holds ap_agent (decision 5)
src/main.ts                    changed: reads roles.json (a second argument names
                               another file), and shows the agent denied invoice.issue
                               and user_123 hearing "not built yet"
test/permissions.test.ts       NEW: what a caller may do (C1 to C6)
test/helpers.ts                changed: the shipped role table, the starting roles typed
                               out again, the denial's message, and the table of
                               refusals: the agent is denied invoice.issue, and user_123
                               now makes the two "not built yet" calls
test/who-is-calling.test.ts    changed: the agent holds ap_agent
test/registry.test.ts,         changed: every registry is built with the role table,
test/contract.test.ts,         and the calls that expect "not built yet" are made by
test/call.test.ts              user_123
test/startup.test.ts           changed: the program shows the denial, and refuses to
                               start with a broken role table
src/, test/                    step 05's NEW IN STEP markers are now plain comments
```

There is no new dependency.

Every new region is marked `NEW IN STEP 06`. To see the whole diff, run this from
`docs/baby_steps_tutorials`. `roles.json` is new, beside `contracts/`:

```bash
git diff --no-index mj_05_who_is_calling/src mj_06_permissions_deny_by_default/src
git diff --no-index mj_05_who_is_calling/test mj_06_permissions_deny_by_default/test
```

Three choices in the code are worth a look:

- **The permission is checked after the contract, and before "is it built".** The
  contract names the permission, so DSoR finds the contract first. "Is it built" comes
  after, so a caller who may not issue hears "denied", never "not built yet".
- **Only the same text grants a permission.** `permissionsOf()` returns the set of what
  the caller holds, and `checkPermission()` asks whether the set has the exact
  permission the contract needs. There is no `startsWith` and no wildcard. So
  `invoice:read` never grants `invoice:read_all`, and `invoice:issue.propose` never
  grants `invoice:issue`.
- **The role table is checked with the contracts.** `buildRegistry()` names every
  problem at once: a broken contract, a role granting `invoice:*`, and a principal
  holding a role that the table does not have. The type of each permission is checked
  before its pattern, because a pattern test turns the list `["invoice:read"]` into the
  text `"invoice:read"`.

## Run it

From the root of the dsor repository:

```bash
cd docs/baby_steps_tutorials/mj_06_permissions_deny_by_default
pnpm install
pnpm start
```

```text
$ node src/main.ts
operations: [ 'invoice.get', 'invoice.issue' ]
{
  data: {
    id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    amount: { value: '31400.00', currency: 'USD' },
    open_amount: { value: '31400.00', currency: 'USD' },
    status: 'issued'
  },
  correlation: {
    request_id: 'req_2e379a5c-cb9f-45d3-93a8-ad3d6feee515',
    agent_id: 'accounts-payable-fte'
  }
}
dsor://org_456/invoice/INV-1008
{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }
{
  code: 'RESOURCE_NOT_FOUND',
  message: 'no invoice "INV-9999"',
  retry: 'never',
  correlation: {
    request_id: 'req_45c5d0c8-43ad-4a6f-b160-fb9e1cfc1d91',
    agent_id: 'accounts-payable-fte'
  }
}
{
  code: 'AUTHORIZATION_DENIED',
  message: '"invoice.issue" needs invoice:issue, which the caller does not hold',
  retry: 'never',
  correlation: {
    request_id: 'req_8ed975c0-4708-4f16-83b2-5834daeed1e4',
    agent_id: 'accounts-payable-fte'
  }
}
{
  code: 'AUTHENTICATION_REQUIRED',
  message: 'log in first: the call has no login token that DSoR gave',
  retry: 'never',
  correlation: { request_id: 'req_44be9dcb-d2b1-4798-919c-00d3fcf0d29d' }
}
{
  code: 'AUTHORIZATION_DENIED',
  message: 'the arguments name someone other than the caller, in principal',
  retry: 'never',
  correlation: {
    request_id: 'req_909efdc3-aa84-4abe-8be4-9d64f7232b30',
    agent_id: 'accounts-payable-fte'
  }
}
{ request_id: 'ap-desk-7', principal_id: 'user_123' }
{
  code: 'UNSUPPORTED_CAPABILITY',
  message: '"invoice.issue" is not built yet',
  retry: 'never',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
```

Compare the second refusal with the last one. The agent and user_123 asked for the same
operation, `invoice.issue`. The agent was denied, because its one role, `ap_agent`,
grants `invoice:read` and nothing else. user_123 holds `invoice:issue`, so the call got
one check further, and heard that `invoice.issue` is not built yet. Your request ids
will be different.

The success signal from the design is a test. It adds `invoice.void`, which no role
grants, and changes nothing else. Run it on its own:

```bash
pnpm test -t "invoice.void"
```

```text
 Test Files  1 passed | 10 skipped (11)
      Tests  3 passed | 347 skipped (350)
```

All three callers are denied `invoice.void`. Nobody wrote a rule against it.

`pnpm check` runs the type check, then 350 tests:

```text
 Test Files  11 passed (11)
      Tests  350 passed (350)
```

Outside the dsor repository, the three tests that compare the schema copies have no
original to compare with, so they are skipped: `347 passed | 3 skipped`.

## Break it

**Check only what looks dangerous.** This is the common mistake from "Why it matters".
In `src/registry.ts`, find the permission check:

```ts
    checkPermission(caller, contract, registry.roles);
```

Change it so that it checks only the one operation that looks dangerous today:

```ts
    if (name === "invoice.issue") checkPermission(caller, contract, registry.roles);
```

Run `pnpm start`. The output is the same as before, apart from the request ids. The
agent is still denied `invoice.issue`. Nothing looks wrong.

Run `pnpm test`. These are the lines that matter, and "…" marks what is left out:

```text
…
 FAIL  test/permissions.test.ts > C4: an operation nobody was granted is denied to everyone > DSOR-AUT-01b: accounts-payable-fte is denied vendor.get, new code no role grants, and the code never runs
AssertionError: expected { data: { id: 'VENDOR-44' }, …(1) } to strictly equal { code: 'AUTHORIZATION_DENIED', …(3) }

- Expected
+ Received

  {
-   "code": "AUTHORIZATION_DENIED",
    "correlation": {
      "agent_id": "accounts-payable-fte",
      "request_id": "req_78936b13-8af9-47a9-a799-f0a59338fa6f",
    },
-   "message": "\"vendor.get\" needs vendor:read, which the caller does not hold",
-   "retry": "never",
+   "data": {
+     "id": "VENDOR-44",
+   },
  }
…
      Tests  9 failed | 341 passed (350)
```

`vendor.get` is a new operation with code, added after the check was written. Nobody
granted `vendor:read`. Still, the agent's call ran the code and got `VENDOR-44` back.
The same happened for user_123 and cfo_100. `invoice.void` was not denied either: its
callers heard "not built yet". Three C3 tests failed too, where a test changes a
contract or the role table. Look at what did not fail: every test about
`invoice.issue`. The check still guards the one operation it names. Put the line back,
and `pnpm check` is green again.

## Build it yourself with Claude Code

This is how the step was built. Each row is one commit or more:

| # | Move | What you do |
|---|---|---|
| 1 | Copy | Copy your step 05. Change the name and the description in `package.json` |
| 2 | Design first | Write "In plain words", "Why it matters", and "The design, before any code": the intent and the outcome, the rules split into claims, the decisions the spec leaves to you, and the breaks you predict |
| 3 | Check the design | Read §7.3, §12, §13, §15, §21, and §28 again, and the permission pattern in `common.schema.json`. Fix the design where they say it is wrong |
| 4 | Red | Write the tests, one group per claim. Predict which pass before any code, then watch every one fail for the right reason |
| 5 | Green | One commit per rule: DSOR-AUT-01a, then DSOR-AUT-01b |
| 6 | Break it | Run every predicted break. Compare the results with your predictions |
| 7 | Review | A reviewer who has not seen your conversation attacks the step. Fix what it finds |

The tests were written all at once, so they turn green one rule at a time. In the red
run, 43 tests fail. After the first green commit, 18 still fail. After the second, none.
Move 3 split one predicted break in two, and added a test. Move 4 showed 8 of the 48 new
tests passing before any code. All of this is under "Think it through".

Build your own step 06 from a copy of your step 05. From `docs/baby_steps_tutorials`:

```bash
cp -R my_05_who_is_calling my_06_permissions_deny_by_default
cd my_06_permissions_deny_by_default
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 06. Design first: the intent and
the outcome, then the rules split into claims, and I predict which breaks survive. Then
check the design against §7.3, §15, and the permission pattern in common.schema.json.
Three questions to settle with me: where does the table of what each role grants live?
Does one permission ever grant another? What may the agent do before it has a
permission slip?
```

When `pnpm check` is green in your folder, and once the official step 06 exists:

```text
Now compare this folder with ../06_permissions_deny_by_default. Explain every
difference, and tell me which ones matter and why.
```

## Check yourself

1. Someone adds `payment.execute` next month. Why is it safe on that day even though
   nobody wrote a rule about it?
2. `user_123` holds `invoice:issue`. May `user_123` read INV-1008 because of it?
3. A caller holds only `invoice:issue.propose`. Why is `invoice.issue` refused?
4. Why must the permission check come before the check for "not built yet"?
5. Why does the agent hold a role of its own at all, when §13 says an agent's power
   should come from a person's permission slip?

<details>
<summary>Answers</summary>

1. Nobody holds `payment:execute`. An operation is refused unless a role grants its
   permission, so a new operation is refused to everyone until someone grants it.
2. Only if a role grants `invoice:read` too. In this tutorial, permissions are compared
   whole, and one never implies another (decision 2). Here `ap_supervisor` grants both,
   so yes, but not because of `invoice:issue`.
3. The `.propose` form allows only `propose_only` mode, which arrives in step 23 (§7.3).
   It is a different permission, and in this tutorial only the very same text grants
   one (decision 2).
4. Otherwise every caller hears "not built yet", and a test that a reader "cannot
   issue" passes even with no permission check at all. The test would prove nothing.
5. It is a stand-in. The agent must read invoices before permission slips arrive in
   step 18: step 14 hides sensitive fields from an agent that reads one. The
   specification's ways for an agent to call are L2 rules, and at L1 none applies (open
   question 25). So this tutorial gives the agent the smallest permission there is,
   `invoice:read`, and nothing that changes anything. Step 18 should take it away.

</details>

## Think it through

### Found before the first test

- **Q2 described one break and expected another's test to catch it.** Q2 first said "a
  permission matches when the one needed starts with it", which is
  `needed.startsWith(held)`. The `.propose` test cannot catch that break:
  `invoice:issue` does not start with `invoice:issue.propose`, so the caller is still
  denied. That test catches only the other direction. So Q2 is now two breaks, Q2a and
  Q2b, and C3 gained a test for decision 2: holding `invoice:read` does not grant an
  operation that needs `invoice:read_all`. The learner's prediction, "survives", was
  made before the split. It stands for both.

### Found by the red run

- **8 of the 48 new tests passed before any code.** Six are in the new test file: the
  three forms a role may grant, a contract that needs `Invoice:Read` (step 03's schema
  check already refuses it), user_123 hearing "not built yet", and an empty list of
  permissions that takes nothing away. The other two are the new refusal row's tests
  that look only at the request id and at not throwing. The learner predicted more
  than 10.
- **Two "no" tests that the learner expected to pass failed, as they must.** The CFO
  holding only `invoice:issue.propose`, and the agent sending its own list of
  permissions, both came back "not built yet". Nothing checked permissions yet, so the
  call went on to the next check. A "no" test passes only once the code that says no
  exists.
- **The first green commit did not turn C4 green.** Working out what a caller holds
  (DSOR-AUT-01a) is not checking it (DSOR-AUT-01b). The learner expected C4 to pass
  after the first commit, and the program with a broken role table to wait. It was the
  other way round. `main.ts` already calls `buildRegistry()`, so the program refused
  the broken table as soon as `buildRegistry()` did.

### The breaks, run

| # | The break | Caught by | Learner's prediction |
| --- | --- | --- | --- |
| Q1 | "Is it built" is checked before the permission | 12 tests | survives |
| Q2a | `held.startsWith(needed)` | 1 test: the `.propose` test | survives |
| Q2b | `needed.startsWith(held)` | 1 test: the `invoice:read_all` test | survives |
| Q3 | A role missing from the table is skipped | 3 tests | survives |
| Q4 | A permission listed in the input counts as held | 1 test: C6's input test | survives |
| Break it | Only `invoice.issue` is checked | 9 tests | not sure |

Every break was caught. The learner predicted that each one would survive. Each break
turns a "no" into a "yes", and the tests written for its claim expect the "no". Three
breaks are caught by one test each. Q2b's test exists only because the design check
split Q2 in two.

_The review's findings, and what is left open, are written after the review._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-AUT-01a | Role-based access control, with permissions in the form `<resource>:<action>` | [§15 Authorization](../../../specs/dsor/02-security.md#15-authorization) | _to be counted_ |
| DSOR-AUT-01b | Any operation for which no permission is granted is denied | [§15](../../../specs/dsor/02-security.md#15-authorization) | _to be counted_ |

**Next:** step 07, the pipeline skeleton.
