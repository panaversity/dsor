# Step 06 · Permissions, denied by default

**New in this step:** every call is checked against what the caller may do, and anything nobody
granted is refused.

## Read this first: the roles are in the source

The roles and their permissions are written in `src/permissions.ts`, in the program itself. A
real deployment reads them from a role source — a directory or an identity provider — and
`DSOR-IDN-04a` requires exactly that. Steps 18 and 19 build it.

So nothing here stops somebody editing that file to grant themselves a permission. What this
step does build is the part that matters first and goes wrong most often: the answer to *may
you* comes from the operation's own contract and from a role table, never from the caller and
never from the arguments — and the answer is **no** unless somebody said yes.

## In plain words

Step 05 answered *who are you*. This step answers *may you do this*.

A **permission** is a short string in two parts: `<resource>:<action>`. `invoice:read`,
`invoice:issue`, `payment:approve`. Each operation says which one it needs. Each person has a
**role**, and the role says which permissions they hold. Before an operation runs, DSoR asks
whether the caller holds the permission that operation needs. If not, the answer is
`AUTHORIZATION_DENIED`, and trying again will not help.

The important word is **denied**. Not "allowed unless we said no" — **refused unless we said
yes**. That is `DSOR-AUT-01b`, and it is why a grant somebody forgot makes a thing stop working
loudly, instead of quietly letting a stranger through.

## Why it matters

`accounts-payable-fte` reads invoices all day. One day the words it is given change — someone
edits a template, or a document it reads contains an instruction put there to be found — and it
tries to issue an invoice for 31,400.00 USD.

With step 05 only, that works. The agent is logged in, and being logged in was the only question
anybody asked.

With step 06, the answer depends on something the agent cannot change: whether `invoice:issue`
was granted to its role. What the agent was *told* changed. What it may *do* did not.

## Where the permission comes from

It was already written down. Your contracts have carried it since step 03, and nothing ever read
it:

```json
"authorization": { "permission": "invoice:read" }     // src/contracts/invoice.get.json
"authorization": { "permission": "invoice:issue" }    // src/contracts/invoice.issue.json
```

So this step does not invent where the answer lives. Each operation already declares the
permission it needs, in its own spec sheet, beside everything else true about it. The step's job
is to finally **read** it.

That matters more than it sounds. The permission belongs to the *operation*, not to the code
that runs it, so a reader can see what `invoice.issue` requires without reading any code — and
two callers cannot disagree about it.

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
changing what a job may do is one edit instead of one per person.

Be honest about what this small table shows, though. Three people, three roles, and two of those
roles grant the same two permissions — so the saving is invisible here and you have to take it on
trust. It becomes real the moment there are five people in accounts payable: five `ap_worker`s,
and one line to change when the job changes. The shape is right before it is useful, which is the
only time you can still choose it cheaply.

Look at the table again. `cfo_100` is the most senior person in this story and the only one who
cannot issue an invoice. That is not a mistake — a CFO signs payments off, they do not do
accounts-payable data entry. **Permissions are not a ladder.** Design them by rank and the most
powerful account in the company becomes the one most worth stealing.

### A typo fails closed, and that is the danger

Write `INVOICE:READ` in a role and it matches nothing. The role silently grants less than you
meant, and the first sign of trouble is a person who cannot do their job for reasons nobody can
find. Failing closed is the *right* direction — silence is not.

So the table is checked when the program loads, against the pattern in the specification's own
`common.schema.json`. A typo stops the program instead of taking a permission away:

```text
TypeError: ap_worker grants "INVOICE:READ", which is not <resource>:<action>
```

The pattern is read out of the schema file rather than copied into the code, so the two cannot
drift. Writing `/^[a-z]+:[a-z]+$/` by hand would be shorter and wrong: it refuses
`payment:execute.propose`, which the specification allows.

## The order grew a third question

```text
step 05:  who are you?  ->  does this operation exist?  ->  are the arguments valid?
step 06:  who are you?  ->  does this operation exist?  ->  MAY YOU?  ->  are the arguments valid?
```

