# Step 45b · Protect the sign-in server

**New in this step:** calls about the same person share one question to the company's sign-in
server, and after five failures in a row DSoR stops asking that server for 10 seconds, so that
DSoR never floods the server it depends on (DSOR-IDN-06, DSOR-TEN-02a).

## In plain words

Step 45 made DSoR ask each company's sign-in server who a person is now. DSoR uses an answer again
for 10 seconds, and it waits at most 2 seconds for a reply. Two moments are still hard on the
server.

The first is a crowd. When the 10 seconds about `user_123` end and many calls under `del_100`
arrive together, none of them finds an answer to use again, so each one asks. The second is an
outage. When the server is down, every call asks it and waits 2 seconds, again and again, while the
server tries to come back.

This step makes DSoR ask once for the crowd: the first call asks, and the calls that arrive while
its question has no reply yet wait for the same reply (D9). And it makes DSoR stop asking a server
that failed five times in a row. For the next 10 seconds, calls use the answers DSoR kept, up to the
company's bound, and a call with no answer young enough is refused at once, with no wait (D10).
When the 10 seconds are over, one call tries the server again (D16).

Think of the new clerk again. When ten slips signed by the same person arrive together, the clerk
phones HR once and reads the answer to all ten. When HR's line has rung out five times, the clerk
stops calling for a while, works from the notes already taken, and later makes one call to see
whether HR is back.

**Words this step uses.**

- A *lookup in flight* is a question to the sign-in server that has no reply yet.
- A *failure* is a lookup that the server cannot answer now: a `429`, a `5xx`, no reply within 2
  seconds, or no connection (step 45). A reply that DSoR cannot use, such as a `403`, is a *fault*,
  not a failure.
- A *run* is the failures in a row since the server last replied.
- The *pause* is the 10 seconds after five failures in a row, when this DSoR server asks that
  company's server nothing.
- The *trial* is the one call that asks again when the pause is over.

## Why it matters

A real run on 2026-10-28, on step 45's code, which is this folder before any change. A test sign-in
server answers for org_456 about `user_123`, and the agent reads INV-1008 under `del_100`.

```text
02:00:11, the 10 seconds are over, and 50 calls under del_100 arrive at once: org_456's server is asked 50 times
02:01 to 02:02, org_456's server takes each question and never answers: 10 calls, 10 questions, 20.2 seconds of waiting in all
```

1. **A crowd asks fifty times.** Fifty questions about one person, in one moment, for one answer.
   In the Panaversity ops story, a coupon agent that runs a batch of 200 renewals at 09:00 sends
   200 lookups about the same ops lead to the SSO.
2. **An outage is hammered.** A server that is down is asked at every call, and every call waits 2
   seconds for nothing. When the server comes back, it meets the next crowd at once.

**Common mistake:** a retry. A call that gets no reply and asks again doubles the load at the moment
the server is weakest. Step 45 already never asks twice in one call. This step goes further: it
stops asking at all, for a while.

## The design, before any code

### How this step was made

D9 and D10 were decided for the whole chain on 2026-10-28, and moved from step 45 into this step to
keep one new idea in each step ([`../mj_decisions.md`](../mj_decisions.md), entries 21 to 23). On
the same day, before any code, the learner took four more decisions, each on Claude Code's
recommendation: D16 and D17 below, and two for later steps (entries 30 to 33).

### What the rules say

