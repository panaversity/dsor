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

## 95 · What step 11's build found, and one divergence from the map (2026-10-07)

1. **The test support runs the stores as the application.** Measured with a store that forgets the
   company: as `dsor_runtime`, 142 of 394 tests fail; as PGlite's superuser, 27 — and none of the 27
   is a store's own test, because a superuser skips every policy. So `aDatabase()` ends with
   `SET ROLE dsor_runtime`, and the two seams that need the owner (`resetInvoices`, the eraser)
   step up through `asTheOwner` and always step back down, in a `finally`. The cost: sixteen tests
   that ran raw SQL as the application without a company went red and had to say it. That cost is
   the step's first lesson and is written up as such.
2. **The map's third trap, as measured.** The map says a Console-made Neon user belongs to
   `neon_superuser`, "which ignores row-level security altogether". The role does; its member does
   not, until it runs `SET ROLE neon_superuser` — `BYPASSRLS` is a role attribute, and PostgreSQL
   passes privileges through membership and never attributes. The first version of the Neon test
   expected the member to leak, and the probe said otherwise. The test now asserts both halves:
   filtered as itself, both companies after `SET ROLE`. The start-up check refuses the membership
   by name either way. The map is left as written — a step session never edits around its folder —
   and the README says where it and the measurement disagree.
3. **The start-up check asks whether the lock is on.** Enabled, forced, with a policy, on both
   tables; else it refuses with "the second lock is not on". The alternative — trusting that
   migration 005 was applied — is a program that leaks quietly against a database at 004. Removing
   `FORCE` from the migration therefore fails 18 tests, not 1: the owner's test, and seventeen that
   open the program's door.
4. **`rolsuper` is not checked**, because a superuser may `UPDATE` the log and step 09's privilege
   check refuses it first; a line no test can kill is not added for the rule's wording (lesson 18).
   `dsor.principal_id` from §36's example is not set, for the same reason: nothing reads it.
5. **Why not one transaction per request.** It is the shape §36 draws and step 36 needs. Here it
   would have changed the pipeline, the context and the audit writer at once, and the writer's
   recovery after a collision runs a SELECT after a failed INSERT — inside one transaction that is
   "current transaction is aborted". Per statement keeps every store's shape and every recovery
   path, and is honest about being the smaller claim.

## 96 · Step 11's hostile review: three windows past the lock, and a comment that over-claimed (2026-10-07)

One reviewer, read-only, with PGlite probes. Seven findings; six changed something, one was
considered and left. Every fix was red first, and each guard was removed again afterwards to see
its test fail.

1. **"Is there a policy" asks nothing.** Policies are permissive and OR'd together, so one more
   that says `true` — for everyone, or `TO dsor_runtime` — opens the table while the first version
   of the lock question still said "on". Measured: both companies, check passing. The question now
   asks for exactly one policy per table, for all commands and all roles, whose `USING` and
   `WITH CHECK` are the migration's expression as PostgreSQL prints it back. A server that printed
   it differently would refuse to start, which is the right direction.
2. **A `SECURITY DEFINER` function owned by a `BYPASSRLS` role** reads every company's rows while
   holding nothing step 09's function question looks for. The question now also refuses a helper
   whose owner is a superuser, holds `BYPASSRLS`, or owns (or may become the owner of) a tenant
   table. Step 09's "harmless helper" test still passes: its owner is none of those.
3. **A view the owner made is a window.** A view runs with its owner's rights, and every owner on
   our routes skips the lock. Rather than enumerate the shapes, the check asks what the application
   may `SELECT` at all: the two tenant tables, and nothing else, named in the refusal. The cost,
   and it is deliberate: every later step that adds a table the application reads must add it here,
   or the program refuses to start. Fail closed, like the column list of 002.
4. **The audit policy binds `tenant`, not `chain`.** Migration 005's comment said the policy stops
   a wrong chain from reaching another company's log; measured, a row with tenant org_456 and chain
   audit:org_789 went in. No path writes one today — both values come from one variable — and the
   day one does, org_789's head never sees the stray row and collides on every write after. A
   `CHECK (chain = 'audit:' || tenant)` in 005 says what the comment claimed; the comment now says
   what the policy checks. Two of step 09's permission tests wrote org_999's chain with org_456's
   tenant and were corrected to agree with themselves. The step's own database was dropped and
   recreated, because 005 had been applied and the checksum would have refused the edit.
5. **`asTheOwner` restores whoever called it**, not always the application, so a nested call
   cannot drop its caller silently. Nobody nests them yet.
6. **A stale comment** in the eraser said step 09 "is where" the log moves; it moved.
7. **Considered and left: `overPool` on a failed `COMMIT`.** A socket that dies during `COMMIT`
   leaves the outcome unknown, and the adapter rethrows the driver's error as it is. That error
   carries no SQLSTATE, which is exactly the shape `audit.ts` already treats as "the store could
   not be asked" and answers `OUTCOME_UNKNOWN`; a `COMMIT` the server refused carries one and is a
   definite no. Tagging the phase, as the reviewer suggested, would add a field nothing reads.

The reviewer also measured what the first build claimed and could not have proved: a two-deep
`INHERIT FALSE` chain to a `BYPASSRLS` role is refused, because `pg_has_role(…, 'MEMBER')` is
transitive; `SET row_security = off` as the application is an error, not a bypass. 394 became 400.

## 97 · Step 11, tested again: what an independent evaluation and four measurements changed (2026-10-08)

The learner asked whether step 11 had been tested thoroughly, and the honest answer listed five
things that had not: Neon itself, a second reviewer, two faults reasoned about rather than injected,
the cost of a transaction per statement, and an evaluation of the kind steps 01 to 10 had. Four of
the five were done; Neon needs a project the learner has to provide.

**The evaluation** — four reviewers, a mutation pass on a copy, a critic, two verifiers; two agents
were blocked by the model's cyber safeguards for the word "attacker", and their ground was covered
by the others — graded the folder C, and every grade was earned:

