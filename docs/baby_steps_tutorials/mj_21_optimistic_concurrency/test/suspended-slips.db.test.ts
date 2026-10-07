// Suspended slips on the database. The unit tests prove the suspensions with slips in memory.
// These prove them in dsor.delegations and dsor.audit: the suspensions and their records read
// back, a suspension stays inside its company and leaves torn-up slips alone by two locks each,
// the suspensions and their records commit together or not at all, dsor_runtime may make one
// change to a slip and no other, and two calls at once make one change (step 19b's README, C1
// to C8, and decisions 10, 12, and 13).
// Every test and every run of this step uses one database branch, and nothing in DSoR lifts a
// suspension. A suspension of user_123's slips would stop every later test and run that uses
// them. So each test here signs its slips with a person of its own, whom only that test knows,
// and never reports the story's people as gone (step 19b's README, decision 11).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Directory, FakeDirectory } from "../src/directory.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import { DEL_100, storyDirectories, withPlanted } from "./helpers.ts";
import {
  NO_PRIVILEGE,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  ownerSlips,
  requestId,
  tryThenRollBack,
} from "./db.ts";

// The program's own pool, and the test's window into the database, both dsor_runtime.
const pool = newPool();
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const log = createDbLog(pool);

const READ = { invoice: "dsor://org_456/invoice/INV-1008" };
const SUSPENDED = { status: "suspended", roles: ["ap_supervisor"] };
const ACTIVE = { status: "active", roles: ["ap_supervisor"] };
const NOT_CONFIRMED =
  "DSoR could not confirm that this agent's slip is suspended, so it refuses the call";
// A time as the specification writes it.
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// The code PostgreSQL gives when a row breaks a CHECK: "check_violation".
const CHECK_VIOLATION = { code: "23514" };

/** A person that only one test knows, with a slip for each of her two agents in org_456. */
type Signer = {
  person: string;
  // Each agent's id and request envelope, and the slip it calls under.
  agents: [string, string];
  first: { token: string; tenant: string };
  second: { token: string; tenant: string };
  slips: [string, string];
  // Her slip in org_789, and her slips of other statuses, when the test asked for them.
  in789: string;
  others: Record<string, string>;
  directories: Map<string, FakeDirectory>;
};

/**
 * Runs `run` with a signer of its own: a person in DSoR's table of logins, two agents, and
 * their slips, which the owner writes first and removes after, however `run` ends. Both
 * companies' directories list her as active. With `in789`, she also signed a slip in org_789.
 * With `others`, she also signed one slip of each status named, each for an agent of its own.
 */
async function withOwnSigner<T>(
  run: (signer: Signer) => Promise<T>,
  options: { in789?: boolean; others?: string[] } = {},
): Promise<T> {
  const tag = randomUUID().slice(0, 8);
  const person = `u19b-${tag}`;
  const agents: [string, string] = [`a19b-${tag}-1`, `a19b-${tag}-2`];
  const human: Principal = {
    id: person,
    type: "human",
    memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
  };
  const agent = (id: string): Principal => ({
    id,
    type: "agent",
    clearance: "internal",
    memberships: [{ tenant_id: "org_456", roles: [] }],
  });
  const slip = (n: number, tenant: string, delegate: string, status = "active") => ({
    ...DEL_100,
    id: `del_19b-${tag}-${n}`,
    tenant,
    delegator: person,
    delegate,
    status,
  });
  const slips = [slip(1, "org_456", agents[0]), slip(2, "org_456", agents[1])];
  if (options.in789 === true) slips.push(slip(3, "org_789", agents[0]));
  const others: Record<string, string> = {};
  (options.others ?? []).forEach((status, i) => {
    const n = 4 + i;
    slips.push(slip(n, "org_456", `a19b-${tag}-${n}`, status));
    others[status] = `del_19b-${tag}-${n}`;
  });
  const directories = storyDirectories();
  directories.get("org_456")!.set(person, ACTIVE);
  directories.get("org_789")!.set(person, ACTIVE);
  ownerSlips("add", JSON.stringify(slips));
  try {
    return await withPlanted(`tok_${person}`, human, () =>
      withPlanted(`tok_${agents[0]}`, agent(agents[0]), () =>
        withPlanted(`tok_${agents[1]}`, agent(agents[1]), () =>
          run({
            person,
            agents,
            first: { token: `tok_${agents[0]}`, tenant: "org_456" },
            second: { token: `tok_${agents[1]}`, tenant: "org_456" },
            slips: [`del_19b-${tag}-1`, `del_19b-${tag}-2`],
            in789: `del_19b-${tag}-3`,
            others,
            directories,
          }),
        ),
      ),
    );
  } finally {
    ownerSlips("forget", person);
  }
}

