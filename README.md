# DSoR — Data System of Record

**The governed layer between an AI worker and a company's real systems.**

A company does not hand a new accounts clerk the bank password and say "pay whatever
looks right." The clerk gets a login of their own, a list of what they may do, a
spending limit, a manager who signs off on large payments, and a logbook.

An AI agent that works inside a company — a *Digital FTE* — needs the same treatment,
and more, because an agent can be confidently wrong, can be tricked by text it reads,
and retries things a person would not. DSoR is the layer that stands between the agent
and the accounting system, the ERP, and the database. It makes sure the agent can only
do what it is allowed to do, that large actions get a human's sign-off, that nothing
happens twice by accident, and that there is proof of everything afterwards.

**DSoR never takes the agent's word for anything. It checks for itself.**

## Where it fits

| Part | In the clerk analogy | Its job |
| --- | --- | --- |
| [KSoR](https://github.com/panaversity/ksor) — Knowledge System of Record | The company handbook | KNOW |
| Context store (by default: [Graphiti](https://github.com/getzep/graphiti) for memory, [OpenViking](https://github.com/volcengine/OpenViking) for skills and files) | The clerk's notebook | REMEMBER |
| Agent runtime | The clerk's brain | REASON |
| **DSoR** — this repository | The company's systems, the desk that checks permissions and sign-offs, and the logbook | STATE + ACT |

## Status

This repository currently holds the **specification, v1.4.0**, its machine-readable
half, and a tested toolchain. **The reference implementation has not been started.**
[`docs/status.md`](docs/status.md) is the only authority on what is built.

## Start here

| You are… | Go to |
| --- | --- |
| New to all of this | [`docs/learn/start-here.md`](docs/learn/start-here.md) — fifteen minutes, no prior knowledge assumed |
| A student who wants to build it | [`docs/learn/learning-path.md`](docs/learn/learning-path.md) — a small DSoR in five stages |
| Checking what you learned | [`docs/learn/questions.md`](docs/learn/questions.md) — 23 questions with answers |
| Reading the specification | [`specs/dsor/README.md`](specs/dsor/README.md) |
| Writing a conformance test | [`packages/spec/requirements.json`](packages/spec/requirements.json) — 268 requirements, one MUST each |
| A coding agent, or working with one | [`AGENTS.md`](AGENTS.md) |

## What is in the repository

```text
specs/dsor/        the specification, in seven parts and two appendices
packages/spec/     JSON Schemas, validated examples, the requirement registry, and their tests
packages/dsor/     the reference implementation (not started)
docs/learn/        start here · learning path · questions and answers
docs/status.md     what is implemented
research/          how the specification got here, and what is still open
.claude/           Claude Code settings, skills, and a reviewer subagent
```

## Run the checks

```bash
corepack enable          # or: npm install -g pnpm
pnpm install
pnpm check               # spec guard, lint, format, typecheck, tests
```

`pnpm check` proves that every example validates against its schema, that the schemas
reject what the specification says they reject, that the `high-value-payment` control
passes its own test vectors in a real CEL evaluator, and that every one of the 268
requirements holds exactly one MUST.

Try one thing: open `packages/spec/src/control-cel.test.ts` and find the test named
*"the naive condition lets 50,000,000 PKR through"*. It shows a rule that looks
correct and is not, and the specification's fix.

## Developing with Claude Code

This is also the repository DSoR is built in, with Claude Code. `CLAUDE.md` imports
`AGENTS.md`, so every agent reads one contract. Three skills carry the working
discipline — `implement-spec`, `change-the-spec`, `write-for-learners` — and a
read-only `requirement-reviewer` subagent gives a hostile pass before work is called
done. Start a session and say which stage of the learning path you are on.

## Contributing, security, license

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md). Licensed
under [Apache-2.0](LICENSE). Copyright 2026 Panaversity.
