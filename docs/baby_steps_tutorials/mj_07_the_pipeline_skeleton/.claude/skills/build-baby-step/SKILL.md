---
name: build-baby-step
description: Builds one numbered step of the DSoR baby-steps tutorial. Use when asked to build, plan, continue, fix, or review a baby step or tutorial step ("plan step 07", "build this step"), or when a learner wants to build a step themselves ("learner mode"). Covers the one-new-idea rule, the design written before any code, tests titled by rule id and written first, the NEW IN STEP marker, performing the break-it exercise for real, the learner-shaped README, and proving the step runs by itself.
metadata:
  version: "2.2.0"
---

# Building a baby step

A baby step teaches **one new idea** to a junior developer. You are working **inside the
new step's folder**, which a human created by copying the previous step. This skill,
`CLAUDE.md`, and the settings came along with that copy, and they will travel to the
next step the same way.

Ask which mode you are in if it is not obvious.

| | Author mode | Learner mode |
|---|---|---|
| Who | A contributor adding the official step | A student building their own copy |
| Folder | `NN_name/`, named as in the map | `my_NN_name/`, beside the official steps or anywhere else. Your initials instead of `my` (`mj_NN_name/`) when several people push copies to one repository |
| Your job | Build it, prove it, document it | **Teach.** See "Learner mode" below |

## 1 · Read before you write

1. Read this step's entry in the map (`../readme.md`, or the GitHub link in
   `CLAUDE.md`): its idea, its "Spec" links, its rule ids, its "Done when" or "Break it".
2. Read each linked specification section in full, including **Why it matters** and
   **Common mistake**. The mistake named there is the one you are about to make. Read
   each rule's sentence in the requirement registry.
3. Read this folder's README and code as they stand. They are the previous step. You
   are continuing someone's story.
4. If the step introduces Neon, Better Auth, or Managed Better Auth, read "The platform
   we build on" in the map, then **check the product's current documentation** before
   writing code. The map records what was true on a date.

Stop and say so if the step needs two new ideas. The answer is to split the step in
the map, never to build a double step.

## 2 · Make the copy yours

The folder is a copy of the previous step. Before any real work, change exactly these:
the `name` in `package.json` (`@dsor-steps/NN-name`, or `@dsor-steps/mj-NN-name` for a
learner copy named `mj_NN_name`) and its `description`. Delete
`node_modules` if it was copied, and run `pnpm install`.

Everything else stays byte for byte unless this step's idea requires changing it.
Steps are cumulative, so removing an earlier step's code is the exception. When you do,
say why in one line under "Think it through".

- **Write only inside this folder.** If you find a bug that came from an earlier step,
  stop and report it. The fix belongs in the earliest step that has it, and is then
  repeated forward by a human, separately.
- A new dependency gets an exact version number, and `pnpm install` updates this
  folder's own `pnpm-lock.yaml`. Say why the dependency is needed in the README.
- Imports between files end in `.ts`. Steps run in Node directly and are never built.

## 3 · Red first, titled by rule id

If the README already holds "The design, before any code", check it first against every
rule sentence it relies on, and against the real schemas. When they say it is wrong,
stop and tell the human. The design changes in the README first, and "Think it
through" says why.

Write the new tests before the new code. Title each with the rule it proves:

```ts
it("DSOR-EXE-02: a denied command is recorded before the response", …)
```

Test the refusal as carefully as the success. Run the tests and show the human the new
ones failing, for the right reason. Tests that need a database are named
`*.db.test.ts` and run against a real PostgreSQL (a Neon branch), never a mock.

A test that expects "yes" passes before any code exists, because nothing says no yet.
It proves something only beside the "no" code it guards, so write both.

## 4 · The smallest change that turns them green

Add only what this step's idea needs. Mark every added or changed region:

```ts
// NEW IN STEP 07: the checks now run in one fixed order.
```

Remove the previous step's `NEW IN STEP` markers, so a reader searching for
"NEW IN STEP" finds only this step's lesson. When a file passes about 150 lines, the
step is too big or the file wants splitting in a step of its own.

A comment that points into a README names the step: `(step 07's README, decision 3)`,
even for this step's own README. A bare `(README, decision 3)` is right only in the
folder that wrote it, and the next step's copy breaks it.

