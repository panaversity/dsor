# Step 45b · Protect the sign-in server

**New in this step:** calls about the same person share one question to the company's sign-in
server, and after five questions in a row that the server cannot answer, DSoR stops asking it for 10
seconds. A crowd of calls, or an outage, no longer turns into a crowd of questions (DSOR-IDN-06,
DSOR-TEN-02a).

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
company's bound (its `max_staleness`: one hour for org_456), and a call with no answer young enough
is refused at once, with no wait (D10).
When the 10 seconds are over, one call tries the server again (D16).

Think of the new clerk again. When ten slips signed by the same person arrive together, the clerk
phones HR once, and checks that one answer against each of the ten slips. When HR's line has rung out five times, the clerk
stops calling for a while, works from the notes already taken, and later makes one call to see
whether HR is back.

**Words this step uses.**

- A *lookup in flight* is a question to the sign-in server that has no reply yet.
- A *failure* is a lookup that the server cannot answer now: a `429` (too many requests), a `5xx`
  (the server failed), no reply within 2 seconds, or no connection (step 45). A reply that DSoR
  cannot use, such as a `403` (not allowed), is a *fault*, not a failure.
- A *run* is the failures in a row since the server last replied.
- The *pause* is the 10 seconds after five failures in a row, when this DSoR server asks that
  company's server nothing.
- The *trial* is the one call that asks again when the pause is over.
- The *stranger's words* are what line ② tells anyone who does not work in the company the call
  names: "the caller may not work in the tenant it named" (step 45).

## Why it matters

A real run on 2026-10-28, on step 45's code, which is this folder before any change. A test sign-in
server answers for org_456 about `user_123`, and the agent reads INV-1008 under `del_100`.

```text
02:00:11, the 10 seconds are over, and 50 calls under del_100 arrive at once: org_456's server is asked 50 times
02:01 to 02:02, org_456's server takes each question and never answers: 10 calls, 10 questions, 20.2 seconds of waiting in all
```

1. **A crowd asks fifty times.** Fifty questions about one person, in one moment, for one answer.
   In the Panaversity ops story, a coupon agent that runs a batch of 200 renewals at 09:00 sends
   200 lookups about the same ops lead to the Panaversity SSO, its sign-in server.
2. **An outage is asked again and again.** A server that is down is asked at every call, and every
   call waits 2 seconds for nothing. When the server comes back, it meets the next crowd at once.

**Common mistake:** a retry. A call that gets no reply and asks again doubles the load at the moment
the server is weakest. Step 45 already never asks twice in one call. This step goes further: it
stops asking at all, for a while.

## The design, before any code

### How this step was made

D9 and D10 were decided for the whole chain on 2026-10-28, and moved from step 45 into this step to
keep one new idea in each step ([`../mj_decisions.md`](../mj_decisions.md), entries 21 to 23). On
the same day, before any code, the learner took four more decisions, each on Claude Code's
recommendation: D16 and D17 below, and two for later steps (entries 30 to 33). After the review,
one more for a later step (entry 34).

### What the rules say

