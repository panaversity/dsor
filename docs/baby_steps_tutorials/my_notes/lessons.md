# Lessons

The mistakes that repeated across steps 01 to 06, and what catches each one. Fifteen of them now,
and lesson 15 is the one to read if you only read one. Kept
separately from [decisions.md](decisions.md) because these are not choices — they are
things that went wrong more than once.

---

## 1 · A shape check is not a meaning check

This turned up in all four steps, in the same form every time. A pattern or a type proves
something has the right *shape* and says nothing about whether it *means* anything.

| Step | The shape check | What it accepted |
| --- | --- | --- |
| 01 | `currency: string` matching `^[A-Z]{3}$` | `ZZZ`, `QQQ` — not assigned currencies |
| 02 | the normative URI pattern | `dsor://acme/...` — a company name as the tenant |
| 03 | `operation-contract.schema.json` | `predicates: []`, and `"not CEL at all !!!"` |
| 04 | `error-envelope.schema.json` | `CONFLICT` with `retry: "safe_same_key"` |

Every one of these is now either checked in code or written down as a limit. The habit
that works: after writing a check, ask what it accepts that it should not, and either close
the gap or say so where a reader will meet it.

## 2 · Passing tests prove nothing until you break the code

Every step where guards were mutated one at a time turned up something no test protected.
Not a few — the counts:

| Step | Guards found unprotected |
| --- | --- |
| 02 | 2 (`parseUri`'s freeze, `formatUri`'s round-trip compare) |
| 03 | 5 of 19 mutations survived |
| 04 | 9 in the first sweep, then 11 in a second, wider one |

The worst single case: **22 of the 32 rows** of step 04's retry table were reached by no
test. Mutating all 22 at once left all 76 tests green. A wrong row is a wrong instruction —
`AUTHORIZATION_DENIED` marked retry-safe re-sends a forbidden request for ever.

What catches it: delete or weaken each check in turn, run the tests, and record which
survive. Assert the target text appears exactly once before editing, or a no-op edit scores
as a kill. For every survivor, prove the guard does real work with a throwaway probe before
writing a test for it — otherwise it may be an equivalent mutant and not a gap at all.

## 3 · Quoted output goes stale the moment anything moves

Every README quotes real command output. Every time the code or the test count changed,
some of it became wrong, and it was never obvious by reading.

Cases: step 02's `TS2353` line moved when the formatter reflowed a signature. Step 03's
`execute_sql` message changed in code and stayed old in two README transcripts, where it
also read backwards. Step 04's break counts moved three times as tests were added.

What catches it: re-run every quoted command after any change, and diff the block against
the real output rather than reading it. A one-line script that extracts the fenced block
and compares it is worth more than care.

## 4 · Writing counts from memory

Test counts were wrong in step 03 twice — `fourteen` for 13 and `fifteen` for 16 — and the
second contradicted the README's own arithmetic six lines later. Both were written from
memory instead of counted.

It happened again while writing these notes: the step 03 note said "three tests fail" for a
break its own README records as four. Verification caught it. The tendency is real and
persistent, not a one-off.

What catches it: `grep -cE '^\s*it\(' test/*.ts`, or reading the number out of the README
that already has it. Never a recollection.

## 5 · Describing a file instead of reading it

Step 04's centrepiece claim — "the schema pins exactly one code's retry class" — was wrong.
It pins three. The step's own `BATCH_PARTIAL` test proved it at the time, so the README
contradicted its own test suite.

Also in this class: "seven places" for what is eleven `$ref`s to seven definitions, and a
strict-mode explanation that named the wrong cause for nine of thirteen failures.

Two more of the same kind, found by verifying these notes: the step 01 note blamed the money
gaps on "nothing tests trailing junk", when trailing junk on the *value* is tested and is
what protects that pattern — the untested parts are its two quantifiers and the currency
pattern. And the step 04 note said all three pinned codes are unknown-outcome cases, when
`BATCH_PARTIAL` is pinned for the opposite reason: every item's outcome is known.

