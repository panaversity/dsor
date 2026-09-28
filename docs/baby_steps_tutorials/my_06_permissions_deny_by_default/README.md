# Step 06 · Permissions, denied by default

**New in this step:** every call is checked against what the caller may do, and anything
nobody granted is refused.

## Read this first: the roles are in the source

The roles and their permissions are written in `src/permissions.ts`, in the program itself.
A real deployment reads them from a role source — a directory or an identity provider — and
`DSOR-IDN-04a` requires exactly that. Steps 18 and 19 build it.

So nothing here stops somebody editing the file to give themselves a permission. What this
step does build is the part that matters first and is wrong most often in real systems: the
answer to *may you* comes from the operation's own contract and from a role table, never from
the caller and never from the arguments, and the answer is **no** unless somebody said yes.

## In plain words

Step 05 answered *who are you*. This step answers *may you do this*.

A **permission** is a short string in two parts: `<resource>:<action>`. `invoice:read`,
`invoice:issue`, `payment:approve`. Each operation says which one it needs. Each person has a
**role**, and the role says which permissions they hold. Before an operation runs, DSoR asks
whether the caller holds the permission that operation needs. If not, the answer is
`AUTHORIZATION_DENIED`, and trying again will not help.

The important word is **denied**. Not "allowed unless we said no" — **refused unless we said
yes**. That is `DSOR-AUT-01b`, and it is why a permission somebody forgot to grant makes
something stop working, loudly, instead of quietly letting a stranger through.

## Why it matters

`accounts-payable-fte` reads invoices all day. One day the words it is given change — someone
edits a template, or a document it reads contains an instruction that was put there to be
found — and it tries to issue an invoice for 31,400.00 USD.

With step 05 only, that works. The agent is logged in, and being logged in was the only
question anybody asked.

With step 06, the answer depends on something the agent cannot change: whether
`invoice:issue` was granted to its role. What the agent was *told* changed. What it may *do*
did not.

## Where the permission comes from

It was already there. Your contracts have carried it since step 03, and nothing has ever read
it:

```json
"authorization": { "permission": "invoice:read" }     // src/contracts/invoice.get.json
"authorization": { "permission": "invoice:issue" }    // src/contracts/invoice.issue.json
```

So this step does not invent where the answer comes from. Each operation already declares the
permission it needs, in its own spec sheet, next to everything else true about it. The step's
job is to finally **read** it.

That matters more than it sounds. The permission is attached to the *operation*, not decided
by the code that runs it — so a reader can see what `invoice.issue` requires without reading
any code at all, and two operations cannot disagree about it.

### The role in between

```ts
export const ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ap_supervisor: Object.freeze(["invoice:read", "invoice:issue"]),
  approver: Object.freeze(["invoice:read", "payment:approve"]),
  ap_worker: Object.freeze(["invoice:read", "invoice:issue"]),
});
```

| Who | Role | May read | May issue |
| --- | --- | --- | --- |
| `user_123` | `ap_supervisor` | yes | yes |
| `cfo_100` | `approver` | yes | **no** |
| `accounts-payable-fte` | `ap_worker` | yes | yes |

Permissions hang off a **role**, not off a person. That is what the "role-based" in
`DSOR-AUT-01a` means, and it is how it works in a company: a new joiner is given a role, and
changing what a role may do is one edit instead of one per person.

Look at the table again. `cfo_100` is the most senior person in this story and the only one
who cannot issue an invoice. That is not a mistake — a CFO signs payments off, they do not do
accounts-payable data entry. **Permissions are not a ladder.** Beginners reach for seniority
when they design them, and then the CFO can do everything and nobody can explain why.

### A typo fails closed, and that is the danger

Write `INVOICE:READ` in a role and it matches nothing. The role silently grants less than you
meant, and the first sign of trouble is a person who cannot do their job for reasons nobody
can find. Failing closed is the *right* direction — but silence is not.

So the table is checked when the program loads, against the pattern in the specification's own
`common.schema.json`. A typo stops the program instead of taking a permission away. The
pattern is read out of the schema file rather than copied into the code, so the two cannot
drift apart.

## The order grew a third question

```text
step 05:  who are you?  ->  does this operation exist?  ->  are the arguments valid?
step 06:  who are you?  ->  does this operation exist?  ->  MAY YOU?  ->  are the arguments valid?
```

Authority is settled **before** the arguments are read, and that is deliberate. If the address
were read first, `cfo_100` could learn from the error code whether `INV-9999` exists: ask
twice, compare `RESOURCE_NOT_FOUND` against `AUTHORIZATION_DENIED`, and you have a way to
count somebody's invoices without permission to see any of them. Because the permission is
checked first, every one of those attempts is the same refusal, and she learns nothing.

Step 07 turns this order into a written checklist instead of leaving it as the shape of one
function.

## What changed since step 05

