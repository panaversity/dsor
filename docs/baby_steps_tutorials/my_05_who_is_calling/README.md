# Step 05 · Who is calling

**New in this step:** every call says who is asking, and who you are comes from the login —
never from the arguments.

## Read this first: the login is pretend

This step does **not** build real security, and it is worth knowing that before you read
any code.

A real login proves who you are. It checks a password, or a token, or a certificate. This
one does none of that. You hand it a name and it believes you:

```ts
callOperation({ loggedInAs: "user_123" }, "invoice.get", { invoice: "…" })
```

Anyone can write `cfo_100` there and the program will believe them. Real logins arrive in
steps 43 and 44 — step 43 for people, step 44 for agents.

So the rule this step meets, `DSOR-SRC-02a`, has two halves, and only one of them is real
here:

| Half of the rule | This step |
| --- | --- |
| who you are comes from **beside** the request, not from the arguments | **real**, and tested |
| what it comes from is **authenticated** | pretend until steps 43 and 44 |

The rule's own words are "the authenticated request envelope". This step has no envelope
around a request — the login is simply the first argument to the call. What it does have is
the separation the rule is about: who you are travels beside the request, and the arguments
are never asked.

The half that *is* real is the half worth learning first, and it is the half that most
often goes wrong in real systems.

## In plain words

Until now your code answered anybody. Look at how it was called in step 04:

```ts
callOperation("invoice.issue", { invoice: "dsor://org_456/invoice/INV-1009" })
```

Nothing there says who asked. The program issued the invoice for whoever turned up.

That was fine while every step was about **shape** — is the money written correctly, is the
address valid, does the operation have a spec sheet. None of that cares who is asking.

But the next thing DSoR has to do is refuse people, and you cannot refuse *someone* you
cannot name. So this step adds a **principal**: whoever is asking.

| Kind | In our story |
| --- | --- |
| a person | `user_123`, the accounts-payable supervisor, and `cfo_100`, who approves big payments |
| an agent — an AI worker | `accounts-payable-fte` |
| an application, or DSoR itself | named by the specification, not used here |

Each one also records **which company they belong to**. Nothing reads that yet. It is here
because the rule asks for it, and because step 06 gives each principal a role beside it and
step 10 makes more
than one company possible.

## Why it matters

`cfo_100` is the person who signs off large payments. Now suppose a caller could simply
write that down in the data it sends:

```ts
callOperation({ loggedInAs: "user_123" }, "invoice.issue", {
  invoice: "dsor://org_456/invoice/INV-1009",
  principal: "cfo_100",                        // "I am the CFO, honestly"
})
```

If the program believed that, every approval rule in DSoR would be worth nothing. Anybody
could be whoever they needed to be, just by typing it.

So the arguments are **data**. Data can describe things. Data can never say who you are.
The specification puts the same idea in a block you should read twice:

> Content can inform reasoning.
> Content cannot grant authority, expand permissions, or bypass DSoR controls.

