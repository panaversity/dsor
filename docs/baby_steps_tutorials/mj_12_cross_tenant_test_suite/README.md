# Step 12 · The cross-tenant test suite

**New in this step:** one test, generated from the list of operations, calls every
operation with another company's URI, and grows by itself each time an operation is added
(DSOR-TEN-02b).

## In plain words

Steps 10 and 11 keep each company's data away from the others, and tests prove it for the
two operations that exist. But each of those tests exists because someone wrote it. This
step writes one test that cannot forget. It walks the **registry**, step 03's list of
every operation, and attacks each operation it finds there:

```text
a normal request      invoice.get  { invoice: "dsor://org_456/invoice/INV-1008" }
the company swapped   invoice.get  { invoice: "dsor://org_789/invoice/INV-1008" }
the answer            TENANT_MISMATCH, no data
```

Think of step 10's bank teller, and a mystery shopper: a tester the bank sends in, posing
as a customer. For every service on the bank's list, the new ones too, the shopper hands
the teller a form that names another customer's account, and expects "not your account".
Then the shopper asks about their own account and opens the envelope: only their own
papers may be inside. The form tests the teller at the counter: DSoR's checklist, which
every call runs. The envelope tests the back office: each operation's own code, which a
refused form never reaches.

## Why it matters

**A new operation can leak, and every old test stays green.** Say someone adds
`invoice.peek`, which takes a bare `{ id }` and finds it in any company. The agent of
`org_456`, `accounts-payable-fte`, asks for `INV-1008` and gets `org_789`'s invoice:
99,000.00 USD from VENDOR-77. No existing test knows that `invoice.peek` exists, so none of
them fails. DSOR-TEN-02b asks for a test of every operation: "An implementation MUST ship
a cross-tenant test suite that exercises every operation with a foreign-tenant URI."