1. **Three more ways past the helper question.** The first fix refused a `SECURITY DEFINER` helper
   the application may `EXECUTE`. An aggregate whose transition function is the helper, `EXECUTE`
   held through an `INHERIT FALSE` membership, and a trigger on the invoices that fires the helper
   under the application's own `UPDATE` all reached it without `EXECUTE` — the trigger one both
   leaked every company into a column and could rewrite the log, while the check said the lock was
   on. The helper is refused for existing now, whoever may call it, and the trigger question asks
   about both tenant tables. The cost: a harmless `SECURITY DEFINER` helper owned by a role that
   holds nothing still passes (step 09's test), but one owned by a superuser is refused even if
   nobody may call it.
2. **The demo's two lines were pinned by nothing.** Inverting them passed `main.test.ts` 9 of 9.
   One test pins them now. The header of that file says this is the failure it exists to stop, and
   step 10 pinned its demo lines; step 11 had not.
3. **The pool adapter was invisible to `pnpm test`.** Two mutations in `overPool` — skip the
   `ROLLBACK`, say the company per session — survived the whole unit suite, because the unit tier
   runs on PGlite and CI never runs the database tier. A stub pool now records every statement and
   how the connection comes back.
4. **`singleFork` is not an option Vitest 4 has.** Zero occurrences in its code; the files had been
   running in parallel since step 09, which is what every differing failure and shrinking total
   under a sabotage was, and what pull request #4 saw as "13 timeouts" in `my_10`. Measured: as
   configured, 2 failed of 401 in 29 seconds; with `fileParallelism: false`, all pass in 95
   seconds, three times; the database tier, with two files writing one table, 3 failed with a
   different set each run, 16 passed with the line. Nobody noticed because `tsconfig.json` did not
   include the config files; it does now, and `tsc` refused the dead option the moment it looked.
   Steps 09 and 10 carry the same two lines; reported to the learner, not edited from a step 11
   session.
5. **Two step 09 test files ran the stores as the superuser**, so the company their fakes forwarded
   was enforced nowhere. They build their database through the support now, as the application.
6. **The folder contradicted itself about Neon's owner.** Five places said every owner is a
   superuser; decision 95 said membership passes no `BYPASSRLS`. Neon's `neondb_owner` is a member
   of `neon_superuser`, not a superuser, so on Neon `FORCE` is exactly what filters it. Reworded.
7. **The lock's real limit was never said**: it stops a statement that said no company, not one
   that said the wrong one. Said now, in plain words. And the start-up check is named for what it
   is, an enumeration of the shapes three reviews found, with step 16 as where a map replaces it.
8. Smaller: a whitespace-only company was accepted by the store guard; a session that already
   carries a company would hand it to every plain statement, so the check refuses one; the
   application's own temp table refused start-up with a confusing message, so `pg_temp` is left out;
   a missing tenant table is refused in the step's words rather than PostgreSQL's; the pool gets a
   connection timeout, since a store that awaited one statement inside another would hang forever
   on a pool of one; a `security_invoker` view is filtered and the README says so; the "What
   changed" command diffed `node_modules`; one test title claimed `RP-01d` with a company set;
   `scripts/door.ts` gives the learner the probe behind the Break-it blocks.

**The four measurements.** A connection that dies during `COMMIT` on a real server: the recovery
finds the row by looking, a connection that then stays dead gets `OUTCOME_UNKNOWN` with the row
still there, and the connection handed back carries nothing — the first version of that fault hit
the tail read's `COMMIT` instead of the INSERT's, and the writer threw before its recovery, which
was correct and measured the wrong moment. PGlite's one connection: a plain statement cannot slip
inside another company's open transaction. The cost: PGlite 0.103 → 0.275 ms per statement, a local
PostgreSQL 17 over a socket 0.083 → 0.126 ms. And two things found on the way: a migration's
checksum covers its comments, so the step's database was recreated twice; and macOS purges `/tmp`,
where step 09's README keeps the cluster, so it was rebuilt from `initdb`.

## 98 · Neon, measured at last, and what it corrected (2026-10-08)

The learner logged the Neon CLI in; a project `dsor-tutorial` (Singapore, PostgreSQL 18), a
database `dsor_step11`, and `dsor_runtime` created with `CREATE ROLE` through the owner's
connection string — the connection strings written into `.env` by redirect, never printed. The five
migrations applied, the sixteen database-tier tests passed twice, and `pnpm start` through the real
`dsor_runtime` login printed the step's two lines with both chains verifying.

What Neon's own roles look like, measured:

```text
console_made     superuser=false  BYPASSRLS=true   CREATEROLE=true   member of neon_superuser=true
dsor_runtime     superuser=false  BYPASSRLS=false  CREATEROLE=false  member of neon_superuser=false
neon_superuser   superuser=false  BYPASSRLS=true   CREATEROLE=true   member of neon_superuser=true
neondb_owner     superuser=false  BYPASSRLS=true   CREATEROLE=true   member of neon_superuser=true
```

So three corrections to the folder's own story:

1. **The map was right about Neon.** A role made in the Console or through the API — `console_made`
   above — holds `BYPASSRLS` *itself*, and so does the owner. It skips every policy outright, with
   or without the membership. Decision 95's finding stands as PostgreSQL's rule — membership passes
   no attribute, measured on PGlite — but Neon does not rely on the membership; it grants the
   attribute. And Neon refuses `SET ROLE neon_superuser` to everyone: "It is not allowed to change
   role to neon_superuser". The "one SET ROLE away" story is true of a plain PostgreSQL and false of
   Neon, where the owner is not one step away but already there.
2. **The owner is not filtered by `FORCE` on Neon** either, since it holds `BYPASSRLS`. Decision 97's
   sixth point and the sentences it changed were wrong about that, and are corrected in the README,
   the migration's comment, and the step note. All three owners this tutorial met skip the lock;
   `FORCE` is proven with an owner the test makes.
3. **The program refuses a Console-made role at step 09's question**, before this step's: the
   membership of `neon_superuser` carries `UPDATE` on the log. Measured through the door with
   `console_made`'s connection string: "may UPDATE, DELETE, TRUNCATE the audit table". The
   `BYPASSRLS` and membership questions stand behind it.

Two more things measured on the way. Neon's owner holds `CREATEROLE` directly, so `CREATE ROLE
dsor_runtime` works as the owner and the role comes out with nothing. And the cost over a network:
117 ms for a plain statement, 484 ms through the adapter — four round trips where there was one.
That is the price of decision 94's "before each statement", and the number step 36's one
transaction per request is measured against.

Also recorded: the `.env` now names Neon; the local server's lines are kept beside it in
`.env.local-server`. The Neon database was recreated once, because a comment in migration 005
changed after it was applied (lesson 40).

## 99 · Step 12's two decisions, taken by the learner before any code (2026-10-08)

The problem was shown first, measured on a copy of step 11: a third operation added the careless
way — the address nested inside an argument, the store asked for the company the address names —
and step 11's hand-written cross-tenant suite stayed at `12 passed` while `user_123` of org_456 was
handed org_789's `INV-1008`, vendor and amount. The second lock did not help, because the careless
handler *said* org_789 to the store, and the lock trusts whatever company a statement says. Two
questions, one at a time, in plain words; the learner took both recommendations.

1. **Each contract carries an example request**, under `extensions` with a reverse-DNS key, which
   the specification's own schema allows and which step 03 taught and tested on a made-up
   contract; these are the first shipped contracts that carry one. The suite reads the registry, takes each example, rewrites every address in it to
   another company, and calls. A contract without an example fails the suite rather than being
   skipped — that is what "grows by itself" has to mean. The alternatives: a table in the test
   (the knowledge away from the operation, and an edit to the test for every new operation), or
   building requests from input schemas (no step has request schemas yet; a second idea).
2. **The suite runs on PGlite under `pnpm check` and again in the database tier** against the
   database `.env` names, like every other test here. The map says "a fresh Neon branch, so it can
   create two companies and destroy them without touching your data": a branch per run needs the
   Neon CLI, credentials and the network inside the tests, which no earlier test has, and PGlite is
   a fresh database every run already. Recorded as a divergence; the map is left as written.

The step's databases: `dsor_step12` on Neon, which `.env` names, and on the local server, which
`.env.local-server` names. The database tier ran on Neon on the untouched copy: 16 passed.

## 100 · What step 12's build found: a question that passed for the wrong reason (2026-10-08)

The first careless-command sabotage — an operation that issues whatever draft a nested address names,
in the address's company — failed three of the suite's questions and passed "the other company's
rows are untouched". Not because the command was careful: org_789 had no `INV-1009`, the number the
example names, so there was nothing to issue. A passing test with nothing behind it is the thing
this tutorial keeps finding (lessons 18 and 34), and this one was in the suite that exists to find
it.

Two changes, in that order. The suite asks, before the untouched-rows question, that the other
company holds every invoice number the example names, with the fix in the failure message ("add it
to 004_running_example.sql"). And the seed gives org_789 an `INV-1009`, as a draft, with a different
amount. The same sabotage then failed four questions, the untouched-rows one among them: org_789's
draft had been issued. The cost: step 10's "not found in yours" test had no exclusive number left,
so org_789 also gained `INV-2001`, which org_456 lacks, and that test asks for it. The databases
were recreated twice for the changed migration.

Two smaller things. The demo's two lines were pinned from the start, by a test that reads the
operation ids off them and compares with the registry, because step 11's were not and an evaluation
found it. And the suite's generator lives in `test/support/` as a function rather than a test file,
so the same six questions run on PGlite and on the real server without a second copy that could
drift.

## 101 · Step 12's hostile review and mutation pass: a suite that could be lied to (2026-10-08)

Four reviewers, a mutation pass on a copy, and a critic, run while the step was still being
written. The done-when held for a careless author — a third operation with a nested address failed
four questions by name, measured by three of them independently — and then two of them wrote the
author who is not careless but hostile.

1. **A refusal-shaped envelope with the row inside it.** An operation that reads a nested address,
   fetches the other company's row, returns `TENANT_MISMATCH`, retry `never`, the same message —
   and the row tucked into the envelope — and appends a `DENY` of its own after the pipeline's
   `ALLOW`. The first suite compared the refusal's words and read the log's last record, and passed
   it. Now question 2 compares the whole envelope with the one for a company that does not exist,
   which cannot carry that company's row, and question 5 asks for exactly one record for the
   request and that it is the `DENY`. Measured after: 11 failures for that operation.
2. **The seed row already issued.** The mutation pass seeded org_789's `INV-1009` as `issued`;
   a careless `invoice.issue` found nothing it could do, the rows stayed untouched, and question 3
   — which asked only that the number exists — was content. For a command, it now asks that the
   other company's row is in the same state as yours, the state the example works in.
3. **Nothing tested the suite.** Six assertions deleted one at a time, six whole-suite passes. The
   six questions are plain functions now, `questions` in the support file, and
   `cross-tenant-suite-itself.test.ts` feeds each one an honest answer and then the lie it exists
   to catch. Delete an assertion and its lie passes there.
4. **An example with no address** was asked to be both refused and allowed; it gets one failing
   test by name instead. Question 3 reads invoice rows only and says so for any other kind of
   address. The address helpers moved into `src/examples.ts`, one implementation for the suite,
   the example test and the demo, where a private copy in the test had let the suite's own copy be
   emptied unnoticed. The example reader refuses an array and a null, both found by mutation. The
   database-tier runner skips without a server instead of registering nothing, which vitest calls
   an error. Its `afterAll` puts the invoices back as well as the log.
5. **Said in the README**, because the reviewers found the sentences missing: exactly what grows by
   itself and the five things a human still writes; that the pipeline walks top-level strings and
   the suite rewrites at any depth, which is the gap the suite covers; that the database tier
   empties the named database's invoices and log; that a second process using the folder can fail
   the demo test; that these are the first shipped contracts to carry an `extensions` key, which
   step 03 taught on a made-up one; and that question 5 proves the `DENY` is the one record, while
   "before the response" is step 08's one proof over the shared pipeline.

Then the critic, after the five: question 6 asked only that the own-company example was not
refused, so a handler that returned org_456's invoice with org_789's beside it, in a successful
answer, passed the suite, the self-test and step 10's file — the one leak shape a same-company
call can have. It reads the answer now and refuses the other company's name and the four things
org_789 alone holds. And `org_000` could be made a real company with nothing saying so; a guard
pins what the three companies are. The database-tier runner deletes the story's two companies'
rows only. 429 became 444; the database tier 29 became 30. Every count on the README was
re-measured twice after the changes, on a copy outside the repository.

## 102 · Step 13's three decisions, taken by the learner before any code (2026-10-08)

The problem was shown first, measured on a copy of step 12 with a list written the obvious way and
fifty thousand invoices seeded for org_456: `{ limit: 25 }` gave 25 rows in 23 ms; `{ limit:
1,000,000 }` gave all 50,002 rows, three megabytes, in 105 ms, and nothing in the program said no.
§7.1's sentence — an agent in a loop should not be able to download the whole customer table — and
`DSOR-QRY-01`'s: a server-side maximum page size and maximum result size on every query, whether
or not the client asks for a limit. Three questions, one at a time, in plain words; the learner
took all three recommendations.

1. **The next page comes after the last invoice on this one.** The page says which invoice it
   ended on; the caller sends it back as `after`; the server reads the rows after it, in id order.
   A page number was the alternative: familiar, but a caller can name page 40,000, the database
   skips everything before it, and a page shifts when a row is added in front. "No next page this
   step" would have made one page the whole answer and shown nothing of what a page is.
2. **The list names its scope through its cursor, which is an address.** `after` is
   `dsor://org_456/invoice/INV-1008`, so the §21.6 scan refuses a cursor from another company and
   step 12's suite can move it, with nothing new. The company itself still comes from the login.
   The alternatives were a collection address with no id, which changes the grammar every step
   since 02 relies on, or an operation with no address, which the suite would have to be taught —
   the critic's addressless case from step 12, answered by not building one.
3. **Two maxima and a default in one file, and the pipeline refuses an oversize answer.** The handler's SQL
   carries `LIMIT`; after the handler runs, the door checks the answer against both maxima and
   refuses one that exceeds them as the program's own error, never returned. Two layers, like
   steps 10 and 11: the query written next year that forgets its `LIMIT` is caught. Per-contract
   maxima were the alternative; the specification's contract schema has no such field, and a
   contract that left them out would need a default somewhere anyway. The numbers themselves are
   this step's, provisional like §44's: 100 rows per page, 64 KiB per answer, 25 rows when the
   caller says nothing.

The step's databases: `dsor_step13` on Neon and on the local server; the untouched copy ran 444
and 30.

## 103 · What step 13's build found: a cap no ordinary test can see (2026-10-08)

The list slices the page it hands back — one row more is asked for, to know whether there is a
next, and the extra is dropped. So every assertion about the page passes whether or not the SQL
carries its `LIMIT`: a list that fetched the whole table and cut the page afterwards is correct in
every way a test of the answer can measure, and it is exactly the leak §7.1 describes, one hop
earlier. The test that sees it is a connection that counts what each statement returned, in front
of the real one, asserting the database handed back the page plus one and nothing more — the same
device step 11 used to prove every statement says its company. Breaks 1 and 5 of the README exist
to show that without it the suite is blind to the thing the step is about.

Two smaller things. `makeDoor` takes a handler table, defaulting to the program's own, because the
door's measuring can only be tested with a handler that returns too much and the program has none;
the table bypasses nothing the door checks, since a door is still every stage and the receipt. And
the demo's "a million" line gets two invoices, because two is all the story has; the README says
so rather than seed the demo to make a number appear.

## 104 · The review's one design suggestion, declined: the page is not cut by bytes (2026-10-08)

The hostile review of step 13 — five reviewers, one of them a mutation sweep of thirty-two
one-line changes — found eight holes, every one closed with a test that failed first; the step's
note lists them. One suggestion was about design and is recorded here because it was declined. A
reviewer measured that a single row wider than 64 KiB — `vendor` is unbounded text — makes its
page and its own `invoice.get` refuse with `INTERNAL_ERROR`, retry never, and proposed that
`listInvoices` take rows while the running JSON size stays under the ceiling, so that the byte
maximum shapes the page instead of refusing it.

Declined, for three reasons. The learner chose the refusal at the door (decision 102, item 3), and
a list that trims by bytes moves half of that decision back into the handler. A page whose size
depends on the data hides the thing a wide row is — a column with no bound, which is a schema
problem, and the honest fix is a bound on the column in a step that owns the schema. And the
one-row case is not helped at all: an `invoice.get` of that row refuses whatever the list does. So
the step refuses, the README says so, and the test that seeds such a row pins that both queries
refuse rather than shrink. The remedy for a caller is a smaller `limit`; the remedy for the row is
a later step.

Two smaller declines, for the record. The door does not check that a page's rows belong to the
request's company: the real handler cannot produce one that does not (the `WHERE` and RLS, and
now a test of the `WHERE` alone), and a tenancy check at the door would be a second idea in this
step. And `makeDoor` does not run `assertPaired` on a handler table a test hands it: a test's table
is partial on purpose, and the resolve stage refuses an operation with no contract before any
handler is looked up.