```text
my_06_permissions_deny_by_default/
  src/permissions.ts          NEW  the roles, the shape check, and may-you
  test/permissions.test.ts    NEW  11 tests: the table on its own
  test/deny-by-default.test.ts NEW 8 tests: cfo_100 can read and cannot issue
  src/people.ts           CHANGED  every principal carries a role
  src/operations.ts       CHANGED  the may-you gate, after the lookup and before the arguments
  src/main.ts             CHANGED  the CFO reads an invoice, then is refused when she issues it
  test/who-is-calling.test.ts CHANGED two tests issued as cfo_100 and now ask as the agent
  src/login.ts            CHANGED  nothing but a dropped step 05 comment marker
  src/envelopes.ts        CHANGED  markers only
  test/login.test.ts      CHANGED  markers only
  test/operations.test.ts CHANGED  markers only
  package.json            CHANGED  name and description only
```

The change to `test/who-is-calling.test.ts` is worth a moment. Two of its tests issued an
invoice as `cfo_100`. She may not any more, so they ask as the agent instead. Nothing about
what they test changed. **A new gate in front of the program changing which caller a test
needs is exactly what it looks like when permissions start working.**

To see every difference yourself:

```bash
diff -ru --exclude node_modules --exclude pnpm-lock.yaml \
  ../my_05_who_is_calling ../my_06_permissions_deny_by_default
```

## Run it

```bash
pnpm install
pnpm start
pnpm check                 # typecheck, then test. 126 tests pass
```

```text
Hello, accounts-payable-fte.

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

cfo_100               (no envelope)            dsor://org_456/invoice/INV-1009  2500.00 USD  draft
cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue

accounts-payable-fte  COMMITTED                dsor://org_456/invoice/INV-1009  issued

not logged in           (nobody)              AUTHENTICATION_REQUIRED  retry: never                nobody is logged in
nobody by that name     (nobody)              AUTHENTICATION_REQUIRED  retry: never                "nobody" is not someone this program knows
logged in, bad address  user_123              VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"
logged in, no contract  user_123              UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it
denied, real invoice    cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
denied, no such invoice cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
```

Read the middle of that. `cfo_100` reads INV-1009 and is told it is a 2,500.00 USD draft.
Then she asks to issue it and is refused. Then the agent asks to issue **the same invoice, one
line later**, and it works. Nothing about the invoice changed between those two lines. The
only difference is who asked.

And the last two lines are the same refusal twice: once for an invoice that exists, once for
`INV-9999`, which does not. A caller who may not act learns nothing about what is there.

## Break it

Four breaks. Change the code back after each. Every number below was produced by running it.

**1. Delete the may-you check.** In `src/operations.ts`, remove the `holds(...)` block. Run
`pnpm test`:

```text
     × DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries
     × DSOR-AUT-01b: the refusal does not say which permission was missing
     × DSOR-AUT-01b: being refused for authority tells the caller nothing about the data
     × DSOR-AUT-01b: the supervisor may issue, and does
AssertionError: a draft that exists: expected 'CONFLICT' to be 'AUTHORIZATION_DENIED'
      Tests  4 failed | 122 passed (126)
```

Look at the first failure's real meaning: with the gate gone, `cfo_100` **issued INV-1009**.
The last test then failed because the draft she was not allowed to touch had already been
used up.

**2. Say yes to everything.** Make `holds` return `true`. Run `pnpm test`:

```text
      Tests  8 failed | 118 passed (126)
```

Eight, and the useful ones are in `permissions.test.ts`: a role nobody defined now holds
things, a prefix now counts as a match, an empty permission is held by everybody. This is the
break to remember, because "allow while I debug this" is a real thing people type.

**3. Give the CFO the supervisor's role.** One word in `src/people.ts`, `approver` to
`ap_supervisor`. Run `pnpm test`:

```text
     × DSOR-AUT-01b: a principal holds what their role grants, and nothing else
     × DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries
      Tests  6 failed | 120 passed (126)
```

No code was touched. A single word in a table, and the separation between approving a payment
and creating one is gone. In a real company that separation has a name — segregation of
duties — and it is `DSOR-SOD-01`, in step 20.

**4. Match by prefix instead of by whole string.** In `holds`, use
`granted.some((g) => g.startsWith(permission))`. Run `pnpm test`:

```text
     × DSOR-AUT-01b: a permission is matched whole, never by prefix
     × DSOR-AUT-01b: an empty permission is held by nobody
AssertionError: "invoice:i": expected true to be false // Object.is equality
      Tests  2 failed | 124 passed (126)
```

This is step 05's bug wearing different clothes. There, a prefix match in `findPerson` let
`cfo_100_evil` log in as `cfo_100`. Here it means asking for `invoice:i` succeeds — and
asking for `""` succeeds, because every string starts with nothing. **A prefix is not a
match.** Twice now, in two different files.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix. Start from your finished step 05 and ask
for one thing at a time:

