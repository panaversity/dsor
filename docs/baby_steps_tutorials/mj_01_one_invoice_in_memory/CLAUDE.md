# Working in a DSoR baby step

You are inside one step of the DSoR baby-steps tutorial. This folder is a complete,
self-contained project. It is **teaching code** for students and junior developers:
the clearest version wins over the fastest or the most general.

- **The map of all steps** is `../readme.md` when this folder sits inside the dsor
  repository. Otherwise it is
  <https://github.com/panaversity/dsor/blob/main/docs/baby_steps_tutorials/readme.md>.
- **The specification** is `../../../specs/dsor/` inside the repository, and the rule
  registry is `../../../packages/spec/requirements.json`. Otherwise use
  <https://github.com/panaversity/dsor/tree/main/specs/dsor>.
- **Load the `build-baby-step` skill** before you build, change, or review a step. It
  travels with every step in `.claude/skills/`.

## Rules that never change

1. **One new idea per step.** If the work needs two, stop and say so.
2. **Write only inside this folder.** Earlier steps are finished. Never edit them, and
   never edit the repository around this folder from a step session.
3. **Tests first, titled by rule id**, for example
   `DSOR-EXE-02: a denied command is recorded before the response`. Test the refusal as
   carefully as the success.
4. **No build step.** Node runs the `.ts` files directly, so imports between files end
   in `.ts`, and only TypeScript syntax that Node can erase is allowed.
5. **Money is never a `number`.** It is `{ value: "31400.00", currency: "USD" }`.
6. **Output over claims.** Run `pnpm check` and report what it printed. Never say
   "this should pass".
7. **Never read or print `.env`.** Ask the human to confirm a variable is set.
8. **One story.** `org_456`, `user_123`, `accounts-payable-fte`, `cfo_100`, `VENDOR-44`,
   `INV-1008`, `PAY-901`, 31,400.00 USD.

## Commands

```bash
pnpm install      # installs this step only
pnpm start        # runs src/main.ts
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm check        # typecheck, then test. A step is done only when this is green
```