What catches it: read the file and count, in the same minute as writing the sentence. And
have someone else check the finished text against the code — all three of these survived
writing and were only caught by verification.

## 6 · Claiming a rule without its condition

`DSOR-ERR-01b` was paraphrased as "an error must not leak whether a resource exists",
dropping *"the caller is not authorized to read"* — which is the whole rule. With no caller
and no permissions in step 04, the step was safe; the paraphrase made it look guilty.

What catches it: quote a rule from
[`requirements.json`](../../../packages/spec/requirements.json), never from memory, and
keep every clause.

## 7 · A commit that was never run

One step 04 commit was red: `main.ts` could not compile against the new answer type, and
splitting it from the operations change left a commit whose typecheck failed. It was
committed without reading the check output.

What catches it: run the check before each commit and read what it printed, and verify the
whole series afterwards by checking each commit out into a clean directory. That history
was rewritten into one commit, with the reason in its message.

## 8 · One large reviewer stalls; narrow ones finish

A single hostile-review agent given the whole step stalled twice with no output, once after
ten minutes. Splitting the same work into five passes with one job each — outputs, claims,
readability, leftovers, cross-references — finished every time and found 38 and 41 findings
respectively.

What works: one job per pass, named explicitly, with instructions to stay inside it.

## 9 · Narrow reviewers must not sabotage the same folder at once

Lesson 8 is still right — five narrow passes finish where one wide pass stalls. What step 05
added is the other half of it: several of those passes **break the code on purpose** to see
whether a test goes red, and running them together in one folder means each one is measuring
a folder the others are also editing.

What it actually caused, in step 05:

- One pass reported failure counts that were contaminated until it re-ran the breaks in an
  isolated copy. Its final numbers are right *because* it noticed and re-ran; had it not
  noticed, wrong counts would have gone into the README as verified output.
- Another pass snapshotted `src/login.ts` as a backup **while a different pass's sabotage was
  applied**, so the backup held code with the unknown-name refusal removed. Restoring from
  that file would have silently deleted a guard and turned three tests red, and it would have
  looked like a restore rather than a change.

What to do instead: give each sabotaging pass its own copy of the folder, or run the
sabotaging passes one at a time and only the read-only passes in parallel. Either way, never
trust a backup file another agent left behind, and check `git status` and `pnpm check` before
believing any count that came out of a shared folder.

## 10 · Mutating one guard at a time cannot find a test that expects a constant

