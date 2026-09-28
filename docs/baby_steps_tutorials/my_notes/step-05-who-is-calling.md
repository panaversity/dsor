# Step 05 · Who is calling

Folder: `my_05_who_is_calling`. Built 2026-09-28. Copy of `my_04_result_and_error_envelopes`
plus one new idea: **every request now has a caller, and a request with no caller is
refused.**

Decisions [21 to 31](decisions.md), and [41](decisions.md). Tests: 111.

## What it does

A call used to be `callOperation(id, args)`. It is now
`callOperation(login, id, args)`, and the login is the **first** thing read — before the
operation is looked up, before the arguments are touched. If there is no login, or the name
in it is nobody this program knows, the answer is `AUTHENTICATION_REQUIRED`, retry `never`,
and no operation runs at all.

Three people exist: `user_123` and `cfo_100` (humans) and `accounts-payable-fte` (an agent).
The agent is an ordinary entry in the same list and logs in as itself.

Every answer now carries `askedBy`, and every envelope inside it carries the same name as
`correlation.principal_id`.

## Why the step exists

Steps 01 to 04 built a program that would do whatever it was asked. The refusals it had were
all about the *request* being wrong — a bad address, an invoice that is not a draft. None was
about the *asker*. `DSOR-IDN-01` requires the caller to be resolved to a principal before any
other processing, and everything the remaining 47 steps add — may you, under whose authority,
who approved, who is in the audit record — is a sentence with a subject. Without this step
there is no subject.

## The idea the step refuses to take

The login holds **one** field: who you are. There is nowhere to write "and I am acting for
someone else". See [decision 23](decisions.md).

That shape is worth keeping, and the reason first written beside it was wrong. It was claimed
as honouring `DSOR-IDN-02a`, *"an agent MUST authenticate with its own credentials, never a
human's session"*. It does not: nothing here authenticates, so the agent can simply send
`{ loggedInAs: "cfo_100" }` and be recorded as the CFO. One field stops a caller **declaring**
two identities; the rule is about one **borrowing** an identity that is not theirs. Found by
hostile review, corrected in [decision 27](decisions.md), and the reason it got through is in
[lesson 6](lessons.md).

The cost is stated plainly in the step's README: the running example's *normal* case —
`accounts-payable-fte` acting for `user_123` under `del_100` — cannot be built here. That
needs a delegation record, which is step 18.

## What the sweeps found

Thirty-three mutations across two rounds: 32 killed, 1 proven unkillable. Two were serious,
and both passed all 93 tests that existed at the time.

| Mutation | What it did | Caught by |
| --- | --- | --- |
| `p.id === id` → `id.startsWith(p.id)` | **`cfo_100_evil` logs in as `cfo_100`** | a test for whole-name matching, added |
| `askedBy: "(nobody)"` → `"user_123"` | **forges a name onto an unauthenticated request** | a test asserting the refusal names nobody |
| the caller's name dropped or replaced, 20 sites | a name quietly absent from, or wrong on, an envelope | one test over 12 call shapes |

The first is the one worth remembering: a one-word change to a comparison, no test red, and
an authentication bypass. A prefix match is not an identity match.

Two sites the sweep found untested were only found because the sweep was run line by line
rather than on a sample: the refusal for an argument that is not text, and the refusal for an
address naming the wrong kind of thing. A `grep` filter had hidden the first from the listing
that the sweep was built from — the sweep is only as complete as the list it walks.

## What the review found that the sweep could not

Five hostile passes, one job each. They found four things worth the whole exercise, and the
first is a correction to the sweep itself.

| Found | Why the sweep missed it |
| --- | --- |
| all twenty-two attribution sites replaced with one constant passed 100 tests | the sweep mutates one site at a time; only the whole family at once is self-consistent and wrong. [Lesson 10](lessons.md), [decision 31](decisions.md) |
| `DSOR-IDN-02a` was claimed and is not met | not a code defect at all. No mutation can catch a false sentence in a README. [Decision 27](decisions.md) |
| the caller's arguments were read twice, so a receipt could fingerprint a request that never happened | needs an argument with a *getter*; nothing in the suite passes one. [Decision 28](decisions.md) |
| an unhashable argument issued the invoice and then threw | same reason — no test passes a circular object or a `BigInt`. [Decision 28](decisions.md) |
| the answer object was `readonly` with no freeze | the sweep walked the guards that exist; this was a guard that did not exist. [Decision 29](decisions.md) |
| a `null` login threw instead of refusing | [Decision 30](decisions.md) |

Every one of the code findings came with a demonstration that ran. The five new guards were
then mutated in turn, and all five are held by a test.

Two process faults are recorded in [lesson 9](lessons.md): the five passes were run against
one folder while three of them were sabotaging it, which contaminated one pass's counts until
it noticed, and left a *sabotaged* copy of `login.ts` lying at the folder root as if it were a
backup.

## The mutation that could not be killed

One survived, and the probe showed it is unkillable rather than untested. Full reasoning in
[decision 25](decisions.md). The short version: reading the caller's name from the typed text
instead of from the directory lookup is indistinguishable today, because the lookup matches
exactly, and becomes an identity bug the moment the lookup gains any leniency. It is a
comment in the code, not a test, and it is recorded here so nobody later mistakes it for
decoration.

## Limits written down

| Here | Becomes |
| --- | --- |
| a login is a name, with no password, no token, no session | step 43 for people, step 44 for agents |
| three people in a frozen array in the source | step 43, a real identity provider |
| a principal built inside the program, no `security-context` document validated | unsettled — see [open question 2](open-questions.md) |
| `AUTHENTICATION_REQUIRED` is the only identity refusal | step 06 adds `AUTHORIZATION_DENIED` |
| both "no login" and "unknown name" answer the same code, deliberately | stays — telling them apart tells an attacker which names exist |

## What is not claimed

The step's README claims **one** rule met, `DSOR-IDN-01`, and one met in half,
`DSOR-SRC-02a` — the half that says nothing is derived from the arguments, not the half that
says the request is authenticated. Every other rule named on the page says which part is
missing and which step brings it. That is the count the tutorial map gives step 05, and it
took a review to get back to it ([decision 27](decisions.md)).

The break in the house pattern — no normative schema copied for the identity artifact — is
[decision 26](decisions.md), and it is the one thing in this step still waiting on the
learner's answer.
