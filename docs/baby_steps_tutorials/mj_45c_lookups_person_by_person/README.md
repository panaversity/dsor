# Step 45c · Lookups, person by person

**New in this step:** DSoR spends a company's lookups person by person. It remembers every reply
about a person for 10 seconds, waits longer each time her lookups keep failing, pauses a company
only when lookups about different people fail, and gives people it knows nothing about a budget of
lookups (DSOR-IDN-06, DSOR-TEN-02a, DSOR-ERR-01b).

## In plain words

Step 45b protects a company's sign-in server from a crowd of calls and from an outage. Two reviews
found that DSoR still spends a company's lookups badly in three ways. A stranger can spend them:
anyone who signs up at the Panaversity SSO can name org_456, and each such call costs a lookup with
org_456's key. One person's broken record at the SSO can pause the whole company, and keep it
paused. And a reply that DSoR cannot use, such as a `403`, is asked for again at every call.

This step makes DSoR count a company's lookups person by person. It remembers every reply about a
person for 10 seconds, and asks nothing more about her meanwhile (D21). When her lookups keep
failing, it waits twice as long each time, up to 5 minutes (D22). It pauses a company only when
lookups about five different people fail (D25). And the people DSoR knows nothing about share a
budget of 20 lookups a minute for each company; over it, a call hears the words every stranger
hears (D23, D24).

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

## Why it matters

A real run on 2026-10-28, on step 45b's code, which is this folder before any change. A test
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
entries 32 and 34). On 2026-10-28, before any code, the learner took four more decisions, each on
Claude Code's recommendation: D21 to D24 below (entries 38 to 41).

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
  made every call from someone DSoR knows nothing about, so no SSO account learns that org_456 is a
  DSoR company, or that it is busy.

The specification's nearest rule for a budget is DSOR-OPS-02 (§18): "Rate and velocity limits MUST be
enforced server-side, per agent and per tenant." It limits callers' requests to DSoR, not DSoR's own
questions to a role source, so the budget is this tutorial's decision, and so are its numbers.

### The claims

