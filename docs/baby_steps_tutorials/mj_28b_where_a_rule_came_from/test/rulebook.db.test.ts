// Each company's rules, in dsor.controls on the database (step 28's README, claims C1, C2, C7, and
// C8, decisions D2 to D4, D6, D14, and D18). The store keeps every version with its status, behind
// its company's lock. The database keeps one live version for each rule, refuses a delete and an
// edit of a version's text, and writes each change with its record, both or neither. Line ⑩ reads
// the store at every call. Start-up checks every version in it.
// The tests change rules of their own, beside migration 023's version 8, and the owner removes
// them before and after (test/owner-rules.ts).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Control } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbControls, createDbLog } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { fingerprintOf } from "../src/ksor.ts";
import { checkRules, type RuleBy } from "../src/rulebook.ts";
import {
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { keyed, OUR_EXTENSIONS, storyDirectories, withPlanted } from "./helpers.ts";
import { shippedRule } from "./rule-world.ts";

const pool = newPool();
const log = createDbLog(pool);
const rules = createDbControls(pool);
// A registry on the database whose line ⑩ reads dsor.controls (step 28's README, decision D18).
const registry = dbRegistry(
  pool,
  storyDirectories(),
  handlersFor(),
  ownWorkFor(),
  readLifetimes(),
  "database",
);
// intake-fte, under del_190, which the owner keeps with step 24's limits. Only the tests know its
// login, so they plant it for each call, as step 27's database tests do.
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;

beforeAll(() => {
  ownerRules("clear");
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("add");
});
// Each test starts from migration 023's version 8 alone.
beforeEach(() => {
  ownerRules("clear");
});
afterAll(async () => {
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await pool.end();
});

/** cfo_100, now, in their own words, on a call of their own. */
function byCfo(words: string): RuleBy {
  const correlation = { request_id: `req_${randomUUID()}`, principal_id: "cfo_100" };
  return { person: "cfo_100", as_of: new Date().toISOString(), words, correlation };
}

/** A rule of the tests' own, a draft: it refuses every payment of INV-9001, the tests' invoice. */
function refusing9001(id: string): Control {
  const rule = shippedRule();
  delete rule.reviewed_by;
  delete rule.effective_from;
  return {
    ...rule,
    id,
    version: 1,
    status: "draft",
    condition: 'input.invoice == "dsor://org_456/invoice/INV-9001"',
    effect: { deny: { reason: "INV-9001 is on hold" } },
    compiled_by: "cfo_100",
    tests: [{ input: { invoice: "dsor://org_456/invoice/INV-9001" }, expect: "DENY" }],
  };
}

/** intake-fte drafts a payment of INV-9001, with a fresh key. */
function draft9001(): Promise<Answer> {
  return withPlanted("tok_intake", intake, () =>
    call(registry, log, keyed(INTAKE), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-9001",
      expected_version: 1,
    }),
  );
}

