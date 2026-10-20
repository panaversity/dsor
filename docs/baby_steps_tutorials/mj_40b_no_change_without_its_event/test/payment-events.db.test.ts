// NEW IN STEP 40b: the database ties each payment change to its event. A transaction that drafts a
// payment, or marks one paid, commits only with that payment's event, written in the same
// transaction; an event needs its change; and the check binds every login and every path, DSoR's own
// work included (DSOR-EVT-01a, DSOR-EXE-04a; step 40b's README, claims C1 to C5). The tests' own
// invoice, INV-9001, 500.00 USD of VENDOR-44.
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { buildEvent, type DomainEvent, type EventDraft, type EventType } from "../src/events.ts";
import { checkClassifications } from "../src/labels.ts";
import { outboxIn } from "../src/outbox.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, inCompany } from "../src/postgres.ts";
import { ownWorkFor, type OwnWork } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  ownerAttempts,
  ownerInvoices,
  ownerPaymentEvents,
  requestId,
  tryThenRollBack,
} from "./db.ts";
import { keyed, shippedLabels, SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const kinds = checkClassifications(shippedLabels).kinds;
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const SCHEDULER = { token: "tok_5c4e", tenant: "org_456" };

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerAttempts();
  ownerInvoices("remove");
  await pool.end();
});

/** An event of org_456 about one payment of INV-9001, as DSoR builds it. */
function about(type: EventType, id: string, status: "draft" | "paid"): EventDraft {
  const data = {
    tenant_id: "org_456",
    id,
    invoice_id: "INV-9001",
    vendor_id: "VENDOR-44",
    amount: { value: "500.00", currency: "USD" },
    status,
    version: 1,
  };
  const resource = `dsor://org_456/payment/${id}`;
  const correlation = { request_id: requestId("40b"), principal_id: "user_123" };
  return buildEvent({ type, tenant: "org_456", resource, kind: "Payment", data, correlation }, kinds);
}

/** A draft of INV-9001, written as DSoR's payments store writes one: its id. */
async function draftIn(client: pg.PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app.payments
       (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
     VALUES ('org_456', 'INV-9001', 'VENDOR-44', 500.00, 'USD', 'draft') RETURNING id`,
  );
  return rows[0]!.id;
}

/** The draft marked paid, as DSoR's payments store marks one. */
async function payIn(client: pg.PoolClient, id: string): Promise<void> {
  await client.query(
    "UPDATE app.payments SET status = 'paid' WHERE tenant_id = 'org_456' AND id = $1",
    [id],
  );
}

/** One of org_456's events, written into the outbox in this transaction. */
function writeIn(
  client: pg.PoolClient,
  type: EventType,
  id: string,
  status: "draft" | "paid",
): Promise<DomainEvent> {
  return outboxIn(client).add("org_456", about(type, id, status));
}

/** Work in one transaction of org_456, as dsor_runtime. */
function inOrg<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inCompany(pool, "org_456", work);
}

/** A draft and its payment.created, committed: its id. */
function drafted(): Promise<string> {
  return inOrg(async (client) => {
    const id = await draftIn(client);
    await writeIn(client, "payment.created", id, "draft");
    return id;
  });
}

/** A payment's status now, or undefined when it is gone. */
async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT status FROM app.payments WHERE id = $1",
    "org_456",
    [id],
  );
  return rows[0]?.["status"];
}

/** The types of a payment's events, in the order they were written. */
async function eventsOf(id: string): Promise<string[]> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT type FROM dsor.outbox WHERE resource = $1 ORDER BY written",
    "org_456",
    [`dsor://org_456/payment/${id}`],
  );
  return rows.map((row) => String(row["type"]));
}

/** The id inside a refused transaction, kept by the work before it threw. */
async function refusedDraft(
  work: (client: pg.PoolClient, keep: (id: string) => void) => Promise<void>,
): Promise<{ error: unknown; id: string | undefined }> {
  let id: string | undefined;
  try {
    await inOrg((client) => work(client, (kept) => (id = kept)));
  } catch (error) {
    return { error, id };
  }
  return { error: undefined, id };
}

