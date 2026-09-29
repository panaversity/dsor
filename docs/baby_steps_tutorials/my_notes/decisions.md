# Decisions

Numbered, dated, never renumbered. A reversed decision stays, marked superseded — the
same rule [`AGENTS.md`](../../../AGENTS.md) uses, so the two read the same way.

Each entry says **what** was decided, **why**, **what it cost**, and **what was rejected**.
A decision with no stated cost cannot be reviewed later, so every entry has one. "Decided
by" matters because some of these were the learner's call and some were the agent's.

---

## 1 · Learner copies are `my_NN_name`, never the official folder (2026-09-22)

**Decided by:** the tutorial's own convention, followed.
**What:** build in `my_01_one_invoice_in_memory` and so on, beside the official steps.
**Why:** the official `NN_name` folders for steps 01 onward do not exist yet — only
`00_foundation` does. Writing into a name the map reserves would claim work the repository
has not done.
**Cost:** there is nothing to diff a copy against, so the "compare with the official step"
exercise in each README cannot be done yet.
**Rejected:** building as `01_one_invoice_in_memory` directly. That would make the map's
status line false and would present one learner's copy as the tutorial's answer.

## 2 · A `my_` copy never goes in the map or in `docs/status.md` (2026-09-22)

**What:** the tutorial map lists official steps; `docs/status.md` records what the
repository has built. Neither mentions a learner copy.
**Why:** `docs/status.md` is the single authority on what is implemented. Adding personal
work to it would make the one document that has to be trustworthy wrong.
**Cost:** the tutorial's own handover checklist says to update both when a step lands, so
that instruction has to be knowingly skipped every time.
**Rejected:** recording the copies for completeness. Completeness is not the point of that
file; accuracy is.

## 3 · Branch `wania/dev-DSoR-in-baby-steps` for the whole run (2026-09-22)

**Decided by:** the learner, after four names were offered.
**Why:** steps are separate folders, so they never conflict with each other, and one
long-running branch means the branching decision is made once instead of 51 times.
**Cost:** the branch will carry all 52 steps, so its history is long and its diff against
`main` grows for ever. Capital letters in `DSoR` are legal but unusual, and on a
case-insensitive filesystem a lowercase spelling of the same name silently matches while
failing on CI.
**Rejected:** a branch per step, which the tutorial's own "one step per pull request" line
suggests — but that line is written for contributors adding official steps, not a learner
accumulating copies.

## 4 · Many small commits, each green on its own (2026-09-22)

**Decided by:** the learner — "if we want to reverse any change that should be easy and
understandable".
**What:** one commit per separable decision. Verified green by checking each commit out
into a clean directory and running it.
**Why:** a revert is only useful if it lands somewhere that works. The test of a good split
is whether one `git revert` removes exactly one decision.
**Cost:** slow. Step 03 took eight commits and each had to be reconstructed and run.
**Rejected:** one commit per step. The immutability work in step 01 and the command in step
03 both turned out to need removing independently later, which a single commit would have
made painful.

## 5 · Step 01 enforces `DSOR-MON-01`, not just describes it (2026-09-22)

**Decided by:** the learner, presented with the alternative.
**What:** `money()` checks its input against two patterns copied from the normative schema
and throws otherwise.
**Why:** without it the rule was a comment. A hostile review proved
`{ value: "2,500 dollars-ish", currency: "United States Dollars" }` compiled and passed
every test, so the step claimed a rule it did not hold.
**Cost:** arguably a second idea in a step whose stated goal needed no validation. Defended
because step 00's `greet` already throws on bad input, so "a function that refuses" was an
established habit rather than a new concept.
**Rejected:** leaving the type alone and softening the README to "a first cut of
DSOR-MON-01". Honest, but it would have shipped a step whose one rule nothing enforced.

## 6 · `readonly` is always paired with `Object.freeze` (2026-09-22)

**What:** anything a caller is handed is frozen at run time as well as marked `readonly`.
**Why:** discovered by a failing test, not by reasoning. After adding `readonly` to every
field, the mutation test still failed — `readonly` is erased before Node runs the file, so
it stopped nothing. This became the most useful lesson in step 01.
**Cost:** two mechanisms for one intention, and a reader has to be told why both. Freezing
the invoices array specifically is unobservable, because the array is not exported.
**Rejected:** `readonly` alone, which is what the first attempt did and what the test
disproved.

## 7 · Step 02 adds a tenant-id pattern the specification does not require (2026-09-23)

**Decided by:** the learner, after the choice was explained in plain terms.
**What:** `TENANT_ID = /^org_[0-9]+$/` beside the canonical-URI pattern copied from the
normative schema.
**Why:** `DSOR-RID-01b` forbids a name in an address, and the schema's own pattern accepts
`acme` exactly as readily as `org_456` — nothing in the text says which is a name. The
step's stated goal is that a company name is rejected, and no shape check alone can do it.
**Cost:** the pattern is this deployment's convention, not the specification's, and it
would also refuse a perfectly valid opaque id of another shape such as a UUID. Said in the
README rather than implied.
**Rejected:** a registry of known tenant ids, which is closer to what §5 means but is
step 10's subject; and shape-checking only, which would have failed the step's own goal.

## 8 · `formatUri` compares the parts it reads back (2026-09-23)

**What:** after building an address, parse it and check all three parts came back
unchanged.
**Why:** parsing alone is not enough. Building the text coerces, so a missing id arrives as
the word `"undefined"` and `dsor://org_456/invoice/undefined` parses perfectly — a
canonical, permanent address for a record that does not exist. Found by hostile review.
**Cost:** one extra parse per address built, and a comparison a reader has to be told the
reason for.
**Rejected:** trusting the types. They are erased before Node runs anything, so a `null`
from a database row in step 09 would have arrived here as `"null"`.

