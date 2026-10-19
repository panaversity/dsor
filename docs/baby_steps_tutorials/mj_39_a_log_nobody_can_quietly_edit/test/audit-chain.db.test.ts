// Step 39 on the database: every record of dsor.audit gets its chain, its place, its predecessor's
// fingerprint, and its own, from the database's trigger, never from DSoR's login; twenty calls at
// once leave the chain whole; the owner's edits are each named by the checker; and pnpm
// verify-audit exits 0 on a whole log and 1 on a broken one (DSOR-AUD-04b, DSOR-AUD-04c; step 39's
// README, claims C1 to C5).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, inCompany } from "../src/postgres.ts";
import { dbRegistry, newPool, ownerAudit, requestId } from "./db.ts";
import { SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const VERIFY = fileURLToPath(new URL("../src/verify-audit.ts", import.meta.url));

afterAll(async () => {
  await pool.end();
});

/** The report the owner's checker gives, for one chain. */
type Report = {
  chain: string;
  records: number;
  broken?: { position: number; record_id: string; why: string };
};

/** user_123 reads INV-1008, with a request id of its own: the record's id. */
async function aRead(): Promise<string> {
  const request_id = requestId("chain");
  const answer: Answer = await call(registry, log, { ...SUPERVISOR, request_id }, "invoice.get", {
    invoice: "dsor://org_456/invoice/INV-1008",
  });
  expect(answer).toHaveProperty("data");
  return inCompany(pool, "org_456", async (client) => {
    const { rows } = await client.query(
      "SELECT record_id FROM dsor.audit WHERE correlation->>'request_id' = $1",
      [request_id],
    );
    return String(rows[0]!["record_id"]);
  });
}

/** One record's chain columns, as dsor_runtime reads them inside org_456. */
function chainOf(record: string): Promise<Record<string, unknown>> {
  return inCompany(pool, "org_456", async (client) => {
    const { rows } = await client.query(
      `SELECT chain, chain_position::text AS position, previous_hash, record_hash FROM dsor.audit
        WHERE record_id = $1`,
      [record],
    );
    return rows[0]!;
  });
}

/** The checker's report on one chain, from the owner's run. */
function reportOn(reports: unknown, chain: string): Report {
  return (reports as Report[]).find((report) => report.chain === chain)!;
}

describe("C1: the database writes the chain", () => {
  it("DSOR-AUD-04b: user_123's read is recorded in org_456's chain, one place after the record before it, following its fingerprint", async () => {
    const first = await chainOf(await aRead());
    const second = await chainOf(await aRead());
    expect(first["chain"]).toBe("org_456");
    expect(Number(second["position"])).toBe(Number(first["position"]) + 1);
    expect(second["previous_hash"]).toBe(first["record_hash"]);
    expect(String(second["record_hash"])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("DSOR-AUD-04b: dsor_runtime cannot write a record's chain, place, or fingerprints", async () => {
    for (const column of ["chain", "chain_position", "previous_hash", "record_hash"]) {
      await expect(
        inCompany(pool, "org_456", (client) =>
          client.query(
            `INSERT INTO dsor.audit (record_id, kind, result, correlation, ${column})
             VALUES ($1, 'decision', 'COMMITTED', '{}', $2)`,
            [`aud_${column}`, column === "chain_position" ? 1 : "x"],
          ),
        ),
      ).rejects.toThrow("permission denied");
    }
  });
});

describe("C2: at the same moment", () => {
  it(
    "DSOR-AUD-04c: twenty reads at once leave org_456's chain whole: no place twice, none missing",
    { timeout: 60_000 },
    async () => {
      const before = reportOn(ownerAudit("verify"), "org_456");
      await Promise.all(Array.from({ length: 20 }, () => aRead()));
      const after = reportOn(ownerAudit("verify"), "org_456");
      expect(after.broken).toBeUndefined();
      expect(after.records).toBe(before.records + 20);
    },
  );
});

describe("C4: each edit is named", () => {
  it("DSOR-AUD-04b: the owner turns one record's authorization over: the checker names that record", async () => {
    const record = await aRead();
    const report = reportOn(ownerAudit("edit", record), "org_456");
    expect(report.broken).toMatchObject({
      record_id: record,
      why: "its contents do not match its fingerprint",
    });
  });

  it("DSOR-AUD-04b: the owner edits a record and writes its fingerprint again: the checker names the record after it", async () => {
    const record = await aRead();
    const next = await aRead();
    const report = reportOn(ownerAudit("rehash", record), "org_456");
    expect(report.broken).toMatchObject({
      record_id: next,
      why: "it does not follow the record before it",
    });
  });

  it("DSOR-AUD-04b: the owner removes a record from the middle: the checker names the place that is missing", async () => {
    const record = await aRead();
    await aRead();
    const { position } = await chainOf(record);
    const report = reportOn(ownerAudit("remove", record), "org_456");
    expect(report.broken).toMatchObject({
      position: Number(position),
      why: `the record at place ${String(position)} is missing`,
    });
  });
});

// Found by break B7: the lock alone kept every record to one predecessor, so the keys behind it
//   had no test. Here the owner tries what the lock never lets the trigger do.
describe("C2: the database's keys", () => {
  it("DSOR-AUD-04c: the owner gives a record the predecessor, or the place, of the record before it: the database refuses both", async () => {
    await aRead();
    const record = await aRead();
    expect(ownerAudit("fork", record)).toMatchObject({
      refused: expect.stringContaining("audit_one_successor"),
    });
    expect(ownerAudit("twin", record)).toMatchObject({
      refused: expect.stringContaining("audit_one_place"),
    });
  });
});

// Found by step 39's review: each test below is one a break passed.
describe("the review", () => {
  it("DSOR-AUD-04b: M2: the owner edits a record, writes its fingerprint again, and points the next record at it: the next record's own fingerprint no longer matches", async () => {
    const record = await aRead();
    const next = await aRead();
    await aRead();
    expect(reportOn(ownerAudit("relink", record), "org_456").broken).toMatchObject({
      record_id: next,
      why: "its contents do not match its fingerprint",
    });
  });

  it(
    "DSOR-AUD-04b: M3: each column the recipe covers, changed in turn by the owner, is named",
    { timeout: 60_000 },
    async () => {
      const record = await aRead();
      await aRead();
      const found = ownerAudit("each", record) as Record<string, unknown>;
      for (const [column, reports] of Object.entries(found)) {
        // A change the table's own checks refuse is a test that changed nothing.
        expect({ column, reports }).toMatchObject({ column, reports: expect.any(Array) });
        expect({ column, broken: reportOn(reports, "org_456").broken }).toMatchObject({
          column,
          broken: { why: expect.stringMatching(/do not match|does not follow|is missing/) },
        });
      }
      expect(Object.keys(found)).toHaveLength(17);
    },
  );

  it("DSOR-AUD-04c: M4: a record kept with the trigger off belongs to no chain, and is named", async () => {
    const reports = ownerAudit("nochain") as Report[];
    expect(reportOn(reports, "(no chain)").broken).toMatchObject({
      record_id: "aud_nochain",
      why: "1 record(s) belong to no chain",
    });
  });

  it("DSOR-AUD-04c: M4: a call refused before its company is known goes in the no_company chain, at its next place", async () => {
    const before = reportOn(ownerAudit("verify"), "no_company")?.records ?? 0;
    const answer = await call(
      registry,
      log,
      { token: "tok_nobody", tenant: "org_456" },
      "invoice.get",
      {
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    const after = reportOn(ownerAudit("verify"), "no_company");
    expect(after.records).toBe(before + 1);
    expect(after.broken).toBeUndefined();
  });

  it("DSOR-AUD-04c: M7: the migration's chaining, run again over the whole log, gives each chain its places in the order the records were written, and every chain is whole", async () => {
    await aRead();
    const { out_of_order, chains } = ownerAudit("rechain") as {
      out_of_order: number;
      chains: Report[];
    };
    expect(out_of_order).toBe(0);
    for (const report of chains) expect(report.broken).toBeUndefined();
  });

  it("DSOR-AUD-04c: L8: the owner moves a record to org_789: the chain's check refuses it", async () => {
    const record = await aRead();
    expect(ownerAudit("rehome", record)).toMatchObject({
      refused: expect.stringContaining("audit_chain_is_company"),
    });
  });

  it("DSOR-AUD-04b: H1: with a trigger's owner that cannot write the log, a record's commit is refused, never kept with no chain", async () => {
    expect(ownerAudit("unchainable")).toMatchObject({
      refused: expect.stringContaining("could not be chained"),
    });
  });

  it("DSOR-AUD-04b: L2: two records of org_456, the first committed last: each takes the place after the head at its commit, and the chain is whole", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    const write = async (client: pg.PoolClient, id: string) => {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query(
        `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
         VALUES ($1, 'decision', 'ALLOW', 'COMMITTED', '{}', 'org_456')`,
        [id],
      );
    };
    const first = `aud_first_${requestId("l2")}`;
    const second = `aud_second_${requestId("l2")}`;
    try {
      await write(a, first);
      await write(b, second);
      await b.query("COMMIT");
      await a.query("COMMIT");
    } finally {
      a.release();
      b.release();
    }
    const [one, two] = [await chainOf(first), await chainOf(second)];
    expect(Number(one["position"])).toBe(Number(two["position"]) + 1);
    expect(one["previous_hash"]).toBe(two["record_hash"]);
    expect(reportOn(ownerAudit("verify"), "org_456").broken).toBeUndefined();
  });
});

describe("C5: pnpm verify-audit", () => {
  const run = (env: NodeJS.ProcessEnv = process.env) =>
    spawnSync(process.execPath, [VERIFY], { encoding: "utf8", timeout: 30_000, env });

  // Changed by step 39's review, L4: org_456's line, not the whole log's exit, so another chain
  //   broken by hand elsewhere does not hold this test red.
  it(
    "DSOR-AUD-04b: org_456 whole; one record turned over: that record named, exit 1; turned back: org_456 whole again, and the exit as before",
    { timeout: 60_000 },
    async () => {
      const before = run();
      expect(before.stdout).toContain("org_456: whole");
      const record = await aRead();
      await aRead();
      ownerAudit("flip", record);
      try {
        const broken = run();
        expect(broken.stdout).toContain(record);
        expect(broken.status).toBe(1);
      } finally {
        ownerAudit("flip", record);
      }
      const after = run();
      expect(after.stdout).toContain("org_456: whole");
      expect(after.status).toBe(before.status);
    },
  );

  // Found by step 39's review, H1: a login that cannot see every record saw an empty log, and the
  //   script said whole.
  it(
    "DSOR-AUD-04b: run as dsor_runtime, which cannot see every record, it does not check: exit 2",
    { timeout: 60_000 },
    () => {
      const runtime = run({ ...process.env, DSOR_MIGRATION_URL: process.env["DSOR_DB_URL"] });
      expect(runtime.stdout).toContain("not checked: this login cannot see every record");
      expect(runtime.status).toBe(2);
    },
  );
});