/** Her slips in org_456 and their status, as dsor_runtime reads them inside org_456. */
async function statusesIn456(person: string): Promise<unknown[]> {
  const sql = "SELECT id, status FROM dsor.delegations WHERE delegator = $1 ORDER BY id";
  return (await tryThenRollBack(observer, sql, "org_456", [person])).rows;
}

/** The records of suspensions that this call left, read inside org_456. */
async function changesOf(request_id: string): Promise<unknown[]> {
  const sql = `SELECT kind, operation, "authorization", result, reason, correlation, tenant,
                      delegation, identity, extensions, resources, row_count, connector
                 FROM dsor.audit
                WHERE correlation->>'request_id' = $1 AND kind = 'delegation_change'
                ORDER BY sequence`;
  return (await tryThenRollBack(observer, sql, "org_456", [request_id])).rows;
}

/** The record of one suspension, as step 19b's README, decisions 5 and 14, describe it, read from a row. */
function suspension(delegation: string, word: string, request_id: string, agent: string): unknown {
  return {
    kind: "delegation_change",
    operation: null,
    authorization: null,
    result: "suspended",
    reason: word,
    correlation: { request_id, agent_id: agent },
    tenant: "org_456",
    delegation,
    identity: {
      mode: "direct",
      subject: "dsor",
      actor_chain: [],
      subject_authority: { source: "role_source", as_of: expect.stringMatching(ISO_TIME) },
    },
    extensions: null,
    resources: null,
    row_count: null,
    connector: null,
  };
}

describe("C1 and C5: the suspensions and their records, in the database", () => {
  it("DSOR-IDN-07: her directory says suspended: both her slips are suspended in dsor.delegations, and her second agent is refused before the directory is asked", async () => {
    await withOwnSigner(async (signer) => {
      const org456 = signer.directories.get("org_456")!;
      org456.set(signer.person, SUSPENDED);
      const registry = dbRegistry(pool, signer.directories);
      const first = await call(registry, log, signer.first, "invoice.get", READ);
      expect(first).toMatchObject({ code: "DELEGATION_REQUIRED" });
      expect(await statusesIn456(signer.person)).toStrictEqual([
        { id: signer.slips[0], status: "suspended" },
        { id: signer.slips[1], status: "suspended" },
      ]);
      const asked = org456.asked();
      const second = await call(registry, log, signer.second, "invoice.get", READ);
      expect(second).toMatchObject({
        code: "DELEGATION_REQUIRED",
        message: `"invoice.get": slip ${signer.slips[1]} is suspended, not active`,
      });
      expect(org456.asked()).toBe(asked);
    });
  });

  it("step 19b's decision 5: each suspension leaves one delegation_change record that names DSoR, the directory's word, and the call, before the call's own record", async () => {
    await withOwnSigner(async (signer) => {
      // Not listed: the directory no longer knows her (step 19b's README, decision 8).
      signer.directories.get("org_456")!.set(signer.person, undefined);
      const request_id = requestId("s19b-records");
      const answer = await call(
        dbRegistry(pool, signer.directories),
        log,
        { ...signer.first, request_id },
        "invoice.get",
        READ,
      );
      expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
      expect(await changesOf(request_id)).toStrictEqual([
        suspension(signer.slips[0], "not listed", request_id, signer.agents[0]),
        suspension(signer.slips[1], "not listed", request_id, signer.agents[0]),
      ]);
      // Line ③ writes the suspensions' records, and line ⑪ the call's own, after them.
      const sql = `SELECT kind, result FROM dsor.audit
                    WHERE correlation->>'request_id' = $1 ORDER BY sequence`;
      const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
      expect(rows).toStrictEqual([
        { kind: "delegation_change", result: "suspended" },
        { kind: "delegation_change", result: "suspended" },
        { kind: "decision", result: "AUTHORIZATION_DENIED" },
      ]);
    });
  });

  // DSoR's own reader returns decisions, typed as decisions. A suspension's record has no
  // authorization, so it must never come back as one (step 19b's README, decision 12).
  it("step 19b's decision 12: DSoR's own log reader reads back the call's decision, and never a suspension's record as a decision", async () => {
    await withOwnSigner(async (signer) => {
      signer.directories.get("org_456")!.set(signer.person, SUSPENDED);
      const request_id = requestId("s19b-reader");
      await call(
        dbRegistry(pool, signer.directories),
        log,
        { ...signer.first, request_id },
        "invoice.get",
        READ,
      );
      expect(await changesOf(request_id)).toHaveLength(2);
      const mine = (await log.records("org_456")).filter(
        (record) => record.correlation.request_id === request_id,
      );
      expect(mine).toMatchObject([
        { kind: "decision", authorization: "DENY", result: "DELEGATION_REQUIRED" },
      ]);
      expect(mine).toHaveLength(1);
    });
  });
});

