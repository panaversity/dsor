@AGENTS.md

## Building a baby step: explain, ask, then build

Every step of the baby-steps tutorial is built in three phases, in this order, and the order is
not optional:

1. **Explain the problem the step solves**, in plain words, before any code. Not what the step
   *adds* — what goes wrong without it. Name the concrete failure from the running story.
2. **Ask.** Put the decisions the step needs to the learner, in beginner language, with the
   trade-off of each option and a recommendation. Then **wait**. A decision that is the
   learner's is not yours to take quietly, and a question they cannot answer is a question
   asked badly — rephrase it rather than deciding for them.
3. **Then build**, a piece at a time, each piece committed on its own and each verified by
   breaking it on purpose.

Why this is a rule and not a preference: a learner copy that arrives finished teaches nothing,
because the reasoning is the product. Step 06 was built in one pass and explained afterwards,
and it was deleted and rebuilt for that reason — the rebuild found three real defects the first
build shipped, because a piece small enough to explain is a piece small enough to attack
(`docs/baby_steps_tutorials/my_notes/decisions.md`, decisions 38 and 43).

## Claude Code

- Load the `implement-spec` skill before writing implementation code, the
  `change-the-spec` skill before editing anything under `specs/dsor/`, and the
  `write-for-learners` skill before writing or editing prose for readers.
- After implementing a requirement, ask the `requirement-reviewer` subagent for a
  hostile pass before you say the work is done.
- Run `pnpm check` before you report success. Report what it printed, not what you expect.
- `.claude/settings.json` lets the routine commands run without a prompt, denies
  reading `.env` files, and asks before `git push`. Keep personal overrides in
  `.claude/settings.local.json`, which is gitignored.