> I have finished step 05, where every request has a caller. Now I want step 06 of the DSoR
> baby steps: permissions, denied by default. Read the map's entry for step 06, §15 of the
> specification, and the sentences for `DSOR-AUT-01a` and `DSOR-AUT-01b` in the requirement
> registry. Then look at `src/contracts/invoice.issue.json` and tell me where the permission
> an operation needs is already written down. Do not write code yet — explain what you found
> and what you plan, and ask me who should be allowed to do what.

Then, once you agree on the table:

> Write the failing tests first, titled with the rule ids, and show me them failing. The one
> that matters is the map's "done when": a caller with `invoice:read` can read and cannot
> issue. Then make them pass with the smallest change, and put the may-you check *before* the
> arguments are read — I want to see why that order matters.

## Check yourself

1. Where does the permission an operation needs come from? Why not from the code that runs
   the operation?
2. `cfo_100` is the most senior person in the story and cannot issue an invoice. Is that a
   bug?
3. Why is the may-you check before the arguments are read, and not after?
4. A role grants `INVOICE:READ` by mistake. What happens, and why is the program stopped
   instead of carrying on?
5. Why does the refusal not tell the caller which permission they were missing?
6. Is this step secure?

<details>
<summary>Answers</summary>

1. From the operation's own contract, `authorization.permission`. It has been there since
   step 03. Putting it in the contract means a reader can see what `invoice.issue` requires
   without reading any code, and two pieces of code cannot disagree about it. If the running
   code decided, the answer would live in as many places as there are callers.
2. No. A CFO approves payments; they do not do accounts-payable data entry. Permissions
   describe a job, not a rank. If seniority decided them, the most powerful account in the
   company would be the one most worth stealing.
3. So that being refused tells you nothing about the data. If the address were read first,
   `cfo_100` could compare `RESOURCE_NOT_FOUND` against `AUTHORIZATION_DENIED` and count
   invoices she has no permission to see. Order is part of the guarantee, and it is testable.
4. `INVOICE:READ` matches nothing, so the role silently grants less than its author meant —
   which fails *closed*, the safe direction, but silently. Nobody notices until a person
   cannot do their job. The table is checked against the specification's own pattern when the
   program loads, so the typo stops the program instead.
5. Because a refusal that names what you lacked is a map of the permission model. Ask for
   twenty operations and the refusals draw it for you. The detail belongs in the audit record,
   which step 08 builds, where an operator can read it and a caller cannot.
6. No. The roles live in the source, not in a role source, so `DSOR-IDN-04a` is not met —
   steps 18 and 19. Nothing is authenticated yet either, so a caller can still claim to be
   anyone; step 43 for people and 44 for agents. What *is* real is that the answer to may-you
   cannot be reached from the arguments, and that anything ungranted is refused.

</details>

## The rules this step meets

- **[DSOR-AUT-01a · L1]** DSoR MUST support role-based access control using the
  `<resource>:<action>` permission format.
  ([§15](../../../specs/dsor/02-security.md#15-authorization))
- **[DSOR-AUT-01b · L1]** DSoR MUST deny any operation for which no permission is granted.
  ([§15](../../../specs/dsor/02-security.md#15-authorization))

`DSOR-AUT-01a` is met: permissions hang off roles, and every permission string is checked
against the pattern in `common.schema.json` — the specification's own — when the program
loads. Both halves of the rule, the roles and the format.

`DSOR-AUT-01b` is met: a permission that was never granted is refused, an unknown role holds
nothing, and a permission is matched whole rather than by prefix.

Step 05's two claims still hold: `DSOR-IDN-01`, and the "not from the arguments" half of
`DSOR-SRC-02a`.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-AUT-02a` | Authorization must support `ALLOW`, `DENY` and `REQUIRE_APPROVAL`. There are only two answers here, yes and no. `REQUIRE_APPROVAL` needs a proposal for the approval to attach to, which is step 22. |
| `DSOR-AUT-02b`, `02c` | When several rules apply the strictest wins, and every `REQUIRE_*` must be satisfied. One permission is checked, so nothing can conflict yet. Controls arrive in step 14. |
| `DSOR-IDN-04a`, `04b` | Roles and scopes may only come from an authoritative source. These roles are in the source code. Steps 18 and 19. |
| `DSOR-SOD-01` | Segregation of duties: the person who creates a payment must not approve it. Break 3 shows the hole this rule fills, and the rule needs approvals — step 20. |
| `DSOR-ERR-01b` | An error must not reveal a resource the caller is not authorized to read. The **mechanism** is here and tested: authority is settled before the data is touched, so a denial reveals nothing. The rule is about a caller who may not *read*, and all three roles here hold `invoice:read`, so there is no such caller to test with. It needs a role without it. |
| `DSOR-IDN-02a` | An agent must authenticate with its own credentials. Nothing here authenticates anything. Step 44. |
| `DSOR-SRC-02b` | A principal or tenant in the arguments that *disagrees* with the security context must be an error, not merely ignored. Still ignored. Steps 10 and 11. |

**Next:** step 07, the pipeline skeleton — the three questions this step left as the shape of
one function become a written checklist that later steps add lines to and never reorder.