## 5 · Break it, for real

Every step has a "Break it" exercise. **Perform it yourself**: sabotage the new piece,
run the command, and copy the real output into the README. Then restore the code and
confirm `pnpm check` is green. Never write expected output from imagination.

## 6 · The step's README

Step 00's headings, plus "The design, before any code" and "Think it through", which
step 00 does not have. In this order:

`# Step NN · Title` → **New in this step** (one line) → In plain words → Why it matters
(a concrete failure from the running story) → The design, before any code (in learner
mode: the rules split into claims, the decisions the specification leaves to the step,
each ending with its *Downside:*, the tests by claim, and the breaks with the learner's
predictions) → What changed since step MM (a short file list, and `git diff --no-index`
commands for the two folders' `src` and `test`; a whole-folder diff buries the lesson
under `node_modules`) → Run it → Break it (with real output) → Build it yourself with
Claude Code (the learner prompt for this step) → Check yourself (3 to 5 questions,
answers inside `<details>`) → Think it through (what the hostile review found and fixed,
and what was left open on purpose; the next step starts from this list) → The rules
this step meets (a table: rule, what it says, a relative link to its spec section, the
tests that prove it) → **Next:**.

Write for a student whose second language may be English: short sentences, one idea
each, every term defined where it first appears, no "simply" and no "just".
When the specification is silent and the step decides something, such as the form of an
id, say that it is this tutorial's decision. Never word it as a rule of DSoR.

## 7 · Prove it, review it, then hand over

```bash
pnpm install --frozen-lockfile
pnpm check
```

Then copy this folder to a temporary place outside the repository, run the same two
commands there, and delete the copy. A step must run by itself.

Then ask a fresh subagent, one that has not seen the conversation, for a hostile
review: the rule ids against the code and tests, and the README against the
`write-for-learners` skill. That skill is `.claude/skills/write-for-learners/SKILL.md`
in the repository, otherwise
<https://github.com/panaversity/dsor/blob/main/.claude/skills/write-for-learners/SKILL.md>.
The reviewer lists every analogy and flags each one that is not on that skill's
established list. It also breaks the code on purpose, one small change at a time: it
deletes a `^`, a type check, or a guard, or makes a function ignore its argument. It
reports every change that leaves all tests green. It makes those breaks in a copy
outside the repository, never in the step folder. It also attacks the step with the
threats in §10.2 of the specification that concern this step's idea, with inputs of its
own. Fix what it finds or record it under "Think it through".

Finish by telling the human exactly what to do next, because these are outside this
folder and are theirs to do: add this step's rows to `rules-met.md` beside the steps (a
rule keeps the row of the step where it first landed); in author mode, turn the step's
name into a link in the map and update its status line; update `docs/status.md` in the
repository, where a learner copy is listed as a learner build and never as the step
itself; record any question the specification leaves open in
`research/open-questions.md`; run `pnpm guard` and `pnpm check` at the repository root;
commit on a branch and open a pull request with one step in it.

## Learner mode

The learner is here to understand, not to receive a folder.

- **Stop after each section of this skill** and wait for the learner.
- **Teach before code.** After section 1, ask the learner to read the linked spec
  section, then teach the idea and quiz them. Write the README's "In plain words" and
  "Why it matters" before the first test.
- **Design before code.** Then write "The design, before any code" with the learner:
  split each rule into claims, list the decisions the specification leaves to the step
  and the downside of each, name the tests by claim, and record the learner's prediction
  for each break. Section 3 checks this design against the specification before the
  first test.
- **Explain before each file**, in two or three plain sentences, and wait for "go".
- **Ask before you tell.** Before running a test, ask what they expect, even which new
  tests will pass before any code exists. Before the break-it exercise, ask them to
  predict the failure.
- **Let them type** when they want to: "Do you want to write this test yourself? I
  will review it."
- **Do not open the finished official step** until the learner asks to compare. Then
  run `git diff --no-index` between the two folders and explain which differences
  matter and which are style.
- One step per session. When `pnpm check` is green, ask the step's "Check yourself"
  questions and stop. Suggest `/clear` before the next step.
