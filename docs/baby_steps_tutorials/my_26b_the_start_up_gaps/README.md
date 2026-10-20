# Step 26b · The start-up gaps

**New in this step:** when the program starts, it asks the database about every way its login could
write, read or number things past its rights, not only the obvious ones.

## In plain words

Every time this program starts, it asks the database one question in many forms: "what may my own
login do?" If the answer is too much, it refuses to start. Since step 09 it has asked whether the
login may rewrite the log; since step 11, whether it can skip the second lock; since step 17,
whether it may change a payment it should only create. The login is `dsor_runtime`, and the person
who sets it up is a database administrator. The agent never touches any of this.

Steps 18, 22 and 25 found four questions nobody had asked, and wrote them down (decision 145). Each
one is a door an administrator can open by mistake, with one grant or one line of SQL. This step
asks all four:

- **A rule on a tenant table.** A rule is code the table's owner attaches to it, like a trigger. It
  runs inside this program's own statements, with the owner's rights. Start-up asked about triggers
  and never about rules.
- **A view the program may write through.** A view is a saved query that looks like a table. It
  runs with its owner's rights. Start-up asked whether the program may *read* a view, never whether
  it may *write* through one.
- **A view the program may read another way.** Start-up asked whether the login itself may read a
  view. It never asked a role the login can become with one `SET ROLE`, a helper function's owner, or
  a grant on some of the view's columns only.
- **A number the program may set.** PostgreSQL hands out numbers from *sequences*: PAY-902, `prop_1`,
  `ctl_1`. Start-up asked about the payments' sequence only. The program should take the next number
  and never choose one.

Each question is asked the same way: of the login itself, of every role it can become, and of every
helper function's owner. And each looks at every relation by what it is, not by what its schema is
called.

## Why it matters

Each of these was measured, with start-up content every time:

- **A rule** on the invoices that inserts a slip: an ordinary `invoice.issue` signed a new
  permission slip, with no limit at all, for an agent nobody named.
- **A view** over the slips, with INSERT granted and no SELECT: the program wrote itself a slip.
  The same view over the log, with UPDATE: one statement rewrote every company's records, and with
  DELETE, one statement erased them.
- **A view** over every company's invoices, readable one `SET ROLE` away, or through a helper, or by
  two of its columns: both companies' INV-1008, through a lock that should show one.
- **`setval`** on the proposals' sequence chose prop_4999 for the next proposal.

None of these needs a clever agent. Each needs one careless grant, and decision 119 builds this
program against a careless administrator, not only a careful one.

## What changed since step 26

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_26_money_done_right ../my_26b_the_start_up_gaps
```

| File | What |
| --- | --- |
| `src/database.ts` | four new questions at start-up: a rule on a tenant table; a write to anything beside the tenant tables; the read question asked of every role and by column; every sequence, by `setval` and by owner. Relations are chosen by what they are, not by their schema's name |
| `test/start-up-gaps.test.ts` | new — each gap measured first, then refused: rules on all eleven tenant tables, write-only views over the slips and the log, side tables, three ways round the read question, two schema names that looked like PostgreSQL's own, and every sequence |
| `package.json` | the step's name |

The demo does not change. Nothing in it is a database administrator's mistake.

## Run it

```bash
pnpm install
pnpm test test/start-up-gaps.test.ts
```

```text
 ✓ test/start-up-gaps.test.ts > a rule on a tenant table > DSOR-DEL-01a: a rule that signs a slip inside the application's own invoice.issue is refused
 ✓ test/start-up-gaps.test.ts > a rule on a tenant table > DSOR-EXE-02: a rule on dsor.audit is refused, whatever it does
 ✓ test/start-up-gaps.test.ts > a view the application may write through > DSOR-DEL-01a: a view over the slips that the application may write through, and not read, is refused
 ✓ test/start-up-gaps.test.ts > a view the application may write through > DSOR-AUD-04a: a view over the log that the application may update, and not read, is refused
 ✓ test/start-up-gaps.test.ts > a view the application may read some other way > DSOR-TEN-01b: a view readable one SET ROLE away is refused
 ✓ test/start-up-gaps.test.ts > a schema that only looks like one PostgreSQL keeps for itself > DSOR-TEN-01b: a view over every company's invoices in pgxtemp is refused
 ✓ test/start-up-gaps.test.ts > a number the application may set > an application that may set dsor.proposal_numbers is refused at start-up
 ✓ test/start-up-gaps.test.ts > a number the application may set > taking the next number, which the application must, does not refuse start-up
   … 26 more
 Test Files  1 passed (1)
      Tests  34 passed (34)
```

What start-up says, as the program would print it and stop, for three of them:

```text
a rule on the invoices:
  a tenant table has a rule on it, and this program expects none: a rule rewrites this program's
  own statements, or adds statements of its own, with the table owner's rights — a rule on the
  invoices can sign a permission slip inside an ordinary invoice.issue, and one that does nothing
  instead can swallow a record of the log. Drop the rule, or change this check deliberately.

