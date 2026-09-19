---
name: change-the-spec
description: How to change the DSoR specification safely — adding, splitting, rewording, or removing a requirement under specs/dsor/, or changing a JSON Schema or example under packages/spec/. Covers id rules (never reuse, never renumber), one MUST per id, regenerating requirements.json, keeping schemas, examples, tests, and history in step. Load before editing anything in specs/dsor/ or packages/spec/schemas/.
metadata:
  version: "1.0.0"
---

# Changing the specification

A requirement id is a promise to everyone who wrote a test against it. These rules
keep that promise.

## The id rules (AGENTS.md → decisions 2, 3, 4)

- **One id, one MUST.** Exactly one `MUST` or `MUST NOT`. No `SHOULD`, no `MAY`.
  Advice goes in an ordinary sentence below the rules, with no id.
- **Never reuse, never renumber.**
  - Splitting `DSOR-DEL-04` gives `DSOR-DEL-04a`, `DSOR-DEL-04b`. The bare `04`
    disappears.
  - A new requirement takes the next free number in its area (`DSOR-DEL-11`).
  - A removed requirement leaves a gap. Say so in `research/history.md`.
- **The line format is exact**, because the guard parses it:

  ```text
  - **[DSOR-AREA-NNx · L2]** One sentence with one MUST.
  ```

  Levels: `L1`, `L2`, `L3`, `RP`, `STACK`. The separator is a middle dot `·`.
- **Rewording that changes meaning is a new requirement.** Rewording that only
  clarifies keeps the id. When unsure, it changed the meaning.

## Steps

1. Edit the prose in `specs/dsor/`. Keep the section shape of the
   `write-for-learners` skill: **In plain words**, **Why it matters**, example,
   **The rules**, **Common mistake**.
2. If a rule now refers to a bound ("within the bound of §44"), add the row to the
   table in §44 with an L2 and an L3 ceiling.
3. If the change touches the shape of an artifact, edit the schema in
   `packages/spec/schemas/` **and** the example in `packages/spec/examples/`, and add
   a rejection case to `packages/spec/src/schemas.test.ts` titled with the
   requirement id. If the schema's meaning changed, the URN version changes too
   (decision 11), and Appendix A's table is updated.
4. If the change touches CEL, update Appendix B and the vectors in
   `packages/spec/examples/control.example.json`, and run the CEL tests.
5. Update the invariants table in §45 and the verification table in §47 if the change
   belongs there.
6. Run `pnpm guard --write`, then `pnpm check`.
   - `one-must` → split the requirement.
   - `known-id` → some document still names an id you removed or mistyped.
   - `link-target` → a heading changed and a link to it did not.
   - `registry-current` → you forgot `--write`.
7. Add a dated paragraph to `research/history.md`: what changed and why. If a decision
   changed, add or supersede an entry in AGENTS.md → Decisions.
8. If tests already name an id you split or removed, update their titles in the same
   pull request.

## Versioning the specification

Editorial change (wording, examples, learner blocks; no requirement text changes):
patch, `1.3.1` → `1.3.2`. Any requirement added, removed, or changed in meaning:
minor, `1.3.x` → `1.4.0`. Update `SPEC_VERSION` in `packages/spec/src/index.ts`, the
`version` in `scripts/guard-spec.mjs`, the front matter of every file in
`specs/dsor/`, and `TARGET_SPEC_VERSION` in `packages/dsor/src/index.ts` when the
implementation follows.
