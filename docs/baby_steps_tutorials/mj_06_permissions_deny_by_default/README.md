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
nothing else. DSoR keeps both tables itself: which roles each principal has, and which
permissions each role grants.

When a call arrives, DSoR compares the permission the contract needs with the
permissions the caller holds. If they match exactly, the call goes on. If not, it is
refused with `AUTHORIZATION_DENIED`. There is no third answer, and no "allowed because
nobody said no".

Think of office **keycards**. The login token from step 05 is the card. Each operation
is a door. Security decides which doors each card opens. A door installed tomorrow opens
for no card until security programs it. The analogy stops at the card itself: a real
keycard carries its own access, but here the card only says who you are. What it opens
is decided every time, in DSoR's own tables.

## Why it matters

**Allowed unless refused means allowed by accident.** Next month someone adds
`payment.execute`. Suppose DSoR allowed any operation it had not been told to refuse.
`accounts-payable-fte` was set up only to read invoices, but on the day the new
operation appears it could pay VENDOR-44 31,400.00 USD. Nobody refused it, because
nobody thought to. Refusing everything that was not granted is like an electric door
that stays locked when the power fails: when something is missing or unknown, the answer
is no.

**A near miss counts as a miss.** Permissions are compared whole. `invoice:issue` does
not grant `invoice:read`, `invoice:*` is not a permission, and
`invoice:issue.propose` does not grant `invoice:issue`. Every "almost the same" rule
would be one more way to grant something by accident.

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
default answer is no. The principle is **fail closed**: the electric door that stays
locked when the power fails.

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

**Not the outcome of this step.** Approvals, and "the strictest rule wins" (DSOR-AUT-02a
to 02c, step 27). What `.propose` allows (step 23). Which company a call works in
(step 10). An agent's permission slip and its limits (step 18).

**The success signal.** Add a new contract, `invoice.void`, whose permission nobody
holds, and change nothing else. Every caller is denied. The new operation was never
refused by anyone. It was simply never granted.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-AUT-01a | **C1.** Every permission is `<resource>:<action>`, with `.propose` allowed at the end. The role table and every contract are checked against the specification's own pattern at start-up | A role granting `Invoice:Read` or `invoice:*` stops start-up |
| DSOR-AUT-01a | **C2.** A caller holds the permissions of its roles, and only those | Each principal's permissions, worked out from its roles |
| DSOR-AUT-01b | **C3.** A call whose permission the caller does not hold is refused | `AUTHORIZATION_DENIED`, retry `never` |
| DSOR-AUT-01b | **C4.** An operation nobody was granted is denied to everyone | The success signal, `invoice.void` |
| DSOR-AUT-01b | **C5.** The order is: who is calling, then the contract, then the permission, then "is it built" | A reader is denied `invoice.issue`. A holder of `invoice:issue` hears "not built yet" |
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
   holding only the `.propose` form may run the command in `propose_only` mode only,
   and that mode arrives in step 23. Until then, holding only `.propose` means denied.
4. **A principal naming a role that is not in the table stops start-up.** That is a
   typo, and a typo should be found before any caller arrives, not denied quietly at
   2 a.m.
5. **The agent holds one role of its own, `ap_agent`, which grants `invoice:read` and
   nothing else.** §13 warns that without a delegation "the agent would need broad
   permissions of its own". DSOR-DEL-01a asks for a delegation only for a command that
   changes something. So the agent may read with a narrow role of its own, and every
   command waits for its permission slip in step 18. *Downside:* the agent holds a
   permission that no person signed for. It is the smallest one there is, and step 14
   needs it: that step hides sensitive fields from an agent that reads an invoice.
6. **The starting roles.** `accounts-payable-fte`: `ap_agent`, which grants
   `invoice:read`. `user_123`: `ap_supervisor`, which grants `invoice:read` and
   `invoice:issue`. `cfo_100`: `CFO`, which grants `invoice:read`. *Downside:* these are
   not real policy. They are just enough to test both sides of every claim.

### The tests, by claim

- **C1:** start-up is refused for a role granting `Invoice:Read`, `invoice:*`,
  `invoice`, or an empty string, and for a principal naming a role not in the table.
- **C2:** each principal's permissions, worked out from its roles, are exactly the
  table's.
- **C3:** `cfo_100` and `accounts-payable-fte` are each denied `invoice.issue`. The
  refusal is `AUTHORIZATION_DENIED` with retry `never`.
- **C4:** with `invoice.void` added, all three callers are denied it.
- **C5:** `user_123`, who holds `invoice:issue`, hears "not built yet". A reader hears
  `AUTHORIZATION_DENIED`. A caller holding only `invoice:issue.propose` is denied.
- **C6:** `{ "permissions": ["invoice:issue"] }` and `{ "roles": ["ap_supervisor"] }` in
  the input change nothing.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| Q1 | "Is it built" is checked before the permission | C5 | survives |
| Q2 | A permission matches when the one needed starts with it, `startsWith` instead of equality | C5, the `.propose` test | survives |
| Q3 | A role missing from the table is skipped instead of stopping start-up | C1 | survives |
| Q4 | A list of permissions in the input is added to what the caller holds | C6 | survives |

The review also attacks the step with two threats from
[§10.2](../../../specs/dsor/02-security.md#102-threats-and-mitigations): T2, an agent
reaching past its task, which is this step's whole purpose, and T3, an agent used to
reach authority its caller lacks, which waits for delegations in step 18.

The keycard analogy is new. The review checks that it fits and does not mislead.

### Left open, and not this step's idea

- **Approvals, and the strictest answer winning** (DSOR-AUT-02a to 02c): step 27.
- **What `.propose` allows** (`propose_only` mode): step 23.
- **An agent's authority from a person's permission slip**, and its limits: step 18.
- **Roles in more than one company:** step 10.

## What changed since step 05

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

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
2. Only if a role grants `invoice:read` too. Permissions are compared whole, and one
   never implies another. Here `ap_supervisor` grants both, so yes, but not because of
   `invoice:issue`.
3. The `.propose` form allows only `propose_only` mode, which arrives in step 23. It is
   a different permission, and only an exact match grants one.
4. Otherwise every caller hears "not built yet", and a test that a reader "cannot
   issue" passes even with no permission check at all. The test would prove nothing.
5. The agent needs to read invoices before delegations arrive in step 18, and a
   delegation is required only for a command that changes something (DSOR-DEL-01a). So
   the agent gets the smallest permission there is, `invoice:read`, and nothing that
   changes anything.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-AUT-01a | Role-based access control, with permissions in the form `<resource>:<action>` | [§15 Authorization](../../../specs/dsor/02-security.md#15-authorization) | _to be counted_ |
| DSOR-AUT-01b | Any operation for which no permission is granted is denied | [§15](../../../specs/dsor/02-security.md#15-authorization) | _to be counted_ |

**Next:** step 07, the pipeline skeleton.
