// Step 39 on the database: every record of dsor.audit gets its chain, its place, its predecessor's
// fingerprint, and its own, from the database's trigger, never from DSoR's login; twenty calls at
// once leave the chain whole; the owner's edits are each named by the checker; and pnpm
// verify-audit exits 0 on a whole log and 1 on a broken one (DSOR-AUD-04b, DSOR-AUD-04c; step 39's
// README, claims C1 to C5).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

describe("C5: pnpm verify-audit", () => {
  it(
    "DSOR-AUD-04b: a whole log: every chain whole, exit 0; one record turned over: that record named, exit 1; turned back: exit 0",
    { timeout: 60_000 },
    async () => {
      const run = () =>
        spawnSync(process.execPath, [VERIFY], { encoding: "utf8", timeout: 30_000 });
      const whole = run();
      expect(whole.stdout).toContain("org_456: whole");
      expect(whole.status).toBe(0);
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
      expect(run().status).toBe(0);
    },
  );
});
