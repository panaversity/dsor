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

**Closed 2026-09-30: step 08 builds the chain.** See [decision 51](decisions.md).

The question was whether the chain is a second idea for step 08. It is not, by the test decision 43
settled on: name the step's promise, then ask which parts the promise requires. Step 08 promises that
the decision is written down before the answer **and that it is evidence** — and a record that does
not validate against the evidence schema is not evidence. Five lines, and `createHash` was already
there.

What stays at step 39 is the part a list in memory cannot demonstrate: that the runtime identity
cannot update or delete a record (`DSOR-AUD-04a`), and that a chain still verifies across a restart.
Both need a real database, which is step 09.

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

**Closed 2026-09-29: moved.** `src/tenant.ts` now holds it in steps 03 to 06, and `invoice.ts`
imports it like everybody else. See [decision 44](decisions.md).

This note had recommended leaving it, on the grounds that four folders touched for a change no test
can see is the kind of edit that introduces a mistake while fixing a smell. That was the right call
while the question was whether it deserved a detour. It stopped being right when the answer became
"do all of it" — and the edit was mechanical, with all six suites green before and after.

## The chain's time check trusts the system clock (raised 2026-10-04, step 09)

`verifyChain` rejects a log whose `at` values go backwards. Decision 77 made the *sequence* and the
clock agree with each other, so a lost race can no longer cause that. What it cannot do is make the
clock itself monotonic — and it assumes there is **one** clock. An NTP correction that moves the
system clock back between two writes, or two instances of this program on one database with clocks a
few seconds apart (the deployment `pg`'s pool and the Neon route exist for), produce the same symptom — an intact chain reported as broken, with rows nobody can correct.

Three ways out, none of them this step's:

1. **A trusted time source**, which is what §30 actually asks for. The right answer and the
   expensive one.
2. **Order by `recorded_at` instead**, the database's own `now()`. One clock instead of many, but
   `recorded_at` is deliberately *not* in the hash — it is the witness that sits beside the
   application's claim, and putting it inside the hash would lose that.
3. **Drop the time check from `verifyChain`** and rely on the hash chain alone for tamper-evidence,
   keeping the times as evidence rather than as a rule. The chain already pins the order; the time
   check is a second, weaker statement about the same thing.

Option 3 is the one I would argue for, and it is a change to what `verifyChain` promises, so it is
not a quiet edit. Left open.

## Two routes to rewriting the log that no privilege check sees (raised 2026-10-04, step 09) — CLOSED the same day

`refuseIfItCanRewriteHistory` asks `has_table_privilege` and `pg_has_role`. Both answer for
privileges. A `SECURITY DEFINER` function owned by the table's owner, or a trigger the owner installs,
rewrites rows on the application's behalf with the application holding nothing — and `EXECUTE` on a
new function goes to `PUBLIC` by default. No such function exists; the README states it as limit 3; a
test pins the single call site so adding one is visible. Closing it means either forbidding
`SECURITY DEFINER` functions in the migration review, or checking `pg_proc` for them at start-up,
which is a longer list of things to be wrong about.

**Closed 2026-10-04.** The start-up check now asks `pg_proc` for a `SECURITY DEFINER` function this
connection may `EXECUTE` whose owner may rewrite the table, and `pg_trigger` for any non-internal
trigger on `audit`; it refuses on either. A function whose owner holds no such right is not refused,
and a test says so, because the check is about the owner's rights and not the keyword. See
[decision 86](decisions.md).

## Which constraint refuses a real program race, on a real server (raised 2026-10-04, step 09) — CLOSED the same day

For the program's own rows a position collision also collides on `audit_pkey`, and PGlite names the
primary key. PostgreSQL 17 checks indexes in the same order, so it should too — but every measurement
of that is in-process, and the db tier's race test uses synthetic distinct ids on purpose. Unverified
against the server, and recorded rather than assumed.

**Closed 2026-10-04, by measuring.** `audit.db.test.ts` inserts the program's own row shape twice at
one position through the application's real login on PostgreSQL 17: SQLSTATE `23505`, constraint
`audit_pkey`. And three `audit()` calls on three real pool connections, no fault injection, leave one
chain that verifies, every loser refused with `23505`. The clock-skew entry above is the one that
stays open, and it is a design decision for the learner: whether `verifyChain` should keep its time
check at all.