Authority is settled **before** the arguments are read, and that is deliberate. If the address
were read first, `cfo_100` could learn from the error code whether `INV-9999` exists: ask about
two invoices, compare `RESOURCE_NOT_FOUND` against `AUTHORIZATION_DENIED`, and she has a way to
count records she has no permission to see. Because the permission is checked first, every one of
those attempts is the same refusal — the same *words*, which a test pins — and she learns
nothing.

Step 07 turns this order into a written checklist instead of leaving it as the shape of one
function.

## What changed since step 05

```text
my_06_permissions_deny_by_default/
  src/permissions.ts           NEW  the roles, the shape check, and may-you
  test/permissions.test.ts     NEW  12 tests: the table on its own
  test/deny-by-default.test.ts NEW  10 tests: cfo_100 can read and cannot issue
  test/main.test.ts        CHANGED  rewritten, 5 tests to 7: reads the "Run it" block out of this README; two tests watch the CFO's lines
  src/people.ts            CHANGED  every principal carries a role
  src/operations.ts        CHANGED  the may-you gate, after the lookup and before the arguments
  src/login.ts             CHANGED  step 05's NEW IN STEP marker removed and one comment reworded, nothing else
  src/main.ts              CHANGED  the CFO reads an invoice, then is refused when she issues it
  test/who-is-calling.test.ts CHANGED two tests issued as cfo_100 and now ask as the agent; one new test, no login and a planted principal
  package.json             CHANGED  name and description only
  src/envelopes.ts         CHANGED  step 05's NEW IN STEP markers removed, nothing else
  test/login.test.ts       CHANGED  one wrong rule id in a title, and the markers
  test/operations.test.ts  CHANGED  one comment that contradicted its own title, and the markers
  test/arguments.test.ts   CHANGED  one comment reworded; no title changed
  test/registry.test.ts    CHANGED  two wrong rule ids dropped from titles
  test/invoice.test.ts     CHANGED  one wrong rule id in a title
```

The test change to `who-is-calling.test.ts` is worth a moment. Two of its tests issued an invoice
as `cfo_100`. She may not any more, so they ask as the agent instead. Nothing about what they
test changed. **A new gate in front of the program changing which caller a test needs is exactly
what it looks like when permissions start working.** If adding permissions had broken nothing,
nothing was being checked.

The "wrong rule id" changes are the other kind. Every test title here starts with the id of the
rule it proves, and that title is how this project counts coverage — so an id on a test that does
not prove that rule's own sentence is a wrong number, not a cosmetic slip. Four titles in
inherited tests were corrected in this step, each with a comment beside it saying which sentence
was read and why the id moved:

- **One moved from `DSOR-IDN-01` to `DSOR-COR-01b`** (`test/login.test.ts`). It asserts that a
  refused login's envelope got a generated request id; IDN-01 is about normalizing a caller into
  a principal with a type and memberships, and a refused login has no principal to assert
  anything about.
- **One lost `DSOR-MON-01`** (`test/invoice.test.ts`). It asserts only that an invoice is frozen,
  and says nothing about an amount being a money object. A test that proves no rule and claims
  none is a correct answer, not a gap.
- **Two lost `DSOR-OPR-02b`** (`test/registry.test.ts`). Both assert that a loaded contract is
  frozen all the way down; 02b is "the registry MUST NOT infer a default for risk level,
  execution semantics, effect, or idempotency", and a registry that filled every one of those in
  and then froze the result would pass both unchanged.

Five more titles were corrected inside this step's own new files, so they do not show in the
diff against step 05: they **moved from `DSOR-AUT-01b` to `DSOR-AUT-01a`**, and the comments
beside them in `test/deny-by-default.test.ts` and `test/permissions.test.ts` say why. 01b is one
sentence — "MUST deny any operation for which no permission is granted" — and all five showed a
caller being *allowed*. That is 01a's sentence, "role-based access control using the
`<resource>:<action>` permission format". The step needs both halves, because a program that
denied everything would satisfy 01b's words and be useless.

To see every difference yourself:

```bash
cd docs/baby_steps_tutorials
diff -ru --exclude node_modules --exclude pnpm-lock.yaml \
  my_05_who_is_calling my_06_permissions_deny_by_default
```

