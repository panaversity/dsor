// rule.activate on the database (step 28's README, claims C4 and C7, decisions D4, D14, and D15).
// The switch-on, the retirement of the live version, their records, and the call's decision commit
// together. Two switch-ons of one rule wait for each other under the rule's lock, so the second
// meets the first's result and its owner of record.
// The tests change rules of their own, beside migration 023's version 8, and the owner removes
// them before and after (test/owner-rules.ts).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbControls, createDbLog } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { dbRegistry, newPool, ownerRules, RUNTIME_URL, tryThenRollBack } from "./db.ts";
import { ADMIN, CFO, keyed, storyDirectories } from "./helpers.ts";
import { textOf, version9 } from "./rule-world.ts";

const pool = newPool();
const log = createDbLog(pool);

/** A registry on the database whose rules are dsor.controls, through this pool. */
function on(through: pg.Pool) {
  const rules = createDbControls(through);
  return dbRegistry(
    through,
    storyDirectories(),
    handlersFor(),
    ownWorkFor(),
    readLifetimes(),
    rules,
  );
}
const registry = on(pool);

beforeEach(() => {
  ownerRules("clear");
});
afterAll(async () => {
  ownerRules("clear");
  await pool.end();
});

/** A rule of the tests' own, which refuses INV-9001 only, drafted with this owner. */
function holdOn9001(owner: string): Record<string, unknown> {
  return {
    ...textOf(version9()),
    owner,
    condition: 'input.invoice == "dsor://org_456/invoice/INV-9001"',
    effect: { deny: { reason: "INV-9001 is on hold" } },
    tests: [{ input: { invoice: "dsor://org_456/invoice/INV-9001" }, expect: "DENY" }],
  };
}

/** Someone asks for a rule command on this rule, with a fresh key, through this registry. */
function ruleCall(
  who: RequestEnvelope,
  name: string,
  rule: string,
  fields: Record<string, unknown>,
  through = registry,
): Promise<Answer> {
  return call(through, log, keyed(who), name, { rule, ...fields, reason: `${name} by a test` });
}

/** Each version the database keeps of this rule, with its status. */
async function statuses(id: string): Promise<unknown[]> {
  const versions = await createDbControls(pool).versions("org_456", id);
  return versions.map((v) => [v.version, v.status]);
}

/** Every record of one call, as dsor_runtime reads them inside org_456. */
async function recordsOf(answer: Answer): Promise<unknown[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT kind, result, "authorization", extensions FROM dsor.audit
      WHERE correlation->>'request_id' = $1 ORDER BY sequence`,
    "org_456",
    [answer.correlation.request_id],
  );
  return rows.map((row) => [row["kind"], row["result"], row["authorization"], row["extensions"]]);
}

describe("C4, C7: a switch-on on the database (step 28's README, decisions D4 and D14)", () => {
  it("DSOR-CTL-02a: on the database, cfo_100 drafts and switches on two versions of a rule of the tests' own: the second retires the first, and its two control_change records commit with the call's decision", async () => {
    const id = `test-${randomUUID()}`;
    const rule = `dsor://org_456/rule/${id}`;
    await ruleCall(CFO, "rule.draft", rule, { draft: holdOn9001("cfo_100") });
    expect(await ruleCall(CFO, "rule.activate", rule, { version: 1 })).toMatchObject({
      outcome: "COMMITTED",
      data: { id, version: 1, status: "active" },
    });
    await ruleCall(CFO, "rule.draft", rule, { draft: holdOn9001("cfo_100") });
    const second = await ruleCall(CFO, "rule.activate", rule, { version: 2 });
    expect(second).toMatchObject({ data: { version: 2, status: "active", retired: 1 } });
    expect(await statuses(id)).toStrictEqual([
      [1, "retired"],
      [2, "active"],
    ]);
    const ours = "org.panaversity.steps";
    expect(await recordsOf(second)).toStrictEqual([
      ["proposal_transition", "PROPOSED", null, null],
      ["proposal_transition", "READY", null, { [ours]: { from: "PROPOSED" } }],
      ["proposal_transition", "EXECUTING", null, { [ours]: { from: "READY" } }],
      ["control_change", "retired", null, { [ours]: { version: 1, from: "active" } }],
      ["control_change", "active", null, { [ours]: { version: 2, from: "draft" } }],
      ["proposal_transition", "COMMITTED", null, { [ours]: { from: "EXECUTING" } }],
      ["decision", "ok", "ALLOW", expect.anything()],
    ]);
  });
});

