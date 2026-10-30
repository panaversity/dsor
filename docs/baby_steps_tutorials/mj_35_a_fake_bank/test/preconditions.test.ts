// The contract's preconditions, evaluated at line ⑨ on what DSoR read itself, and the freshness
// they ask for (step 32's README, claims C1 and C4, decisions D3, D4, and D5). The company has no
// rule here, so a payment that every precondition allows is drafted at once.
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import type { Freshness } from "../src/freshness.ts";
import { invoices, memoryInvoices, type Invoice, type InvoiceStore } from "../src/invoice.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { money } from "../src/money.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { memoryProposals } from "../src/proposals.ts";
import type { ContractSource } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { memorySlips } from "../src/slips.ts";
import { vendors, type Vendor } from "../src/vendor.ts";
import {
  AGENT,
  contract,
  DEL_100,
  DEL_101,
  DEL_102,
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  shippedWith,
  storyDirectories,
  withoutControls,
} from "./helpers.ts";

const ISSUED = 'state.invoice.status == "issued"';
const APPROVED = 'state.vendor.status == "approved"';
const LEFT =
  'dsor_exceeds(state.invoice.open_amount, dsor_money("0.00", state.invoice.open_amount.currency))';

/** A world with no company rule, whose invoices, vendors, payments, and log a test looks at. */
function world(
  options: {
    contracts?: ContractSource[];
    // The invoice store over the ledger and the vendors, when the test changes how it reads.
    store?: (ledger: Invoice[], suppliers: Vendor[]) => InvoiceStore;
  } = {},
) {
  const ledger = structuredClone(invoices);
  const suppliers = structuredClone(vendors);
  const store = options.store?.(ledger, suppliers) ?? memoryInvoices(ledger, suppliers);
  const rows: Payment[] = [];
  const payments = memoryPayments(rows);
  const proposals = memoryProposals();
  const reservations = memoryReservations();
  const slips = memorySlips([DEL_100, DEL_101, DEL_102]);
  const registry = withoutControls(
    options.contracts ?? shipped,
    handlersFor(),
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
  const log = createLog();
  const draft = (id: string, who: RequestEnvelope = keyed(AGENT)): Promise<Answer> =>
    call(registry, log, who, "payment.create", {
      invoice: `dsor://org_456/invoice/${id}`,
      expected_version: 1,
    });
  const bill = (id: string): Invoice =>
    ledger.find((i) => i.tenant_id === "org_456" && i.id === id)!;
  const vendor = (id: string): Vendor =>
    suppliers.find((v) => v.tenant_id === "org_456" && v.id === id)!;
  return { ledger, suppliers, rows, proposals, reservations, log, draft, bill, vendor };
}

/** The last decision the log holds. */
async function lastDecision(w: ReturnType<typeof world>) {
  return (await w.log.records()).filter((r) => r.kind === "decision").at(-1);
}

/** The proposal an answer names, as DSoR keeps it. */
async function proposalOf(w: ReturnType<typeof world>, answer: Answer) {
  const id = String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
  return w.proposals.get("org_456", id);
}

describe("C1: payment.create's preconditions are in its contract (step 32's README, decision D3)", () => {
  it("DSOR-CTL-05: the contract lists the three, in CEL, and asks for current reads", () => {
    expect(contract("payment.create")["preconditions"]).toStrictEqual({
      freshness: "current",
      predicates: [ISSUED, APPROVED, LEFT],
    });
  });

  it("Step 32: when all three hold, INV-1002 of VENDOR-44, 8,900.50 USD, is drafted", async () => {
    const w = world();
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect(w.rows.map((p) => [p.invoice_id, p.vendor_id, p.amount.value])).toStrictEqual([
      ["INV-1002", "VENDOR-44", "8900.50"],
    ]);
  });
});

describe("C1: a precondition that does not hold refuses, before any rule or booking (step 32's README, decision D4)", () => {
  it.each([
    ["INV-1005, a draft invoice", "INV-1005", ISSUED, () => {}],
    [
      "INV-1008, whose vendor VENDOR-44 the accounts team suspended",
      "INV-1008",
      APPROVED,
      (w: ReturnType<typeof world>) => {
        w.vendor("VENDOR-44").status = "suspended";
      },
    ],
    [
      "INV-1002, issued with nothing left open",
      "INV-1002",
      LEFT,
      (w: ReturnType<typeof world>) => {
        w.bill("INV-1002").open_amount = money("0.00", "USD");
      },
    ],
  ])(
    "DSOR-MOD-03: %s, is refused with CONFLICT naming the precondition, recorded DENY, the proposal DENIED, nothing booked or drafted",
    async (_what, id, predicate, change) => {
      const w = world();
      change(w);
      const answer = await w.draft(id);
      expect(answer).toMatchObject({
        code: "CONFLICT",
        message: `a precondition of payment.create does not hold: ${predicate}`,
      });
      expect(await lastDecision(w)).toMatchObject({
        authorization: "DENY",
        result: "CONFLICT",
        reason: `a precondition of payment.create does not hold: ${predicate}`,
      });
      expect((await proposalOf(w, answer))?.state).toBe("DENIED");
      expect(await w.reservations.all()).toStrictEqual([]);
      expect(w.rows).toStrictEqual([]);
    },
  );

  it("Step 32: the first that fails is named, in the contract's order: a draft invoice of a suspended vendor names the invoice's status", async () => {
    const w = world();
    w.vendor("VENDOR-44").status = "suspended";
    expect(await w.draft("INV-1005")).toMatchObject({
      code: "CONFLICT",
      message: `a precondition of payment.create does not hold: ${ISSUED}`,
    });
  });

  it("DSOR-CTL-08: a vendor the accounts system does not list makes the vendor's precondition fail to evaluate, and so it is false", async () => {
    const w = world();
    w.ledger.push({ ...w.bill("INV-1002"), id: "INV-9001", vendor_id: "VENDOR-99" });
    expect(await w.draft("INV-9001")).toMatchObject({
      code: "CONFLICT",
      message: `a precondition of payment.create does not hold: ${APPROVED} (it could not be evaluated, so it counts as false)`,
    });
    expect(w.rows).toStrictEqual([]);
  });

  it("DSOR-CTL-08: a predicate that reads a field no record has is false, never skipped", async () => {
    const changed = contract("payment.create");
    changed["preconditions"] = { freshness: "current", predicates: ['state.invoice.due == "now"'] };
    const w = world({ contracts: shippedWith(changed) });
    expect(await w.draft("INV-1002")).toMatchObject({
      code: "CONFLICT",
      message:
        'a precondition of payment.create does not hold: state.invoice.due == "now" (it could not be evaluated, so it counts as false)',
    });
  });

  it("Step 32: a predicate that is false is evaluated now: step 27's predicate false, which start-up once refused, refuses every draft", async () => {
    const changed = contract("payment.create");
    changed["preconditions"] = { freshness: "current", predicates: ["false"] };
    const w = world({ contracts: shippedWith(changed) });
    expect(await w.draft("INV-1002")).toMatchObject({
      code: "CONFLICT",
      message: "a precondition of payment.create does not hold: false",
    });
  });

  it("DSOR-OPR-06: a dry run hears the same refusal, and nothing is kept", async () => {
    const w = world();
    w.vendor("VENDOR-44").status = "suspended";
    expect(await w.draft("INV-1002", { ...AGENT, mode: "validate_only" })).toMatchObject({
      code: "CONFLICT",
      message: `a precondition of payment.create does not hold: ${APPROVED}`,
    });
    expect(await w.proposals.all()).toStrictEqual([]);
  });
});

/** A store whose reads of one kind carry this label instead of their own. */
function labelled(label: Freshness, which: "invoice" | "vendor") {
  return (ledger: Invoice[], suppliers: Vendor[]): InvoiceStore => {
    const inner = memoryInvoices(ledger, suppliers);
    return {
      get: async (tenant, id) => {
        const read = await inner.get(tenant, id);
        return which === "invoice" ? { ...read, freshness: label } : read;
      },
      list: inner.list,
      vendor: async (tenant, id) => {
        const read = await inner.vendor(tenant, id);
        return which === "vendor" ? { ...read, freshness: label } : read;
      },
    };
  };
}

/** payment.create, rated and asking as given. */
function payingWith(level: string, preconditions: Record<string, unknown>): ContractSource[] {
  const changed = contract("payment.create");
  changed["risk"] = { level };
  changed["preconditions"] = { ...(changed["preconditions"] as object), ...preconditions };
  return shippedWith(changed);
}

describe("C4: the reads must be as fresh as the contract asks (step 32's README, decision D5)", () => {
  const cached: Freshness = {
    mode: "observational",
    observed_at: new Date(Date.now() - 1_000).toISOString(),
    connector: "memory",
  };

  it.each(["invoice", "vendor"] as const)(
    "DSOR-FRS-02b: a cached read of the %s, where the contract asks for current, is FRESHNESS_UNSATISFIABLE, and nothing is drafted",
    async (which) => {
      const w = world({ store: labelled(cached, which) });
      expect(await w.draft("INV-1002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
      expect(w.rows).toStrictEqual([]);
      expect(await w.reservations.all()).toStrictEqual([]);
    },
  );

  // Found by a sweep of small breaks, M17: "current" let a bounded_staleness read through too.
  it("DSOR-FRS-02b: a read of bounded staleness, 1 second old, where the contract asks for current, is FRESHNESS_UNSATISFIABLE too", async () => {
    const bounded: Freshness = {
      mode: "bounded_staleness",
      observed_at: new Date(Date.now() - 1_000).toISOString(),
      connector: "warehouse",
    };
    const w = world({ store: labelled(bounded, "invoice") });
    expect(await w.draft("INV-1002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(w.rows).toStrictEqual([]);
  });

  it("DSOR-FRS-02a: a HIGH payment.create that permits bounded staleness of 60 seconds takes a read 20 seconds old, and refuses one 90 seconds old", async () => {
    const contracts = payingWith("high", { freshness: "bounded_staleness", max_age_seconds: 60 });
    const at = (seconds: number): Freshness => ({
      mode: "bounded_staleness",
      observed_at: new Date(Date.now() - seconds * 1_000).toISOString(),
      connector: "warehouse",
    });
    const young = world({ contracts, store: labelled(at(20), "invoice") });
    expect(await young.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    const old = world({ contracts, store: labelled(at(90), "invoice") });
    expect(await old.draft("INV-1002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(old.rows).toStrictEqual([]);
  });

  it.each([
    ["observational", { freshness: "observational" }],
    ["connector_defined", { freshness: "connector_defined" }],
    ["bounded_staleness with no max_age_seconds", { freshness: "bounded_staleness" }],
  ])(
    "DSOR-FRS-02a: start-up refuses a HIGH payment.create whose preconditions ask for %s",
    (_what, asked) => {
      expect(() => withoutControls(payingWith("high", asked), handlersFor(), shippedRoles)).toThrow(
        "payment.create: a high command's preconditions must be read current",
      );
    },
  );

  it("DSOR-FRS-02a: a CRITICAL one too, and a MEDIUM one that asks for observational reads starts", () => {
    expect(() =>
      withoutControls(
        payingWith("critical", { freshness: "observational" }),
        handlersFor(),
        shippedRoles,
      ),
    ).toThrow("payment.create: a critical command's preconditions must be read current");
    expect(() =>
      withoutControls(
        payingWith("medium", { freshness: "observational" }),
        handlersFor(),
        shippedRoles,
      ),
    ).not.toThrow();
  });
});
