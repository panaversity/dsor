# Contributing

Thank you for helping. Students are especially welcome: this project is written for
you, and a question that shows where the specification is hard to follow is a useful
contribution.

## Before you start

1. Read [`docs/learn/start-here.md`](docs/learn/start-here.md).
2. Read [`AGENTS.md`](AGENTS.md). It is the contract for humans and coding agents alike.
3. Run `pnpm install && pnpm check`. It should pass on a clean checkout.

## Kinds of contribution

| You want to… | Do this |
| --- | --- |
| Report that something is hard to understand | Open an issue naming the section. That is a defect here, not a nitpick |
| Fix wording without changing a rule | Edit `specs/dsor/` or `docs/`, follow `.claude/skills/write-for-learners/SKILL.md`, run `pnpm guard` |
| Add, split, or change a requirement | Follow `.claude/skills/change-the-spec/SKILL.md`. Ids are never reused or renumbered, and each holds one MUST |
| Implement part of the learning path | Follow `.claude/skills/implement-spec/SKILL.md`. Tests first, titled by requirement id |
| Report a security problem | Do not open an issue. See [`SECURITY.md`](SECURITY.md) |

## Pull requests

- Never push to `main`. Open a draft pull request; a maintainer marks it ready.
- Describe problem → solution → behavior. Name the requirement ids.
- `pnpm check` must pass. If you edited the specification, run `pnpm guard --write`
  first and commit the regenerated `packages/spec/requirements.json`.
- Update `docs/status.md` if your change makes any sentence in it false.

## License

By contributing you agree that your contribution is licensed under
[Apache-2.0](LICENSE).
