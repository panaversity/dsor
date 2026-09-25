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
