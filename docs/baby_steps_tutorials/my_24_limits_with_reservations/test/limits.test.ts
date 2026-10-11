// NEW IN STEP 24: a daily limit, kept by reservations (decision 140).
//
// Rule DSOR-DEL-06a: cumulative limits MUST be enforced with atomic reserve, commit, and release
// operations in the control-plane store.
// Rule DSOR-DEL-06b: a reservation MUST be keyed by proposal id, so that re-evaluating the same
// proposal never reserves twice.
// Rule DSOR-DEL-06c: a reservation MUST stay held while its proposal is PENDING_APPROVAL, APPROVED,
// EXECUTING, or OUTCOME_UNKNOWN.
// Rule DSOR-DEL-06d: a reservation MUST be released when its proposal reaches FAILED, REJECTED,
// EXPIRED, CANCELLED, REVOKED, or INVALIDATED.
// Rule DSOR-DEL-06e: a command that would exceed a limit MUST be refused with LIMIT_EXCEEDED.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activeSlipFor } from "../src/delegation.ts";
import { money } from "../src/money.ts";
import { propose } from "../src/proposal.ts";
import { reserve, settleReservation, usedToday } from "../src/reservation.ts";
import { theDatabase } from "../src/store.ts";
import { aDatabase, resetTheStory } from "./support/database.ts";

const DAILY = money("200000.00", "USD");

/** A proposal of org_456's agent, for a payment, to reserve against. */
const aProposal = (): Promise<string> =>
  propose({
    tenant: "org_456",
    operation: "payment.create@1",
    mode: "execute",
    payload: "{}",
    payloadHash: "sha256:0",
    requester: '{"mode":"unattended","subject":"user_123","actor_chain":["accounts-payable-fte"]}',
    idempotencyKey: `limits-${Math.random()}`,
    actor: "accounts-payable-fte",
    cause: "payment.create@1 invoked",
  });

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
});

describe("the slip's daily limit", () => {
  it("DSOR-DEL-06a: del_100 may spend 200,000.00 USD a day, beside 50,000.00 a payment", async () => {
    const found = await activeSlipFor("org_456", "accounts-payable-fte");
    const slip = found.kind === "one" ? found.slip : undefined;

    expect(slip?.dailyLimit).toStrictEqual(DAILY);
    expect(slip?.perTransactionLimit).toStrictEqual(money("50000.00", "USD"));
  });
});

describe("reserving against the day", () => {
  it("DSOR-DEL-06a: an amount within the day's limit is reserved, and the day's total rises by it", async () => {
    const id = await aProposal();

    expect(await reserve("org_456", id, "del_100", money("31400.00", "USD"), DAILY)).toStrictEqual({
      kind: "reserved",
    });
    expect(await usedToday("org_456", "del_100")).toBe("31400.00");
  });

  it("DSOR-DEL-06e: an amount that would take the day past its limit is not reserved, and the total does not move", async () => {
    const first = await aProposal();
    const second = await aProposal();

    await reserve("org_456", first, "del_100", money("180000.00", "USD"), DAILY);

    expect(
      await reserve("org_456", second, "del_100", money("20000.01", "USD"), DAILY),
    ).toStrictEqual({ kind: "over" });
    expect(await usedToday("org_456", "del_100")).toBe("180000.00");
  });

  it("DSOR-DEL-06e: exactly the limit is within it", async () => {
    const id = await aProposal();

    expect(await reserve("org_456", id, "del_100", money("200000.00", "USD"), DAILY)).toStrictEqual(
      { kind: "reserved" },
    );
  });

  it("DSOR-DEL-06b: the same proposal reserving again does not reserve twice", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("10000.00", "USD"), DAILY);

    expect(await reserve("org_456", id, "del_100", money("10000.00", "USD"), DAILY)).toStrictEqual({
      kind: "already",
    });
    expect(await usedToday("org_456", "del_100")).toBe("10000.00");
  });

  it("DSOR-DEL-06a: fifty reservations sent together never take the day past its limit", async () => {
    const ids = await Promise.all(Array.from({ length: 50 }, () => aProposal()));
    const outcomes = await Promise.all(
      ids.map((id) => reserve("org_456", id, "del_100", money("5000.00", "USD"), DAILY)),
    );

    expect(outcomes.filter((o) => o.kind === "reserved")).toHaveLength(40);
    expect(outcomes.filter((o) => o.kind === "over")).toHaveLength(10);
    expect(await usedToday("org_456", "del_100")).toBe("200000.00");
  });
});

describe("settling a reservation", () => {
  it("DSOR-DEL-06d: a released reservation gives its amount back to the day", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await settleReservation("org_456", id, "released");

    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-06a: a committed reservation keeps its amount on the day", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await settleReservation("org_456", id, "committed");

    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
  });

  it("DSOR-DEL-06a: a committed reservation is never released, even by the application writing the SQL itself", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await settleReservation("org_456", id, "committed");
    await settleReservation("org_456", id, "released");

    const { rows } = await theDatabase("org_456").query(
      "UPDATE dsor.reservations SET state = 'released' WHERE tenant = 'org_456' AND proposal = $1 RETURNING proposal",
      [id],
    );

    expect(rows).toStrictEqual([]);
    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
  });
});

describe("the application books and settles, and nothing else", () => {
  it("DSOR-DEL-06a: it may not delete a total or a reservation, nor write a reservation already settled", async () => {
    const { rows } = await db.query<{ right: string }>(
      `SELECT t || ' ' || r AS right
         FROM unnest(ARRAY['dsor.day_totals', 'dsor.reservations']) AS t,
              unnest(ARRAY['DELETE', 'TRUNCATE']) AS r
        WHERE has_table_privilege(current_user, t, r)
       UNION ALL
       SELECT 'dsor.reservations INSERT state'
        WHERE has_column_privilege(current_user, 'dsor.reservations', 'state', 'INSERT')
       UNION ALL
       SELECT 'dsor.reservations UPDATE amount_value'
        WHERE has_column_privilege(current_user, 'dsor.reservations', 'amount_value', 'UPDATE')`,
    );

    expect(rows).toStrictEqual([]);
  });
});
