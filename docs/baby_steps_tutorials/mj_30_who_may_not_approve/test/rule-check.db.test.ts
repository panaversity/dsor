// The sweep, rule.check_authority, on the database (step 28b's README, claims C2 and C3,
// decisions D4 to D6). Each mark, its record, and its notice are written inside the sweep's
// claim, in one transaction. Two sweeps at once mark a version once, and tell its owner once. The
// tests sweep migration 023's version 8, and the owner puts it back to active before and after
// (test/owner-rules.ts).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { fingerprintOf } from "../src/ksor.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbControls, createDbLog } from "../src/postgres.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { dbRegistry, newPool, ownerRules, tryThenRollBack } from "./db.ts";
import { keyed, OUR_EXTENSIONS, POLICY, storyDirectories, storyKsors, V5_TEXT } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const rules = createDbControls(pool);
// dsor-scheduler, DSoR's own system login (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const ORG_456 = { company: "dsor://org_456/tenant/org_456" };
const V5 = { version: 5, content_hash: fingerprintOf(V5_TEXT) };

/** A world on the database that reads dsor.controls, with the story's KSoR, and org_456's KSoR. */
function world(on = pool) {
  const ksors = storyKsors();
  const registry = dbRegistry(
    on,
    storyDirectories(),
    handlersFor(),
    ownWorkFor(),
    readLifetimes(),
    "database",
    ksors,
  );
  return { registry, ksor: ksors.get("org_456")! };
}

/** dsor-scheduler sweeps org_456 in this world, with a fresh key. */
function sweep(registry: Registry): Promise<Answer> {
  return call(registry, log, keyed(SCHEDULER), "rule.check_authority", ORG_456);
}

/** Version 8's status, as dsor.controls keeps it. */
async function status8(): Promise<string | undefined> {
  return (await rules.versions("org_456", "high-value-payment"))[0]?.status;
}

/** One statement as dsor_runtime inside org_456, rolled back after, and its rows. */
async function rowsOf(sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(pool, sql, "org_456", values)).rows;
}

/** The notices these calls left. */
function noticesOf(...requests: string[]): Promise<Record<string, unknown>[]> {
  return rowsOf(
    `SELECT to_person, rule_id, version FROM dsor.notices
      WHERE correlation->>'request_id' = ANY($1) ORDER BY at`,
    [requests],
  );
}

/** The rule changes these calls recorded. */
function marksOf(...requests: string[]): Promise<Record<string, unknown>[]> {
  return rowsOf(
    `SELECT result, identity->>'subject' AS subject, extensions FROM dsor.audit
      WHERE kind = 'control_change' AND correlation->>'request_id' = ANY($1) ORDER BY sequence`,
    [requests],
  );
}

beforeEach(() => {
  ownerRules("clear");
});
afterAll(async () => {
  ownerRules("clear");
  await pool.end();
});

describe("C2: the sweep on the database (step 28b's README, decisions D4 and D5)", () => {
  it("DSOR-CTL-03a: on the database, once the finance team publishes version 5, dsor-scheduler's sweep marks migration 023's version 8 stale_authority, with version 5 in force, its record, and a notice to cfo_100, inside the sweep's claim", async () => {
    const { registry, ksor } = world();
    expect(await sweep(registry)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", asked: 1, unanswered: 0, marked: 0 },
    });
    expect(await status8()).toBe("active");
    ksor.publish(POLICY, V5_TEXT);
    const answer = await sweep(registry);
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", asked: 1, unanswered: 0, marked: 1 },
    });
    const [v8] = await rules.inForce("org_456", "payment.create");
    expect(v8).toMatchObject({ version: 8, status: "stale_authority", stale: { in_force: V5 } });
    const request = answer.correlation.request_id;
    expect(await marksOf(request)).toStrictEqual([
      {
        result: "stale_authority",
        subject: "dsor-scheduler",
        extensions: { [OUR_EXTENSIONS]: { version: 8, from: "active", in_force: V5 } },
      },
    ]);
    expect(await noticesOf(request)).toStrictEqual([
      { to_person: "cfo_100", rule_id: "high-value-payment", version: 8 },
    ]);
  });

  it("Step 28b: on the database, two sweeps at once mark version 8 once, and tell cfo_100 once (decision D5)", async () => {
    const { registry, ksor } = world();
    ksor.publish(POLICY, V5_TEXT);
    const both = await Promise.all([sweep(registry), sweep(registry)]);
    const marked = both.map((a) => ("data" in a ? (a.data as { marked: number }).marked : a));
    expect([...marked].sort()).toStrictEqual([0, 1]);
    const requests = both.map((a) => a.correlation.request_id);
    expect(await noticesOf(...requests)).toHaveLength(1);
    expect(await marksOf(...requests)).toHaveLength(1);
    expect(await status8()).toBe("stale_authority");
  });

  it("Step 28b: on the database, a sweep whose notice cannot be written marks nothing: version 8 stays active, and no mark is recorded (decision D5)", async () => {
    // A pool whose every notice fails, as a full disk would: fault injection around the real
    // client (§47).
    const odd = newPool();
    odd.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      client.query = ((...a: unknown[]) => {
        if (typeof a[0] === "string" && a[0].includes("INSERT INTO dsor.notices")) {
          return Promise.reject(new Error("the notices are broken"));
        }
        return query(...a);
      }) as typeof client.query;
    });
    let answer: Answer;
    try {
      const { registry, ksor } = world(odd);
      ksor.publish(POLICY, V5_TEXT);
      answer = await sweep(registry);
    } finally {
      await odd.end();
    }
    // DSoR's own work failed inside its claim, so the claim's transaction rolled back: every mark,
    // record, and notice of the sweep with it.
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await status8()).toBe("active");
    expect(await marksOf(answer.correlation.request_id)).toStrictEqual([]);
  });
});