## Run it

```bash
cd docs/baby_steps_tutorials/my_06_permissions_deny_by_default
pnpm install
pnpm start
pnpm check                 # typecheck, then test. 157 tests pass
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

Read the middle of that. `cfo_100` reads INV-1009 and is told it is a 2,500.00 USD draft. She
asks to issue it and is refused. Then the agent issues **the same invoice, one line later**, and
it works. Nothing about the invoice changed between those two lines. The only difference is who
asked.

And the last two lines are the same refusal twice: once for an invoice that exists, once for
`INV-9999`, which does not. A caller who may not act learns nothing about what is there.

That block is not a transcript somebody pasted and hoped stayed true. `test/main.test.ts` runs
the real program as a subprocess, reads those lines back out of **this file**, and compares them
character for character, so the program and the README cannot drift apart. It then asserts the
three claims above separately, because a block that matches proves only that the README is
honest — not that the lines mean what the prose says they mean.

## Break it

Five breaks. Change the code back after each. Every number below was produced by running it.

**1. Delete the may-you gate.** In `src/operations.ts`, remove the `holds(...)` block. Run
`pnpm test`:

```text
     × DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries
     × DSOR-AUT-01b: the refusal does not say which permission was missing
     × DSOR-SRC-02a: the permission comes from the contract, never from the arguments
     × DSOR-AUT-01b: being refused for authority tells the caller nothing about the data
     × DSOR-AUT-01a: the supervisor may issue, and does
     × prints exactly the output the README pastes
     × DSOR-AUT-01b: the CFO is refused the invoice the agent issues one line later
     × DSOR-AUT-01b: a denied caller cannot tell a real invoice from one that does not exist
AssertionError: expected 'INV-1009 is issued, and only a draft …' to contain 'cfo_100'
AssertionError: expected 'cfo_100               COMMITTED      …' to contain 'AUTHORIZATION_DENIED'
      Tests  8 failed | 149 passed (157)
```

Read that first assertion carefully. With the gate gone, `cfo_100` **issued INV-1009**. The
`supervisor may issue` test then failed because the draft she was never allowed to touch had
already been used up.

The last three are the demo program, run for real. `cfo_100  COMMITTED` is the line a learner
would have seen on their screen while every other test stayed green, until `test/main.test.ts`
existed.

One note on doing this break by hand: deleting the block leaves the `holds` import unused, so
`pnpm typecheck` stops with `error TS6133: 'holds' is declared but its value is never read`.
`pnpm test` does not typecheck, so it still runs — delete the import too if you want `pnpm check`.

**2. Say yes to everything.** Make `holds` return `true`. Run `pnpm test`:

```text
      Tests  12 failed | 145 passed (157)
```

Twelve. The useful ones are in `permissions.test.ts`: a role nobody defined now holds things, a
prefix now counts as a match, an empty permission is held by everybody. Remember this break,
because "just allow it while I debug" is a real thing people type.

**3. Give the CFO the supervisor's role.** One word in `src/people.ts`, `approver` to
`ap_supervisor`. Run `pnpm test`:

```text
     × DSOR-AUT-01b: a principal holds what their role grants, and nothing else
     × the table of roles cannot be edited after it is handed out
     × DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries
     × DSOR-AUT-01b: the refusal does not say which permission was missing
     × DSOR-SRC-02a: the permission comes from the contract, never from the arguments
     × DSOR-AUT-01b: being refused for authority tells the caller nothing about the data
     × DSOR-AUT-01a: the supervisor may issue, and does
     × prints exactly the output the README pastes
     × DSOR-AUT-01b: the CFO is refused the invoice the agent issues one line later
     × DSOR-AUT-01b: a denied caller cannot tell a real invoice from one that does not exist
      Tests  10 failed | 147 passed (157)
```

No code was touched. One word in a table, and the separation between approving a payment and
creating one is gone. That separation has a name in a real company — segregation of duties — and
it is `DSOR-SOD-01a`, in step 30.

**4. Match by prefix instead of by whole string.** In `holds`, use
`granted.some((g) => g.startsWith(permission))`. Run `pnpm test`:

```text
     × DSOR-AUT-01b: a permission is matched whole, never by prefix