describe("C2 and decision 6: a suspension stays until a person lifts it by hand", () => {
  it("DSOR-IDN-07: she is active again and her agent is still refused; the owner lifts the suspensions by hand, and the agent reads again", async () => {
    await withOwnSigner(async (signer) => {
      const org456 = signer.directories.get("org_456")!;
      org456.set(signer.person, SUSPENDED);
      const registry = dbRegistry(pool, signer.directories);
      await call(registry, log, signer.first, "invoice.get", READ);
      org456.set(signer.person, ACTIVE);
      expect(await call(registry, log, signer.first, "invoice.get", READ)).toMatchObject({
        code: "DELEGATION_REQUIRED",
        message: `"invoice.get": slip ${signer.slips[0]} is suspended, not active`,
      });
      expect(ownerSlips("lift", "org_456", signer.person)).toStrictEqual({
        lifted: [...signer.slips],
      });
      expect(await call(registry, log, signer.first, "invoice.get", READ)).toMatchObject({
        data: { id: "INV-1008" },
      });
    });
  });
});

describe("C3: a suspension stays inside its company, by both locks", () => {
  it("DSOR-IDN-03b: org_456's directory reports her as suspended, and her slip in org_789 stays active", async () => {
    await withOwnSigner(
      async (signer) => {
        signer.directories.get("org_456")!.set(signer.person, SUSPENDED);
        await call(dbRegistry(pool, signer.directories), log, signer.first, "invoice.get", READ);
        expect(ownerSlips("statuses", signer.person)).toStrictEqual([
          { tenant_id: "org_456", id: signer.slips[0], status: "suspended" },
          { tenant_id: "org_456", id: signer.slips[1], status: "suspended" },
          { tenant_id: "org_789", id: signer.in789, status: "active" },
        ]);
      },
      { in789: true },
    );
  });

  // The second lock alone: the suspension's statement with no company in its WHERE, as
  // dsor_runtime inside org_456, rolled back. Break B2 on the database.
  it("DSOR-TEN-01b: row-level security alone keeps her org_789 slip out of a suspension run inside org_456", async () => {
    await withOwnSigner(
      async (signer) => {
        const sql = `UPDATE dsor.delegations SET status = 'suspended'
                      WHERE delegator = $1 AND status = 'active' RETURNING tenant_id, id`;
        const { rows } = await tryThenRollBack(observer, sql, "org_456", [signer.person]);
        expect(rows.map((row) => `${row["tenant_id"]} ${row["id"]}`).sort()).toStrictEqual([
          `org_456 ${signer.slips[0]}`,
          `org_456 ${signer.slips[1]}`,
        ]);
      },
      { in789: true },
    );
  });

  // The first lock alone: DSoR's own statement, run by the owner, whom no policy stops. Only
  // DSoR's own WHERE can keep the suspension in org_456 here.
  it("DSOR-TEN-01b: DSoR's own filter alone: the owner, whom no policy stops, suspends only her org_456 slips", async () => {
    await withOwnSigner(
      async (signer) => {
        const result = ownerSlips("suspend", "org_456", signer.person, requestId("s19b-owner"));
        expect(result).toStrictEqual({ suspended: [...signer.slips] });
        expect(ownerSlips("statuses", signer.person)).toContainEqual({
          tenant_id: "org_789",
          id: signer.in789,
          status: "active",
        });
      },
      { in789: true },
    );
  });
});

