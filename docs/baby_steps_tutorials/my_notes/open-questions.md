# Open questions

Things found by reading ahead that need settling before the step they affect. Not
decisions yet — a decision goes in [decisions.md](decisions.md) once it is taken.

---

## 1 · Step 08 cannot claim `DSOR-AUD-01` as the map describes it (found 2026-09-25)

**Affects:** step 08, `08_write_the_decision_first`. Settle before planning it.

The map lists `DSOR-EXE-02` and `DSOR-AUD-01` for that step, and describes the log as "an
in-memory list for now".

`DSOR-AUD-01` requires every audit record to validate against `audit-record.schema.json`.
That schema's `required` list holds `chain`, `sequence`, `previous_hash` and `record_hash`,
and the last two match `^sha256:[A-Za-z0-9+/=_\-]+$`. So the §30 hash chain is baked into
the schema §29 points at — and the map does not schedule a hash chain until **step 39**
(`39_a_log_nobody_can_quietly_edit`, `DSOR-AUD-04b`).

A plain list of objects will not validate. Because the steps compile their schemas with
ajv from step 03 onward, this surfaces as a red test rather than a quiet overclaim, which
is the good outcome — but it has to be decided, not discovered.

Three honest options:

1. Claim `DSOR-EXE-02` only, and record that `DSOR-AUD-01` waits for step 39, naming the
   four fields. Matches how step 04 handled its own unclaimed ids, which is the precedent
   with the best record here.
2. Compute `sequence`, `previous_hash` and `record_hash` in step 08. Cheap — `createHash`
   is already imported in step 04's `envelopes.ts` — but arguably a second new idea.
3. Split the chain into a step of its own.

## 2 · §12's interface and `security-context.schema.json` disagree (found 2026-09-25)

**Affects:** step 05, `05_who_is_calling`. Settle while planning it.

§12 gives a `RequestSecurityContext` in camelCase, with a nested `EnterprisePrincipal`
carrying `memberships`. The wire schema is snake_case, flattens the principal to a plain
`subject` string plus a `subject_type` enum, and has **no** `memberships` field at all.

This is the same species of finding as step 04's missing query-result outcome, so there is
a house precedent: keep both, validate the wire artifact, and say in the README which one
is the interface and which is internal. Discovering it at step 43 with a real identity
provider attached would cost much more.

**Closed 2026-09-28: the document is built at step 42.** See
[decision 32](decisions.md). Step 05 stands as built and step 06 is not asked to carry it
either.

The question assumed the answer was "05 or 06". It was neither. Searching the map for
`security-context`, `identity_mode`, `actor_chain` and `subject_type` returns **nothing**
across all 52 steps, and `DSOR-SCH-01` is named at exactly one step — 04. **No step owns
this document.** The gap is in the map, not in step 05, which matched what the map asked of
it.

Step 42, `42_a_rest_api`, is the right home because it is the first step where a caller is
genuinely outside the program. `DSOR-SCH-01` requires validation *"wherever it crosses an
interface"*, and until there is an HTTP server the login crosses nothing. Step 05's
`Principal` is also not an invention: it matches §12's own interface. The wire schema is a
second artifact for the same idea at a boundary, which is what this question proposed keeping
all along.

## 3 · Step 05 cannot build the running example's normal case (found 2026-09-25)

**Affects:** step 05. Not a problem — a teaching opportunity, if it is used as one.

`security-context.schema.json` pins two conditionals: `identity_mode: "unattended"` requires
a `delegation` and forces `subject_authority.source` to `"role_source"`; `identity_mode:
"direct"` forces `actor_chain` to be empty.

The specification's own example is `unattended` — `user_123` with
`accounts-payable-fte` in the actor chain and `del_100`. So the schema itself stops step 05
fabricating the story's usual case, because step 05 has no delegation and no role source.

That refusal is worth showing rather than apologising for. A step built on `direct` mode and
a test asserting the other two modes cannot be constructed is more honest than a fake
delegation id.

**Moved to step 42 on 2026-09-28.** Step 05 was built on an internal principal with no
`identity_mode` at all, so none of the three modes is exercised. The teaching opportunity is
not lost — it travels with the document to step 42, where question 2 sends it. Worth keeping
because it is a rare thing: a schema that refuses to let a step pretend it has built something
it has not.

## 4 · `pnpm guard` does not check rule ids written in backticks (found 2026-09-29)

**Affects:** every step and these notes. Settle before step 07.

The guard strips inline code spans before hunting for `DSOR-` identifiers. The specification's
own prose writes ids bare, so the check works there. The tutorial writes **every** id in
backticks, so the check has never seen one of ours.

Proven by probe: adding `` `DSOR-FAKE-99` `` to a notes file leaves the guard green; the same
text without backticks produces
`error: known-id — … mentions DSOR-FAKE-99, which the spec does not define`.

It had already let something through. `DSOR-SOD-01` does not exist — the registry has
`DSOR-SOD-01a` and `DSOR-SOD-01b` — and it was cited in four tutorial files, including the
notes' own promises table. Fixed, and every id in all six steps plus these notes was then
checked by hand: 171 distinct, all real.

**Closed 2026-09-29: the guard was extended.** See [decision 42](decisions.md).

The worry that stopped it being the obvious choice turned out to be real and small. Checking code
spans across the whole repository would have failed on exactly **four** ids, and all four are
deliberate examples: `DSOR-DEL-04` and `DSOR-DEL-11` in the `change-the-spec` skill, which teaches
how ids are split and numbered, and the two in these notes. Prose about identifiers has to be able
to name one that does not exist.

So the guard now reads inline code spans, and carries a small `ILLUSTRATIVE` map naming those four
with the reason each is there. An entry that stops being used is itself an error, so the exemption
list cannot rot into a permanent hole. Proven three ways by probe: a bogus id in backticks fails, a
bogus id in plain text still fails, and a stale exemption fails.

## 5 · The one company's id lives in the invoice module (found 2026-09-29)

**Affects:** steps 03 to 06 now, step 10 when it arrives. Low, and not urgent.

`TENANT` is exported from `src/invoice.ts`, because step 03 was the first step that needed it and
the invoice module was where it already was. By step 05 that means the *identity* module imports
the one company's id from the *invoice* module, which is the wrong way round: who you belong to
does not depend on what an invoice is.

Nothing is broken by it. It is a shape that will cost a little extra when step 10 makes more than
one company possible — a file that should have been replaced becomes two files to unpick.

Two options, and neither needs deciding today:

1. **Leave it** and let step 10 do the unpicking, with this note as the warning.
2. **Move `TENANT` to a `src/tenant.ts` of its own**, repeated forward through steps 03 to 06.
   Four folders touched for a change nothing tests, which is exactly the kind of edit that
   introduces a mistake while fixing a smell.

The house rule that applies is decision 38: the smallest testable piece first. This is not a
piece, and not testable — so it waits for the step that has a reason to touch it.
