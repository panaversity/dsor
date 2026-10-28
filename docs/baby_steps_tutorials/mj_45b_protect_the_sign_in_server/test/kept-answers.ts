// The two rules of step 19's decision 14, for any store of kept answers, in
// memory or in the database: older news never replaces newer, and a reply DSoR could not use
// forgets only an answer DSoR asked for before that question (step 45's README, D8).
import { expect } from "vitest";
import type { KeptAnswers } from "../src/answers.ts";

/** An answer about user_123, active as ap_supervisor, whose facts were read at this time. */
function readAt(time: number): Record<string, unknown> {
  const fields = {
    tenant: "org_456",
    person: "user_123",
    status: "active",
    roles: ["ap_supervisor"],
  };
  return { ...fields, as_of: new Date(time).toISOString() };
}

/** The two rules of step 19's decision 14, for a store of kept answers. */
export async function newerNewsStays(answers: KeptAnswers, now: number): Promise<void> {
  // Facts read now, asked for now; then facts read a minute ago, from a question that came later.
  await answers.keep("org_456", "user_123", { answer: readAt(now), at: now, asked: now });
  const older = now - 60_000;
  await answers.keep("org_456", "user_123", {
    answer: readAt(older),
    at: older,
    asked: now + 1000,
  });
  expect((await answers.get("org_456", "user_123"))?.at).toBe(now);
}

/** A kept answer whose facts are later than DSoR's clock now never stops a new one. */
export async function futureNewsGoes(answers: KeptAnswers, now: number): Promise<void> {
  // Kept by a DSoR whose clock ran an hour ahead, and has since been put right.
  const ahead = now + 60 * 60 * 1000;
  await answers.keep("org_456", "user_123", { answer: readAt(ahead), at: ahead, asked: ahead });
  await answers.keep("org_456", "user_123", { answer: readAt(now), at: now, asked: now });
  expect((await answers.get("org_456", "user_123"))?.at).toBe(now);
}

/** A reply DSoR could not use forgets a kept answer asked for later than DSoR's clock now too. */
export async function futureNewsForgotten(answers: KeptAnswers, now: number): Promise<void> {
  // Kept by a DSoR whose clock ran an hour ahead. Found by step 45's review, finding 5.
  const ahead = now + 60 * 60 * 1000;
  await answers.keep("org_456", "user_123", { answer: readAt(ahead), at: ahead, asked: ahead });
  await answers.forget("org_456", "user_123", now);
  expect(await answers.get("org_456", "user_123")).toBeUndefined();
}

/** A reply DSoR could not use forgets the kept answer, unless DSoR asked for that one later. */
export async function laterAnswerStays(answers: KeptAnswers, now: number): Promise<void> {
  // Facts read a minute before DSoR asked, so the two times differ: found by step 45's review,
  //   mutation M3, which compared the facts' time.
  const read = now - 60_000;
  await answers.keep("org_456", "user_123", { answer: readAt(read), at: read, asked: now });
  // The question that failed was asked a second before the kept answer's: the kept one stays.
  await answers.forget("org_456", "user_123", now - 1000);
  expect((await answers.get("org_456", "user_123"))?.asked).toBe(now);
  // Asked at the same moment: the kept answer goes.
  await answers.forget("org_456", "user_123", now);
  expect(await answers.get("org_456", "user_123")).toBeUndefined();
}