**A test can pass for the wrong reason.** Every call runs one checklist, numbered as §21
numbers it (step 07). Line ② checks the company the request names. Line ⑤ checks the
permission. Line ⑥ checks the input's shape. In this tutorial, the company inside a URI
is checked after lines ⑤ and ⑥ (step 10's decision 4). So when the agent sends
`org_789`'s URI to `invoice.issue`, line ⑤ refuses it, because the agent may not issue,
and the URI's company is never looked at. A suite that accepted any refusal would pass
without testing what it claims.

**The counter is not the whole bank.** The checklist refuses every foreign URI before
any operation's code runs. So a foreign URI never meets that code. Code that answers a
same-company request with another company's invoice is met only by a same-company
request, so the suite sends one too, and looks inside the answer.

**Common mistake:** a suite that silently skips an operation it cannot handle, such as
one with no example request. A skipped operation looks exactly like a tested one when
every test is green.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-30: §14 (DSOR-TEN-02b), §28 (DSOR-ERR-01b), §11 (DSOR-SRC-02b), §12
(DSOR-IDN-03b), and §21 on the order of the checklist. If the code finds the plan wrong,
the plan changes here first.

*Changed before the first test, 2026-09-30.* Checking this design against the code found
three gaps, and the learner chose each answer. `invoice.get` takes an invoice's URI and
nothing else (decision 1). The suite swaps one URI at a time (decision 3). Each attacker
first sends the example unchanged, so a refusal for any reason but the company cannot
pass (decision 8, claim C7). C2, C3, and C4 also gained tests.

*Changed after the review, 2026-09-30.* Two reviewers who had not seen the conversation
attacked the finished step. Fake operations that leak passed the suite, because the
checklist refuses every foreign URI before any operation's code runs. The learner chose
three changes. The same-company call's answer is searched for another company's data
(claim C8). The suite works in both companies, `org_456` and `org_789` (decision 9). And
it takes the call function as an argument, so a test can hand it a fake DSoR (decision
10). The analogy changed too, from a hotel inspector to the bank's mystery shopper. The
mutation sweep, which changed the code in 103 small ways, then showed that an example
naming an invoice its company lacks made the suite prove less, silently. So a query's
same-company call must now answer with data (decision 8).

*Changed by the Stage 2 review, 2026-10-01.* Six reviewers audited steps 10 to 14. Here
they planted operations that leak and still passed the suite with no finding: the other
company's invoice with its `tenant_id` rewritten to the caller's, the same invoice with
no `tenant_id`, a URI used as a key, a URI inside a sentence, a field named `tenantId`,
and a "not found" that says the invoice exists in another company. Four changes follow.
The whole answer is searched for the other company's **canaries**: values that only the
other company's rows hold, such as `VENDOR-77` (outcome 4, decision 8). Each query also
gets an **in-company pair**: its own company's URI sent twice, once with an id only the
other company holds and once with an id nobody holds, and the two answers must match
(C2). Four more fake DSoRs test the judge through the suite, one for each wrong reason to
refuse (C4, decision 4). And an answer of `{ data: undefined }` is no data. A
fifth change is outside the suite: a planted `test.free` proves through a call, again,
that the checklist searches the whole input for URIs. The review's fixes from steps 07 to
11 are carried here too ("Think it through").

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** No operation reaches callers without a cross-company test, because the test
is generated from the registry and nobody has to remember to write it. The analogy is
the bank's mystery shopper.

**Outcome.** What is true when this step is done:

1. For every operation in the registry, the suite sends its example request with one
   URI's company swapped, three ways. To `org_789` with the same id. To `org_789` with
   the id `NOPE`, which it does not have. And to `org_999`, a company that does not
   exist. Every answer is `TENANT_MISMATCH`, with no data. An example with two URIs is
   attacked one URI at a time.
2. The three answers are the same, word for word, apart from the request id.
3. Each attack is made by every principal who holds the operation's permission in the
   company the suite works in. The suite works in `org_456`, then in `org_789`. So
   `firm-ap-fte`, who belongs to both, attacks in each direction.
4. Before its attacks, each caller sends the example unchanged, in its own company: a
   **same-company call**. Its answer is not `TENANT_MISMATCH`, so the refusals come from
   the company that changed. A query's same-company call is answered with data, so the
   example names a thing that exists, in both companies. And its answer holds nothing of
   another company: no `tenant_id` and no URI of another company. *Changed by the Stage 2
   review, 2026-10-01:* those two signs missed leaks that do not label themselves. Now the
   whole answer is searched, every key and every text, in any letters, for three signs. A
   **canary** is a value in the other company's rows that this company's rows never hold,
   not even inside a longer value: for `org_456`, `VENDOR-77`, `99000.00`, `INV-2001`,
   `12500.00`, and `org_789`. Its own data can never hold one, so a canary in its answer
   came from the other company. A key with "tenant" in its name must hold this company's
   id. And a URI of another company may appear nowhere, not even inside a sentence. Data
   that is empty, such as `undefined`, `null`, or `{}`, is no data.
5. Nothing is skipped. These turn the suite red: an operation with no example, an
   example with no URI of its company, an example that leaves out a field its input
   schema lists, and an operation that nobody in the company may call.
6. **Planted** operations turn the suite red. A planted operation is a fake one, added
   only inside one test, to prove the suite would notice it. There are four: one that
   takes a bare `{ id }`, one that answers with every company's invoices, one that
   answers with the other company's, and one that keeps invoices in a cache keyed by id
   alone. *Changed by the Stage 2 review, 2026-10-01:* and the review's seven: the six
   leaks listed above, and one whose answer is `{ data: undefined }`.
7. `invoice.get` takes a canonical URI, `{ invoice: "dsor://org_456/invoice/INV-1008" }`,
   like `invoice.issue`. A URI that names anything but an invoice is refused at line ⑥.
8. The suite runs in `pnpm check`, with the invoices in memory, so CI, the checks GitHub
   runs on every push, runs it too. It runs again in `pnpm test:db`, where every
   same-company read goes through the database.

**Not the outcome of this step.** A fresh Neon branch made and deleted for each run, as
the map of all steps suggests (decision 7). Attacks that are not URIs, such as a company
in a field named `tenant`: step 10's tests cover those. Leaks that the example does not
reach (see "Left open").

**The success signals**, each a test that fails if this step's code is deleted:

- The suite's own count: it attacked exactly the operations the registry holds.
- The planted `{ id }` operation turns the suite red, with a finding that names it. A
  **finding** is one problem the suite names.
- Handed a fake DSoR that answers every request with data, as if step 10's URI check
  were gone, the suite names every attack.
- The planted operations that leak through a same-company call turn the suite red.
- A planted operation whose code refuses every request with `TENANT_MISMATCH`, its own
  company's too, turns the suite red.
- *Changed by the Stage 2 review, 2026-10-01:* handed a fake DSoR that refuses every
  foreign request for a wrong reason, such as `UNSUPPORTED_CAPABILITY`, the suite names
  every attack. And each of the review's planted leaks turns the suite red.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-30:

1. **DSOR-TEN-02b asks for every operation, with a foreign-tenant URI.** The suite
   covers every operation in the registry, the commands too. A command is refused
   before its code runs. In this tutorial's checklist, the URI's company is checked
   before "is it built?", so a command answers `TENANT_MISMATCH` too.
2. **The map's "Done when" says "adding a new operation without tenant checks makes this
   suite fail".** In this tutorial, the checklist checks every URI once, before any
   operation's code. A new operation cannot forget that check. What it can forget is to
   stay inside its company in its own code. The suite catches that only through what a
   same-company call answers (C8): a bare id, an answer with another company's data, a
   cache keyed by id alone. A leak that only another input would show is not caught.
   *Changed by the Stage 2 review, 2026-10-01:* two other inputs are now sent. For a
   query, the in-company pair names an id only the other company holds, then an id nobody
   holds (C2). Both answers are searched, and they must match. So code that answers the
   first with the other company's data is caught, and so is code whose two answers differ,
   such as a "not found" that says the id exists elsewhere. This runs in `org_456` only.
3. **The map says the suite "runs on a fresh Neon branch, so it can create two companies
   and destroy them".** The two companies already exist, written by step 10's migration.
   This step runs on the step's own branch, and makes no branch per run. That would need
   a Neon API key that can delete branches (decision 7).
4. **DSOR-ERR-01b** is checked again, now for every operation: the answer never tells
   whether the other company's thing, or the other company, exists. *Changed by the Stage
   2 review, 2026-10-01:* before that review, only the checklist's own refusal was
   compared, the one every foreign URI gets. Now each query's own "not found" is compared
   too, through the in-company pair (C2). It runs where an id exists that only the other
   company holds: in this story, from `org_456` only.
5. **The database run does not attack the database's lock.** A foreign URI is refused
   before any read, and the code hands the store the active company. So step 11's lock
   in the database never meets a foreign company. The database run proves that the same
   checks hold with the real store and the real log. Every same-company read goes through
   the database and answers with its own company's invoice. And every attack's record
   lands in the caller's company, under step 11's policy. *Changed by the Stage 2 review,
   2026-10-01:* the code no longer hands the store a company. It is given a store bound to
   the active company (step 10's decision 13), so it cannot name another one.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-TEN-02b | **C1.** Every operation in the registry is called with foreign-tenant URIs, one URI at a time, from both companies, and each answer is `TENANT_MISMATCH` with no data | The suite's findings are empty, and it attacked every operation in the registry |
| DSOR-ERR-01b | **C2.** The three foreign answers of an operation are the same, apart from the request id | Compared word for word, for every operation, caller, and URI. *Changed by the Stage 2 review, 2026-10-01:* and a query's own "not found". In the **in-company pair**, a caller sends its own company's URI twice: once naming an id only the other company holds, `INV-2001`, once naming an id nobody holds, `NOPE`. The two answers must be the same, apart from the request id and the id each one names. Only `org_789` holds an id that `org_456` lacks, so the pair runs from `org_456` only |
| DSOR-IDN-03b | **C3.** A principal who belongs to both companies, working in one, cannot reach the other | `firm-ap-fte` attacks from `org_456` and from `org_789` |
| DSOR-TEN-02b | **C4.** Nothing is skipped: every gap in an example, or no caller allowed, is a finding | A registry with each gap planted gives each finding. *Changed by the Stage 2 review, 2026-10-01:* and a refusal for the wrong reason is a finding inside the suite too, not only when the judge is asked alone: four fake DSoRs, which refuse every foreign request with `UNSUPPORTED_CAPABILITY`, `AUTHORIZATION_DENIED`, `VALIDATION_FAILED`, or `RESOURCE_NOT_FOUND`, are each named on all 27 attacks |
| DSOR-TEN-02b | **C5.** The suite notices an operation that takes a bare id | The planted `invoice.peek { id }` gives a finding |
| DSOR-EXE-02 | **C6.** Every attack leaves its record in the caller's company, with its operation, result, and reason | One record per attack, in the company it worked in, and none in the other |
| DSOR-TEN-02b | **C7.** The refusal is for the company, and for nothing else: the same-company call is not answered `TENANT_MISMATCH`, and a query's is answered with data | A planted operation that refuses everything as foreign, and a query whose example names a missing invoice, each give findings |
| DSOR-IDN-03b | **C8.** An operation's own code answers a same-company call with nothing of another company | The planted `invoice.dump`, `invoice.theirs`, and `invoice.cached` each give a finding. *Changed by the Stage 2 review, 2026-10-01:* so do five more that the old search missed: a rewritten `tenant_id`, no `tenant_id`, a URI as a key, a URI in a sentence, and `tenantId` |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **`invoice.get` takes a canonical URI:** `{ invoice: "dsor://org_456/invoice/INV-1008" }`.
   Step 02 gave every thing one address, and now every operation names the thing it works
   on the same way. The suite needs one trick: swap the company. The code reads the id
   out of the URI, and still reads only inside the active company, the one line ②
   checked. Only an invoice's URI is accepted. The input schema adds our own `/invoice/`
   part to the specification's pattern, so `dsor://org_456/vendor/VENDOR-44` is refused
   at line ⑥, before the code, as every input has been since step 07. *Downside:* step
   07's input `{ id }` changes, and every test and example that used it changes too. The
   schema holds a pattern of ours beside the specification's. `invoice.issue` still
   accepts a URI of any kind, until step 22 gives it code.
2. **Each operation has an example request in a file:** `examples/<operation>.json`,
   beside `contracts/` and `inputs/`. The suite reads it and checks it against the
   operation's input schema. The example must name every field that schema lists, so a
   field that may hold a URI is attacked too. An example file that no operation names is
   a finding too: most likely a name spelled wrong. *Downside:* one more file for each
   new operation. That is the point: the suite turns red until it exists.
3. **The swap goes three ways, one URI at a time.** The URI's company becomes `org_789`,
   with the same id. In this story `org_789` has an `INV-1008` of its own. Then the
   company becomes `org_789` with the id `NOPE`, which it does not have. Then the company
   becomes `org_999`, which does not exist. The other URIs in the example stay in their
   company, so each attack carries exactly one foreign URI. Swapping them all at once
   would let an operation that checks only its first URI pass. *Downside:* three calls
   for each URI, caller, and operation. And the suite never checks that `org_789` really
   has the same id (see "Left open").
4. **The only accepted answer is `TENANT_MISMATCH`, from callers who may call the
   operation.** For each operation, the suite finds in DSoR's own tables every principal
   whose roles in the company grant the operation's permission, and attacks as each of
   them. Any other answer, a refusal included, is a finding. *Downside:* an operation
   that nobody in `org_456`, or nobody in `org_789`, may call is a finding too. Its
   author must give some role its permission before it ships.

   *Changed by the Stage 2 review, 2026-10-01:* "a refusal included" was proven on the
   judge alone. Inside the suite, the judge met one fake DSoR, and it answers with data.
   So a suite whose check flagged only data, and let every refusal pass, passed every
   test. Now four more fakes each refuse every foreign request for one wrong reason:
   `UNSUPPORTED_CAPABILITY`, as if "is it built?" came before the URI check, then
   `AUTHORIZATION_DENIED`, `VALIDATION_FAILED`, and `RESOURCE_NOT_FOUND`. The suite must
   name all 27 attacks for each. A hostile pass on the first version found that one fake
   was not enough: a suite that let `RESOURCE_NOT_FOUND` pass, and only that, passed it.
   *Downside:* four more fakes to run.
5. **The suite is a function that returns findings,** and it never stops at the first
   one. The real test expects no findings. The test of the test runs the same function
   over a registry with planted gaps, and expects each gap named. *Downside:* the
   findings are text the tests must match, so their wording is part of the test.
6. **It runs in both tiers.** A tier is one kind of test run: the unit tests, which need
   no database, and the database tests. In `pnpm check`, the invoices come from memory,
   so CI runs the suite on every push. In `pnpm test:db`, the same suite runs with the
   database's store and log. *Downside:* the two runs share the suite, so a bug in it
   hides in both. And the database run does not attack the database's lock (point 5
   above).
7. **No throwaway Neon branch per run.** The suite runs on the step's own branch,
   `step-12`, where step 10's migration already made both companies. A branch per run
   would need a Neon API key in `.env`, and that key can create and delete branches and
   projects. *Downside:* the map's "fresh branch" is not done, and the branch's log grows
   with every run.
8. **Each attacker first sends the example unchanged, in its own company: a
   same-company call.** Its answer must not be `TENANT_MISMATCH` (C7). For a query, it
   must be data: then the example names a thing its company has, and, moved to the other
   company with the same id, a thing that company has too. So the first way of the swap
   really names something that exists. If it holds data,
   the data may hold no `tenant_id` and no URI of another company (C8). This is the only
   request that reaches an operation's code, so it is where the code's own mistakes
   show. *Downside:* one more call for each operation and caller. It sees only what the
   example asks for. And it knows two signs of a company, a `tenant_id` field and a URI:
   data that names a company another way passes. And a query's example must name a thing
   both companies hold, so the stored data must have one. A command is refused before its
   code runs until step 22, so its same-company call cannot answer with data yet. A query
   with no code yet is a finding too: it cannot answer with data.

   *Changed by the Stage 2 review, 2026-10-01:* the two signs became three, searched
   everywhere: every key and every text of the whole answer, a refusal's message too, in
   any letters. They are the canaries, a key with "tenant" in its name, and a URI of
   another company anywhere (outcome 4). The canaries come from the invoices in memory,
   and a database test checks that each company holds exactly those. The id that the
   request names in one of its URIs is not counted, because an answer may repeat what it
   was asked: `invoice.get`'s own `no invoice "INV-2001"` tells the caller nothing new.
   Only that id: a canary anywhere else in the request still counts. The in-company
   pair's answers are searched the same way. And an answer whose data is `undefined`,
   `null`, `{}`, `[]`, or `""` is no data. *Downside:* a value written another way, such
   as `99000` as a number, is no canary and passes. So does a fact worked out from the
   other company's rows, such as `held_elsewhere: true`. A canary can sit inside an
   unrelated text by chance, and that gives a false finding: noisy, never silent. And a
   field such as `tenant_name`, or a `tenant` that holds an object, must hold the
   company's id alone, or it is a finding.
9. **The suite works in both companies:** first in `org_456`, then in `org_789`. For
   `org_789`, the example's `org_456` URIs are rewritten to `org_789`, and the swaps go
   to `org_456`. So `firm-ap-fte`, who belongs to both, attacks each company from the
   other. And a cache keyed by id alone, filled in one company, is read from the other.
   *Downside:* 27 attacks instead of 15, and every operation needs a caller in both
   companies.
10. **The suite takes the call function as its last argument,** `call` unless a test
    hands it another. A test hands it a fake DSoR: one that answers every request with
    data, as if step 10's URI check were gone, or one whose three answers differ. So the
    suite's use of its judge and its comparer is tested, not only those two functions
    alone. *Downside:* one more argument, and a fake to read.

    *Changed by the Stage 2 review, 2026-10-01:* for the judge, that sentence became true
    only with the review. The one fake answered with data, so a check that flagged only
    data passed every test. The four fakes of decision 4 refuse for wrong reasons, and
    that check, or one that lets any single wrong code pass, now fails one of them.

### The tests, by claim

- **C1:** the suite over the shipped registry gives no findings, and attacked both
  operations from both companies: 27 attacks, each with its own request id. Handed a fake
  DSoR that answers every request with its company's invoice, as step 10's missing URI
  check would, it names all 27. The swap of an example with two URIs gives six requests,
  each with exactly one foreign URI, and the suite sends all six. A URI inside a list is
  swapped too. A text that only contains a URI is not a URI, and is not swapped.
- **C2:** the three answers of each operation, caller, and URI, with the request id
  taken out, are equal. The comparer, handed three answers whose messages differ, names
  a finding. *Added before the first test:* without it, a suite that never compares
  stays green. And a fake DSoR whose three answers differ gives one finding for each
  caller and URI. *Added after the review:* without it, the suite's call to the comparer
  could be deleted, and every test stayed green. *Changed by the Stage 2 review,
  2026-10-01:* in `org_456`, each of the four readers of `invoice.get` sends the
  in-company pair, and the callers in `org_789` send none. The pair's comparer sets
  aside each answer's own id. A planted `invoice.hint`, whose "not found" says the invoice
  exists in another company, gives one finding for each reader in `org_456`. A planted
  `invoice.fallback`, which answers an id it lacks with the other company's invoice,
  gives two: each answer of the pair is searched.
- **C3:** the attackers are exactly the principals who hold the permission. In
  `org_456`: for `invoice.get`, `accounts-payable-fte`, `cfo_100`, `firm-ap-fte`, and
  `user_123`; for `invoice.issue`, `user_123` alone. In `org_789`: `firm-ap-fte` and
  `user_700`, for both.
- **C4:** planted registries: an operation with no example file, an example that is not
  JSON, an example whose only URI is `org_789`'s, an example that fails its own input
  schema, an example that leaves out a field its schema lists, and an operation whose
  permission no role grants. Each gives the findings that name the operation and the
  gap. An example file that no operation names gives one finding. And the suite's judge,
  handed an answer of `AUTHORIZATION_DENIED`, `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`,
  or a success with data, names each one as a finding: a refusal for the wrong reason is
  not a pass. *Added before any code, 2026-09-30:* the learner's prediction for break W3
  showed that without it, nothing would catch a suite that accepts any refusal. *Changed
  by the Stage 2 review, 2026-10-01:* four fake DSoRs, each answering every foreign
  request with one wrong code, make the suite name all 27 attacks, the first three typed
  out.
- **C5:** a planted `invoice.peek` with input `{ id }` gives the finding "no URI of
  org_456 in its example".
- **C6:** in the database tier, after the suite, each company holds one record for each
  attack made in it: `DENY`, `TENANT_MISMATCH`, the operation, and the reason. The other
  company holds none of them.
- **C7:** a planted operation whose code refuses every request with `TENANT_MISMATCH`
  gives one finding for each caller, in each company. A planted query whose example names
  `INV-2001`, which only `org_789` has, gives a finding for each caller in `org_456`.
  One whose example names `INV-9999`, which nobody has, gives one for each caller in both.
  *Added after the sweep.* *Changed by the Stage 2 review, 2026-10-01:* a planted query
  whose code answers `undefined`, `null`, `{}`, `[]`, or `""` gives one finding for each
  caller, in each company.
- **C8:** the planted `invoice.dump`, which answers with every company's invoices,
  `invoice.theirs`, which answers with the other company's, and `invoice.cached`, which
  keeps invoices in a cache keyed by id alone, each give findings. The data search,
  handed data with another company's URI deep inside it, names it. *Changed by the Stage
  2 review, 2026-10-01:* step 10's answer check, carried here, now refuses those three
  itself with `INTERNAL_ERROR`. So the suite names them because a query must answer with
  data. Five planted operations that pass that check give findings from the search:
  `invoice.rewritten`, `invoice.projection`, `invoice.keyed`, `invoice.sentence`, and
  `invoice.camel`. So does `invoice.noted`, whose example holds every canary in a note,
  and a fake DSoR whose same-company refusal names the other company's vendor. The search
  is also tested one sign at a time and at each sign's edge, each company's canaries are
  typed out, and an id the request names in its URI does not count. In the database tier,
  each company must hold exactly the invoices the canaries come from.
- **Decision 1:** `invoice.get` with `{ id }` is refused by line ⑥, and with its URI
  gives `INV-1008` of the active company. A vendor's URI is refused by line ⑥. The code,
  handed `org_789`'s URI while working in `org_456`, still reads `org_456`'s invoice.
- **Step 10's search, through a call.** *Added by the Stage 2 review, 2026-10-01:* a
  planted `test.free`, whose input allows a nested object and keys of any name, answers
  `TENANT_MISMATCH` for `org_789`'s URI deep inside it, and for one used as a key. The
  same shapes holding `org_456`'s own URI reach the code.

### Breaks we will try, and what we expect

W1 to W7 were run against the step before the review ("Break it"). W8 and W9 test the
changes the review brought. The learner's predictions were recorded before the code
they break.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| W1 | Step 10's URI check is taken out of the pipeline | the suite, for every operation, in both tiers | red for every operation, in both tiers |
| W2 | The suite stops after the first operation | only the count in C1 | only the count catches it |
| W3 | The suite accepts any refusal | C4's judge, handed a wrong-reason refusal | survives, unless a planted test (and there was none: C4 gained one) |
| W4 | The rule "an example must hold a URI of org_456" is removed | C5, the planted `{ id }` operation | red: example has no URI |
| W5 | The suite compares the three answers with the request id left in | a false alarm: every operation is a finding | not asked |
| W6 | The suite leaves out the same-company call | C7, the planted operation that refuses everything | only C7 |
| W7 | The swap changes every URI at once | C1's swap of a two-URI example | only the two-URI swap test |
| W8 | The same-company call's data is not searched | C8's planted operations | only the three planted leaks |
| W9 | The suite works in `org_456` only | C3's attackers in `org_789`, the count, and `invoice.cached` | only `invoice.cached` |

### Left open, and not this step's idea

- **A throwaway Neon branch for each run** (decision 7).
- **One database test alone guards step 11's helper.** Step 11 found that only one test
  catches a connection that goes back to the pool still holding a company. A second test
  belongs with the next change to that helper, `inCompany`.
- **The database tier in CI.** Steps 10 and 11's breaks that live in SQL are caught only
  by `pnpm test:db`, which CI does not run. This step puts DSoR's own check of every
  operation into CI. The database's lock still waits for a database in CI.
- **An operation whose input holds no URI.** Step 13 adds `invoice.list`, whose input
  may name no invoice at all. The suite will call that a finding, as outcome 5 says.
  Step 13 must decide how a list is attacked. The same-company call's data search
  (C8) is a start: a list must hold no row of another company.
- **Leaks the example does not reach.** The suite attacks what the example holds. It
  does not reach a bare id beside a URI, a URI used as the name of a field, or code that
  leaks only for an id another company has. *Changed by the Stage 2 review, 2026-10-01:*
  the last is reached now, by the in-company pair, from `org_456`. The suite still never
  swaps a bare id, or a URI used as a key. It notices such a leak only when the
  same-company call's answer holds something of the other company, which the search now
  finds whatever its label. And a call-level test proves that the checklist refuses a
  foreign URI used as a key, or deep inside an input.
- **`NOPE` may break a stricter input.** An operation whose input schema allows only ids
  like `INV-` and digits refuses `NOPE` at line ⑥, and the suite calls that a finding.
  The easy way to green is to loosen the schema, which is wrong. The example could name
  a missing id of its own. *Changed by the Stage 2 review, 2026-10-01:* the in-company
  pair sends `NOPE` too.
- **"The same id" is checked to exist for queries only.** A query's same-company call must
  answer with data in both companies (decision 8). A command's cannot yet, so for a
  command the first way of the swap may name nothing, and the comparison of the three
  answers then proves less. Step 22, which gives commands code, can close this.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup
itself, this way:

1. Create a branch `step-12` **from `step-11`**, with the Neon MCP server or with
   `neonctl branches create`. It carries step 11's roles, so the owner's password is the
   one you reset on `step-11`.
2. Write `.env` with `neonctl connection-string`, its output redirected into the file,
   never printed: the owner's string as `DSOR_MIGRATION_URL`, and the same string with
   the user `dsor_runtime` and a new random password (letters and digits) as
   `DSOR_DB_URL`. Both with `sslmode=verify-full`.
3. Run `pnpm migrate`. It sets `dsor_runtime`'s password from `DSOR_DB_URL`.
4. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 11

| File | What changed |
| --- | --- |
| `examples/invoice.get.json`, `examples/invoice.issue.json` | **New.** One example request for each operation (decision 2) |
| `test/cross-tenant.ts` | **New.** The suite: `attackersOf`, `judge`, `compare`, and `crossTenantSuite`, which returns a report of what it attacked and what it found (decision 5). It takes the call function as its last argument (decision 10). Since the Stage 2 review: the in-company pair and its comparer, `comparePair`, the report's `pairs`, the whole answer searched, and `{ data: undefined }` as no data |
| `test/companies.ts` | **New, after the review.** Where the suite finds and changes a company: `swaps`, the example moved into another company, and `foreignIn`, the data search. Split from `test/cross-tenant.ts` when that file passed 300 lines. Since the Stage 2 review: `ROWS`, the invoices the canaries come from, `canariesOf`, `pairsFor`, and a `foreignIn` that looks for three signs everywhere |
| `test/cross-tenant.test.ts` | **New.** C1 to C5, C7, and C8, over the shipped registry, over registries with one fake operation planted in each, and with fake DSoRs. Since the Stage 2 review: the review's planted leaks, the in-company pair, and four more fake DSoRs, one for each wrong reason to refuse |
| `test/cross-tenant.db.test.ts` | **New.** The suite with the database's store and log, and C6: the record of every attack, in each company. Since the Stage 2 review: the pairs, and each company's invoices checked against the rows the canaries come from |
| `test/invoice-get.test.ts` | **New.** Decision 1 |
| `inputs/InvoiceGetRequest.schema.json` | `{ invoice }`, an invoice's canonical URI, in place of `{ id }` (decision 1) |
| `src/operations.ts` | `invoice.get`'s code reads the id out of the URI, and still reads inside the active company |
| `src/main.ts` | Every call to `invoice.get` sends a URI. The firm's agent sends each company's own |
| every other test | About 170 inputs `{ id: "INV-1008" }` became the URI of the caller's active company. Three tests changed more, and two were put right after the review (see "Think it through"). Since the Stage 2 review, `test/tenants.test.ts` plants `test.free`, an operation whose input allows a nested object and keys of any name |
| `.claude/skills/build-baby-step/SKILL.md` | Version 2.3.0, which the copy from step 11 had missed |

Every other file is step 11's, without its `NEW IN STEP` markers. No new dependency.

*Changed by the Stage 2 review, 2026-10-01:* that review fixed six findings that began in
earlier steps, and this folder carries them too. Line ① makes the one copy of the input
(step 07's decision 9). A company id has 1 to 18 digits, and migration
`003b_bounded_claims.sql` makes the log refuse a large claim (step 10's decision 12). The
operation's code gets only the active company's invoices, from `src/company.ts`, and its
answer must hold no other company's row (step 10's decisions 13 and 14). `inCompany`
checks that its `COMMIT` really committed (step 11's decision 10). The program started as
the owner must name every fact the start-up check reads from the database (step 09's
decision 17, and step 11's decision 7). And the catalog guard looks at every schema, view,
and function (step 11's decision 1). Step 11's folder holds these too, so the commands
below show them only where this step's tests send a URI and step 11's send `{ id }`.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_11_row_level_security/src mj_12_cross_tenant_test_suite/src
git diff --no-index mj_11_row_level_security/test mj_12_cross_tenant_test_suite/test
git diff --no-index mj_11_row_level_security/inputs mj_12_cross_tenant_test_suite/inputs
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # 003b if your branch has not run it, and dsor_runtime's password again
pnpm check        # typecheck and the unit tests, the suite on memory among them
pnpm test:db      # the database tests, the suite with the database among them
```

*Changed by the Stage 2 review, 2026-10-01:* step 12 brought no migration of its own, so
`pnpm migrate` only set `dsor_runtime`'s password again. On 2026-10-01 it also ran `003b`,
which the Stage 2 review added in step 10, on this folder's branch `step-12`:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 003b_bounded_claims: done
```

To run only the suite and its tests, on memory:

```bash
npx vitest run test/cross-tenant.test.ts test/invoice-get.test.ts --reporter=verbose
```

On 2026-10-01, on the code after the Stage 2 review:

```text
✓ DSOR-IDN-03b: the code, handed org_789's URI while working in org_456, reads org_456's invoice
✓ DSOR-TEN-02b: the shipped registry: both operations attacked from both companies, 27 times, no findings
✓ DSOR-TEN-02b: handed a fake DSoR with no URI check, the suite names every one of the 27 attacks
✓ DSOR-TEN-02b: the suite sends all six swaps of a two-URI example, after the same-company call and before the in-company pair
✓ DSOR-ERR-01b: handed a fake DSoR whose three answers differ, the suite names each caller and URI
✓ DSOR-ERR-01b: in org_456, each reader also sends invoice.get the in-company pair, and org_789 has no id for one
✓ DSOR-ERR-01b: invoice.hint, whose 'not found' says the invoice exists in another company, is a finding in org_456
✓ DSOR-IDN-03b: invoice.fallback, which answers an id it lacks with the other company's invoice, is a finding in org_456
✓ DSOR-IDN-03b: in org_789, invoice.get is attacked by the firm's agent and user_700
✓ DSOR-TEN-02b: an example that leaves out a field its input schema lists is named, and the rest is still attacked
✓ DSOR-TEN-02b: handed a fake DSoR that refuses every foreign request with UNSUPPORTED_CAPABILITY, the suite names each of the 27 attacks
✓ DSOR-TEN-02b: code that refuses every request as foreign, its own company's too, is a finding
✓ DSOR-TEN-02b: a query whose code answers with data that is undefined is a finding, in both companies
✓ DSOR-IDN-03b: invoice.dump, which answers with every company's invoices, is a finding
✓ DSOR-IDN-03b: invoice.theirs, which answers with the other company's invoice, is a finding
✓ DSOR-IDN-03b: invoice.cached, which keeps invoices by id alone, is a finding from org_789
✓ DSOR-IDN-03b: invoice.rewritten, which answers with the other company's invoice, its tenant_id rewritten to the caller's, is a finding in both companies
✓ DSOR-IDN-03b: invoice.noted, whose example's note holds every canary, is still a finding in both companies
…
      Tests  87 passed (87)
```

Why 27 attacks: in `org_456`, `invoice.get` has 4 callers and `invoice.issue` has 1. In
`org_789`, each has 2: `firm-ap-fte` and `user_700`. That is 9 callers. Each example
holds 1 URI, and each URI is sent 3 ways: 9 × 1 × 3 = 27. Each caller also sends one
same-company call, which is not counted as an attack. *Changed by the Stage 2 review,
2026-10-01:* and each of the 4 readers of `invoice.get` in `org_456` sends one in-company
pair: 4 pairs, 8 calls, not counted as attacks either.

`pnpm check` prints `628 passed`, and `pnpm test:db` prints `64 passed`. `pnpm start`
prints what step 11's program printed, with every call sending a URI. *Changed by the
Stage 2 review, 2026-10-01:* `pnpm check` now prints `719 passed`, and `pnpm
test:db` prints `80 passed`. Outside the repository, three tests that compare the
schemas with the repository's originals are skipped: `716 passed | 3 skipped`.

## Break it

Every break of the design's table, performed on 2026-09-30, one at a time, then put
back from a copy and compared byte for byte. W1 to W7 ran twice: on the step before the
review (commit `1e01b0a`), and on the final code (commit `14eb49d`, after the review and the
sweep). W8 and W9 test what
the review added, so they ran on the final code only. W1 and W9 change what reaches the
database, so they also ran on the database tier.

*Changed by the Stage 2 review, 2026-10-01:* every break ran again on the code after that
review, in a copy of this folder outside the repository, where the three tests that
compare the schemas with the repository's originals are skipped. The last column holds
those runs.

| # | The break | Learner's prediction | Before the review | On the final code | After the Stage 2 review |
| --- | --- | --- | --- | --- | --- |
| W1 | Step 10's URI check is taken out of the pipeline | red for every operation, in both tiers | 12 unit, 2 database | **23 unit**: every suite test that uses the real checklist, and 4 of step 10's. **3 database** | **44 unit**: 38 of the suite's, and 6 of step 10's, `test.free`'s two among them. **5 database**: the suite's three, and two of the program's, whose call with `org_789`'s URI is no longer refused |
| W2 | The suite stops after the first operation | only the count | 8: the count, and every planted test | **20**: the count, the fake DSoRs, C6's log, and every planted test | 38 |
| W3 | The suite accepts any refusal | survives, unless a planted test | 3: the judge's own tests | 3 | 7: the judge's three, and the four fakes that refuse for a wrong reason |
| W4 | The rule "an example must hold a URI of org_456" is removed | red: the example has no URI | 2: `invoice.peek`, and the example whose only URI is `org_789`'s | 2 | 2 |
| W5 | The three answers are compared with the request id left in | not asked | 9: a false alarm everywhere the real checklist answers | 19 | 38 |
| W6 | The suite leaves out the same-company call's check | only C7 | 1: C7 | 1: C7, as predicted | 1 |
| W7 | The swap changes every URI at once | only the two-URI swap test | 1 | 2: the swap's own test, and the fake that records what is sent | 2 |
| W8 | The same-company call's data is not searched | only the three planted leaks | not built yet | **3**: `invoice.dump`, `invoice.theirs`, `invoice.cached`, as predicted | **7**: the review's five planted leaks, `invoice.noted`, and the fake whose refusal names a vendor. The first three are refused by the pipeline now |
| W9 | The suite works in `org_456` only | only `invoice.cached` | not built yet | **10 unit, 2 database**: every test that expects `org_789`'s attacks or findings | **26 unit, 2 database** |

**W1, the one this step is for.** In `src/pipeline.ts`, comment out
`checkUrisInTenant(copy, tenant);`, which read `checkUrisInTenant(checked, tenant);`
before the Stage 2 review. Then:

```text
$ npx vitest run test/cross-tenant.test.ts -t "the shipped registry"
AssertionError: expected [ …(33) ] to strictly equal []
+ [
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008 sent to org_789, with the same id: answered with data, not TENANT_MISMATCH",
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008 sent to org_789, with an id it does not have: answered RESOURCE_NOT_FOUND, not TENANT_MISMATCH",
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008 sent to org_999, which does not exist: answered with data, not TENANT_MISMATCH",
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008: the three answers differ",
    …the same four for user_123, cfo_100, and firm-ap-fte in org_456…
+   "invoice.get as firm-ap-fte in org_789, dsor://org_789/invoice/INV-1008 sent to org_456, with the same id: answered with data, not TENANT_MISMATCH",
    …and so on for firm-ap-fte and user_700 in org_789…
+   "invoice.issue as user_123 in org_456, dsor://org_456/invoice/INV-1008 sent to org_789, with the same id: answered UNSUPPORTED_CAPABILITY, not TENANT_MISMATCH",
    …
+ ]
```

Every operation is named, with every caller, from both companies, and every way. Look
at "answered with data": it is the caller's own company's INV-1008. The code reads inside
the active company, whatever company the URI names, so nothing of the other company
leaked. The suite still calls it a finding, because a request that names another company
must be refused, not answered with something else. The comparer notices too: `NOPE` is
not found, and the other two are answered. Here the difference comes from the caller's
own invoices, but an answer that changes with the company named is the kind that can
tell a caller about another company.

The fake DSoR with no URI check (decision 10) now does the same in a test that is always
there: it names all 27 attacks. So W1 no longer depends on someone running it by hand.
*Changed by the Stage 2 review, 2026-10-01:* that was half true. Under W1, the swaps are
answered with data, and `NOPE` with `RESOURCE_NOT_FOUND`. The fake answers only with
data, so a suite that flagged only data stayed green. The four fakes that refuse for a
wrong reason (decision 4) cover the other half.

**W2 and W9, more than predicted.** The learner expected only the count to notice W2,
and only `invoice.cached` to notice W9. But every planted operation comes after the two
shipped ones, so a suite that stops after the first never reaches it. And every test
that expects `org_789`'s attacks, findings, or callers notices a suite that never works
there: the counts, both fake DSoRs, C4's permission that nobody holds, C7, and all three
leaks.

**W8, as predicted.** Only the three planted leaks answer a same-company call with
another company's data, so only they notice when nobody looks. *Changed by the Stage 2
review, 2026-10-01:* those three are refused by the pipeline now, so W8 no longer reaches
them. The review's five planted leaks pass the pipeline, and catch W8.

**The Stage 2 review's breaks, run on 2026-10-01.** Two checks of this suite were right,
and no test proved it. So each was broken on purpose, before and after its new test.

First, in `test/cross-tenant.ts`, the suite's use of its judge is replaced by a check
that flags only data:
`const why = "data" in foreign ? "answered with data, not TENANT_MISMATCH" : undefined;`.
Before the review's tests, every test passed: 677, with the 3 that need the repository
skipped. Now:

```text
× DSOR-TEN-02b: handed a fake DSoR that refuses every foreign request with UNSUPPORTED_CAPABILITY, the suite names each of the 27 attacks
× DSOR-TEN-02b: handed a fake DSoR that refuses every foreign request with AUTHORIZATION_DENIED, the suite names each of the 27 attacks
× DSOR-TEN-02b: handed a fake DSoR that refuses every foreign request with VALIDATION_FAILED, the suite names each of the 27 attacks
× DSOR-TEN-02b: handed a fake DSoR that refuses every foreign request with RESOURCE_NOT_FOUND, the suite names each of the 27 attacks
AssertionError: expected [] to have a length of 27 but got +0
      Tests  4 failed | 712 passed | 3 skipped (719)
```

Second, in `src/pipeline.ts`, the checklist hands its URI search only the input's
top-level texts, `Object.values(copy).filter((value) => typeof value === "string")`. The
search itself is unchanged, so its own tests pass. Before the review's tests, every test
passed. Now:

```text
× DSOR-SRC-02b: through call, a URI of org_789 deep inside a nested object is refused with TENANT_MISMATCH
× DSOR-SRC-02b: through call, a URI of org_789 used as a key is refused with TENANT_MISMATCH
AssertionError: expected { data: { …(6) }, …(1) } to strictly equal { code: 'TENANT_MISMATCH', …(3) }
      Tests  2 failed | 714 passed | 3 skipped (719)
```

The planted `test.free` reached its code, and answered with data, with `org_789`'s URI
inside its input.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", in a session before this one |
| 2 | Neon | A branch `step-12` from `step-11`, and `.env` written by a command, never shown ("Before you build") |
| 3 | Check the design | Against step 11's code. Three gaps, and the learner chose each answer, in the design before any test |
| 4 | Mechanical | Step 11's `NEW IN STEP` markers removed |
| 5 | Red | Every new test, beside a **stub**: a suite with the right functions, which attack nothing and find nothing. Predict how many pass |
| 6 | Green | Decision 1, then C1, C2, C4, and C7, one commit each. Predict each |
| 7 | Break it | W1 to W7, for real |
| 8 | Review | Two reviewers who have not seen your conversation attack the step. Ask one to plant operations that leak, and see if the suite notices |
| 9 | Fix the review | Change the design first, then the tests, then the code: both companies, the data search, the fake DSoR, two more gaps. Predict each |
| 10 | Break it again | W1 to W7 on the fixed code, and W8 and W9 for what the review added |

The learner's predictions, and what happened:

| Moment | Prediction | Real |
| --- | --- | --- |
| Red run, stub suite | every new test fails | 20 of 22 failed. The 2 that expect "no finding" passed: a stub that finds nothing says "fine" to everything |
| After decision 1 | 5 pass | 5 |
| After C1 | 3 more pass | **9**: `attackersOf` and `judge` are C1's own code, so C3's two tests and the four judge tests passed with it |
| After C1, database | both pass | both |
| After C4 | 5 more pass | **6**: C5's `{ id }` operation is caught by the same check as C4's example with no URI of `org_456` |
| After the review, both companies | 3 of 17 pass | **6**: the count, C4's permission nobody holds, and C7 expect `org_789` too |
| W8 and W9 | only the leaks; only `invoice.cached` | W8 right. W9 was caught by 10 tests |

The learner's pattern across this step: each commit turned more tests green than
predicted, because one piece of code often serves several claims.

Build your own step 12 from a copy of your step 11. From `docs/baby_steps_tutorials`:

```bash
cp -R my_11_row_level_security my_12_cross_tenant_test_suite
cd my_12_cross_tenant_test_suite
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 12. Set up Neon as "Before you
build" says: a branch from step-11, and secrets only from a command into .env, never
through the chat. Check the design against step 11's code before any test, and change
the design first when the code proves it wrong. Red tests first, one commit per claim.
Before each run, ask me what I expect.
```

## Check yourself

1. Steps 10 and 11 already test the two locks. What does a generated suite add?
2. Why must the suite accept only `TENANT_MISMATCH`, and not any refusal? And why does each
   caller first send the example unchanged?
3. Why is an operation with no example request a failure, and not a skip?
4. A foreign URI never reaches an operation's code. So how can the suite notice code that
   leaks another company's invoice?
5. The suite runs in `pnpm check` on memory, and in `pnpm test:db` on the database. What
   does each run prove, and what does neither prove?

<details>
<summary>Answers</summary>

1. It cannot forget. It reads the registry, so an operation added later is attacked
   without anyone writing a test for it.
2. In this tutorial's checklist, the URI's company is checked after line ⑤, the
   permission. A caller without the permission is refused at line ⑤, and the URI's
   company is never looked at. Only `TENANT_MISMATCH` shows that the company check ran.
   The unchanged example, the same-company call, must not be refused as foreign. Then the
   refusal of the swapped request can only come from the company that changed. Without
   it, code that refuses everything as foreign would pass.
3. A skipped operation looks like a tested one when every test is green. The suite must
   fail until the operation can be attacked.
4. Through the same-company call, the only request that reaches the code. Its answer is
   searched for a `tenant_id` or a URI of another company. And the suite works from both
   companies, so a cache filled in one is read from the other. *Changed by the Stage 2
   review, 2026-10-01:* the whole answer is searched now, for the other company's
   canaries too, and a query also gets the in-company pair: its own company's URI with an
   id only the other company holds, and with one nobody holds.
5. On memory, CI runs every check of the suite on every push. On the database, the same
   checks run with the real store and log: every same-company read goes through the
   database, and every attack's record lands in the caller's company. Neither run
   attacks the database's own lock, because no foreign company ever reaches a read.

</details>

## Think it through

Every break of the design's table was run for real, before the review and again after
it ("Break it"). Then two reviewers who had not seen the conversation attacked the step.
One checked each rule against the tests and the code, and planted operations that leak.
The other made 103 small changes to the code, one at a time, and ran the tests after
each: a change that leaves every test green shows a test that is missing. This is
called a mutation sweep.

**Changed by checking the design against step 11's code, before the first test:**

- **`invoice.get` takes an invoice's URI only** (decision 1). The specification's
  pattern accepts a URI of any kind, so a vendor's URI would have been read as an
  invoice's id.
- **One URI at a time** (decision 3). Swapping every URI at once would let an operation
  that checks only its first URI pass.
- **The same-company call** (decision 8, C7). Without it, code that refuses everything as
  foreign would pass.
- **C2, C3, and C4 gained tests.** The comparer is handed answers that differ, the
  attackers are pinned exactly, and a fourth gap was planted: an example that fails its
  own schema.

**Changed by decision 1, in the old tests.** About 170 inputs `{ id: "INV-1008" }` became
the URI of the caller's active company. Three tests changed more. Two of step 10's sent a
URI inside `invoice.get`'s `id`, a field of any text, to prove the whole input is
searched. No shipped input has such a field now, so they ask `checkUrisInTenant`
directly. Step 09's id written as SQL can no longer reach the store through a call,
because line ⑥ refuses a quote in a URI, so it asks the store directly. The review found
two calls made in `org_789` that the change had given `org_456`'s URI. One of them had
stopped proving a successful read. Both are fixed. *Changed by the Stage 2 review,
2026-10-01:* asking `checkUrisInTenant` directly lost one proof: that the checklist hands
it the whole input. With the pipeline changed to hand it only the input's top-level texts,
every test stayed green. A call-level test is back, through a planted `test.free`.

**Found by the review, and fixed:**

- **Operations that leak passed the suite.** The reviewer planted `invoice.dump`, which
  answers with every company's invoices, a cache keyed by id alone, and more. Each
  passed with no finding, because the checklist refuses every foreign URI before any
  operation's code runs. Now the same-company call's answer is searched for another
  company's data (C8), and the suite works from both companies (decision 9).
- **The suite's judge and comparer could be switched off** with every test green. Every
  foreign answer in every test was the same `TENANT_MISMATCH`, so the two were tested
  only alone. Now the suite takes the call function as an argument, and fake DSoRs make
  it name every attack, or every difference (decision 10).
- **"The database run tests both locks" was false.** No attack reaches the database's
  lock. The README now says what the database run proves.
- **`invoice.get`'s code reading the URI's company, not the active one,** passed every
  test. A test now hands the code another company's URI directly.
- **Smaller gaps.** A field the example leaves out, and an example file no operation
  names, are findings now. C6 checks each record's operation and reason.
- **The README.** The hotel inspector became the bank's mystery shopper: "hotel" already
  means booking the last room, and the inspector hid that every door shares one front
  desk. "Control call" became "same-company call": a control is a CEL rule in DSoR. The
  order of the checklist was worded as DSoR's rule, and answer 2 was wrong about it. One
  sentence under W1 taught something false. Terms are now defined where they first
  appear, and long sentences are split.

**Found by the mutation sweep, and fixed.** It ran on the step before the review's
changes. `pnpm check` caught 80 of its 103 changes. Of the 23 that passed, five change
nothing today ("Left open", below). Six were already caught by the review's fixes, each
run again to be sure: only the first URI attacked, the judge's findings dropped, the
comparer's findings dropped, the comparer handed one answer, code reading the URI's
company, and the suite's pattern without `^`. The other twelve, now caught:
*Changed by the Stage 2 review, 2026-10-01:* counted again, the table below holds
thirteen changes in nine rows, two in each of four rows. With the five and the six above,
that makes 24, one more than the 23 that passed. The sweep's own list was not kept, so
which count is wrong cannot be traced.

| Change that passed every test | Now caught by |
| --- | --- |
| A finding that names the wrong way of the swap | the fake DSoR test, which types out the first caller's three findings |
| The comparer skips the first answer, or the last | the comparer's test, with the odd answer in each place |
| The search for URIs stops at the first text that is not one | a text before a URI |
| The suite's pattern without `$`, or with a slash allowed in the kind | three odd texts that are not URIs |
| An example that is a bare URI, not an object | a bare URI as the example, swapped as a whole |
| The suite writes to a log of its own | C6 in the unit tier: the suite's log holds one record for each attack |
| The example found by a name that only starts with the operation's | a look-alike example name |
| `invoice.get`'s schema without the specification's pattern, or with `/invoice` short of its `/` | a URI with a fourth part, and the kind `invoices`, refused at line ⑥ |
| `invoice.get`'s example names `INV-9999`, or `INV-2001`, which only `org_789` has | **a query's same-company call must answer with data**, from both companies (decision 8). This was a design change, chosen by the learner |

**My own sweep of the review's new code.** Fifteen changes to the data search, the move
into `org_789`, and the fake-DSoR argument. Fourteen were caught. One, an attack
recorded under the wrong operation, was caught only by the database tier, and C6's new
unit test catches it now.

**Attacked with the threats of §10.2** that concern this idea: T4, cross-company
disclosure; T2, a misbehaving agent; T3, a confused deputy, such as `firm-ap-fte` in
one company reaching for the other. The sweep sent 66 hostile inputs of its own to
`invoice.get`: percent-encoding, capitals, look-alike letters, extra slashes, a URI as a
field's name, getters that change, and more. None returned another company's data. Every
pair of answers that could have told whether a company or an invoice exists was the same,
word for word.

**Found by the Stage 2 review (2026-10-01), and fixed.** Six reviewers audited steps 10
to 14 and the seams between them (`../mj_notes.md`). They found no live leak. Six of their
findings began in earlier steps, and this folder carries the fixes. One began here, in
the suite.

- **A check and the code could see two different inputs.** Fixed from step 07 on. Lines
  ① and ② read the input itself, to check the principals and the companies it names.
  Line ⑥ then made its own copy, for the schema check and for the code. A getter, a
  field that runs code each time it is read, can answer the second read differently. In
  the red run here, the code was handed `principal: "cfo_100"` after line ① saw the
  caller, and `tenant_id: "org_789"` after line ② saw `org_456`.
  - **Fixed:** line ① makes the one copy, right after it finds who is calling. Every
    check and the code read that copy (step 07's decision 9). An input that JSON cannot
    copy is still refused with `VALIDATION_FAILED`, at the end of line ②, once the
    principals and the companies it names are checked.
  - **Caught by** step 10's tests, carried here with `invoice.get` sent a URI, in
    `test/pipeline.test.ts` and `test/who-is-calling.test.ts`. Eight of them failed in
    the red run.
- **A company id had no length, and the log kept a claim of any size.** Fixed from step
  10 on. In step 14, an envelope naming `org_` and a million digits got a refusal of 212
  bytes, and left a record of 1,000,433 bytes that `dsor_runtime` can never remove. In
  the red run here, with step 10's old pattern put back, four unit tests failed: 19
  digits and a million digits passed the form check, the record kept the claim, and
  `parseUri` took a company of 19 digits.
  - **Fixed:** a tenant id has 1 to 18 digits, and migration `003b` makes the log refuse
    an `extensions` over 1,024 bytes (step 10's decision 12). It ran on the branch
    `step-12` on 2026-10-01. Before it ran, its two database tests failed: as
    `dsor_runtime`, an `extensions` of 2 KB went in, and so did one of 1,025 bytes, each
    in a transaction that was rolled back.
  - **Caught by** the 19-digit and million-digit cases, and the tests titled `step 10's
    decision 12: …`, in `test/tenants.test.ts`, `test/uri.test.ts`, and
    `test/tenants.db.test.ts`.
- **The code could name another company, and both locks trusted it.** Fixed from step 10
  on. The high finding. The operation's code named the company at each read, and the
  store set that company for the database's policy too. In the red run here, with the
  code handed a bare company id again, 52 unit tests failed. With the answer check taken
  out, 9 failed, and on the database, code that made a store of its own read `org_789`'s
  `INV-2001` for a caller in `org_456`.
  - **Fixed, in two layers:** the code gets `companyOf(store, tenant)`, the active
    company's invoices only (step 10's decision 13). Every `tenant_id` in its answer must
    be the active company's, or the call fails with `INTERNAL_ERROR` (step 10's decision
    14).
  - **Caught by** step 10's C8, in `test/company.test.ts`, `test/tenants.test.ts`, and
    `test/tenants.db.test.ts`.
  - **What it changed here:** this step's three planted leaks, `invoice.dump`,
    `invoice.theirs`, and `invoice.cached`, answer with another company's row. The second
    layer now refuses each of them before the suite sees the row. So the suite names
    them because a query's same-company call must answer with data (decision 8): "not
    answered with data: INTERNAL_ERROR". The third layer is this step's, below.
- **A transaction counted as kept when it was not.** Fixed from step 11 on. In the red
  run here, with the answer to `COMMIT` not read, work that swallowed its own failed
  statement looked kept: "promise resolved 'done' instead of rejecting". With the
  `COMMIT` not awaited at all, both tests failed, and the log's caller got the invoice.
  - **Fixed:** `inCompany` reads the answer to its `COMMIT`. Anything but `COMMIT` is the
    error "the transaction was rolled back" (step 11's decision 10).
  - **Caught by** `step 11's decision 10: …` in `test/rls.db.test.ts`, and `DSOR-EXE-03b:
    a log whose COMMIT fails gives no invoice, and no record`, in `test/audit.db.test.ts`.
    That second test uses **fault injection**, an error planted on purpose (§47): it
    wraps the real client, so every statement reaches the real database except the first
    `COMMIT`, which fails.
- **The start-up check's database facts were proven only with hand-made facts.** Fixed
  from step 09 on, with the membership of roles from step 11 on. In the red run here,
  each of four changes to the SQL in `runtimeRoleProblems` turned the owner's test red:
  `rolbypassrls` and the membership of `pg_write_all_data` read as `false`, and the
  counts of tables owned and of roles read as `0`.
  - **Fixed:** the test that starts the program as the owner requires `holds BYPASSRLS`,
    `is a member of pg_write_all_data`, `owns … tables`, and `belongs to … other role…,
    which SET ROLE can switch to`.
  - **Caught by** `DSOR-AUD-04a: refuses to run as the owner, names why, and makes no
    call`, in `test/program.db.test.ts`.
- **The catalog guard missed a kind of schema name, and every view and function.** Fixed
  from step 11 on. The catalog guard is step 11's test that reads PostgreSQL's own list of
  tables, its **catalog**, to find every table with a company column. It skipped any
  schema whose name starts with `pg`, and it looked at tables only. In the red run here,
  the old filter, `NOT LIKE 'pg_%'`, dropped `pgcrm` from all three planted lists.
  - **Fixed:** step 11's decision 1 widens to the other ways around a policy: a view, a
    saved query that reads with its owner's rights; a materialized view, a stored copy of
    rows; a foreign table, read from another server; and a `SECURITY DEFINER` function,
    which runs with its owner's rights. Three guards check that none exists.
  - **Caught by** the C1 tests in `test/rls.db.test.ts`, each filter shown on planted
    rows.
- **The mystery shopper missed leaks that do not label themselves.** Fixed from step 12
  on, here. In step 14, an operation answered `cfo_100`, in `org_456`, with `org_789`'s
  invoice, its `tenant_id` rewritten to `org_456`. `cfo_100` got `VENDOR-77` and
  `99000.00`, and this suite reported no finding. Its search knew two signs: a field named
  exactly `tenant_id`, and a text that starts with `dsor://`. In the red run here, 19 new
  tests failed against the old suite. Each planted leak got no finding: a rewritten
  `tenant_id`, no `tenant_id`, a URI as a key, a URI in a sentence, `tenantId`, a "not
  found" that names another company, and an answer of `{ data: undefined }` or `null`.
  - **Fixed, in five parts.** (a) The whole answer is searched, every key and every
    text, for canaries, tenant keys, and URIs of another company, in any letters
    (outcome 4, decision 8). (b) Fake DSoRs refuse every foreign request for a wrong
    reason (decision 4). (c) The in-company pair compares a query's answer for
    `INV-2001`, which only `org_789` holds, with its answer for `NOPE` (C2). (d) A query's
    data may not be empty, such as `undefined` or `null`. (e) A call-level test plants
    `test.free`, whose input allows a nested object and keys of any name.
  - **Caught by** C2, C4, C7, and C8 in `test/cross-tenant.test.ts`, the database
    suite's check of the canaries' rows, and the `test.free` tests in
    `test/tenants.test.ts`.
  - **Broken on purpose:** (b) and (e) cannot be red before a break, because the code
    they guard is right. With the suite's judge replaced by a check that flags only data,
    and with the checklist handing its URI search only the input's top-level texts, every
    test passed before this fix. Each now turns a test red ("Break it").
  - **A hostile pass on the fix** found one real gap and two smaller ones, each now
    closed and red first. The pair's two answers were compared but never searched, so a
    fallback that answered both with the other company's invoice passed: both answers
    are searched now (`invoice.fallback`). Any canary the request held was excused, so one
    note that held them all switched the search off: only the id a request names in its
    own URI is excused now (`invoice.noted`). And `{}` and `[]` passed as data: empty
    data is no data now. The pair's comparer masked both ids with one mark, so an answer
    that wrote the mark itself passed: the second answer is now written as if asked for
    the first id, and must then match it. The pass also made 34 small changes to the
    suite, and 15 left every test green. Six change nothing today, or make the suite
    stricter. The other nine are caught now: a judge that lets `RESOURCE_NOT_FOUND`, or
    `AUTHORIZATION_DENIED`, pass; a tenant rule for keys that start with "tenant", or in
    small letters only, or that hold text only; a URI rule that reads only the first URI,
    or takes `org_4567` for `org_456`, or skips a URI with no company; and the mask
    above. They are caught by three more fakes, one for each wrong code, and by a row of
    the search's test for each rule at its edge. A search of the data alone, one of the
    six, is caught too, by a fake DSoR whose same-company refusal names the other
    company's vendor. Each of these changes was run again here, with the four fixes
    undone one at a time: thirteen runs, each red.
- **Sentences that said more than the code.** Outcome 4 and the design's "Left open" are
  corrected in the design, and the note "as far as a same-company call shows it" in "The
  rules this step meets", below. Decision 10 said the suite's use of its judge was
  tested; for the judge, that became true with the fakes of decision 4. "W1 no longer
  depends on someone running it by hand" was half true ("Break it"). The rules table
  credited C2 with DSOR-ERR-01b, but C2 compared only the checklist's own refusal; the
  pair compares an operation's own. `test/cross-tenant.ts` was 224 lines, not 217. And
  "the other twelve" did not match its table (above).

**Left open on purpose:**

- **Five changes no test can catch, because they change nothing today.** The
  same-company call made as the first attacker only: code never learns who is calling,
  until a later step lets it. A missing input check counted as a pass: start-up gives
  every contract one. The two checks of an example in the other order: both give a
  finding. The id read as the URI's last part: line ⑥ allows only three parts. A command
  example's id: commands are refused before their code until step 22.
- **The suite sends canonical URIs only.** Odd spellings, a URI in a list or as a
  field's name, and the check's place in the checklist are guarded by step 10's
  hand-written tests, not by the suite. The sweep showed seven changes that only those
  tests catch. *Changed by the Stage 2 review, 2026-10-01:* a URI deep inside an input,
  or as a field's name, is now also refused through a call, with the planted
  `test.free`.
- **`test/cross-tenant.ts` is 217 lines,** above the 150 this tutorial aims for, even
  after `test/companies.ts` was split from it. *Changed by the Stage 2 review,
  2026-10-01:* it was 224 lines, not 217. After that review it is 281 lines, and
  `test/companies.ts` is 234.
- **The in-company pair runs from `org_456` only.** Only `org_789` holds an id that the
  other company lacks. A row that only `org_456` holds would let the pair run from
  `org_789` too. Adding one changes step 10's data, so it waits for a step that needs
  more rows. Found by the Stage 2 review.
- **The canaries come from the invoices in memory.** The database tier checks that each
  company holds exactly those. A second business table, with no rows in memory, would
  give no canaries until `ROWS` in `test/companies.ts` lists it.
- **A value written another way is no canary,** such as `99000` as a number for
  `99000.00`, or `VENDOR-77` written with a hyphen that only looks the same. Nor is a fact
  worked out from the other company's rows, such as `held_elsewhere: true`. And the id
  that a request names in its own URI is not counted, so an example whose URI named the
  other company's id would hide that id. Decision 8 still names such a query: it cannot
  answer with data. Found by a hostile pass on the Stage 2 review's fix.
- **The search and the pair can name honest answers.** A "not found" that carries a
  trace id of its own, or repeats the id in other letters, makes the pair's two answers
  differ. A `tenant` field that holds an object, such as `{ id, name }`, is a finding.
  So is this company's own URI with more after the company, such as
  `dsor://org_456?view=full`. Each is a false finding, never a missed leak. Found by a
  hostile pass on the Stage 2 review's fix.
- **"Canary" is a word from security writing:** a value whose appearance shows that
  something leaked. It is not on the house list of analogies, and it is flagged for
  review, like the mystery shopper.
- **The mystery shopper is a new analogy,** not on the house list. It reuses step 10's
  bank teller, and it is flagged for review.
- **Questions for the specification.** DSOR-TEN-02b asks for foreign-tenant URIs. When
  one check refuses every foreign URI before any operation's code, such a suite tests
  that check, not each operation. Should the rule also ask for same-company calls whose
  answers are searched for another company's data? And how is an operation with no URI
  in its input, such as a list, to be attacked?
- Everything under "Left open, and not this step's idea" in the design.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-02b | A cross-tenant test suite exercises every operation with a foreign-tenant URI | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/cross-tenant.test.ts`: the shipped registry attacked from both companies with no finding (C1), the fake DSoR with no URI check named on all 27 attacks, every gap named (C4, C5), and the same-company call (C7). `test/cross-tenant.db.test.ts`: the same with the database. Since the Stage 2 review, four fake DSoRs that refuse for a wrong reason are each named on all 27 attacks too (C4), and a query whose data is empty, such as `undefined` or `{}`, is a finding (C7) |
| DSOR-ERR-01b | An error does not reveal a resource the caller may not read | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `test/cross-tenant.test.ts` (C2): the three answers of every operation, caller, and URI, compared word for word, and a fake DSoR whose answers differ named. *Changed by the Stage 2 review, 2026-10-01:* those answers are all the checklist's own refusal, so this row claimed more than C2 proved. Now an operation's own "not found" is compared too: the in-company pair, from `org_456`, and the planted `invoice.hint` named |

Also advanced, first met in earlier steps: DSOR-IDN-03b, for every operation's own code
as far as a same-company call shows it (C3 and C8, `test/cross-tenant.test.ts`, and
`test/invoice-get.test.ts` for `invoice.get`'s code), and DSOR-EXE-02, one record for
every attack, with its operation, result, and reason (C6, `test/cross-tenant.db.test.ts`).
*Changed by the Stage 2 review, 2026-10-01:* "as far as a same-company call shows it"
was narrower than it read: the search knew two labels only. Now DSOR-IDN-03b is advanced
through the whole answer of a same-company call, searched for the other company's
canaries, tenant keys, and URIs, and through the in-company pair. And DSOR-SRC-02b, from
step 10, is proven through a call again, for a URI deep inside an input or used as a key
(`test.free`, `test/tenants.test.ts`). The fixes this folder carries from steps 07 to 11
keep their rows in those steps' READMEs.

## Next

Step 13 · Bounded queries: `invoice.list`, whose page size the server caps even when the
caller asks for everything. It is the first new operation. The moment it is registered,
the suite attacks it, or names why it cannot ("Left open").