describe("C8 and decision 13: a torn-up or expired slip is never suspended, by both locks", () => {
  // Break B3's story on the database: both locks together, through a real call.
  it("DSOR-IDN-07: her directory says suspended, and her torn-up and expired slips keep their status, with no record", async () => {
    await withOwnSigner(
      async (signer) => {
        signer.directories.get("org_456")!.set(signer.person, SUSPENDED);
        const request_id = requestId("s19b-torn");
        await call(
          dbRegistry(pool, signer.directories),
          log,
          { ...signer.first, request_id },
          "invoice.get",
          READ,
        );
        expect(await statusesIn456(signer.person)).toStrictEqual([
          { id: signer.slips[0], status: "suspended" },
          { id: signer.slips[1], status: "suspended" },
          { id: signer.others["revoked"], status: "revoked" },
          { id: signer.others["expired"], status: "expired" },
        ]);
        const changed = (await changesOf(request_id)) as { delegation: string }[];
        expect(changed.map((change) => change.delegation)).toStrictEqual([...signer.slips]);
      },
      { others: ["revoked", "expired"] },
    );
  });

  // The database's lock alone: the suspension's statement with no status in its WHERE, as
  // dsor_runtime, rolled back. The policy lets it touch active slips only.
  it("step 19b's decision 13: the database alone keeps a torn-up slip torn up: a suspension with no status filter, as dsor_runtime, changes only her active slips", async () => {
    await withOwnSigner(
      async (signer) => {
        const sql = `UPDATE dsor.delegations SET status = 'suspended'
                      WHERE tenant_id = 'org_456' AND delegator = $1 RETURNING id`;
        const { rows } = await tryThenRollBack(observer, sql, "org_456", [signer.person]);
        expect(rows.map((row) => row["id"]).sort()).toStrictEqual([...signer.slips]);
      },
      { others: ["revoked", "expired", "suspended"] },
    );
  });

  // DSoR's own lock alone: its statement, run by the owner, whom no policy stops.
  it("DSOR-IDN-07: DSoR's own status filter alone: the owner, whom no policy stops, suspends only her active slips", async () => {
    await withOwnSigner(
      async (signer) => {
        const result = ownerSlips("suspend", "org_456", signer.person, requestId("s19b-filter"));
        expect(result).toStrictEqual({ suspended: [...signer.slips] });
        expect(await statusesIn456(signer.person)).toContainEqual({
          id: signer.others["revoked"],
          status: "revoked",
        });
        expect(await statusesIn456(signer.person)).toContainEqual({
          id: signer.others["expired"],
          status: "expired",
        });
      },
      { others: ["revoked", "expired"] },
    );
  });

  it.each([
    ["bring a torn-up slip back to active", "revoked", "active"],
    ["lift a suspension", "suspended", "active"],
  ])(
    "step 19b's decision 13: dsor_runtime cannot %s: the change touches no row",
    async (_, from, to) => {
      await withOwnSigner(
        async (signer) => {
          const sql = `UPDATE dsor.delegations SET status = $2
                      WHERE tenant_id = 'org_456' AND id = $1 RETURNING id`;
          const { rowCount } = await tryThenRollBack(observer, sql, "org_456", [
            signer.others[from],
            to,
          ]);
          expect(rowCount).toBe(0);
        },
        { others: [from] },
      );
    },
  );

  it.each(["revoked", "active", "expired"])(
    "step 19b's decision 13: dsor_runtime cannot change an active slip to %s: the database refuses",
    async (to) => {
      await withOwnSigner(async (signer) => {
        const sql = `UPDATE dsor.delegations SET status = $2 WHERE tenant_id = 'org_456' AND id = $1`;
        await expect(
          tryThenRollBack(observer, sql, "org_456", [signer.slips[0], to]),
        ).rejects.toMatchObject(NO_PRIVILEGE);
      });
    },
  );
});

