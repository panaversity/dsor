# Step 42 · Why this step: a REST API

This note keeps the context of step 42 before any design or code. A new session can start
from it. It holds the problem, a real run of it, what the rules say, what is built today, and
the questions for the learner. Every decision in it is the learner's, asked one at a time.

## Where we are

- **Part 5 is complete**, and so is the learner's extra step 41b (`b3650a19`).
- **Step 42 is the first step of Part 6, "Real front doors".** The map's entry: "An HTTP server
  over the same pipeline. It contains no checks of its own. Callers still use the fake login
  header for one more step."
- **The steps after it** put real logins behind the door: people in step 43 (Managed Better
  Auth), agents in step 44 (Better Auth as an OAuth server), an agent that acts for a person in
  step 45, and the MCP server in step 46. Step 42 changes only *how a call arrives*.

## The problem, in plain words

Since step 07, DSoR is one function, `call()` in `src/pipeline.ts`. It takes the request
envelope (who calls, in which company, with which key and mode), the operation's name, and the
input. It runs the checklist and gives an answer.

Only code inside the same Node program can call a function. The tests can. `pnpm start` can.
Nothing outside can: not cfo_100's phone, not a dashboard, not the accounts system, not `curl`.
DSoR has no front door.

The danger comes when someone adds one. The easy way to build an HTTP endpoint is to read the
database in the handler. That door skips the checklist: no login, no company check, no masking,
and no record in the log. The rules call that a side door, and forbid it.

## The problem, run for real

A real run on 2026-10-23, on step 41b's finished code (`b3650a19`), in memory, from a script in
the session's scratchpad that imports the step's `src/`. The labels are the script's; the answers
are DSoR's own. Part 3 is a sketch of a bad door, not DSoR code.

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

A search of step 41b's `src/` finds no `createServer` and no `listen(`.

## Why it matters

1. **Nobody outside can use DSoR.** cfo_100 cannot approve PAY-901 from her phone. The accounts
   system cannot ask for INV-1008. Every story so far ran inside one program.
2. **The fast way to add a door breaks every guarantee at once.** Run 3 above: a caller with no
   login reads INV-1008's 31,400.00 USD, and the log shows nothing. The checklist was there, and
   the door did not use it.
3. **A door with checks of its own drifts.** If the door says "only a CFO may approve", that is a
   second rulebook. Step 30 already lets an AP supervisor approve payments above 10,000 USD under
   one rule. The door would not know, and the two rulebooks would disagree.

## What the rules say

