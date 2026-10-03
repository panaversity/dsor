---
name: understand-baby-step
description: Teaches one DSoR baby step, or a range of steps, so the learner understands it before any design or code. Small parts, one per turn, each prediction settled by a real run, written in ASD-STE100, with what production needs. Use when the learner asks to understand, discuss, or review a step ("start step 17 only to understand", "explain step 16", "steps 08-20 for production"). Runs from the repository root, before the step's folder exists. Writes no code and changes no step folder.
metadata:
  version: "1.0.0"
  origin: the review of steps 08 to 20 and the step 17 session, 2026-10-03 and 2026-10-04
---

# Understanding a baby step

The order for each step is: **understand** (this skill), then **design** (Phase 0 and A
in the `build-baby-step` skill's learner mode), then **build**, then **review**. This
phase gives understanding the whole session. It ends with the design questions that
Phase A starts from. It writes no code and makes no design decision.

## 1 · Before the first part

1. Read the learner's notes: your memory, then the "Understanding sessions" and "Ways
   of working that helped" sections of `docs/baby_steps_tutorials/mj_notes.md`.
2. Read the step's entry in `docs/baby_steps_tutorials/readme.md`, the spec sections
   it links, and the schemas they name. Search the spec before you say it is silent.
3. Find out what is built: `docs/status.md` and the newest `mj_` folder. Mark a step
   that is not built "(not built)" in its heading, and teach it from the spec.
4. Split the step into four to six parts, one idea each. Show the list of parts and
   the spec link first, so the learner can read the section beside the lesson.

## 2 · The shape of one part

Give one part each turn, in this order. Leave out an item that would be empty.

1. **The problem.** A short story from the running example: who, which invoice, how
   much, and what goes wrong.
2. **The idea**, in one or two sentences.
3. **The analogy.** Reuse the established ones first: the bank teller or new clerk, the
   permission slip, the pilot's checklist, the lock that stays locked when the power
   fails. A new analogy must fit exactly. Drop it where it stops fitting.
4. **The code.** Two to six real lines, with `path:line`.
5. **The real run** (section 3). Show its output. If you shorten it, say so.
6. **For production.** The traps a real deployment hits, and the later step that
   closes each one.
7. **Hidden unknowns.** Two or three questions a newcomer would not know to ask, each
   with its answer.
8. **One question**, through AskUserQuestion. Ask for a prediction about what DSoR
   does, never about test counts. Give three or four options, each with a reason.
   Mark no option "(Recommended)" on a prediction.

## 3 · Settle each answer with a real run

- After the learner answers, run their case for real, then explain.
- If the answer is wrong, run the learner's answer beside the right one. Say why their
  instinct was reasonable. Then give the real reason, with the line of code or the
  spec sentence that decides it.
- If the answer is right, confirm it with the run in one or two lines, and add one
  fact they did not ask for.
- If the same habit causes a second miss, name the habit. The habits found so far are
  in `mj_notes.md`.
- A real run, best first:
  1. The step's own code, through a script in the scratchpad that imports its `src/`.
  2. A copy of the step in the scratchpad (rsync, without `.env`), changed there.
  3. A throwaway local PostgreSQL in the scratchpad, for database behaviour. Start it
     with `-c unix_socket_directories=''`, because the scratchpad path is too long for
     a socket. Check the ports in use with `lsof` first. Stop it at the end.
  4. The spec's JSON Schemas, through ajv from `packages/spec`.
  5. A sketch of the rule, labelled "a sketch, not DSoR code".
- Never change a step folder. Never use a step's `.env`, and never print a secret.
- A demo inside vitest does not show `console.log`, so write its output to a file.

## 4 · Writing rules (ASD-STE100)

- A description has 25 words or fewer in a sentence. An instruction has 20 or fewer,
  and gives one instruction.
- Use the active voice and the simple present. Use no -ing verb forms, except in
  technical names.
- Define each new word where it first appears. One topic in each paragraph.
- Technical names stay as they are: DSoR, PostgreSQL, tenant, operation ids, paths.
- Prefer short labelled lists and small tables to long paragraphs.
- The STE dictionary is licensed. Follow its writing rules, and do not claim that each
  word is in its approved list.

## 5 · Close the session

1. A recap table: each part, and its idea in one line.
2. The score: predictions right out of the total, and the habits behind the misses.
3. The open design questions for Phase A. Each one is a choice that the spec leaves to
   the step, with the options found. Do not decide them.
4. Record the session in `docs/baby_steps_tutorials/mj_notes.md`, under "Understanding
   sessions": the date, the steps, the habits, and the design questions. Keep the score
   out of that file, because the branch is shared. The score goes in one short line in
   your memory. A question for the specification goes under "Questions for the
   specification" in `mj_notes.md`.
5. Say which files changed, and that no code was written.

## Rules

- No code, no step folder, no design decision. If the learner offers a decision, write
  it down as a design question for Phase A.
- Never describe unbuilt behaviour in the present tense.
- One part and one question in each turn. The one exception: a second question to
  re-check a misconception that survived a miss.
- If a misconception survives one explanation, run the wrong case and the right case
  side by side. Explanation alone did not move it in step 14.