describe("a change needs its event (step 40b's README, claims C1 and C2)", () => {
  it("DSOR-EVT-01a: C1: a transaction that drafts a payment and writes no event does not commit, and the draft is gone", async () => {
    const { error, id } = await refusedDraft(async (client, keep) => keep(await draftIn(client)));
    expect(String(error)).toMatch(/payment\.created/);
    expect(id).toBeDefined();
    expect(await statusOf(id!)).toBeUndefined();
  });

  it("DSOR-EXE-04a: C1: a draft with its payment.created, written after it in the same transaction, commits", async () => {
    const id = await drafted();
    expect(await statusOf(id)).toBe("draft");
    expect(await eventsOf(id)).toEqual(["payment.created"]);
  });

  it("DSOR-EVT-01a: C2: a transaction that marks a draft paid and writes no event does not commit, and the payment stays a draft", async () => {
    const id = await drafted();
    await expect(inOrg((client) => payIn(client, id))).rejects.toThrow(/payment\.executed/);
    expect(await statusOf(id)).toBe("draft");
    expect(await eventsOf(id)).toEqual(["payment.created"]);
  });

  it("DSOR-EXE-04a: C2: a draft marked paid with its payment.executed, in the same transaction, commits", async () => {
    const id = await drafted();
    await inOrg(async (client) => {
      await payIn(client, id);
      await writeIn(client, "payment.executed", id, "paid");
    });
    expect(await statusOf(id)).toBe("paid");
    expect(await eventsOf(id)).toEqual(["payment.created", "payment.executed"]);
  });

  it("DSOR-EVT-01a: C2: an event from an earlier transaction does not count: the owner drafts a removed payment again under its old id, and it does not commit", async () => {
    const id = await drafted();
    const again = ownerPaymentEvents("again", id) as { said: string; id: string };
    expect(again.said).toMatch(/payment\.created/);
    expect(await statusOf(id)).toBe("draft");
  });
});

describe("a change with no event type needs none (step 40b's README, claim C3)", () => {
  it("DSOR-EVT-01a: C3: user_123 cancels a draft through DSoR: COMMITTED, and no new event", async () => {
    const id = await drafted();
    const registry = dbRegistry(pool);
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect(await statusOf(id)).toBe("cancelled");
    expect(await eventsOf(id)).toEqual(["payment.created"]);
  });

  it("DSOR-EVT-01a: C3: the owner changes a draft's amount, with no event, and it commits", async () => {
    const id = await drafted();
    expect(ownerInvoices("amend", id)).toMatchObject({ version: 2 });
  });
});

describe("an event needs its change (step 40b's README, claim C4)", () => {
  it("DSOR-EVT-01a: C4: a payment.created about PAY-000, which does not exist, is refused", async () => {
    await expect(
      inOrg((client) => writeIn(client, "payment.created", "PAY-000", "draft")),
    ).rejects.toThrow(/PAY-000/);
  });

  it("DSOR-EVT-01a: C4: a payment.executed about a draft is refused, and the draft stays as it was", async () => {
    const id = await drafted();
    await expect(
      inOrg((client) => writeIn(client, "payment.executed", id, "paid")),
    ).rejects.toThrow(new RegExp(id));
    expect(await eventsOf(id)).toEqual(["payment.created"]);
  });

  it("DSOR-EVT-01a: C4: a second payment.executed about a paid payment is refused, as step 40's review found PAY-901 announced twice (H1)", async () => {
    const id = await drafted();
    await inOrg(async (client) => {
      await payIn(client, id);
      await writeIn(client, "payment.executed", id, "paid");
    });
    await expect(
      inOrg((client) => writeIn(client, "payment.executed", id, "paid")),
    ).rejects.toThrow();
    expect(await eventsOf(id)).toEqual(["payment.created", "payment.executed"]);
  });

  it("DSOR-EVT-01a: C4: a second payment.created about one payment is refused", async () => {
    const id = await drafted();
    await expect(
      inOrg((client) => writeIn(client, "payment.created", id, "draft")),
    ).rejects.toThrow();
    expect(await eventsOf(id)).toEqual(["payment.created"]);
  });
});