From [§7](../../specs/dsor/01-model.md#7-operations-and-the-operation-contract):

- **DSOR-OPR-04a:** "Every interface MUST invoke the same DSoR pipeline (§21)."
- **DSOR-OPR-04b:** "An interface MUST NOT implement its own business authorization." This is the
  map's rule id for step 42.

From [§39](../../specs/dsor/05-bindings.md#39-rest-and-sdk-interfaces): "MCP is for agents. REST
and SDKs are for applications and people. All of them enter the same checklist. There is no side
door." Its example names `invoice.get` as `GET /invoices/{id}`. And: "The invocation mode,
idempotency key, expected version, and correlation identifiers have one canonical representation
per interface, documented by the implementation."

From [§45](../../specs/dsor/06-conformance.md#45-security-invariants): "No interface owns
authorization", proved by DSOR-OPR-04a, DSOR-OPR-04b, and DSOR-RP-09a. DSOR-RP-09a is the MCP
rule: decide on the parsed request body, never on a header that names the tool.

**What the specification leaves to the step.** It names no HTTP status for any answer, no
header for the envelope, no URL for any operation but `invoice.get`, and no framework. The
[§28](../../specs/dsor/03-execution.md#28-result-and-error-envelopes) envelopes stay the answer's
body; how HTTP carries them is the step's choice.

## What is built today, at step 41b

- One pipeline, `call()`, with 22 operations in `contracts/`, from `invoice.get` to
  `payment.run` and `alert.list`.
- A closed request envelope (`src/request.ts`): `token`, `tenant`, `request_id`,
  `idempotency_key`, `mode`, `agent_asserted`, `supersedes`. Any other field is refused.
- The fake login: `token` is looked up in DSoR's own table, `logins` in `src/principals.ts`
  (`tok_d4e8` is cfo_100). Step 43 replaces it for people.
- Every answer is a §28 envelope with a retry class; every decision is recorded before the
  answer (DSOR-EXE-02).
- No HTTP server, no port, no route.

## The parts of the understanding session

1. **The missing front door.** `call()` is a function; nothing outside the program reaches it.
2. **One checklist behind every door** (DSOR-OPR-04a). A door only translates: HTTP in, envelope
   and input to `call()`, the answer back out. The side door of run 3.
3. **A door with no rules of its own** (DSOR-OPR-04b). Why "only a CFO may approve" in the door
   is a second rulebook, even when it agrees today.
4. **The envelope on the wire.** Where the token, company, key, mode, and request id ride in an
   HTTP request, and what happens when two places disagree (the idea of DSOR-RP-09a).
5. **DSoR's answer as an HTTP status.** Proxies and HTTP libraries retry some statuses on their
   own. An `OUTCOME_UNKNOWN` that looks like "try again" could pay PAY-901 twice (DSOR-ERR-02's
   idea).

## The questions for the learner

Each is a choice that the specification leaves to the step. Ask them one at a time, with the
trade-off of each option, and wait.

1. **The shape of the URLs.** One route for each resource, as §39's example (`GET /invoices/{id}`,
   `POST /payments`), or one route for all, with the operation's name in the path
   (`POST /operations/invoice.get`)?
2. **Where the envelope rides.** In HTTP headers (`Authorization: Bearer tok_d4e8`,
   `Idempotency-Key`, a header for the company), or in the JSON body beside the input?
3. **Which HTTP status.** Every answer `200` with the envelope in the body, or each code its own
   status (`401`, `403`, `404`, `409`, `422`, `429`)? And which status for `OUTCOME_UNKNOWN`, so
   that nothing between the caller and DSoR retries it?
4. **Which operations get a door.** All 22? Also the ones only `dsor-scheduler` runs, such as
   `proposal.expire_due`? Or a list, and the rest stay inside?
5. **A request the door cannot read.** Bad JSON, a body that is too big, a wrong content type.
   Does the door refuse it alone, or hand it to `call()` so that DSoR refuses and records it?
6. **The tool.** Node's own `node:http`, with no new dependency, or a small framework from the
   catalog?
7. **Where it listens.** Only `127.0.0.1` until real logins arrive in step 43, or any address?

## The learner's decisions (2026-10-23)

Asked one at a time with AskUserQuestion, after the five parts. The learner took the recommended
option each time.

- **D1. The 18 operations for people get a route.** Every operation a person or an app calls. The
  four that only DSoR's own system logins call stay inside the program: `proposal.expire_due`,
  `alert.escalate_due`, `rule.check_authority` (`dsor-scheduler`), and `rate.load` (`dsor-rates`).
  *Downside:* 18 routes to test, and a list to keep in step with the contracts.
- **D2. Resource routes**, as §39's example: `GET` for the queries (`GET /invoices/{id}`), `POST`
  for the commands (`POST /payments`, `POST /proposals/{id}/approve`). The door holds a table from
  route to operation name, and start-up checks it against the contracts: each route names a
  contract, and no contract has two routes. Not `POST /operations/{name}`, which reads as the
  generic invoke DSOR-OPR-03a forbids on a surface an agent can reach. *Downside:* 18 rows to
  write, and start-up must refuse a table that drifts.
- **D3. The envelope rides in headers; the body is the input only.** `Authorization: Bearer
  <token>`, `Idempotency-Key`, and `DSoR-Tenant`, `DSoR-Mode`, `DSoR-Request-Id`,
  `DSoR-Supersedes`, `DSoR-Agent-Asserted`. The envelope stays beside the input, as since step 05;
  step 43 changes only what the `Authorization` header means. *Downside:* `agent_asserted` is JSON
  inside a header, and some proxies drop headers they do not know.
- **D4. Statuses mapped by retry class.** The body is always the §28 envelope. One status for each
  code, from a fixed table; a status that HTTP libraries retry by themselves (408, 429, 500, 502,
  503, 504) only for a code whose retry class is `safe_same_key` or `after_delay`. So
  `OUTCOME_UNKNOWN` and `RESOURCE_HELD` are 409, and `READY` and `PENDING_APPROVAL` are 202.
  *Downside:* a table to keep in step with §28, and a test that every code has exactly one status.
- **D5. The door hands over everything it can.** It refuses only what it cannot hand over: a body
  over its size cap (413), and a route with no operation (404). Broken JSON, a header sent twice,
  or an unknown `DSoR-*` header go to `call()` as they are, so line ① asks who calls first
  (DSOR-IDN-01) and line ⑥ refuses, recorded. *Downside:* odd values reach `call()`, and its checks
  must hold for them.
- **D6. Node's own `node:http`.** No new dependency, and no framework that parses the body or
  answers 400 before `call()`. *Downside:* more of our own code to test, such as a slow or cut-off
  body.
- **D7. Only `127.0.0.1`.** While the fake logins exist (`tok_d4e8` is cfo_100, in a public file),
  start-up refuses any other address. Step 43 lifts this. *Downside:* cfo_100's real phone cannot
  try it yet.

## Settled in Phase A, then built (2026-10-23)

- **A1. An id goes in the path only when there is no body** (the learner's). Only
  `GET /invoices/{id}` has one; it builds `dsor://<DSoR-Tenant>/invoice/<id>` with one fixed
  template. Every command takes its whole input in its body.
- **A2. The door has no answer of its own** (the learner's; it revises D5). An unknown route goes to
  `call()` as `"<METHOD> <path>"`; a body over 64 KiB is cut off and `call()` gets a short text.
- **A3. The status table, `INTERNAL_ERROR` as 500 (Claude Code's).** The learner sent "build first and
  we discuss later" before answering.
- **A4. How DSOR-OPR-04b is proved (Claude Code's).** A spy around `call()`: for 18 routes, six
  callers, and seven envelopes, `call()` gets exactly the request and the door gives back exactly its
  answer; and an import test.

Then step 42 was built, reviewed, and broken on purpose; see its README, "Break it" and "Think it
through". The review's M4 is a question for the learner:

**Q1. Should the door check the `Host` header?** A web page can make its own name point at 127.0.0.1
(DNS rebinding) and call the door with the public `tok_d4e8`. The options are in step 42's README:
(a) the door refuses a `Host` that is not its own address, with 421, a transport check (recommended);
(b) the door hands `Host` to `call()`; (c) wait for step 43's real logins. Not built until the learner
answers.

## The learner's predictions (2026-10-23)

Asked as gut calls with "how sure", before each explanation, and each settled at once by a real
run on step 41b's code: in memory from a scratch script, or in a scratch copy of the step without
its `.env`. Every door in these runs is a sketch in the scratchpad, not DSoR code.

| | The story | The learner's answer | The real run |
|---|---|---|---|
| P1 | A door that only translates. cfo_100's phone sends `GET /invoices/INV-1008` with no token | DSoR refuses, recorded (guessing) | Right: `AUTHENTICATION_REQUIRED`, one record, DENY |
| P2 | A side door reads the store with the company of an `X-Tenant` header. user_700 of org_789 names org_456 | Refused, recorded (sure) | Missed: user_700 reads INV-1008, 31,400.00 USD; 0 records. Only the door that calls `call()` refuses and records |
| P3 | The door lets only a CFO approve. Two rules ask for a CFO and a tenant administrator; cfo_100, then admin_100, approve INV-1008 | APPROVED (sure) | Missed: the door answers 403 to admin_100, `call()` never runs, INV-1008 stays `PENDING_APPROVAL`; 1 record for 2 tries |
| P3' | Re-check: a door answers 401 itself to a request with no `Authorization` header. The agent's `POST /payments` forgets it | A DENY record | Missed: two real HTTP servers; the door that checks first leaves 0 records, the thin door leaves 1, DENY |
| P4 | A thin door takes the company from the path. user_700 sends `POST /org_789/payments` with org_456's INV-1008 in the body | A draft in org_789 (sure) | Missed: `TENANT_MISMATCH`, recorded; step 10's check of every address in the input (`src/tenants.ts:85`) |
| P5 | The door maps `OUTCOME_UNKNOWN` to 503; a library retries 503 with a new key each time. Transfers of PAY-901? | One (sure) | Right: try 2 hears `RESOURCE_HELD` (step 37); one transfer. With the same key, every try replays `OUTCOME_UNKNOWN`; one transfer |

**The idea behind the misses of P2, P3, and P3'.** Asked which idea led there, the learner chose all
four offered: every request reaches DSoR; only DSoR's rules count; every refusal is recorded; "the
door calls `call()`". The one root: DSoR's guarantees hold for the calls that reach `call()`, and a
door is code that runs before it. DSoR is blind to every line a door runs first. P4's miss is
Habit 2: the path and the membership were in view, the address inside the body was not.

## How to continue in a new session

```text
Step 42 is built: docs/baby_steps_tutorials/mj_42_a_rest_api/README.md. The learner reviews A3 and
A4 (Claude Code's) and answers Q1 (the Host header) before step 43.
```
