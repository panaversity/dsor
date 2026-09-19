# AGENTS.md

The durable contract for working in this repository: what DSoR is, the vocabulary,
the decisions, the invariants, and how it is built and tested. It is loaded every
session, so it holds **only what stays true**. What is true this week lives in
[`docs/status.md`](docs/status.md). The pitch for humans lives in
[`README.md`](README.md).

> `CLAUDE.md` imports this file with `@AGENTS.md`. One contract for every agent.
> This is an import and not a symlink on purpose: symlinks break when a student
> unzips or clones the repository on Windows (decision 8).

## Critical rules

1. **Never weaken a guarantee to simplify an implementation.** The security
   invariants in [§45](specs/dsor/06-conformance.md#45-security-invariants) are the
   product, not features of it. If a requirement is in your way, change the
   requirement in the open (`change-the-spec` skill), never around it.
2. **The agent is untrusted, and that includes you.** Nothing in DSoR may rely on a
   prompt, a tool description, or an agent's good behavior for enforcement. If a test
   only passes because the caller behaved, the test proves nothing.
3. **Spec and code move together.** A behavior change and the requirement it touches
   land in the same pull request, with `pnpm guard` green. No silent divergence in
   either direction.
4. **Never claim unbuilt behavior.** `docs/status.md` is the only authority on what is
   implemented. No present-tense sentence about code that does not exist, anywhere.
5. **Never push directly to `main`.** Every change lands through a pull request, and a
   human marks it ready.

## What this is, in one line

DSoR is the governed layer between an AI worker and a company's real systems: it
checks who is asking, under whose authority, against which rules and which current
state, gets a human's sign-off when the rules demand one, makes sure nothing happens
twice, and keeps the evidence.

Today this repository holds the **specification** (v1.4.0), its machine-readable half
(JSON Schemas, examples, requirement registry, all tested), and an empty
implementation package. The implementation is built in the five stages of
[`docs/learn/learning-path.md`](docs/learn/learning-path.md).

## What we claim, and to whom

- **DSoR is KSoR's companion.** KSoR (`panaversity/ksor`) is the record for what an
  organization *knows*. DSoR is the governed interface to what is operationally
  *true* and what may be *done*. A Digital FTE is KNOW + REMEMBER + REASON + STATE and
  ACT ([§3](specs/dsor/01-model.md#3-digital-fte-architecture)).
- **DSoR never takes the agent's word for anything.** It reads state itself, evaluates
  rules itself, and treats everything the agent supplies as a request, not a fact.
  Lead with that sentence, not with the machinery.
- **The readers are students and junior developers.** Every document opens in plain
  words before it states a rule (decision 7). Writing that only an expert can follow
  is a defect here, the same as a failing test.
- **Vendor-free.** The rules are normative; PostgreSQL, MCP, Better Auth, Graphiti,
  OpenViking, and KSoR are a replaceable reference profile
  ([§2](specs/dsor/01-model.md#2-normative-architecture-and-reference-profile)).

## Vocabulary

Used precisely; do not repurpose. Full glossary:
[§0.3](specs/dsor/00-conventions.md#03-glossary).

| Term | Means |
| --- | --- |
| **requirement** | One sentence in the spec with an id, a level, and exactly one MUST. The unit of conformance and of testing |
| **level** | L1 Core · L2 Autonomous · L3 Financial/Critical · RP (reference profile) · STACK (rules for software around DSoR) |
| **operation / contract** | A named query or command, and its machine-readable spec sheet |
| **control** | A versioned CEL rule that yields ALLOW, DENY, or REQUIRE\_\* |
| **delegation** | The permission slip from a human to an agent, held in DSoR's own store |
| **proposal** | The record of one command invocation and its state. Approvals attach to it |
| **control-plane store** | DSoR's own database: delegations, controls, proposals, approvals, idempotency records, intent records, counters, holds, audit |
| **intent record** | The durable note written *before* a side effect |
| **decision bundle** | The structured evidence for one decision. Never model reasoning |
| **stage** | One of the five build steps in `docs/learn/learning-path.md` |

## Repository layout

```text
AGENTS.md                 this file; CLAUDE.md imports it
README.md                 the pitch, for humans
specs/dsor/               THE SPECIFICATION (prose). Source of truth for every requirement
  README.md               index, how to read, section → file map
  00-conventions.md … 06-conformance.md, appendix-a-schemas.md, appendix-b-cel.md
packages/spec/            @panaversity/dsor-spec — the machine-readable half
  schemas/                normative JSON Schemas (draft 2020-12, URN ids)
  examples/               one validated instance per schema, from the running example
  requirements.json       GENERATED by `pnpm guard --write`; never edit by hand
  src/                    loaders, an exact-decimal money reference, and the tests
packages/dsor/            @panaversity/dsor — the reference implementation (not started)
docs/status.md            the only authority on what is implemented
docs/learn/               start-here, the five-stage learning path, questions and answers
research/                 how the spec got here, open questions, the v1.1 baseline
scripts/guard-spec.mjs    the spec guard (zero dependencies)
.claude/                  Claude Code settings, skills, and the reviewer subagent
```

## Commands

```bash
pnpm install              # frozen in CI
pnpm check                # everything CI runs: guard, lint, format, typecheck, unit tests
pnpm guard                # spec guard: ids, one-MUST, links, registry freshness
pnpm guard --write        # regenerate packages/spec/requirements.json after a spec edit
pnpm coverage:req         # how many requirement ids are named by a test, per level
pnpm coverage:req --list  # ...and which ones are not
pnpm test:unit            # vitest, no build needed
pnpm test:db              # *.db.test.ts, needs PostgreSQL at DSOR_DB_URL
pnpm typecheck            # builds workspace packages first, then tsc --noEmit
pnpm lint | pnpm fmt      # oxlint --fix | oxfmt
```

Node 22 or newer (`.nvmrc` pins 24, which CI uses). pnpm comes from the
`packageManager` pin.

## Decisions

Numbered, dated, never renumbered. A reversed decision stays, marked superseded.

1. **Spec first (2026-09-19).** The specification exists before the implementation.
   Every line of implementation traces to a requirement id.
2. **One requirement, one MUST (2026-09-19).** Each id holds exactly one MUST or
   MUST NOT and no SHOULD or MAY, so one id maps to one test. `pnpm guard` enforces it.
3. **Ids are forever (2026-09-19).** An id is never reused and never renumbered. A
   requirement that is split keeps its number and gains letters (`DEL-04` →
   `DEL-04a`, `04b`). A new requirement takes the next free number in its area. A
   removed requirement leaves a gap.
4. **The registry is generated (2026-09-19).** `packages/spec/requirements.json`
   comes from the prose by `pnpm guard --write`. The prose is the source of truth.
5. **One toolchain with ksor (2026-09-19).** TypeScript 7, pnpm workspace with a
   catalog, vitest, oxlint, oxfmt, a 48-hour release quarantine. Versions match
   `panaversity/ksor` so a contributor moves between the two without friction.
6. **CEL with flat function names (2026-09-19).** Control conditions and predicates
   are CEL. Extension functions are `dsor_exceeds`, not `dsor.exceeds`, because not
   every CEL implementation supports namespaced functions. `@marcbachmann/cel-js`
   8.0.0 was checked against the spec's vectors on this date.
7. **Learner-first writing (2026-09-19).** Every spec section opens with **In plain
   words**, then **Why it matters** where a real failure exists, then the example,
   then **The rules**, and sometimes **Common mistake**. See the `write-for-learners`
   skill.
8. **No symlinks (2026-09-19).** Students unzip and clone on Windows. `CLAUDE.md`
   imports `AGENTS.md`; skills live directly in `.claude/skills/`.
9. **Build order is the learning path (2026-09-19).** The implementation is built in
   the five stages of `docs/learn/learning-path.md`, and a stage is done only when
   its "you are done when" tests pass.
10. **The §44 ceilings are provisional (2026-09-19).** They are the editor's
    proposals and are expected to move once a real deployment measures them. See
    `research/open-questions.md`.
11. **Schemas keep the `1.3` URN (2026-09-19).** v1.3.1 was editorial, and v1.4.0 added
    requirements without touching a schema, so `urn:dsor:schema:1.3:*` did not change.
    The URN changes only when a schema does.
12. **Two context providers (2026-09-20).** `AgentContextStore` is composite. The
    reference profile uses Graphiti for memory, because a memory is a fact with a time
    and a source, and OpenViking for skills and resources, because those are folders
    and documents. Two rules came with the split: memory never stores operational
    state (`DSOR-CTX-07`), and every model a context provider uses is a model boundary
    (`DSOR-CTX-08`). The agent reaches memory only through an adapter that sets the
    tenant partition; Graphiti's own MCP server is never an agent tool.

## Product invariants

The table in [§45](specs/dsor/06-conformance.md#45-security-invariants) is the
complete list. The six that are easiest to break by accident while coding:

- Authorization, controls, and preconditions read state **through connectors and the
  control-plane store only**. Never from request arguments (`DSOR-MOD-03`, `DSOR-MOD-04`).
- The decision is recorded **before** the response, denials included (`DSOR-EXE-02`).
  The intent record is written **before** the side effect (`DSOR-EXE-03a`).
- If evidence cannot be written, the command does not run (`DSOR-EXE-03b`).
- An unknown outcome is reported as unknown. Never success, never failure, never a
  retryable error (`DSOR-UNK-01b`).
- A control whose condition throws **applies** (`DSOR-CTL-07`). A comparison that
  cannot convert currency resolves restrictively (`DSOR-MON-04`).
- An approval counts only from the approver's own `direct` login (`DSOR-APR-05a`).

## How we work

1. **Pick a stage and its requirement ids.** `pnpm coverage:req --list` shows what no
   test names yet.
2. **Red first.** Write the failing test before the code. The test title starts with
   the requirement id: `it("DSOR-IDM-01c: a replay returns the recorded result", …)`.
   That title is how coverage is counted.
3. **Implement in requirement-sized commits.** One requirement, its test, its code.
4. **Attack your own work** with the threat table in
   [§10.2](specs/dsor/02-security.md#102-threats-and-mitigations), then ask the
   `requirement-reviewer` subagent for a hostile pass.
5. **Break it on purpose.** Guarantees about crashes, races, and timeouts are proven by
   fault injection, not by reading the code
   ([§47](specs/dsor/06-conformance.md#47-verification-approach)).
6. **Truth sweep.** Update `docs/status.md` and any document the change made false, in
   the same pull request.

The `implement-spec` skill is this list in full. Load it before the first line of an
implementation.

## Coding principles

- Boring, explicit TypeScript. `strict`, `isolatedDeclarations`, `erasableSyntaxOnly`:
  exported functions declare their return types; no enums, no parameter properties.
- Relative imports end in `.js`. Workspace packages are imported by name.
- Money is `{ value: string, currency: string }`. No `number` ever touches an amount.
- Every error a caller can see is an error envelope with a code from
  [§28](specs/dsor/03-execution.md#28-result-and-error-envelopes) and a retry class.
- A shared dependency version goes in the `pnpm-workspace.yaml` catalog, with a
  comment that says why it is there.
- A comment explains *why*. Record what a live run taught beside the code:
  `// found live 2026-10-02: …`.

## Testing

| Tier | Files | Needs | Runs |
| --- | --- | --- | --- |
| unit | `*.test.ts` | nothing | `pnpm test:unit`, every push |
| database | `*.db.test.ts` | PostgreSQL at `DSOR_DB_URL` | `pnpm test:db` |

Row-level security, atomic reservations, the idempotency claim, and the audit role's
missing UPDATE privilege are properties of a real database. They are tested in the
database tier and **never against a mock**. A concurrency guarantee is tested with
real parallel requests.

## Documentation

- Plain words first (decision 7). Short sentences. Define a term where it first
  appears. One running example: `org_456`, `user_123`, `accounts-payable-fte`,
  `cfo_100`, `INV-1008`, `PAY-901`, 31,400.00 USD, threshold 25,000 USD
  ([§0.4](specs/dsor/00-conventions.md#04-running-example-informative)).
- Refer to a requirement by id and to a section by link. `pnpm guard` fails on an
  unknown id or a dead link.
- `research/` holds reasoning and history. `docs/` holds what a reader needs today.

## Commit and PR style

Imperative, concise commit subjects. Name the requirement ids a change implements. A
PR describes problem → solution → behavior for a reviewer, not a file list. Leave PRs
in draft; a human marks them ready.

## Authority, and definition of done

1. **`specs/dsor/`** is authoritative on what DSoR must do.
2. **This file** is authoritative on vocabulary, decisions, and process.
3. **`docs/status.md`** is the only authority on what is actually built.
4. Where code and spec disagree, that is a bug in one of them. Decide which, fix it,
   and keep them together (critical rule 3).

Done means: tests written red first are green; `pnpm check` passes on a clean
checkout; every guarantee touched was broken on purpose and held; `docs/status.md` is
true; review findings were fixed or recorded, never quietly dropped.

## Do not

- Do not edit `packages/spec/requirements.json` by hand, or renumber an id.
- Do not put enforcement in a prompt, a tool description, or an MCP hint.
- Do not give any agent-facing surface `execute_sql`, a generic "invoke", or an API
  passthrough (`DSOR-OPR-03a`).
- Do not mock the database to test isolation, atomicity, or audit immutability.
- Do not map a timeout on a command to a retry-safe error (`DSOR-ERR-02`).
- Do not accept approval through anything that travels via the requesting agent,
  including MCP multi-round-trip input (`DSOR-APR-05b`, `DSOR-RP-08`).
- Do not store a connector credential where the agent or the model can read it
  (`DSOR-CNR-02`).
- Do not hand the agent a memory tool that takes a tenant or group id as an argument,
  and do not point a self-building memory at unmasked transcripts (decision 12).
- Do not add a symlink (decision 8) or a dependency outside the catalog without a
  why-comment (decision 5).
