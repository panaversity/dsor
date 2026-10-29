# Step 45c · Lookups, person by person

**New in this step:** DSoR spends a company's lookups person by person. It remembers the last reply
about each person, waits longer each time her lookups keep failing, pauses a company only when
lookups about different people fail, and gives people it knows nothing about a budget of lookups
(DSOR-IDN-06, DSOR-TEN-02a, DSOR-ERR-01b).

## In plain words

Step 45b protects a company's sign-in server from a crowd of calls and from an outage. Two reviews
found that DSoR still spends a company's lookups badly in three ways. A stranger can spend them:
anyone who signs up at the Panaversity SSO can name org_456, and each such call costs a lookup with
org_456's key. One person's broken record at the SSO can pause the whole company, and keep it
paused. And a reply that DSoR cannot use, such as a `403` (not allowed), is asked for again at every
call.

This step makes DSoR count a company's lookups person by person. It remembers the last reply about
each person, and asks nothing more about her for 10 seconds (D21). When her lookups keep failing,
it waits twice as long each time, up to 5 minutes (D22). It pauses a company only when lookups about
five different people it knows fail (D25). And the people DSoR knows nothing about share a budget
of 20 lookups a minute for each company; over it, a call hears the words every stranger hears
(D23, D24). One who heard that she is not in the company is not asked about again, for her own
calls, for 10 minutes (D26).

Think of the new clerk again. The clerk notes each call to HR. After HR said "busy" about one
employee, the clerk does not call about her again for a while, and waits longer each time. One
employee's broken file does not stop the calls about everyone else. And people who walk in from the
street and ask about themselves share a few calls a minute between them, no more.

**Words this step uses.**