## 9 · Steps copy normative schemas byte for byte, and the formatter is told to leave them alone (2026-09-24)

**Decided by:** the learner; the change is outside a step folder, so it was not the
agent's to make.
**What:** `docs/baby_steps_tutorials/*/src/schemas/` added to
[`.prettierignore`](../../../.prettierignore).
**Why:** `DSOR-OPR-01` names `operation-contract.schema.json` specifically, so validating
against anything else is not that rule. Byte identity is what makes the claim true rather
than a resemblance. `oxfmt` wanted to rewrite 177 whitespace-only lines across the two
files, which would break the identity and bury a future real change in churn.
**Cost:** a repository file was edited from inside a step session, which the step rules
forbid the agent from doing alone. Nothing enforces the identity either — no check would
notice if a copy drifted a character.
**Rejected:** letting the formatter rewrite them, which keeps everything inside the folder
but makes the README's "copied byte for byte" false; and a nested `.prettierignore` inside
the step, which was tried and does not work.

## 10 · Step 03 validates against the real schema, not a smaller one (2026-09-24)

**Decided by:** the learner, after both options were costed.
**What:** `operation-contract.schema.json` and `common.schema.json` copied unchanged into
the step, 591 lines the reader never reads line by line.
**Why:** only this makes `DSOR-OPR-01` literally true. A hand-trimmed normative schema is
worse than a smaller honest one, because it silently stops enforcing whatever was removed.
**Cost:** two large files in a teaching folder, a cross-file reference the reader meets,
and a step that carries schema machinery it does not explain in full.
**Rejected:** a short schema written for the step, which reads better and would have forced
the README to say "a first cut of DSOR-OPR-01" instead of claiming it.

## 11 · Step 03 became one idea: the command moved to step 04 (2026-09-24, supersedes part of 10)

**Decided by:** the learner — "follow one concept per idea".
**What:** `invoice.issue`'s handler and `issueInvoice` removed from step 03. Its
**contract** stayed. Both the step 03 and step 04 entries in the map were amended.
**Why:** a hostile review judged the step over the line by one idea, and its evidence was
hard to argue with — every unprotected guard it found sat in the parts the command dragged
in, while the validation guards were well tested. The step's own goal needs no command.
**Cost:** the map, a shared file describing the official steps, was edited because of a
learner copy. The step then had to keep a contract with no handler, which needed a
`NOT_YET_IMPLEMENTED` list and two extra checks so the note could not go stale.
**Rejected:** leaving it as two ideas, which the tutorial's rules forbid; and renumbering
to insert a new step, which would have shifted 48 later steps.

## 12 · The command landed in step 04, not a new step (2026-09-24)

**What:** `invoice.issue` is carried out in step 04, alongside the envelopes.
**Why:** not a parking space. A command is what makes an envelope worth having — "this
invoice is already issued" needs a code a caller can act on, and a read's refusals are too
thin to show why envelopes exist. It makes step 04 better, not busier.
**Cost:** step 04 carries both the envelope idea and the first state change, so the "one
idea" question could be asked of it too. Defended because the envelope is the idea and the
command is what demonstrates it.
**Rejected:** a new step between 03 and 04, which renumbers everything after it.

## 13 · Step 04 envelopes refusals and the command's success, but not a read's (2026-09-25)

**Decided by:** the learner, from three costed options.
**What:** every refusal is an error envelope. `invoice.issue`'s success is a `COMMITTED`
result envelope. `invoice.get`'s success keeps handing back the invoice.
**Why:** `result-envelope.schema.json` has no `outcome` value meaning "here is your data".
Three demand proposal machinery; the fourth, `VALIDATED`, means a dry run and forces a
control decision. A read did none of those. Appendix A says the schema covers command and
query results, and it cannot express a query result — a gap in the specification, named in
the README rather than papered over.
**Cost:** the answer type is lopsided, and a reader has to be told why. `COMMITTED` also
charges for a proposal address and a payload hash, both placeholders.
**Rejected:** enveloping everything with `VALIDATED` and `decision: "ALLOW"`, which
validates but says a dry run happened and a control allowed it — two things that did not
happen; and enveloping only errors, which fails the step's own goal.

## 14 · The retry class comes from a table in code, never from the caller (2026-09-25)

**What:** §28's whole code-to-retry table transcribed into `src/envelopes.ts`.
`refusal(code, message)` looks the class up.
**Why:** the schema checks that `retry` holds one of six words, not that it holds the right
one. `CONFLICT` with `safe_same_key` validates cleanly — measured. It pins exactly three
codes (`OUTCOME_UNKNOWN` and `RESOURCE_HELD` to `after_reconciliation`, `BATCH_PARTIAL` to
`per_item`) and leaves twenty-nine alone.
**Cost:** 32 rows of data to keep in step with a specification that may change. Two tests
guard that: one reads the schema's own code list, the other pins every row's value.
**Rejected:** taking `retry` from the caller, which is what the first draft did and what a
mutation sweep showed nine tests could not catch.

## 15 · `ajv-formats` added as a real dependency (2026-09-25)

**What:** `ajv-formats@3.0.1`, pinned exactly, not a `devDependency`.
**Why:** without it ajv prints `unknown format "date-time" ignored` and then accepts
`"tomorrow"` as a date. A step teaching schema validation should not ship a validator that
quietly skips a check. Not a `devDependency` because `src/` imports it at run time, so
`pnpm test` would pass while `pnpm start` failed for anyone installing the folder alone.
**Cost:** a CommonJS package, so the callable sits on `.default` and a cast is needed to
satisfy `tsc` — noise a reader has to have explained.
**Rejected:** doing without it, which leaves a silent hole; and `devDependency`, which
breaks the standalone promise.

