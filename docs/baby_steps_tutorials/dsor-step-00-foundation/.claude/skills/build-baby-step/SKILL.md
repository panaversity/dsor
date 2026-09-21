---
name: build-baby-step
description: Builds one numbered step of the DSoR baby-steps tutorial under docs/baby_steps_tutorials/. Use when asked to build, write, continue, or fix a baby step or tutorial step ("build step 07", "next baby step"), or when a learner asks to build a step themselves in the workbench ("learner mode"). Covers copying the previous step, the one-new-idea rule, tests titled by rule id and written first, the NEW IN STEP marker, performing the break-it exercise for real, the learner-shaped README, and the truth sweep.
metadata:
  version: "1.0.0"
---

# Building a baby step

A baby step teaches **one new idea** to a junior developer. The code is teaching code:
the clearest version wins over the fastest or the most general. The map of all steps is
`docs/baby_steps_tutorials/readme.md`. Follow this skill in order.

There are two modes. Ask which one if it is not obvious.

| | Author mode | Learner mode |
|---|---|---|
| Who | A contributor adding the official step | A student building their own copy |
| Where | `docs/baby_steps_tutorials/NN_name/` | `docs/baby_steps_tutorials/workbench/NN_name/` |
| Start from | The previous official step | The learner's own previous workbench step |
| Install | `pnpm install` at the repository root | `pnpm install --ignore-workspace` inside the step |
| Your job | Build it, prove it, document it | **Teach.** See "Learner mode" below |

## 1 · Read before you write

1. Read the step's entry in `docs/baby_steps_tutorials/readme.md`: its idea, its
   "Spec" links, its rule ids, and its "Done when" or "Break it".
2. Read each linked specification section in full, including **Why it matters** and
   **Common mistake**. Read each rule's sentence in `packages/spec/requirements.json`.
3. Read the previous step's README and code. You are continuing someone's story.
4. Load the `write-for-learners` skill. The README you will write follows it.
5. For a step that introduces or uses Neon, Better Auth, or Managed Better Auth, read
   "The platform we build on" in the map and AGENTS.md decision 14, then **check the
   product's current documentation** before you write code: the supported plugin list
   of Managed Better Auth changes, and the map records what was true on a date.

Stop and say so if the step needs two new ideas. The fix is to split the step in the
map first (renumbering later steps is allowed only while they are unbuilt), never to
build a double step.

## 2 · Copy, do not start fresh

```bash
cp -r docs/baby_steps_tutorials/MM_previous docs/baby_steps_tutorials/NN_name
rm -rf docs/baby_steps_tutorials/NN_name/node_modules
```

Then change exactly two things before any real work: the `name` in `package.json`
(`@dsor-steps/NN-name`) and the `description`. Everything else from the previous step
stays, byte for byte, unless this step's idea requires changing it.

- **Never edit an earlier step to make this one easier.** If you find a bug in an
  earlier step, stop and report it. The fix goes into the earliest step that has the
  bug and is then repeated in every later step, in a separate pull request.
- A new dependency uses a plain version number that equals the `pnpm-workspace.yaml`
  catalog entry. If the catalog has no entry, add one there with a why-comment first.
  `pnpm guard` checks that they match.
- Imports between files end in `.ts`. Steps run in Node directly and are never built.

## 3 · Red first, titled by rule id

Write the new tests before the new code. Title each with the rule it proves:

```ts
it("DSOR-EXE-02: a denied command is recorded before the response", …)
```

Test the refusal as carefully as the success. Run the tests and watch the new ones
fail for the right reason. Tests that need PostgreSQL are named `*.db.test.ts` and run
against a real database, never a mock: a Neon branch made for the test run, reached
through `DSOR_DB_URL` as a role created with SQL. Never read or print `.env`; ask the
learner to confirm the variable is set.

## 4 · The smallest change that turns them green

Add only what this step's idea needs. Mark every added or changed region:

```ts
// NEW IN STEP 07: the checks now run in one fixed order.
```

Remove the previous step's `NEW IN STEP` markers, so that a reader searching for
"NEW IN STEP" finds only this step's lesson. Keep files short. When a file passes
about 150 lines, that is a sign the step is too big or the file wants splitting in a
step of its own.

## 5 · Break it, for real

Every step has a "Break it" exercise. **Perform it yourself**: remove or sabotage the
new piece, run the command, and copy the real output into the README. Then restore the
code and confirm `pnpm check` is green. Never write expected output from imagination.
A break-it exercise whose failure you did not watch is a guess.

## 6 · The step's README

Same headings as `00_foundation/README.md`, in this order:

`# Step NN · Title` → **New in this step** (one line) → In plain words → Why it matters
(a concrete failure from the running story) → What changed since step MM (a short
file list, plus the `git diff --no-index` command) → Run it → Break it (with real
output) → Build it yourself with Claude Code (the learner-mode prompt for this step) →
Check yourself (3 to 5 questions, answers inside `<details>`) → The rules this step
meets (rule ids, not in backticks, so `pnpm guard` verifies them) → **Next:**.

Use the running story only: `org_456`, `user_123`, `accounts-payable-fte`, `cfo_100`,
`VENDOR-44`, `INV-1008`, `PAY-901`, 31,400.00 USD.

## 7 · Prove it three ways, then sweep

```bash
pnpm install                                   # repository root
pnpm -C docs/baby_steps_tutorials/NN_name check
pnpm check                                     # whole repository: guard, lint, format, types, tests
```

Then copy the folder to a temporary directory outside the repository, run
`pnpm install && pnpm check` there, and delete the copy. A step must run by itself.

Truth sweep, in the same pull request:

- In `docs/baby_steps_tutorials/readme.md`, turn the step's directory name into a link
  and update the status note at the top.
- In `docs/status.md`, update the tutorial line.
- Open a draft pull request. One step per pull request.

## Learner mode

The learner is here to understand, not to receive a folder. Change how you work:

- **Explain before each file**, in two or three plain sentences, and wait for "go".
- **Ask before you tell.** Before running a test, ask what they expect to happen.
  Before the break-it exercise, ask them to predict the failure.
- **Let them type** when they want to. Offer: "Do you want to write this test yourself?
  I will review it."
- **Do not open the finished step** in `docs/baby_steps_tutorials/NN_name/` until the
  learner asks to compare. Then run `git diff --no-index` between the two folders and
  explain which differences matter and which are style.
- Keep to one step per session. When it passes `pnpm check`, ask the step's "Check
  yourself" questions and stop. Suggest `/clear` before the next step.
- Nothing in learner mode touches the official steps, `docs/status.md`, or the map.
