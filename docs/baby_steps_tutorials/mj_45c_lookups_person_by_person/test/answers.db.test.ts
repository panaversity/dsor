// The answers live in DSoR's PostgreSQL, in dsor.role_answers, so every DSoR server
// shares them and a restart keeps them (step 45's README, C7 and D8). The agent works under del_100,
// which user_123 signed, and DSoR asks a test sign-in server for org_456. DSoR's clock runs for
// real here: rows stay in the database from run to run, and older news never replaces newer.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbAnswers } from "../src/postgres.ts";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import {
  futureNewsForgotten,
  futureNewsGoes,
  laterAnswerStays,
  newerNewsStays,
} from "./kept-answers.ts";
import { AGENT, MASKED_1008_OF_456, storyDirectories } from "./helpers.ts";
import { NO_PRIVILEGE, dbRegistry, newPool, tryThenRollBack } from "./db.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const pool = newPool();
afterAll(async () => {
  await pool.end();
});

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };
const CHECK_VIOLATION = { code: "23514" };
const KEPT = `SELECT answer, as_of, asked_at FROM dsor.role_answers
               WHERE tenant_id = 'org_456' AND person = 'user_123'`;

let server: SignInServer;

/** A DSoR on the test database whose role source for org_456 is the test server's lookup. */
function dsor(): Registry {
  const lookup = lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
  return dbRegistry(pool, new Map([...storyDirectories(), ["org_456", lookup]]));
}

/** Keeps an answer about user_123, active as ap_supervisor, as DSoR asked for it 30 seconds ago. */
async function keptFrom30SecondsAgo(): Promise<number> {
  const at = Date.now() - 30_000;
  const answer = {
    tenant: "org_456",
    person: "user_123",
    status: "active",
    roles: ["ap_supervisor"],
  };
  await createDbAnswers(pool).keep("org_456", "user_123", {
    answer: { ...answer, as_of: new Date(at).toISOString() },
    at,
    asked: at,
  });
  return at;
}

beforeEach(async () => {
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
  });
  // Each test starts with no kept answer about user_123: the row stays from test to test, and a
  //   test on a clock that runs ahead may have left one asked for later than now.
  await createDbAnswers(pool).forget("org_456", "user_123", Date.parse("9999-12-31T00:00:00Z"));
});

afterEach(async () => {
  await server.stop();
});

describe("C7 and D8: the answers live in DSoR's PostgreSQL", () => {
  it("D8: the answer DSoR used is in dsor.role_answers, with the moment DSoR asked", async () => {
    const before = Date.now();
    expect(await call(dsor(), createLog(), AGENT, "invoice.get", INVOICE)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    const { rows } = await tryThenRollBack(pool, KEPT, "org_456");
    expect(rows).toHaveLength(1);
    const [row] = rows as { answer: unknown; as_of: Date; asked_at: Date }[];
    expect(row?.answer).toMatchObject({
      tenant: "org_456",
      person: "user_123",
      status: "active",
      roles: ["ap_supervisor"],
    });
    expect(row?.asked_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.as_of.getTime()).toBeLessThanOrEqual(row?.asked_at.getTime() ?? 0);
  });

  it("D8: a second DSoR on the same database uses the answer again, and does not ask", async () => {
    expect(await call(dsor(), createLog(), AGENT, "invoice.get", INVOICE)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    expect(await call(dsor(), createLog(), AGENT, "invoice.get", INVOICE)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    expect(server.asked()).toBe(1);
  });

  it("D8: after a restart, a kept answer from 30 seconds ago still counts while the server cannot answer, and the record names it", async () => {
    const at = await keptFrom30SecondsAgo();
    server.replyStatus(503);
    const log = createLog();
    expect(await call(dsor(), log, AGENT, "invoice.get", INVOICE)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    expect(server.asked()).toBe(1);
    expect(await log.records()).toMatchObject([
      {
        identity: {
          subject_authority: { source: "role_source", as_of: new Date(at).toISOString() },
        },
      },
    ]);
  });

  it("D8: one DSoR hears an answer about cfo_100 and forgets the kept answer, so another DSoR's next 'cannot answer now' is refused", async () => {
    await keptFrom30SecondsAgo();
    server.answerAbout("cfo_100");
    expect(await call(dsor(), createLog(), AGENT, "invoice.get", INVOICE)).toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(await createDbAnswers(pool).get("org_456", "user_123")).toBeUndefined();
    server.answerAbout(undefined);
    server.replyStatus(503);
    expect(await call(dsor(), createLog(), AGENT, "invoice.get", INVOICE)).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
    expect(server.asked()).toBe(2);
  });

  it("DSOR-TEN-02a: org_789 never sees org_456's answers", async () => {
    expect(await call(dsor(), createLog(), AGENT, "invoice.get", INVOICE)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    const theirs = `SELECT count(*)::int AS n FROM dsor.role_answers
                     WHERE tenant_id = 'org_456' AND person = 'user_123'`;
    expect((await tryThenRollBack(pool, theirs, "org_456")).rows).toStrictEqual([{ n: 1 }]);
    expect((await tryThenRollBack(pool, theirs, "org_789")).rows).toStrictEqual([{ n: 0 }]);
  });

  it("D2: the database refuses to keep an answer about someone else under user_123", async () => {
    const at = Date.now();
    const aboutCfo = { tenant: "org_456", person: "cfo_100", status: "active", roles: ["CFO"] };
    await expect(
      createDbAnswers(pool).keep("org_456", "user_123", {
        answer: { ...aboutCfo, as_of: new Date(at).toISOString() },
        at,
        asked: at,
      }),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it("D8: dsor_runtime cannot delete a kept answer, only forget it", async () => {
    const sql = "DELETE FROM dsor.role_answers WHERE person = 'user_123'";
    await expect(tryThenRollBack(pool, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });
});

describe("D8: the kept answers in the database keep the newer news (step 19's README, decision 14)", () => {
  it("step 19's decision 14: an answer whose facts are older never replaces one whose facts are newer, in one statement", async () => {
    await newerNewsStays(createDbAnswers(pool), Date.now());
  });

  it("step 19's decision 14: a reply DSoR could not use forgets the kept answer, unless DSoR asked for that answer after the question that failed", async () => {
    await laterAnswerStays(createDbAnswers(pool), Date.now());
  });

  it("step 19's decision 15: an answer kept before DSoR's clock went back, whose facts are later than its clock now, is replaced by the next answer", async () => {
    await futureNewsGoes(createDbAnswers(pool), Date.now());
  });

  it("step 19's decision 15: a reply DSoR could not use forgets an answer kept before DSoR's clock went back, though it was asked for later than that reply", async () => {
    await futureNewsForgotten(createDbAnswers(pool), Date.now());
  });
});