## 16 · The store reports a fact; the answering layer picks the code (2026-09-25)

**What:** `issueInvoice` returns `issued`, `not_found` or `not_draft`. `operations.ts`
turns that into `CONFLICT` or `RESOURCE_NOT_FOUND`.
**Why:** an error code is part of an answer to a caller, not part of storing data. With the
store throwing, there was something to catch and translate; with it reporting, the outcome
is a value and the layer that answers reads it. That separation is what made codes possible
at all.
**Cost:** a small union type a reader meets for the first time here.
**Rejected:** throwing and catching, which is what step 03 did and what made every refusal
an untyped sentence.

## 17 · Defects from an earlier step are reported, not patched forward (2026-09-25)

**What:** six test gaps found in step 04's copies of `money.ts` and `uri.ts` were written
down, not fixed in step 04.
**Why:** the tutorial's rule is that a bug from an earlier step is fixed in the earliest
step that has it and repeated forward by hand. Fixing it in a later copy would make the
steps diverge, so the diff between them would stop being the lesson.
**Cost:** the gaps stay open in every step until someone fixes step 01 and step 02 and
repeats the fix forward — including `TENANT_ID` without its anchors, which accepts
`xorg_456` and is a real `DSOR-RID-01b` hole.
**Rejected:** fixing them where they were found, which is faster and quietly breaks the
copy-forward model.

## 18 · These notes live in `my_notes/`, outside every step folder (2026-09-25)

**Decided by:** the learner asked for notes; the location was the agent's call.
**Why:** a step folder has to run standalone outside the repository, so nothing that is not
part of a step belongs inside one. `my_notes` sits beside the `my_NN` copies, matching the
`my_` convention for "this is the learner's, not the tutorial's".
**Cost:** `pnpm guard` walks every markdown file, so these notes are inside the checked
surface: a mistyped rule id or a dead link here fails the repository's guard.
**Rejected:** a `notes/` directory at the repository root, which collides with an existing
branch that already puts `notes/DSoR-baby-steps-notes.md` there; and putting notes inside a
step folder, which would travel into every later copy.

## 19 · The six gaps were closed by extending existing tests, not adding new ones (2026-09-25)