AssertionError: "invoice:i": expected true to be false // Object.is equality
      Tests  1 failed | 156 passed (157)
```

**A prefix is not a match.** Asking for `invoice:i` succeeds, because `invoice:issue` starts with
it — and asking for `""` succeeds, because every string starts with nothing.

The same mistake is waiting in step 05's `findPerson`, which matches a caller's name. Change its
`===` to `startsWith` and `cfo_100_evil` logs in as `cfo_100`. Step 05's own tests catch that, so
you can try it there too; its README does not list it as a break, which is why it is worth doing
yourself.

**5. Drop `Object.hasOwn` from the role lookup.** In `permissionsOf`, go back to plain
`return ROLES[principal.role] ?? NOTHING`. Run `pnpm test`:

```text
     × DSOR-AUT-01b: a role nobody granted anything holds nothing
AssertionError: "toString": expected [Function toString] to deeply equal []
      Tests  1 failed | 156 passed (157)
```

This one was a real bug in this step, found by a hostile review rather than by me. `ROLES[role]`
on a plain object **walks the prototype chain**, so a role named `toString` finds a function on
`Object.prototype`, `?? NOTHING` never fires, and `holds` calls `.includes` on a function and
throws at the caller instead of answering no. Anything written to `Object.prototype` becomes a
role granting whatever it likes — one the start-up check never validated and `Object.keys(ROLES)`
never shows.

The fix already existed one file away. `src/login.ts` uses `Object.hasOwn` for exactly this
reason, added in step 05 because *a name the object merely inherits is a name nobody in this
program chose*. The lesson was applied to identity and not to authorization, a day apart. Look
for the shape of a bug in the other places that shape can live.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix. The official `06_permissions_deny_by_default`
is still listed as planned in the [map](../readme.md), so there is nothing to compare against
yet.

```bash
cd docs/baby_steps_tutorials
cp -r my_05_who_is_calling my_06_permissions_deny_by_default
cd my_06_permissions_deny_by_default
rm -rf node_modules && pnpm install
claude
```

Then ask for one thing at a time:

> I have finished step 05, where every request has a caller. Now I want step 06 of the DSoR baby
> steps: permissions, denied by default. Read the map's entry for step 06, §15 of the
> specification, and the sentences for `DSOR-AUT-01a` and `DSOR-AUT-01b` in the requirement
> registry. Then look at `src/contracts/invoice.issue.json` and tell me where the permission an
> operation needs is **already** written down. Do not write code yet — explain what you found,
> and ask me who should be allowed to do what.

Then, once you agree on the table:

> Write the failing tests first, titled with the rule ids, and show me them failing. The one that
> matters is the map's "done when": a caller with `invoice:read` can read and cannot issue. Then
> make them pass with the smallest change, and put the may-you check **before** the arguments are
> read — I want to see for myself why that order matters.

And when it is green, ask for the part that finds real bugs:

> Now attack it. Try to make `holds` say yes for something nobody granted, try to reach an
> invoice without passing the gate, and try to make a denied caller learn something about data
> they may not touch. Mutate every guard one at a time **and whole families at once**. Show me
> real output for anything you find.

## Check yourself

1. Where does the permission an operation needs come from? Why not from the code that runs it?
2. `cfo_100` is the most senior person in the story and cannot issue an invoice. Is that a bug?
3. Why is the may-you check before the arguments are read, and not after?
4. A role grants `INVOICE:READ` by mistake. What happens, and why is the program stopped rather
   than left running?
5. Why does the refusal not tell the caller which permission they were missing?
6. `ROLES` is a plain object and `principal.role` is a string. What is wrong with
   `ROLES[principal.role] ?? NOTHING`?
7. Is this step secure?

<details>
<summary>Answers</summary>

1. From the operation's own contract, `authorization.permission` — there since step 03. Putting
   it in the contract means a reader can see what `invoice.issue` requires without reading code,
   and two pieces of code cannot disagree about it. If the running code decided, the answer would
   live in as many places as there are callers.
2. No. A CFO approves payments; they do not do accounts-payable data entry. Permissions describe
   a job, not a rank. If seniority decided them, the most powerful account in the company would
   be the one most worth stealing.
3. So that being refused tells you nothing about the data. If the address were read first,
   `cfo_100` could compare `RESOURCE_NOT_FOUND` against `AUTHORIZATION_DENIED` and count invoices
   she has no permission to see. Order is part of the guarantee, and it is testable — moving the
   gate below the point where the arguments are read prints `Tests  1 failed | 156 passed (157)`,
   and the one failure is "being refused for authority tells the caller nothing about the data".
4. `INVOICE:READ` matches nothing, so the role silently grants less than its author meant. That
   fails *closed*, which is the safe direction, but silently — nobody notices until a person
   cannot do their job. The table is checked against the specification's own pattern when the
   program loads, so the typo stops the program instead.
5. Because a refusal that names what you lacked is a map of the permission model. Ask for twenty
   operations and the refusals draw it for you. The detail belongs in the audit record, which
   step 08 builds, where an operator can read it and a caller cannot.
6. It walks the **prototype chain**. A role named `toString`, `constructor` or `valueOf` finds an
   inherited member of `Object.prototype`, so `?? NOTHING` never fires and you get a function
   back instead of a list. `holds` then calls `.includes` on it and throws. Worse, anything
   written to `Object.prototype` becomes a role that grants whatever it likes. `Object.hasOwn`
   first is the fix — the same one `src/login.ts` already used for inherited *names*.
7. No. The roles live in the source, not in a role source, so `DSOR-IDN-04a` is not met — steps
   18 and 19. Nothing is authenticated either, so a caller can still claim to be anyone; step 43
   for people and 44 for agents. And nothing yet stops the person who creates a payment from
   approving it — step 30. What *is* real: the answer to may-you cannot be reached from the
   arguments, and anything ungranted is refused.

</details>

## The rules this step meets

- **[DSOR-AUT-01a · L1]** DSoR MUST support role-based access control using the
  `<resource>:<action>` permission format.
  ([§15](../../../specs/dsor/02-security.md#15-authorization))
- **[DSOR-AUT-01b · L1]** DSoR MUST deny any operation for which no permission is granted.
  ([§15](../../../specs/dsor/02-security.md#15-authorization))

`DSOR-AUT-01a` is met, both halves: permissions hang off roles, and every permission string is
checked against the pattern in `common.schema.json` — the specification's own file — when the
program loads.

`DSOR-AUT-01b` is met: a permission that was never granted is refused, a role nobody defined
holds nothing (including one named after a member of `Object.prototype`), and a permission is
matched whole rather than by prefix.

One limit on that claim, measured rather than guessed. AUT-01b is proved for commands; for a
query every role in the cast may read, so the gate's query half is unexercised until step 07's
pipeline makes a principal injectable. A gate changed to check commands only —
`contract.kind === "command" && !holds(...)` — printed `Tests  157 passed (157)`. The seam is not
invented here on purpose: closing it needs a caller without `invoice:read`, and a cast member who
exists only to satisfy a test is the same mistake the `DSOR-ERR-01b` note below refuses.

Step 05's two claims still hold: `DSOR-IDN-01`, and the "not from the arguments" half of
`DSOR-SRC-02a` — which this step extends. Who you are never came from the arguments, and now
neither does what you may do.

One test was added for that half this round: with nobody logged in and `principal: "cfo_100"`
planted in the arguments, the answer is still `AUTHENTICATION_REQUIRED`, attributed to nobody.
Every planted-principal test before it logged in first, so a fallback that read the arguments
only when the login was missing passed all 156 tests. With that fallback put back, the new test
is the one failure: `Tests  1 failed | 156 passed (157)`.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-AUT-02a` | Authorization must support `ALLOW`, `DENY` and `REQUIRE_APPROVAL`. There are two answers here, yes and no. `REQUIRE_APPROVAL` needs a proposal for the approval to attach to — step 22. |
| `DSOR-AUT-02b`, `02c` | When several rules apply the strictest wins, and every `REQUIRE_*` must be satisfied. One permission is checked, so nothing can conflict yet. Controls in CEL arrive in step 27. |
| `DSOR-IDN-04a`, `04b` | Roles and scopes may only come from an authoritative source. These roles are in the source code. Steps 18 and 19. |
| `DSOR-SOD-01a` | Segregation of duties: whoever creates a payment must not approve it. Break 3 shows the hole this rule fills, and the rule needs approvals — step 30. |
| `DSOR-ERR-01b` | An error must not reveal a resource the caller is not authorized to read. The mechanism is here; the rule is not claimed — see below. |
| `DSOR-IDN-02a` | An agent must authenticate with its own credentials. Nothing here authenticates anything. Step 44. |
| `DSOR-SRC-02b` | A principal or tenant in the arguments that *disagrees* with the security context must be an error, not merely ignored. Still ignored. Steps 10 and 11. |