A third, from the review's critic: widen the page type now, to rows of any kind, so that the door's
row layer applies to the next list as well as to this one. Not in this step. There is one list, a
type for lists that do not exist is a guess, and the README says what the next list must do; the
widening belongs to the step that builds it.

## 105 · Step 14's three decisions, taken by the learner before any code (2026-10-08)

The problem was shown first, on step 13's running demo. `accounts-payable-fte` reads INV-1008 and
gets `31400.00 USD`, the same line as `user_123` — and the agent's answers travel to a model
provider outside the company, so the amount left org_456, and with `invoice.list` a hundred
amounts leave per page. No field carries a label, nothing between the database and the agent
asks, and by `DSOR-CLS-01` every unlabelled field is confidential, so all of it left. The rules are
§19's: CLS-01, CLS-02a, CLS-02b, CLS-03 and CLS-05. Three questions, one at a time, in plain
words; the learner took all three recommendations.

1. **One file for all labels, in code.** `src/classification.ts` holds a table — entity, field,
   label — and a field missing from it is confidential, which is the rule itself and is tested by
   taking a label away. Beside each entity's shape was the alternative: the label next to the type
   it labels, but every entity file grows its own table and the no-label rule is repeated per
   file. In the contract's output was the third: the same invoice labelled twice, in `invoice.get`
   and in `invoice.list`, free to disagree.
2. **A field above the clearance is left out, and listed.** Nothing of the value leaves; the
   redaction list says `amount`, `clearance`, `omitted`. A placeholder in the field keeps the
   shape, but it is a fake value in a typed field — money's value is a decimal string and a mask
   is not one — and a careless program adds masks up.
3. **Agents only, as the rule says.** `DSOR-CLS-02a` is written for agent principals, because an
   agent's answer crosses the model boundary; a human reads on a screen, and the role decides what
   a human may do. The agent gets the clearance `internal`; the two people are not filtered.
   Everyone by clearance was the alternative: uniform, asked for by no rule, and needing invented
   clearances for the humans.

The labels are the specification's own example (§4, `DSOR-ENT-01b`): `id` internal, vendor
internal, `amount` confidential, `status` internal; `uri` and `tenantId` internal, since they name
the row. The step's databases: `dsor_step14` on Neon and on the local server.

## 106 · What step 14's build found: the record of a read is a second record, and a grant that does not grow (2026-10-09)

