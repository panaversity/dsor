// Limits with reservations (DSOR-DEL-06a to DSOR-DEL-06e in specs/dsor/02-security.md, section
// 13.4), in memory. The database's half, with fifty drafts at the same moment, is in
// limits.db.test.ts (step 24's README, decisions 1 to 15).
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { readBound } from "../src/bound.ts";
import { invoices, memoryInvoices, type Invoice, type InvoiceStore } from "../src/invoice.ts";
import { memoryReservations, millionths, within } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import type { Principal } from "../src/principals.ts";
import { call } from "../src/pipeline.ts";
import { memoryProposals } from "../src/proposals.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { memorySlips } from "../src/slips.ts";
import {
  AGENT,
  contract,
  correlationFor,
  DEL_100,
  DEL_101,
  DEL_102,
  forComparing,
  INTAKE_SLIP,
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  shippedWith,
  storyDirectories,
  SUPERVISOR,
  THE_AGENT,
  withPlanted,
  type StorySlip,
} from "./helpers.ts";

// The story's draft: INV-1008's open amount, 31,400.00 USD, decided on version 1.
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };

// del_100 with the limits of §13's example: 50,000 USD in one payment, 200,000 USD in one day
// (step 24's README, decision 12). Six drafts of 31,400.00 are 188,400.00, and a seventh passes.
const LIMITED = {
  ...DEL_100,
  constraints: {
    per_transaction_limit: { value: "50000", currency: "USD" },
    cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "USD" } }],
  },
};
const FOR_ONE_DAY = '"payment.create" would pass slip del_100\'s limit for one day';
const FOR_ONE_PAYMENT = '"payment.create" would pass slip del_100\'s limit for one payment';

/** A registry with del_100's limits, whose payments, proposals, reservations, and log the test can look at. */
function story(
  options: {
    code?: Record<string, Handler>;
    now?: () => number;
    // The invoice store over the ledger, when the test changes how it reads.
    store?: (ledger: Invoice[]) => InvoiceStore;
    slips?: readonly StorySlip[];
  } = {},
) {
  const ledger = structuredClone(invoices);
  const store = options.store?.(ledger) ?? memoryInvoices(ledger);
  const rows: Payment[] = [];
  const payments = memoryPayments(rows);
  const proposals = memoryProposals();
  const reservations = memoryReservations(options.now);
  // NEW IN STEP 25c: the claim reads the slip again, so it gets the slips that line ③ reads (step 25c's README, decision D12).
  const slips = memorySlips(options.slips ?? [LIMITED, DEL_101, DEL_102, INTAKE_SLIP]);
  const registry = buildRegistry(
    shipped,
    options.code ?? handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    store,
    payments,
    slips,
    storyDirectories(),
    readRoleSettings(),
    memoryClaims(store, payments, proposals, reservations, slips),
  );
  return { ledger, rows, proposals, reservations, registry, log: createLog() };
}

/** The agent drafts a payment for INV-1008, with a fresh key, and the lines that ran. */
async function draft(
  world: ReturnType<typeof story>,
  envelope: RequestEnvelope = keyed(AGENT),
  input: unknown = INV_1008,
): Promise<{ answer: Answer; lines: number[] }> {
  const lines: number[] = [];
  const answer = await call(world.registry, world.log, envelope, "payment.create", input, (n) =>
    lines.push(n),
  );
  return { answer, lines };
}

/** What the caller heard, in one word: the outcome, or the refusal's code. */
function heard(answer: Answer): string {
  if ("code" in answer) return answer.code;
  return "outcome" in answer ? answer.outcome : "data";
}

/** INV-1008 of org_456 in the test's own ledger. */
function inv1008(world: ReturnType<typeof story>): Invoice {
  return world.ledger.find((i) => i.tenant_id === "org_456" && i.id === "INV-1008")!;
}

// The id at the end of a proposal's URI.
function idOf(answer: Answer): string {
  const uri = "proposal" in answer ? String(answer.proposal) : "";
  return uri.slice("dsor://org_456/proposal/".length);
}