a view over the slips the application may write through:
  this connection is `dsor_runtime`, and it may write to `public.slip_desk`, which is not one of
  the tenant tables, itself, one SET ROLE away, or through a helper function. A view runs with its
  owner's rights, so a view the application may write through is a way past every question above,
  even one it may not read. The application writes public.invoices, public.vendors,
  public.payments, dsor.audit, dsor.delegations, dsor.idempotency_keys, dsor.proposals,
  dsor.proposal_moves, dsor.day_totals, dsor.reservations and dsor.agent_controls, and nothing else.

a proposal's number the application may set:
  this connection is `dsor_runtime`, and it may set the next number of `dsor.proposal_numbers`,
  itself, one SET ROLE away, or through a helper function: setval needs UPDATE on a sequence, and
  ALTER SEQUENCE needs its owner. A payment's, a proposal's and a brake's number, and the place of a
  proposal's move, are the database's to give. The application takes the next number, and sets none.
```

### The database tier

`pnpm check` needs no server. The seventy-five tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_26_money_done_right/.env .env     # then dsor_step26 -> dsor_step26b in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step26b` through the owner
login. This step adds no migration. The tier matters here for one reason: `test/audit.db.test.ts`
opens the program against the real server, so every new question is asked of a real Neon database,
and a question that refused a real setup would fail it. Run on Neon on 2026-10-19, on `dsor_step26b`:
75 passed, and 75 again after the review's fixes.

## Break it

Three, each measured on the full suite in a copy outside the repository, where one test skips
because the specification is not beside it.

### Break 1 · rules are not asked about

In `src/database.ts`, change `if (answer.has_rule !== false) {` to
`if (false && answer.has_rule !== false) {`.

```text
      Tests  12 failed | 1100 passed | 1 skipped (1113)
```

The rule that signs a slip inside `invoice.issue`, and a rule on each of the eleven tenant tables:
the program starts with every one of them in place.

### Break 2 · the write question asked of the program alone

In the question about writing beside the tenant tables, ask `current_user` in each clause instead of
`${role}`, the role the helper `forAnyRoleItCanActAs` hands it.

```text
      Tests  2 failed | 1110 passed | 1 skipped (1113)
```

The view written one `SET ROLE` away and the one written through a helper's owner. Every other
case is the program's own grant, which the narrower question still sees: this is the gap decision 126
measured in step 17, for the business's tables, met again.

### Break 3 · schemas skipped by their names

Put back step 26's filter: skip `pg_catalog` and `information_schema` by name, and `LIKE
'pg_toast%'` and `LIKE 'pg_temp%'`.

```text
      Tests  2 failed | 1110 passed | 1 skipped (1113)
```

A view over every company's invoices, in `information_schema` and in a schema named `pgxtemp`, which
`LIKE 'pg_temp%'` matches because `_` matches any character. The review found both (decision 163).

## Build it yourself with Claude Code

Copy `my_26_money_done_right` to a new folder, without its `.env`, and ask:

> Start step 26b, the start-up gaps. Before any code: show me each of the four gaps decision 145
> wrote down, as a measured attack with start-up content. Then ask me the step's decisions one at a
> time. Then close them a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. The program may not read the view `public.slip_desk`. Why can it still harm the slips through it?
2. Why is a rule on a tenant table refused even when it does nothing at all?
3. The program may take numbers from `dsor.proposal_numbers`. What may it not do, and why does it
   matter?
4. A view sits in a schema named `pgxtemp`. Why did the old question skip it?

<details>
<summary>Answers</summary>

1. A view runs with its owner's rights, and INSERT, or UPDATE and DELETE with no WHERE, need no
   right to read. Through the view, the program wrote itself a slip.
2. "Does nothing" is `DO INSTEAD NOTHING`: it swallows the program's write and says nothing. On the
   log, a decision the program believes recorded is not there.
3. It may not set the next number, backward or forward, with `setval` or `ALTER SEQUENCE`. Taking
   numbers one by one only moves forward; setting one lets the program choose a number it should be
   given.
4. `LIKE 'pg_temp%'` reads `_` as "any one character", so `pgxtemp` looked like a temporary schema.
   Start-up now chooses relations by what they are, not by their schema's name.

</details>

## The rules this step meets

- **[DSOR-TEN-01b · L1]** Tenant isolation MUST be enforced in at least two independent layers — here,
  that the second layer has no window: no view readable another way, and no rule running past it.
- **[DSOR-AUD-04a · L1]** The DSoR runtime identity MUST NOT be able to update or delete audit
  records — now through a view as well.
- **[DSOR-DEL-01a · L1]** A command from an agent MUST be evaluated under an active delegation held in
  the store — one a person signed, not one the program wrote through a view or a rule.
- **[DSOR-EXE-02 · L1]** The decision MUST be durably recorded — no rule may swallow it.

**What this step leaves, said plainly.** Start-up refuses; it never repairs the database. The
question about helper functions still skips `pg_catalog` and `information_schema` by name, unchanged
from step 17. A row trigger on a table that *inherits* from a tenant table fires under the program's
UPDATE of the parent, and the trigger question looks at the tenant tables themselves only (decision
163); it needs the owner's hand, as all of these do. The READMEs of steps 18, 22 and 25 say these
gaps close in step 26; they close here (decision 159). Everything earlier steps claimed still holds.

**Next:** step 27, `controls_in_cel`: the policy "payments above 25,000 USD need the CFO", written
as a rule in CEL, a small safe expression language, and checked at every payment.
