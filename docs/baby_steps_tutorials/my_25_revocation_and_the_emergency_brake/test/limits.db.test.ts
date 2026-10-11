// STEP 24: fifty payments at once against a daily limit, on a real server (decision 140).
//
// PGlite has one connection, so fifty requests sent together reach it one after another. A pool of
// twenty connections against a real PostgreSQL lets them truly race for the day's total, and the
// reservation is one statement that adds an amount only if the total stays within the limit. The
// step's "done when": fifty parallel payments never exceed the daily limit.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like pool.db.test.ts.
//
// Rule DSOR-DEL-06a: cumulative limits MUST be enforced with atomic reserve, commit, and release
// operations in the control-plane store.

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { money } from "../src/money.ts";
import { callOperation } from "../src/operations.ts";
import { propose } from "../src/proposal.ts";
import { reserve, usedToday } from "../src/reservation.ts";
import { useDatabase } from "../src/store.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const DAILY = money("200000.00", "USD");

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

// The database is kept between runs, and so is today's total: each test starts the day again, as
// the owner, saying the company as the lock asks. And the file leaves the day as it found it empty,
// because the other files of this tier pay too, in an order that changes: with 195,000.00 left
// booked, step 20's payment of 2,500.00 was refused on two runs of three, measured.
async function startTheDayAgain(): Promise<void> {
  const client = await owner.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
    await client.query("DELETE FROM dsor.reservations WHERE tenant = 'org_456'");
    await client.query("DELETE FROM dsor.day_totals WHERE tenant = 'org_456'");
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  if (haveAServer) {
    await startTheDayAgain();
  }
});

afterAll(async () => {
  if (haveAServer) {
    await startTheDayAgain();
  }

  await application?.end();
  await owner?.end();
});

describe.skipIf(!haveAServer)("fifty at once against 200,000.00 a day, on a real pool", () => {
  it("DSOR-DEL-06a: fifty reservations of 5,000.00 at once: exactly forty, and the day stops at the limit", async () => {
    const ids = await Promise.all(
      Array.from({ length: 50 }, () =>
        propose({
          tenant: "org_456",
          operation: "payment.create@1",
          mode: "execute",
          payload: "{}",
          payloadHash: "sha256:0",
          requester: '{"mode":"direct","subject":"user_123","actor_chain":[]}',
          idempotencyKey: `race-${randomUUID()}`,
          actor: "user_123",
          cause: "payment.create@1 invoked",
        }),
      ),
    );
    const outcomes = await Promise.all(
      ids.map((id) => reserve("org_456", id, "del_100", money("5000.00", "USD"), DAILY)),
    );

    expect(outcomes.filter((o) => o.kind === "reserved")).toHaveLength(40);
    expect(await usedToday("org_456", "del_100")).toBe("200000.00");
  });

  it("DSOR-DEL-06a: with room for one more payment, fifty at once through the door make at most one", async () => {
    // Decision 141: without this, the test could not fail. Fifty payments of 5,000.00 cross
    // 200,000.00 only after forty are made, and the company's log lets two or three through, so a
    // limit a thousand times higher passed it too, a review measured. With 195,000.00 booked first,
    // the fifty race for room for exactly one: every one of them books at §21.10, before the log,
    // so the booking is where they race, and any two made would pass the limit.
    const first = await propose({
      tenant: "org_456",
      operation: "payment.create@1",
      mode: "execute",
      payload: "{}",
      payloadHash: "sha256:0",
      requester: '{"mode":"direct","subject":"user_123","actor_chain":[]}',
      idempotencyKey: `booked-first-${randomUUID()}`,
      actor: "user_123",
      cause: "payment.create@1 invoked",
    });

    expect(
      await reserve("org_456", first, "del_100", money("195000.00", "USD"), DAILY),
    ).toStrictEqual({ kind: "reserved" });

    const answers = await Promise.all(
      Array.from({ length: 50 }, () =>
        callOperation(
          AGENT,
          "payment.create",
          {
            invoice: "dsor://org_456/invoice/INV-1009",
            amount: { value: "5000.00", currency: "USD" },
          },
          { idempotencyKey: `fifty-${randomUUID()}` },
        ),
      ),
    );
    const made = answers.filter((a) => a.kind === "result").length;

    expect(made).toBeLessThanOrEqual(1);
    expect(await usedToday("org_456", "del_100")).toBe(`${195000 + made * 5000}.00`);
  });
});
