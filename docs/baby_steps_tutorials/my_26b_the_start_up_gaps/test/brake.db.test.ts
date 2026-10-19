// Decision 156: twenty people pulling the same brake at once, on a real server.
//
// pullTheBrake says that of two people pulling the same brake at once, one record is written and the
// other is told it is on already. PGlite has one connection, so pulls sent together reach it one
// after another. A pool of twenty connections against a real PostgreSQL lets them truly race, and the
// partial unique index of migration 024 decides.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like limits.db.test.ts.
//
// Rule DSOR-OPS-01a: DSoR MUST provide per-agent suspension and a tenant-wide agent freeze.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { liftTheBrake, pullTheBrake } from "../src/controls.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { theDatabase, useDatabase } from "../src/store.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

const AGENT = "accounts-payable-fte";

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  application = new Pool({ connectionString: APPLICATION, max: 20 });
  useDatabase(overPool(application));
});

// The database is kept between runs, and the other files of this tier make payments as the agent. So
// each test starts with no brake on the agent, and the file leaves none on. A brake is lifted, never
// deleted, as the application would: the record of it stays.
beforeEach(async () => {
  if (haveAServer) {
    await liftTheBrake("org_456", AGENT, "user_123");
  }
});

afterAll(async () => {
  if (haveAServer) {
    await liftTheBrake("org_456", AGENT, "user_123");
  }

  await application?.end();
  await owner?.end();
});

describe.skipIf(!haveAServer)("twenty pulls of one brake at once, on a real pool", () => {
  it("DSOR-OPS-01a: twenty people pulling the same brake at once write one record, and nineteen are told it is on", async () => {
    const pulls = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        pullTheBrake("org_456", AGENT, i % 2 === 0 ? "user_123" : "cfo_100", `pull ${i}`),
      ),
    );

    expect(pulls.filter((p) => p.kind === "pulled")).toHaveLength(1);
    expect(pulls.filter((p) => p.kind === "already")).toHaveLength(19);

    const { rows } = await theDatabase("org_456").query(
      "SELECT id FROM dsor.agent_controls WHERE tenant = 'org_456' AND agent = $1 AND lifted_at IS NULL",
      [AGENT],
    );

    expect(rows).toHaveLength(1);
  });
});