describe("every login and every path (step 40b's README, claim C5)", () => {
  it("DSOR-EVT-01a: C5: the owner's draft with no event does not commit", async () => {
    const bare = ownerPaymentEvents("bare") as { said: string; id: string };
    expect(bare.said).toMatch(/payment\.created/);
    expect(await statusOf(bare.id)).toBeUndefined();
  });

  it("DSOR-EVT-01a: C5: dsor_runtime cannot say which transaction wrote an event", async () => {
    const event = about("payment.created", "PAY-000", "draft");
    await expect(
      tryThenRollBack(
        pool,
        `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event, written_xact)
         VALUES ($1, 'org_456', 'payment.created', $2, 1, $3, '1')`,
        "org_456",
        [event.event_id, event.resource, JSON.stringify({ ...event, ordering_key: 1 })],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tryThenRollBack(pool, "UPDATE dsor.outbox SET written_xact = '1'", "org_456"),
    ).rejects.toThrow(/permission denied/);
  });

  it("DSOR-EVT-01a: C5: through DSoR, a reconcile whose event is never written does not commit: the payment stays a draft, the proposal stays OUTCOME_UNKNOWN, and the shipped reconcile then settles it", async () => {
    const bank = createFakeBank();
    const banks = new Map([["fake-bank", { bank, waitMs: 50 }]]);
    const none = undefined;
    const registry = dbRegistry(pool, none, none, none, none, none, none, none, banks);
    // DSoR's own reconcile, with an event writer that writes nothing: a path that forgot its event.
    const shipped = ownWorkFor();
    const reconcile = shipped["payment.reconcile"]!;
    const forgets: OwnWork = {
      check: reconcile.check,
      change: (input, work) =>
        reconcile.change(input, {
          ...work,
          events: { write: async () => ({}) as DomainEvent },
        }),
    };
    const own = { ...shipped, "payment.reconcile": forgets };
    const forgetful = dbRegistry(pool, none, none, own, none, none, none, none, banks);

    ownerInvoices("add");
    const draft = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
      invoice: INV_9001,
      expected_version: 1,
    });
    const id = (draft as { data: { id: string } }).data.id;
    bank.mode = "silent";
    const unknown = await call(registry, log, keyed(SUPERVISOR), "payment.execute", {
      invoice: INV_9001,
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    bank.mode = "good";
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    const proposal = String("proposal" in unknown ? unknown.proposal : "");

    const refused: Answer = await call(forgetful, log, keyed(SCHEDULER), "payment.reconcile", {
      proposal,
    });
    expect(refused).toHaveProperty("code");
    expect(await statusOf(id)).toBe("draft");
    expect(await eventsOf(id)).toEqual(["payment.created"]);
    const { rows } = await tryThenRollBack(
      pool,
      "SELECT state FROM dsor.proposals WHERE id = $1",
      "org_456",
      [proposal.split("/").at(-1)],
    );
    expect(rows[0]?.["state"]).toBe("OUTCOME_UNKNOWN");

    const settled = await call(registry, log, keyed(SCHEDULER), "payment.reconcile", {
      proposal,
    });
    expect(settled).toMatchObject({ outcome: "COMMITTED", data: { state: "COMMITTED" } });
    expect(await statusOf(id)).toBe("paid");
    expect(await eventsOf(id)).toEqual(["payment.created", "payment.executed"]);
  });
});

/** A draft and its payment.created, then paid with its payment.executed, each committed: its id. */
async function paid(): Promise<string> {
  const id = await drafted();
  await inOrg(async (client) => {
    await payIn(client, id);
    await writeIn(client, "payment.executed", id, "paid");
  });
  return id;
}

/** The payment's status set by dsor_runtime, as raw SQL can. */
function setStatusIn(client: pg.PoolClient, id: string, status: string): Promise<unknown> {
  return client.query("UPDATE app.payments SET status = $2 WHERE tenant_id = 'org_456' AND id = $1", [
    id,
    status,
  ]);
}

// Found by step 40b's review, H1: a payment paid with its event could be set back to draft, so the
//   accounts system heard "paid" for money that never left, and the payment could never be paid
//   again. The learner chose: paid is final, for every login (step 40b's README, decision D8).
describe("the review, H1: paid is final (step 40b's README, decision D8)", () => {
  it("DSOR-EVT-01a: H1: a payment marked paid with its event cannot go back to draft in the same transaction", async () => {
    const id = await drafted();
    await expect(
      inOrg(async (client) => {
        await payIn(client, id);
        await writeIn(client, "payment.executed", id, "paid");
        await setStatusIn(client, id, "draft");
      }),
    ).rejects.toThrow(/is paid, and paid is final/);
    expect(await statusOf(id)).toBe("draft");
    expect(await eventsOf(id)).toEqual(["payment.created"]);
  });

  it("DSOR-EVT-01a: H1: a paid payment cannot go back to draft in a later transaction", async () => {
    const id = await paid();
    await expect(inOrg((client) => setStatusIn(client, id, "draft"))).rejects.toThrow(
      /is paid, and paid is final/,
    );
    expect(await statusOf(id)).toBe("paid");
  });

  it("DSOR-EVT-01a: H1: a paid payment cannot be cancelled", async () => {
    const id = await paid();
    await expect(inOrg((client) => setStatusIn(client, id, "cancelled"))).rejects.toThrow(
      /is paid, and paid is final/,
    );
    expect(await statusOf(id)).toBe("paid");
  });

  it("DSOR-EVT-01a: H1: the owner cannot set a paid payment back to draft either", async () => {
    const id = await paid();
    const unpaid = ownerPaymentEvents("unpay", id) as { said: string };
    expect(unpaid.said).toMatch(/is paid, and paid is final/);
    expect(await statusOf(id)).toBe("paid");
  });

  it("DSOR-EVT-01a: H1: a payment's number never changes, so its events never point at nothing", async () => {
    const id = await drafted();
    const renumbered = ownerPaymentEvents("renumber", id) as { said: string };
    expect(renumbered.said).toMatch(/number never changes/);
    expect(await statusOf(id)).toBe("draft");
  });
});