> **Superseded in part by decision 109, the same day.** The row count moved out of `extensions`
> into the record's own `row_count` field, which the schema had all along. The rest of this entry
> stands.

Two things the build taught, neither of them a choice the learner had.

**The record of a read is a second record.** `DSOR-CLS-05` wants a read of confidential data
written down with its row count and the rows it returned. The decision record cannot carry that:
it is written before the handler runs (`DSOR-EXE-02`), so it cannot know what came back, and the
log is never amended (`DSOR-AUD-04a`), so it cannot be told afterwards. Step 13's critic measured
exactly this — the log of a page of a hundred reads the same as the log of one `invoice.get` — and
said step 14 would need a second record. It does: kind `classified_read`, after the decision, with
the addresses in `resources` and the row count under the tutorial's namespace in `extensions`,
both fields the audit schema already had. It is written after the filter and before the answer
leaves, and triggered by what leaves — the agent's read that leaves as `internal` is not written
down twice — and if it cannot be written, the rows do not leave, as the decision record's failure
already stops a command.

**A column-level grant does not grow with the table.** Migration 006's first version added the
two columns and stopped, and every INSERT into the log was refused — the program could not carry
out a single request. Step 09's `GRANT INSERT` names its columns one by one so that the
application can never write `recorded_at`; a new column is granted on purpose or not at all. The
migration says so in its own comment, and the real-server tests pin INSERT yes and UPDATE no for
the two columns.

Also recorded: a handler's answer and the door's answer are two types now, `HandlerAnswer` and
`OperationAnswer`, because a handler returns the whole row and only the door decides what leaves;
and three tenancy tests that told the two companies' INV-1008 apart by the amount, as the agent,
now tell them apart by the status, which the agent may see.

## 107 · A label describes a value it can see the whole of, and the one decision step 14 leaves open (2026-10-09)

The hostile review's critic — the sixth agent, which the month's spend limit had stopped and which
ran afterwards — found what the five reviewers had not, and three verifiers confirmed its top three
findings on a clean copy. Two of them changed the design, so they are decisions and not fixes.

**A value with parts inside is confidential, whatever its field is called.** `vendor` is
`internal`, and a reviewer handed the door a `vendor` whose value was an object with the amount
inside it: it left for the agent, labelled `internal`, with only `amount` in the list. A value with
its own `toJSON` did the same. The alternative was to write the limit down and make it a rule for
handlers, which is what the first fix did — a comment saying a handler must not nest. That is a
rule nothing enforces, and `DSOR-CLS-01` already says what to do with a value nobody labelled: a
value the label cannot see the whole of is confidential. Three lines in `filterRow`, and the amount
does not move, because it is confidential already.

**An answer this program cannot filter is an envelope, not an exception.** A handler that returns
no row, or a row that is not a row, made the door throw a raw `TypeError` — after the decision was
recorded, and for a command after the side effect, with nothing a caller can read. The door refuses
it as `INTERNAL_ERROR` with retry `never` now, beside the ceiling's refusal, because the shape of
the answer is this program's business and not the caller's. The same pass found that a receipt whose
`data` is absent — legal in the schema, and what step 17's first `PENDING_APPROVAL` receipt will be
— was being filtered as if it had data: it leaves as it came, with no label and no list, because
there is nothing to label.

**And the one decision this step leaves open, on purpose.** Five different endings leave exactly
one `ALLOW` / `ALLOWED` record in the log and nothing else: an agent's answered read, a bad
`limit`, an answer over step 13's ceiling, a row with no address, and the evidence store failing.
A verifier reproduced all five. Only a read that handed out confidential data writes a second
record, so "ALLOWED and nothing after it" means either "the caller got internal data" or "the
caller got nothing and an error", and the log does not say which. The fix is another record, which
this step has just proved writable — the decision record cannot be amended, and that is why the
record of a read exists at all. It is not taken here because recording what happened after the
decision is a step's whole idea, not a corner of this one, and because it is the learner's
decision: a `classified_read` with a `REFUSED` result, a `refusal` kind of its own, or an outcome
record for every request. The README says plainly that the log cannot tell the five apart today.

Also from the critic, smaller: the citation for the labels was wrong — the entity schema with a
classification on every field is §6 of `01-model.md`, not §4, and the labels are modelled on it
rather than taken from it, since §6's invoice has `vendor_id` and `open_amount` while `uri` and
`tenantId` are the tutorial's. And the demo's withheld note measured 135 columns on one line, which
wraps away from its row on a default Windows console; it is a line of its own under the row now,
with the amount padded so the status lines up.

## 108 · The log's five endings: decided, and deliberately not built here (2026-10-09)

Decision 107 left one question open for the learner, and the learner asked for it to be taken.
Taken: step 14 does **not** add a record for a read that was refused after its decision. The
reasoning, because the answer matters less than why.

`DSOR-AUD-01` says what must leave a durable record: every command decision, every proposal
transition, and every read covered by `DSOR-CLS-05`. Step 14 writes all three of those that exist
today — the decision before the handler, and the record of a read that handed out confidential
data. Measured against the rule, nothing is missing. What is missing is *usefulness*: five endings
look alike in the log, because four of them are refusals that happen after the decision was
already written as an ALLOW.

Three reasons not to invent a fourth kind of record here.

1. **The specification already has the slot, and it is not an audit record.** What finally happened
   to a request is a proposal's final outcome (`DSOR-EXE-04a`, `DSOR-EXE-04b`, L2), and a proposal
   with states and transitions arrives with the control-plane store in step 16 and the outcome in
   step 36. A `classified_read` with `result: REFUSED` invented now would be a third shape that no
   rule names, and step 36 would supersede it.
2. **No record can cover all five.** One of the endings is the evidence store failing, and a store
   that cannot take the record of a read cannot take a record of the refusal either. A scheme that
   closes four of five and calls the log complete is worse than one that says plainly which
   question the log does not answer.
3. **One idea per step.** Recording what happened after the decision is a step's whole subject.
   Folding it into the step about classification would make two ideas and teach neither well.

What step 14 does instead: says it. The README has a paragraph of its own — "the one thing the log
still cannot tell you" — naming all five endings and where the answer arrives. A learner who reads
the log of a refused read and wonders why it says ALLOWED finds the answer in the step, not in a
surprise.

## 109 · The row count goes in the record's own `row_count`, not under `extensions` (2026-10-09)

**Decided by:** the learner, who took the recommendation after the problem was shown in plain
words, with the record of a read drawn both ways side by side.
**What:** the record of a read keeps how many rows it returned in `row_count`, the field
`audit-record.schema.json` has for it, beside `resources`. Until now the count was under
`extensions["com.panaversity.tutorial"].row_count`. Migration `007_read_row_count.sql` adds the
column, and grants `INSERT` on it column by column, as 006 does.
**Why:** decision 106 put the count under `extensions` because the build believed the schema had
no field for it, and a comment in `audit.ts` said so. The schema has one: `row_count`, a whole
number of at least 0. `extensions` is for the fields an implementation adds (`DSOR-SCH-02`). So a
checker that follows the specification looked in `row_count`, found nothing, and could not know
that the count was there under a name only this tutorial uses. Found by a read of the whole
repository on 2026-10-09.
**Cost:** a second migration in one step. 006 cannot be edited: it has been applied on Neon, and a
migration's checksum covers every byte, comments included (lesson 40). So 006's comment still says
the count goes under `extensions`, and 007's comment says why that is no longer true. The
`extensions` column stays, and step 14 writes nothing to it.
**Rejected:** keeping the count under `extensions` and correcting the two comments. No database
change, and a count that only this tutorial can find. Also rejected: rewriting 006 and making the
step's Neon database again. The step would read cleaner, and it needs a database deleted, which is
the learner's action to take.

**Red first.** The two tests that read the count failed on `expected undefined to be 1` and
`expected undefined to be 2`, and the typecheck refused `row_count` on `AuditRecord`. The tests
changed and did not grow: `pnpm check` 504, and `pnpm test:db` 39 on Neon with 007 applied.

**Proved by breaking it**, in a copy outside the repository, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| no `rowCount` written | 3: the two count tests and the demo's `READ, 1 row` | 3, those three |
| `theLog` does not read `row_count` back | about a dozen | 7: those three, and four tests that verify a chain holding a person's read, because the count is inside the hash |
| 007 without its `GRANT` | dozens: only the reads | 185 |

The third prediction was wrong, and the reason is the lesson of 006 again. Every `INSERT` into the
log names `row_count`, and sends a NULL when a record has no count. PostgreSQL asks for the column
privilege for every column a statement names, whatever the value. So without the grant every
write to the log was refused, decisions included, as in Break 12. Run twice, 185 both times, and
the README's Break 12 now says so.

