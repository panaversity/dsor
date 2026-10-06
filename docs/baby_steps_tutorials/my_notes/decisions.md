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

## 44 · `TENANT` moves to a module of its own (2026-09-29)

**Decided by:** the learner — "do all these 4 points thoroughly" — closing
[open question 5](open-questions.md), which had been parked as not worth touching yet.
**What:** `src/tenant.ts` in steps 03 to 06, holding the one company id. `invoice.ts` imports it
like everybody else.
**Why:** the tenant is a fact about **identity** — which company a caller belongs to, which records
they may touch. It lived in `invoice.ts` because that was the first file that needed it, which by
step 05 meant the identity module imported the company id from the invoice module. Backwards: who
you belong to does not depend on what an invoice is. And step 10, which makes more than one company
possible, now replaces one small file instead of unpicking a constant out of a module that has
nothing to do with tenancy.
**Cost:** four folders touched for a change no test can see, which is the kind of edit that
introduces a mistake while fixing a smell. Mitigated by doing it in one mechanical pass with all
six suites green before and after.
**Rejected:** leaving it for step 10, which is what open question 5 recommended. That was the right
call while the question was "is this worth a detour"; it stopped being right once the answer was
"do all of it".

## 45 · The pairing sentinel is a count in every step that has one (2026-09-29)

**Decided by:** an attack on step 03, which found the same hole
[lesson 12](lessons.md) had already named in step 06.
**What:** `assertPaired` returns how many pairs it walked, and every step from 03 onward exports
`PAIRS_CHECKED: number` rather than `WIRING_CHECKED: boolean`.
**Why:** step 03's headline idea is *refused at start-up, not on first request*, and no test could
tell whether the check had run — deleting the call left all 53 tests green, because the two lists
match today so a passing check is silent. Step 04 had wrapped the call in an IIFE returning `true`,
which reads like proof and is not: lesson 12 was written about exactly that in step 06's permission
table, and the pairing check in steps 04 to 06 still had the weak version. Now all four agree.
**Cost:** hardcoding today's number still passes, so it is not a proof. It moves the mistake from
"delete a line" to "delete a line and keep a number right as the lists change", and the code says
so.
**Rejected:** a child process importing a deliberately mismatched module, which would be a real
proof and costs more machinery than the step teaches.

## 46 · The pipeline is a list of stages, not the shape of a function (2026-09-29)

**Decided by:** the learner, given both options with their costs.
**What:** an ordered array of named stages. Each stage carries its §21 number, a name, whether it
applies to commands only or to both, and a function that either lets the request carry on or
returns a refusal. `callOperation` walks the list and stops at the first no.
**Why:** the order **is** the security guarantee — step 06 proved that by moving one check below
another and watching a caller learn which invoices exist. Until now that order was the order the
lines happened to sit in, and it was reshuffled three times in two days while steps 04 to 06 were
built, with one test catching one of the three moves. As data, the order can be asserted directly,
and a later step adds a stage to a list instead of editing a function it could get wrong.

