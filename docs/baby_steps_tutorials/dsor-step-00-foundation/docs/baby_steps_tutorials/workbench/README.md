# Workbench

This folder is yours. Build your own version of each step here, then compare it with
the finished step next door. Everything you put here is ignored by git, except this
file.

```text
workbench/
  00_foundation/     your attempt at step 00
  01_one_invoice_in_memory/
  ...
```

## How to use it

1. Start Claude Code from the repository root and ask for a step in **learner mode**.
   Each step's README has the exact prompt under "Build it yourself with Claude Code".
2. Workbench steps are not part of the project's pnpm workspace, so install inside the
   step with one extra flag:

   ```bash
   cd docs/baby_steps_tutorials/workbench/00_foundation
   pnpm install --ignore-workspace
   pnpm check
   ```

3. To start step NN, copy **your own** step NN−1, not the finished one. Your steps are
   cumulative too.
4. Compare with the finished step when yours passes:

   ```bash
   git diff --no-index docs/baby_steps_tutorials/00_foundation docs/baby_steps_tutorials/workbench/00_foundation
   ```

If you get badly stuck, copy the finished previous step into the workbench and carry on
from there. Moving forward matters more than a perfect record.