- A *person's memory* is the last reply about one person in one company, kept by one DSoR server:
  an answer, a failure, or a fault (step 45b's words).
- The *backoff* is the wait before DSoR asks about a person again after her lookups failed. It
  doubles at each failure in a row.
- A person DSoR *knows nothing about* is one it keeps no `active` answer for in that company: a
  stranger, someone who left, or someone it never asked about.
- The *budget* is how many lookups about such people one DSoR server may send for one company in
  any minute.
- The *stranger's words* are what line ② tells anyone who does not work in the company the call
  names: "the caller may not work in the tenant it named" (step 45).
- The *trial* is the one call that asks again when a company's pause is over (step 45b).

## Why it matters

A real run on 2026-10-29, on step 45b's code, which is this folder before any change. A test
sign-in server answers for org_456; in runs 2 and 3, a stand-in in front of it errors on
`user_123`'s record only.

```text
1. 09:00:00, 200 people who signed up at the SSO a minute ago, none of them in org_456, each call DSoR once
   naming org_456: org_456's lookup is asked 200 times, with org_456's key
2. 02:00:00 to 02:00:04, the SSO errors on user_123's record only, and her agent reads INV-1008 five times:
   5 of 5 read it on her 01:59 answer. 02:00:05, cfo_100 reads INV-1008, the SSO fine for her:
   AUTHORIZATION_DENIED "the caller may not work in the tenant it named"; the SSO was asked about cfo_100 0 times
3. from 02:00:14 to 02:05:14, her agent reads every 10 seconds and is every trial; cfo_100 tries every
   30 seconds: refused 10 of 10 times; the SSO was asked about cfo_100 0 times
4. 02:00:00 to 02:00:09, org_456 has taken DSoR's key back, and the agent reads once a second:
   the SSO is asked 10 times, a 403 each time
```

1. **Strangers spend a company's lookups.** In the Panaversity ops story, a sign-up bot makes 200
   accounts at the SSO and names org_456 with each. org_456's key pays for every lookup. If the SSO
   limits that key, org_456's own people find its lookups used up.
2. **One broken record pauses everyone, and keeps it paused.** Five failures about `user_123` start
   org_456's pause, and `cfo_100`, whom the SSO answers fine, is told she does not work there. Her
   agent then calls just as each pause ends, so her failing lookup is every trial.
3. **A fault is asked for again at every call.** After org_456 takes DSoR's key back, every read asks,
   and every read gets the same `403`.

**Common mistake:** remembering only good news. A cache that keeps answers and forgets errors asks
again at once after every error, so the errors cost the most questions.

## The design, before any code

### How this step was made

Two reviews found these problems: step 45's (finding 2, strangers) and step 45b's (finding 2, one
person's broken record). The learner put both in this step ([`../mj_decisions.md`](../mj_decisions.md),
entries 32 and 34). On 2026-10-29, before any code, the learner took four more decisions, each on
Claude Code's recommendation: D21 to D24 below (entries 38 to 41). After the review, the learner
corrected two of them and took D26 (entries 40 to 44).

### What the rules say

From [§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-06:** "When the delegator's current authority cannot be established within the
  staleness bound of §44, DSoR MUST deny the command." It still holds: a remembered failure or a
  call over the budget leaves only the kept answer, which counts only under the company's bound.

From [§14](../../../specs/dsor/02-security.md#14-multi-tenancy):

- **DSOR-TEN-02a:** "Caches, idempotency records, counters, holds, proposals, events, and audit
  partitions MUST be keyed by tenant." The memory, the backoff, and the budget are kept by company.
  That the memory and the backoff are kept by person too is this step's decision.

From [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes):

- **DSOR-ERR-01b:** "An error MUST NOT reveal the existence or attributes of a resource the caller is
  not authorized to read." A call over the budget hears the stranger's words, as step 45's review
  made every call from someone DSoR knows nothing about: the words say nothing that someone outside
  org_456 may not read. The time to answer still tells a careful stranger that org_456 is a DSoR
  company, as it has since step 45: a call naming it waits for its sign-in server, and one naming
  any other company is refused at once (step 45c's review, entry 41).

The specification's nearest rule for a budget is DSOR-OPS-02 (§18): "Rate and velocity limits MUST be
enforced server-side, per agent and per tenant." It limits callers' requests to DSoR, not DSoR's own
questions to a role source, so the budget is this tutorial's decision, and so are its numbers.

### The claims

| Claim | What it says |
|---|---|
| C1 | On each DSoR server, a reply about a person in a company, an answer, a failure, or a fault, is remembered for 10 seconds from the moment DSoR asked. A call about her in that time sends no question, and gets what that reply gave: after a failure, her kept answer under the company's bound, or a refusal at once; after a fault, or an answer too old to use, the same refusal at once. An answer a call can use is used again from the kept answers, as step 45's D3 does, so never past the company's bound (D21) |
| C2 | After failures in a row about one person, DSoR waits twice as long each time before it asks about her again: 10, 20, 40, 80, 160 seconds, then 5 minutes at most. Any reply about her starts her over at 10 seconds (D22) |
| C3 | The company's pause starts when lookups about five different people have failed in a row: one person's failures count once, and a stranger's do not count. A person who is waiting (C2) is never the trial (D25) |
| C4 | Each DSoR server sends at most 20 lookups in any minute, for each company, about people DSoR knows nothing about, from people's own calls at line ②. A person DSoR keeps an active answer for, however old, line ③, and a release never wait for the budget (D23) |
| C5 | A call over the budget sends no question and hears the stranger's words at once. It is no failure: it starts no pause, and it is not remembered (D24) |
| C6 | The memory, the backoff, and the budget are kept by company (DSOR-TEN-02a), and the memory and the backoff by person too (this step's decision). A memory that DSoR made later than its clock now came before a clock went back, and is not used (step 19's README, decision 15) |
| C7 | A stranger's own call that heard she is gone from the company uses that answer for 10 minutes. Her company's other questions about her still use it for 10 seconds (D26) |
| C8 | A release's question about the person who made the request is not her own call: it spends no budget, and hears what her company really said, so a company that cannot answer now leaves the proposal waiting (entry 44; a bug since step 45) |

### Decisions

Before this step, from the two reviews, on 2026-10-28:

- **Entry 32.** A stranger's lookups get a step of their own: this one.
- **D25, entry 34. The company's pause counts five different people.** *Downside:* an outage seen
  through one person's calls no longer pauses the company. C2's backoff protects the server then.

For this step, the learner's, on 2026-10-29, each with Claude Code's recommendation taken:

- **D21. Every reply about a person is remembered for 10 seconds, on each DSoR server.** An answer, a
  failure, and a fault alike. An answer a call can use is used again from the kept answers, under
  the company's bound, as step 45's D3 already does. *Downside:* a server that recovers a second
  after a failure is not asked about her for up to 10 seconds.
- **D22. When a person's lookups keep failing, DSoR waits twice as long each time,** from 10 seconds
  up to 5 minutes; any reply starts her over. *Downside:* once her record is fixed, DSoR may take up
  to 5 minutes to ask again; she uses her kept answer meanwhile.
- **D23. At most 20 lookups a minute for each company, on each DSoR server, about people DSoR knows
  nothing about,** from people's own calls. *Downside, as the review corrected it:* a call over the
  budget costs a stranger nothing, so a few accounts calling steadily can keep the budget used up,
  and a real new employee refused, for as long as they keep calling. D26 makes that expensive.
- **D24. Over the budget, the stranger's words.** *Downside:* a new employee hears that she does not
  work there, not "try again in a minute".

After the review, the learner's, on 2026-10-29:

- **D26. A stranger's own calls use "not a member" for 10 minutes,** not 10 seconds. Each sign-up
  account then costs one lookup in 10 minutes, and keeping the budget used up takes 200 accounts
  every 10 minutes, not 4. *Downside:* someone added to the company just after her first try waits
  up to 10 minutes.
- **A key rotation that makes everyone a stranger gets a step of its own,** step 45f (entry 43).
  *Downside:* until then, after a key rotation done wrong, a large company's own calls are slow for
  a while.
- **The release's question is fixed in this step, and steps 45 and 45b later** (entry 44).

The memories and the budget are kept by each DSoR server itself, not in the database, as D9 and D10
are. Four DSoR servers send up to 80 lookups a minute about strangers, and a restart forgets them.

### The tests, by claim

The tests ask step 45's test sign-in server. A stand-in in front of it makes it error on one
person's record. Only the date is faked.

| Claim | Tests |
|---|---|
| C1 | `D21`: after a `503` at 02:00:00, a read at 02:00:09 asks nothing and reads on the kept answer; one at 02:00:10 asks. `D21`: after a `403`, nine more reads in 9 seconds ask nothing, and each hears `INTERNAL_ERROR`. `D21`: after an answer too old to use, a read within 10 seconds asks nothing and is refused the same. `D21`: an answer up to a minute ahead is one a call can use; one further ahead is a fault, remembered. `D21`: a failure and a fault are remembered from the moment DSoR asked, not from their reply. `D21`, `DSOR-TEN-02a`: a failure about `user_123` holds no question back about `cfo_100` |
| C2 | `D22`: while `user_123`'s lookups keep failing, DSoR waits 10, 20, 40, 80, and 160 seconds between its questions about her, then 5 minutes; a reply starts her over at 10; her failures count on when another person's call comes between them, and start over after a memory gone for 5 minutes |
| C3 | `D25`: `user_123`'s lookups fail five times in a row, and org_456 does not pause: `cfo_100` is asked about. `D25`: four people, and the first again, start no pause; a fifth person does. `D25`: after an outage, `user_123`, who is waiting, is never the trial, and `cfo_100`'s call is. `D25`: ten strangers' failures start no pause, and a stranger's failed trial starts none again. `D23`, `D25`: a call over the budget at the pause's end is no trial |
| C4 | `D23`: 25 people DSoR knows nothing about call at once: 20 questions. `D23`: a minute later, 20 more. `D23`: `cfo_100`, with a three-hour-old active answer kept, is asked about when the budget is used up. `D23`: an agent's call at line ③ is never held back. `D23`, `D25`: during a pause, strangers spend no budget. `D23`: budget moments from before a clock went back are dropped |
| C5 | `DSOR-ERR-01b`: over the budget, a call hears the stranger's words at once, with no question; five such calls start no pause. `D24`: a call over the budget is not remembered |
| C6 | `DSOR-TEN-02a`: org_456's budget used up holds back no lookup for org_789. `D21`: a memory from before a clock went back is not used |
| C7 | `D26`: the same 20 sign-up accounts calling a minute later, the budget fresh, send no question; 10 minutes after her answer, one is asked about again |
| C8 | `D23`: 20 sign-up accounts use up the budget, and `user_124`'s release of `user_123`'s waiting payment still commits. `DSOR-IDN-06`: at a release, a company that cannot answer now leaves the proposal waiting, and the same key releases it once the server is back |

### The breaks, with the learner's predictions

The predictions were made before any code, on 2026-10-29. Each break will be made for real in a
copy, and "Break it" will show how each prediction came out.

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · DSoR remembers only answers it can use, as in step 45b | At 01:30 org_456 takes back DSoR's key, and the SSO answers `403`. From 02:00:00 the agent reads INV-1008 under `del_100` once a second for 10 seconds | 10 questions, a `403` each |
| B2 · the budget counts people DSoR knows too | At 09:00:00 a sign-up bot's 200 new SSO accounts each name org_456 once. At 09:00:05 `cfo_100` reads INV-1008; DSoR's last answer about her is from 06:00 (active, `CFO`), three hours old | She reads INV-1008 |
| B3 · the backoff is removed: a person whose lookups keep failing is asked every 10 seconds | At 02:00 the SSO is down and five people's calls fail, so org_456 pauses. At 02:00:30 the SSO is back, except that it errors on `user_123`'s record. Her agent reads every 10 seconds; `cfo_100`, with no answer kept about her, tries every 30 seconds, until 02:05 | Refused at every try |
| B4 · a failed lookup is remembered by company, not by person | From 02:00:00 the SSO errors on `user_123`'s record only, and her agent reads INV-1008 at 02:00:00. At 02:00:03 `cfo_100`, with no answer kept about her, reads INV-1008 | She reads INV-1008 |

## What changed since step 45b

| File | What changed |
| --- | --- |
| `src/authority.ts` | Each person's memory: the latest lookup about her, in flight or with its reply, until when it is remembered, and her failures in a row (D21, D22). The run counts different people (D25). Each company's budget of 20 lookups a minute about people DSoR knows nothing about, spent only by their own calls at line ② (D23, D24) |
| `src/main.ts` | The story waits out 10 seconds before `user_123`'s retry after the restart, since DSoR remembers its failed question about her (D21) |
| `test/person-memory.test.ts`, `test/different-people.test.ts`, `test/budget.test.ts` | **New.** C1 and C2; C3; C4 to C6 |
| `test/pause.test.ts`, `test/protect.db.test.ts` | A run of five failures is five people's own calls: five calls about one person are one question now |
| `test/answers.test.ts`, `test/one-lookup.test.ts`, `test/recheck.test.ts` | A call that asked again at once after a failure or a fault now comes 10 seconds later |

```bash
git diff --no-index ../mj_45b_protect_the_sign_in_server/src src
git diff --no-index ../mj_45b_protect_the_sign_in_server/test test
```

## Run it

A local PostgreSQL 17, as in step 45b. This step adds no migration.

```bash
pnpm install
pnpm check
pnpm test:db test/protect.db.test.ts
pnpm start          # step 45b's night, with 10 seconds of waiting before user_123's retry
```

**The real run**, on 2026-10-29 at 01:29 local time (20:29 UTC, which the script prints), on this computer. `pnpm serve`, with this step's code,
asks the Panaversity SSO's lookup: draft pull request
[panaversity/agentfactory#1331](https://github.com/panaversity/agentfactory/pull/1331), at local
commit `fa9a10ac1`, on `localhost:3011`, over a local copy of its database. Twenty-five accounts
signed up at that SSO during the run, each with a password made by the script and never written
down. Step 45b's run had taken org_456's key back, so org_456's owner made a new one first.

```text
20:29:16.825 1. 25 people signed up at the SSO, none of them in org_456, and each has a DSoR token
20:29:17.824    all 25 call DSoR at once, naming org_456: 403 AUTHORIZATION_DENIED: the caller may not work in the tenant it named
20:29:17.824    the SSO logged 20 lookups about them

20:29:18.607 2. right after, cfo_100 reads INV-1008: 200 INV-1008; the SSO logged 1 lookup about her

20:29:19.121 3. org_456's owner takes back DSoR's key: 200; the agent reads once a second for 10 seconds
20:29:40.908    the agent's 10 reads hear: 500 INTERNAL_ERROR; the SSO logged 1 lookup about user_123
```

1. **Part 1, D23 and D24.** Twenty-five strangers, 20 lookups. All 25 hear the same words: the five
   over the budget learn nothing more than the twenty who were asked about.
2. **Part 2, D23.** DSoR keeps an active answer about `cfo_100` from an earlier run, hours old. She is
   no stranger to it, so the used-up budget does not hold her back, and DSoR asks.
3. **Part 3, D21.** Ten reads in ten seconds after the key was taken back: one lookup, one `401`, and
   ten refusals.

The first attempt, a minute earlier, met the SSO's dev server building its lookup route on first
use. The 20 lookups about the strangers each waited the full 2 seconds and failed. Twenty different
people had failed in a row, so org_456 paused (D25), and `cfo_100`, whose kept answer was hours old,
was refused at once with `FRESHNESS_UNSATISFIABLE`. That is the pause doing its work: from DSoR's
side, a server that builds a route is a server that does not answer. The run above was made after
one request had built the route.

## Break it

Each break was made for real, in a copy of this step, with a story test that tells what DSoR
answers, once as built and once broken. The predictions are the learner's, from before any code.

| Break | The learner's prediction | As built | Broken |
|---|---|---|---|
| B1 · DSoR remembers only answers it can use, as in step 45b | 10 questions, a `403` each | **1** question; all ten reads refused with `INTERNAL_ERROR` | **10** questions; all ten refused with `INTERNAL_ERROR` |
| B2 · the budget counts people DSoR knows too | She reads INV-1008 | 20 questions for the 200 strangers; `cfo_100` reads INV-1008, asked about once | 20 questions; `cfo_100` hears **`FRESHNESS_UNSATISFIABLE`**, asked about 0 times |
| B3 · the backoff is removed | Refused at every try | `cfo_100` refused 1 of 10 times, and reads INV-1008 from 02:00:35 | refused **10 of 10** times, asked about 0 times |
| B4 · a failed lookup is remembered by company, not by person | She reads INV-1008 | `cfo_100` reads INV-1008, asked about once | `cfo_100` hears **the stranger's words**, asked about 0 times |

Two predictions came out as the learner said, B1 and B3. B2 and B4 described the step as built, not
the broken copy: in both, `cfo_100` reads. Asked which ideas led there, the learner picked four, and
each has its run:

- **"The break is not about her."** Both breaks are. B2's broken line spends the budget for every call
  at line ②, hers too. B4's broken key is `["org_456"]` for every person, so her call finds
  `user_123`'s remembered failure.
- **"Her kept answer carries her."** Only under the hour. The same break, with her answer kept at
  06:00, three hours old: `FRESHNESS_UNSATISFIABLE`. Kept at 08:30, 35 minutes old: she reads, with no
  question. The deciding line is `age < setting.ms`.
- **"DSoR asks the SSO anyway."** In both broken runs the SSO is asked about her 0 times. In B4 at
  02:00:11, after `user_123`'s failure is no longer remembered, she is asked once, and reads.
- **"I answered what should happen."** The "As built" column is what should happen; the prediction
  asks for the "Broken" column.

Each new check was also broken one at a time, in a copy, against the unit tests: 10 in the memory
and the backoff, 3 in the count of different people, and 7 in the budget, then 14 more after the
review: its fixes undone, and its survivors. Every one is caught, some only after the test that
catches it was written: a memory forgotten as soon as it ends, which restarts the backoff whenever
another person's call comes between two failures, is the first of them.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | The problem | A real run on step 45b's code: strangers, one broken record, and a fault asked for again |
| 2 | Decide | D21 to D24, each put to the learner with its downside; D25 from step 45b's review; and the predictions for B1 to B4 |
| 3 | The copy | Step 45b copied, its markers removed |
| 4 | Build, piece by piece | Three pieces, each with its tests red first, its breaks, and its own commit: each person's memory and backoff; the pause in different people; the budget |
| 5 | The real run | `pnpm serve` against the Panaversity SSO on this computer, with 25 new accounts |
| 6 | Break it | Four breaks, each made for real in a copy and set beside its prediction |
| 7 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 45c in learner mode from the design in
docs/baby_steps_tutorials/mj_45c_lookups_person_by_person/README.md and the decisions in
docs/baby_steps_tutorials/mj_decisions.md, entries 32, 34, and 38 to 41.
```

## Check yourself

1. At 02:00:00 the SSO answers `503` about `user_123`. Her agent reads at 02:00:05, 02:00:12, and
   02:00:25. Which reads ask the SSO?
   <details><summary>Answer</summary>The one at 02:00:12. Her failure at 02:00:00 is remembered until 02:00:10 (D21), so 02:00:05 asks nothing and reads on her kept answer. 02:00:12 asks, fails again, and that failure is remembered for 20 seconds (D22), until 02:00:32, so 02:00:25 asks nothing.</details>
2. The SSO errors on `user_123`'s record only, and her agent calls every 10 seconds all night. Does
   org_456 ever pause?
   <details><summary>Answer</summary>No. The pause needs five different people's failures in a row (D25), and one person counts once. Her own lookups slow down instead: 10, 20, 40 seconds, up to one every 5 minutes (D22).</details>
3. A sign-up bot makes 200 accounts at the SSO and names org_456 with each, in one minute. How many
   lookups does one DSoR server send, and what do the bot's accounts hear?
   <details><summary>Answer</summary>20 (D23). All 200 hear the stranger's words, the 180 over the budget at once, with no question (D24). If the same 200 call again the next minute, the 20 who were asked are not asked again for 10 minutes (D26), so only fresh accounts spend the budget. Part 1 of the real run.</details>
4. In that same minute, `cfo_100` reads INV-1008. DSoR's last answer about her is three hours old.
   What happens?
   <details><summary>Answer</summary>DSoR asks about her and she reads: she has an active answer kept, however old, so she is no stranger, and the budget does not count her (C4). Break B2 shows her refused when the budget counts her.</details>
5. Why does a call over the budget hear "the caller may not work in the tenant it named", and not
   "too many requests"?
   <details><summary>Answer</summary>"Too many requests" would tell any SSO account that org_456 is a DSoR company, and that it is busy now (DSOR-ERR-01b). The stranger's words say nothing that anyone outside org_456 may not read (D24).</details>

## Think it through

### Found while building

- **A good answer replayed from memory passed a short bound.** The first memory replayed every reply
  for 10 seconds. Step 45's test of a 5-second bound failed: the replayed answer, measured from the
  moment DSoR asked, was used 6 seconds later. The memory now replays only replies that no call can
  use as an answer. An answer a call can use is kept, and used again from the kept answers, under
  the company's bound, as D3 always did.
- **Five calls about one person are one question now.** So the pause's tests, in memory and on
  PostgreSQL, fail five different people, each calling for herself. Five tests that asked again at
  once after a failure or a fault now wait the 10 seconds, and so does `pnpm start`'s story, before
  `user_123`'s retry after the restart.
- **A memory forgotten as soon as it ends lost her failures.** Another person's call clears old
  memories, and her count of failures went with them: the backoff restarted at 10 seconds. Memories
  now go 5 minutes after they end. Found by breaking the code on purpose; a test proves it.
- **The real run's first attempt** met the SSO building its route, and paused org_456, as above.
  That was before the review: today a stranger's failures do not count, so 20 strangers' timeouts
  would start no pause.

### What the review found

A reviewer who had not seen the conversation attacked the step as a caller would, with probes of its
own, and changed the code 50 times, one change at a time, in a copy. 33 changes were caught, and six
changed nothing a call can see. Of the eleven that survived and could change what a call gets, nine
now have a test that fails without the code it guards. The other two, the sweep of old memories and
their order, change only how much the map holds.

Fixed, each with a test that fails without the fix:

- **Strangers could throw a waiting payment away (finding 1).** A release asks again about the person
  who made the request, through the same question a person's own call asks. So it spent the budget,
  and over it heard the stranger's words, which a release reads as "no": 20 sign-up accounts, and a
  second supervisor's release of `user_123`'s prepared payment ended INVALIDATED. Since step 45, a
  `503` at that moment did the same, for someone DSoR keeps no active answer about. Now only a
  person's own call spends the budget and hears the stranger's words; a release hears what her
  company really said, and "cannot answer now" leaves the proposal waiting (C8, entry 44).
- **Strangers could start the pause, and keep it (finding 3).** Sign-up accounts whose records make
  the SSO fail counted as different people. Now a stranger's failure does not count. A fix that also
  kept a stranger's call from being the trial was tried, and taken back: B3's test found that, after
  an outage, a person DSoR knows nothing about and a person waiting out her backoff left no one to
  try the server, and the pause never ended.
- **Nine changes that no test caught (finding 5).** Among them: a person's status ignored when
  DSoR decides whether it knows her, so a sign-up account with a kept "gone" answer never spent the
  budget again; the trial set before the budget is checked, which would stop every later trial; an
  answer up to a minute ahead replayed past a short bound; memories timed from a reply that came
  late; a call over the budget remembered; and budget moments from before a clock went back.

Put to the learner, with the true facts:

- **D23's cost was false (finding 2).** A call over the budget costs a stranger nothing, and her
  "not a member" answer was used again for only 10 seconds, so four accounts calling steadily kept
  the budget used up for as long as they liked. The learner took D26: 10 minutes. After a key
  rotation done wrong, a fault erases every kept answer, and a whole company shares the 20: a step of
  its own, 45f (entry 43).
- **D24's claim went too far (finding 4).** The words reveal nothing; the time to answer does. The
  learner kept the stranger's words, and the claim now says what they do and do not hide.

Also found while answering the review: a memory gone for over 5 minutes still carried her failures
when she was the next caller, so her backoff did not start over. Fixed, with a test.

### Left open on purpose

- **The budget is each DSoR server's own.** Four DSoR servers send up to 80 lookups a minute about
  strangers. A budget that every server shares would need the database, and a write at each lookup.
- **A new employee in a busy minute.** When strangers have used the budget, someone who joined
  org_456 a minute ago, and whom DSoR knows nothing about yet, hears that she does not work there,
  until the minute rolls on (D23 and D24's downsides).
- **A restart forgets.** The memories and the budget live in each DSoR server's memory, so a restarted
  server asks again at once, about everyone, as step 45b's did.
- **A key rotation that makes everyone a stranger,** after a fault erases their kept answers, is step
  45f's (entry 43).
- **Steps 45 and 45b had the release bug** that this step fixes (entry 44): a `503` at a release of
  a person's own request, about someone DSoR kept no active answer about, threw the proposal away.
  Fixed in both on 2026-10-29.
- **Someone added to a company just after her first try** waits up to 10 minutes (D26's downside).
- **The answer's `type` and `issuer`** are step 45e's (entries 35 and 37), and **the escalation
  person and Q8's alert** step 45d's (entries 33 and 36).

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-IDN-06 | With no authority recent enough, the command is refused | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/pause.test.ts`, and `test/person-memory.test.ts` (C1) |
| DSOR-TEN-02a | Caches, counters, and the rest are keyed by company | [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/person-memory.test.ts` (C1), `test/budget.test.ts` (C6) |
| DSOR-ERR-01b | An error reveals nothing the caller may not read | [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `test/budget.test.ts` (C5) |

The memory, the backoff, the pause that counts people, and the budget are this tutorial's
decisions: those tests are titled by D21 to D25.

**Next:** step 45d, alerts and the sign-in server. A company's alert receivers will hear when DSoR
cannot get a fresh answer from its sign-in server (decision Q8, entry 33), and the sweep will ask
about the escalation person when it escalates (D19, entry 36).