The other half is `DSOR-OPR-04a`: every interface must invoke the *same* pipeline. There is one
door today and step 42 adds an HTTP server. A list can be handed to a second door; the shape of a
function cannot.
**Cost:** it needs a value carried along the stages — a context — which is real machinery and the
thing [decision 24](#24--the-callers-name-travels-in-its-own-parameter-never-the-request-id-slot-2026-09-28)
predicted would arrive here. It is not a second idea: uniform stages are impossible without it,
which is the same reasoning as [decision 43](#43--step-04-keeps-its-own-promise-and-step-05-is-one-idea-again-2026-09-29).
**Rejected:** one readable function with §21 numbers in comments and an exported list of names for
a test to check. Lighter, and it matches the map's "read the function top to bottom" more directly
— but then the order is convention plus a test that has to be kept honest, and nothing stops a
future step putting a line in the wrong place.

## 47 · Only the stages that exist are in the list, numbered by §21 (2026-09-29)

**Decided by:** the learner.
**What:** the list holds the stages this program has, each carrying its real §21 number. §21 has
seventeen; this step has four. The README carries a table of all seventeen and the step that
brings each.
**Why:** the gaps in the numbering are the roadmap. A list that jumps 1 → 5 → 6 says what is
missing more honestly than thirteen stages that do nothing, and there is nothing empty for a
reader to walk past. Step 03 already taught that an empty container invites the question "why is
this here?" and needs an answer every time.
**Cost:** a later step adds a stage rather than filling a slot, so it has to put it in the right
place. That is exactly the judgement the numbers make checkable.
**Rejected:** all seventeen with the unbuilt ones as skipped placeholders.

## 48 · One list, and each stage says whether it applies (2026-09-29)

**Decided by:** the learner.
**What:** one pipeline. Each stage declares `"both"` or `"command"`. A query runs the stages that
apply to it.
**Why:** §21 is one pipeline with per-kind applicability — it says a query passes through steps 1
to 6 and 9 and reaches 11 — and `DSOR-EXE-01b` forbids skipping a step *that applies to it*, which
only means anything if applicability is a property of the stage. `DSOR-OPR-04a` wants every
interface invoking the same pipeline, and two lists is how two pipelines drift apart: the shared
stages exist twice, so the day one changes they disagree.
**Cost:** the walker needs a condition in it, so a reader cannot see a query's whole path as one
block. The test that lists which stages a query runs is what answers that instead.
**Rejected:** a query pipeline and a command pipeline side by side.

## 49 · The arguments are written down once, and the fingerprint comes from that text (2026-09-29)

**Decided by:** a hostile review of step 07, which found the bug in step 04.
**What:** `success()` takes a `payloadHash` instead of a `payload`, and never touches the caller's
object. A `payloadHash(text)` helper hashes text that was already written. In step 07 the
fingerprint lives in the pipeline context, filled by the stage at §21.6.
**Why:** `success()` used to `JSON.stringify` the caller's arguments a **second** time, to compute
the hash — after the invoice had been issued. An object whose `toJSON` throws on its second call
therefore committed the change and *then* threw at the caller: no envelope, no code, nothing
recording it.

This is the third time this shape has appeared, and the second time in the same family. Step 05's
review found a *getter* that answered differently on a second read; the guard added for it copies
the arguments once. That guard did not help here, because the second read was not of the arguments —
it was of the copy, one layer down, by a function nobody thought of as reading anything.
**Cost:** `success()` no longer takes the thing it fingerprints, which reads as indirection until
the comment beside it is read. Four steps had to be changed.
**Rejected:** hashing inside the existing guard and passing the object along anyway. It fixes this
instance and leaves "a function may stringify the caller's object" true, which is the property that
keeps producing the bug.
**The lesson, which is in [lesson 16](lessons.md):** "read the caller's data once" is not a rule
about one function. It is a rule about every function the data reaches, and the only way to know is
to follow the value.

## 50 · A checklist's order is checked as a sequence, not as a set of names (2026-09-29)

**Decided by:** a hostile review of step 07, which permuted the real stages.
**What:** `REQUIRED` in `src/pipeline.ts` is an ordered sequence, and `assertPipeline` requires the
named stages to appear in that relative order. A §21 number must also be a number §21 has.
**Why:** it was a set of names plus a rule that numbers never descend — and `resolve the operation`
carries `null` by design, so it was exempt from a rule about numbers. A reviewer permuted the four
real stages: **four of the twenty-four orderings passed**, including `resolve the operation` before
`authenticate`, which answers an unauthenticated caller `UNSUPPORTED_CAPABILITY` and tells a
stranger which operations exist. Measured before the change and after: 4 of 24, then 1 of 24.

`assertPipeline`'s own docstring had said it refuses "a stage in the wrong place", and `makeDoor`'s
said a door whose order cannot be trusted should not exist. Both were false, and both were written
before the check that would have made them true.
**Cost:** the check now knows the names of the four stages, so a step that renames one has to
update two places. That is the right coupling: renaming a stage *is* a change to the checklist.
**Rejected:** tying each stage's `at` to its name in a table. It would also catch a renumbered
stage, and it makes the §21 numbers a second source of truth for the order, which is the thing the
name sequence already is.
**What it still cannot do:** see what a stage *does*. A stage called `authorize` that asks nothing
passes. That is now a test rather than a comment — the door that does it lets `cfo_100` issue an
invoice.

## 51 · Step 08 builds the hash chain, and claims `DSOR-AUD-01` properly (2026-09-30)

**Decided by:** the learner, closing [open question 1](open-questions.md), which had been open since
2026-09-25.
**What:** every audit record carries `chain`, `sequence`, `previous_hash` and `record_hash`, and is
validated against the specification's own `audit-record.schema.json` before it is kept.
**Why:** the question was framed as "is the chain a second idea for step 08?" The answer comes from
the test [decision 43](#43--step-04-keeps-its-own-promise-and-step-05-is-one-idea-again-2026-09-29)
settled on: name the step's promise, then ask which parts the promise *requires*. Step 08's promise
is that the decision is written down before the answer **and that it is evidence**. A record that
does not validate against the evidence schema is not evidence. So the chain is required by the
promise, exactly as the argument copy was required by step 04's promise about envelopes.

The alternative was a record in a shape of our own, which every step since 03 has avoided for a
reason that keeps paying: a copied normative schema catches what a shape of our own invention cannot.
It would also mean writing the record twice, once now and once properly at step 39.
**Cost:** about five lines and three fields earlier than the map schedules them. Step 39 keeps the
part that actually needs a database — proving the runtime identity cannot update or delete a record
(`DSOR-AUD-04a`), and verifying a chain across a restart — which a list in memory cannot demonstrate
at all.
**Rejected:** claiming `DSOR-EXE-02` only and naming the four missing fields, which is how step 04
handled a rule it could not meet. Right there, wrong here: step 04 could not have met its rule
without machinery it did not have, and this one needs five lines.

## 52 · The clock is a real clock, with a seam (2026-09-30)

**Decided by:** the learner.
**What:** an audit record's `at` is a real ISO 8601 timestamp from a `now()` the tests can replace.
**Why:** `at` is the field an auditor reads first and the one a record can least afford to fake. A
fixed placeholder would put something untrue in every record and step 09 would have to undo it. The
seam costs one function, makes the README's output stable and the tests exact, and it is the same
seam step 09 needs when the log moves into PostgreSQL.
**Cost:** a mutable module-level binding, which is the shape this repository otherwise avoids.
Contained: only tests set it, and it is reset the way the request-id counter already is.
**Rejected:** a counter and no timestamp. Reproducible for nothing, and it makes every record say
something false.

## 53 · An unauthenticated refusal is counted, not recorded (2026-09-30)

**Decided by:** the learner.
**What:** a call with no login, or a login naming nobody, is refused and a counter goes up. Every
decision from "who are you" onward gets its own record.
**Why:** §29 permits it — *"Rejections at steps 1 and 2, before a tenant is known, MAY be recorded as
aggregated counts, so that an unauthenticated flood cannot fill the audit store"* — and the reason is
a real attack. This is the first point in the tutorial where **the log itself is a resource an
attacker can exhaust**, and that is worth meeting where it first becomes true rather than reading
about later.
**Cost:** two paths instead of one, and a counter that a reader has to be told about. The step's
README says why.
**Rejected:** a record for every refusal including unauthenticated ones. One path and nothing to
explain, and anyone who can reach the program can fill the audit store with rubbish.

## 54 · The intent record is step 36's, not step 08's (2026-09-30)

**Decided by:** the spec and the map, read before writing code.
**What:** step 08 adds one pipeline stage, §21.11 `record the decision`. §21.13 `write the intent
record` is **not** built here.
**Why:** I had told the learner piece 2 would add both. Then `DSOR-EXE-03a` turned out to require
*"the proposal id, operation and version, payload hash, idempotency key, connector, and security
context"* — and this program has no proposals, no idempotency keys and no connectors. An intent
record built now would hold four of six fields and claim nothing. The map already assigns it:
step 36, `36_write_it_down_before_you_act`, together with `DSOR-EXE-03b`, `04a` and `04b`.
**Cost:** the step is smaller than announced, and "write down what you are about to do before you do
it" — the more famous half of §21 — waits 28 steps.
**Rejected:** a partial intent record now, to make the step feel complete. That is a stub with a rule
id on it, which is the thing [decision 27](#27--dsor-idn-02a-was-an-overclaim-and-the-shape-argument-was-wrong-2026-09-28) exists
to stop.

## 55 · One request id per request, minted before the first stage (2026-09-30)

**What:** the door mints the request id and puts it in the `Context`, where it is **required** rather
than optional. Every refusal and every success is handed that same id.
**Why:** `correlation.request_id` is a required field of `audit-record.schema.json`, so step 08 had to
put something there. The id was being minted lazily inside `correlationFor`, whichever envelope
happened to be built first — so it named *an answer*, not *a request*. A record minting its own would
carry a different id from the answer it was about, and nothing could join the two. That is the only
job a correlation id has.
**Cost:** the id is threaded through `principalFrom`, both handlers, `invoiceIdFrom` and every
`refuse` call — one parameter in eleven places. It landed as its own commit, before the record, so the
repair and the feature are separable.
**Rejected:** letting the record mint its own and calling the mismatch a later step's problem. The
record would have looked right in every test and been useless in every investigation.

## 56 · A refusal is carried, not returned, so §21.11 can record a DENY (2026-09-30)

**What:** `Stage` gained `evenAfterARefusal`, `Context` gained `refusal`, and `runPipeline` remembers
a refusal and keeps walking — skipping the remaining checks, running the stages marked to run anyway.
The last refusal wins.
**Why:** §21's own diagram says **RECORD DECISION — always, including DENY**. The walk returned at
the first refusal, so a stage at §21.11 would never have seen one, and every denial would have gone
unrecorded. A denial that is not written down is the failure `DSOR-EXE-02` exists to prevent: an
agent can probe a hundred operations it may not call and leave nothing behind.
**Cost:** the walker is no longer "stop at the first no", which is the simpler sentence. Two new
`assertPipeline` rules pay for it: the recording stage must have the flag on, and nothing before it
may.
**Rejected:** recording from inside `makeDoor`, after the walk. It works, and it moves the order out
of the list and back into a function — undoing [step 07](step-07-the-pipeline-skeleton.md) for the
first stage that needed it.

## 57 · The last refusal wins, so an unrecordable denial is not reported as a denial (2026-09-30)

**What:** when the recording stage refuses, its refusal replaces the one already carried. A call
denied by `authorize` whose record cannot be written comes back
`EVIDENCE_STORE_UNAVAILABLE`, not `AUTHORIZATION_DENIED`.
**Why:** answering `AUTHORIZATION_DENIED` would be answering a refusal we failed to write down, which
is exactly what `DSOR-EXE-02` forbids — and the caller would have no way to know the refusal went
unrecorded. Found by mutation: changing the walker to keep the *first* refusal left all 197 tests
passing, because every test about a failed record used a call that was otherwise allowed.
**Cost:** a caller can be told the evidence store is unavailable when their request was also going to
be refused for a second, unrelated reason. They learn less than they might have, which is the right
way round.
**Rejected:** keeping the first refusal because it is "the real reason". It is the real reason, and
reporting it means claiming the decision was recorded.

## 58 · A record says what was decided, not what happened (2026-09-30)

**What:** `authorization` is `ALLOW` or `DENY` and `result` is `ALLOWED` or the refusal's code — the
**decision**. A call that is authorized and then fails while executing is on the record as `ALLOW`,
and the caller is told `VALIDATION_FAILED`. The record and the answer disagree, on purpose, and a
test asserts that they do.
**Why:** §21 separates them. Step 11 records the decision; step 15 FINALIZE records the outcome as
`COMMITTED`, `FAILED` or `OUTCOME_UNKNOWN`. This step has step 11 and no step 15, so there is nowhere
honest to put "what happened". Found by writing the test the other way round first, asserting `DENY`,
and watching it fail.
**Cost:** `pnpm start` prints a line reading `ALLOWED` for a call the caller saw refused. That looks
like a bug until you know why, so the README says so and the test says so.
**Rejected:** recording the outcome anyway, from the answer the door is about to return. It would
read correctly and it would be §21.15 built in the wrong place, before proposals exist to hang it on.

## 59 · A test seam for the invoice store (2026-09-30)

**What:** `resetInvoices()`, exported from `invoice.ts`, puts the two-invoice store back to how it
started.
**Why:** the story has exactly one draft invoice, INV-1009, and step 08 has four tests that each need
a draft. Tests in one file share the module, so without a reset they each depend on the order they
happen to run in — a test proving whatever ran before it. `resetRequestIds`, `resetProposalIds` and
`forgetTheLog` are the same seam, so the shape is already established here.
**Cost:** production code exports a function that undoes an issue, and there is no unissuing an
invoice in DSoR. The doc comment says it is a test seam and why, which is all a comment can do; step
09 puts the store in a database and the seam becomes a transaction rollback.
**Rejected:** adding a third draft invoice to the store. It changes the running example
([§0.4](../../../specs/dsor/00-conventions.md#04-running-example-informative)) to work around a test
ordering problem, and the next step that needs two drafts would add a fourth.

## 60 · A checkpoint, because a hash chain cannot see a deletion (2026-09-30)

**What:** `audit.ts` keeps a head — the record count and the last record's hash — and `verifyChain`
takes it as an optional second argument. `main.ts` and every test that audits its own log pass it.
**Why:** a review dropped the last record from a three-record log and `verifyChain` returned `true`.
Then dropped two: `true`. Then handed it an empty log: `true`. Every link held, every hash matched,
there was simply less of it. **Hash chaining is evidence a record was not edited. It is no evidence at
all that one was not deleted from the end**, and that is the cheapest attack available.
[§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) names signed checkpoints
beside hash chaining, and this is the smallest checkpoint there is: two values held apart from the
records.
**Cost:** `verifyChain` now has two modes, and a caller who forgets the head gets the weaker one. The
argument is optional rather than required because comparing two *different* histories is a real thing
a test does, and the head belongs to only one of them.
**Rejected:** making the head required. Two of this step's tests legitimately verify a history that is
not the current one, and a required head would have forced them to lie about which.

## 61 · A record's fields are read from the caller exactly once (2026-09-30)

**What:** `audit()` copies every field of its argument into a local before it decides anything.
**Why:** it read `decision.subject` three times — once to choose record-or-count, once for
`identity.subject`, once for `correlation.principal_id`. A review handed it a getter that answered
`user_123` then `cfo_100`: the gate saw the supervisor so a record was written, and the record blamed
the CFO. Schema-valid, chain verifies, nothing downstream can tell.
**Cost:** eight lines of locals at the top of the function, which reads like ceremony until you know
why.
**Rejected:** trusting that callers pass plain objects. That is the assumption
[lesson 16](lessons.md) was written about twice already, in
[step 05](step-05-who-is-calling.md) and [step 07](step-07-the-pipeline-skeleton.md).

## 62 · Only named stages may run after a refusal, and only named stages may be unnumbered (2026-09-30)

**What:** two frozen lists in `pipeline.ts`. `AFTER_A_REFUSAL` holds the stages allowed to carry
`evenAfterARefusal`; `UNNUMBERED` holds the stages allowed to carry `at: null`. Each has one member
today.
**Why:** both replaced *positional* rules, and a review escaped both. The flag rule said "nothing
flagged before the recording", which left a flagged stage **after** it legal — and one with a side
effect in it carried out a command the pipeline had **denied**, with `DENY` in the log beside the
invoice it had just issued. `at: null` was exempt from the ascending rule by design, and nothing said
which stages could claim the exemption, so one unnumbered stage was accepted in all six positions of
the five-stage list, including before `authenticate`.
**Cost:** adding a stage in a later step now means editing a list in `pipeline.ts` as well as the
pipeline itself. That is the point: the list is the decision, and it should not be reachable by
accident.
**Rejected:** a cleverer positional rule. The flag was doing two jobs — "this is an evidence stage" and
"this stage may act on a refused request" — and only the first is ever wanted, so the answer is to stop
letting the list's author choose.

## 63 · Caller text is capped before it becomes evidence (2026-09-30)

**What:** `nameOf` caps an operation id at 200 characters where a message is built; `clip` caps every
caller-supplied string at 500 before it reaches a record.
**Why:** a review sent a two-million-character operation id and got back an error envelope whose
message was two million characters and a schema-valid audit record whose `reason` was 2,000,057.
[Decision 53](#53--an-unauthenticated-refusal-is-counted-not-recorded-2026-09-30) named the log as a
resource an attacker can exhaust and guarded the *unauthenticated* half by counting. One authenticated
principal fills it far faster, because each of its requests is **supposed** to be recorded.
**Cost:** a long id is reported in a shortened form, so a caller debugging a genuinely long identifier
sees "… (2000000 characters)" rather than the whole thing. The count is in the message so nothing is
silently misrepresented.
**Rejected:** capping only at the record. The envelope goes to the caller and a two-megabyte error
message is its own problem.

## 64 · A test title names the rule it proves, and nothing else (2026-09-30)

**What:** eleven test titles changed. Six tamper-evidence tests moved from `DSOR-AUD-01` to
`DSOR-AUD-04b`, three request-id tests from `DSOR-ERR-01a` to `DSOR-COR-01a` and `01b`, and two
evidence-failure tests from `DSOR-EXE-02` to `DSOR-EXE-03b`.
**Why:** a title is how this project counts coverage
([AGENTS.md](../../../AGENTS.md), "How we work"), so a title naming the wrong rule is a wrong number in
the coverage report. `DSOR-AUD-01` requires a record that *validates against the schema*; a constant
hash satisfies it word for word. What the chain tests prove is `DSOR-AUD-04b`, tamper-evidence — a rule
the step's README was simultaneously **disclaiming**. `DSOR-ERR-01a` is "every error validates against
`error-envelope.schema.json`", and nothing in `request-id.test.ts` calls `validateEnvelope`.
**Cost:** `DSOR-AUD-01` now has fewer tests, which looks like a step backwards and is the truth.
**Rejected:** leaving them and noting the discrepancy in the README. A note cannot correct a number
that a script computes from titles.

## 65 · A skipped test is better than a silently passing one (2026-09-30)

**What:** the test comparing the step's copy of `audit-record.schema.json` byte for byte with
`packages/spec/schemas/` is `it.skipIf(!insideTheRepository)`. The "it compiled" half always runs.
**Why:** found by copying the folder outside the repository, which the `build-baby-step` skill
requires — the unconditional read died with `ENOENT`. A step is a self-contained project and a test
that reaches four directories up is a test that makes it depend on its surroundings.
**Cost:** outside the repository the strongest guarantee about the schema is unverified, and `pnpm
check` prints `218 passed | 1 skipped` instead of `219 passed`. Both numbers are in the README so a
learner does not read the skip as a break.
**Rejected:** dropping the comparison, and vendoring a hash of the spec's schema into the step. The
first loses the only check that the schema was not quietly edited to fit the code; the second is a
second copy of the same fact, which is the shape [lesson 17](lessons.md) is about.

## 66 · The stage that records leaves a receipt, and nothing executes without it (2026-10-01)

**What:** `recordTheDecision` puts the written record's id in `Context.recorded`, and `makeDoor`
refuses with `INTERNAL_ERROR` — before calling any handler — if it is missing.
**Why:** I had written this off as unfixable. `assertPipeline` checks that a stage called
`record the decision` is in the list, in the right place, with the right flag, applying to both
kinds — and it cannot check what the function *does*. So a door built with a **no-op** recorder
passed every check, **issued INV-1009, answered `COMMITTED`, and wrote nothing**. A side effect with
no evidence is the worst shape `DSOR-EXE-02` has, and I had pinned it as a limit with a test that
said so.

It is a limit of *list* checking. It is not a limit of the pipeline. A list cannot see what a function
does; a **receipt** can prove it did something. The guarantee no longer rests on the stage being the
right stage — it rests on a record existing.
**Cost:** `Context` gains a field that is only ever read by the door, and a later step that adds a
second evidence stage has to decide whether it leaves a receipt too. The door's refusal is
`INTERNAL_ERROR` rather than `EVIDENCE_STORE_UNAVAILABLE`, because a missing record here is this
program being wrong about itself, not a store being unavailable — and retry `never` says so.
**Rejected:** documenting it as a limit, which is what I did first and what the test pinned. The
reasoning was "a list check cannot catch this", which is true and is not a reason to leave a command
executing with no audit trail. Also rejected: having the door read the log to confirm the record is
there. A test asserts that instead, so the door stays a door.

## 67 · `pg` and raw SQL, not a query builder or an ORM (2026-10-01)

**Decided by:** the learner.
**What:** step 09 talks to PostgreSQL through `pg`, the plain driver, with SQL written out by hand.
**Why:** the step's whole idea is a guarantee the **database** makes, not one our code makes —
`REVOKE UPDATE, DELETE ON audit FROM dsor_runtime`, and the error PostgreSQL raises when the
application tries anyway. A query builder would hide the easy half (writing an INSERT) and leave the
hard half (the REVOKE) as hand-written SQL anyway. An ORM would want to own the schema, which fights
with two database users and hand-written migrations. `pg` is also what the reference profile names.
**Cost:** `$1, $2, $3` placeholders and no types across the query boundary, so a column rename is a
runtime error rather than a compile error. A later step can add a builder on top once the permissions
are the thing being taught rather than the thing being learned.
**Rejected:** Kysely or Drizzle, and Prisma. Both named above.

## 68 · Numbered `.sql` files and a runner we write (2026-10-01)

**Decided by:** the learner.
**What:** `migrations/001_*.sql`, `002_*.sql`, applied in order by `scripts/migrate.ts`, which records
what it has applied in a table so it never applies a file twice.
**Why:** "your first migration" is the thing being taught. A migration library teaches the library.
Twenty lines we can read beats a dependency whose rollback feature this step does not need.
**Cost:** no rollback, no checksums on applied files, and a hand-rolled runner is one more thing that
can be wrong — so it gets tests of its own before it touches a database.
**Rejected:** `node-pg-migrate`. Fine software; wrong lesson for this step.

## 69 · The audit log moves; the invoices stay in memory one more step (2026-10-01)

**Decided by:** the learner, against the map.
**What:** step 09 puts the audit log in PostgreSQL. The invoice store stays an array.
**Why:** the map says "move the invoices and the log", which is two tables, two sets of queries, and
one interesting guarantee that applies to only one of them. The log is where the idea lives:
durability, and an application that cannot rewrite history. Moving both would also invite a question
this step cannot answer — should issuing an invoice and recording the decision share one transaction?
That is `DSOR-EXE-04a`, step 34.
**Cost:** the step diverges from the written map, and step 10 or later owes the invoice half. The map
entry should be split, the way [decision 12](#12--the-command-landed-in-step-04-not-a-new-step-2026-09-24)
split step 03.
**Rejected:** both at once, as written. It is a bigger step for no extra idea.

## 70 · Database tests are a separate tier, skipped without a connection string (2026-10-01)

**Decided by:** the learner.
**What:** `*.db.test.ts` files run only under `pnpm test:db`, against `DSOR_DB_URL`. `pnpm check`
never collects them, so the step still runs with no database and no network.
**Why:** it is the shape [AGENTS.md](../../../AGENTS.md) already defines for the reference
implementation, so the tutorial and the real thing agree. And every step so far runs standalone —
a step that needs credentials to run its own gate would be the first that does not.
**Cost:** `pnpm check` being green no longer means the database guarantees hold. That is the honest
situation and the README has to say so: two commands, and the second one is the one that proves
`DSOR-AUD-04a`.
**Rejected:** a local PostgreSQL in Docker (a second thing to install, and it drifts from the Neon
setup the rest of the tutorial assumes), and requiring Neon for every run.

## 71 · PGlite for the permission tests, a real server for what PGlite cannot do (2026-10-01)

**What:** `test/audit-permissions.test.ts` runs against **PGlite** — PostgreSQL 18 compiled to
WebAssembly, in-process — and runs under plain `pnpm check` with no connection string. The
`*.db.test.ts` tier against a real server stays, for the two things PGlite cannot do.
**Why:** [decision 70](#70--database-tests-are-a-separate-tier-skipped-without-a-connection-string-2026-10-01)
said database tests skip without `DSOR_DB_URL`, which would have meant the step's central guarantee —
`UPDATE audit …` is refused — was unproven on a fresh checkout. PGlite needs no server, no account and
no credentials, so a learner sees `permission denied for table audit` on the first run.

It is **not a mock**, and that is why it is allowed: [AGENTS.md](../../../AGENTS.md) forbids proving
audit immutability against a mock, and a mock is a thing that imitates a database's answers. PGlite is
the engine. The refusal in that test is PostgreSQL's own privilege system.
**Cost:** a dependency, and two real gaps. PGlite has one connection, so the application's account is
reached with `SET ROLE` rather than by logging in — the privilege checks are identical, but a real
*login* as `dsor_runtime` is untested. And one connection cannot race itself, so
`UNIQUE (chain, sequence)` under parallel writers needs a server. Both are written down in the test
file's own header, next to the tests that cannot cover them.
**Rejected:** leaving the guarantee untested until someone sets up Neon. The step's "done when" is one
line — `UPDATE audit …` fails — and a step whose headline claim only runs for people with an account
is a step most readers take on trust.

## 72 · The pipeline becomes async in step 09, not in a step of its own (2026-10-02)

**Decided by:** the learner, after being shown the size.
**What:** `Stage.run` may return a promise, `runPipeline` and `Door` are async, and 73 of the step's
tests gained `await`.
**Why:** a database write is not synchronous, so the moment `audit()` writes a row the `await` reaches
every call site — 129 of them across eight test files. The
[`build-baby-step` skill](../my_01_one_invoice_in_memory/.claude/skills/build-baby-step/SKILL.md) says
to stop when a step needs two ideas, so this was put to the learner rather than assumed. The answer:
async is the **cost** of a real database rather than a second idea, and it arrives where the reason for
it is visible. Splitting it would also have left step 09 not solving the problem it opens with — the
log would still vanish on a restart.
**Cost:** the widest mechanical change in the tutorial so far, and one behaviour change hidden inside
it: a stage that throws now produces a rejected promise, so `expect(() => door(...)).toThrow()` passes
without running its body. Three such tests existed and had to become `.rejects.toThrow()`.
**Rejected:** a separate step for the async change, and keeping the in-memory log while writing rows
alongside it. The second would have meant the record was not durably written before the response,
which is `DSOR-EXE-02`'s whole sentence.

## 73 · The test files run one at a time, in one process (2026-10-02)

**What:** `vitest.config.ts` sets `pool: "forks"`, `singleFork: true`, `isolate: true`, and a 30-second
timeout.
**Why:** three attempts, and the first two each taught something. Files in parallel shared
`audit.ts`'s module-level connection, so one file's `useDatabase` replaced another's mid-run and both
computed `max(sequence)` from the wrong table — 27 failures, while one file passed all 21 of its tests
alone. `isolate` fixed that. Then twenty files each building a PostgreSQL, four at a time, gave a
different answer every run, including tests reported as **skipped**, which is the tell that a worker
was killed rather than that anything was wrong.
**Cost:** no parallelism. 278 tests in about 7.6 seconds, where step 08's 232 took 0.25. A step a
learner runs once should give the same answer every time, and
**a flaky suite teaches nothing except not to trust the suite.**
**Rejected:** a second in-memory store implementation so most tests need no database. Faster, and a
thing that can drift from the real one while the tests stay green — which is what
[AGENTS.md](../../../AGENTS.md) means by never testing audit immutability against a mock. There is one
store, the SQL, and two things that can run it.

## 74 · Two times on an audit row (2026-10-02)

**Decided by:** the learner.
**What:** `at` is the application's claim and is inside the hash. `recorded_at` is stamped by the
database with `DEFAULT now()`, cannot be set by the application, and is **not** covered by the hash.
**Why:** step 08 left `setClock()` able to backdate a record undetectably, because the fingerprint is
computed *from* the faked time. The database cannot stamp `at` instead: the hash is computed before the
row exists, and `UPDATE` is revoked afterwards, so there is no moment at which a database-supplied time
could be inside the hash. An independent second time is the next best thing — a backdated record
arrives with the two years apart.
**Cost:** detection, not prevention, and one more column to explain. Also honest: the application
*could* set `recorded_at` on an INSERT; what makes the gap evidence is that the code which writes
records never does, and a test says so rather than pretending the column is protected.
**Rejected:** a `CHECK` that `at` is near `now()`. It prevents the lie and refuses an innocent slow
request — and a refused audit write means the operation does not run at all.

## 75 · The program drops to the application's role, and refuses to start if it cannot (2026-10-04)

**The problem.** `002_runtime_user.sql` takes UPDATE, DELETE and TRUNCATE away from
`dsor_runtime`, and `audit-permissions.test.ts` proved it works. But it proved it by running
`SET ROLE dsor_runtime` first. The program never ran that line. On the PGlite route it opened the
database as `postgres`, a superuser, and a superuser is allowed everything regardless of any GRANT.
Measured:

```text
PGlite connects as: postgres   superuser: true
  UPDATE    SUCCEEDED  <-- the route pnpm start, pnpm migrate and all 280 tests used
  DELETE    SUCCEEDED
  TRUNCATE  SUCCEEDED
```

So the append-only audit log was fully rewritable by the program that kept it. 280 green tests did
not notice, because not one of them asked who the program had connected as. A test that borrows the
right identity proves the GRANT. Only a test that uses the program's own connection proves the
program.

The real-server route was never affected: `DSOR_DB_URL` holds `dsor_runtime`'s own credentials, so
that connection is `dsor_runtime`, not a superuser, and UPDATE was already refused.

**The decision.** Two parts.

1. `becomeTheApplication` runs `SET ROLE dsor_runtime` on the PGlite route, after the migrations
   (which are the owner's job) and before `useDatabase`. Be exact about what this is: on a real
   server the limit is the *server's*, because the program only ever holds `dsor_runtime`'s
   password. On PGlite there are no logins at all, so the limit is the program's own choice and a
   `RESET ROLE` would lift it. What the choice does prove is that the GRANTs in
   `002_runtime_user.sql` are enough for the program to do its job and no more — which would
   otherwise stay untested until the day it ran against Neon.
2. `refuseIfItCanRewriteHistory` asks the database, on **both** routes, whether this connection may
   UPDATE, DELETE or TRUNCATE `public.audit`, and throws before recording anything if it may. A
   connection string pointing at the owner is a configuration mistake, not a preference.

**Why `has_table_privilege` and not a privilege listing.** I assumed a listing misses the owner.
Measured, and it does not — but it misses something worse:

```text
owner (postgres):        listed grants = 1   has_table_privilege = true
superuser, not owner:    listed grants = 0   has_table_privilege = true   <-- the gap
dsor_runtime:            listed grants = 0   has_table_privilege = false
```

`has_table_privilege` counts every route to a right: a direct GRANT, a grant to `PUBLIC`, a right
inherited through role membership, and superuser bypass. A catalogue query keyed on a grantee name
counts only the first.

**Proved by breaking it.** Each sabotage, with the test total held at 10 so no run was invalid:

| Sabotage | Result |
| --- | --- |
| delete the `SET ROLE` (the exact defect, restored) | 5 of 10 fail |
| `FORBIDDEN` narrowed to `["UPDATE"]` | 1 fails |
| the no-row case trusts the database instead of failing closed | 1 fails |
| restored | 10 pass |

And in the program itself: `a PostgreSQL on disk at ./.local-database, as dsor_runtime`, 10 records
verifying true, 20 on the second run.

**The cost.** `openTheDatabase` gained two things that exist for the test: an optional `folder`, so
a test opens a throwaway directory instead of the demo's, and `connection` in what it returns, so a
test can ask the program's *own session* who it is. A fresh connection would be a different
session, and `SET ROLE` is per session — which is also why the role has to be set on every open,
and why there is a test for the second run.

## 76 · Every read of a caller's object goes inside the `try` (2026-10-04)

**The problem.** `ownString` in `src/login.ts` already caught a throwing *getter* — a hostile
review had found that one in step 05. The catch was in the right place for a getter and the wrong
place for everything else:

```ts
if (from === null || typeof from !== "object" || !Object.hasOwn(from, key)) {
  return undefined;        // <-- Object.hasOwn is OUTSIDE the try
}
try { … } catch { return undefined; }
```

`Object.hasOwn` is not a passive question. It consults the object's own
`getOwnPropertyDescriptor`, which a `Proxy` may trap. So a caller who sends

```ts
new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("boom"); } })
```

never reached the `try` at all. Measured through the real pipeline:

```text
callOperation THREW: boom
records written while that happened: 0
```

A raw `Error` where `DSOR-ERR-01a` promises an envelope, and an empty audit log where
`DSOR-EXE-02` promises the decision is recorded before the response — both from one object a
caller chose to send. The arguments side was already safe (`VALIDATION_FAILED`, one record
written); only the login was not.

**The decision.** The early return now tests only `null` and `typeof`, the two questions an object
cannot lie about or throw from. Everything that touches `from` — `Object.hasOwn` included — is
inside the `try`.

**What I got wrong writing the test.** I expected all four traps to be refused. Measured:

```text
getOwnPropertyDescriptor   refused AUTHENTICATION_REQUIRED   <-- the hole
get                        refused AUTHENTICATION_REQUIRED
has                        resolved to user_123
ownKeys                    resolved to user_123
```

`Object.hasOwn` consults `getOwnPropertyDescriptor`, not `has` and not `ownKeys`. A login that
traps those two is still a login whose `loggedInAs` is genuinely its own and genuinely readable, so
resolving it is the right answer and not a miss. Both facts now have a test: one that the two
reachable traps refuse, one that the two unreachable traps do not change the answer — the second
being what would notice if a later change started reading the login through `in` or `Object.keys`.

**Proved by breaking it.** Total held at 32 throughout.

| Sabotage | Result |
| --- | --- |
| `Object.hasOwn` back outside the `try` (the original defect) | 2 fail |
| the `catch` rethrows instead of returning `undefined` | 3 fail |
| restored | 32 pass |

`pnpm check`: 21 files, 293 tests passed.

## 77 · The clock is read after the tail, not before (2026-10-04)

**The problem.** `audit` read the time one line above the query that finds the chain's tail:

```ts
const at = now();
const db = theDatabase();
const { rows: tail } = await db.query(…);   // position and previous_hash come from here
```

So a writer's timestamp was fixed before it knew its position. Two writers, the slow one sampling
first, and the log comes out like this — forced deterministically by holding the first writer's tail
read open until the second had committed:

```text
seq 0  at 2026-10-04T00:00:01.000Z  req_fast
seq 1  at 2026-10-04T00:00:00.000Z  req_slow   <-- earlier time, later position
verifyChain: false
```

Nothing was tampered with. Every hash agreed. But `verifyChain` rejects a log whose times go
backwards, so it reported an intact chain as broken — and the rows **cannot be corrected**, because
the application has no UPDATE, which is this step's whole point. One lost race and the evidence is
unverifiable for good. That is `DSOR-AUD-04b` failing: a tamper-evidence mechanism that cries wolf
is as broken as one that misses the wolf.

**The decision.** Read the clock after the tail, immediately before building the record.

**Why that is airtight, and it is the UNIQUE constraint that makes it so.** A writer that takes
position N+1 saw N in the tail, so N was already committed. N's time was sampled before N's INSERT.
Therefore `at(N) < commit(N) <= tail-read(N+1) < at(N+1)`, for every pair. The sequence and the
clock can only agree. Nothing about this depends on luck or on how fast a writer is. It does depend on there being **one** clock —
one process. Two instances with skewed clocks break it; see decision 84 and the open question.

**What it does not fix.** The system clock going backwards — an NTP correction between two writes.
Not fixable here: §30 wants a trusted time source and this step has none. `recorded_at` is the
database's own witness beside it. Recorded in `open-questions.md`, not papered over.

**Tested by fault injection, not by hope** (§47). A `Database` wrapper holds a writer at its tail
read while another goes past. One PGlite connection cannot race itself — true, and I had used that
as a reason not to test this at all, which was the wrong conclusion: the interleaving needs control
over the order, not real concurrency. The real server keeps its job, which is the UNIQUE constraint
under genuine parallelism.

**Two mistakes while writing the test**, both found by running it:

- The ten-writer case left writer 0 ungated, so it raced ahead, two writers computed position 0,
  and the run died on `audit_pkey` instead of testing anything. Every writer is gated now, and they
  are released one at a time in the reverse of creation order — the ordering that produced an
  inversion at *every* link in the old code.
- The gate matched `ORDER BY sequence DESC`, which `theHead`'s subquery also contains. It counted
  `theHead` as an eleventh writer and reached past the end of the gate list. `isTheTailRead` now
  matches on both halves, and the comment says why either half alone is not enough.

**Proved by breaking it.** Clock read moved back above the tail: **all 4 fail**. Restored:
`pnpm check` 22 files, 297 tests passed.

*Decision 87, the same evening: the fourth check this race tripped was removed from `verifyChain`. The
ordering fix above stands on its own — a log whose times contradict its order is evidence that lies —
but the chain is no longer bricked by an honest earlier time.*

## 78 · A lost reply is not a failed write, so `audit` looks instead of guessing (2026-10-04)

**The problem.** Step 08's store was a JavaScript array. An array has two answers: it took the
record, or it threw. A database on the other side of a network has a third — the INSERT commits and
the **reply** is lost. `audit` treated that as a failure. Measured, by dropping the reply of a
committed INSERT:

```text
the caller is told: EVIDENCE_STORE_UNAVAILABLE  retry: safe_same_key
                    "could not be written down, so it was not carried out"
the log holds 1 record(s):
   seq 0  ALLOW  ALLOWED  req_1
```

Both halves of what the caller was told are false. It *was* written down, and retrying on
`safe_same_key` writes a second ALLOWED record for the same request. Worse than either: the log and
the answer disagreed. An auditor reconstructing `req_1` finds ALLOWED while the caller holds a
refusal — and stopping exactly that is why a decision record exists.

`DSOR-UNK-01b` is the rule and it names this case: an unknown outcome is reported as unknown, never
as a retryable error.

**The decision.** `audit` does not guess which of the two happened. It looks: on a failed INSERT it
queries for its own record and compares the **`record_hash`**, then either returns it (the reply was
lost, the record is there, the decision stands) or rethrows (nothing was written, and
`EVIDENCE_STORE_UNAVAILABLE` with retry `safe_same_key` is then true). *Corrected in decision 84: the
look-up itself can fail, and that case is `OUTCOME_UNKNOWN`, not a rethrow.*

**Why `record_hash` and not "is there a row".** The question is not "did something land at this
position" but "did **this** record land". A writer that beat us to the position makes the INSERT
fail on the primary key and leaves a row at `audit:org_456:0` — someone else's. Accepting it would
throw away a decision and tell the caller it was recorded. There is a test for precisely that, and
narrowing the check to `found[0] === undefined` fails it. *Decision 85: once `23505` was
short-circuited that test never reached the comparison; "another writer's row at my position" is what
kills it now, measured.*

**Measured after the fix:**

```text
reply lost AFTER the insert committed:
   caller: data
   log:    1 record(s) [ALLOW/ALLOWED]  verifies: true
the insert genuinely failed:
   caller: EVIDENCE_STORE_UNAVAILABLE retry:safe_same_key
   log:    0 record(s) []  verifies: true
```

**Proved by breaking it.** Total held at 4.

| Sabotage | Result |
| --- | --- |
| no recovery at all (the original behaviour) | 2 fail |
| recovery accepts any row at the position, not only ours | 1 fails |
| restored | 4 pass |

The INSERT moved into its own `insert` function, so the recovery has something to call twice. The
stale comment in `operations.ts` — "the decision could not be written" — now says why that
sentence is finally true rather than a guess.

`pnpm check`: 23 files, 301 tests passed.

## 79 · The privilege check asks PostgreSQL, not the grant catalogue (2026-10-04)

**The problem.** Two mutants of `002_runtime_user.sql` survived with all 301 tests passing:

```text
REVOKE ALL ON audit FROM PUBLIC  ->  REVOKE UPDATE ON audit FROM PUBLIC     301 passed
REVOKE UPDATE, DELETE, TRUNCATE ... FROM dsor_runtime  ->  deleted           301 passed
```

The first survived for a reason worth keeping: the test granted only `UPDATE` to PUBLIC, so the one
privilege it checked was the one the narrowed line still removed. Measured with the narrowed line
against a database that had a history:

```text
a database with a history (granted to PUBLIC):   UPDATE=true  DELETE=true  TRUNCATE=true
after REVOKE UPDATE FROM PUBLIC:                 UPDATE=false DELETE=true  TRUNCATE=true
after REVOKE ALL FROM PUBLIC:                    UPDATE=false DELETE=false TRUNCATE=false
```

A log the application can DELETE from or TRUNCATE is not append-only, and the test was blind to
both.

**Why it was blind, which is the part worth learning.** `privilegesOfTheApplication` read
`information_schema.role_table_grants WHERE grantee = 'dsor_runtime'`. A catalogue row exists only
for a grant made to the role **by name**. A privilege reaching it through PUBLIC has no such row, so
`toEqual(["INSERT", "SELECT"])` passed while the account actually held DELETE and TRUNCATE.

It now asks `has_table_privilege`, which answers for the role the way PostgreSQL will when the
statement runs — counting a direct grant, a grant to PUBLIC, a right inherited through role
membership, and superuser bypass. Same correction as decision 75, in a second place; the lesson
generalises and is written down as lesson 25.

**The decision**, three parts:

1. The PUBLIC test grants `UPDATE, DELETE, TRUNCATE`, asserts all three really do reach the
   application first, re-applies the migration, and then attempts all three.
2. `privilegesOfTheApplication` uses `has_table_privilege` over every privilege a table can carry,
   so "and nothing else" means all of them rather than the five somebody remembered.
3. **The redundant `GRANT` was deleted**, because its stated reason was false. The comment said it
   was needed "because the line above revokes from PUBLIC and dsor_runtime is a member of PUBLIC".
   Measured:

   ```text
   after GRANT INSERT, SELECT to the role:   INSERT=true SELECT=true
   after REVOKE ALL ON audit FROM PUBLIC:    INSERT=true SELECT=true   <- the direct grant survives
   ```

   `REVOKE ... FROM PUBLIC` revokes the grant made *to PUBLIC*; it does not touch a grant made
   directly to a role that happens to be a member of it. So the line was a no-op in every case and
   no test could ever have killed it. A line that protects nothing is worse than absent when it
   carries a reason that is not true, because the next reader learns the wrong rule from it.

**Proved by breaking it**, after the change:

| Mutant | Result |
| --- | --- |
| `REVOKE ALL FROM PUBLIC` → `REVOKE UPDATE FROM PUBLIC` | 1 fails |
| `REVOKE UPDATE, DELETE, TRUNCATE FROM dsor_runtime` deleted | 2 fail |
| `GRANT INSERT, SELECT` narrowed to `GRANT INSERT` | 5 fail |
| restored | 16 pass |

**A consequence worth recording.** Editing an applied migration made `pnpm migrate` refuse, which is
the guard in `src/migrations.ts` doing its job:

```text
TypeError: 002_runtime_user.sql has changed since it was applied: the database ran a different
version of it, and an applied migration is never edited. Add a new migration instead
```

The right answer *in development*, while the migration is still being authored, is to reset the
development database — `DROP TABLE audit, applied_migrations` as the owner, then `pnpm migrate`. The
right answer once a migration has run anywhere real is to add `003`. The guard does not know which
situation it is in, and it is correct to refuse rather than guess.

`pnpm check`: 23 files, 301 tests. `pnpm test:db`: 4. Both routes verify: 10 records on the server,
20 on disk.

## 80 · Every table name names its schema (2026-10-04)

**The problem, and it is the quietest hole in step 09.** `dsor_runtime` may not UPDATE or DELETE the
audit log. It may still create a **temporary table**, because `TEMPORARY` on a database is granted to
`PUBLIC` by default — and `pg_temp` is searched *before* `public`, implicitly, whatever `search_path`
says. So an unqualified `INSERT INTO audit` lands in the application's own throwaway table, which
disappears when the connection closes. Measured:

```text
search_path: undefined
the application CAN create a temp table called audit
after one audit() call:  public.audit has 0 row(s),  pg_temp.audit has 1
theLog() reports 1 record(s)
```

Read the last line again. The program reports a healthy audit trail — `theLog()` finds the record,
`verifyChain` would be happy — while `public.audit` is empty and the evidence evaporates at
disconnect. A complete bypass of `DSOR-AUD-01`, reachable from the application's own account, with
nothing refused and nothing logged.

**Why the privilege system cannot fix this.** Taking `TEMPORARY` away would close the door, and a
migration cannot write it portably — `REVOKE TEMPORARY ON DATABASE` needs the database's name, which
a migration file does not know. And `search_path` cannot demote `pg_temp` for an unqualified name:
it is consulted first unless it is listed explicitly, which is a session setting, not a grant.

**The decision.** Name the schema, every time, in every statement: `public.audit`,
`public.applied_migrations`. Ten statements across `src/audit.ts` and `src/migrations.ts`. It does
not depend on `search_path`, on a privilege, or on nobody having created a table with an awkward
name.

**Two tests, and they are different questions.** One creates the shadow table, checks that
`'audit'::regclass` really does resolve to `pg_temp` first — so it is not testing nothing — and then
proves the record lands in `public.audit` anyway. The other reads `src/audit.ts` and fails if
`audit` or `applied_migrations` appears unqualified anywhere, because the first test proves one
statement and "every time" needs the other.

**Proved by breaking it.**

| Sabotage | Result |
| --- | --- |
| unqualify the INSERT only | 2 fail |
| unqualify the tail read only | 1 fails |
| restored | 18 pass |

**A side effect worth recording.** `migrate.test.ts` injects its fault by matching
`sql.startsWith("INSERT INTO applied_migrations")`, and qualifying the name stopped it injecting
anything at all — the migration then succeeded and the test failed, loudly, which is the good
outcome of a brittle match rather than a quiet one. A test that recognises a statement by its text is
coupled to that text; this one now says so in a comment.

`pnpm check`: 23 files, 303 tests passed.

## 81 · `recorded_at` becomes a witness the application really cannot forge (2026-10-04)

**Three claims in `001_audit.sql` and its tests were false, and they were all about the same column.**

`recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()` was described as "the time the database wrote the
row ... which the application cannot set". A `DEFAULT` applies only when the INSERT leaves the column
out; it is not a defence. And `GRANT INSERT ON audit` covers **every column**, so:

```text
INSERT SUCCEEDED. at=2026-10-04 05:00:00+05  recorded_at=1999-01-01 05:00:00+05
```

The application forged the database's own witness. The test named
`DSOR-AUD-04b: the application cannot set recorded_at` said so in its own body — *"the application
CAN set it"* — so the title and the body contradicted each other in the same file. And it ran as the
**owner**, through `db.exec`, which can set any column and proves nothing about the application.

**The decision: make the sentence true, not softer.** `002_runtime_user.sql` grants INSERT **column
by column** and leaves `recorded_at` out:

```text
normal insert:            SUCCEEDED, recorded_at = the database's now()
backdating recorded_at:   REFUSED, permission denied for table audit
```

The cost is real and the comment says it: add a column to `audit` and the list must gain it, or every
INSERT fails. It fails *closed*, which is the right direction, and a test now checks every column of
the table by name so a forgotten one fails in `pnpm check` rather than in production.

**It also moved the privilege question again.** `has_table_privilege(..., 'INSERT')` went to `false`,
correctly — there is no table-level INSERT any more. Measured:

```text
has_table_privilege  (INSERT):               false
has_column_privilege (record_id, INSERT):     true
has_column_privilege (recorded_at, INSERT):   false   <- the hole that closed
has_column_privilege (recorded_at, SELECT):   true    <- it can still read the witness
```

So "which privileges does the application hold" means *table level **or** any column*, and the
helper in `audit-permissions.test.ts` now asks that. This is the **third** place in step 09 that read
a grant catalogue and got a security answer wrong; lesson 25 is the general form.

**Proved by breaking it** (added 2026-10-04, after a critic noticed this entry had no table):

| Sabotage | Result |
| --- | --- |
| `GRANT INSERT` on the whole table again (the original hole) | 2 fail |
| `recorded_at` added to the column list | 2 fail |
| README Break 1, `GRANT ALL` replacing the column grant | 6 fail (the two above plus the four privilege-shape tests) |
| README Break 1, `GRANT ALL` appended | 21 fail at 322, 24 at 326 (the start-up guard refuses every `openTheDatabase`) |

## 82 · The duplicate index, and the race test that tested the wrong constraint (2026-10-04)

**The index.** `001_audit.sql` had `UNIQUE (chain, sequence)` *and*
`CREATE INDEX audit_chain_sequence ON audit (chain, sequence)`, the second with a comment claiming
that without it "every read of a chain is a scan of the whole table". A UNIQUE constraint **is** an
index, so the table carried two identical btrees:

```text
audit_chain_sequence       INDEX        ON public.audit USING btree (chain, sequence)
audit_chain_sequence_key   UNIQUE INDEX ON public.audit USING btree (chain, sequence)
```

The second serves every read the first would. The first bought nothing and cost a write on every
INSERT. Deleted, with the reflex named in a comment where it was, and a test that there is exactly
one index on those columns and that it is the UNIQUE one.

**The race test.** `audit.db.test.ts` claimed to be the only test that could see
`UNIQUE (chain, sequence)` — and it sent the same `aDecision(0)` three times, which is the same
`record_id` three times. The two losers were refused by `audit_pkey`. Dropping the unique constraint
left the test green.

Fixed by racing three **different** record ids for one position, so nothing can collide on the
primary key, and by asserting **which constraint** refused:

```text
with UNIQUE (chain, sequence) dropped:   1 failed | 4 passed
restored:                                5 passed
```

The primary key kept its own test, since the race test no longer covers it by accident.

`pnpm check`: 23 files, 307 tests. `pnpm test:db`: 5. Both routes verify, 10 records each.

**Proved by breaking it** (added 2026-10-04): re-adding `CREATE INDEX audit_chain_sequence ON audit
(chain, sequence);` to `001_audit.sql` fails exactly one test, the index-count pin.

## 83 · Every number in the README's Break-it section was re-measured (2026-10-04)

The step's nine guarantees now have nine break-it exercises, and **every count was produced by making
the change and running `pnpm check`**, not written from memory. The old section had five, all stale
(the suite had grown from 278 to 308) and one wrong when it was written — Break 1 claimed four
failures.

| Break | Measured |
| --- | --- |
| 1 · `GRANT ALL ON audit TO dsor_runtime` | 6 failed / 302 passed |
| 2 · leave `TRUNCATE` out of the revoke | 2 failed |
| 3 · take away `UNIQUE (chain, sequence)` | 2 failed |
| 4 · let a migration be edited after it ran | 2 failed |
| 5 · order the chain as text (drop the alias) | **62 failed** |
| 6 · let the program keep the owner's connection | **11 failed** |
| 7 · leave the schema off a table name | 2 failed |
| 8 · treat a lost reply as a failed write | 2 failed |
| 9 · read the clock before the tail | 4 failed |

Break 6 is the one worth staring at. It was **zero failures** before `test/database.test.ts` existed
— every privilege test passed, because each one ran `SET ROLE dsor_runtime` itself. A guarantee with
a break-it exercise that fails nothing is a guarantee nobody is holding.

Also corrected in the README: the two-accounts table (INSERT is column-level now), the `recorded_at`
paragraph (it said "cannot change" where the truth was "could trivially set"), the file list, the
`5 skipped` count for the database tier, and the `DSOR-AUD-04a` section — which claimed the rule was
met while the runtime identity was `postgres`, and which now states three limits instead of two: the
`SET ROLE` substitution on the in-process route, the owner's remaining power, and the fact that
`refuseIfItCanRewriteHistory` is a start-up check and not a boundary.

## 84 · What the hostile review found, and what each finding cost (2026-10-04)

The `requirement-reviewer` pass over the eleven fixes above came back with six broken guarantees, five
missing negative tests and eight false claims. I reproduced the four it called live before touching
anything; all four were exactly as described.

**1 · The lost-reply recovery ran on the connection that had just died.** A lost reply usually means
the connection is gone, so the follow-up "did my record land?" fails on the same connection — and its
error escaped the `catch`, replacing the original, and became `EVIDENCE_STORE_UNAVAILABLE` with retry
`safe_same_key`. The exact pre-fix behaviour, on the exact case a server restart produces:

```text
caller told: EVIDENCE_STORE_UNAVAILABLE retry:safe_same_key   rows in table: 1
```

The honest answer is that nobody knows, and `DSOR-UNK-01b` names it: unknown, with a retry class that
does not permit a fresh attempt. `audit` now throws `OutcomeUnknown` when it cannot look, and the
pipeline maps it to `OUTCOME_UNKNOWN` / `after_reconciliation` — a code and a class that were already
in the step's own table. After: `caller told: OUTCOME_UNKNOWN retry:after_reconciliation`.

The step now **claims `DSOR-UNK-01b` for this one case** and says so in the README with the limit
stated; `envelopes.test.ts` used to say the rule arrives in step 37, and now says which half does.

**2 · A byte-identical row absorbed a second decision.** The recovery asked "is a record with my hash
here?", not "did my INSERT commit?". With a fixed clock, two writers for the same request hashed
identically, and the second found "its" record present and was told it had been recorded:

```text
writer1=audit:org_456:0  writer2=audit:org_456:0  rows: 1
```

Reachable without `setClock`: `nextRequestId` is a per-process counter, so two instances of the
program on one database both mint `req_1`. PostgreSQL already answers the right question — SQLSTATE
`23505` means "that row exists; yours did not commit" — so the recovery takes that answer first and
asks the hash question only for other errors. After: `writer2=threw (23505)  rows: 1`.

**4 · `at` was hashed as the clock spelled it, not as the database stores it.** `storable` sets the
rule for text and `at` was exempt. `theLog` rebuilds `at` with `toISOString`, so a clock emitting
`2026-10-04T00:00:00Z` produced a record that could never verify:

```text
wrote at=2026-10-04T00:00:00Z  read back=2026-10-04T00:00:00.000Z  verifyChain=false
```

The trusted time source §30 asks for is exactly the kind of clock that would have hit this. Now
`new Date(now()).toISOString()`, and a test with three spellings.

**6 · The guard read a NULL as "may not".** `if (answer.may)` — and `a OR b OR c` is NULL when any
operand is NULL and the rest are false. `!== false` now, with a test handing it a row that does not
answer.

**8 · `test/database.test.ts` did not pin the route it is named after.** `openTheDatabase` reads
`DSOR_DB_URL` before it looks at `folder`, so with that variable exported in the shell — which the
README's setup section invites — the tests would have run against the server and written real rows
into its log. `vi.stubEnv("DSOR_DB_URL", "")`, and the first test now asserts `opened.where` says
"on disk".

**10 · "Every table name names its schema" was true of one file.** `CREATE TABLE audit` and three
`ON audit` in the migrations, `applied_migrations` in the migrate script, `DELETE FROM audit` in test
support. The migration ones matter: `GRANT ... ON audit` resolves through `search_path` like any
query. All qualified; the scan now covers `src/`, `scripts/`, `migrations/` and `test/support/`,
strips comments first, and runs one regex per keyword because a single alternation consumed
`TRUNCATE ON` and skipped the `audit` after it. One unqualified `ON` in a migration fails it.

**11 · The enforcement had one call site and nothing held it there.** `useDatabase` checks nothing;
only `openTheDatabase` runs the refusal. A test now reads `src/` and fails on any statement-position
`useDatabase(` outside `database.ts`. The first version matched the name anywhere and caught a string
inside an error message, which is a mention and not a door — measured, corrected.

**The credential mask leaked.** `url.replace(/\/\/[^@]*@/, "//…@")` on a password containing `@`
printed `…@ss-word@host`, and `main.ts` prints that line. `withoutCredentials` parses as a URL and
rebuilds from scheme, host and path; a string that is not a URL is masked whole.

**`forgetTheLog` erased every chain.** `DELETE FROM public.audit` with no `chain` filter, while
`theHead` and `theLog` filter by chain. One chain today; a cross-tenant delete in step 10. Filtered.

**Two claims corrected rather than code.** The `at(N) < at(N+1)` argument in decision 77 holds for one
process with one clock, and said nothing about the premise; two instances with skewed clocks break
the check. And `src/audit.ts` said a program race fails on `UNIQUE (chain, sequence)` — for the
program's own rows it is `audit_pkey`, because `record_id` is `${chain}:${sequence}`; the unique
constraint is what keeps the ordering argument true if that format ever changes.

**Proved by breaking each one**, totals held at 315:

| Sabotage | Result |
| --- | --- |
| the re-query's failure escapes (finding 1) | 2 fail |
| no `23505` short-circuit (finding 2) | 1 fails |
| `at` not normalised (finding 4) | 1 fails |
| guard reads NULL as false (finding 6) | 1 fails |
| one unqualified `ON` in a migration (finding 10) | 1 fails |
| a second `useDatabase` door, as a dead function (finding 11) | 1 fails |
| the old regex mask | 1 fails |

The first attempt at the finding-11 sabotage put the call at module top level, which crashed every
import and shrank the total to 199. A shrinking total is an invalid run, not a result — lesson 11 —
so it was re-done as a function nobody calls.

**Re-measured, all nine break-it exercises at 315.** Break 5 is 64 now, Break 8 is 4 (the two
`DSOR-UNK-01b` tests fall with it), the rest are unchanged in their failure counts.

`pnpm check`: 23 files, 315 tests. `pnpm test:db`: 5. Both routes verify, 10 records each.

**Completing the list** (added after a critic counted ten entries against the nineteen claimed). The
previous review's remaining findings, and what happened to each:

- *3 · the `at(N) < at(N+1)` proof is single-process* — the premise is now stated in `audit.ts`,
  decision 77, the README's Break 9, and the open question.
- *5 · `refuseIfItCanRewriteHistory` is necessary, not sufficient* — the docstring and README limit 3
  now say it checks a privilege, and name the `SECURITY DEFINER` / owner-trigger route it cannot see.
- *7 · `DSOR-UNK-01b` claimed in three places and denied in a fourth* — the step claims it, with the
  limit stated in the README, and `envelopes.test.ts` says which half arrives in step 37.
- *9 · a program race fails on `audit_pkey`, not `UNIQUE (chain, sequence)`* — the comment in
  `audit.ts` was corrected, and the db-tier test says why its distinct ids are synthetic.
- *the eight false claims* — "4 passed" (five), "same insert three times" (retired), "in both cases
  as dsor_runtime" (false on the server route), "airtight" (one clock), decision 78's rethrow
  sentence, `audit.ts`'s UNIQUE claim, the credential mask, `forgetTheLog` across chains: all
  corrected in commit ff6e99c or in this entry's commit.
- *could not verify* — `pnpm test:db` (run by me, 5 then 7); every break-it count (re-measured at
  315 and again at 322); whether `audit_chain_sequence_key` is ever the refusing constraint in a
  **real** program race on a **real** server — still inferred from PGlite, recorded in
  `open-questions.md`.

## 85 · The second hostile pass, and the pg route that no test had ever run (2026-10-04)

Four parallel reviewers attacked the fixes in decision 84; a critic then asked what none of them had
looked at. **The critic's answer reversed "done" again**: the `pg` branch of `openTheDatabase` — the
real-server route, including the refusal that is the point of the step — was executed by no test on
either tier. The in-process tests stub `DSOR_DB_URL` to `""`; the db tier never imported
`database.ts`. Its prediction: delete that refusal, zero failures. Measured: true. Two db-tier tests
now point `openTheDatabase` at the owner (must refuse) and at the application (must start, say so,
and still be refused `UPDATE`); deleting the refusal fails one of them.

**Three reviewers independently found the same hole.** `main.test.ts` spawned `node src/main.ts`
with the inherited environment, so an exported `DSOR_DB_URL` made `pnpm check` run the demo —
eight times, ten decisions each — against that server's log. `database.test.ts` had closed exactly
this for its own process a commit earlier. The subprocess now gets `DSOR_DB_URL: ""` and `demo()`
throws unless the output says *on disk*. With the pin removed and a bogus URL exported: 6 of 6 fail.

**The recovery written yesterday was wrong twice more.**

- It asked "is a record with my hash here?", and two writers for the same request, subject,
  operation, result and millisecond produced byte-identical records — so on a connection error
  (which the `23505` short-circuit never sees) one writer took a receipt for the other's row. The
  reviewer's interleaving, measured: one row, two receipts. `correlation.trace_id` is now a fresh
  UUID per attempt, inside the hash; equal hashes can only mean one attempt. The schema already had
  the slot.
- It treated every INSERT error the same, and they are not the same. A **server** error carries a
  SQLSTATE: the server refused the statement and the row will never exist. A **connection** error
  carries a Node errno or nothing: the statement may still be executing, and "not found" is a
  snapshot. The first version told that caller `safe_same_key`; a retry would then write a second
  row when the first landed. Now: server said no → `EVIDENCE_STORE_UNAVAILABLE`; someone else's row
  at my position → the same, because mine can never commit; connection quiet and nothing there →
  `OUTCOME_UNKNOWN`. The discriminator is five characters with a digit — every SQLSTATE has one,
  no Node errno does — measured against `pg` and PGlite.

**`at` was still not hashed as stored, for one range of years.** PGlite parses a timestamp back with
`new Date(string)`, and V8 reads `0001-01-01 …` as 2001, so a schema-valid year below 0100 made a
record that could never verify — on one route only, which means the two routes disagreed about the
same row. `theLog` now has PostgreSQL form the string: `to_char(at AT TIME ZONE 'UTC', …)`, identical
on both drivers. The driver's date parser is out of the hash path entirely.

**A `NOINHERIT` membership is one `SET ROLE` from `UPDATE` and invisible to `has_table_privilege`.**
Measured: privilege check `false`, `SET ROLE editor`, `UPDATE` succeeded. The guard now also asks
`pg_has_role(current_user, r.oid, 'MEMBER')` over every role that holds one of the three rights.

**Smaller, each measured:** a clock returning garbage threw a bare `RangeError` that the pipeline
reported as the *store* being down (now a `TypeError` that names the clock); the one-door pin matched
statement-position calls one directory deep and was dodged by an alias, a namespace import, an arrow
and a subdirectory (now an identifier count, recursive, pinned per file — `audit.ts: 2`,
`database.ts: 4`, a comment included on purpose); the schema scan was case-sensitive and missed
`'audit'::regclass`, `LOCK` and `REFERENCES` (now `gi`, with both); `forgetTheLog`'s chain filter
had no test (now one, with a second chain that survives); `emptyTheLog` was unused and unfiltered
(deleted); four success-only tests carried MUST-NOT ids (dropped); README Break 1 did not say where
the line goes and the two placements give 6 and 21.

**Proved by breaking each one**, targeted test file, totals held:

| Sabotage | Result |
| --- | --- |
| the `pg`-branch refusal deleted — the critic's prediction | db tier 1 of 7 fails |
| no `trace_id` | 2 fail |
| every error treated as the server's / none treated as the server's | 1 fails each way |
| the someone-else's-row branch removed | 2 fail |
| the `SET ROLE` membership check removed | 2 fail |
| the driver's `Date` back in the hash path | 1 fails |
| the clock guard removed | 1 fails |
| the subprocess pin removed, bogus URL exported | 6 of 6 fail; with the pin, 6 pass |
| lowercase `from audit` in a source file | 1 fails |
| `forgetTheLog` without its `WHERE` | 1 fails |
| one more `useDatabase` mention | 1 fails |

**All nine break-it exercises re-measured at 322.** B5 is 65, B8 and B9 are 5 (the new unknown-outcome
tests fall with them), B1 is 6 replaced and 21 appended, the rest unchanged in their failure counts.

`pnpm check`: 23 files, **322 tests**. `pnpm test:db`: **7**, two of them the first to ever execute the
real-server branch. Both routes verify, 10 records each. From a clean copy outside the repository:
`pnpm install --frozen-lockfile`, `pnpm check` (one skip, named), `pnpm start` twice.

## 86 · Two limits became checks, and the real server answered the last open measurement (2026-10-04)

"Fix everything before step 10." The two routes README limit 3 said the start-up check "would not
notice" are both visible in the catalogue, so they stopped being limits:

- **A `SECURITY DEFINER` function.** It runs with its owner's rights, and `EXECUTE` on a new one goes
  to `PUBLIC`. Measured: privilege check `false`, `SELECT rewrite('REWRITTEN')`, row changed. The check
  now asks `pg_proc` for a `prosecdef` function this connection may execute whose **owner** may
  `UPDATE`, `DELETE` or `TRUNCATE` the table. The owner's rights are the condition, not the keyword — a
  helper owned by a role with no such right is not refused, and a test holds that line, because a
  check that fails closed on everything is a check somebody will switch off.
- **A trigger on the table.** The owner's code, running inside every `INSERT` this program makes,
  with the owner's rights. This step expects none; `pg_trigger` says whether there is one.

Both refuse at start-up with a message that names the fix. `theHead` lost a branch that could never
run from a working PostgreSQL and would have made an empty array verify as the whole history if it
ever did — it throws now. And `database.test.ts` pins the on-disk route by the fact (PostgreSQL's
files appear in the folder), not only by the display string.

**The last open measurement, taken.** Every in-process run said a collision of the program's own row
shape fails on `audit_pkey`; PostgreSQL 17 "should" agree. `audit.db.test.ts` now inserts that shape
twice at one position through the real application login: `23505`, `audit_pkey`. And three `audit()`
calls on three real connections — no held reads, no injected faults — leave one chain that verifies,
every loser refused with `23505`. Two open questions closed by measurement, not by argument.

**Proved by breaking it**, targeted file, totals held:

| Sabotage | Result |
| --- | --- |
| `SECURITY DEFINER` check removed | 2 fail |
| function check ignores the owner's rights | 1 fails — the harmless-helper test, which is the point |
| trigger check removed | 2 fail |
| `theHead` invents an empty log again | 1 fails |

Nine break-it exercises re-measured at 326: Break 1 appended is 24 now (every test that opens the
program's door), the rest keep their failure counts.

**Left open on purpose, because it is the learner's decision:** `verifyChain`'s time check. Two
instances of this program with skewed clocks still make an intact chain report as broken, and the
hash already pins the order. Dropping the check is a change to what `verifyChain` promises; it is put
to the learner in the step's handover, not taken here.

`pnpm check`: 23 files, **326 tests**. `pnpm test:db`: **9**. Both routes verify.

## 87 · `verifyChain` no longer rejects a time that goes backwards (2026-10-04)

**Taken at the learner's request** — "you do it" — against my own recommendation to wait for step 10.
Recorded here so it can be reversed in one line if the learner, having read it, disagrees.

**The problem.** `verifyChain` had four checks. The fourth, "`at` never goes backwards", was added
after a review and looked like tamper-evidence. It was not. A *changed* `at` breaks check 2, because
`at` is inside the hash. What the fourth check caught was an **honestly recorded** earlier time, and
that has exactly two causes, neither an attack:

- a backdated clock — which `recorded_at`, the database's own witness, already exposes (`001_audit.sql`,
  and the test "a backdated record is written, and its two times disagree");
- two instances of this program on one database with clocks a few seconds apart — the normal shape
  of a deployment, and the one the open question had been about since the morning.

For both, the check turned an intact chain into one that could never verify again, because nothing
can `UPDATE` the rows. A tamper-evidence check that cries wolf on an honest record, permanently, is a
check that gets switched off the first time it fires in production. Then it protects nothing.

**The decision.** Three checks: valid record, own hash, link to the record before. The hash chain pins
the order. The times are evidence, not a rule.

**What did not change.** `audit` still reads the clock after the tail (decision 77). The reason stands
on its own: a log whose times contradict its order is evidence that lies about the order of events,
whether or not anything rejects it. The four ordering tests in `audit-race.test.ts` still fall when
the clock is read early (Break 9: 4, was 5).

**Tests.** "A record whose time runs backwards does not verify" became "… is recorded faithfully and
still verifies", and it now also asserts that *editing* that time is still caught — by the hash. The
race test "an overtaken writer does not leave the chain unverifiable" was deleted: with the check gone
it could not fail for the reason it named. The year-0001 spelling no longer needs to be written first,
and its comment says so.

**Measured consequence nobody predicted.** Break 5 (the chain ordered as text) went from 65 failures
to 64: one of its failures had been the time check all along — text order puts `10` before `2`, and the
times went "backwards" with it. The nine counts were re-measured rather than adjusted.

**To reverse:** restore the `previousAt` comparison in `verifyChain`, flip the first test above back,
and re-measure Breaks 5 and 9.

`pnpm check`: 23 files, **325 tests**. `pnpm test:db`: 9. Both routes verify.

## 88 · Step 10's four decisions, taken by the learner before any code (2026-10-05)

Put as four one-at-a-time questions in plain words, with a recommendation each. The learner took
all four recommendations.

1. **A request's company comes from who is logged in**, never from the address. One membership
   means it is implied; two means the login must name one, and it must be theirs
   (`DSOR-IDN-03a`, `DSOR-SRC-02a`). The alternative — believing the URI — is what the spec forbids,
   because an address is an argument and arguments are data.
2. **A URI for another company is answered with `TENANT_MISMATCH`, telling nothing**: the same
   words whether that company or that invoice exists. The map's done-when says "the same not found
   as a URI that does not exist", and `DSOR-SRC-02b` says a mismatching tenant MUST cause
   `TENANT_MISMATCH` or `AUTHORIZATION_DENIED` — `RESOURCE_NOT_FOUND` is neither. The spec is
   authoritative over the map (AGENTS.md). The map is left as written — a step session never edits
   around its own folder — and the divergence is recorded here, in the README's "the map and the
   spec disagreed" paragraph, and at the top of `cross-tenant.test.ts`. (This entry first said the
   map's wording "is adjusted"; a review read the diff and it was not.) What the done-when *means* —
   reveal nothing — is kept to the letter:
   the refusal for `org_789` (exists) and `org_000` (does not) must be identical but for the echoed
   address.
3. **The invoices move into PostgreSQL in this step**, named as the cost of rows the way step 09
   named async as the cost of a database. The test applied: can the tenancy idea be explained
   without SQL? It can, so the SQL is cost, not a second idea. Leaving it for step 11 would make
   row-level security's lesson compete with a store rewrite. Be honest about the tension a critic
   named: step 09 deferred this very move *because* it would have been a second idea there. Both
   are true — in step 09 the move had no idea to serve; here it serves one — and the test is the
   same each time: can the step's idea be explained without it?
4. **The second company is `org_789`, with its own `INV-1008`** — the same number as `org_456`'s,
   a different amount — because that is the sharpest proof that an invoice number alone is not an
   identity. The agent `accounts-payable-fte` works for both companies, so its requests must say
   which; `user_123` and `cfo_100` stay in `org_456` only.

Two things taken without asking because the rules leave no choice: the audit chain becomes one per
tenant (`DSOR-TEN-02a`), and `tenant.ts`'s constant goes. One thing deferred and said so: `people.ts`
notes a role is really per company; nobody here has different roles in different companies, so
moving `role` inside `memberships` would add code with no observable behaviour.

## 89 · The invoices' key is the company and the number, and what the sweep said about it (2026-10-05)

Pieces 1 to 3 of step 10, each red first, each sabotaged. Two sabotage results were not counts and
are recorded as what they were:

- **The key made the number alone** (`PRIMARY KEY (id)`): nine tests *skipped*, not failed. The
  running example in `004_running_example.sql` holds an INV-1008 for each company, and under that key
  the second one is refused at seed time, so the test file's setup dies before any assertion runs.
  That is the guard working — the story itself cannot be loaded without a company in the key — but
  "skipped" is the invalid-run tell (lesson 11), so it is written here and not in a table of
  failures. (That was the piece-3 suite; on the finished suite the same break is 61 failed, 130
  passed, 182 skipped — the README's Break 7.)
- **`tenant_id` made nullable**: nothing failed. A primary key forbids NULL in its columns, so the
  `NOT NULL` on `tenant_id` is a word no test can kill. It stays, with a comment that says exactly
  that: a reader looking at the column should not need to know the rule about keys to see that a
  company is required. Lesson 18's honest exception.

The pieces themselves:

1. **Resolve the tenant** is §21 step 2, a stage of its own, required by name, from memberships and
   the login's claim — and `authorize` refuses `INTERNAL_ERROR` if it ever runs without one, because
   the previous step's "lazied stage" test demanded that a no-op stage be noticed.
2. **The address is checked against the request's company**, and the refusal echoes the address and
   nothing else. Three sabotages: back to the constant, naming your company, saying whether theirs
   exists — one failure each.
3. **The invoices are rows**, keyed `(tenant_id, id)`, the amount cast to text so PGlite cannot hand
   back a number, UPDATE granted on `status` alone. The database handle moved to `store.ts` so both
   stores share one connection; the one-door pin now counts three files. The agent working for
   org_789 gets org_789's INV-1008 (18,000.00), not org_456's (31,400.00).

`pnpm check`: 350.

## 90 · A refusal with no company is written to every company the caller belongs to (2026-10-05)

Asked in plain words, one question, during piece 4. A request refused at §21.2 — the shared agent
that did not say which employer, `user_123` naming `org_789` — resolved to no company, and denials
are evidence (`DSOR-EXE-02`). Three places it could go:

- **every company the caller belongs to** — taken. `user_123`'s lands in `org_456`'s log, where
  their supervisor looks. The agent's lands in both employers' logs, because both should know their
  agent made a request without saying who it was working for. No log ever carries a stranger's
  attempt to reach it. A caller who belongs to no company at all is counted, like one who is not
  logged in.
- count it, do not write it — simplest, and an agent probing other companies would leave no record,
  which is exactly what a log exists to show.
- a log that belongs to no company — an audit partition keyed by nothing, which `DSOR-TEN-02a` does
  not allow, and nobody would own it.

`recordTheDecision` computes the homes: the resolved company, or every membership, or `[undefined]`
(counted). `audit` itself still writes one record in one chain.

Two things a review added. A fanned-out request is two records with two `trace_id`s — the slot is
borrowed as a per-attempt nonce and must move when `DSOR-COR-01a`'s propagated trace id lands. And
there is no transaction across the two chains, so when the second write fails after the first
committed, the caller is told exactly that ("written to 1 of 2 company logs (org_456)") rather than
"nothing was written"; one transaction across chains is step 16's, when the control-plane store
brings a connection of its own.

## 91 · The address check moved from the handler to §21.6, because the log said ALLOW (2026-10-05)

**Found by my own piece 4 in my own piece 2.** Piece 2 put the "is this address in your company?"
check inside the handler, where the step-09 constant comparison had been. Piece 4's test asked what
the log said about a refused address:

```text
expected 'ALLOWED' to be 'TENANT_MISMATCH'
```

The handler runs at §21.14. The decision is recorded at §21.11. So the record said the request was
allowed, and the caller was told it was refused — the log and the answer disagreeing, the one thing
a decision record exists to prevent, and the thing step 09 fought for a day.

**The decision.** `DSOR-SRC-02b` is a fact about the *arguments*, and §21.6 is where facts about the
arguments are decided. `validateTheInput` now refuses any own argument that is a `dsor://` address
for another company — generically, not only `invoice` — before the record. An address that does not
parse is left for the handler's `VALIDATION_FAILED`, as before: that gap is step 04's, is stated in
the previous step's test, and is not this step's idea.

**The handler keeps a re-check, as `INTERNAL_ERROR`.** Unreachable through the real pipeline, and by
lesson 18 a guard no test can reach protects nothing — so a test builds the one door that reaches
it: a validate stage that copies and hashes the arguments and forgot the address. It answers
`INTERNAL_ERROR`, this program's bug, not a refusal the caller could act on, for the same reason the
door refuses without a receipt. Removing the re-check fails exactly that test.

**One example moved out of step 09's test.** "A call that fails while executing is recorded as the
ALLOW it was" listed an address for another company as an execution-time failure. It is a decision
now. A missing invoice took its place, because that one really is answered after the decision.

Measured: with the check in validate, Break 5 fails 11 tests; with it in the handler alone, the
audit says ALLOW and one test fails for the right reason.

## 92 · The hostile review of step 10, and what it cost (2026-10-05)

Four reviewers in parallel, then a critic. The critic said **no**, for reasons that were specific and
mostly right. Six were code.

- **Every proposal address was in org_456.** `success()` built `dsor://org_456/proposal/…` whatever
  the command's company; a reviewer ran `invoice.issue` as org_789 and got a receipt in org_456's
  proposal space. A proposal is a tenant-owned resource (`DSOR-TEN-01a`). It names the command's
  company now, and a test runs that command.
- **`SRC-02b` was claimed in full while a bare `tenant`/`principal` argument was ignored.** Step 05's
  rule, and two tests pinned it. The spec's letter is "MUST cause `TENANT_MISMATCH` or
  `AUTHORIZATION_DENIED`", so `validate the input` refuses a disagreeing `tenant`/`tenant_id` or
  `principal`/`principal_id`; an agreeing one still changes nothing. Step 05's two tests became four
  under the right ids, and the demo's planted-principal line is a `DENY`. The README says the answer
  changed and why.
- **The fan-out told the caller "could not be written down" after one log had taken the write.**
  There is no transaction across chains — the `Database` seam is one method, and a transaction
  needs one connection held across statements, which a pool does not promise. The message now names
  which logs took it; the real fix is step 16's. A test fails the second `INSERT` and reads both logs.
- **`main.test.ts` deleted the demo database before each test and never after**, so `pnpm check`
  left one run's records and an issued `INV-1009` behind, and a learner's first `pnpm start` printed
  `CONFLICT` and thirty records. The clean-copy numbers recorded in the step note — "30 then 45" —
  were that symptom, written down as if they were the story. An `afterAll` cleans up; the clean copy
  now shows `COMMITTED`, 15 and 2, then `CONFLICT`, 30 and 4.
- **The start-up guard never looked at the invoices table** — the critic's "next attack": grant the
  application `INSERT, UPDATE, DELETE` on invoices and the program started happily. It refuses now,
  and README Break 8 went from 1 failure to 17 because of it.
- **"Active" rested on `people.ts` alone.** A hand-built principal with a membership of a company the
  program does not serve resolved to it. `tenantFor` checks the list at the request; `audit` refuses
  to name a chain after an unserved company.

The rest: Break 3's described change produced SQL errors, not wrong rows (rewritten, 6 failures that
are all the leak); the amount cast's comment claimed PGlite returns a number (false, measured — both
drivers return text, the cast pins it, no test can kill it); `status.md` said the invoices were still
an array; decision 88 said the map was adjusted when it was not; six tests were weak in the way a
reviewer could name (the arguments test used the only caller who could not tell "ignored" from
"honoured", "before anything else" asserted a code and not an order, "never links" passed under one
shared chain, the command path was never tried against the other company's invoice, a second own
address argument was never sent, the fallback label was pinned by substring); three test titles
carried ids they did not prove; one stray `NEW IN STEP 09` marker sat in `vitest.config.ts`.

**One false clean of my own.** Sabotaging the new `afterAll` by cutting at the first `});` cut inside
`rmSync(…)`, left a file that could not load, and a file that cannot load writes nothing — so the
check said "clean" and proved nothing. Redone by emptying the body: the database is left behind
without the cleanup and not with it. Lesson 11 again, in a new shape.

**Proved by breaking it.** Every guard the review added, sabotaged, each one test: the proposal
address back to org_456, a bare tenant key ignored, a bare principal key ignored, the partial-failure
message lying, the invoices grant unchecked, an unserved membership resolving, `audit` accepting any
chain name. Eight break-it exercises re-measured at 373.

`pnpm check`: 27 files, **373 tests**. Clean copy: 372 passed, 1 skipped.

## 93 · Complete testing, steps 01 to 10 (2026-10-05)

An independent evaluation of all ten copies (five reviewers, grades A–F) gave 01, 02, 07 and 10 a B,
03 and 09 a C, and 04, 05, 06 and 08 a D — the D's for a README line the folder contradicted. Three
things were worth doing across every step, and were done by one fixer per folder, each verified by
me afterwards (every suite re-run, every marker and every claimed id re-grepped, two sabotages
re-done by hand):

1. **Two real holes.** Every test that planted a principal in the arguments also sent a valid login,
   so a fallback to `args.principal` with nobody logged in survived the suites of 05 to 10. And
   deny-by-default was never exercised for a *query*, because every role in the cast may read. Both
   have tests now, each proved to have teeth by adding the hole and pasting the failure. Step 06
   could not close the query half without adding a person, and says so in one sentence; 07 to 10
   close it through a door whose authenticate stage carries a role nobody defined.
2. **Corrections repeated forward.** Wrong rule ids on tests — the frozen-list test re-acquiring
   `MON-01` that step 01 removed, `OPR-02b` on freeze-only tests, five mis-titles in 07–09 that 06
   had fixed, `OPR-04a` with one interface, `COR-01b` on a clock test, `AUD-04c` in a title the README
   disclaimed — all now match the earliest correction. Steps 07, 08 and 09 retire the markers of
   the steps before them. A claimed-ids-versus-titles check now finds nothing in any folder.
3. **Step 08's Break-it rewritten from real output**, including the error line the program could
   never print. Every count in every README was re-measured by the fixer that touched the folder.

One false claim of my own in the sweep: a fixer wrote step 10's Break 2 as 7 failures; measured twice
at 376, it is 6, and the README says 6. And one near-miss: my backup for that re-measurement failed
silently, which left `tenant.ts` sabotaged until the diff showed it — the diff is the check, not the
intention.

Counts after: 19 · 36 · 72 · 104 · 133 · 157 · 181 · 234 · 327 · 376.

## 94 · Step 11's three decisions, taken by the learner before any code (2026-10-06)

The problem was shown first, measured on step 10's own database as `dsor_runtime`: a query that
forgets the company — `SELECT … FROM invoices WHERE id = 'INV-1008'` — returned both companies'
rows, org_456's 31,400.00 and org_789's 18,000.00, and no test noticed, because the tests only
check the queries that exist today. One lock, held by the program alone. Three questions, one at a
time, in plain words, with a recommendation each; the learner took all three.

1. **Both tables get the lock**, the invoices and the audit log, because both carry a company and
   a lock on one of two doors is not a lock. The log's policy also checks writes, so the program
   cannot put a record into another company's chain by mistake — a guarantee step 10 did not have.
   The alternative, invoices only, is the spec's own example and the smaller change, and it leaves
   a forgotten `WHERE` on the log free to leak another company's decisions.
2. **The company is said before each statement**: every SQL statement runs in its own small
   transaction that first calls `set_config('dsor.tenant_id', $1, true)`. The stores keep their
   shape and the audit writer's recovery after a collision keeps working — a failed INSERT inside a
   bigger transaction would abort the re-query that recovers from it. Once per request, the shape
   §36 draws, changes the pipeline, the context and the writer at the same time; it is step 36's,
   where a business change and its record must land in one transaction.
3. **The demo runs the forgotten query, with the company set**, and prints one row where step 10's
   database gave two. The step's whole claim, shown by running it rather than told.

Two things taken without asking because the rules leave no choice: `dsor_runtime` must be neither a
superuser nor `BYPASSRLS` nor an owner of the tables (`DSOR-RP-01a`), so the start-up refusal from
step 09 grows those checks; and the lock is `FORCE`d (`DSOR-RP-01b`) even though every owner on our
routes is a superuser, which bypasses it regardless — the tests prove `FORCE` with an owner that is
not.