describe("C1, C3, C7, C11: the limit for one day, kept by a reservation", () => {
  it("DSOR-DEL-06e: six drafts of 31,400.00 USD fit in 200,000.00 USD for the day, and the seventh is refused with LIMIT_EXCEEDED", async () => {
    const world = story();
    const words: string[] = [];
    for (let i = 0; i < 7; i++) words.push(heard((await draft(world)).answer));
    expect(words).toStrictEqual([...Array(6).fill("COMMITTED"), "LIMIT_EXCEEDED"]);
    expect(world.rows).toHaveLength(6);
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("188400.00");
  });

  it("DSOR-DEL-06e: the seventh draft hears LIMIT_EXCEEDED, retry after_delay, with words that name no amount", async () => {
    const world = story();
    for (let i = 0; i < 6; i++) await draft(world);
    const { answer } = await draft(world);
    expect(answer).toStrictEqual({
      code: "LIMIT_EXCEEDED",
      message: FOR_ONE_DAY,
      retry: "after_delay",
      proposal: expect.stringMatching(/^dsor:\/\/org_456\/proposal\/prop_/),
      correlation: correlationFor(THE_AGENT),
    });
    // The agent may not see INV-1008's amounts (DSOR-CLS-02a), so the words never show one.
    expect(JSON.stringify(answer)).not.toContain("31400");
  });

  it("DSOR-DEL-06a: seven drafts at the same moment: six are made and one is refused, never seven", async () => {
    const world = story();
    const answers = await Promise.all(Array.from({ length: 7 }, () => draft(world)));
    const words = answers.map(({ answer }) => heard(answer)).sort();
    expect(words).toStrictEqual([
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "LIMIT_EXCEEDED",
    ]);
    expect(world.rows).toHaveLength(6);
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("188400.00");
  });

  it("DSOR-DEL-06e: a refused draft's proposal ends DENIED, at line ⑩, and the claim keeps the refusal for a replay", async () => {
    const world = story();
    for (let i = 0; i < 6; i++) await draft(world);
    const envelope = keyed(AGENT);
    const refused = await draft(world, envelope);
    expect(refused.lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const proposal = await world.proposals.get("org_456", idOf(refused.answer));
    expect(proposal?.state).toBe("DENIED");
    expect(proposal?.transitions.map(({ to, cause }) => [to, cause])).toStrictEqual([
      ["PROPOSED", "payment.create called"],
      ["DENIED", "the checks refused it: LIMIT_EXCEEDED"],
    ]);
    // The same request with the same key hears the same refusal, and makes no second proposal.
    const again = await draft(world, envelope);
    expect(forComparing(again.answer)).toStrictEqual(forComparing(refused.answer));
    expect(await world.reservations.all()).toHaveLength(6);
  });

  it("Step 24: the record of a refused draft says DENY and LIMIT_EXCEEDED", async () => {
    const world = story();
    for (let i = 0; i < 6; i++) await draft(world);
    const { answer } = await draft(world);
    const record = (await world.log.records()).at(-1);
    expect(record).toMatchObject({
      authorization: "DENY",
      result: "LIMIT_EXCEEDED",
      reason: FOR_ONE_DAY,
      correlation: answer.correlation,
    });
  });

  it("Step 24: a new day starts at zero (step 24's README, decision 3)", async () => {
    let clock = Date.parse("2026-10-06T23:30:00Z");
    const world = story({ now: () => clock });
    for (let i = 0; i < 6; i++) await draft(world);
    expect(heard((await draft(world)).answer)).toBe("LIMIT_EXCEEDED");
    // 00:30 the next morning, in UTC.
    clock = Date.parse("2026-10-07T00:30:00Z");
    expect(heard((await draft(world)).answer)).toBe("COMMITTED");
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
  });
});

describe("C2, C11: the limit for one payment", () => {
  it("DSOR-DEL-06e: a draft over 50,000.00 USD is refused with LIMIT_EXCEEDED, and nothing is reserved", async () => {
    const world = story();
    inv1008(world).open_amount = { value: "60000.00", currency: "USD" };
    const { answer } = await draft(world);
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: FOR_ONE_PAYMENT });
    expect(world.rows).toStrictEqual([]);
    expect(await world.reservations.all()).toStrictEqual([]);
    expect((await world.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
  });

  it("Step 24: a draft of exactly 50,000.00 USD is within the limit for one payment", async () => {
    const world = story();
    inv1008(world).open_amount = { value: "50000.00", currency: "USD" };
    expect(heard((await draft(world)).answer)).toBe("COMMITTED");
  });

  it("Step 24: an amount in another currency than the limit is refused: no comparison before step 26 (step 24's README, decision 11)", async () => {
    const world = story();
    inv1008(world).open_amount = { value: "100.00", currency: "EUR" };
    const { answer } = await draft(world);
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: FOR_ONE_PAYMENT });
  });
});