## What a review found after this looked finished

`pnpm check` was green at 126 tests and every guard had been broken on purpose. Four independent
reviewers then attacked it, and found three real defects:

- `permissionsOf` walked the prototype chain — break 5 above.
- **Nothing pinned where the gate's permission came from.** Making it read a `permission` written
  into the caller's arguments let `cfo_100` issue the invoice with all 126 tests still green.
  That is step 05's rule, and it needed its own test for authorization.
- Reading a caller's object could throw where an envelope was promised: a login whose
  `loggedInAs` is a getter that throws came back as `Error: boom`, not
  `AUTHENTICATION_REQUIRED`.

Two more were guards with no test behind them, and two were tests that proved less than they
looked — including one comparing against the literal `"cfo_100"` rather than the login's own
name, which cannot tell a real answer from that one string.

The reason this is in the README rather than quietly fixed: **a green suite and a completed
mutation sweep were not enough**, and that is worth knowing before you trust your own.

### And what a second review found, later still

A nine-reviewer pass over every step found two more, and both are about what a test *claims*
rather than what the code does.

- **`src/main.ts` was imported by no test in any step.** It is the one file this README tells you
  to run, and the block under "Run it" is its output pasted in as proof. Change the first `===` in
  `show` to `!==` and the suite printed `Tests  149 passed (149)` while `pnpm start` died on its
  third line with a `TypeError`. Not a wrong number on a screen — a crash, in the first thing a
  learner does.

  `test/main.test.ts` now runs the real program as a subprocess and reads what it printed.
  Mutations of `src/main.ts` were then tried one at a time. No list of them was kept, so no
  count is claimed here. Two that survive are worth naming, and both were run again for this
  README: printing the literal `"never"` instead of the envelope's retry class, and the literal
  `"issued"` instead of the committed invoice's status, each print `Tests  157 passed (157)`.
  They are equivalent mutations, because this step's data makes both indistinguishable: every
  refusal here is `never` and the only committed invoice is issued. A survivor whose output
  genuinely cannot differ is not a gap; a second command, or a refusal that is retryable, is
  what would separate them.
- **Test titles that named the wrong rule.** Listed under "What changed since step 05" above.
  Coverage in this project is counted from those titles, so a wrong id is a wrong number.

The lesson of the first review was that a green suite is not enough. The lesson of this one is
narrower and sharper: **a test suite can be green, thorough, and still not run the program.**

### Why `DSOR-ERR-01b` is not claimed, although the mechanism is here

The machinery the rule needs is built and tested: authority is settled before any data is
touched, so a denial reveals nothing about what exists. That is the "being refused for authority
tells the caller nothing about the data" test. Moving the gate below the point where the
arguments are read prints `Tests  1 failed | 156 passed (157)`, and that test is the one failure.

The rule itself is about a caller who may not **read** a resource. All three roles here hold
`invoice:read`, so there is no such caller in this step to test it with. Claiming it would mean
claiming a guarantee nothing exercises. It needs a role without `invoice:read` — and the reason
not to invent one just to claim a rule is that a cast member who exists only to satisfy a
conformance table is how a test suite starts describing a program nobody has.

**Next:** step 07, the pipeline skeleton — the four ordered checks this step left as the shape of
one function become a written checklist that later steps add lines to and never reorder.