**The README's fifteen breaks, measured again.** All fifteen give the README's counts. The first
pass did not. It slowed down from break 8 on — seven results in twenty-five minutes, where a run
takes one — and five runs came back with numbers the README does not have, break 11 with 32 tests
skipped where the README has 1. A skipped test there means a test file's setup ran out of time, so
those runs measured the machine and not the code (lesson 11: the total and the skips are the
tell). Run again one at a time on a quiet machine, the five gave 17, 2, 2, 185 and 65, the
README's numbers.

## 110 · Money keeps its field's label only in a field declared to hold money (2026-10-10)

**Decided by:** the learner, who took the recommendation after the gap was shown in plain words,
with the agent's answer drawn both ways.
**What:** a money value, `{ value, currency }`, is one value, described whole by its field's label,
only in a field the table declares as money: today `invoice.amount`. Anywhere else it is a value
with parts inside, and so at least confidential (decision 107): withheld from this step's agent,
which is cleared for `internal`, and listed.
`classification.ts` keeps the list beside the labels, and `holdsMoney` asks it.
**Why:** decision 107's exception was given by the value's shape, not by its field. Measured on
2026-10-09: a handler that returned `vendor: { value: "31400.00", currency: "USD" }` sent the amount
to the agent, labelled `internal`, with nothing in the list of what was withheld. The
specification's entity schema gives every field a type as well as a label (§6, `DSOR-ENT-01b`):
`amount: { type: money, classification: confidential }`. A field's declared type decides, not a
value's shape.
**Cost:** a second list beside the labels, and the two must agree. When they disagree, the stricter
answer wins: money in a field not on the list is at least confidential. One new test, and the
README's fifteen breaks measured again, after decision 111 (below it). Break 13 was measured first,
and it had been measuring another guard: `isPlain` was also the door's "is this a row?" check, so
all 65 of its failures were the door refusing every answer as not a row, the three tests about the
label among them. The two jobs are two functions now, and Break 13 measures the label alone.
**Rejected:** saying it plainly in the README and leaving the code. Cheap, and a handler's mistake
stays a leak. An amount written as text in `vendor` still leaves either way, because a label
describes a field and not the value in it (open question 50).

**Red first.** The new boundary test failed with the amount in the agent's answer, and the
declaration's lines with `holdsMoney is not a function`. Then `pnpm check`: 505 passed.

**Proved by breaking it**, in a copy, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| `holdsMoney` says yes for every field: money judged by its shape again | 2: the new test and the declaration's `vendor` line | 2, those two |
| `holdsMoney` says no for every field | 1: the declaration's `amount` line | 1, that line |

The second break is visible only to the declaration. In the story the amount is confidential either
way, so the answers the agent and the supervisor get are the same with or without it, and the
declaration's test is the one place that can say the list is wrong.

## 111 · A field's label is looked up among the table's own names (2026-10-10)

**Decided by:** the learner, who chose to fix it now, in a commit of its own, after the bug was
shown with a run.
**What:** `labelOf` answers from the label table's own keys only, for the entity and for the
field, as `permissionsOf` has since decision 36. A name the table only inherits has no label, so
it is confidential.
**Why:** found while building decision 110, and measured. `labelOf("invoice", "toString")` returned
a function, and `labelOf("constructor", "name")` returned `"Object"`. Neither is one of the four
labels, so neither was ever above a clearance: a row with fields named `toString` and `valueOf`
sent both to the agent with `31400.00 USD` in them, while `notes` beside them was withheld. A
field with no declared classification is confidential (`DSOR-CLS-01`), and these two had none.
It is decision 36's bug in a file written after it — lesson 13 again: a fix belongs everywhere its
shape lives.
**Cost:** one test, and a lookup that reads as a guard rather than one line. Only the program's own
handlers could name such a field; the agent cannot.
**Rejected:** recording it for a later session. The fix is a few lines, and until it lands a
handler's mistake sends that field to the agent.

**Red first.** `expected [Function toString] to be 'confidential'`, and the amount in the agent's
answer. Then `pnpm check`: 506 passed.

**Proved by breaking it.** The lookup is two guards, one for the entity and one for the field, and
each was removed alone, as lesson 18 asks: what does this guard catch that no other does?

| Break | Predicted | Measured |
| --- | --- | --- |
| no own-name check for the entity | 1: the `constructor` line of the unit test | 1, that line |
| no own-name check for the field | 2: the `toString` line and the boundary test | 2, those two |

**The README's fifteen breaks, measured again after both decisions.** Twice, one at a time on a
quiet machine, and the two runs agreed on all fifteen. The suite is two tests longer, so every
total moved by two. The failing counts that moved:

- Breaks 1, 2, 3 and 5 fail two more, because both new tests read as the agent. Break 7 fails one
  more, and Break 12 two more: 187.
- Break 4 fails five, as before, but not the same five. The inherited-name test joined. The test
  that refuses a confidential row with no address left: that row's amount is now money outside a
  money field, so it stays confidential even with the default broken, and the read is still
  refused. Measured on a copy of the code from before decision 110, with the same break.
- Break 13 fails four where it failed sixty-five: the nested value, the value with its own
  `toJSON`, the nearly-money value, and money in `vendor`. The README had explained the sixty-five
  another way, as an amount read as its own label, "Break 6 in reverse". That explanation was
  wrong.
- Break 11 had always failed two tests, both with a connection that drops the record's INSERT,
  while the README said one. It says two now.

Decision 109's three breaks, twice more: no count written fails 3, the read-back without
`row_count` 7, and 007 without its `GRANT` 187, the same in both runs. The README's Break 12 says
187 now.

**The hostile review of 110 and 111.** One reviewer, read-only, with probes in its own copy and no
test runs while the breaks were being measured. It found no new way past the filter through a row.
Money in `vendor`, fields named `toString`, `constructor` or `__proto__`, rows built with
`Object.create`, hidden and symbol keys, a getter that changes its value, and arrays all held. The
split changed nothing the door accepts: 96 answer shapes through the old and the new row check, and
no difference. What it did find:

1. **Two parts of an answer the filter never looks at:** `askedBy`, and a page's `next` while the
   rows' addresses are shown. A handler that put a row in either sent the amount to the agent, with
   `amount` listed as withheld beside it. This is a gap from the step's first build, not from these
   two decisions. Decision 112: fix it now.
2. **Two guards no test pins.** With today's table, the money exception changes no answer, because
   the one money field is confidential either way. Deleting it fails nothing, and quietly undoes
   what decision 107 measured. And no test hands the door money where a row should be, so its row
   check could forget money and stay green. Decision 113: a test for each.
3. **Two checks that fail open, both unreachable today.** `isMoney` trusts a value's own visible
   keys, so a hidden `toJSON` passes. That matters only for an agent cleared for `confidential`.
   And a word that is not one of the four labels ranks below `public`. Decision 111 removed the
   place such a word came from. Decision 114: write them down, and do not fix them.
4. **Sentences that said more than was measured.** These are corrected:
   - All 65 of Break 13's old failures were the door, not 62. The three label tests went through
     the door too, and were refused before any label was worked out.
   - Money outside a money field is *at least* confidential. In `bank_account` it is restricted.
   - Decision 111's fix is a few lines, not one.
   - The README said the door applies the default "to whatever a handler returns". `askedBy` and
     `next` make that untrue.
   - The README's limits did not say that an amount written as text still leaves (open question
     50).

One consequence of decision 110 that the review found and nothing had recorded: a person's read
of a row with money in `vendor` is labelled `confidential` now. So it writes a record of a
classified read, which it did not before. That is `DSOR-CLS-05` doing its job.

## 112 · The door writes who asked, and a page's cursor must be its last row's address (2026-10-10)

**Decided by:** the learner, who took the recommendation after the finding was shown with a run:
a page whose `next` held the whole last row left for the agent with `31400.00` in it, labelled
`internal`, with `amount` listed as withheld beside it.
**What:** the two parts of an answer that the filter never looked at.

- `askedBy` is written by the door, from the principal the pipeline checked, for every kind of
  answer. What a handler puts there is not read.
- A page's `next` must be the address of the page's own last row, which is what step 13 made the
  cursor, or absent. Anything else is refused before the filter, as the program's own error with
  retry `never`, like a page with no rows in it.

