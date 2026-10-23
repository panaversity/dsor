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

## The learner's decisions

Not asked yet.

## The learner's predictions

Not asked yet.

## How to continue in a new session

```text
Step 42 is being understood, not built. Read docs/baby_steps_tutorials/mj_42_why_this_step.md
for the problem, the run, the rules, and the learner's decisions so far.
```