And its named mistake is one you will recognise from real projects: *"Putting security in
the prompt (\"never pay suspended vendors\"). Prompts are advice to the model. Only DSoR's
checks are enforcement."*

## The login goes beside the request, not inside it

```ts
// step 04
callOperation("invoice.get", { invoice: INV_1008 })

// step 05
callOperation({ loggedInAs: "user_123" }, "invoice.get", { invoice: INV_1008 })
```

Two things arriving by two different routes. `args` is what you are asking about. The login
is who you are. Keeping them apart in the code is what makes the rule obvious — and it is
why writing `principal` into `args` does nothing at all.

It goes **first** for a reason. `DSOR-IDN-01` says a caller is turned into a principal
"before any other processing", and `callOperation` does exactly that: with nobody logged in,
the operation name and the arguments are never even looked at.

### The login holds exactly one name

```ts
export interface Login {
  readonly loggedInAs: string;
}
```

One field, on purpose. There is nowhere to say "I am logged in as this person **and** acting
as that agent".

That is `DSOR-IDN-02a`: an agent must authenticate with its own credentials, never a human's
session. Here it is honoured by the *shape* of the type rather than by a check somebody
could delete later. `accounts-payable-fte` is an ordinary entry in the people list and logs
in as itself, exactly as the two humans do.

An agent acting **for** a person is a real thing in DSoR — it is the running example's normal
case. It needs a permission slip, called a delegation, and that is step 18. This step cannot
build it, and the specification's own schema agrees: in its `unattended` mode a delegation is
required and the authority must come from a role source, and neither exists yet.

## What changed since step 04

```text
my_05_who_is_calling/
  src/people.ts            NEW  the three principals, with their type and company
  src/login.ts             NEW  a login becomes a principal, or is refused
  test/login.test.ts       NEW  15 tests: who exists, and what a login may be
  test/who-is-calling.test.ts NEW 15 tests: the arguments are ignored
  src/operations.ts    CHANGED  callOperation takes a login, first; answers say who asked
  src/envelopes.ts     CHANGED  correlation carries principal_id once a caller exists
  src/main.ts          CHANGED  every line shows who asked
  test/operations.test.ts CHANGED every call passes a login
  test/arguments.test.ts CHANGED every call passes a login; a title dropped a wrong rule id
  test/main.test.ts    CHANGED  the expected output gains a name column; 5 tests about who asked replace step 04's 6
  src/invoice.ts       CHANGED  nothing but a dropped step 04 comment marker
  test/envelopes.test.ts CHANGED a marker, and one note that principal_id is filled now
  package.json         CHANGED  name and description only
  test/invoice.test.ts CHANGED  a dropped step 04 marker, and one title dropped a DSOR-MON-01 it never earned
  test/registry.test.ts CHANGED two titles dropped a DSOR-OPR-02b that a freeze does not earn
```

The last five are in the list because `diff -rq` shows them to a reader and a list that
leaves them out looks like something is hidden. The first two of those are comments only, and
`package.json` is its name and description. The last two each drop a rule id from a test title
and change nothing the test checks. A title that starts with a rule id claims the test would
fail if that rule were broken; a test that only checks a freeze cannot fail for a rule about
defaults, or for one about how money is written, so the claim was not true and it is gone.

```bash
cd docs/baby_steps_tutorials
diff -rq --exclude=node_modules --exclude=pnpm-lock.yaml \
  my_04_result_and_error_envelopes my_05_who_is_calling
```

## Run it

```bash
cd docs/baby_steps_tutorials/my_05_who_is_calling
pnpm install
pnpm start
```

```text
Hello, accounts-payable-fte.

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

accounts-payable-fte  COMMITTED                dsor://org_456/invoice/INV-1009  issued

not logged in           (nobody)              AUTHENTICATION_REQUIRED  retry: never                nobody is logged in
nobody by that name     (nobody)              AUTHENTICATION_REQUIRED  retry: never                "nobody" is not someone this program knows
logged in, bad address  user_123              VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"
logged in, no contract  user_123              UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it
```

Those thirteen lines are not pasted from memory. `test/main.test.ts` starts the same program in
a second copy of Node, reads what it printed, and compares it to **its own copy** of that block —
the `EXPECTED` list at the top of the test file. So if the program and the test's copy ever
disagree, `pnpm test` says so. What no test reads is this page: the block above is kept in step
with the test's copy by hand, and if someone edits one and not the other, the test stays green
and the page is wrong. It is the only test file here that runs the *program* rather than calling
a function, because `src/main.ts` does its work at the top level and leaves nothing to call.

```bash
pnpm check                 # typecheck, then test. 133 tests pass
```

Read those lines carefully, because two things are happening.

**Lines one and two** are the same read by two different callers. Switching is a different
login and nothing else.

**Line three** is the same read again — and its arguments contained `principal: "cfo_100"`.
The answer still says `user_123`. The claim was read and thrown away. That is the step done.

**The last four** are refusals, and they split in two. The first two had no usable login, so
they are attributed to `(nobody)` and told only that: no name, and nothing about what they
asked for. The second two were logged in, so they are named — and their own problem was found
and reported.

What these four lines do **not** show is the order. Both of the refused callers sent a real
operation and a good address, so there was no second problem for the login check to beat. The
order is a guarantee all the same, and it is proved where it can be: the test
`DSOR-IDN-01: the login is checked before the operation or the arguments` asks for a nonsense
operation and a missing address with nobody logged in, and gets `AUTHENTICATION_REQUIRED` both
times.

### Why both refusals say the same thing

"Nobody is logged in" and "nobody by that name" both come back as
`AUTHENTICATION_REQUIRED`. That is deliberate. A refusal saying *"there is no such person
here"* would tell a stranger which names **do** exist, one guess at a time.

The specification has a rule about that shape, `DSOR-ERR-01b`, and this step cannot state it
properly yet — it turns on whether the caller is *authorized*, and nothing is authorized
until step 06. So this is the habit, arriving before the rule that needs it.

### An answer cannot be edited after you are handed it

One small guard belongs to this step, and it comes from a review that attacked it.

The answer is frozen. `readonly` is a TypeScript word that is **erased before Node runs** — step
01's lesson — so without `Object.freeze` a caller could overwrite `askedBy` on the answer they were
handed, which is this step's whole record of who asked.

Two related guards you will see in `callOperation` are **not** this step's: the arguments are copied
once, and a request whose arguments cannot be written down is refused first. Both arrived in step 04,
because they keep step 04's promise that every refusal comes back as an envelope — a path that
throws instead is a hole in that promise. They are tested in `test/arguments.test.ts`, which came
forward with them. What this step adds on top is that those refusals, like every other, say **who**
was refused.

## Break it

Five breaks, and a second version of the first. Change the code back after each. Every number below was produced by running it.

**1. Read the principal from the arguments.** In `src/operations.ts`, take the name from
`args["principal"]` when it is there, instead of from the login. Run `pnpm test`:

```text
     × DSOR-SRC-02a: a principal named in the arguments is ignored
     × DSOR-SRC-02a: a principal named in the arguments is ignored by the command as well
     × prints exactly what the README shows
     × DSOR-SRC-02a: the printed answer ignores a principal planted in the arguments
AssertionError: expected 'cfo_100' to be 'user_123' // Object.is equality
      Tests  4 failed | 129 passed (133)
```

This is the break the step exists for, and it is the map's own "done when". Notice how small
the change is — one line with a ternary, and it looks helpful. Notice also that it takes four
tests down, not one. The query and the command are asked the same question, because a hole in
one of them is a hole. And the last two are the program itself: line three of its output starts
saying `cfo_100`, so the block printed above stops being true.

**1b. The same hole, written as a fallback.** Keep the login first, and only when it is
*missing* take the name from `args["principal"]`. Run `pnpm test`:

```text
     × DSOR-SRC-02a: a principal named in the arguments is not a login either
Error: expected a refusal, got data
      Tests  1 failed | 132 passed (133)
```

One failure — and before that test existed, none. Every other test that plants a name in the
arguments also sends a real login, so a fallback that only runs when nobody is logged in slipped
past all of them: the suite was asking "is the login preferred?" and never "is the argument
*ever* believed?". The program's output does not change either, because its "not logged in"
line plants nothing. That is why the new test logs nobody in and plants `cfo_100` anyway.

**2. Let a missing login through.** In `src/login.ts`, default to `user_123` instead of
refusing when there is no login. Run `pnpm test`:

```text
     × DSOR-IDN-01: nobody logged in is refused, and a retry cannot help
     × DSOR-IDN-01: each refusal says in words which refusal it is
     × DSOR-IDN-01: a login that is not a login is refused, never thrown at
     × DSOR-IDN-01: a name inherited from a prototype is not a login
     × DSOR-IDN-01: an identity refusal carries a generated request id, not a name
     × DSOR-SRC-02a: a principal named in the arguments is not a login either
     × DSOR-ERR-01a: an object that throws when read is refused, not thrown at
     × DSOR-IDN-01: with nobody logged in, nothing happens at all
     × DSOR-IDN-01: the login is checked before the operation or the arguments
     × DSOR-IDN-01: a refused login is attributed to nobody, never to a real person
     × prints exactly what the README shows
     × DSOR-IDN-01: a caller who is not a principal is refused, and named as nobody
      Tests  12 failed | 121 passed (133)
```

Twelve. A default caller is not one bug: it takes out the refusal, its retry class, the
ordering, the attribution of a refused call, and every check on what a login may be. Break 1b's
test goes too, because its caller logged nobody in and is now filed as the supervisor. The
program's own output goes with them —

```text
AssertionError: expected 'not logged in           user_123     …' to contain '(nobody)'
```

— a line that says the supervisor asked for something nobody asked for. This is the version of
the bug that looks most reasonable while you are writing it, and it is the one with the widest
blast radius.

**3. Believe any name.** In `src/login.ts`, invent a principal for any name instead of looking
it up in the people list. Run `pnpm test`:

```text
     × DSOR-IDN-01: a name nobody has is refused the same way
     × DSOR-IDN-01: each refusal says in words which refusal it is
     × DSOR-IDN-01: an identity refusal carries a generated request id, not a name
     × DSOR-IDN-01: a refused login is attributed to nobody, never to a real person
     × prints exactly what the README shows
     × DSOR-IDN-01: a caller who is not a principal is refused, and named as nobody
      Tests  6 failed | 127 passed (133)
```

**4. Check the login after the operation.** Move the "no such operation" lookup and refusal so
they come *before* the login check. Run `pnpm test`:

```text
     × DSOR-IDN-01: the login is checked before the operation or the arguments
     × every answer says who asked, and so does the envelope inside it
     × prints exactly what the README shows
     × DSOR-IDN-01: a caller who is not a principal is refused, and named as nobody
      Tests  4 failed | 129 passed (133)
```

Nothing is insecure yet — the caller is still checked. But an unknown caller now learns which
operations exist before being turned away, and "before any other processing" is no longer
true. The second failure is the tell: up there the caller has not been resolved yet, so the
refusal has no name to put in, and a logged-in caller's mistyped operation is recorded as
having come from nobody. The last line the program prints says it out loud:

```text
AssertionError: expected 'logged in, no contract  (nobody)     …' to contain 'user_123'
```

Order is a guarantee, and it is testable.

**5. Have the program print a name of its own.** In `src/main.ts`, put the literal `"user_123"`
in the name column instead of `answer.askedBy`. Run `pnpm test`:

```text
     × prints exactly what the README shows
     × shows the same read by two callers, differing only in who asked
     × DSOR-IDN-01: a caller who is not a principal is refused, and named as nobody
     × shows the agent issuing INV-1009, and says the agent asked
      Tests  4 failed | 129 passed (133)
```

Nothing under `src/` except the demo program changed, so every check on the library is still
green — and that is the point of this break. Before `test/main.test.ts` existed, no test
imported `src/main.ts` at all, so this edit left the whole suite green while the program
printed `user_123` over the agent's work and over two callers who were never identified. The
output a page shows a reader is a claim like any other, and a claim nothing checks goes stale
without a sound.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix. The official `05_who_is_calling` is still
listed as planned in the [map](../readme.md), so there is nothing to compare against yet.

```bash
cd docs/baby_steps_tutorials
cp -r my_04_result_and_error_envelopes my_05_who_is_calling
cd my_05_who_is_calling
rm -rf node_modules && pnpm install
claude
```

Then paste one line:

```text
Use the build-baby-step skill in learner mode. We are building step 05, who_is_calling.
```

Ask for a plan before any code, and ask to see the new tests fail before they pass. The
general directions are in the
[tutorial overview](../readme.md#build-the-steps-with-claude-code).

## Check yourself

1. Why is it not enough to read the caller's name out of the arguments?
2. The login has exactly one field. What does that shape stop, and what does it **not**
   stop?
3. `principalFrom(undefined)` and `principalFrom({ loggedInAs: "nobody" })` return the same
   code. Why not say which one went wrong?
4. Nothing in this step reads `memberships`. Why is it there?
5. With nobody logged in, asking for `execute_sql` gives `AUTHENTICATION_REQUIRED` rather
   than `UNSUPPORTED_CAPABILITY`. Is that the right answer?
6. Is this step secure?

<details>
<summary>Answers</summary>

1. Because the arguments are written by the caller. Anyone could put `cfo_100` there and be
   the person who approves large payments. Data describes things; it can never say who you
   are.
2. It stops a caller **declaring two identities at once** — "I am the agent, acting as the
   supervisor" — because there is nowhere to write the second one. It does **not** stop a
   caller borrowing a single identity that is not theirs: the agent can put `cfo_100` in the
   one field, and nothing here can tell. That is `DSOR-IDN-02a`, and this step does not meet
   it; only real credentials can, and for an agent those arrive in step 44. This page claimed
   the opposite until a review
   caught it, and the lesson is worth more than the claim was: ask which *clause* of a rule
   your code satisfies, not whether it is about the same subject.
3. Because "there is no such person here" tells a stranger which names do exist, one guess
   at a time. The specification has a rule about that, `DSOR-ERR-01b`, which this step cannot
   state properly because it needs permissions — step 06.
4. Because `DSOR-IDN-01` asks for it by name: a principal with a type **and tenant
   memberships**. Step 06 gives each principal a role beside them, and step 10 makes more than
   one company
   possible. Adding it later would mean changing every principal in the program.
5. Yes. A caller who is not identified has not really made a request yet, so there is nothing
   to answer — and telling them which operations exist would be answering. `DSOR-IDN-01`
   says the caller is normalised "before any other processing", and that is the strongest
   ordering sentence in the specification.
6. No. The login is believed without proof — no password, no token. What is real is that the
   arguments cannot override it. Real authentication is steps 43 and 44, and this README says
   so at
   the top rather than at the bottom.

</details>

## The rules this step meets

- **[DSOR-IDN-01 · L1]** DSoR MUST normalize every caller into a principal with a type and
  tenant memberships before any other processing.
  ([§12](../../../specs/dsor/02-security.md#12-identity-and-principals))
- **[DSOR-SRC-02a · L1]** DSoR MUST derive the security context only from the authenticated
  request envelope and its own control-plane store.
  ([§11](../../../specs/dsor/02-security.md#11-source-trust-and-the-instruction-boundary))

`DSOR-IDN-01` is met for every call through `callOperation`: the caller becomes a principal,
with a type and a company, before the operation name or the arguments are looked at, and a
test proves the order. Two honest edges. `getInvoice` and `issueInvoice` are still exported
and can be called with no login at all — the map shuts that door in step 42. And a principal's
`memberships` exist but are never read; the company is compared against one hard-coded value.

**`DSOR-SRC-02a` is met in one half only**, as the section at the top of this page says.
Nothing is derived from the arguments, and both the query **and** the command are tested with
a caller who plants `principal` in them. Nothing is *authenticated* — the login is believed.
Step 43 for people, step 44 for agents.

That is one rule met and one met in half, which is what the
[map](../readme.md) gives this step. An earlier version of this page also claimed
`DSOR-IDN-02a`; a hostile review showed it was not met, and the row below says why.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-IDN-02a` | An agent must authenticate with its own credentials. Nothing here authenticates anything — see below. Step 44. |
| `DSOR-SRC-02b` | A tenant, principal, or delegation identifier in the arguments that **disagrees** with the security context must cause `TENANT_MISMATCH` or `AUTHORIZATION_DENIED`. This step *ignores* such an argument, which is not the same as refusing it. Ignoring is the right first lesson; the refusal needs authorization and more than one company, steps 06 and 10. |
| `DSOR-IDN-02b` | Audit must record the subject and every actor. There is no audit log until step 08. |
| `DSOR-IDN-03a`, `03b` | Exactly one active tenant per request, and no operation across tenants. The company is checked against one hard-coded value, not resolved from the caller's memberships. Steps 10 and 11. |
| `DSOR-IDN-04a`, `04b` | Roles and scopes may only come from an authoritative source. There are no roles yet — step 06 — and no role source, which is steps 18 and 19. |
| `DSOR-IDN-05`, `06`, `07` | All need a role source and a delegation. Steps 18 and 19. |
| `DSOR-SRC-01a`, `01b` | Content in arguments or retrieved data must not change the principal, and an injection test suite must exist. Two of the things that rule protects — the principal and the tenant — are tested here with planted arguments. The rest of the list, and the suite, need content that is *read from somewhere*: a document, a memory, a connector payload. None of those exists yet. |
| `DSOR-COR-01a` | The identifiers must propagate through connectors, audit, and events. `request_id` and `principal_id` are on every envelope, which is the groundwork, but there are no connectors, no audit and no events to carry them to. |
| `DSOR-AUT-01a`, `01b` | Role-based access control in the `<resource>:<action>` form, and deny by default. Nothing checks what a caller may do. Step 06, and it is the whole of the next step. |
| `DSOR-ERR-01b` | An error must not reveal a resource the caller is not authorized to read. The habit is here for *identities* — both login refusals are deliberately identical so a stranger learns no names. It is **not** here for resources: `RESOURCE_NOT_FOUND` names the invoice it could not find. Nobody is unauthorized yet, so nothing leaks yet; the rule needs step 06. |

### Why `DSOR-IDN-02a` is not claimed, although the login has one field

Nothing in this step authenticates anything, so any caller can present any name.
`accounts-payable-fte` can send `{ loggedInAs: "cfo_100" }` and every answer, and every envelope
inside it, will say the CFO asked — which is the exact failure §12 describes: *"the log would say
the supervisor did everything."*

The one-field `Login` stops a caller **declaring** two identities at once, and that is worth
having. The rule is about one **borrowing** an identity that is not theirs, and a shape cannot
prevent that; only credentials can. An earlier version of this page claimed the rule on the
strength of the shape, which is the mistake of reading a rule's subject and not its clause.

Step 44, `44_an_oauth_server_for_agents`, is where the agent gets its own OAuth client and proves
itself with a private key.

**Next:** step 06, permissions denied by default — the first refusal that is about
*authority* rather than about the shape of your data.
