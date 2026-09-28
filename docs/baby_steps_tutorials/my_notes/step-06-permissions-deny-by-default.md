# Step 06 · Permissions, denied by default

Folder: `my_06_permissions_deny_by_default`. Built 2026-09-28. Copy of
`my_05_who_is_calling` plus one new idea: **anything nobody granted is refused.**

Decisions [33 to 35](decisions.md).

> **Status, 2026-09-29: the folder was deleted and is being rebuilt.** It was built in one
> pass and then explained, which is the wrong way round for a learner copy — the point of these
> is to be built a piece at a time with the reasoning out loud. The design below is unchanged,
> because decisions 33 to 35 were the learner's and still stand, and the findings below were
> real. Everything written here in the present tense describes the first build, not a folder
> that exists right now. Tests: 126 in that first build.

## What it does

Each principal carries a **role**. A table says what each role may do, as permission strings
in the specification's `<resource>:<action>` form. Each operation's contract already says which
permission it needs. Before an operation runs, the caller's role is checked against the
contract's permission, and a caller who does not hold it gets `AUTHORIZATION_DENIED`, retry
`never`.

| Who | Role | May read | May issue |
| --- | --- | --- | --- |
| `user_123` | `ap_supervisor` | yes | yes |
| `cfo_100` | `approver` | yes | **no** |
| `accounts-payable-fte` | `ap_worker` | yes | yes |

## Why the step exists

Step 05 stopped a caller pretending to be somebody else and then let whoever they were do
anything at all. Everything the later steps add — approvals, limits, segregation of duties,
delegation — is a refinement of "may you", so without this step there is nothing to refine.

## The part that was already written down

Nothing here invents where the answer comes from. `authorization.permission` has been sitting
in both contracts since step 03, read by nothing:

```json
"authorization": { "permission": "invoice:issue" }
```

That is worth noticing as a property of the design rather than a convenience. The permission
belongs to the *operation*, in its spec sheet, so it can be read without reading code and two
callers cannot disagree about it. The step's only job was to finally look at it.

## What the sweep found

Seventeen mutation runs. Fifteen were valid: fourteen killed, one exposed a guard that did
nothing, and one survives only under a deliberate act.

| Mutation | Outcome |
| --- | --- |
| delete the may-you gate | killed — 4 tests, and `cfo_100` issued the invoice |
| `holds` always true | killed — 8 tests |
| `holds` matches by prefix | killed — and it is step 05's `findPerson` bug again, in a new file |
| an unknown role inherits the supervisor's grants | killed |
| the CFO's role changed to `ap_supervisor` | killed — 6 tests, from one word in a table |
| the roles table handed out unfrozen | killed |
| the refusal names the missing permission | killed |
| the load-time table check removed, count left wrong | killed |
| the load-time table check removed, **correct count hardcoded** | survives — [lesson 12](lessons.md) |
| an empty permission held by everyone | survived, and the guard was **deleted** — see below |

Two more of my mutations were invalid rather than survivors, which is
[lesson 11](lessons.md): one stopped the file loading, and one moved the gate somewhere that
changed nothing observable.

## The guard that did nothing

`holds` began with an explicit refusal of the empty permission:

```ts
if (permission === "") {
  return false;
}
```

Deleting it broke no test. Not a test gap — `includes("")` is already `false`, and the table
check refuses a role that grants an empty string, so no role can ever hold one. The line was
decoration, and decoration inside a security check is worse than nothing: it reads as though
the protection lives there when it lives in two other places. It was deleted and the reason
written where it was.

The **test** stayed, and earned its place: the prefix mutation makes `holds(anyone, "")` return
true, because every string starts with nothing. So the test catches something real; the `if`
never did.

## Limits written down

| Here | Becomes |
| --- | --- |
| roles are in the source, like the people | steps 18 and 19, a role source (`DSOR-IDN-04a`) |
| one role each | a real system gives several |
| two answers, yes and no | step 22 adds `REQUIRE_APPROVAL` (`DSOR-AUT-02a`) |
| one permission per operation, so nothing can conflict | step 14 adds controls, and the strictest wins (`DSOR-AUT-02b`) |
| the creator of a payment could also approve it | step 20, segregation of duties (`DSOR-SOD-01`) — break 3 shows the hole |

## What the order buys

Authority is settled before the arguments are read: who are you → does this operation exist →
may you → are the arguments valid. The reason is in a test. If the address were parsed first,
`cfo_100` could tell `RESOURCE_NOT_FOUND` from `AUTHORIZATION_DENIED` and count invoices she
has no permission to see. Checked first, all six of those attempts are the same refusal.

That is the mechanism `DSOR-ERR-01b` needs, and the rule is still not claimed: it is about a
caller who may not *read*, and all three roles hold `invoice:read`, so there is nobody to test
it with. Claiming it would need a role without that permission.

## What is claimed

`DSOR-AUT-01a` and `DSOR-AUT-01b`, both fully. Step 05's `DSOR-IDN-01` and the "not from the
arguments" half of `DSOR-SRC-02a` still hold. Seven nearby rules are listed as not claimed,
each with the step that brings it.