/** The records of this call, as dsor_runtime reads them inside org_456. */
async function recordsOf(by: RuleBy): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT kind, result, reason, tenant, identity, resources, extensions FROM dsor.audit
      WHERE correlation->>'request_id' = $1 ORDER BY sequence`,
    "org_456",
    [by.correlation.request_id],
  );
  return rows;
}

/** One statement as dsor_runtime, inside org_456, always rolled back: its error, or "". */
async function asRuntime(sql: string, values: unknown[] = []): Promise<string> {
  try {
    await tryThenRollBack(pool, sql, "org_456", values);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("C1: dsor.controls keeps each version with its status (step 28's README, decisions D2 to D4)", () => {
  it("Step 28: migration 023 keeps org_456's high-value-payment, version 8, active, as controls.json writes it (step 28's README, decision D3)", async () => {
    const [v8] = await rules.versions("org_456", "high-value-payment");
    const shipped = shippedRule();
    // The database gives a time back with its milliseconds: the same moment, written longer.
    expect(Date.parse(v8?.effective_from ?? "")).toBe(Date.parse(shipped.effective_from ?? ""));
    expect({ ...v8, effective_from: shipped.effective_from }).toStrictEqual(shipped);
    expect(await rules.inForce("org_456", "payment.create")).toHaveLength(1);
    expect(await rules.versions("org_789")).toStrictEqual([]);
  });

  it("Step 28: a version's moves on the database: a draft, then active, naming cfo_100 its reviewer and the database's time; a move from a status it is not in changes nothing", async () => {
    const id = `test-${randomUUID()}`;
    await rules.add("org_456", refusing9001(id), byCfo("a draft"));
    expect(await rules.move("org_456", id, 1, "active", "retired", byCfo("x"))).toBe(false);
    // A draft is never suspended: the store says no, as the database's check would. Found by step
    // 28's sweep, P05: with the store's picture of moves gone, every test passed.
    expect(await rules.move("org_456", id, 1, "draft", "suspended", byCfo("x"))).toBe(false);
    const before = Date.now();
    expect(await rules.move("org_456", id, 1, "draft", "active", byCfo("on"))).toBe(true);
    const [v1] = await rules.hold("org_456", id);
    expect(v1).toMatchObject({ id, version: 1, status: "active", reviewed_by: "cfo_100" });
    const took = Date.parse(v1?.effective_from ?? "");
    expect(took).toBeGreaterThanOrEqual(before - 5_000);
    expect(took).toBeLessThanOrEqual(Date.now() + 5_000);
    // A retired version never moves again, and no version moves back to draft.
    expect(await rules.move("org_456", id, 1, "active", "retired", byCfo("off"))).toBe(true);
    expect(await rules.move("org_456", id, 1, "retired", "active", byCfo("back"))).toBe(false);
    expect(await rules.move("org_456", id, 1, "retired", "draft", byCfo("back"))).toBe(false);
  });

  it("DSOR-TEN-01b: DSoR's own WHERE names the company first: run by the owner, which no policy filters, org_456's reads and moves never see or touch a twin of its rule in org_789", () => {
    const seen = ownerRules("filters", `req_${randomUUID()}`);
    expect(seen).toStrictEqual({
      inForce: [8],
      versions: [8],
      held: [8],
      moved: false,
      twin: [
        { version: 8, status: "active" },
        { version: 9, status: "draft" },
      ],
      names: ["in force high-value-payment", "version high-value-payment"],
    });
  });

  it("DSOR-TEN-01b: with no company set, dsor_runtime reads no rule at all", async () => {
    const { rows } = await tryThenRollBack(pool, "SELECT * FROM dsor.controls");
    expect(rows).toStrictEqual([]);
  });

  // Changed by step 28's review, findings L14 and L16: the database draws a version's moves too,
  // with a trigger, for every role, and refuses an id that is not a rule's id. Each statement runs
  // beside a draft of the test's own, $1.
  it.each([
    ["delete a version", "DELETE FROM dsor.controls", "permission denied"],
    [
      "change a version's text",
      `UPDATE dsor.controls SET rule = rule || '{"condition": "false"}'`,
      "permission denied",
    ],
    [
      "add a version that is not a draft",
      `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by)
       VALUES ('org_456', 'test-on-arrival', 1, 'active', '{}', 'cfo_100')`,
      "row-level security",
    ],
    [
      "add a version whose id is not a rule's id",
      `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by)
       VALUES ('org_456', 'High-Value-Payment.', 1, 'draft', '{}', 'cfo_100')`,
      "controls_id_check",
    ],
    [
      "move a version back to draft",
      "UPDATE dsor.controls SET status = 'draft' WHERE id = 'high-value-payment'",
      "a version of a rule does not move from active to draft",
    ],
    [
      "switch a draft on with no reviewer",
      "UPDATE dsor.controls SET status = 'active' WHERE id = $1",
      "controls_switched_on",
    ],
    [
      "move a draft straight to suspended, naming a reviewer and a time",
      `UPDATE dsor.controls SET status = 'suspended', reviewed_by = 'cfo_100',
                                effective_from = clock_timestamp() WHERE id = $1`,
      "a version of a rule does not move from draft to suspended",
    ],
    [
      "retire a draft, naming a time it took effect",
      "UPDATE dsor.controls SET status = 'retired', effective_from = clock_timestamp() WHERE id = $1",
      "only a switch-on names a reviewer and the time it took effect",
    ],
    [
      "name another reviewer of an active version",
      "UPDATE dsor.controls SET reviewed_by = 'admin_100' WHERE id = 'high-value-payment'",
      "a version of a rule does not move from active to active",
    ],
  ])(
    "Step 28: dsor_runtime may not %s (step 28's README, decisions D2 and D13)",
    async (_what, sql, refusal) => {
      const id = `test-${randomUUID()}`;
      await rules.add("org_456", refusing9001(id), byCfo("a draft"));
      expect(await asRuntime(sql, sql.includes("$1") ? [id] : [])).toContain(refusal);
    },
  );

  it("Step 28: the trigger runs for the owner too: a retired version never comes back, whoever asks (step 28's review, finding L14)", () => {
    expect(ownerRules("back")).toStrictEqual({
      refused: "a version of a rule does not move from retired to active",
    });
  });

  it("Step 28: one live version for each rule: the database refuses a second active or suspended version of one rule (step 28's README, decision D4)", async () => {
    const id = `test-${randomUUID()}`;
    await rules.add("org_456", refusing9001(id), byCfo("one"));
    await rules.add("org_456", { ...refusing9001(id), version: 2 }, byCfo("two"));
    expect(await rules.move("org_456", id, 1, "draft", "active", byCfo("on"))).toBe(true);
    // Without the switch-on's first move, which retires version 1.
    await expect(rules.move("org_456", id, 2, "draft", "active", byCfo("on"))).rejects.toThrow(
      "controls_one_live",
    );
    expect((await rules.versions("org_456", id)).map((v) => v.status)).toStrictEqual([
      "active",
      "draft",
    ]);
  });
});

describe("C7: each change and its record, in one transaction (step 28's README, decision D14)", () => {
  // Not titled DSOR-AUD-01: the tutorial's records do not yet pass audit-record.schema.json, as step
  // 22's tests note. Changed by step 28's review, finding L18.
  it("Step 28: a draft and a move each leave a control_change record in dsor.audit: who, the person's words, the rule's address, the version, and the status it left", async () => {
    const id = `test-${randomUUID()}`;
    const drafted = byCfo("a hold on INV-9001");
    await rules.add("org_456", refusing9001(id), drafted);
    const switched = byCfo("switch the hold on");
    await rules.move("org_456", id, 1, "draft", "active", switched);
    const identity = {
      mode: "direct",
      subject: "cfo_100",
      actor_chain: [],
      subject_authority: { source: "token", as_of: expect.any(String) },
    };
    const of = recordsOf;
    const address = [`dsor://org_456/rule/${id}`];
    expect(await of(drafted)).toStrictEqual([
      {
        kind: "control_change",
        result: "draft",
        reason: "a hold on INV-9001",
        tenant: "org_456",
        identity,
        resources: address,
        extensions: { [OUR_EXTENSIONS]: { version: 1 } },
      },
    ]);
    expect(await of(switched)).toStrictEqual([
      {
        kind: "control_change",
        result: "active",
        reason: "switch the hold on",
        tenant: "org_456",
        identity,
        resources: address,
        extensions: { [OUR_EXTENSIONS]: { version: 1, from: "draft" } },
      },
    ]);
  });

  it("Step 28: a change whose record cannot be written does not happen: with the log broken, a draft and a move leave the store as it was (step 28's README, decision D14)", async () => {
    const id = `test-${randomUUID()}`;
    await rules.add("org_456", refusing9001(id), byCfo("a draft"));
    // A pool whose every record fails, as a full disk or a broken log would: fault injection
    // around the real client (§47), as in test/proposals.db.test.ts.
    const odd = newPool();
    odd.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      client.query = ((...a: unknown[]) => {
        if (typeof a[0] === "string" && a[0].includes("INSERT INTO dsor.audit")) {
          return Promise.reject(new Error("the log is broken"));
        }
        return query(...a);
      }) as typeof client.query;
    });
    try {
      const broken = createDbControls(odd);
      await expect(broken.move("org_456", id, 1, "draft", "active", byCfo("on"))).rejects.toThrow(
        "the log is broken",
      );
      const two = { ...refusing9001(id), version: 2 };
      await expect(broken.add("org_456", two, byCfo("two"))).rejects.toThrow("the log is broken");
    } finally {
      await odd.end();
    }
    const kept = await rules.versions("org_456", id);
    expect(kept.map((v) => [v.version, v.status])).toStrictEqual([[1, "draft"]]);
  });
});

