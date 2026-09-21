@AGENTS.md

## Claude Code

- Load the `build-baby-step` skill before building or changing anything under
  `docs/baby_steps_tutorials/`. It has an author mode and a learner mode; ask which.
- Load the `implement-spec` skill before writing implementation code, the
  `change-the-spec` skill before editing anything under `specs/dsor/`, and the
  `write-for-learners` skill before writing or editing prose for readers.
- After implementing a requirement, ask the `requirement-reviewer` subagent for a
  hostile pass before you say the work is done.
- Run `pnpm check` before you report success. Report what it printed, not what you expect.
- `.claude/settings.json` lets the routine commands run without a prompt, denies
  reading `.env` files, and asks before `git push`. Keep personal overrides in
  `.claude/settings.local.json`, which is gitignored.
