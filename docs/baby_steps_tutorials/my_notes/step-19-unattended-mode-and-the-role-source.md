# Step 19 · Unattended mode and the role source

Folder: [`my_19_unattended_mode_and_the_role_source`](../my_19_unattended_mode_and_the_role_source/README.md)
· 673 tests, plus 51 in the database tier
Spec: [§12.1](../../../specs/dsor/02-security.md#121-role-source),
[§13.2](../../../specs/dsor/02-security.md#132-identity-modes-on-the-wire) · `DSOR-DEL-07`,
`DSOR-DEL-08`, `DSOR-IDN-05`, `DSOR-IDN-06`, and `DSOR-DEL-10` for what the record says
The database tier, 51 tests, passes on a local PostgreSQL 17 set up like Neon, seventeen migrations
applied, on the final code; on Neon, `dsor_step19` waits for this folder's `.env`. Decisions
[129](decisions.md) and [130](decisions.md).

## What the step is

At 2 a.m. nobody is logged in. An agent's command under a slip is `unattended`: the slip must allow
that mode, the decision's subject is the slip's signer, taken from the slip and never from the
request, the agent is in the actor chain, and the slip is named on the record, inside the hash. What
the signer holds is asked of the company's directory at every decision, a fake one per company. A
directory that does not answer, or none at all, refuses the command with `DEPENDENCY_TIMEOUT`; an
answer more than 24 hours old, dated in the future, or without a time zone, with
`FRESHNESS_UNSATISFIABLE`.

## How it was built

Built on the learner's standing instruction while they slept: the problem stated first, and every
decision taken with the recommended option ([decision 129](decisions.md)), each open to reversal.

Then the copy, its markers made plain, and the pieces, each red first, committed alone, and broken on
purpose:

1. **A slip says in which modes it may be used.** Migration 015, and §21.3 refuses a slip that does
   not allow `unattended`.
2. **The role source is the company's directory.** `directory.ts`, and `authority.ts` rewritten to
   ask it, refusing no directory, no answer, and an old one. Step 18's seam went everywhere at once:
   the tests and the demo that changed what `user_123` holds now say so in the directory.
3. **The record says whose authority the agent used.** Migration 016, the record's identity and its
   slip.
4. **The demo**, and then the printed log, which said `user_123` on every one of the agent's
   payments, with nothing to tell them from `user_123`'s own.

## What the build found

**The printed log could no longer tell the agent from the person.** Once the record's subject was
the slip's signer, the demo's log showed `user_123` on the agent's payments. Each unattended line now
ends with who acted, and under which slip.

**A test said no refusal in the demo invites a retry.** The directory's refusal does, and rightly: the
same request goes through once the directory answers. The test says that now.

## Limits, stated

- The directory is a fake in memory; a real one is a directory sync or an identity provider.
- A person who is logged in is judged by this program's list, the slip's signer by the directory: two
  sources for one person, until a real login in steps 43 and 44.
- `subject_authority.as_of` has no way to say an authority was never established; such a refusal
  carries the decision's own time. A question for the specification.
- When the directory says a signer left, DSoR refuses the agent but does not suspend the signer's
  slips (`DSOR-IDN-07`).
- An agent's reads run under its own role, with no slip, recorded `direct`.
- `on_behalf_of` is step 45's.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found the subject taken only from the stored
slip, planted fields changing nothing, the right company's directory asked, nothing cached, and the
slip inside the hash. It found three broken guarantees, each measured, and all three were fixed on the
learner's standing instruction, with the recommended option, as [decision 130](decisions.md), each
red first and each in a commit of its own:

- **A future-dated answer counted as fresh**, and one with no time zone was read in the host's zone,
  so west of UTC a 30-hour-old answer passed; a year past 9999 broke the record's own schema check.
- **Refusals after DSoR found the slip were recorded as the agent acting for itself**: the mode, the
  expiry, and the directory's three refusals.
- **An UPDATE granted on one column of the log passed start-up**, and changed a record's slip.

And: a slip allows `unattended` only when it says so, and none is signed by its own agent; tests for
malformed answers, odd times, planted identity in the login, and every command for a company with no
directory; and seven comments, decision 129 among them, that said what was not true.

Five were written down instead: two sources for one person, `DSOR-DEL-07` claimed for commands,
the fake directory standing in for configuration, the two clocks, and modes that may repeat.

Nine breaks, one or more per fix, each broken once, in a copy, on the whole suite, with the prediction
written first ([decision 130](decisions.md) has the table). All nine failed as predicted. The README's
six were measured twice, and the two runs agreed; one, an answer of any age, failed four tests where
five were predicted, because a payment let through is recorded with the directory's time too.