// Found by step 28's review, finding H1: a switch-on is one step of the store. On the database it
// runs under a savepoint, so a record that fails undoes the retirement before it too.
describe("C7: a switch-on on the database is one step (step 28's README, decisions D4 and D14)", () => {
  it("Step 28: a switch-on whose second record cannot be written leaves both versions as they were: version 1 still active, version 2 still a draft", async () => {
    const id = `test-${randomUUID()}`;
    await rules.add("org_456", refusing9001(id), byCfo("one"));
    const live = byCfo("on");
    expect(await rules.switchOn("org_456", id, 1, "draft", undefined, live)).toBe(true);
    await rules.add("org_456", { ...refusing9001(id), version: 2 }, byCfo("two"));
    // A pool whose second record of a change fails, as a full disk would, after the retirement
    // and its record are written: fault injection around the real client (§47).
    const odd = newPool();
    let records = 0;
    odd.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      client.query = ((...a: unknown[]) => {
        if (
          typeof a[0] === "string" &&
          a[0].includes("INSERT INTO dsor.audit") &&
          ++records === 2
        ) {
          return Promise.reject(new Error("the log is broken"));
        }
        return query(...a);
      }) as typeof client.query;
    });
    try {
      const broken = createDbControls(odd);
      const retiring = { version: 1, from: "active" as const };
      await expect(
        broken.switchOn("org_456", id, 2, "draft", retiring, byCfo("two on")),
      ).rejects.toThrow("the log is broken");
    } finally {
      await odd.end();
    }
    const kept = await rules.versions("org_456", id);
    expect(kept.map((v) => [v.version, v.status])).toStrictEqual([
      [1, "active"],
      [2, "draft"],
    ]);
  });

  it("Step 28: a switch-on that names the wrong live version, or the wrong status, does nothing on the database", async () => {
    const id = `test-${randomUUID()}`;
    await rules.add("org_456", refusing9001(id), byCfo("one"));
    await rules.switchOn("org_456", id, 1, "draft", undefined, byCfo("on"));
    await rules.add("org_456", { ...refusing9001(id), version: 2 }, byCfo("two"));
    const wrong = { version: 1, from: "suspended" as const };
    expect(await rules.switchOn("org_456", id, 2, "draft", wrong, byCfo("x"))).toBe(false);
    expect(await rules.switchOn("org_456", id, 2, "draft", undefined, byCfo("x"))).toBe(false);
    // The live version named right, and version 2 not in the status named: the retirement that
    // came first is undone.
    const right = { version: 1, from: "active" as const };
    expect(await rules.switchOn("org_456", id, 2, "suspended", right, byCfo("x"))).toBe(false);
    const kept = await rules.versions("org_456", id);
    expect(kept.map((v) => [v.version, v.status])).toStrictEqual([
      [1, "active"],
      [2, "draft"],
    ]);
  });
});

