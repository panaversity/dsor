// NEW IN STEP 21: two changes on one version, racing on a real server (decision 134).
//
// PGlite has one connection, so two changes sent together reach it one after the other. A pool
// against a real PostgreSQL lets them truly race, and the version is checked in the same UPDATE that
// makes the change: of twenty, exactly one finds the version it decided on.
//
// What this does not prove: a cancel also asks for a draft, so with the version taken out of the
// UPDATE, the status alone still lets one through, and this test still passes (measured 2026-10-11,
// decision 135). That the version itself refuses is proven in versions.test.ts, by a draft decided
// on as the wrong version. This test proves the race: one change, not two.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like pool.db.test.ts.
//
// Rule DSOR-CON-01b: an optimistic command MUST return STALE_STATE when the resource version differs
// from the version the decision was made on.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { cancelPayment, createPayment } from "../src/payment.ts";
import { useDatabase } from "../src/store.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

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

afterAll(async () => {
  await application?.end();
  await owner?.end();
});

describe.skipIf(!haveAServer)("twenty changes on one version, on a real pool", () => {
  it("DSOR-CON-01b: exactly one is made, and nineteen find the record stale", async () => {
    // A payment of its own each run, because the database is kept between runs.
    const made = await createPayment("org_456", "INV-1009", { value: "1.00", currency: "USD" });

    if (made.kind !== "created") {
      throw new Error(`expected a payment, got ${made.kind}`);
    }

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => cancelPayment("org_456", made.payment.id, 1)),
    );

    expect(outcomes.filter((o) => o.kind === "cancelled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "stale")).toHaveLength(19);
  });
});