**Why:** the door filtered every field of every row, and copied `askedBy` and `next` as the handler
gave them. A handler that put a row in either, behind a cast, sent the amount to the agent, and the
list beside it said the amount had been withheld. It is decision 107's mistake, the amount inside
`vendor`, in two places the filter never looked. Found by the review of decisions 110 and 111. It
dates from the step's first build.
**Cost:** a handler still writes `askedBy`, because `HandlerAnswer` has the field, and the door
ignores it. And the check ties the cursor to step 13's design: a later cursor that is not the last
row's address must change this check too, on purpose.
**Rejected:** writing it down as a limit, the learner's other option. Also rejected: accepting any
`next` that is a well-formed address. That stops a row, but a handler could still write text into
an address, and the agent would read it. The last row's address is the one value `next` can
honestly hold, and the agent sees that address in the row already.

**Red first.** Through the real door, with a handler that put the row in `askedBy`, the data, page
and error answers all carried `31400.00` in `askedBy`. A page whose `next` held the last row left
for the agent with `31400.00` in it, labelled `internal`, with `amount` listed as withheld.
Another invoice's address, and the text `31400.00 USD`, left as well. Then the whole suite, on a
copy: 508, all green but the one test that skips outside the repository.

**Proved by breaking it**, in a copy, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| each of the five ways out copies the handler's `askedBy`, one at a time | 1 each: the new test | 1 each, that test |
| no cursor check | 1: the new test | 1, that test |
| any text accepted as a cursor | 1: the new test | 1, that test |
| the cursor compared with the first row, not the last | the new test, and the tests that page through real invoices | 9: the new test and eight in `bounded-queries.test.ts` |

The cursor test's first version had a page of one row, where the first row is also the last, so
the fourth break would have passed it. It has two rows now.

**Found while building it.** An error answer, and a receipt with no data, were handed back as the
handler built them, so anything a handler added beside the envelope left too. Building every answer
from its known parts stops that. Something added *inside* an error envelope still leaves: the
error schema is closed except `items` and `extensions`, which take anything. Measured: an error
with the row beside its envelope, and one with the row inside it, both left for the agent with
`31400.00`. That is a decision of its own: decision 115.

**The review then found it incomplete.** The cursor was checked on one read and copied on
another, and a receipt's envelope was still copied whole. So "every answer is built from its
known parts" was true of the answer and not of the envelope inside it. Decisions 116 and 117.

## 113 · Two guards get a test of their own (2026-10-10)

**Decided by:** the learner, who took the recommendation.
**What:**

- The money rule becomes a function of its own, `labelOfValue` in `boundary.ts`. It takes the
  field's declared label, the value, and whether the field is declared to hold money. Its test
  gives it a field labelled `internal`, which the story's table does not have, so the rule's
  effect can be seen.
- The door's test for "no row at all" hands it money where a row should be.

**Why:** with today's table, the money rule changed no answer. The one money field, `amount`, is
confidential, and without the rule it would be raised to confidential anyway. So deleting the rule
failed nothing, and it quietly undid what decision 107 measured: the table's label for a money
field would stop mattering. And the door's row check could forget money and stay green, because no
test handed the door money as a row.
**Cost:** one function exported so a test can call it, as `makeDoor` is exported so a test can
build a door.
**Rejected:** writing the two gaps down only.

**Red first.** `labelOfValue is not a function`. Then the whole suite, on a copy: 509, all green
but the one test that skips outside the repository. The second gap needed no new test: one test's
list grew.

**Proved by breaking it**, in a copy, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| the money rule deleted, on the code before this decision | 0, as the review said | 0 |
| the money rule deleted | 1: the new test | 1, that test |
| money judged by its shape, in any field | 2: the new test and decision 110's boundary test | 2, those two |
| a value the label cannot see whole keeps its field's label | 5: the new test and the four tests of a value with parts | 5, those five |
| the row check forgets money, on the code before this decision | 0, as the review said | 0 |
| the row check forgets money, with money added for the supervisor | 1: the extended test | 0 |
| the row check forgets money, asked as the agent too | 1: the extended test | 1: the agent's money case |

The sixth prediction was wrong, and lesson 18 is why. For the supervisor, a second guard catches
money taken for a row: the record of the read cannot name a row with no address, so the read is
refused anyway. For the agent, both parts are withheld, nothing confidential is left to write
down, and the row check is the only guard. So the test asks as the agent too.

## 114 · Two checks that fail open are written down, and not fixed (2026-10-10)

**Decided by:** the learner, who took the recommendation.
**What:** two checks would let data through, in cases nothing in this step can reach. They stay as
they are, and are written down here and in the README's limits.

1. `isMoney` trusts a value's own visible keys. A money-shaped value with a hidden `toJSON` passes
   as money, and the answer then carries whatever `toJSON` returns. It matters only in a money field
   the agent may read, and the one money field, `amount`, is above this agent's clearance.
2. `rankOf` ranks a word that is not one of the four labels below `public`, so such a word is never
   above a clearance. Decision 111 removed the place one came from.

**Why:** neither can happen in this step, and each fix is code and tests in a step that is already
long.
**Cost:** a later step must come back here. The specification's own example clears this agent for
`confidential` and holds the amount back with an egress policy; the step that builds that policy
raises the clearance, and the first check matters from then on. A fifth label would make the
second matter.
**Rejected:** fixing both now: a fresh money value built from its two strings at the door, and an
unknown word ranked above every label.

## 115 · An error's envelope stays unread, and the rule for handlers names its open parts (2026-10-10)

**Decided by:** the learner, who took the recommendation.
**What:** the door passes an error answer's envelope on as the handler built it, as before. The
README's rule for handlers, never to put a field's value in an error, now names the two parts of
the error schema that take anything, `items` and `extensions`, beside the message, which is free
text.
**Why:** found while building decision 112, and measured against the door. A row under `items`,
under `extensions`, or under `data`, a field the error schema does not have, left for the agent
with `31400.00`. Closing the two open parts would not retire the rule, because the message can
carry the amount anyway. And nothing in this program fills either part today. A later step that
answers with one error per failed item may need `items`, and then its rows need the filter.
**Cost:** a mistake in a handler can still send a row to the agent inside an error, as it can
through the message.
**Rejected:** the door rebuilding every error from the parts this program uses and dropping the
open two, the learner's other option. Not offered, and noted here: checking an error's envelope
against its schema, as the door checks a receipt. It would stop `data`, and let `items` and
`extensions` through, so the rule for handlers would stay the same.

**Then the hostile review of 112 and 113.** One reviewer, read-only, with probes in its own copy.
`askedBy` held on all five ways out, and nothing else in the door builds an answer from a
handler's parts. It found two ways round what decision 112 claimed, and both were reproduced
here:

- The cursor was checked on one read and copied on another. A getter on `next`, or a rows list
  with its own `at`, passed the check and then handed the filter the whole row.
- A receipt's envelope was copied whole. Its schema lets `requires` and `extensions` hold
  anything, and a receipt with no data was not checked at all. Five shapes left with `31400.00`.

It also found that the record of a read takes the rows from the handler a second time, and three
guards with no test. Decisions 116 to 118.

## 116 · The door copies a handler's answer once, and works only from the copy (2026-10-10)

**Decided by:** the learner, who took the recommendation after the review's probe was shown: a
page whose `next` was a getter answered the check with the last row's address, and the filter
with the row.
**What:** as soon as a handler's answer reaches the door, `copyOnce` reads it once into plain,
frozen objects: the answer's parts, a page's rows and cursor, each row's fields, and a receipt's or
an error's envelope. The check, the filter, the ceiling and the record of the read all work from
that copy. A field's value with parts inside is copied as it is: the copy goes as deep as the door
decides, which is one level into each row. "Plain" holds for an answer that is data. Code written
to trick the copy gets past it, as the next review showed (decision 119).
**Why:** the door read the handler's answer more than once and trusted the reads to agree. The
record of a read took the rows from the handler a second time, so it could name rows other than
the ones returned. The program already keeps this rule for a request's arguments: `payloadHash`
takes text written down once, because two reads can disagree.
**Cost:** a new function at the door, which every answer goes through. A field's value with parts
is still read more than once, by the money check and when the answer is written out; that is
decision 114's first check.
**Rejected:** fixing the cursor alone, by taking it from the door's own filtered rows. Smaller,
and the record of a read would still read the rows twice.

**Red first.** A `next` that answered the check with the last row's address and the filter with
the row got the row out, labelled `internal`. A page whose rows answered differently on a second
read was handed to the supervisor as INV-1008 and written down as INV-1009: what the review had
found by reading, measured. A third case, a row whose address names the entity on one read and
carries the amount on the next, was shown red by the fourth break below. Then the whole suite, on
a copy: 510, all green but the one test that skips outside the repository.

