# Step 00 · The foundation

**New in this step:** Node.js, TypeScript, pnpm, vitest. Nothing here is about DSoR yet.

## In plain words

Before you build a house you pour a floor. This step is the floor. It is a tiny
TypeScript project with one function, one program that runs it, and two tests. It
proves that your tools work. Every one of the next 51 steps begins as a copy of the
step before it, so everything in this folder travels with you to the end.

## Why it matters

When a test fails in step 20, you need to know the cause is your new code and not your
setup. If this step runs on your computer, you can trust the tools and think only about
the ideas.

This step also sets four habits that the rest of the tutorial depends on:

1. **Small pure functions.** `greet` takes an input and returns an output. It reads
   nothing else and changes nothing else. Almost every check DSoR makes will be built
   from functions like this, because they are easy to test.
2. **Test the "no" as carefully as the "yes".** There is a test for the greeting and a
   test for the refusal. From step 06 onward, most of what DSoR does is refuse things.
3. **Strict TypeScript.** The compiler is set to complain early, and every exported
   function states its return type.
4. **No build step.** Node runs the `.ts` files directly.

## What is in this folder

```text
00_foundation/
  package.json       the project: its name, its scripts, its three tools
  tsconfig.json      how strict TypeScript is. Every setting has a comment
  vitest.config.ts   tells the test runner where this step's tests live
  src/greet.ts       one pure function
  src/main.ts        a program that calls it
  test/greet.test.ts two tests: one "yes", one "no"
```

## Run it

You need **Node.js 22.18 or newer** (24 is what the project's CI uses) and **pnpm**.

```bash
node --version             # v22.18 or higher
corepack enable            # gives you pnpm; or: npm install -g pnpm
```

From the repository root, install once. This installs every step and package:

```bash
pnpm install
```

Then, in this folder:

```bash
cd docs/baby_steps_tutorials/00_foundation
pnpm start                 # prints: Hello, accounts-payable-fte.
pnpm test                  # 2 tests pass
pnpm typecheck             # prints nothing, which means no type errors
pnpm check                 # typecheck, then test. Run this before you call a step done
```

You can also copy this one folder anywhere outside the repository and run
`pnpm install && pnpm check` there. Every step installs and runs by itself.

### Why the imports end in `.ts`

Look at the first line of `src/main.ts`: `import { greet } from "./greet.ts"`. Node can
run a TypeScript file by deleting the type annotations and running what is left. It
does not rename files, so the import has to name the real file, `greet.ts`. Three
settings in `tsconfig.json` keep our code inside what Node can delete. The payoff is
that there is never a build step between you and your running code.

## Break it

Do both. Each takes a minute, and each shows you what a tool is for.

**1. Break the behaviour, and let a test catch it.** In `src/greet.ts`, change
`Hello` to `Hi`. Run `pnpm test`:

```text
Expected: "Hello, accounts-payable-fte."
Received: "Hi, accounts-payable-fte."
Tests  1 failed | 1 passed (2)
```

The test knew what the function promised. Change it back.

**2. Break the types, and let the compiler catch it.** Change the last line of
`greet` to `return name.length;`. Run `pnpm typecheck`:

```text
src/greet.ts(9,3): error TS2322: Type 'number' is not assignable to type 'string'.
```

The function promised a `string`. You never even ran the code. Change it back, and run
`pnpm check` to confirm everything is green again.

## Build it yourself with Claude Code

This folder is the finished step. To learn more, build your own copy and compare.
Start Claude Code from the **repository root**, so it loads the project's instructions
and skills:

```bash
cd dsor
claude
```

Then paste this prompt:

```text
Use the build-baby-step skill in learner mode. Build step 00 (the foundation) in
docs/baby_steps_tutorials/workbench/00_foundation. Do not look inside
docs/baby_steps_tutorials/00_foundation until I ask you to compare. Explain each file
before you create it, and wait for me to say "go" before each one.
```

When your copy passes `pnpm check`, ask:

```text
Compare my workbench/00_foundation with the finished 00_foundation and explain every
difference. Which differences matter, and why?
```

The general directions are in the
[tutorial overview](../readme.md#build-the-steps-with-claude-code).

## Check yourself

1. What makes `greet` a *pure* function? Name one thing it would have to do to stop
   being pure.
2. Why is there a test for the empty name? What would you not know without it?
3. `pnpm test` passed and `pnpm typecheck` failed. Is the step done?
4. Why do the imports end in `.ts` and not `.js`?

<details>
<summary>Answers</summary>

1. Its result depends only on its argument, and it changes nothing outside itself.
   Reading a file, the clock, or a global variable, or writing to a log, would end that.
2. It proves the refusal works. Without it you would only know the function says yes
   to good input. You would not know it says no to bad input.
3. No. A step is done when `pnpm check` passes, and that runs both.
4. Node runs the TypeScript file itself and does not rename anything, so the import
   must name the file that really exists.

</details>

## The rules this step meets

None yet. This step is only the floor. The first rule of the specification arrives in
step 01: money is an amount *and* a currency, written as a decimal string
(DSOR-MON-01).

**Next:** step 01, one invoice in memory.