describe("C4: the suspensions and their records commit together, or not at all", () => {
  // The second record fails, by fault injection around the real client (§47), as in
  // test/audit.db.test.ts. The database and its transaction are real. Break B4's story.
  it("step 19b's decision 4: the second record fails: no slip changes, no record stays, and the agent hears INTERNAL_ERROR", async () => {
    const failing = new pg.Pool({ connectionString: RUNTIME_URL, max: 2 });
    // How many records of suspensions reached the database, so the test knows the fault fired
    // on the second.
    let records = 0;
    failing.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      client.query = ((...args: unknown[]) => {
        const [text, values] = args;
        const change = `${String(text)} ${JSON.stringify(values ?? null)}`;
        if (
          change.includes("INSERT INTO dsor.audit") &&
          change.includes("delegation_change") &&
          ++records === 2
        ) {
          return Promise.reject(new Error("fault injected: the second record failed"));
        }
        return query(...args);
      }) as typeof client.query;
    });
    try {
      await withOwnSigner(async (signer) => {
        signer.directories.get("org_456")!.set(signer.person, SUSPENDED);
        const request_id = requestId("s19b-rollback");
        const answer = await call(
          dbRegistry(failing, signer.directories),
          log,
          { ...signer.first, request_id },
          "invoice.get",
          READ,
        );
        expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: NOT_CONFIRMED });
        expect(records).toBe(2);
        expect(await statusesIn456(signer.person)).toStrictEqual([
          { id: signer.slips[0], status: "active" },
          { id: signer.slips[1], status: "active" },
        ]);
        expect(await changesOf(request_id)).toStrictEqual([]);
        // The call's own record shows the fault, so a person sees it (decision 7).
        const sql = `SELECT kind, result FROM dsor.audit WHERE correlation->>'request_id' = $1`;
        const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
        expect(rows).toStrictEqual([{ kind: "decision", result: "INTERNAL_ERROR" }]);
      });
    } finally {
      await failing.end();
    }
  });

  // The database can take an INSERT and keep no row, as test/audit.db.test.ts shows for the
  // log. Here the first record's own values go in an INSERT that matches no row: a real
  // statement, on the real database. Found by step 19b's sweep: the store's check of the row
  // count could go with every test green.
  it("step 19b's decision 4: a record the database keeps no row of gives INTERNAL_ERROR, and no slip changes", async () => {
    const swallowing = new pg.Pool({ connectionString: RUNTIME_URL, max: 2 });
    const keepsNothing = `INSERT INTO dsor.audit
        (record_id, kind, result, reason, correlation, tenant, identity, delegation)
      SELECT $1::text, $2::text, $3::text, $4::text, $5::jsonb, $6::text, $7::jsonb, $8::text
       WHERE false`;
    // How many rows each swapped INSERT kept, so the test knows the fault fired once, and that
    // the statement ran. An INSERT that failed would pass for the wrong reason.
    const kept: (number | null)[] = [];
    swallowing.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      client.query = ((...args: unknown[]) => {
        const [text, ...rest] = args;
        if (
          typeof text === "string" &&
          text.trimStart().startsWith("INSERT INTO dsor.audit") &&
          JSON.stringify(rest).includes("delegation_change")
        ) {
          return query(keepsNothing, ...rest).then((result) => {
            kept.push((result as pg.QueryResult).rowCount);
            return result;
          });
        }
        return query(...args);
      }) as typeof client.query;
    });
    try {
      await withOwnSigner(async (signer) => {
        signer.directories.get("org_456")!.set(signer.person, SUSPENDED);
        const request_id = requestId("s19b-kept-nothing");
        const answer = await call(
          dbRegistry(swallowing, signer.directories),
          log,
          { ...signer.first, request_id },
          "invoice.get",
          READ,
        );
        expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: NOT_CONFIRMED });
        expect(kept).toStrictEqual([0]);
        expect(await statusesIn456(signer.person)).toStrictEqual([
          { id: signer.slips[0], status: "active" },
          { id: signer.slips[1], status: "active" },
        ]);
        expect(await changesOf(request_id)).toStrictEqual([]);
      });
    } finally {
      await swallowing.end();
    }
  });
});

