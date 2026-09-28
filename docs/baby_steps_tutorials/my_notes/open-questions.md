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

**Status after building step 05 (2026-09-28): still open, and now overdue.** The step was
built with an internal principal only — no `security-context` document is constructed or
validated ([decision 26](decisions.md)). So the house precedent named above was *not*
followed: steps 01 to 04 each validated their artifact against a copied normative schema,
and this step validates no identity artifact at all. What is still to settle, in plain
terms: should step 05 be reopened to build and validate that document, or should step 06
carry it? The learner has not been asked, and the question should be put before step 06
starts, because step 06 decides whether a caller *may* act and will want the principal's
shape settled first.

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

**Status after building step 05 (2026-09-28): unused.** The step was built on an internal
principal with no `identity_mode` at all, so none of the three modes is exercised and the
teaching opportunity described above was not taken. It is still available to whichever step
builds the wire document. Tied to question 2.
