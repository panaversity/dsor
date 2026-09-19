---
name: write-for-learners
description: The house style for every reader-facing document in this repo — the spec sections, docs/learn, README, status. Readers are students and junior developers. Covers the fixed section shape (In plain words, Why it matters, example, The rules, Common mistake), sentence rules, the single running example, and what to cut. Load before writing or editing prose under specs/dsor/, docs/, or README.md.
metadata:
  version: "1.0.0"
---

# Writing for learners

The reader is a student or a junior developer. They are intelligent and they have not
built a security-sensitive backend before. English is often their second language.
Writing that only an expert can follow is a defect (AGENTS.md → decision 7).

## The section shape

Every numbered spec section has these parts, in this order. Leave a part out when it
would be empty. Never reorder them.

1. **In plain words.** What this section is about, with no jargon. If a term is
   unavoidable, define it in the same sentence. Two to five sentences.
2. **Why it matters.** The real failure this section prevents, told as a short story
   from the running example. Skip it if there is no concrete failure to tell.
3. The example (YAML, a diagram, a table).
4. **The rules.** The requirement lines. A first-time reader is told they may skip
   these, so nothing they need to understand may appear *only* here.
5. **Common mistake.** What a beginner actually does wrong, stated as the wrong thing,
   then the fix. Only when there is a specific, common one.

## Sentence rules

- Short sentences. One idea each. Prefer a full stop to a dash or a semicolon.
- Say the plain thing. "DSoR looks the vendor up itself", not "state is sourced
  authoritatively".
- Define before use. The prerequisite table in `docs/learn/start-here.md` is the list
  of terms a reader may be assumed to know after reading it. Anything else gets
  defined where it first appears.
- An analogy must fit the rule exactly where it is used, and is dropped the moment it
  stops fitting. The established ones: new clerk (the whole idea), permission slip
  (delegation), booking the last hotel room (atomic reservation), order-tracking page
  (proposal), pilot's checklist (pipeline), a lock that stays locked when the power
  fails (fail closed). Reuse these before inventing another.
- Name the failure concretely: who, which invoice, how much, what went wrong.
- No filler, no hype, no "simply" or "just". If a step were simple, the reader would
  not need the document.

## One running example

`org_456` · `user_123` (AP supervisor) · `accounts-payable-fte` · `del_100` ·
`cfo_100` · `VENDOR-44` · `INV-1008` · `PAY-901` · 31,400.00 USD · threshold
25,000 USD · limits 50,000 per transaction and 200,000 per day. Every example uses
these names and numbers. A new scenario is a new step in this story, not a new cast.

## What to cut

- A paragraph that repeats what **In plain words** already said.
- Commentary about earlier versions. That belongs in `research/history.md`.
- A present-tense sentence about something `docs/status.md` does not list as built.

## Check before you finish

Read the section as a student who has read only `docs/learn/start-here.md`. Is every
term defined? Could they say, in one sentence, what goes wrong without this section?
Then run `pnpm guard`: it catches dead links and unknown requirement ids.