From [§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-06:** "When the delegator's current authority cannot be established within the
  staleness bound of §44, DSoR MUST deny the command." It holds through every decision below: pause
  or no pause, a call never acts on an answer older than the company's bound, by DSoR's clock.

From [§14](../../../specs/dsor/02-security.md#14-multi-tenancy):

- **DSOR-TEN-02a:** "Caches, idempotency records, counters, holds, proposals, events, and audit
  partitions MUST be keyed by tenant." The lookups in flight and the runs of failures are keyed by
  company: a lookup is shared only by calls about the same company, and each company has its own
  run. That the calls must also be about the same person is D9's, not this rule's.

The specification does not say how often DSoR may ask a role source, or what DSoR does while one is
down. Its nearest rule is for connectors, the systems DSoR changes:
[§18](../../../specs/dsor/02-security.md#18-operational-controls)'s connector circuit breaker, which
stops sending commands to a connector that keeps failing, for a while (DSOR-OPS-03a, "DSoR MUST
support operation freezes and connector circuit breakers", at L3). The pause is the same idea for a
role source, which §18 does not name. So the pause is this tutorial's decision. A call refused
during it hears `FRESHNESS_UNSATISFIABLE`, as in step 45: the code that step 19 chose for a refusal
under DSOR-IDN-06, which names no code (open question 73). DSOR-FRS-02b names that code, for a
connector. It is not `CONNECTOR_UNAVAILABLE`.

### The claims

| Claim | What it says |
|---|---|
| C1 | On one DSoR server, while a lookup about a company and a person is in flight, another call about the same pair sends no request, and waits for that lookup's reply (D9) |
| C2 | A call about another person asks on its own (D9), and so does a call about the same person in another company (DSOR-TEN-02a) |
| C3 | Each waiting call checks the shared reply with every rule of step 45, as its own: whom it is about, its time, its status, and the company's bound. Every time is measured from the moment the shared lookup was sent: the answer's age (step 45's D13), the one minute ahead, the bound, the 10 seconds of reuse, and what a fault forgets. Its refusal names its own call, never another one |
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
- **Q8's alert gets a step of its own** (entry 29). Q8 is the learner's decision that a company's
  alert receivers hear when DSoR cannot get a fresh answer. An alert in this tutorial belongs to a
  payment (step 38b), and a server that cannot answer needs a kind of alert of its own. *Downside:*
  until then, a company learns of an outage only from refused calls and their records.
- **One person's failing lookups get step 45c too** (entry 34, after the review's finding 2). A
  person whose own lookups fail, say because the SSO errors on her record, pauses org_456 for
  everyone after five of her calls, and can keep it paused by being every trial. Step 45c gives each
  person a memory of her lookups, and there the company's pause can count different people.
  *Downside:* until then, one broken record at the SSO can pause org_456 again and again.

### The tests, by claim

The tests ask the test sign-in server of step 45, which gains one switch: it can hold its replies,
and send them when the test says. Only the date is faked, because the network needs real timers.

| Claim | Tests |
|---|---|
| C1 | `D9`: fifty calls under `del_100` at the same moment make one lookup, and all fifty read INV-1008. `D9`: when that one lookup gets no reply, all fifty use the kept answer, and the server was asked once. `D9`: once the lookup has ended, a call 11 seconds later asks again |
| C2 | `D9`: a call about `cfo_100` does not wait for the lookup about `user_123`. `DSOR-TEN-02a`: `user_123`'s own call naming org_789 asks org_789's server, while org_456's lookup about her is in flight |
| C3 | `D9`: when the shared answer is about `cfo_100`, every call that waited is refused with `INTERNAL_ERROR`. `D9`, `D13`: a call that came 1.5 seconds after the lookup was sent records the answer as of the moment it was sent. `D3`, `D9`: the answer is used again for 10 seconds from that moment. `D9`, `DSOR-IDN-06`: the bound is measured from it. `D9`, `D4`: so is the one minute ahead. `D9`: a fault forgets only what DSoR asked for before it. `D9`: two slips signed by `user_123` that share one `gone` answer are each refused naming their own slip |
| C4 | `D10`: one lookup is one failure, however many calls waited for it. `D10`: one failure starts no trial. `D10`: after five `503`s in a row the server is asked nothing, and a call with a kept answer under the hour uses it at once. `DSOR-IDN-06`: during the pause, a call with no kept answer young enough is refused with `FRESHNESS_UNSATISFIABLE` at once, though the server hangs. `D10`: four failures, a reply, and four failures start no pause. `D10`: the pause lasts 10 seconds, from the fifth failure, not from the moment its lookup was sent; a failure after the fifth starts it again from its own moment; and a pause from before a clock went back is over. `D10`: during the pause, `cfo_100`, of whom DSoR keeps no answer, hears the stranger's words at once (DSOR-ERR-01b, as step 45's review fixed it) |
| C5 | `D16`: when the pause is over, one call asks, and a call about someone else meanwhile asks nothing and uses its kept answer. `D16`: a call about the trial's own person waits for it. `D16`: a trial that fails starts a new pause at once. `D16`: a trial that gets a reply ends the pause, and the next outage pauses again |
| C6 | `D17`: five `403`s in a row start no pause: the sixth call asks, and is refused with `INTERNAL_ERROR`. `D17`: four `503`s, a `403`, and four `503`s start no pause. `D17`: a reply that comes during the pause ends it |
| C7 | `DSOR-TEN-02a`: while org_456's server is paused, org_789's server is still asked |

On PostgreSQL (`*.db.test.ts`): `D9`, `D8` (step 45's): fifty calls at once still make one lookup
when the kept answers are in `dsor.role_answers`. `D10`, `D8`: during a pause on one DSoR server, a call uses the
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

## What changed since step 45

| File | What changed |
| --- | --- |
| `src/authority.ts` | The lookups in flight, one for each company and person, on each DSoR server (D9). Each company's run of failures, its pause, and its trial (D10, D16). Any reply ends a run (D17). A call that waited reads the shared answer from the moment the lookup was sent (D13), and checks it as its own |
| `test/sign-in-server.ts` | Two switches: `hold` keeps each reply back, and `release` sends them |
| `test/one-lookup.test.ts`, `test/pause.test.ts` | **New.** C1 to C3, and C4 to C7 |
| `test/protect.db.test.ts` | **New.** On PostgreSQL: fifty calls make one lookup; a paused DSoR server uses the kept answer at once, and a second DSoR server still asks |
| `test/helpers.ts` | A test may give two DSoR servers one store of kept answers |
| `test/role-source.test.ts`, `test/suspended-slips.db.test.ts` | Two older tests sent two overlapping questions about one person from one DSoR server, which D9 makes one question. Each now uses two DSoR servers, and tests the same guarantee |

```bash
git diff --no-index ../mj_45_ask_the_sign_in_server/src src
git diff --no-index ../mj_45_ask_the_sign_in_server/test test
```

## Run it

A local PostgreSQL 17, as in step 45. This step adds no migration.

```bash
pnpm install
pnpm check
pnpm test:db test/protect.db.test.ts
pnpm start          # the same night as step 45
```

`pnpm start` prints the same 543 lines as step 45, apart from the bank's random keys: this step
changes how often DSoR asks, not what it decides.

**The real run**, on 2026-10-28 at 17:07 UTC, on this computer. `pnpm serve`, with this step's code
before the review (the review's fixes change nothing this run shows), asks the Panaversity SSO's
lookup: draft pull request
[panaversity/agentfactory#1331](https://github.com/panaversity/agentfactory/pull/1331), at local
commit `fa9a10ac1`, on `localhost:3011`, over a local copy of its database. In part 2 the SSO is
frozen with `kill -STOP`. Its port stays open, so each question is taken and never answered, as when
a server hangs. Two things were set up first, both left over from step 45's run. org_456's owner made
a new DSoR key, since step 45's run took the last one back. And `del_100` and `del_101`, which step
45's run had suspended, were set active again in the run's own scratch database, since no step yet
lets an owner lift a slip's suspension.

```text
17:07:12.988 0. cfo_100 signs in at the SSO and reads INV-1008: 200 INV-1008

17:07:12.989 1. the agent sends 50 reads of INV-1008 under del_100 at once
17:07:13.596    50 of 50 answered; the SSO logged 1 lookup(s) for them

17:07:13.596 2. 11 seconds later, the SSO stops answering: it takes each question and never replies
17:07:26.648    the agent's read 1: 200 INV-1008, after 2.02 s
17:07:28.657    the agent's read 2: 200 INV-1008, after 2.01 s
17:07:30.667    the agent's read 3: 200 INV-1008, after 2.01 s
17:07:32.678    the agent's read 4: 200 INV-1008, after 2.01 s
17:07:34.690    the agent's read 5: 200 INV-1008, after 2.01 s
17:07:34.699    the agent's read 6: 200 INV-1008, after 0.01 s
17:07:34.707    cfo_100 reads during the pause, her answer kept at 0. under the hour: 200 INV-1008, after 0.01 s

17:07:34.707 3. the SSO answers again; the pause ends 10 seconds after the fifth failure
17:07:45.824    cfo_100 reads, the first call after the pause, which tries the SSO: 200 INV-1008, after 0.11 s
17:07:45.845    the agent reads, and asks as usual again: 200 INV-1008, after 0.02 s
17:07:46.346    the SSO logged 2 lookup(s) since it came back
```

1. **Part 1, D9.** Fifty reads at once, and the SSO saw one question.
2. **Part 2, D10.** Reads 1 to 5 each waited the full 2 seconds, a failure each, and each read
   INV-1008 on the answer DSoR kept in part 1. After the fifth failure, read 6 and cfo_100's read
   (her answer kept in part 0) took 0.01 seconds: DSoR asked nothing.
3. **Part 3, D16 and D17.** cfo_100's read is the trial: one question, answered, and the run ends.
   The agent's read then asks as usual. The two lookups the SSO logged are those two.

## Break it

Each break was made for real, in a copy of this step, with a story test that tells what DSoR
answers, once as built and once broken. The predictions are the learner's, from before any code.

| Break | The learner's prediction | As built | Broken |
|---|---|---|---|
| B1 · one lookup in flight is removed | (not asked: the run in "Why it matters") | 50 calls at once, **1** question; all 50 read INV-1008 | **50** questions; all 50 read INV-1008 |
| B2 · the shared lookup is found by the person alone | Refused with the stranger's words, and org_789's server is never asked | refused with the stranger's words, after 0.0 s; org_789's server asked once | refused with the stranger's words, after 0.1 s; org_789's server **never asked**; the agent at org_456 reads INV-1008 |
| B3 · the pause is removed | Every call waits up to 2 seconds and pays on the 02:00:45 answer; the server is asked about every 2 seconds, all minute | **8** questions, at +0, +2, +4, +6, +8 s, then trials at +21, +34, +47 s; 16 of 60 calls waited, 24.1 s in all | **30** questions, one every 2 s; **60 of 60** calls waited, **90.1 s** in all |
| B4 · a fault counts as a failure | The approval counts, on the 01:29 answer | cfo_100 hears `INTERNAL_ERROR`: the directory of org_456 answered with something DSoR cannot use | cfo_100 **is let through**, on the 01:29 answer |
| B5 · after the pause, every call asks again | 20 questions; each call waits up to 2 seconds, then uses its kept answer or is refused; the first failure starts a new pause | **1** question; 19 of 20 answered at once from kept answers | **20** questions; all 20 waited 2.0 s |
| B6 · each waiting call counts its own failure | (not asked) | at 02:00:14 cfo_100 reads INV-1008 | at 02:00:14 cfo_100 hears **the stranger's words** |

In B3, every one of the 60 calls read INV-1008 on the 02:00:45 answer, as built and broken: the
pause changes how long they wait and how often the server is asked, never what DSoR decides.

All four predictions came out as the learner said. What each one shows:

- **B2.** She is refused either way, by C3: each call that waited checks whom the answer is about,
  so org_456's answer is a fault for her org_789 call. A fault about a person DSoR knows nothing
  about there sounds like a stranger (step 45's review, finding 3). Break C3's check as well, and
  she would hold org_456's role at org_789. Two checks stand in front of the same harm.
- **B4.** The run reads INV-1008 as cfo_100 in place of her approval: both pass line ②, which asks
  about her in the same way. Broken, five `403`s pause org_456, and the pause hides the taken-back
  key behind a 31-minute-old answer, as step 45's break B2 did for one call. D17 keeps a fault a
  fault.
- **B5.** The server that is still down meets one question as built, and twenty broken.
- **B6.** One lookup that fails once, counted fifty times, pauses the company: for 10 seconds, a
  person DSoR knows nothing about yet hears that she does not work there.

Each new check was also broken one at a time, in a copy, against the unit tests: 5 in the shared
lookup, 9 in the pause, the trial, and the fault rule, and then the review's 52, below. Every change
that alters what a call gets is caught now.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | D9 and D10, from step 45's design for the whole chain |
| 2 | Decide | D16, D17, and two later steps, each put to the learner with its downside, and the predictions for B2 to B5 |
| 3 | The copy | Step 45 copied, its markers removed |
| 4 | Build, piece by piece | Two pieces, each with its tests written red first, its breaks, and its own commit: one lookup in flight; the pause, the trial, and the fault rule |
| 5 | The real run | `pnpm serve` against the Panaversity SSO on this computer, frozen with `kill -STOP` |
| 6 | Break it | Six breaks, each made for real in a copy and set beside its prediction |
| 7 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 45b in learner mode from the design in
docs/baby_steps_tutorials/mj_45b_protect_the_sign_in_server/README.md and the decisions in
docs/baby_steps_tutorials/mj_decisions.md, entries 21 to 23 and 30 to 33.
```

## Check yourself

1. At 02:00:11, 50 calls under `del_100` arrive together, and org_456's SSO answers in 0.3 seconds.
   How many questions does the SSO get, and as of when does a call that came 0.2 seconds after the
   first record the answer?
   <details><summary>Answer</summary>One question (D9): every call that came while it was in flight waited for it. Each records the answer as of the moment the lookup was sent, 02:00:11, or the server's <code>as_of</code> if that is earlier (D13), never as of its own arrival. Part 1 of the real run; the test of D13 in <code>test/one-lookup.test.ts</code>.</details>
2. From 02:01 the SSO takes each question and never answers. DSoR's last answer about `user_123` is
   from 02:00:45. What do the agent's calls get from 02:01:00, and how long do they wait?
   <details><summary>Answer</summary>Every call reads on the 02:00:45 answer, which is under the hour. The calls of the first five failures wait 2 seconds each. After the fifth, calls wait for nothing until the pause ends, then one call tries the SSO, fails, and a new pause starts (D10, D16). Part 2 of the real run, and break B3: 24.1 seconds of waiting in the minute, against 90.1 broken.</details>
3. At 01:30 org_456 takes back DSoR's key, and every lookup gets a `403`. Why does a run of `403`s not
   pause org_456, and why is that the safe choice?
   <details><summary>Answer</summary>A <code>403</code> is a reply: the server is up, and said DSoR may not ask (D17). The fault refuses with <code>INTERNAL_ERROR</code> and drops the kept answer, so someone fixes the key. If <code>403</code>s counted, the pause would let calls use kept answers for up to an hour while the key is gone: break B4.</details>
4. org_789's SSO is down and paused. Does a call at org_456 notice?
   <details><summary>Answer</summary>No. Each company has its own run and its own pause (DSOR-TEN-02a, C7), and its own lookups in flight (C2).</details>
5. The pause ends at 02:01:20 with the SSO still down, and line ② asks about 20 people at once.
   What happens?
   <details><summary>Answer</summary>One call asks: the trial. The other 19 act as in the pause: each uses its kept answer at once, or is refused at once. When the trial fails, a new pause starts (D16). Break B5: 1 question as built, 20 broken.</details>

## Think it through

### Found while building

- **`vi.waitFor` moves a faked clock.** It advances fake timers at each try, so a test that waited
  with it saw the lookup sent at 02:00:00.050. The tests wait with real timers instead.
- **Two older tests sent two overlapping questions from one DSoR server:** step 19's late answer,
  and step 19b's two agents suspending at once. With D9 that is one question, so each now uses two
  DSoR servers, which share the kept answers or the database. What they test is unchanged.
- **A second question, rarely, on PostgreSQL.** A call whose own read of the kept answers ends after
  the shared lookup has ended, and before its answer is kept, asks again. The database test holds
  the reply for a second, so that every call gets there first.
- **Fifty writes for one crowd.** Each call that waited keeps the shared answer again: fifty writes of
  the same row in `dsor.role_answers`. D9 saves fifty lookups, not fifty writes. A later step could
  keep the answer once.
- **A pause from before a clock went back.** A pause ends at a time on DSoR's clock. If the clock
  is set back an hour during a pause, the pause would last an hour and ten seconds, with no lookup at
  all, and every kept answer, now from the future, refused (step 19's decision 15). A pause that
  began later than the clock now is over, as a kept answer from the future does not count. Found by
  reading the finished code, and by the review too (finding 1); a test proves it.
- **`pnpm start` lists a payment run's lines in the order their checks finish,** which varies from
  run to run, in step 45 too. It is an earlier step's, not fixed here.

### What the review found

A reviewer who had not seen the conversation attacked the step as a caller would, with probes of its
own, and changed the code 52 times, one change at a time, in a copy. 40 changes were caught. Three
changed nothing a call can see. Nine survived, and each now has a test that fails without the code
it guards.

Fixed, each with a test that fails without the fix:

- **A clock set back during a pause stopped DSoR asking (finding 1).** The pause would last until the
  clock caught up: an hour with no lookup, and, with every kept answer now from the future, an hour
  of refusals. The build had found it an hour earlier; with the fix, the reviewer's probes no longer
  reproduce it.
- **Nine changes that no test caught (finding 3).** A trial flag left up after a trial that got a
  reply, so the next outage stays paused until a restart. A pause gate that ignores the run, so a
  reply during the pause does not end it. One failure that makes every other call act paused. The
  pause counted from the moment the fifth lookup was sent, not from its failure. A failure after the
  fifth no longer starting the pause again. And four times measured from a waiting call's arrival
  instead of the moment the lookup was sent: the reuse window, the bound, the one minute ahead, and
  what a fault forgets. Some needed a test that moves DSoR's clock while a lookup waits, which the
  frozen date had hidden.
- **A test named the wrong rule (finding 4).** Two people in one company each getting a lookup of
  their own is D9's rule, not DSOR-TEN-02a's. The test and the README say D9 now.
- **The README.** "Never floods" promised more than the step does. The bound now says "by DSoR's
  clock". `FRESHNESS_UNSATISFIABLE` is step 19's choice for DSOR-IDN-06, not that rule's own. The
  terms it used before it defined them now come with their meaning, and the clerk checks the one
  answer against each slip.

Put to the learner:

- **Finding 2: one person can pause the company.** If the SSO fails only on one person's record, five
  of her calls pause org_456 for everyone, and she can keep it paused by being every trial. In the
  reviewer's probe, the healthy server was never asked about `cfo_100` while she called every 10
  seconds. Step 45 had no such risk. The learner put the fix in step 45c (entry 34), where each
  person gets a memory of her own lookups.

Left as they are: the second question on PostgreSQL, above; and three of the review's changes that
change nothing a call can see: the trial flag cleared by any lookup, no shared copy of the reply,
and a time that a paused call never reads.

### Left open on purpose

- **One person can pause the company** (this step's review, finding 2), until step 45c (entry 34).
- **A stranger can still spend a company's lookups** (step 45's review, finding 2). The pause limits
  how often a failing server is asked, but many strangers whose lookups the server turns away with
  `429`s can keep org_456 on its kept answers. Step 45c (entry 32).
- **Q8's alert.** DSoR still raises no alert when it cannot get a fresh answer. Step 45d (entry 33).
- **Four DSoR servers, four runs.** Each DSoR server finds an outage on its own, makes five failures
  of its own, and sends a trial of its own. A pause that every server shares would need the
  database, and a write at each failure.
- **A new person during a pause.** DSoR knows nothing yet about someone who joined the company a
  minute ago. During a pause, her own call hears the words every stranger hears (step 45's finding
  3), for up to 10 seconds.
- **The trial is whoever comes first,** a stranger's call too. That is safe: any reply ends the run,
  and a stranger's `gone` is a reply.
- **D15** (entry 28) was reviewed after this step was built: its three gaps go to steps 45d and 45e
  (entries 35 to 37).

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-IDN-06 | With no authority recent enough, the command is refused | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/pause.test.ts` (C4) |
| DSOR-TEN-02a | Caches, counters, and the rest are keyed by company | [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/one-lookup.test.ts` (C2), `test/pause.test.ts` (C7) |

The shared lookup, the pause, the trial, and the fault rule are this tutorial's decisions: those
tests are titled by D3, D4, D8, D9, D10, D13, D16, and D17.

**Next:** step 45c, a stranger cannot spend a company's lookups. DSoR will ask about the same company
and person at most once in 10 seconds, whatever the reply, spend at most a budget of lookups on
people it knows nothing about, and pause a company only when different people's lookups fail
(entries 32 and 34). Then step 45d, the alert of decision Q8 (entry 33).