describe("C2: line ⑩ reads dsor.controls at every call (step 28's README, decision D5)", () => {
  it("Step 28: on the database, intake-fte's payment of INV-9001, 31,400.00 USD, waits for the CFO under version 8; a rule switched on in dsor.controls that refuses INV-9001 applies to the next call; and once it is suspended, the payment waits for the CFO again", async () => {
    ownerLimits("reset");
    expect(await draft9001()).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const id = `test-${randomUUID()}`;
    await rules.add("org_456", refusing9001(id), byCfo("a hold on INV-9001"));
    await rules.move("org_456", id, 1, "draft", "active", byCfo("on"));
    expect(await draft9001()).toMatchObject({ code: "POLICY_DENIED" });
    await rules.move("org_456", id, 1, "active", "suspended", byCfo("off"));
    expect(await draft9001()).toMatchObject({ outcome: "PENDING_APPROVAL" });
  });
});

// Found by step 28's review, finding M5: line ⑨ and line ⑩ read the rules through the pool, while
// the claim held a connection of its own. Four calls at once on a pool of two each held one
// connection and waited for another, for ever.
describe("C2: line ⑩ reads the rules on the claim's own connection (step 28's README, decision D5)", () => {
  it("Step 28: four payments of INV-9001 at once, through one pool of two connections, in a world that reads dsor.controls: each one waits for the CFO, and none waits for a connection", async () => {
    ownerLimits("reset");
    const small = newPool();
    try {
      const world = dbRegistry(
        small,
        storyDirectories(),
        handlersFor(),
        ownWorkFor(),
        readLifetimes(),
        "database",
      );
      const one = () =>
        call(world, log, keyed(INTAKE), "payment.create", {
          invoice: "dsor://org_456/invoice/INV-9001",
          expected_version: 1,
        });
      const answers = await withPlanted("tok_intake", intake, () =>
        Promise.all([one(), one(), one(), one()]),
      );
      const heard = answers.map((a) =>
        "outcome" in a ? a.outcome : "code" in a ? a.code : "data",
      );
      expect(heard).toStrictEqual([
        "PENDING_APPROVAL",
        "PENDING_APPROVAL",
        "PENDING_APPROVAL",
        "PENDING_APPROVAL",
      ]);
    } finally {
      await small.end();
    }
  });
});