**Decided by:** the learner asked for the fix; the shape was the agent's call.
**What:** the missing cases were added to the tests that already covered those rules —
`money.test.ts`'s two refusal tests and `uri.test.ts`'s `DSOR-RID-01b` test — rather than
written as new `it` blocks. Then propagated forward into every later copy.
**Why:** the counts stay at 13, 24, 53 and 79, so no README had to change. Four READMEs
quote test counts and break-it output, and a count written from memory has already been
wrong three times in this work — see [lessons 4](lessons.md#4--writing-counts-from-memory).
Fewer numbers to move is fewer chances to move one wrongly. The cases also read better
beside the rule they test than in a block of their own.
**Cost:** the two refusal tests are now longer, and a failure names the test rather than
the exact gap, so a reader has to look at which assertion failed. The `NEW IN STEP` marker
line differs between step 01 and the later copies, so propagating forward is a copy plus
one comment edit rather than a plain copy.
**Rejected:** one new test per gap, which names each gap in its own title and would have
moved every count in four READMEs and their break-it blocks.

## 20 · The real cause was the currency pattern, not "trailing junk" (2026-09-25)

**What:** the gaps are pinned by cases that are wrong *late* in the text, not at the start:
`--12.5`, `1.5.5`, `31400.00.00` for the value, and `fakeUSD`, `USDollars`, `EURO`, `US1`,
`123` for the currency. For the address: `xorg_456`, `org_456x`, `notorg_456`, `org_`.
**Why:** the first diagnosis — "nothing tests trailing junk" — was wrong, and verification
caught it. Trailing junk on the *value* was already tested: `"2,500 dollars-ish"` and
`"31400."` both start with something valid and carry rubbish after it. What was untested
was the value's two **quantifiers** and the currency pattern in every direction at once.
**Cost:** none, beyond having written the wrong cause down first and needing to correct it.
**Rejected:** nothing — this is a correction, recorded because the wrong version was
published in these notes before it was caught.

## 21 · No login, no answer (2026-09-28)

**Decided by:** the learner, asked in plain terms and given the alternative.
**What:** a call with no logged-in caller is refused with `AUTHENTICATION_REQUIRED`, retry
`never`.
**Why:** `DSOR-IDN-01` turns every caller into a principal "before any other processing" —
with nobody logged in there is no principal, so the request has not really started. And the
step exists to teach that you cannot claim to be someone you are not; if a call with no
login at all still worked, anyone wanting to skip the checks would simply not log in.
`AUTHENTICATION_REQUIRED` has sat unused in step 04's table since it was written, and
`never` is the right class: trying again without logging in cannot help.
**Cost:** every existing call has to start passing a login — about eighteen places in the
tests. Mechanical, but real.
**Rejected:** letting an anonymous caller through as a guest. Cheaper today, and it is
exactly the hole the step exists to close.

## 22 · The login can be switched between people (2026-09-28)

**Decided by:** the learner.
**What:** a small directory of the story's people — `user_123`, `cfo_100`,
`accounts-payable-fte` — and a login that can name any of them.
**Why:** it costs almost nothing now and it is what makes step 06 possible. Deny-by-default
is only demonstrable with two callers: one allowed to do a thing and one refused. With a
single fixed person there is no contrast to show.
**Cost:** a directory of principals is a small store this step has to hold, and `DSOR-IDN-01`
wants memberships on each one, so it is slightly more than a name.
**Rejected:** one fixed caller, which is less to build and leaves step 06 with nothing to
contrast.

## 23 · An agent logs in as itself, and the login holds exactly one name (2026-09-28)

**Decided by:** the learner — "agent should have it's own credential and identity".
**What:** an agent is an ordinary entry in the people list with `type: "agent"`, and logs in
the same way a person does. The login carries **one** field, who you are. There is no second
field for "and I am acting for someone else".
**Why:** `DSOR-IDN-02a` says an agent MUST authenticate with its own credentials, never a
human's session. With one field there is nowhere to put a borrowed identity, so the rule is
honoured by the shape of the code rather than by a check that could be removed. It also
matches the wire schema, which forces `actor_chain` to be empty for a `direct` login.
**Cost:** an agent acting *for* a person — `on_behalf_of`, the running example's normal case
— cannot be built here at all. That needs a delegation record, which is step 18.
**Rejected:** adding a second field in order to refuse it. That would make the rule a check
rather than a property, and a check can be deleted. It would also invent a login shape the
specification does not have.

> **Corrected 2026-09-28 — see [decision 27](#27--dsor-idn-02a-was-an-overclaim-and-the-shape-argument-was-wrong-2026-09-28).**
> The decision to keep one field stands. The claim that it *honours* `DSOR-IDN-02a` does not.


## 24 · The caller's name travels in its own parameter, never the request-id slot (2026-09-28)

**Decided by:** me, after writing the bug and catching it in the same hour.
**What:** `refusal(code, message, requestId?, principalId?)` — a fourth parameter — and a
small `correlationFor(requestId, principalId)` that builds the correlation object. The
`principal_id` key is left out entirely when there is no caller, rather than set to a
placeholder.
**Why:** the first version passed `askedBy` as the third argument, which was `requestId`.
It typechecked, every test passed, and the caller's name was being filed as the request
id. Two different identifiers in one positional slot is a bug waiting for whoever writes
the next call site, so the slot was split. Leaving the key out when nobody is logged in is
the honest shape: an absent caller is absent, and `"(nobody)"` inside an audit field would
read like a principal named "(nobody)".
**Cost:** a four-parameter function, which is one more than is comfortable, and every call
site has to pass `undefined` for the request id to reach the fourth. Step 07's pipeline
will likely replace all of it with one context object.
**Rejected:** passing an object instead of positional parameters, now. It is the better
shape and it is what step 07 will need, but changing the signature of a function step 04
introduced would have made this step about refactoring rather than about identity.

## 25 · Where the caller's name is read from is documented in the code, because no test can prove it (2026-09-28)

**Decided by:** me, after a mutation survived and the probe showed why.
**What:** `askedBy` is read from `who.principal.id` — the principal the directory lookup
returned — and never from `login.loggedInAs`, the text the caller typed. A five-line
comment above it says why. There is no test for it.
**Why:** the mutation sweep changed it to read the typed text instead, and all 100 tests
still passed. That looked like a test gap, so it was probed: with the lookup matching on
`===`, the two strings are always identical, so no input can tell them apart. It is an
*equivalent mutant* — unkillable, not untested. Making the lookup case-insensitive for one
throwaway run made them diverge at once: the real code answered `cfo_100` while the mutant
answered `CFO_100`, the caller's own typing echoed back as their identity. So the
difference is real but only becomes observable the day the lookup gains any leniency — a
case fold, a trim, an alias. A comment is the only thing that survives to that day.
**Cost:** a guard with no test, which normally means decoration. Recorded here so it is not
mistaken for one.
**Rejected:** writing a test that asserts the source of the string by inspection, for
example spying on `findPerson`. It would pass whether or not the code was right, because
both versions call the lookup; only what is *done with the result* differs.

## 26 · Step 05 keeps identity internal — the wire document waits, and this needs the learner's answer (2026-09-28)

**Decided by:** me, provisionally, and flagged rather than settled.
**What:** the step builds a principal *inside* the program. It does not build or validate
the specification's `security-context` document, the schema for what an authenticated
caller looks like when it arrives over a wire.
**Why:** one new idea per step. "Who is calling, and refuse when nobody is" is the idea;
"and here is the schema that shape must satisfy at the boundary" is a second one, and it is
the one that drags in the `actor_chain`, the authentication method and the delegation
reference — none of which exist yet. Steps 01 to 04 each validated their artefact against a
real normative schema, so leaving this one unvalidated is a genuine break in the pattern,
which is why it is written down instead of quietly skipped.
**Cost:** the step's `Login` and `Principal` types are this program's own invention, not the
specification's. If the learner later wants the schema, the shapes will have to move to
match it, and the notes for steps 01 to 04 all say that copying a schema early is what
stopped exactly that kind of drift.
**Rejected, for now:** building both in one step. Also rejected: inventing a shape that
merely resembles the schema without validating against it, which is the worst of the three —
it would look like conformance and be nothing of the kind.
**Still open:** whether step 05 should be reopened to add the document, or step 06 should
carry it. The learner has not been asked yet in plain terms. Recorded in
[open-questions.md](open-questions.md).

## 27 · `DSOR-IDN-02a` was an overclaim, and the shape argument was wrong (2026-09-28)

**Decided by:** two hostile review passes, independently, and the tutorial map agreeing with
both.
**What:** `DSOR-IDN-02a` moves out of the rules step 05 meets and into the rules it does not
claim. [Decision 23](#23--an-agent-logs-in-as-itself-and-the-login-holds-exactly-one-name-2026-09-28)
keeps its decision — the login holds one field — and loses its justification.
**Why:** the rule is *"an agent MUST authenticate with its own credentials, never a human's
session."* Nothing in step 05 authenticates anything. So `accounts-payable-fte` can send
`{ loggedInAs: "cfo_100" }` and every answer, and the envelope inside it, records `cfo_100` —
which is exactly the failure §12 describes: *"the log would say the supervisor did
everything."* One field stops a caller **declaring** two identities. It does nothing to stop
one **borrowing** a single identity that is not theirs, and borrowing is the half the rule is
about.

The "honoured by the shape" argument was also weaker than it was written down as. A fresh
object literal with an extra field is a compile error, but the same object through a variable
typechecks, so the real protection is "nothing reads the extra field" — which is a check, and
a check can be deleted. The sentence claimed the strong form.

The map says the same thing plainly, and was not read closely enough: it assigns step 05
`DSOR-IDN-01, DSOR-SRC-02a` and nothing else, and it assigns `DSOR-IDN-02a` to step 44, the
identity-binding step.
**Cost:** the step loses its second claimed rule and keeps one. That is the honest count, and
it makes step 05 the first step here whose README claims a single rule.
**Rejected:** keeping the claim with a hedge such as "honoured in spirit". A rule is met or it
is not; a hedge in a conformance table is the thing critical rule 4 exists to stop.

**How this got past me.** I wrote the claim while designing the type, believed it because the
type really does forbid something, and never asked whether the thing it forbids is the thing
the rule forbids. That is [lesson 6](lessons.md) — claiming a rule without its condition —
recurring for the second time, and this time in a step's central sentence rather than in a
footnote. The check that would have caught it costs one minute: read the rule's own sentence
last, after the code is written, and ask which clause the code satisfies.

## 28 · The caller's arguments are copied once, and refused if they cannot be written down (2026-09-28)

**Decided by:** me, on a review finding that came with a working demonstration.
**What:** `callOperation` does `Object.freeze({ ...args })` before anything reads the
arguments, and everything below uses that copy. If the copy cannot be `JSON.stringify`-ed,
the call is refused with `VALIDATION_FAILED` before the operation runs.
**Why:** two holes, one cause — the arguments belong to the caller and were being used after
the fact.

The first: a property can be a *getter*, so reading it twice can give two answers. The
arguments were read once to decide which invoice to issue and again to fingerprint the
receipt, so a caller could have INV-1009 issued while the receipt fingerprinted a request for
an invoice that does not exist. The review demonstrated it: the hash matched the decoy, and
nothing threw. Evidence that describes a different request than the one performed is worse
than no evidence, because it looks like evidence.

The second: an argument that cannot be hashed at all — a circular object, a `BigInt` — let
the invoice be issued and *then* threw on the way out. A side effect with no envelope, no
error code, and no record of who caused it. Refusing first is the first small shape of
`DSOR-EXE-03a`, "the intent record is written before the side effect".
**Cost:** one copy per call, and a `try` around a `JSON.stringify` whose result is thrown
away, which looks odd until the comment beside it is read.
**Rejected:** hashing the payload before the store is touched and keeping the single read.
It fixes the second hole and not the first, and it leaves "read the caller's object twice"
in the code for a later step to trip over.

## 29 · Every answer is frozen, not only the envelope inside it (2026-09-28)

**Decided by:** me, on a review finding.
**What:** every `OperationAnswer` is `Object.freeze`-d before it leaves `callOperation`.
**Why:** `OperationAnswer` was the one `readonly` type in this step with no freeze beside it.
The envelope inside it was frozen, and its correlation, and the invoice — but not the wrapper
carrying `askedBy`, which is this step's entire record of who asked. A caller could rewrite it
on the object they were handed. This is exactly the trap [step 01](step-01-one-invoice-in-memory.md)
exists to teach, in the step's own new type, written by someone who had just finished teaching
it. That is worth recording more than the fix is.
**Cost:** none worth counting.
**Rejected:** freezing inside each handler. Nine sites to remember instead of one, and the
next step adds more.

## 30 · A login is checked as data, not trusted as a type (2026-09-28)

**Decided by:** me, on a review finding.
**What:** `principalFrom` refuses unless the login has its **own** `loggedInAs` property and
that property is a string. Previously it only checked `login === undefined`.
**Why:** `Login` is a TypeScript type and types are erased before Node runs, so at run time
`null` arrived and the function threw `TypeError: Cannot read properties of null` — from the
function whose entire job is to refuse, in a file whose header says nothing throws at a caller
any more. `Object.hasOwn` is the second half: a name the object merely *inherits* is a name
nobody in this program chose, and without it an empty object with a polluted prototype logs in
as whoever the prototype names.
**Cost:** a condition with two clauses where there was one, in the first lines a learner
reads.
**Rejected:** trusting the type because "the compiler checks the callers". It checks the
callers inside this folder. Step 06 onwards puts real input in front of this function, and a
guarantee that depends on every future caller being well-typed is not a guarantee.

## 31 · The attribution test walks three callers, because one caller cannot tell a name from a constant (2026-09-28)

**Decided by:** a review finding that beat my own mutation sweep.
**What:** the test that walks every answer shape logs in as `user_123`, `cfo_100` and
`accounts-payable-fte` in turn, and asserts the recorded name equals **the login's own name**
rather than a literal.
**Why:** my sweep mutated each of the attribution sites one at a time and every one was
caught, so I recorded the guarantee as proven. The review mutated them **all at once**, to the
constant `"cfo_100"` — the single login the test used — and all 100 tests passed. The suite
could not tell "carries the caller's name" from "carries that one string", so `user_123`'s
refusal could be stamped with the CFO's id with the step fully green.
**Cost:** the walk runs three times, which is 36 calls instead of 12. Milliseconds.
**Rejected:** nothing. This is a correction to how the sweep is run, not a choice between
options: **mutating one site at a time cannot find a test whose expected value is a constant.**
Added to [lessons.md](lessons.md).

## 32 · The `security-context` document is built at step 42, not 05 or 06 (2026-09-28)

**Decided by:** the learner, on my recommendation, closing
[open question 2](open-questions.md).
**What:** step 05 stands as built. Step 06 is not asked to carry the wire document either.
The specification's `security-context.schema.json` is copied and validated at **step 42**,
`42_a_rest_api`, where an HTTP server first puts a caller outside the program.
**Why:** three reasons, in order of weight.

1. **There is no wire to cross yet.** `DSOR-SCH-01` says an artifact must validate *"wherever
   it crosses an interface or is stored as evidence."* In step 05 the login is an argument
   handed to a function inside one program. Nothing crosses. Step 42 is the first step where a
   caller is genuinely outside, and that is the first moment the document has a job.
2. **Step 05's shape is not homemade.** Its `Principal` matches the interface in
   [§12](../../../specs/dsor/02-security.md#12-identity-and-principals), `memberships`
   included. The wire schema is a *second* artifact describing the same idea at a boundary —
   snake_case, `subject` and `subject_type`, no memberships. Keeping both and saying which is
   which is what open question 2 proposed in the first place.
3. **One new idea per step.** Step 06 is permissions. Adding "and here is the shape identity
   arrives in" makes it two.

**What the check actually found, and it is not what the question assumed.** The question was
framed as "which step owns this, 05 or 06?" Searching the map for `security-context`,
`identity_mode`, `actor_chain` and `subject_type` returns **nothing**, across all 52 steps, and
`DSOR-SCH-01` is named at exactly one step — 04. So no step owns it. This is a **gap in the
map**, not a defect in step 05, and step 05 matches what the map asked of it exactly.
**Cost:** 37 steps are built on the internal shape before the wire shape appears. That is the
risk [decision 26](#26--step-05-keeps-identity-internal--the-wire-document-waits-and-this-needs-the-learners-answer-2026-09-28)
named, and it is accepted rather than dismissed: the two shapes describe the same idea, so step
42 will be writing a translation, not a rewrite.
**Rejected:** reopening step 05, which makes it a two-idea step and validates an artifact that
crosses nothing. Also rejected: putting it in step 06, for the same reason plus displacing the
step's own idea.

**To do at step 42.** Copy `packages/spec/schemas/security-context.schema.json` into the step,
build a `direct`-mode document from the authenticated caller, validate it with ajv, and keep
the internal principal as the normalized form. The three identity modes are the teaching
opportunity that [open question 3](open-questions.md) describes: `direct` forces `actor_chain`
empty, and `unattended` requires a `delegation` and a role source, so the schema itself refuses
to let an early step fake the running example's usual case.

## 33 · Permissions hang off a role, not off a person (2026-09-28)

**Decided by:** the learner, given both options in plain words.
**What:** a principal carries a **role name**. A separate table says what each role may do.
`user_123` is an `ap_supervisor`; `ap_supervisor` holds `invoice:read` and `invoice:issue`.
**Why:** the rule is `DSOR-AUT-01a`, *"role-based access control using the
`<resource>:<action>` permission format"* — role-based is in its name, so a list of strings
hanging off each person would not let the step claim it. After [decision 27](#27--dsor-idn-02a-was-an-overclaim-and-the-shape-argument-was-wrong-2026-09-28)
that matters more than usual. It is also how the thing works in real life: a new joiner is
given a role, not twenty strings, and a role's grants are changed in one place.
**Cost:** one more small table, and one more hop to follow when reading the code.
**Rejected:** permissions directly on the person. Fewer moving parts and one less idea, but it
cannot honestly claim the rule.

## 34 · The CFO may not issue invoices (2026-09-28)

**Decided by:** the learner.
**What:** `user_123` (`ap_supervisor`) and `accounts-payable-fte` (`ap_worker`) may read and
issue. `cfo_100` (`approver`) may read invoices and approve payments, and may **not** issue
them.
**Why:** it is what actually happens in a company — a CFO signs off on payments, they do not
do accounts-payable data entry. It teaches the thing beginners get wrong about permissions,
which is that they are not a ladder: more senior does not mean more of them. And it gives the
step the exact demonstration the map asks for — "a caller with `invoice:read` can read and
cannot issue" — using a person already in the story instead of inventing a read-only extra.
**Cost:** the agent keeps `invoice:issue`, so this step cannot tell the "a changed prompt
cannot do more than it was granted" story with the agent as the victim. Step 18's delegation
limits are where that lands.
**Rejected:** making the agent the read-only one. It tells the prompt-injection story more
directly, and it leaves the agent unable to do the work it exists for in every later step.

## 35 · A refusal does not name the permission that was missing (2026-09-28)

**Decided by:** the learner.
**What:** `AUTHORIZATION_DENIED` says that the caller may not call the operation. It does not
say `invoice:issue was not granted`.
**Why:** the same reason step 05's two login refusals are word for word identical
([decision 21](#21--no-login-no-answer-2026-09-28)). A message that names the missing
permission is a map for whoever is probing: ask for twenty operations and the refusals tell
you the shape of the whole permission model. The detail belongs in the audit record, which
step 08 builds, where the operator can read it and the caller cannot.
**Cost:** a developer debugging a role has to look at the roles table instead of reading the
error. Real, and the README says so.
**Rejected:** naming the permission. Kinder while learning, and it answers questions for
people who should not be asking them.

## 36 · A role is looked up with `Object.hasOwn`, not with a plain index (2026-09-29)

**Decided by:** a hostile review finding, reproduced by hand before the change.
**What:** `permissionsOf` returns `NOTHING` unless `Object.hasOwn(ROLES, principal.role)`, rather
than relying on `ROLES[principal.role] ?? NOTHING`.
**Why:** the plain version walks the **prototype chain**, so `?? NOTHING` only fires when the
chain also misses — and twelve role names never miss. A principal with `role: "toString"` got
`Object.prototype.toString`, a function, and `holds` then called `.includes` on it and threw a
raw `TypeError` at the caller instead of answering no. Worse, anything written to
`Object.prototype` became a role granting whatever it liked: with
`Object.prototype.attacker_role = ["payment:execute"]`, `holds` said **true** to a permission no
role in the table grants, `checkPermissions` had never validated it, and `Object.keys(ROLES)` did
not show it.

The doc comment above the function claimed "a role nobody defined grants **nothing**" and ruled
out throwing as "the wrong shape". Both halves were false for those twelve names, in the doc
comment of the function the step is named after.

Not reachable through `callOperation` today — `principal.role` is only ever written by the frozen
cast in `people.ts` — and the reviewers said so themselves and downgraded it. It matters because
steps 18 and 19 feed roles from an external source, and because a false written guarantee is its
own defect.
**Cost:** one branch, and a comment longer than the code explaining why the obvious version is
wrong. Worth it: the obvious version is what a reader would write.
**Rejected:** `Object.create(null)` for the table, or a `Map`. Both fix it and both are better
engineering. `Object.hasOwn` was chosen because it is **the same fix, with the same call, that
`login.ts` already uses eighty lines away** — so the two guards now read as one idea rather than
two tricks.

## 37 · Everything a caller sends is read through one helper that cannot throw (2026-09-29)

**Decided by:** a hostile review finding.
**What:** `ownString(from, key)` in `login.ts` — the only way a caller-supplied property is read.
It returns `undefined` for `null`, a non-object, a name the object merely inherits, a non-string
value, **and a getter that throws**. And in `operations.ts` the argument copy moved inside the
`try` that was already there.
**Why:** `src/operations.ts` says nothing throws at a caller any more. Two things did.
`{ get loggedInAs() { throw new Error("boom") } }` came back as `Error: boom` rather than
`AUTHENTICATION_REQUIRED`, and the same trick in the arguments escaped because
`Object.freeze({ ...args })` — which runs every getter — sat one line above the `try`. A stack
trace is not an envelope a caller can act on, and it is the exact shape `DSOR-ERR-01a` exists to
prevent.
**Cost:** a helper with four conditions where there was one inline check, in the first lines a
learner reads. The comment lists all four with the input that motivates each, so it reads as a
list of real attacks rather than defensive noise.
**Rejected:** wrapping `callOperation`'s whole body in a `try`. It would catch these and also
swallow genuine bugs in the operation, turning a crash that should be fixed into a
`VALIDATION_FAILED` blamed on the caller.

## 38 · A piece that can be tested alone gets attacked before anything depends on it (2026-09-29)

**What:** the rebuild put the roles table and `holds` in piece 1 with **no gate at all**, so
nothing refused anybody and the file knew nothing about operations. The gate came in piece 2.
**Why:** this was done for teaching and turned out to matter for correctness. The first build
wrote the table, the lookup, the gate and the start-up check together, and shipped three defects.
The rebuild found all three — because in piece 1 `holds` was the only thing to attack, so it got
attacked properly: odd role names, prototype keys, prefixes, freezing. In the first build those
same questions competed for attention with an operation pipeline.

The rebuild ended at 130 tests against 126, and the extra four are not padding: they are the four
holes. So "build the smallest testable piece first" is not only easier to follow — it changes
what you think to attack.
**Cost:** five commits and five rounds of breaking instead of one. On a step this size, an
afternoon.
**Rejected:** nothing. This is a note about method, kept because the evidence for it is unusually
clean: the same step, the same author, built both ways, two days apart.

## 39 · Step 04's false claim was narrowed, not fixed by adding a guard (2026-09-29)

> **Superseded by decision 43, the same day.** The claim was not narrowed in the end — the code was
> fixed, because the guard belongs to step 04 after all. The reasoning below is kept because it was
> the reasoning at the time, and [43](decisions.md) explains what was wrong with it.

**Decided by:** me, on an audit finding.
**What:** step 04's header said *"nothing here throws at a caller any more"*. It now says every
refusal this step knows about comes back as an envelope, names the hole that is left, and says
step 05 closes it.
**Why:** the hole is real — `success()` hashes the caller's arguments *after* the invoice has been
issued, so an unhashable argument lets the change happen and then throws. Two ways to make the
sentence true: fix the code, or fix the sentence.

Fixing the code in step 04 would mean adding the argument copy and the serializability check
there, which is a third idea for a step an audit had just flagged for having two — and it would
take away step 05's reason to exist for those guards. Fixing the sentence costs a paragraph and
leaves the progression legible: step 04 introduces envelopes, and the hole in them is the thing
step 05 closes.
**Cost:** a step in the tutorial ships with a known crash-after-commit in it. That is only
acceptable because it is *named*, in the file where a reader meets it, with the step that fixes it.
An unnamed one would not be.
**Rejected:** adding the guard to step 04. Also rejected: leaving the sentence, which is critical
rule 4 — never claim what the code does not do.

## 40 · The tutorial's rule ids are checked by hand (2026-09-29)

**Decided by:** forced by a discovery, and the alternative needs a decision that is not the
learner's alone.
**What:** after any edit that adds or changes a `DSOR-` id in a step or in these notes, the id is
looked up in `requirements.json` by hand. The notes' README says so where it used to claim the
guard did it.
**Why:** `pnpm guard` strips inline code spans before hunting for identifiers. The specification's
prose writes ids bare, so the check works there. The tutorial writes every id in backticks, so the
check has never seen one of ours — proven by probe, and it had already let `DSOR-SOD-01` through,
which is not a rule.
**Cost:** a manual step that will be forgotten. Mitigated only by the warning sitting in the
directory's README rather than in a commit message nobody re-reads.
**Rejected, for now:** extending `scripts/guard-spec.mjs` to look inside backticks. It is the
right fix and it is repository infrastructure, not tutorial content: the code spans are stripped
for a reason, and the spec's own prose may show illustrative ids that are meant not to resolve.
It belongs in a pull request that checks what breaks in `specs/dsor/` first.
See [open question 4](open-questions.md).

## 41 · Step 05 keeps three ideas, and says so on the page (2026-09-29)

> **Superseded by decision 43, the same day.** Step 05 is one idea again: the two argument guards
> moved to step 04, where the promise they keep lives. Kept because the argument below is the one
> that had to be answered, not dismissed.

**Decided by:** me, on an audit finding I agree with and am not acting on.
**What:** step 05 carries its one idea — who is calling — plus two guards that are about argument
handling: the arguments are copied once, and a request whose arguments cannot be written down is
refused first. A new section in its README says this plainly, under the heading "Three things,
where the rule says one".
**Why:** the audit is right that they do not belong to identity, and the second is explicitly an
early instalment of step 08's own rule. The reason they stay is that they close holes that are
**open in step 04**, and both were found by a hostile review after the step looked finished.
Moving them to step 08 means thirteen steps in which a caller can crash a command that already
succeeded. Keeping a rule about step boundaries tidy is not worth that.
**Cost:** the one-idea rule is broken in a visible place, which weakens it everywhere else. Naming
it in the step is the only thing that stops that being a quiet precedent.
**Rejected:** a step 05b for the two guards. It is the tidiest answer and it renumbers nothing,
but it splits identity from the fix to the bug identity exposed, and a learner meeting 05b would
have to hold both halves anyway.

## 42 · The guard now reads inline code spans, with a named list of the four ids that may be fake (2026-09-29)

**Decided by:** the learner — "fix all problems" — after
[decision 40](#40--the-tutorials-rule-ids-are-checked-by-hand-2026-09-29) had parked it as a
change too risky to make blind.
**What:** `scripts/guard-spec.mjs` checks `DSOR-` identifiers inside inline code spans as well as
in plain prose, so the tutorial's ids are finally covered. A small `ILLUSTRATIVE` map names the
four ids that appear on purpose and do not resolve, each with the reason. A new `stale-example`
check fails if any of those four stops being used.
**Why:** decision 40 left this open because the code spans are stripped for a reason and nobody
had measured what that reason cost. Measuring it took one script: across all 60 markdown files,
checking code spans would fail on **four** ids, and all four are deliberate examples —
`DSOR-DEL-04` and `DSOR-DEL-11` in the `change-the-spec` skill, which is the document that
teaches how ids are split and numbered, and the two in these notes. Prose about identifiers must
be able to name one that does not exist. So the risk was real, bounded, and nameable — which is
the difference between a change that needs an allowlist and a change that cannot be made.

Proven three ways rather than reasoned about, which is [lesson 14](lessons.md) applied to the fix
for lesson 14: a bogus id in backticks now fails, a bogus id in plain text still fails, and
removing the skill's use of `DSOR-DEL-11` produces
`error: stale-example — DSOR-DEL-11 is listed as illustrative and no file mentions it any more`.
**Cost:** this is the first change in this work to repository infrastructure rather than to a
learner copy, and it changes a check every contributor runs. The blast radius was measured before
the edit rather than after it, and the four exemptions are in the script where a reviewer of that
script will see them — not in a config file somewhere else.
**Rejected:** checking code spans only under `docs/baby_steps_tutorials/`. It would have needed no
allowlist and it would have left the same hole open for the specification's own prose, which is
where a wrong id costs the most.
**Rejected:** keeping the hand-check from decision 40. It worked exactly once — the time somebody
was looking.

## 43 · Step 04 keeps its own promise, and step 05 is one idea again (2026-09-29)

**Reverses:** decisions 39 and 41 above, both taken earlier the same day.
**Decided by:** the learner — "do all these 4 points thoroughly" — which made me look again at two
things I had argued should stay.
**What:** the argument guards move from step 05 to **step 04**: the caller's arguments are copied
once, and a request whose arguments cannot be written down is refused before anything runs. Their
tests move with them, into a `test/arguments.test.ts` of their own. Step 04's header claims again,
truthfully, that nothing throws at a caller. Step 05 is back to one idea — who is calling — and its
README says which guards it inherited and what it adds on top.
**Why I changed my mind.** Decision 39 assumed the guard would be a *third idea* for step 04. That
was the wrong way to count it. Step 04's idea is **every answer is an envelope**. A path that throws
instead of enveloping is not a new idea — it is a **hole in that idea**, and the guard that closes
it is part of finishing the step's own work. Put that way, it never belonged in step 05.

And it resolves both findings at once instead of writing prose about each. Step 04 no longer ships
a crash-after-commit, so the paragraph naming the hole is gone rather than carefully worded. Step 05
no longer breaks the one-idea rule, so the section explaining why it does is gone too. Two honest
notes replaced by nothing to note, which is better.
**Cost:** step 04 grows by two tests and about twenty lines of comment, and its break numbers moved
for the third time in a day — every quoted count in three READMEs had to be re-run again. The
earlier decisions were not wrong to record; they were the right call *given* the wrong way of
counting ideas, and finding the better framing took a second pass.
**What this says about the method:** "is this one idea?" is not answerable by counting the things a
step does. It is answerable by naming the step's promise and asking which of those things the
promise requires. Step 04 promises envelopes; a guard that stops a throw is required. Step 06
promises may-you; the same guard would not have been.
