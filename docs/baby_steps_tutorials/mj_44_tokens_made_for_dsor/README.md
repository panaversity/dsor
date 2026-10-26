# Step 42 · A REST API

**New in this step:** an HTTP server in front of DSoR. Every request it receives goes into the same
checklist as before, `call()`, and the server holds no check of its own (DSOR-OPR-04a,
DSOR-OPR-04b).

## In plain words

Since step 07, DSoR is one function, `call()`. It takes the request envelope (who calls, in which
company, with which key and mode), the name of an operation, and its input. It runs the checklist
and gives an answer. Only code inside the same Node program can call a function. cfo_100's phone,
a dashboard, or the accounts system cannot.

This step adds a *front door*: an HTTP server. A program anywhere sends an HTTP request, such as
`GET /invoices/INV-1008`. The door turns the request into the three things `call()` takes, calls
it, and turns the answer into an HTTP response. That is all it does. It never answers in DSoR's
place, and it never reads a store itself.

The rule behind it is short. Every door leads into the same checklist, and no door has rules of its
own. A door is code that runs *before* `call()`. DSoR cannot see what a door does there, so the
door must do nothing there but translate.

**Words this step uses.**

- *HTTP* is the language programs use to talk over a network. A *request* has a *method*
  (`GET` to read, `POST` to do), a *path* (`/invoices/INV-1008`), *headers* (named lines of text
  such as `Authorization: Bearer tok_d4e8`), and sometimes a *body*. Here the body is JSON.
- A *response* has a *status*, a three-digit number such as 200 (fine) or 403 (not allowed), and a
  body.
- A *route* is one method and one path pattern, such as `GET /invoices/{id}`. Each route names one
  operation.
- The *query string* is the part of a URL after `?`, such as `?limit=10`.
- A *port* is the number a server listens on. `127.0.0.1` is the address of this computer only.
- A *retry library* is code in a caller's program that sends a request again on some statuses,
  without being asked.
- The *request envelope* is what travels beside a call's input (steps 05, 10, 20, 23, 33, and
  41b). The *answer envelope* is what `call()` gives back: a result, or an error with a code and
  a retry class (§28).
- *Line ①* is the checklist's first line: who calls. *Line ②* checks the company, and *line ⑥*
  checks the input against its schema (§21).

## Why it matters

A real run on 2026-10-23, on step 41b's finished code (`b3650a19`), in memory, from a script that
imports the step's `src/`. The labels are the script's; the answers are DSoR's own. Part 3 is a
sketch of a bad door, not DSoR code.

```text
1. Inside the program: DSoR's call(), the only way in today
  cfo_100 reads INV-1008: {"tenant_id":"org_456","id":"INV-1008","vendor_id":"VENDOR-44","amount":{"value":"31400.00","currency":"USD"},"open_amount":{"value":"31400.00","currency":"USD"},"status":"issued","version":1}
  a call with no login token: AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
  records in DSoR's log: 2

2. From outside the program: the CFO's phone, a dashboard, curl
  127.0.0.1:8042: ECONNREFUSED, nothing listens

3. A side door (a sketch, not DSoR code): an HTTP handler that reads the store itself, with no login
  GET /invoices/INV-1008 answers: {"tenant_id":"org_456","id":"INV-1008","vendor_id":"VENDOR-44","amount":{"value":"31400.00","currency":"USD"},"open_amount":{"value":"31400.00","currency":"USD"},"status":"issued","version":1}
  new records in DSoR's log: 0
```

Two things go wrong:

1. **Nobody outside can use DSoR.** cfo_100 cannot approve PAY-901 from her phone. Every story so
   far ran inside one program.
2. **The fast way to add a door breaks every guarantee at once.** A handler that reads the store
   gives any caller INV-1008's 31,400.00 USD. No login, no company check, no masking, and the log
   shows nothing.

**Common mistake:** a door with "a little safety" of its own. Say the door lets only a CFO call
`POST /proposals/approve`. With org_456's second rule on, INV-1008 waits for a CFO *and* a tenant
administrator. cfo_100 approves through the door; admin_100 hears 403 from the door, and `call()`
never runs. INV-1008 waits until it expires, and the log has no trace of admin_100's try. The two
rulebooks together block what neither blocks alone. (A real run of this sketch is in
[`../mj_42_why_this_step.md`](../mj_42_why_this_step.md), prediction P3.)

## The design, before any code

### How this step was made