| Claim | What it says |
|---|---|
| C1 | On each DSoR server, a reply about a person in a company, an answer, a failure, or a fault, is remembered for 10 seconds from the moment DSoR asked. A call about her in that time sends no question, and gets what that reply gave: after a failure, her kept answer under the company's bound, or a refusal at once; after a fault, `INTERNAL_ERROR` at once (D21) |
| C2 | After failures in a row about one person, DSoR waits twice as long each time before it asks about her again: 10, 20, 40, 80, 160 seconds, then 5 minutes at most. Any reply about her starts her over at 10 seconds (D22) |
| C3 | The company's pause starts when lookups about five different people have failed in a row: one person's failures count once. A person who is waiting (C2) is never the trial (D25) |
| C4 | Each DSoR server sends at most 20 lookups in any minute, for each company, about people DSoR knows nothing about, from people's own calls at line ②. A person DSoR keeps an active answer for, however old, and line ③ never wait for the budget (D23) |
| C5 | A call over the budget sends no question and hears the stranger's words at once. It is no failure: it starts no pause, and it is not remembered (D24) |
| C6 | The memory and the backoff are kept by company and by person, and the budget by company. A memory that DSoR made later than its clock now came before a clock went back, and is not used (DSOR-TEN-02a; step 19's README, decision 15) |

### Decisions

Before this step, from the two reviews, on 2026-10-28:

- **Entry 32.** A stranger's lookups get a step of their own: this one.
- **D25, entry 34. The company's pause counts five different people.** *Downside:* an outage seen
  through one person's calls no longer pauses the company. C2's backoff protects the server then.

For this step, the learner's, on 2026-10-28, each with Claude Code's recommendation taken:

- **D21. Every reply about a person is remembered for 10 seconds, on each DSoR server.** An answer, a
  failure, and a fault alike. *Downside:* a server that recovers a second after a failure is not
  asked about her for up to 10 seconds.
- **D22. When a person's lookups keep failing, DSoR waits twice as long each time,** from 10 seconds
  up to 5 minutes; any reply starts her over. *Downside:* once her record is fixed, DSoR may take up
  to 5 minutes to ask again; she uses her kept answer meanwhile.
- **D23. At most 20 lookups a minute for each company, on each DSoR server, about people DSoR knows
  nothing about,** from people's own calls. *Downside:* once strangers use it up, a real new employee
  is refused until the minute rolls on.
- **D24. Over the budget, the stranger's words.** *Downside:* a new employee hears that she does not
  work there, not "try again in a minute".

The memory and the budget live in each DSoR server's memory, as D9 and D10 do. Four DSoR servers
send up to 80 lookups a minute about strangers, and a restart forgets every memory.

### The tests, by claim

The tests ask step 45's test sign-in server. A stand-in in front of it makes it error on one
person's record. Only the date is faked.

| Claim | Tests |
|---|---|
| C1 | `D21`: after a `503` at 02:00:00, a read at 02:00:09 asks nothing and reads on the kept answer; one at 02:00:10 asks. `D21`: after a `403`, nine more reads in 9 seconds ask nothing, and each hears `INTERNAL_ERROR`. `D21`: after an answer too old to use, a read within 10 seconds asks nothing and is refused the same. `D21`, `DSOR-TEN-02a`: a failure about `user_123` holds no question back about `cfo_100` |
| C2 | `D22`: while `user_123`'s lookups keep failing, DSoR asks about her at 10, 30, 70, 150, 310, 610, and 910 seconds; a reply starts her over at 10 |
| C3 | `D25`: `user_123`'s lookups fail ten times, and org_456 never pauses: `cfo_100` is asked about. `D25`: five different people's failures pause it. `D25`: after an outage, `user_123`, who is waiting, is never the trial, and `cfo_100`'s call is |
| C4 | `D23`: 25 people DSoR knows nothing about call at once: 20 questions. `D23`: a minute later, 20 more. `D23`: `cfo_100`, with a three-hour-old active answer kept, is asked about when the budget is used up. `D23`: an agent's call at line ③ is never held back |
| C5 | `D24`, `DSOR-ERR-01b`: over the budget, a call hears the stranger's words at once, with no question; five such calls start no pause |
| C6 | `DSOR-TEN-02a`: org_456's budget used up holds back no lookup for org_789. `D21`: a memory from before a clock went back is not used |

### The breaks, with the learner's predictions

The predictions were made before any code, on 2026-10-28. Each break will be made for real in a
copy, and "Break it" will show how each prediction came out.

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · DSoR remembers only answers it can use, as in step 45b | At 01:30 org_456 takes back DSoR's key, and the SSO answers `403`. From 02:00:00 the agent reads INV-1008 under `del_100` once a second for 10 seconds | 10 questions, a `403` each |
| B2 · the budget counts people DSoR knows too | At 09:00:00 a sign-up bot's 200 new SSO accounts each name org_456 once. At 09:00:05 `cfo_100` reads INV-1008; DSoR's last answer about her is from 06:00 (active, `CFO`), three hours old | She reads INV-1008 |
| B3 · the backoff is removed: a person whose lookups keep failing is asked every 10 seconds | At 02:00 the SSO is down and five people's calls fail, so org_456 pauses. At 02:00:30 the SSO is back, except that it errors on `user_123`'s record. Her agent reads every 10 seconds; `cfo_100`, with no answer kept about her, tries every 30 seconds, until 02:05 | Refused at every try |
| B4 · a failed lookup is remembered by company, not by person | From 02:00:00 the SSO errors on `user_123`'s record only, and her agent reads INV-1008 at 02:00:00. At 02:00:03 `cfo_100`, with no answer kept about her, reads INV-1008 | She reads INV-1008 |

*The sections from "What changed since step 45b" on are written as the step is built.*