describe("C8: start-up checks dsor.controls (step 28's README, decision D6)", () => {
  it("Step 28: start-up's check of dsor.controls passes on migration 023's version 8, and names an active rule that a hand edit planted, whose test fails", async () => {
    expect(await checkRules(registry, ["org_456", "org_789"])).toStrictEqual([]);
    ownerRules("plant");
    try {
      expect(await checkRules(registry, ["org_456", "org_789"])).toStrictEqual([
        "dsor.controls: org_456's control planted-rule v1 fails its test 1: expects ALLOW, gives REQUIRE_APPROVAL",
        "dsor.controls: org_456's control planted-rule v1 fails its test 4: expects ALLOW, gives REQUIRE_APPROVAL",
      ]);
    } finally {
      ownerRules("clear");
    }
  });
});

// The version of the payment-approval policy in force once the finance team publishes version 5,
// and version 6 after it, as the sweep hands them to the store (step 28b's README, decision D5).
const V5 = {
  version: 5,
  content_hash: fingerprintOf("Payments above 20,000 USD or equivalent require CFO approval."),
};
const V6 = {
  version: 6,
  content_hash: fingerprintOf("Payments above 15,000 USD or equivalent require CFO approval."),
};

/** dsor-scheduler's sweep, now, on a call of its own. */
function bySweep(): RuleBy {
  const correlation = { request_id: `req_${randomUUID()}`, principal_id: "dsor-scheduler" };
  return {
    person: "dsor-scheduler",
    as_of: new Date().toISOString(),
    words: "its policy moved in KSoR",
    correlation,
  };
}

