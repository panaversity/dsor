# Step 06 · Permissions, denied by default

Folder: `my_06_permissions_deny_by_default`. Built 2026-09-28, deleted, and rebuilt 2026-09-29 a
piece at a time with the learner. Copy of `my_05_who_is_calling` plus one new idea: **anything
nobody granted is refused.**

Decisions [33 to 37](decisions.md). Tests: 130.

## What it does

Each principal carries a **role**. A table says what each role may do, as permission strings in
the specification's `<resource>:<action>` form. Each operation's contract already says which
permission it needs. Before an operation runs, the caller's role is checked against the
contract's permission, and a caller who does not hold it gets `AUTHORIZATION_DENIED`, retry
`never`.

| Who | Role | May read | May issue |
| --- | --- | --- | --- |
| `user_123` | `ap_supervisor` | yes | yes |
| `cfo_100` | `approver` | yes | **no** |
| `accounts-payable-fte` | `ap_worker` | yes | yes |

## Why the step exists

Step 05 stopped a caller pretending to be somebody else, and then let whoever they were do
anything at all. Everything the later steps add — approvals, limits, segregation of duties,
delegation — is a refinement of "may you", so without this step there is nothing to refine.

## Built twice, on purpose

The first build was finished in one pass and explained afterwards. The learner deleted it: a
learner copy that arrives finished teaches nothing, because the reasoning is the product. The
rebuild went in five pieces, each committed on its own and each verified by breaking it:

| Piece | Tests | What it added |
| --- | --- | --- |
| 1 | 112 | the roles table and `holds`, with no gate — the data and the question, testable alone |
| 2 | 120 | the gate, placed before the arguments are read |
| 3 | 126 | the start-up check that turns a typo in the table into a stop |
| 4 | 130 | what a hostile review found |
| 5 | 130 | the README, with every break re-run |

The rebuild ended up **better**, not merely slower: 130 tests against 126, and three real defects
found that the first build shipped. The reason is not that the second attempt was more careful —
it is that piece 1 was testable on its own, so `holds` was attacked before anything depended on
it. See [decision 38](decisions.md).

## The part that was already written down

Nothing here invents where the answer comes from. `authorization.permission` has been sitting in
both contracts since step 03, read by nothing:

```json
"authorization": { "permission": "invoice:issue" }
```

That is a property of the design, not a convenience. The permission belongs to the *operation*,
in its spec sheet, so it can be read without reading code and two callers cannot disagree about
it.

## What the review found that every sweep missed

`pnpm check` was green at 126 and every guard had been mutated one at a time. Four independent
reviewers, each in its own copy, then a refuting reviewer per dimension: **ten findings
confirmed, three refuted.** Every one was reproduced by hand before anything changed.

Three were real defects:

| Defect | Why the sweep missed it |
| --- | --- |
| `permissionsOf` walked the prototype chain, so a role named `toString` returned a **function** and `holds` threw; `Object.prototype` pollution granted anything | the sweep mutates guards that exist. `Object.hasOwn` was a guard that did not exist. [Decision 36](decisions.md) |
| **Nothing pinned where the gate's permission came from.** Reading a `permission` out of the caller's arguments let `cfo_100` issue the invoice with all 126 tests green | step 05's rule was tested for *identity* and never for *authorization*. No mutation of existing code reveals a missing rule |
| a login or an argument whose property is a **throwing getter** reached the caller as `Error: boom`, where `src/operations.ts` promises an envelope | nothing in the suite passed an object that throws when read. [Decision 37](decisions.md) |

Two were guards with no test behind them: the shared empty list for an unknown role, and the
denial's freeze. Two were tests that proved less than they looked — the unknown-role test picked
five names that all avoided the only failing class, and "a denial says who was denied" compared
against the literal `"cfo_100"` instead of the login's own name. That last one is
[lesson 10](lessons.md), written by me, repeated by me, four days later.

## Limits written down

| Here | Becomes |
| --- | --- |
| roles are in the source, like the people | steps 18 and 19, a role source (`DSOR-IDN-04a`) |
| one role each | a real system gives several |
| two answers, yes and no | step 22 adds `REQUIRE_APPROVAL` (`DSOR-AUT-02a`) |
| one permission per operation, so nothing can conflict | step 27 adds controls in CEL, and the strictest wins (`DSOR-AUT-02b`) |
| whoever creates a payment could also approve it | step 30, segregation of duties (`DSOR-SOD-01a`) — break 3 shows the hole |
| deleting the start-up check and hardcoding its count still passes | only a child process could close it; written in the code |

## What the order buys

Who are you → does this operation exist → **may you** → are the arguments valid.

The reason is in a test. If the address were parsed first, `cfo_100` could tell
`RESOURCE_NOT_FOUND` from `AUTHORIZATION_DENIED` and count invoices she has no permission to see.
Checked first, all seven attempts return one identical refusal, and the test asserts the set of
*messages* has size one so the wording cannot be compared either.

That is the mechanism `DSOR-ERR-01b` needs, and the rule is still not claimed: it is about a
caller who may not *read*, and all three roles hold `invoice:read`, so there is nobody to test it
with.

## What is claimed

`DSOR-AUT-01a` and `DSOR-AUT-01b`, both fully. Step 05's `DSOR-IDN-01` still holds, and the "not
from the arguments" half of `DSOR-SRC-02a` is now **extended**: who you are never came from the
arguments, and neither does what you may do. Seven nearby rules are listed as not claimed, each
with the step that brings it.