**Proved by breaking it**, in a copy, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| `copyOnce` hands the answer back as it came | 2: the two new tests | 2, those two |
| the door does not use the copy | 2: the same two | 2, those two |
| a page's rows list is not copied | 1: the read-once test, the list with its own `at` | 1, that test |
| a row's fields are not copied | 1: the read-once test, the address read twice | 1, that test |
| the cursor is read again on every look | 1: the read-once test, the getter | 1, that test |

## 117 · A receipt is built from its named parts, and every receipt is checked against its form (2026-10-10)

**Decided by:** the learner, who took the recommendation.
**What:** the door builds a command's receipt from the parts its schema closes: `outcome`,
`proposal`, `payload_hash`, `decision`, `semantics`, `expires_at` and `correlation`, and its own
`data`, label and list. It checks every receipt against `result-envelope.schema.json`, with data
or without. `requires` and `extensions`, which the schema lets hold anything, are left out.
**Why:** the door copied a receipt's envelope whole, and passed a receipt with no data on
unchecked. A row under `requires` or `extensions` left for the agent beside a filtered `data`,
with `amount` listed as withheld. A receipt with no data carried even a field the schema does not
have. Unlike an error, a receipt has no part that takes anything, so naming its parts closes the
way a row got out. Its free text is in `correlation`'s string fields, which is open question 50's
channel. This sentence first said a receipt has no free-text part, which was false (decision 119).
**Cost:** a later step that needs `requires` — step 17's receipts that wait for an approval — must
add it back through the filter. And a receipt with a field the schema does not have no longer
makes the door throw: the field is left out. The test that relied on the throw checks an invalid
named part now.
**Rejected:** writing it down, as decision 115 did for errors.

**Red first.** A row under `requires` left for the agent beside a filtered `data`. A receipt with
no row and a wrong `outcome` was not checked at all. Then the whole suite, on a copy: 511, all
green but the one test that skips outside the repository.

**Proved by breaking it**, in a copy, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| the receipt copied whole again | 1: the closed-parts test | 1, that test |
| a receipt with no data not checked | 1: the validation test, its no-data case | 1, that test |
| `requires` counted among the closed parts | 1: the closed-parts test | 1, that test |
| `extensions` counted among the closed parts | 1: the closed-parts test | 1, that test |
| a receipt's data filtered when it has none | 4: every test that hands the door a receipt with no data | 4, those four |

## 118 · Three more guards get a test (2026-10-10)

**Decided by:** the learner, who took the recommendation.
**What:** three cases, in tests that exist. A cursor that is an object which turns into the last
row's address when compared loosely. A cursor on an empty page. And a page whose rows are not
rows, asked as the supervisor and as the agent.
**Why:** the review of 112 and 113 found each guard removable with no test failing. Loosening `===`
to `==` would let the object out with the amount in it. Dropping the `?.` would make the empty page
a raw `TypeError`. And the page half of the row check, from the step's first build, had no test at
all: without it, the agent gets `[{}]` labelled `public`.
**Cost:** a few lines.
**Rejected:** writing them down only.
**Not testable today:** that the door hands `holdsMoney`'s answer to the money rule. With the table
as it is, `amount` is confidential either way, so a door that always said "not a money field" gives
the same answers. `labelOfValue`'s own test pins the rule (decision 113), and nothing outside the
door can see the call.

**Red first, by breaking.** These guards already worked, so the new cases passed at once. Each
guard was then removed alone, before the new cases and after them, with the prediction written
first: 0 before, as the review said, and 1 after.

| Break | Before the new cases | After |
| --- | --- | --- |
| the cursor compared with `==` | 0 | 1: the cursor test |
| the cursor check assuming a last row | 0 | 1: the cursor test |
| no row check for a page | 0 | 1: the test for an answer that is not a row |

**The README's fifteen breaks, measured again after decision 118.** Twice, one at a time on a
quiet machine, and the two runs agreed on all fifteen. The suite is six tests longer than after
decision 111, so every total moved by six. The failing counts that moved: Break 1 by three, Break
5 by one, Break 6 by four, Break 7 by one, Break 8 by one, Break 9 by one, Break 12 by four, Break
13 by one, Break 14 by two, and Break 15 by three. Break 15 had to change: the early return it
deleted is gone (decision 117), so it makes the `if` around the receipt's filter always true, and
teaches the same thing. Decision 109's 007 without its `GRANT` gave 191, twice. A first
measurement after decision 113 was stopped halfway, when the review of 112 and 113 meant the code
would change.

## 119 · The door is built against a careless handler, not one written to trick it (2026-10-10)

**Decided by:** the learner, who took the recommendation after the third review's findings were
shown, each reproduced here with the review's own probes.
**What:** the hunt stops here. The door is built against a handler that makes a mistake: a row put
in the wrong place, a part left over, an object where a value belongs. It is not built against a
handler written to trick it. The third review, of decisions 116 to 118, found four more ways past
the door, and each needs code like that:

1. A rows list whose class overrides its own methods and constructor. The copy is built with the
   handler's class, and its `at` answers the cursor check. The agent got the whole row.
2. An answer whose `kind` answers one way five times and another way the sixth, with no envelope.
   `copyOnce` hands back the handler's own object, and the later steps read `kind` again. The
   agent got the whole row.
3. A receipt whose `correlation` has a hidden `toJSON`, or is a Proxy. The schema check passes,
   and writing the answer out calls the hidden function. The agent got the whole row.
4. A function dressed as a row. It is not copied, and its address is read twice. The agent got
   `31400.00 USD` as an address. For the supervisor, the record of the read named INV-1009 while
   INV-1008 was returned.

They are written down, and not fixed.
**Why:** code written to trick the door does not need any of these. It can write the amount as
text into a field an agent may read, `vendor: "31400.00 USD"`, and no copy or filter at the door
can see that (open question 50). So closing these four would not change what the door can
honestly promise. And a handler is this program's own code: code written to leak can leak through
a log or a network call without passing the door at all. What stops it is reading the code, not a
filter.
**How the reviews got here.** The reviews of decisions 110 to 118 were each told to assume the
handler is trying to get the amount out. That is a stronger threat than this step is about, and it
is why each round found more. The fixes it led to still hold for careless code: 112, 113, 117 and
118. Decision 116 still makes the record of a read name the rows that were returned, for any
answer that is data.
**Also from that review, written down and not fixed:**

- A receipt that waits for an approval cannot leave yet. The schema requires `requires` for
  `PENDING_APPROVAL`, and the door leaves `requires` out (decision 117). Measured: such a receipt,
  valid as built, makes the door throw. Step 17 must bring `requires` back through the filter.
  Two comments said such a receipt leaves; they say what is true now.
- `copyOnce` reads a page's rows and cursor before the check. So three shapes the door used to
  refuse cleanly now throw a raw error: a rows list holding a throwing getter, a throwing cursor
  beside rows that are not a list, and a rows list with a throwing `constructor`. And a sparse
  rows list of four million slots takes the copy 22 ms, so about 24 s at the largest length an
  array can have. Each needs code written to trick or to break the door.
- Two test cases, the list with its own `at` and the cursor on an empty page, check that the answer
  is an error, but not its code and retry class. And no test hands the door a receipt or an error
  whose parts answer differently on a second read.
- Decision 116's "plain, frozen objects" and decision 117's "a receipt has no free-text part" said
  more than the code does. Both are corrected where they stand.

**Rejected:** one more round, with the platform's own deep copy, `structuredClone`, which turns an
answer into plain data and refuses what is not data. It closes the four with less code. It also
makes a value with its own `toJSON` refuse the whole answer, and it still lets text through. It
would have taken about an hour and a half more.

## 120 · Step 15's four decisions, taken by the learner before any code (2026-10-10)

The problem was shown first, on step 14's running demo, run on the local database so step 14's
Neon database was not touched. The agent's answer for INV-1008 is the whole of it: `issued`, with
no time and no source. The story: at 09:00 the agent reads INV-1008, `issued`, and writes that into
its memory; at 09:30 user_123 pays it; at 10:00 the agent plans the day's payments from its memory,
and nothing tells it, or a person checking its work, that its copy is an hour old. And from the
inside: a later step adds a cache, and a saved "unpaid" that called itself fresh would let a check
pass that should stop a second payment. The rules are §27's `DSOR-FRS-01a` and `DSOR-FRS-01b`. §27
has no "Why it matters" of its own, so the story is the step's. Four questions, one at a time, in
plain words; the learner took all four recommendations.