/** The notices of this call, as dsor_runtime reads them inside org_456. */
async function noticesOf(by: RuleBy): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT tenant_id, to_person, rule_id, version, words FROM dsor.notices
      WHERE correlation->>'request_id' = $1 ORDER BY at`,
    "org_456",
    [by.correlation.request_id],
  );
  return rows;
}

/** A rule of the tests' own, switched on: the hold on INV-9001, active. */
async function holdOn(): Promise<string> {
  const id = `test-${randomUUID()}`;
  await rules.add("org_456", refusing9001(id), byCfo("a hold on INV-9001"));
  await rules.switchOn("org_456", id, 1, "draft", undefined, byCfo("switch the hold on"));
  return id;
}

describe("C2: on the database, the sweep's mark (step 28b's README, decisions D5 and D6)", () => {
  it("DSOR-CTL-03a: on the database, the sweep's mark moves a version from active to stale_authority, by the database's own clock, with the version in force, its record, and a notice to its owner, cfo_100, in one transaction", async () => {
    const id = await holdOn();
    const by = bySweep();
    const before = Date.now();
    expect(await rules.mark("org_456", id, 1, undefined, V5, by, "the hold cites version 4")).toBe(
      true,
    );
    const [v1] = (await rules.inForce("org_456", "payment.create")).filter((v) => v.id === id);
    expect(v1).toMatchObject({ id, version: 1, status: "stale_authority" });
    expect(v1?.stale?.in_force).toStrictEqual(V5);
    const since = Date.parse(v1?.stale?.since ?? "");
    expect(since).toBeGreaterThanOrEqual(before - 5_000);
    expect(since).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(await recordsOf(by)).toStrictEqual([
      {
        kind: "control_change",
        result: "stale_authority",
        reason: "its policy moved in KSoR",
        tenant: "org_456",
        identity: {
          mode: "direct",
          subject: "dsor-scheduler",
          actor_chain: [],
          subject_authority: { source: "token", as_of: by.as_of },
        },
        resources: [`dsor://org_456/rule/${id}`],
        extensions: { [OUR_EXTENSIONS]: { version: 1, from: "active", in_force: V5 } },
      },
    ]);
    expect(await noticesOf(by)).toStrictEqual([
      {
        tenant_id: "org_456",
        to_person: "cfo_100",
        rule_id: id,
        version: 1,
        words: "the hold cites version 4",
      },
    ]);
    // The mark rides only with line ⑩'s read: the versions read elsewhere carry none.
    expect("stale" in (await rules.versions("org_456", id))[0]!).toBe(false);
  });

  it("Step 28b: on the database, a second mark keeps the time of the first and names the newer version in force; a mark that finds the version not as the sweep saw it changes nothing (decision D5)", async () => {
    const id = await holdOn();
    expect(await rules.mark("org_456", id, 1, undefined, V5, bySweep(), "first")).toBe(true);
    const [first] = (await rules.inForce("org_456")).filter((v) => v.id === id);
    const again = bySweep();
    expect(await rules.mark("org_456", id, 1, first!.stale, V6, again, "again")).toBe(true);
    const [second] = (await rules.inForce("org_456")).filter((v) => v.id === id);
    expect(second?.stale).toStrictEqual({ since: first!.stale!.since, in_force: V6 });
    expect((await noticesOf(again)).map((n) => n["words"])).toStrictEqual(["again"]);
    const late = bySweep();
    expect(await rules.mark("org_456", id, 1, undefined, V6, late, "x")).toBe(false);
    expect(await rules.mark("org_456", id, 1, first!.stale, V6, late, "x")).toBe(false);
    expect(await rules.mark("org_456", id, 1, second!.stale, V6, late, "x")).toBe(false);
    await rules.add("org_456", { ...refusing9001(id), version: 2 }, byCfo("two"));
    expect(await rules.mark("org_456", id, 2, undefined, V5, late, "x")).toBe(false);
    expect(await recordsOf(late)).toStrictEqual([]);
    expect(await noticesOf(late)).toStrictEqual([]);
  });

  it("Step 28b: a mark whose notice cannot be written does not happen: the version stays active, with no record (decision D5)", async () => {
    const id = await holdOn();
    // A pool whose every notice fails, as a full disk would: fault injection around the real
    // client (§47), as for the log above.
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
    const by = bySweep();
    try {
      await expect(
        createDbControls(odd).mark("org_456", id, 1, undefined, V5, by, "x"),
      ).rejects.toThrow("the notices are broken");
    } finally {
      await odd.end();
    }
    expect((await rules.versions("org_456", id)).map((v) => v.status)).toStrictEqual(["active"]);
    expect(await recordsOf(by)).toStrictEqual([]);
  });

  it.each([
    [
      "move a version to stale_authority with no version in force",
      "UPDATE dsor.controls SET status = 'stale_authority' WHERE id = $1",
      "controls_stale_marked",
    ],
    [
      "name the time a version went stale",
      "UPDATE dsor.controls SET stale_since = clock_timestamp() WHERE id = $1",
      "permission denied",
    ],
    [
      "give an active version a version in force",
      `UPDATE dsor.controls SET in_force = '{"version": 5, "content_hash": "sha256:ab"}' WHERE id = $1`,
      "a version of a rule does not move from active to active",
    ],
    [
      "mark a version with a version in force of another shape",
      `UPDATE dsor.controls SET status = 'stale_authority',
                                in_force = '{"version": "5", "content_hash": "sha256:ab"}' WHERE id = $1`,
      "controls_in_force_shape",
    ],
    ["change a notice", "UPDATE dsor.notices SET to_person = 'admin_100'", "permission denied"],
    ["delete a notice", "DELETE FROM dsor.notices", "permission denied"],
    [
      "add a notice with a time of its own",
      `INSERT INTO dsor.notices (notice_id, tenant_id, to_person, rule_id, version, words,
                                 correlation, at)
       VALUES ('ntc_00000000-0000-4000-8000-000000000001', 'org_456', 'cfo_100', $1, 1, 'x',
               '{}', '2020-01-01T00:00:00Z')`,
      "permission denied",
    ],
  ])(
    "Step 28b: dsor_runtime may not %s (step 28b's README, decisions D5 and D6)",
    async (_what, sql, refusal) => {
      const id = await holdOn();
      expect(await asRuntime(sql, sql.includes("$1") ? [id] : [])).toContain(refusal);
    },
  );

  it("Step 28b: a stale version never moves back to active, keeps its mark when its owner suspends it, and is marked again only with another version in force (decision D6)", async () => {
    const id = await holdOn();
    await rules.mark("org_456", id, 1, undefined, V5, bySweep(), "x");
    expect(
      await asRuntime("UPDATE dsor.controls SET status = 'active' WHERE id = $1", [id]),
    ).toContain("a version of a rule does not move from stale_authority to active");
    expect(
      await asRuntime(`UPDATE dsor.controls SET in_force = $2::jsonb WHERE id = $1`, [id, V5]),
    ).toContain("a second mark keeps the time of the first, and names another version in force");
    expect(
      await asRuntime(
        "UPDATE dsor.controls SET status = 'suspended', in_force = NULL WHERE id = $1",
        [id],
      ),
    ).toContain("only a mark names when a version went stale, and the version in force");
    expect(await rules.move("org_456", id, 1, "stale_authority", "suspended", byCfo("off"))).toBe(
      true,
    );
    expect(
      await rules.inForce("org_456", "payment.create").then((v) => v.map((c) => c.id)),
    ).not.toContain(id);
  });

  // Found by step 28b's own break of migration 024: with the trigger letting a second mark change
  // the time of the first, every test passed, because dsor_runtime cannot name the column at all.
  // The owner can.
  it("Step 28b: the trigger keeps the time of a first mark for the owner too, who holds every privilege (decision D9)", () => {
    expect(ownerRules("retime")).toStrictEqual({
      refused: "a second mark keeps the time of the first, and names another version in force",
    });
  });

  it("Step 28b: a stale version is its rule's live version: the database refuses an active one beside it (decision D7)", async () => {
    const id = await holdOn();
    await rules.mark("org_456", id, 1, undefined, V5, bySweep(), "x");
    await rules.add("org_456", { ...refusing9001(id), version: 2 }, byCfo("two"));
    await expect(rules.move("org_456", id, 2, "draft", "active", byCfo("on"))).rejects.toThrow(
      "controls_one_live",
    );
    const live = { version: 1, from: "stale_authority" as const };
    expect(await rules.switchOn("org_456", id, 2, "draft", live, byCfo("on"))).toBe(true);
    expect((await rules.versions("org_456", id)).map((v) => [v.version, v.status])).toStrictEqual([
      [1, "retired"],
      [2, "active"],
    ]);
  });

  it("DSOR-TEN-01b: with no company set, dsor_runtime reads no notice", async () => {
    const id = await holdOn();
    await rules.mark("org_456", id, 1, undefined, V5, bySweep(), "x");
    const { rows } = await tryThenRollBack(pool, "SELECT * FROM dsor.notices");
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-CTL-04: on the database, the decision's record in dsor.audit names the stale hold by id and version, with the policy in force, version 5, and superseded_version 4, beside version 8, and says why the hold refused", async () => {
    ownerLimits("reset");
    const id = await holdOn();
    await rules.mark("org_456", id, 1, undefined, V5, bySweep(), "x");
    const answer = await draft9001();
    expect(answer).toMatchObject({ code: "POLICY_DENIED" });
    const { rows } = await tryThenRollBack(
      pool,
      `SELECT controls, extensions FROM dsor.audit
        WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
      "org_456",
      [answer.correlation.request_id],
    );
    const cited = shippedRule().authority;
    expect(rows[0]?.["controls"]).toStrictEqual([
      { id: "high-value-payment", version: 8, outcome: "REQUIRE_APPROVAL", authority: cited },
      {
        id,
        version: 1,
        outcome: "DENY",
        authority: { ...cited, version: 5, content_hash: V5.content_hash },
        superseded_version: 4,
      },
    ]);
    expect(rows[0]?.["extensions"]?.[OUR_EXTENSIONS]?.denied_by).toStrictEqual([
      {
        control: id,
        reason:
          "it is stale: the policy it cites moved, its on_stale says require_approval, and its effect names no approver",
      },
    ]);
  });

  it("DSOR-CTL-03b: on the database, a stale rule is still read at line ⑩: the stale hold on INV-9001 still refuses intake-fte's payment, and start-up still checks it and runs its tests", async () => {
    ownerLimits("reset");
    const id = await holdOn();
    expect(await draft9001()).toMatchObject({ code: "POLICY_DENIED" });
    await rules.mark("org_456", id, 1, undefined, V5, bySweep(), "x");
    expect(await draft9001()).toMatchObject({ code: "POLICY_DENIED" });
    expect(await checkRules(registry, ["org_456", "org_789"])).toStrictEqual([]);
  });
});