describe("C4 to C6: a reservation's life, with its proposal", () => {
  // Found by step 24's sweep: the database's first reservation of a day was never compared with
  // the limit. The same rule in memory.
  it("DSOR-DEL-06e: a draft that alone passes the day's limit is refused, as the first of the day", async () => {
    const reservations = memoryReservations();
    const amount = { value: "31400.00", currency: "USD" };
    const day = { value: "20000", currency: "USD" };
    const proposal = "prop_00000000-0000-4000-8000-000000000025";
    expect(await reservations.reserve("org_456", proposal, "del_100", amount, day)).toBe(false);
    expect(await reservations.all()).toStrictEqual([]);
  });

  it("DSOR-DEL-06b: a proposal that reserved already reserves nothing more", async () => {
    const reservations = memoryReservations();
    const amount = { value: "31400.00", currency: "USD" };
    const limit = { value: "200000", currency: "USD" };
    const proposal = "prop_00000000-0000-4000-8000-000000000024";
    expect(await reservations.reserve("org_456", proposal, "del_100", amount, limit)).toBe(true);
    expect(await reservations.reserve("org_456", proposal, "del_100", amount, limit)).toBe(true);
    expect(await reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
    expect(await reservations.all()).toHaveLength(1);
  });

  it("DSOR-DEL-06c: while the work runs, its reservation is held", async () => {
    const seen: string[] = [];
    const shipped = handlersFor();
    let world: ReturnType<typeof story>;
    const watching: Handler = async (input, company) => {
      seen.push(...(await world.reservations.all()).map((reservation) => reservation.state));
      return shipped["payment.create"]!(input, company);
    };
    world = story({ code: { ...shipped, "payment.create": watching } });
    const { answer } = await draft(world);
    expect(seen).toStrictEqual(["held"]);
    expect((await world.reservations.get("org_456", idOf(answer)))?.state).toBe("committed");
  });

  it("DSOR-DEL-06d: a draft the code refuses after its reservation ends FAILED, and the day gets its amount back", async () => {
    const world = story();
    // Decided on version 2, and INV-1008 is at version 1: the code refuses, after line ⑩.
    const { answer } = await draft(world, keyed(AGENT), { ...INV_1008, expected_version: 2 });
    expect(answer).toMatchObject({ code: "STALE_STATE" });
    expect((await world.proposals.get("org_456", idOf(answer)))?.state).toBe("FAILED");
    expect((await world.reservations.get("org_456", idOf(answer)))?.state).toBe("released");
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("0.00");
  });

  it("DSOR-DEL-06a: a COMMITTED draft's reservation is committed, and stays counted", async () => {
    const world = story();
    const { answer } = await draft(world);
    expect(await world.reservations.get("org_456", idOf(answer))).toStrictEqual({
      tenant: "org_456",
      proposal: idOf(answer),
      delegation: "del_100",
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      amount: { value: "31400.00", currency: "USD" },
      state: "committed",
    });
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
  });

  it("Step 24: payment.cancel spends nothing, so it reserves nothing", async () => {
    const world = story();
    const drafted = await draft(world, keyed(SUPERVISOR));
    const id = "data" in drafted.answer ? (drafted.answer.data as Payment).id : "";
    const cancel = { payment: `dsor://org_456/payment/${id}`, expected_version: 1 };
    const answer = await call(
      world.registry,
      world.log,
      keyed(SUPERVISOR),
      "payment.cancel",
      cancel,
    );
    expect(heard(answer)).toBe("COMMITTED");
    expect(await world.reservations.all()).toStrictEqual([]);
  });
});

describe("C8: line ⑨ reads what a command spends, itself", () => {
  it("Step 24: a draft for an invoice nobody has is refused at line ⑨, as the code refused it, and its proposal ends DENIED", async () => {
    const world = story();
    const { answer, lines } = await draft(world, keyed(AGENT), {
      invoice: "dsor://org_456/invoice/INV-9999",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND", message: 'no invoice "INV-9999"' });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
    expect((await world.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
  });

  it("Step 24: the amount reserved is the invoice's open amount, as DSoR read it", async () => {
    const world = story();
    inv1008(world).open_amount = { value: "12345.67", currency: "USD" };
    const { answer } = await draft(world);
    const reservation = await world.reservations.get("org_456", idOf(answer));
    expect(reservation?.amount).toStrictEqual({ value: "12345.67", currency: "USD" });
  });

  it("Step 24: a person's own draft runs under no slip, so no limit applies (step 24's README, decision 10)", async () => {
    const world = story();
    const words: string[] = [];
    for (let i = 0; i < 7; i++) words.push(heard((await draft(world, keyed(SUPERVISOR))).answer));
    expect(words).toStrictEqual(Array(7).fill("COMMITTED"));
    expect(await world.reservations.all()).toStrictEqual([]);
  });

  it("Step 24: start-up refuses a bind that is not input.<field>, and a spends of no bound alias", () => {
    const celBind = { ...contract("payment.create"), bind: { invoice: "input.invoice.id" } };
    expect(() => buildRegistry(shippedWith(celBind), handlersFor(), shippedRoles)).toThrow(
      'payment.create: the bind "invoice" is not input.<field>',
    );
    const unbound = {
      ...contract("payment.create"),
      extensions: { "org.panaversity.steps": { spends: "state.vendor.amount" } },
    };
    expect(() => buildRegistry(shippedWith(unbound), handlersFor(), shippedRoles)).toThrow(
      "payment.create: what the command spends must be state.<alias>.open_amount or .amount, of an alias its bind names",
    );
  });
});

describe("C9, C12: a dry run checks and reserves nothing, and a prepared call reserves", () => {
  it("Step 24: a dry run checks the limits and reserves nothing: VALIDATED with room, LIMIT_EXCEEDED without (step 24's README, decision 8)", async () => {
    const world = story();
    const dryBefore = await draft(world, { ...AGENT, mode: "validate_only" });
    expect(dryBefore.answer).toMatchObject({ outcome: "VALIDATED" });
    expect(await world.reservations.all()).toStrictEqual([]);
    for (let i = 0; i < 6; i++) await draft(world);
    const dry = await draft(world, { ...AGENT, mode: "validate_only" });
    const real = await draft(world);
    // The real call names its DENIED proposal. A dry run makes none, and hears the rest the same.
    const { proposal: _denied, ...realWithout } = real.answer as Answer & { proposal?: string };
    expect(forComparing(dry.answer)).toStrictEqual(forComparing(realWithout as Answer));
    expect(dry.lines).toStrictEqual([1, 2, 3, 4, 5, 6, 9, 10, 11]);
    expect(await world.reservations.all()).toHaveLength(6);
  });

  // Changed by step 24's review: §21 reserves at line ⑩ in every mode but a dry run, and §26.4 finds
  // "the reservation taken when the proposal was created" again at the release (decision 9).
  it("DSOR-DEL-06a: a propose_only call reserves its amount, keyed by its proposal, held while the proposal waits in READY (step 24's README, decision 9)", async () => {
    const world = story();
    const prepared = await draft(world, { ...keyed(AGENT), mode: "propose_only" });
    expect(prepared.answer).toMatchObject({ outcome: "READY" });
    expect((await world.reservations.all()).map((r) => [r.proposal, r.state])).toStrictEqual([
      [idOf(prepared.answer), "held"],
    ]);
    // With 31,400.00 held, five drafts fit, and the sixth is refused.
    const words: string[] = [];
    for (let i = 0; i < 6; i++) words.push(heard((await draft(world)).answer));
    expect(words).toStrictEqual([...Array(5).fill("COMMITTED"), "LIMIT_EXCEEDED"]);
    const over = await draft(world, { ...keyed(AGENT), mode: "propose_only" });
    expect(over.answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: FOR_ONE_DAY });
    expect((await world.proposals.get("org_456", idOf(over.answer)))?.state).toBe("DENIED");
  });
});

describe("C11: amounts are compared exactly, with no float", () => {
  it("Step 24: millionths reads an amount exactly, and refuses what it cannot read exactly", () => {
    expect(millionths("31400.00")).toBe(31400000000n);
    expect(millionths("0.000001")).toBe(1n);
    for (const odd of ["-5.00", "1e5", "0.0000001", "", "12,5", " 1"]) {
      expect(millionths(odd)).toBeUndefined();
    }
  });

  it("Step 24: within compares in one currency only, to the last digit", () => {
    const limit = { value: "50000", currency: "USD" };
    expect(within({ value: "50000.00", currency: "USD" }, limit)).toBe(true);
    expect(within({ value: "50000.000001", currency: "USD" }, limit)).toBe(false);
    expect(within({ value: "49999.999999", currency: "USD" }, limit)).toBe(true);
    expect(within({ value: "1.00", currency: "EUR" }, limit)).toBe(false);
    expect(within({ value: "-1.00", currency: "USD" }, limit)).toBe(false);
  });
});

describe("C13 to C15, from the review, and the tests it asked for", () => {
  // Found by step 24's review (H1): line ⑨ read INV-1008 at version 1, and line ⑩ reserved its
  // 31,400.00 USD. Then the accounts system raised it to 120,000.00 at version 2, and the code,
  // asked for version 2, drafted 120,000.00. The work now writes only on what line ⑨ read.
  it("DSOR-CON-01b: a draft decided on the invoice's next version is refused when the invoice changes after line ⑨: the work drafts only what line ⑩ reserved (step 24's README, decision 16)", async () => {
    const raised = (ledger: Invoice[]): InvoiceStore => {
      const base = memoryInvoices(ledger);
      let reads = 0;
      return {
        ...base,
        get: async (tenant: string, id: string) => {
          const found = await base.get(tenant, id);
          if (id !== "INV-1008" || found.invoice === undefined || ++reads === 1) return found;
          const amount = { value: "120000.00", currency: "USD" };
          return {
            ...found,
            invoice: { ...found.invoice, amount, open_amount: amount, version: 2 },
          };
        },
      };
    };
    const world = story({ store: raised });
    const { answer } = await draft(world, keyed(AGENT), { ...INV_1008, expected_version: 2 });
    expect(answer).toMatchObject({ code: "STALE_STATE" });
    expect(world.rows).toStrictEqual([]);
    expect((await world.reservations.get("org_456", idOf(answer)))?.state).toBe("released");
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("0.00");
  });

  // Found by step 24's review (M2): a replay set ALLOW for every first call, a denied one too.
  it("DSOR-EXE-02: the replay of a refused draft is recorded DENY, as its first call was (step 24's README, decision 17)", async () => {
    const world = story();
    for (let i = 0; i < 6; i++) await draft(world);
    const envelope = keyed(AGENT);
    await draft(world, envelope);
    await draft(world, envelope);
    const [first, replay] = (await world.log.records()).slice(-2);
    expect([first?.authorization, first?.result]).toStrictEqual(["DENY", "LIMIT_EXCEEDED"]);
    expect([replay?.authorization, replay?.result]).toStrictEqual(["DENY", "LIMIT_EXCEEDED"]);
  });

  // Found by step 24's review (M3): a paid invoice's open amount is 0.00, and the database refused
  // a reservation of nothing, as an accident.
  it("Step 24: a draft of a paid invoice, whose open amount is 0.00, reserves nothing, and the code refuses it (step 24's README, decision 18)", async () => {
    const world = story();
    const { answer } = await draft(world, keyed(AGENT), {
      invoice: "dsor://org_456/invoice/INV-1001",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ code: "CONFLICT" });
    expect((await world.proposals.get("org_456", idOf(answer)))?.state).toBe("FAILED");
    expect(await world.reservations.all()).toStrictEqual([]);
  });

  it("DSOR-DEL-06e: a slip with only a limit for one payment refuses a draft over it", async () => {
    const onlyOne = {
      ...DEL_100,
      constraints: { per_transaction_limit: { value: "50000", currency: "USD" } },
    };
    const world = story({ slips: [onlyOne] });
    inv1008(world).open_amount = { value: "60000.00", currency: "USD" };
    const { answer } = await draft(world);
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: FOR_ONE_PAYMENT });
  });

  it("Step 24: a slip whose limit cannot be read is refused at line ③: a minus, or more digits than DSoR compares (step 24's README, decision 19)", async () => {
    for (const value of ["-5", "50000.0000001"]) {
      const odd = {
        ...DEL_100,
        constraints: { per_transaction_limit: { value, currency: "USD" } },
      };
      const world = story({ slips: [odd] });
      const { answer } = await draft(world);
      expect(answer).toMatchObject({
        code: "DELEGATION_REQUIRED",
        message:
          '"payment.create": slip del_100 carries a limit DSoR cannot read, which DSoR cannot check yet',
      });
    }
  });

  it("DSOR-DEL-06a: the day's limit may be reached exactly, and not passed", async () => {
    const reservations = memoryReservations();
    const amount = { value: "31400.00", currency: "USD" };
    const day = { value: "62800", currency: "USD" };
    const reserve = (n: number) =>
      reservations.reserve(
        "org_456",
        `prop_00000000-0000-4000-8000-00000000003${n}`,
        "del_100",
        amount,
        day,
      );
    expect([await reserve(1), await reserve(2), await reserve(3)]).toStrictEqual([
      true,
      true,
      false,
    ]);
    const nothing = { value: "0.00", currency: "USD" };
    expect(await reservations.fits("org_456", "del_100", nothing, day)).toBe(true);
    const cent = { value: "0.01", currency: "USD" };
    expect(await reservations.fits("org_456", "del_100", cent, day)).toBe(false);
  });

  it("Step 24: the reservations in memory refuse an amount in another currency, and keep nothing", async () => {
    const reservations = memoryReservations();
    const euros = { value: "100.00", currency: "EUR" };
    const day = { value: "200000", currency: "USD" };
    const proposal = "prop_00000000-0000-4000-8000-000000000040";
    expect(await reservations.reserve("org_456", proposal, "del_100", euros, day)).toBe(false);
    expect(await reservations.fits("org_456", "del_100", euros, day)).toBe(false);
    expect(await reservations.all()).toStrictEqual([]);
  });

  it("Step 24: a dry run refused at line ⑩ is recorded DENY", async () => {
    const world = story();
    for (let i = 0; i < 6; i++) await draft(world);
    await draft(world, { ...AGENT, mode: "validate_only" });
    const record = (await world.log.records()).at(-1);
    expect([record?.authorization, record?.result]).toStrictEqual(["DENY", "LIMIT_EXCEEDED"]);
  });

  it("Step 24: a dry run's refusal at line ⑨ is masked for an agent as the real call's is", async () => {
    const world = story();
    const publicAgent = {
      id: "intake-fte",
      type: "agent",
      memberships: [{ tenant_id: "org_456", roles: [] }],
      clearance: "public",
    } as unknown as Principal;
    const input = { invoice: "dsor://org_456/invoice/INV-9999", expected_version: 1 };
    const INTAKE = { token: "tok_intake", tenant: "org_456" };
    const [dry, real] = await withPlanted("tok_intake", publicAgent, async () => [
      await call(
        world.registry,
        world.log,
        { ...INTAKE, mode: "validate_only" },
        "payment.create",
        input,
      ),
      await call(world.registry, world.log, keyed(INTAKE), "payment.create", input),
    ]);
    expect(JSON.stringify(dry)).not.toContain("INV-9999");
    const { proposal: _denied, ...realWithout } = real as Answer & { proposal?: string };
    expect(forComparing(dry!)).toStrictEqual(forComparing(realWithout as Answer));
  });

  it("Step 24: start-up refuses a query that says it spends", () => {
    const spending = {
      ...contract("invoice.get"),
      bind: { invoice: "input.invoice" },
      extensions: { "org.panaversity.steps": { spends: "state.invoice.open_amount" } },
    };
    expect(() => buildRegistry(shippedWith(spending), handlersFor(), shippedRoles)).toThrow(
      "invoice.get: only a command spends",
    );
  });

  it("Step 24: line ⑨ reads only an invoice: a bound URI of another kind is refused as no invoice", async () => {
    const input = { invoice: "dsor://org_456/payment/PAY-901", expected_version: 1 };
    await expect(
      readBound(contract("payment.create") as never, input, memoryInvoices(), "org_456"),
    ).rejects.toThrow('no invoice "PAY-901"');
  });
});