[Lesson 2](#2--passing-tests-prove-nothing-until-you-break-the-code) says break each guard in
turn. Step 05 found the limit of that method.

The caller's name is attached in twenty-two places. Each one was mutated separately and every
one was caught, so the guarantee was recorded as proven. A hostile review then replaced **all
of them at once** with the literal `"cfo_100"` — and all 100 tests passed. The test that
guarded attribution walked twelve call shapes with a single login, `cfo_100`, and asserted the
name was `"cfo_100"`. So the suite could never tell "carries the caller's name" from "carries
that one string", and `user_123`'s refusal could be stamped with the CFO's id.

One-at-a-time mutation cannot find this, because each single site still disagrees with the
others and something goes red. Only replacing every site with the same constant makes the code
self-consistent and wrong.

What catches it: when a test asserts a value, ask where the expected value came from. If it is
a literal that appears in the input as well, the test cannot distinguish the two. Vary the
input — here, three different logins — and assert against the **input**, not a constant. Then
mutate the whole family of sites together as well as one at a time.

## 11 · Check the mutation before you believe the survivor

Step 06's first sweep ran thirteen mutations and reported four survivors. Two of the four were
**my mistakes, not test gaps**:

- One cut the wrong lines out of `permissions.ts`, so the file no longer loaded. The run
  reported `74 passed (74)` — a *smaller total* than the real 126, because two whole files
  failed to import. A shrinking total is the tell, and "all passed" on a broken file reads
  exactly like a survivor.
- One claimed to move the may-you check after the arguments and moved it somewhere that
  changed nothing observable, because the argument that mattered is parsed inside the handler,
  further down. Redone properly, the test killed it at once.

So a survivor is a claim about two things: the test, **and** the mutation. Before believing it,
check that the mutation compiled, that the test total did not shrink, and that the mutated code
really does the wrong thing — run it and look at the output, not the diff.

Combined with [lesson 10](#10--mutating-one-guard-at-a-time-cannot-find-a-test-that-expects-a-constant),
the sweep now has three failure modes of its own: too narrow (one site at a time), too weak (a
mutation that changes nothing), and broken (a mutation that does not load).

## 12 · A sentinel that says `true` proves nothing

Step 04 marked "this check ran at start-up" with a boolean:

```ts
export const WIRING_CHECKED: boolean = ((): boolean => {
  assertPaired(registry, handlers);

  return true;
})();
```

Step 06 copied the idea for its role table, and a mutation found the hole: delete the call,
keep `return true`, and every test stays green. The sentinel says the check ran; all it really
proves is that somebody wrote `true`.

The fix is to make the sentinel carry a value that can only come from doing the work. The
checker now returns how many permissions it looked at, and the constant holds that number:

```ts
export const PERMISSIONS_CHECKED: number = checkPermissions(ROLES);
```

A test compares it with the table's real total, so deleting the call and leaving a plausible
number behind fails. It is not a proof — hardcoding today's correct answer still passes, and
only a child process could close that — but it moves the mistake from "delete a line" to
"delete a line, work out the right number, and keep it right as the table changes".

Where this applies: any flag that means "something happened". Prefer a count, a hash, or the
result itself over `true`.

## 13 · A fix belongs everywhere its shape lives

In step 05, `login.ts` gained `Object.hasOwn` with a comment explaining it: *a name the object
merely inherits is a name nobody in this program chose.* A test was written for it, titled "a name
inherited from a prototype is not a login".

One day later, step 06 looked up roles with `ROLES[principal.role] ?? NOTHING` — the same bug, in
the same file tree, with the fix already written eighty lines away. A role named `toString`
returned a function; `Object.prototype` pollution granted a permission no role in the table had.
A hostile review found it; my own mutation sweep could not, because the sweep mutates guards that
*exist* and this was a guard that did not.

The pattern is not "inherited properties". It is **the same question asked about a different
noun**:

| Step | The noun | The question |
| --- | --- | --- |
| 05 | a login's name | is this key the object's own? |
| 06 | a role's name | is this key the object's own? |
| 05 | `findPerson` | is this a whole match or a prefix? |
| 06 | `holds` | is this a whole match or a prefix? |

Both rows repeated, and the second one repeated *after* it had been written down as a lesson.

What to do: when a guard is added, ask what kind of thing it protects, then list every other place
that kind of thing arrives, and check each. It takes a minute, and it is the only one of these
three methods — tests, mutation sweep, sideways check — that finds a guard that was never written.

## 14 · A safety net you have never tested is not a safety net

For four steps I wrote, and told the learner, that `pnpm guard` would catch a rule id that does
not exist. It never could. The guard strips inline code spans before it looks for identifiers, and
the tutorial writes every id in backticks — so of the 171 distinct ids across six steps and these
notes, the check had seen **none**.

It cost something real: `DSOR-SOD-01`, which is not a rule, was cited in four files including the
promises table the next session is told to act on. Two wrong step numbers travelled the same way.

The tell was available the whole time and nobody looked for it. It takes one probe:

```text
`DSOR-FAKE-99`  in backticks  ->  guard passes
 DSOR-FAKE-99   bare          ->  error: known-id ... which the spec does not define
```

So: **before relying on a check, make it fail once.** Not read its source, not trust its name —
feed it the thing it is supposed to catch and watch it complain. This is the same discipline as
breaking a guard to see a test go red ([lesson 2](#2--passing-tests-prove-nothing-until-you-break-the-code)),
applied to the tools instead of the code, and it had never occurred to me to apply it there.

The general shape: every claim of the form "X protects us from Y" is a testable claim. If it has
not been tested, it is a hope.

## 15 · The same wrong shape appeared in five places before anybody looked for it

"Is this a whole match or a prefix?" has now been the answer five times in six steps:

| Step | The code | What a prefix match would do |
| --- | --- | --- |
| 01 | `getInvoice`'s `invoice.id === id` | `getInvoice("")` hands back INV-1008 |
| 02 | `parseUri`'s entity segment | a payment address parses as an invoice |
| 03 | the tenant check's `tenant !== TENANT` | `org_45` reads org_456's records |
| 05 | `findPerson`'s `p.id === id` | `cfo_100_evil` logs in as `cfo_100` |
| 06 | `holds`'s `includes` | asking for `invoice:i` is granted |

Two of the five were real defects when they were found. The other three were correct code that
**no test protected**: every one of them passed its whole suite after the change.

What is worth extracting is not "watch out for prefixes". It is the method that found them, and
what it cost that nothing else did:

- Steps 05 and 06 each had a hostile review. Each review found real bugs **in that step**, and
  neither looked back at the same shape in the steps below.
- The arc audit read all six steps and found stale numbers and broken promises — things that can
  only be wrong *between* steps — and did not find these, because they need running code.
- Only attacking steps 01 to 03 found them, and only because the attackers were told to look for
  the shapes this codebase had already got wrong. That instruction came from
  [lesson 13](#13--a-fix-belongs-everywhere-its-shape-lives), which existed because the shape had
  already repeated twice.

So the lesson compounds: **write down the shape of a bug, and then go looking for that shape
everywhere, including in the code you wrote before you knew.** Lesson 13 said a fix belongs
everywhere its shape lives. This says the same about a *test*.

## 16 · "Read the caller's data once" is a rule about every function the data reaches

Step 05's review found a *getter* in the arguments that answered differently on a second read, so a
receipt could describe a request that never happened. The fix was to copy the arguments once, in
`callOperation`, and the comment beside it says exactly that.

Step 07's review found the same bug again, past that guard. `success()` — the function that builds
a result envelope — called `JSON.stringify` on the arguments a **second** time to compute the
payload hash, *after* the invoice had been issued. An object whose `toJSON` throws on its second
call committed the change and then threw at the caller:

```text
toJSON calls: 2   ->  THREW at the caller, INV-1009 already issued
toJSON calls: 1   ->  result                (after the fix)
```

The guard did not help because the second read was not of the *arguments*. It was of the copy, one
layer down, by a function nobody thought of as reading anything — it was thought of as *building an
envelope*.

So the rule is not "copy the arguments at the door". It is: **follow the value.** For every piece of
caller-supplied data, list every function it reaches, and ask each one whether it reads it again.
`JSON.stringify`, template interpolation, a logger, a hash, an equality check — each is a read, and
each can see something different from the last one.

Three appearances now, of the shape "the same caller-supplied value, read twice":

| Where | The second reader | What it cost |
| --- | --- | --- |
| step 05 | the receipt's hash, in `success()` | a receipt for a request that never happened |
| step 07 | `success()` again, via `toJSON` | a commit, then a crash, with no evidence |
| step 02 | `formatUri`'s round-trip compare | an address minted from a value that changed |

The one method that finds it is following the value through every call, and no amount of mutating
the guard would have.

## 17 · A guard written twice can be half-broken

Step 08's audit clock existed in two places: the initial value of `clock`, and the body of
`resetClock`.

```ts
let clock: () => string = () => new Date().toISOString();   // here
export function resetClock(): void {
  clock = () => new Date().toISOString();                   // and here
}
```

To check that the test really watched the clock, I replaced the first copy with a constant. All 178
tests passed. The test calls `resetClock()` before it reads the time — so the mutation was healed by
the second copy before the assertion ran. The test was fine. The *mutation* could not reach the code
the test used, and I nearly recorded that as "this guard cannot be killed, and here is why".

One name fixed it:

```ts
const realClock = (): string => new Date().toISOString();
let clock: () => string = realClock;
```

The mutation then killed a test, as it should have. The general shape: **when a mutation survives,
ask whether the thing you changed is the thing the test runs.** Duplicated logic means the answer can
be no, and then a survivor tells you nothing about the test — only about your mutation.

## 18 · Overlapping checks cannot be tested together

`verifyChain` started with four checks: the sequence matched the position, the chain name was this
chain, the link backwards was right, and the record's own hash was right. Three tests covered them,
and every test was caught by two checks at once.

So I removed checks one at a time and ran the suite:

| Removed | Result |
| --- | --- |
| the `sequence` check | 181 passed |
| the `chain` check | 181 passed |
| the link check | 181 passed |
| the record-hash check | 2 failed |

Three of four checks were unkillable — not because the tests were weak in general, but because **no
test fed any check a case only that check could catch.** Two of the three turned out to be genuinely
redundant, and the reason is worth more than they were: `sequence` and `chain` are *inside* the
record, so they are inside the hash. Changing either breaks `record_hash` first. They were deleted.

The link check was not redundant; it was untested. Two new tests fixed that, each reaching exactly one
check:

- a tampered **last** record, where no link follows it to break — only the contents check can catch it
- a **genuine** record spliced in from a different history: right sequence, valid against the schema,
  untouched — only the link check can catch it

The method generalises. For each guard, ask: *what case does this catch that no other guard catches?*
If there is no answer, the guard is redundant — delete it. If there is one, that case is a test you do
not have yet. This is [lesson 14](#14--a-safety-net-you-have-never-tested-is-not-a-safety-net) told
from the other end: there, a net had never been thrown anything; here, four nets were stacked so
nothing ever reached the lower three.

## 19 · A `GRANT` or a `REVOKE` that does nothing does not say so

I wrote step 09's permission migration believing the `REVOKE` lines were what made the audit log
safe. A mutation sweep deleted each one and every test still passed. Measured against PostgreSQL 18:

```text
fresh table, nothing granted:  privileges = (none)
after GRANT INSERT, SELECT:    privileges = INSERT, SELECT
after REVOKE UPDATE, DELETE:   privileges = INSERT, SELECT   <- unchanged
```

A freshly created table grants nobody anything, so there was nothing for a `REVOKE` to take away.
**The guarantee rested on the `GRANT` being narrow, not on the `REVOKE` being present** — and my
comments said the opposite, in a file whose whole purpose is that one guarantee.

Then the sharper half. Running `GRANT UPDATE ON audit TO dsor_runtime` **as the account that does not
own the table** raises no error at all. PostgreSQL issues a warning and grants nothing. So:

```ts
// proves nothing
expect(await asTheApplication("GRANT UPDATE ON audit TO dsor_runtime")).toBe("allowed");

// the only thing worth asserting
expect(await privilegesOfTheApplication()).toEqual(["INSERT", "SELECT"]);
```

Two rules come out of it:

1. **Never judge a `GRANT` or a `REVOKE` by whether the statement threw.** A migration full of
   `REVOKE`s can run perfectly and leave every privilege in place. Ask the catalogue
   (`information_schema.role_table_grants`) what the role actually holds.
2. **To test a `REVOKE`, grant the thing first.** On a fresh table the line is unreachable. The test
   has to create the situation the line defends against — a privilege arriving via `PUBLIC`, or granted
   directly — and then re-run **the migration**, not a hand-written copy of the `REVOKE`. My first
   attempt issued its own, which proved PostgreSQL works and said nothing about our file.

This is [lesson 18](#18--overlapping-checks-cannot-be-tested-together) wearing different clothes: a
line that cannot fail is not protecting anything yet, and the fix is to reach it rather than to trust
it.