From [§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-06:** "When the delegator's current authority cannot be established within the
  staleness bound of §44, DSoR MUST deny the command." It holds through every decision below: pause
  or no pause, a call never acts on an answer older than the company's bound.

From [§14](../../../specs/dsor/02-security.md#14-multi-tenancy):

- **DSOR-TEN-02a:** "Caches, idempotency records, counters, holds, proposals, events, and audit
  partitions MUST be keyed by tenant." A lookup in flight is shared only by calls about the same
  company and the same person, and each company has its own run of failures.

The specification does not say how often DSoR may ask a role source, or what DSoR does while one is
down. Its nearest rule is for connectors, the systems DSoR changes:
[§18](../../../specs/dsor/02-security.md#18-operational-controls)'s connector circuit breaker stops
commands to a failing connector (DSOR-OPS-03a, "DSoR MUST support operation freezes and connector
circuit breakers", at L3). The pause is the same idea for a role source, which §18 does not name. So
the pause is this tutorial's decision, and a call refused during it hears DSOR-IDN-06's
`FRESHNESS_UNSATISFIABLE`, as in step 45, not `CONNECTOR_UNAVAILABLE`.

### The claims

| Claim | What it says |
|---|---|
| C1 | On one DSoR server, while a lookup about a company and a person is in flight, another call about the same pair sends no request, and waits for that lookup's reply (D9) |
| C2 | A call about another person, or about the same person in another company, asks on its own (DSOR-TEN-02a) |
| C3 | Each waiting call checks the shared reply with every rule of step 45, as its own: whom it is about, its time, its status, and the company's bound. Its answer counts from the moment the shared lookup was sent (D13), and its refusal names its own call, never another one |
| C4 | One lookup is one failure, however many calls waited for it. After five failures in a row from one company's server, this DSoR server asks that server nothing for 10 seconds. A call then uses a kept answer under the company's bound, or is refused at once with `FRESHNESS_UNSATISFIABLE`, with no wait (DSOR-IDN-06; D10) |
| C5 | When the pause is over, one call asks: the trial. Until its lookup ends, every other call about that company acts as in the pause, except a call about the same person, which waits for it (D9). If the trial fails, a new pause starts at once (D16) |
| C6 | Any reply, even one DSoR cannot use, ends the run. A fault keeps step 45's meaning: `INTERNAL_ERROR`, and the kept answer is dropped (D17) |
| C7 | Each company has its own run and its own pause: org_456's outage never pauses org_789 (DSOR-TEN-02a) |

### Decisions

Before this step, for the whole chain, on 2026-10-28 (entries 21 and 22 of
[`../mj_decisions.md`](../mj_decisions.md)):

- **D9. One lookup in flight for each company and person, on each DSoR server.** *Downside:* a
  waiting call is only as fast as that one lookup.
- **D10, the rest. After five failures in a row, DSoR stops asking that company's server for 10
  seconds, and uses its kept answers, up to the company's bound.** Like D9, the run and the pause
  live in each DSoR server's memory. *Downside:* for 10 seconds, a server that came back is not
  asked, so a person who left in that window keeps her kept answer a little longer, inside the
  hour. And each DSoR server finds the outage on its own: four DSoR servers make four runs of five
  failures, and a restart forgets the run.

For this step, the learner's, on 2026-10-28, each with Claude Code's recommendation taken:

- **D16. When the pause is over, one call tries the server again.** Until its lookup ends, the other
  calls about that company act as in the pause. If it fails, a new pause starts at once. This is
  what makes the pause protect a server that is coming back: it meets one question, not a crowd.
  *Downside:* for up to 2 more seconds, calls use kept answers though the server may be back.
- **D17. Any reply ends the run, even one DSoR cannot use.** The pause is for a server that cannot
  answer. A server that replies is up, and its fault keeps step 45's meaning. *Downside:* after a
  company takes back DSoR's key, every call still asks, and gets a fast `403`, until someone fixes
  the key.

And two for later steps, also the learner's:

- **A stranger's lookups get a step of their own.** Step 45's review found that anyone with an SSO
  account can name org_456, and each such call spends one of org_456's lookups (finding 2). The fix
  needs numbers of its own: how many lookups about unknown people, in what time. *Downside:* until
  then, a flood of strangers can make org_456's lookups fail, and the pause then keeps org_456 on
  its kept answers.
- **Q8's alert gets a step of its own** (entry 29). An alert in this tutorial belongs to a payment
  (step 38b), and a server that cannot answer needs a kind of alert of its own. *Downside:* until
  then, a company learns of an outage only from refused calls and their records.

### The tests, by claim

The tests ask the test sign-in server of step 45, which gains one switch: it can hold its replies,
and send them when the test says. Only the date is faked, because the network needs real timers.

| Claim | Tests |
|---|---|
| C1 | `D9`: fifty calls under `del_100` at the same moment make one lookup, and all fifty read INV-1008. `D9`: when that one lookup gets no reply, all fifty use the kept answer, and the server was asked once. `D9`: once the lookup has ended, a call 11 seconds later asks again |
| C2 | `DSOR-TEN-02a`: a call about `cfo_100` does not wait for the lookup about `user_123`. `DSOR-TEN-02a`: `user_123`'s own call naming org_789 asks org_789's server, while org_456's lookup about her is in flight |
| C3 | `D9`: when the shared answer is about `cfo_100`, every call that waited is refused with `INTERNAL_ERROR`. `D9`, `D13`: a call that came 1.5 seconds after the lookup was sent records the answer as of the moment it was sent. `D9`: two slips signed by `user_123` that share one `gone` answer are each refused naming their own slip |
| C4 | `D10`: one lookup is one failure, however many calls waited for it. `D10`: after five `503`s in a row the server is asked nothing, and a call with a kept answer under the hour uses it at once. `DSOR-IDN-06`: during the pause, a call with no kept answer young enough is refused with `FRESHNESS_UNSATISFIABLE` at once, though the server hangs. `D10`: four failures, a reply, and four failures start no pause. `D10`: the pause lasts 10 seconds. `D10`: during the pause, `cfo_100`, of whom DSoR keeps no answer, hears the stranger's words at once (DSOR-ERR-01b, as step 45's review fixed it) |
| C5 | `D16`: when the pause is over, one call asks, and a call about someone else meanwhile asks nothing and uses its kept answer. `D16`: a call about the trial's own person waits for it. `D16`: a trial that fails starts a new pause at once. `D16`: a trial that gets a reply ends the pause |
| C6 | `D17`: five `403`s in a row start no pause: the sixth call asks, and is refused with `INTERNAL_ERROR`. `D17`: four `503`s, a `403`, and four `503`s start no pause |
| C7 | `DSOR-TEN-02a`: while org_456's server is paused, org_789's server is still asked |

On PostgreSQL (`*.db.test.ts`): `D9`, `D8`: fifty calls at once still make one lookup when the kept
answers are in `dsor.role_answers`. `D10`, `D8`: during a pause on one DSoR server, a call uses the
answer that another DSoR server kept a moment ago.

### The breaks, with the learner's predictions

The predictions were made before any code, on 2026-10-28. Each break will be made for real in a
copy, and "Break it" will show how each prediction came out.

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · one lookup in flight is removed (D9) | At 02:00:11 the 10 seconds about `user_123` are over, and 50 calls under `del_100` arrive at once | Not asked: the run in "Why it matters" shows it |
| B2 · the shared lookup is found by the person alone, not by the company | `user_123` is an AP supervisor at org_456 and never worked at org_789. At 02:00:11 the agent calls under `del_100` at org_456, and in the same instant `user_123` calls DSoR herself, naming org_789 | She is refused with the words every stranger hears, and org_789's server is never asked |
| B3 · the pause is removed | From 02:01:00 org_456's server takes each question and never answers. DSoR's last answer about `user_123` is from 02:00:45 (active). The agent calls under `del_100` once a second for a minute | Every call waits up to 2 seconds, then pays on the 02:00:45 answer, and the server is asked about every 2 seconds, all minute |
| B4 · a fault counts as a failure | At 01:30 org_456's owner takes back DSoR's key, and the SSO answers `403` to every lookup. DSoR's last answer about `cfo_100` is from 01:29 (active, `CFO`). At 02:00 the agent makes five calls under `del_100`, one a second, each refused. At 02:00:06 `cfo_100` approves PAY-901 | The approval counts, on the 01:29 answer |
| B5 · after the pause, every call asks again | org_456's server is still down when the pause ends at 02:01:20. In the next 2 seconds, calls arrive about 20 different people: a coupon agent's batch for 20 Panaversity ops leads | 20 questions. Each call waits up to 2 seconds, then uses its kept answer or is refused, and the first failure starts a new pause |
| B6 · each waiting call counts its own failure | At 02:00:11, 50 calls under `del_100` share one lookup, which gets no reply in 2 seconds. At 02:00:14 `cfo_100` reads INV-1008, and DSoR keeps no answer about her | Not asked: made by Claude Code |

*The sections from "What changed since step 45" on are written as the step is built.*