/** Waits until PostgreSQL shows a connection waiting for a rule's lock. */
async function waitForTheLock(): Promise<void> {
  const watcher = newPool(RUNTIME_URL);
  try {
    for (let tries = 0; tries < 200; tries++) {
      const { rows } = await watcher.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(%'`,
      );
      if ((rows[0] as { n: number }).n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("the second switch-on never waited for the rule's lock");
  } finally {
    await watcher.end();
  }
}

describe("C7: two switch-ons of one rule wait for each other (step 28's README, decision D15)", () => {
  it("Step 28: a rule never switched on, two drafts, two owners, two switch-ons at once on the database: cfo_100's goes first and holds the rule's lock; admin_100's waits for it, then finds cfo_100 the owner of record, and is refused", async () => {
    const id = `test-${randomUUID()}`;
    const rule = `dsor://org_456/rule/${id}`;
    await ruleCall(CFO, "rule.draft", rule, { draft: holdOn9001("cfo_100") });
    await ruleCall(ADMIN, "rule.draft", rule, { draft: holdOn9001("admin_100") });
    // cfo_100's switch-on holds the rule's lock. Before its UPDATE, admin_100's starts, and the
    // test waits until PostgreSQL shows admin_100's waiting for the lock. Two real connections.
    const first = newPool();
    const second = newPool();
    let theirs: Promise<Answer> | undefined;
    first.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      let held = false;
      client.query = ((...a: unknown[]) => {
        if (!held && typeof a[0] === "string" && a[0].includes("UPDATE dsor.controls")) {
          held = true;
          theirs = ruleCall(ADMIN, "rule.activate", rule, { version: 2 }, on(second));
          return waitForTheLock().then(() => query(...a));
        }
        return query(...a);
      }) as typeof client.query;
    });
    try {
      const mine = await ruleCall(CFO, "rule.activate", rule, { version: 1 }, on(first));
      expect(mine).toMatchObject({ outcome: "COMMITTED", data: { version: 1, status: "active" } });
      expect(await theirs).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"rule.activate": admin_100 may not change rule ${JSON.stringify(id)}: only its owner may, in person`,
      });
    } finally {
      await first.end();
      await second.end();
    }
    expect(await statuses(id)).toStrictEqual([
      [1, "active"],
      [2, "draft"],
    ]);
  });
});

// Found by step 28's sweep, L22: with the draft's change reading the versions without the rule's
// lock, every test passed, because no test drafted twice at once.
describe("C3: two drafts of one rule wait for each other (step 28's README, decision D15)", () => {
  it("Step 28: cfo_100 and admin_100 draft one rule at once, on the database: the second waits for the rule's lock, and the two drafts take versions 1 and 2", async () => {
    const id = `test-${randomUUID()}`;
    const rule = `dsor://org_456/rule/${id}`;
    const first = newPool();
    const second = newPool();
    let theirs: Promise<Answer> | undefined;
    first.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      let held = false;
      client.query = ((...a: unknown[]) => {
        if (!held && typeof a[0] === "string" && a[0].includes("INSERT INTO dsor.controls")) {
          held = true;
          const draft = { draft: holdOn9001("cfo_100") };
          theirs = ruleCall(ADMIN, "rule.draft", rule, draft, on(second));
          return waitForTheLock().then(() => query(...a));
        }
        return query(...a);
      }) as typeof client.query;
    });
    try {
      const mine = await ruleCall(
        CFO,
        "rule.draft",
        rule,
        { draft: holdOn9001("cfo_100") },
        on(first),
      );
      expect(mine).toMatchObject({ outcome: "COMMITTED", data: { version: 1 } });
      expect(await theirs).toMatchObject({ outcome: "COMMITTED", data: { version: 2 } });
    } finally {
      await first.end();
      await second.end();
    }
    expect(await statuses(id)).toStrictEqual([
      [1, "draft"],
      [2, "draft"],
    ]);
  });
});