On 2026-10-23 Claude Code showed the run above. The learner then understood the step in five parts,
each with a prediction settled by a real run, and made the decisions D1 to D7, A1, and A2, one at a
time. Then the learner said "build first and we discuss later", so A3 and A4 are Claude Code's,
marked "(Claude Code)", for the learner to review. Step 41b was copied into this folder, its markers
removed. The whole conversation is kept in
[`../mj_42_why_this_step.md`](../mj_42_why_this_step.md).

### What the rules say

From [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract):

- **DSOR-OPR-04a:** "Every interface MUST invoke the same DSoR pipeline (§21)."
- **DSOR-OPR-04b:** "An interface MUST NOT implement its own business authorization."

From [§39](../../../specs/dsor/05-bindings.md#39-rest-and-sdk-interfaces): "All of them enter the
same checklist. There is no side door." Its example names `invoice.get` as `GET /invoices/{id}`. And:
"The invocation mode, idempotency key, expected version, and correlation identifiers have one
canonical representation per interface, documented by the implementation."

The specification names no HTTP status, no header, no other route, and no framework. Those are this
tutorial's decisions, below.

### The claims

| Claim | What it says |
|---|---|
| C1 | One pipeline. Every request the door receives, on a route or not, is answered by one call of `call()`. The door is given one function, which asks `call()` with the registry and the log the program holds; it gets no store, no log, and no list of who may do what. No request can stop the door: a request target that is no URL, a body cut off mid-upload, and a body that never ends each still go to `call()` |
| C2 | The routes. 18 routes, one for each operation a person or an app calls. Start-up refuses a table where a route names no operation, an operation has two routes, or an operation is neither on a route nor on the list of the four that stay inside |
| C3 | The envelope. One header for each field: `Authorization: Bearer <token>` gives `token`, `Idempotency-Key` gives `idempotency_key`, and `DSoR-Tenant`, `DSoR-Mode`, `DSoR-Request-Id`, `DSoR-Supersedes`, `DSoR-Agent-Asserted` give the other five. Every value is handed over as it came. One header given twice is handed over as the list of its values. An `Authorization` that is not a bearer token, and any other header that starts with `dsor`, are handed over under their own names. `call()` refuses each of these |
| C4 | The input. A command's body is its input. `GET /invoices/{id}` builds `dsor://<DSoR-Tenant>/invoice/<id>`. The two lists take `limit` and `cursor` from the query string; a `limit` of digits is handed over as a number, anything else as text. A body that is not JSON is handed over as its text. Two sources that name the same field are handed over as the list of both |
| C5 | No answer of its own. A request on no route is handed to `call()` with `"<METHOD> <path>"` as the operation's name, the path exactly as it was sent. Of a body over 64 KiB, no more than 64 KiB is kept: the rest is read and thrown away, and `call()` gets a short text in its place; so does a body cut off before its end, and one that is not UTF-8. An `Expect` header Node does not know goes to `call()` too. So line ① always runs first, and every request leaves a record, with one exception the door makes, a foreign `Host` (C9), and three Node keeps before the door sees anything: a request it cannot parse (400), headers over 16 KiB (431), and `CONNECT`, which it closes |
| C6 | The status. The body is always `call()`'s answer, unchanged. Its status comes from one table: one status for each code of §28, and for each result. A status that retry libraries repeat by themselves (408, 413, 429, 500, 502, 503, 504) is given only to a code whose retry class is `safe_same_key` or `after_delay`, with one exception, `INTERNAL_ERROR` (A3) |
| C7 | Where it listens. Only `127.0.0.1`. Start-up refuses any other address while the logins are the fake table of step 05 |
| C8 | The proof of DSOR-OPR-04b. For every route, six callers (cfo_100, user_123, the agent, admin_100, org_789's user_700, and nobody), and seven envelopes (none more, each mode, a request id, `supersedes`, `agent_asserted`): `call()` is asked exactly once, with exactly the request that was sent, and the door's response is exactly `call()`'s answer, with its status. On 12 of the 18 routes some case is let through. And the door's files import nothing that decides who may do what |
| C9 | Only requests meant for this door. A request whose `Host` is not exactly `127.0.0.1` and the port it came in on, or that has no `Host`, or two, is refused with 421 and an error envelope of §28's shape, before anything else. `call()` is never asked, so it leaves no record: the one answer the door makes by itself (D8) |

### Decisions

The learner's decisions, 2026-10-23, each asked one at a time, after the five parts of the
understanding session.

- **D1. The 18 operations for people get a route.** The four that only DSoR's own system logins
  call stay inside the program: `proposal.expire_due`, `alert.escalate_due`,
  `rule.check_authority` (`dsor-scheduler`), and `rate.load` (`dsor-rates`). *Downside:* 18 routes
  to test, and a list to keep in step with the contracts.
- **D2. Resource routes**, as §39's example: `GET` for the queries, `POST` for the commands. A
  table from route to operation, which start-up checks against the contracts. Not
  `POST /operations/{name}`, which reads as the generic invoke DSOR-OPR-03a forbids on a surface an
  agent can reach. *Downside:* 18 rows to write, and start-up must refuse a table that drifts.
- **D3. The envelope rides in headers; the body is the input only.** The envelope stays beside the
  input, as since step 05. Step 43 changes only what `Authorization` means. *Downside:*
  `agent_asserted` is JSON inside a header, and some proxies drop headers they do not know.
- **D4. Statuses mapped by retry class.** One status for each code, from a fixed table. A status
  that retry libraries repeat by themselves only for a code whose retry class says a retry is safe.
  So `OUTCOME_UNKNOWN` never gets one. *Downside:* a table to keep in step with §28.
- **D5. The door hands over everything it can.** Broken JSON, a header sent twice, an unknown
  `DSoR-*` header: all go to `call()` as they came, so line ① asks who calls first (DSOR-IDN-01) and
  a later line refuses, recorded. *Downside:* odd values reach `call()`, and its checks must hold
  for them. (D5 first kept a 404 and a 413 for the door; A2 took them back.)
- **D6. Node's own `node:http`.** No new dependency, and no framework that parses the body or
  answers 400 before `call()`. *Downside:* more of our own code to test, such as a cut-off body.
- **D7. Only `127.0.0.1`.** The fake logins are in a public file: `tok_d4e8` is cfo_100. Step 43
  lifts this. *Downside:* cfo_100's real phone cannot try it yet.
- **D8. The door checks the `Host` header** (the learner's answer to Q1, 2026-10-23, after the
  review's M4). A request meant for another name is refused with 421, before anything else, against
  DNS rebinding. A check of the transport, not of who may do what, so DSOR-OPR-04b allows it.
  *Downside:* the one answer the door makes by itself, against A2, and it leaves no record; and
  `localhost:8042` is refused too, so a caller must name `127.0.0.1`.
- **A1. An id goes in the path only when there is no body.** Only `GET /invoices/{id}` has one. The
  door builds the address with one fixed template and the `DSoR-Tenant` header's text; a missing or
  wrong header is refused by `call()` at line ②. Every command takes its whole input in its body, so
  the path and the body never name the same thing. *Downside:* `POST /proposals/approve`, with the
  proposal in the body, not the textbook `POST /proposals/{id}/approve`.
- **A2. The door has no answer of its own.** An unknown route goes to `call()` as
  `"<METHOD> <path>"`: a name with a space never matches a contract, so no route reaches the four
  system jobs. A body over 64 KiB, the size of step 13's cap on an answer, is cut off, and `call()`
  gets a short text that line ⑥ refuses: all 19 input schemas are objects. *Downside:* a flood of
  junk requests is a flood of records.
- **A3. The status table, with `INTERNAL_ERROR` as 500 (Claude Code).** The learner sent "build
  first" before answering. 500 is the status every tool reads as a server fault, and the body still
  says `retry: never`. *Downside:* a library set to repeat a `POST` on 500 runs the work again, since
  an `INTERNAL_ERROR` keeps no claim (`src/claims.ts`, step 20's README, decision 9).
- **A4. How DSOR-OPR-04b is proved (Claude Code).** No test can prove an absence in general. So
  two tests: C8, the door answers what `call()` answers, route by route, for callers who may and
  callers who may not; and the door's files import nothing that decides who may do what (the role
  table, the logins, the slips, the companies, the rules). *Downside:* C8 covers the cases it lists,
  not every case; the import test catches a check that is imported, not one written inline.

### This tutorial's decisions, where the rules are silent

- **The header names:** `Idempotency-Key`, as many payment APIs spell it, and `DSoR-Tenant`,
  `DSoR-Mode`, `DSoR-Request-Id`, `DSoR-Supersedes`, `DSoR-Agent-Asserted`.
- **The port:** 8042, unless `DSOR_HTTP_PORT` names another.
- **The 18 routes:**

```text
GET  /invoices/{id}        invoice.get          POST /payments/execute     payment.execute
GET  /invoices             invoice.list         POST /payments/reconcile   payment.reconcile
GET  /alerts               alert.list           POST /payment-runs         payment.run
POST /invoices/issue       invoice.issue        POST /proposals/approve    proposal.approve
POST /payments             payment.create       POST /proposals/execute    proposal.execute
POST /payments/cancel      payment.cancel       POST /delegations/revoke   delegation.revoke
POST /controls/suspend     control.suspend      POST /controls/lift        control.lift
POST /rules/draft          rule.draft           POST /rules/activate       rule.activate
POST /rules/suspend        rule.suspend         POST /rules/retire         rule.retire
```

- **The statuses:**

```text
200  COMMITTED, VALIDATED, and a query's answer
202  READY, PENDING_APPROVAL: waiting is a result, not an error
401  AUTHENTICATION_REQUIRED
403  AUTHORIZATION_DENIED, TENANT_MISMATCH, DELEGATION_REQUIRED, DELEGATION_EXPIRED, DELEGATION_REVOKED,
     POLICY_DENIED, SOD_VIOLATION, AGENT_SUSPENDED, OPERATION_FROZEN, APPROVAL_REQUIRED
404  RESOURCE_NOT_FOUND, UNSUPPORTED_CAPABILITY
409  CONFLICT, IDEMPOTENCY_CONFLICT, STALE_STATE, APPROVAL_EXPIRED, APPROVAL_MISMATCH,
     APPROVAL_INVALIDATED, RESOURCE_HELD, OUTCOME_UNKNOWN, BATCH_PARTIAL
422  VALIDATION_FAILED
429  LIMIT_EXCEEDED, RATE_LIMITED, COOLING_OFF_ACTIVE                         (after_delay)
500  INTERNAL_ERROR                                                           (A3)
503  CONNECTOR_UNAVAILABLE, TRANSACTION_FAILED, EVIDENCE_STORE_UNAVAILABLE    (safe_same_key)
     FRESHNESS_UNSATISFIABLE                                                  (after_delay)
504  DEPENDENCY_TIMEOUT                                                       (safe_same_key)
```

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | Each route reaches `call()` once, with the operation its row names; a request target that is no URL, and a body cut off mid-upload, are recorded, and the door answers the next request; `/alerts/../invoices/INV-1008` is no route; on PostgreSQL, the decision is in `dsor.audit` |
| C2 | The shipped table passes start-up; a row with an unknown operation, a second row for one operation, a contract with no row and not inside, and a row for one of the four system jobs are each refused |
| C3 | Each header becomes its field; a missing `Authorization` gives no token; `Basic …` and a bare `tok_d4e8` are handed over as `authorization`, never as a token; two `DSoR-Tenant` lines and two `Authorization` lines are refused by `call()`; `DSoR-Token`, `DSoR-Idempotency-Key`, `DSoR-Tenantt`, and `DSoR_Mode` are refused at line ①; `DSoR-Agent-Asserted` that is not JSON is handed over as text |
| C4 | `GET /invoices/INV-1008` reads org_456's bill, and with org_789 or no company it is refused; `?limit=2` pages; `?limit=two` and `?colour=red` are refused by line ⑥; broken JSON is refused by line ⑥ for cfo_100 and by line ① for nobody |
| C5 | An unknown route, for cfo_100 and for nobody, is answered by `call()` and recorded; a body of 1 MiB, and broken JSON, are answered 422 for user_123 and 401 for nobody, recorded; no more than 64 KiB is kept; a body that is not UTF-8 is 422; `Expect: nope` is answered by `call()`, not by Node's 417 |
| C6 | Every code of §28 has exactly one status; none with a retry class other than `safe_same_key` or `after_delay` gets a repeated status, except `INTERNAL_ERROR`; `OUTCOME_UNKNOWN` from a silent bank is 409, its body unchanged; a 401 carries `WWW-Authenticate: Bearer` |
| C7 | Start-up on `0.0.0.0` or `::` is refused; on `127.0.0.1` it listens |
| C8 | 756 cases, 18 routes by six callers by seven envelopes, through a spy around `call()`: exactly one ask, with exactly the request sent, and exactly its answer back; the list of routes with a case let through; every module the door's files name, dynamic imports too; every import from the envelope, the log, and the registry is of types only; `pnpm serve` makes the door only with `doorOver` |
| C9 | A `Host` of `attacker.example:<port>`, `localhost:<port>`, `127.0.0.1:1`, `127.0.0.1` with no port, and no `Host` at all: each 421, an envelope that passes the schema, and no record; `127.0.0.1:<port>` reaches `call()` |

### The learner's predictions

Asked in the understanding session as gut calls, each settled at once by a real run on step 41b's
code. They are in [`../mj_42_why_this_step.md`](../mj_42_why_this_step.md): P1 (a thin door, no
token: refused and recorded) and P5 (a 503 retried with new keys: one transfer) were right; P2, P3,
and a re-check missed on one idea, "DSoR sees every request"; P4 missed on the company in the path.
The breaks below were not predicted: the learner chose to build first.

### The breaks

| Break | What it changes |
|---|---|
| B1 | A side door: `GET /invoices/{id}` reads the store itself |
| B2 | The door answers 401 itself to a request with no `Authorization` |
| B3 | The door lets only a CFO call `POST /proposals/approve` |
| B4 | A route for `proposal.expire_due` |
| B5 | A header given twice: the door keeps the first value |
| B6 | `OUTCOME_UNKNOWN` mapped to 503 |
| B7 | No cap: the door reads a body of any size |
| B8 | Broken JSON answered 400 by the door |
| B9 | `GET /invoices/{id}` builds the address with `org_456`, whatever the header says |
| B10 | The server listens on `0.0.0.0` |

## What changed since step 41b

| File | What changed |
| --- | --- |
| `src/routes.ts` | **New.** The 18 routes, the four operations that stay inside, the start-up check of the table against the contracts, and the match of a method and a path (C2) |
| `src/door.ts` | **New.** An HTTP request turned into the operation's name, the envelope, and the input; every value handed over as it came (C3, C4, C5) |
| `src/statuses.ts` | **New.** One status for each code of §28, chosen by its retry class (C6) |
| `src/server.ts` | **New.** The door on `node:http`: `createDoor` gets one function that asks `call()`, and `doorOver` makes that function from a registry and a log; the body read up to 64 KiB; the answer as the body; `listen` only on `127.0.0.1` (C1, C5, C7) |
| `src/serve.ts`, `package.json` | **New program**, `pnpm serve`: the start-up checks of `pnpm start`, then the door over the database |
| `test/routes.test.ts`, `test/door.test.ts`, `test/statuses.test.ts`, `test/server.test.ts`, `test/no-checks.test.ts`, `test/server.db.test.ts` | **New.** The claims C1 to C8, in memory and on PostgreSQL |

No earlier file changed. The checklist, the stores, and the migrations are step 41b's.

```bash
git diff --no-index ../mj_41b_replace_a_waiting_proposal/src src
git diff --no-index ../mj_41b_replace_a_waiting_proposal/test test
```

## Run it

As in step 41b: a local PostgreSQL 17 and a new database of its own. No migration is new.

```bash
pnpm install
pnpm migrate
pnpm test:db test/server.db.test.ts
pnpm serve          # DSoR's door listens on http://127.0.0.1:8042
```

Then, in a second terminal, call it with `curl`. A real run on 2026-10-23, on a new database. The
request ids and the proposal's id change from run to run; the answers are otherwise as printed:

```bash
curl -H 'Authorization: Bearer tok_d4e8' -H 'DSoR-Tenant: org_456' http://127.0.0.1:8042/invoices/INV-1008
```

```text
1. cfo_100 reads INV-1008                                            HTTP 200
{"data":{"tenant_id":"org_456","id":"INV-1008","vendor_id":"VENDOR-44","amount":{"value":"31400.00","currency":"USD"},"open_amount":{"value":"31400.00","currency":"USD"},"status":"issued","version":1},"classification":"confidential","freshness":{…},"correlation":{"request_id":"req_b22bf537-…","principal_id":"cfo_100"}}
2. the agent reads INV-1008                                          HTTP 200
{"data":{"tenant_id":"org_456","id":"INV-1008","vendor_id":"VENDOR-44","status":"issued","version":1},"classification":"internal","redactions":[{"field":"amount","reason":"clearance","treatment":"omitted"},{"field":"open_amount","reason":"clearance","treatment":"omitted"}],…}
3. nobody reads INV-1008                                             HTTP 401
{"code":"AUTHENTICATION_REQUIRED","message":"log in first: the call has no login token that DSoR gave","retry":"never",…}
4. user_700 (org_789) names org_456                                  HTTP 403
{"code":"AUTHORIZATION_DENIED","message":"the caller may not work in the tenant it named","retry":"never",…}
5. the agent drafts INV-1008, 31,400.00 USD                          HTTP 202
{"outcome":"PENDING_APPROVAL","proposal":"dsor://org_456/proposal/prop_acbb0543-…","payload_hash":"sha256:f9e407e3…","requires":[{"approval":{"role":"CFO","quorum":1},"control":"high-value-payment","control_version":8}],…}
6. DELETE /payments/PAY-901, a route that does not exist             HTTP 404
{"code":"UNSUPPORTED_CAPABILITY","message":"no operation named \"DELETE /payments/PAY-901\"","retry":"never",…}
7. cfo_100 approves the proposal of 5 from her phone                 HTTP 200
{"outcome":"COMMITTED",…,"data":{…,"state":"APPROVED","waits_for":[]},…}
8. the agent releases it                                             HTTP 200
{"outcome":"COMMITTED",…,"data":{"tenant_id":"org_456","id":"PAY-901","invoice_id":"INV-1008","vendor_id":"VENDOR-44","status":"draft","version":1},"redactions":[{"field":"amount",…}],…}
```

Eight requests, eight decisions in `dsor.audit`, read as the owner (sequence, operation,
decision, result). Every refusal is there, the unknown route too:

```text
1|invoice.get@1|ALLOW|ok
2|invoice.get@1|ALLOW|ok
3|invoice.get@1|DENY|AUTHENTICATION_REQUIRED
4|invoice.get@1|DENY|AUTHORIZATION_DENIED
7|payment.create@1|ALLOW|PENDING_APPROVAL
8|(none)|DENY|UNSUPPORTED_CAPABILITY
14|proposal.approve@1|ALLOW|ok
17|proposal.execute@1|ALLOW|ok
```

The door made none of these answers. Line ① refused 3, line ② refused 4, the masking of step 14 cut
2, the company's rule made 5 wait, and an unknown name refused 6.

## Break it

Each break was made on 2026-10-23 in a copy of this folder outside the repository, one at a time,
against the final code, and the door's five unit test files were run against it:
`test/routes.test.ts`, `test/door.test.ts`, `test/statuses.test.ts`, `test/server.test.ts`, and
`test/no-checks.test.ts`, 841 tests. The learner chose to build first, so these were not predicted.

| Break | What it changes | What caught it |
|---|---|---|
| B1 | A side door: `doorOver` answers `invoice.get` from the store itself | 3 tests: C1 sees no record, and two tests that read INV-1008 through the door. C8 cannot see it, since C8 builds its own door around a spy; C1 is the guard |
| B2 | The door answers 401 itself to a request with no token | 131 tests: every "nobody" case of C8, and C5's unknown route, big body, and broken JSON |
| B3 | The door lets only a CFO call `POST /proposals/approve` | 35 tests: C8 for each other caller and each envelope. cfo_100's cases pass, as the door lets her through |
| B4 | A route for `proposal.expire_due`, and it leaves the list of the four | 3 tests: the shipped table, the route for a system job, and C8's list of routes |
| B5 | A header given twice: the door keeps the first value | 2 tests: two `DSoR-Tenant` lines, and two `Authorization` lines |
| B6 | `OUTCOME_UNKNOWN` mapped to 503 | 4 tests, the silent bank through the real door among them |
| B7 | No cap: the door keeps a body of any size | 1 test: one byte over 64 KiB is kept |
| B8 | Broken JSON answered 400 by the door | 1 test. **At first nothing caught it:** the translation was tested, and no test sent broken JSON through the real server. The test was added red against B8 |
| B9 | `GET /invoices/{id}` builds the address with `org_456`, whatever the header says | 9 tests: the header's org_789, no header, and C8's cases of user_700 of org_789 |
| B10 | `listen` takes any address | 4 tests, one for each address it must refuse |
| B11 | The `Host` check switched off (built after the others, for D8) | 5 tests: every refused `Host`, and none at all |

The review planted four more door checks, which the first proof of DSOR-OPR-04b missed (Think it
through, M1). Against the final proof, `test/no-checks.test.ts`:

| Check | Tests that fail |
|---|---|
| Refuse any request with `DSoR-Tenant: org_789` | 126 |
| Refuse the agent in `execute` mode, "agents propose only" | 18 |
| Drop the agent's `supersedes` | 18 |
| Refuse a run of more than one line | 43 |

What B3 shows: the door's own check lets cfo_100 through, so her case could never catch it. Only a
caller the door turns away shows the second rulebook: `call()` is never asked, and the door's 403
is not what `call()` would answer.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run of step 41b's code; five parts, each with a prediction settled by a real run |
| 2 | Decide | D1 to D7, A1, and A2 by the learner, one at a time; A3 and A4 by Claude Code, after the learner said "build first" |
| 3 | The copy | Step 41b copied, its markers removed |
| 4 | Build, piece by piece | Six pieces, each with its tests written first and seen red: the design; the routes; the translation; the statuses; the server; the proof that the door adds no check; then `pnpm serve` over the database |
| 5 | Break it | The breaks, for real, in a copy |
| 6 | Review | A reviewer who had not seen the conversation; its findings fixed or recorded; M4 answered by the learner's D8, then built red first |

To start it in a new session:

```text
Build step 42 in learner mode from the design in
docs/baby_steps_tutorials/mj_42_a_rest_api/README.md and the decisions in
docs/baby_steps_tutorials/mj_42_why_this_step.md.
```

## Check yourself

1. cfo_100's phone sends `GET /invoices/INV-1008` with no `Authorization` header. What status does
   she get, and does `dsor.audit` hold a record of it?
   <details><summary>Answer</summary>401, with <code>AUTHENTICATION_REQUIRED</code> in the body, and yes: the door handed the request to <code>call()</code>, and line ① refused it and recorded it before the answer. Run 3 above.</details>
2. Why is there no route for `proposal.expire_due`, and what does `POST /proposals/expire_due` get?
   <details><summary>Answer</summary>Only DSoR's own scheduler runs it (D1), so it stays inside the program. The request is on no route, so <code>call()</code> gets the name <code>"POST /proposals/expire_due"</code>, which no contract has: 404, <code>UNSUPPORTED_CAPABILITY</code>, recorded.</details>
3. A library retries every 503 by itself. Why does `OUTCOME_UNKNOWN` get 409, when the money is safe
   either way?
   <details><summary>Answer</summary>The key replays the answer and the hold refuses a new key (steps 20 and 37), so the money is safe. But the retry class says "after reconciliation", and a 503 tells the library "try again now". The status should say what the body says (D4).</details>
4. A developer adds "only a CFO may call `POST /proposals/approve`" to the door, as a safety. What
   breaks, and which test notices?
   <details><summary>Answer</summary>With a second rule asking a tenant administrator too, admin_100 hears 403 from the door and INV-1008 waits until it expires; nothing records the try. <code>test/no-checks.test.ts</code> notices: for admin_100, user_123, the agent, user_700, and nobody, <code>call()</code> is never asked, and the 403 is not its answer. See break B3.</details>
5. `GET /invoices/INV-1008` with `DSoR-Tenant: org_789` and cfo_100's token. Who refuses it?
   <details><summary>Answer</summary>Line ②: cfo_100 may not work in org_789. The door built <code>dsor://org_789/invoice/INV-1008</code> from the header with one fixed template, and decided nothing.</details>

## Think it through

### Found while building

- **The first proof of DSOR-OPR-04b was weak.** It compared the door with `call()` in two worlds,
  for four callers of one company, with no mode and no other field. The review planted four door
  checks it did not see (below, M1). Asking "would it fail if the rule were broken?" of each test
  is the habit from step 02; this one failed it.
- **A read's time differs on every call.** Two answers to the same read differ by a millisecond in
  `observed_at`, as step 15 found. The first proof set it aside; the second needs no two worlds.
- **`fetch` will not send an `Expect` header.** The test of M3 sends its request on a socket of its
  own.
- **cfo_100 may not draft a payment.** The broken-JSON test first used her, and line ⑤ refused her
  before line ⑥ could see the JSON. The test uses user_123.

### What the review found

A reviewer who had not seen the conversation read the step against DSOR-OPR-04a and DSOR-OPR-04b,
treated every HTTP caller as an attacker, and broke the code in a copy.

| | Finding | What was done |
|---|---|---|
| H1 | One request stopped the whole program: a target that is no URL (`GET http://a:99999/x`), or a body cut off mid-upload, threw in the handler, and Node ends the process | Fixed red first: the door matches the path as text and never parses a URL, a cut-off body is marked and goes to `call()`, and a last guard closes only the one connection (C1, C5) |
| M1 | The proof missed four door checks: refusing org_789, refusing the agent in `execute` mode, dropping `supersedes`, refusing a run of two lines; and 10 routes had no caller DSoR let through. The door held the whole registry, so a check could read a store inline | Fixed: the door gets one function that asks `call()`; C8 checks, through a spy, that `call()` gets exactly the request and the door gives back exactly the answer, for six callers and seven envelopes. All four checks and B3 now fail it. 12 routes have a case let through |
| M2 | The import test missed a dynamic `import()` and a second import from one file | Fixed: every module a file names is listed, and every import from the envelope, the log, and the registry must be of types only. Both bypasses fail it |
| M3 | Node answered some requests itself: 417 for an `Expect` it does not know, 400 for a request it cannot parse, 431 for headers over 16 KiB; `CONNECT` was closed | 417 fixed: `call()` answers it. The other three are Node's, before the door sees a request; C5 now names them |
| M4 | DNS rebinding defeats D7. The door did not check the `Host` header, so a web page whose name is made to point at 127.0.0.1 could call it, with the public `tok_d4e8` | Asked as Q1; the learner chose (a), D8, built red first (C9) |
| L1 | Two spellings of one field: `DSoR-Token`, `DSoR-Idempotency-Key`, and an `Authorization` with no scheme all counted | Fixed: one header for each field (C3) |
| L2 | The URL parser rewrote paths: `/alerts/../invoices/INV-1008` became `invoice.get` | Fixed with H1: the path is matched as it was sent |
| L3 | `DSoR_Mode`, with an underscore, was dropped, so a dry run ran for real | Fixed: any header that starts with `dsor` is handed over, and refused |
| L4 | A 401 had no `WWW-Authenticate`; `INTERNAL_ERROR` is 500 against D4's own rule | The header is added. 500 stays, as A3 says, with its downside |
| L5 | The 127.0.0.1 guard is in `listen` only: `createDoor(...).listen(8042)` binds to every address | Recorded. `pnpm serve` calls `listen` |
| L6 | A body that is not UTF-8 was decoded with guesses, so two bodies could become one input | Fixed: such a body is never decoded; `call()` gets a short text |
| L7 | C5 said a big body is not read past 64 KiB; it is read to its end, and only 64 KiB is kept | C5 corrected |
| L8 | Nothing ran `pnpm serve`'s own start-up | Partly: a test checks it makes the door only with `doorOver` and adds no handler. Its start-up refusals are not tested |
| L9 | "Door" is not on the list of established analogies, and step 07's review once replaced it with "interface" | Kept: "front door" is the map's own name for Part 6, and "side door" is §39's. Here it names the HTTP server, not a picture of something else |
| L10 | Check yourself 4 named admin_100 among C8's callers, who was not one | Now true: admin_100 is one of the six |

### Q1, answered: the door checks the `Host` header (the review's M4)

**The problem.** The door listens only on 127.0.0.1 (D7), so no other computer can reach it. But a
web page can. Say the developer opens `attacker.example` in a browser. That site makes its own name
point at 127.0.0.1 a moment later ("DNS rebinding"). Its script then calls
`http://attacker.example:8042/proposals/approve`, the browser sends it to this computer, and a door
that never looks at `Host` answers. The token `tok_d4e8` is public, so the page could approve as
cfo_100.

**The options were:** (a) the door refuses a `Host` that is not its own address, with 421, a check of
the transport; (b) the door hands `Host` to `call()`, so the checklist learns about HTTP; (c) wait for
step 43's real logins, while any page could act as anyone.

**The learner chose (a), decision D8**, built red first. The real door, from `curl`:

```text
1. cfo_100 reads INV-1008, Host 127.0.0.1:8042 (curl's own)
   HTTP 200
2. the same, as a rebinding page would send it: Host attacker.example:8042
{"code":"VALIDATION_FAILED","message":"this door answers only requests for 127.0.0.1 and its own port, named in the Host header","retry":"never","correlation":{"request_id":"req_1c62a192-…"}}
   HTTP 421
```

### Left open on purpose

- **Six routes have no case let through:** `control.lift` needs a brake pulled, `invoice.issue` a
  draft invoice, `payment.reconcile` an unknown outcome, `proposal.execute` an approved proposal,
  `rule.draft` a whole draft, and `rule.activate` a drafted version. C8 still proves that the door
  hands their requests over and their refusals back.
- **No real login.** `Authorization: Bearer tok_d4e8` is step 05's fake table. Step 43 replaces it.
- **No TLS, and no limit on how many requests a caller sends.** Both belong to a server that listens
  beyond 127.0.0.1.
- **`pnpm serve`'s start-up refusals are not tested**, as `pnpm start`'s are in earlier steps.
- **Two questions for the specification:** open questions 162 (an HTTP status for each code) and
  163 (which transport refusals an interface may make by itself).


## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-OPR-04a | Every interface invokes the same pipeline | [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | `test/server.test.ts`, C1; `test/server.db.test.ts` |
| DSOR-OPR-04b | An interface implements no business authorization of its own | [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | `test/no-checks.test.ts`, C8 |

The routes, the translation, the statuses, and the address the door listens on are this tutorial's
decisions: those tests are titled by step 42's decisions D1 to D7 and A1 to A3.

**Next:** step 43, real logins for people: Managed Better Auth replaces the fake `tok_…` logins of
people. Agents keep theirs until step 44, so the door stays on `127.0.0.1` until then.