describe("C6: dsor_runtime may change a slip's status, and nothing else", () => {
  it("step 19b's decision 3: dsor_runtime may suspend a slip inside its company", async () => {
    await withOwnSigner(async (signer) => {
      const sql = `UPDATE dsor.delegations SET status = 'suspended'
                    WHERE tenant_id = 'org_456' AND id = $1 RETURNING id, status`;
      const { rows } = await tryThenRollBack(observer, sql, "org_456", [signer.slips[0]]);
      expect(rows).toStrictEqual([{ id: signer.slips[0], status: "suspended" }]);
    });
  });

  it.each([
    ["signer", "delegator = 'cfo_100'"],
    ["agent", "delegate = 'intake-fte'"],
    ["date", "expires_at = '2199-12-31T23:59:59Z'"],
    ["status and permissions together", "status = 'active', permissions = '{payment:cancel}'"],
  ])("step 19b's decision 3: dsor_runtime may not change a slip's %s", async (_, change) => {
    const sql = `UPDATE dsor.delegations SET ${change} WHERE id = 'del_100'`;
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });
});

// Migration 012's own checks on the log. Found by step 19b's sweep: either could go with every
// test green.
describe("decision 10: only a decision must say ALLOW or DENY", () => {
  it.each([
    [
      "a decision with no authorization",
      `INSERT INTO dsor.audit (record_id, kind, result, correlation, tenant)
       VALUES ($1, 'decision', 'ok', '{}', 'org_456')`,
    ],
    [
      "a record of a kind it does not know",
      `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
       VALUES ($1, 'note', 'ALLOW', 'ok', '{}', 'org_456')`,
    ],
  ])("step 19b's decision 10: the log refuses %s", async (_, sql) => {
    const record_id = `aud_${randomUUID()}`;
    await expect(tryThenRollBack(observer, sql, "org_456", [record_id])).rejects.toMatchObject(
      CHECK_VIOLATION,
    );
  });
});

describe("C7: two calls at once make one change and one record", () => {
  it("step 19b's decision 4: her two agents call at the same moment, and each slip is suspended once, with one record", async () => {
    // A pool of its own, so both calls hold a connection at once.
    const both = new pg.Pool({ connectionString: RUNTIME_URL, max: 4 });
    try {
      await withOwnSigner(async (signer) => {
        // The directory answers neither question until both have arrived, so both calls passed
        // the slip check before either suspension, and both try one. At most 1.5 seconds, under
        // the 2 seconds DSoR waits.
        let questions = 0;
        let release: () => void = () => {};
        const arrived = new Promise<void>((resolve) => {
          release = resolve;
        });
        const barrier: Directory = {
          ask: async (person: string) => {
            if (++questions === 2) release();
            setTimeout(release, 1500);
            await arrived;
            return { tenant: "org_456", person, listed: true, ...SUSPENDED };
          },
        };
        const directories = new Map<string, Directory>([
          ["org_456", barrier],
          ["org_789", signer.directories.get("org_789")!],
        ]);
        const registry = dbRegistry(both, directories);
        const answers = await Promise.all([
          call(registry, log, signer.first, "invoice.get", READ),
          call(registry, log, signer.second, "invoice.get", READ),
        ]);
        // Both heard the directory's word, not the slip's status: both tried a suspension.
        const whom = `whom the directory of org_456 does not list as active`;
        expect(answers).toMatchObject([
          {
            message: `"invoice.get": slip ${signer.slips[0]} is signed by ${signer.person}, ${whom}`,
          },
          {
            message: `"invoice.get": slip ${signer.slips[1]} is signed by ${signer.person}, ${whom}`,
          },
        ]);
        expect(questions).toBe(2);
        const sql = `SELECT delegation, count(*)::int AS records FROM dsor.audit
                      WHERE kind = 'delegation_change' AND delegation = ANY($1)
                      GROUP BY delegation ORDER BY delegation`;
        const { rows } = await tryThenRollBack(observer, sql, "org_456", [signer.slips]);
        expect(rows).toStrictEqual([
          { delegation: signer.slips[0], records: 1 },
          { delegation: signer.slips[1], records: 1 },
        ]);
        expect(await statusesIn456(signer.person)).toStrictEqual([
          { id: signer.slips[0], status: "suspended" },
          { id: signer.slips[1], status: "suspended" },
        ]);
      });
    } finally {
      await both.end();
    }
  });
});
