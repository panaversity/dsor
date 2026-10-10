# Step 18 · Delegations

Folder: [`my_18_delegations`](../my_18_delegations/README.md) · 645 tests, plus 51 in
the database tier
Spec: [§13](../../../specs/dsor/02-security.md#13-delegation),
[§13.1](../../../specs/dsor/02-security.md#131-authority-of-the-delegation-record) · `DSOR-DEL-01a`,
`DSOR-DEL-01b`, `DSOR-DEL-02`, and `DSOR-SRC-02b` for a slip named in the arguments
The database tier, 51 tests, passes on a local PostgreSQL 17 set up like Neon, fourteen migrations
applied, on the final code; on Neon, `dsor_step18` waits for this folder's `.env`. Decisions [127](decisions.md) and [128](decisions.md).

## What the step is

The permission slip. `user_123` signs `del_100` for `accounts-payable-fte`: issue invoices, make and
cancel payments, up to 50,000.00 USD a payment, until the end of 2099. The agent's own role now only
reads; every command it sends runs under its slip, which DSoR finds itself, and its power for that
command is computed at the decision: the slip's permissions, cut down to what the signer holds in
that company right then, and to the login's scopes, which only ever narrow.

## How it was built

Built on the learner's standing instruction while they slept: the problem stated first, and every
decision taken with the recommended option ([decision 127](decisions.md)), each open to reversal.

Then the copy, its markers made plain, and the pieces, each red first, committed alone, and broken on
purpose:

1. **The slip, in DSoR's own store.** Migrations 013 and 014; start-up knows five tenant tables and
   refuses an application that may write a slip.
2. **An agent's command runs under its slip.** The stage at §21.3, the role source, the scopes, the
   agent's role reduced to reading, and authorize's proof that the stage did its work.
3. **Up to the slip's limit.** A stage at §21.10, in cents, restrictive across currencies.
4. **A slip named in the arguments** is a claim, refused when it disagrees.
5. **The demo**, and two comments that had promised the slip.

## What the build found

**A command in org_789 needed a signer there.** The cross-tenant suite sends every command into
org_789, and nobody in the story belongs to org_789, so no slip there could lend anything. The test
makes a signer for itself through the role source's seam, with a slip in org_789's name.

**A limit compared as text would have passed every test.** Found planning the breaks: "100000.00"
sorts before "50000.00", so a comparison of the text refuses 50,000.01 and 60,000.00, as the tests
asked, and lets 100,000.00 through. A test of 100,000.00 came first, and its break is in the README.

**A stage that did nothing would have passed authorize.** An agent's command that reaches §21.5 with
no slip resolved would have been judged by the agent's own role. The stage is required by name, and
authorize refuses such a command as `INTERNAL_ERROR`, with a test that lazies the stage.

**The specification's slip expires in 2026.** Copied as it is, the tutorial would have stopped
working on 1 January 2027. `del_100` here expires at the end of 2099, and the tests that need an
expired slip make one.

**Two comments promised the slip to the wrong steps.** `login.ts` said it arrives in step 18, which
it has; `audit.ts` promised delegation to step 42, which builds none.

## Limits, stated

- The decision record says the agent acted for itself; step 19 records the mode, the subject and
  the slip.
- The signer's permissions come from this program's own people, which a running program never
  changes; step 19's directory can be out of date, or down.
- No limits over a day, no time windows, no approved vendors only: steps 24 and 32.
- No operation signs, suspends or revokes a slip; revoking is step 25's.
- The limit finds a payment's amount by the argument's name, `amount`. A contract names its input
  schema and not its fields, so nothing can check that a later command names its money so.
- `LIMIT_EXCEEDED`'s retry class is `after_delay`, the specification's, which fits a daily total;
  for a limit on one payment, waiting changes nothing.
- A malformed scopes claim is counted, not recorded, like every refusal at §21.1.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found no way for the agent to hold more than
its signer holds now: scopes cannot widen anyone, the slip comes only from DSoR's store, and a slip
in another company, or a signer the role source does not know, grants nothing. It found four ways
past a slip's expiry or its limit, each reproduced, and all four were fixed on the learner's standing
instruction, with the recommended option, as [decision 128](decisions.md), each red first and each
in a commit of its own:

- **An expiry the program could not read counted as not expired:** `-infinity`, and a year after
  9999, because `NaN <= now` is false.
- **A slip or a signer that could not be read left the door as a thrown error**, with nothing
  recorded. With the database down, the agent got a stack trace where a person got an envelope.
- **Two active slips, and DSoR took the first.** With the index dropped, a slip with no limit beside
  del_100 let 60,000.00 USD through.
- **A helper function's owner was asked only about the log**, so a helper that may update the slips
  lifted del_100's limit. The payments and the invoices had the same gap.

And four more: a payment over the limit is refused with `LIMIT_EXCEEDED`, the specification's code,
not `AUTHORIZATION_DENIED`; the commands' contracts said no slip was needed, found while answering;
four refusals had no test; and decision 127, migration 014 and five comments said things that were
not true.

Three were written down instead: the limit finds the money by its name, `amount`; a slip named
`delegationId` in the arguments passes, and nothing reads it; and a malformed scopes claim is
counted, not recorded, like every refusal at §21.1.

Eleven breaks, one or more per fix, each broken once, in a copy, on the whole suite, with the
prediction written first ([decision 128](decisions.md) has the table). All eleven failed exactly as
predicted. The README's eight were measured twice, and the two runs agreed; one of them, the
signer's permissions forgotten, failed four tests where three were predicted, because two of the
demo's tests notice the payment that should have been refused.