1. **`current`, lowercase, as the schemas write it.** The specification writes the mode two ways:
   `CURRENT` in §27's prose and in `decision-bundle.schema.json`, `current` in the common, contract
   and connector schemas (open question 51). Our own `invoice.issue.json` already says
   `"freshness": "current"`, so an answer's delivered mode and a contract's required mode can be
   compared exactly. The cost: a reader meets both spellings, and the README says which and why.
2. **The code that reads the database writes the label, and the door insists on one.**
   `getInvoice` and `listInvoices` hand back the rows with their label, taken right after the read.
   The handler passes it on, and the door refuses an answer with no label as the program's own
   error, like a row with no address. Rejected: the door writing it for every answer. The door
   does not know where the data came from, so it would call everything current, a saved copy
   included, which is the lie the rule forbids.
3. **An old value labelled `current` is refused.** §27 defines `current` as read from the system of
   record within this request, so the door compares the label's `observed_at` with the moment the
   request began, both on the program's own clock. Earlier means a saved copy calling itself fresh:
   the program's own error, never to retry. Rejected: relabelling it `observational` and letting it
   leave. The data would arrive honestly labelled, and the bug that mislabelled it would stay
   hidden.
4. **No row version until step 21.** `DSOR-FRS-01a` asks for `resource_version` where one exists,
   and no invoice has one: nothing counts a row's changes until step 21, optimistic concurrency.
   Rejected: adding a version column now, which is step 21's whole idea in this step, with a
   migration, and a version step 21 would then build on without designing.

The connector is named for what is read, the PostgreSQL database that holds the invoices. The
step's database tier will need its own database, `dsor_step15`; the copied `.env` still names
step 14's, and changing it is the learner's.

## 121 · What step 15's review found, and what the learner chose (2026-10-10)

**Decided by:** the learner, who took all three recommendations after the findings were shown in
plain words.
**The review.** One reviewer, read-only, with probes in its own copy, told this time to assume a
careless handler, as decision 119 says. It found no way for a careless handler to get data past
the door, and no wrong label on any of the program's own reads. It found:

1. **A query answered with a receipt leaves unlabelled.** The door insisted on a label only when an
   answer was a single invoice or a page. A query's code that copied `invoice.issue` and answered
   with a receipt would leave with no time, no mode and no connector, and its read would not be
   written down either. **Chosen: fix it.** The door knows which operations are queries, and
   refuses a query that answers with a receipt, as the program's own error.
2. **The label's time.** It was taken just after the database replied, a round trip after the
   data was read, so a label claimed a little more freshness than was true. And the door accepted
   any text JavaScript reads as a date, `"2026"` among them, and a time in the future. **Chosen:
   tighten it.** The time is taken just before the query, so the data is at least as fresh as the
   label says. This changes decision 120's "right after the read" to "right before". And the door
   accepts only an exact ISO time, like `2026-10-10T21:30:05.123Z`, not in the future.
3. **Small gaps.** No test of its own for a label with no connector at all, a time that is a date
   object, the page path of a label with something riding along, or the exact moment the request
   began. And `leaveTheDoor`, called directly, let a label through whole. **Chosen: add the four
   cases, and keep only a label's three parts there too.**

Written down, and not fixed:

- **The door checks when a label was stamped, not whether the stamper read the database.** A
  cache behind the store, or code that saved rows and labelled them again on the next request,
  would label saved rows `current`, and the door would let them out: the label is as true as the
  code that writes it. So the README's "the first cache a later step adds cannot pass its saved
  values off as fresh" said more than the code does, and so did the subject of the piece-3 commit.
  The README now says what the door does: it refuses a `current` label stamped before the request
  began. The step that adds a cache must label that cache's answers itself.
- **A clock moved backwards.** An honest read can then look older than the request, and the door
  refuses it with retry `never`, though a second try would succeed. Rare, and stated in the README.
- **Sentences now false**, corrected: `getInvoice`'s comment said it returns `undefined`;
  `HandlerAnswer`'s said "labelled by nobody yet"; `docs/status.md` said "Steps 01 to 10" beside
  `my_01` to `my_15`.

**Red first.** `invoice.get` answering with a `success()` receipt left as a `result`. Then four
more failed: a time that is only a year, a time in the future, a label with a row riding along
through `leaveTheDoor`, and a label taken after a reply 50 ms late. The year was first refused
anyway, by the old-`current` check, so it tested nothing of its own until it was labelled
`observational`: lesson 18, measured. Then the whole suite: 531.

**Proved by breaking it**, in a copy, each guard alone, with each prediction written first:

| Break | Predicted | Measured |
| --- | --- | --- |
| a query may answer with a receipt | 1: the receipt test | 1, that test |
| the label stamped after the reply | 1: the time taken before the query | 1, that test |
| any text JavaScript reads as a date | 1: the year | 1, that test |
| a time in the future accepted | 1: the future | 1, that test |
| `leaveTheDoor` lets a single invoice's label through whole | 1: the three-parts test | 1, that test |
| a second of slack before the request began | 1: the line to the millisecond | 1, that test |
| a label with no connector key accepted | 1: no connector at all | 1, that test |

A label's parts were first trimmed in two places, `copyOnce` and `leaveTheDoor`, so removing either
alone would have failed nothing. The trimming lives in `leaveTheDoor` only, and `copyOnce` copies
the label once, like a row. A date object is refused by the exact-time check: it is not the text
`toISOString` writes.

**The README's ten breaks**, measured twice on the final code, one at a time, and the two runs
agreed on all ten: 4, 19, 12, 1, 1, 2, 1, 1, 1 and 1. A first measurement, on the code before this
decision, was stopped halfway when the review meant the code would change. Two counts are larger
than the piece that built them had measured. Dropping a single invoice's label fails 19, because
the demo, from piece 4 on, prints every read's label and crashes on the first one without it. And
a fresh read labelled `observational` fails 4, because one stand-in counts on `readNow` saying
`current`. The guard then caught a comment that said "copied from a command": it reads any
"copied from" as a marker for a pattern copied from a schema. The comment is reworded, folded into
the commit that wrote it, and the guard ran after each commit that followed.

## 122 · Step 16's three decisions, taken by the learner before any code (2026-10-10)

The problem was shown first, on step 15 as copied. `DSOR-MOD-01` asks DSoR to own its paperwork,
durably, in a store of its own, and two things in step 15 fall short. DSoR's only paperwork in the
database, the log, is `public.audit`, filed beside the business's `public.invoices` in the schema
the business's own tools treat as theirs: an accounting upgrade that resets its tables, or a
cleanup that empties `public`, takes the evidence with it. And what DSoR keeps only in memory is
forgotten at every restart: run twice, the program named Monday's receipt and Tuesday's receipt
both `dsor://org_456/proposal/prop_0001`, two actions with one address. The map's answer is a
second schema, `dsor`, in the same database, so that in step 36 a business change and DSoR's
record of it can be saved together. Three questions, one at a time, in plain words; the learner
took all three recommendations.

1. **The log only moves now.** It is the only paperwork in the database today. Every other kind,
   permission slips, approvals, counters and locks, arrives in `dsor` with the step that builds it.
   Rejected: a proposal counter in `dsor` as well, so that a restart never reuses a number. It is a
   second piece in this step, and building a receipt would become a database call in every
   command. So proposal numbers keep restarting at `prop_0001` until step 22, and the comment in
   `envelopes.ts` that promised them for step 16 is corrected.
2. **The table moves as it is.** One new migration moves `public.audit` into `dsor`: every record,
   the hash chain, the grants and the row-level security go with it, and nothing is copied. A
   record's hash covers its own fields and not the table's name (`hashOf` in `audit.ts`), so the
   move cannot break the chain. Migrations 001 to 007 still say `public.audit`, because an applied
   migration is never edited. Rejected: a new, empty log in `dsor` beside the old one, which would
   leave two logs, the chain broken in two, and the old evidence still among the business's
   tables.
3. **The two-logs gap stays, and its comment is corrected.** A refusal written into both companies'
   logs, before DSoR knows which company a request is for, is two writes, not one: if the second
   fails after the first, one log holds it and the other does not. The program already tells the
   caller exactly which logs got the record. Making both writes one transaction needs one
   connection held across them, which the database layer does not offer. Rejected: building that
   transaction now, a second idea in this step. The comment in `operations.ts` that said "step
   16's" now says it waits for the step that builds transactions, which the map first needs in
   step 36.

The step's database is `dsor_step16` on Neon, made through the owner login in the copied `.env`;
changing the database name in that file is the learner's.

