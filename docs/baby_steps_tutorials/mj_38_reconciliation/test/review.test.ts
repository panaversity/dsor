// What step 32's hostile review found, each as a test: the findings it fixed, and the breaks that
// left every unit test green (step 32's README, "Think it through", the review). The agent drafts
// INV-1008, 31,400.00 USD to VENDOR-44, which waits for the CFO, and cfo_100 approves it.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { Freshness } from "../src/freshness.ts";
import { memoryInvoices } from "../src/invoice.ts";
import type { Principal } from "../src/principals.ts";
import { dsorMover, memoryProposals } from "../src/proposals.ts";
import { handlersFor } from "../src/operations.ts";
import {
  AGENT,
  CFO,
  contract,
  INTAKE_SLIP,
  keyed,
  shippedInputs,
  shippedRoles,
  shippedWith,
  withoutControls,
  withPlanted,
} from "./helpers.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

/** What an answer says, in one word. */
const word = (a: Answer): string => ("outcome" in a ? a.outcome : "code" in a ? a.code : "data");

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The agent drafts INV-1008, and cfo_100 approves it: it waits APPROVED for its release. */
async function approved(w: RuleWorld) {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const kept = (await w.proposals.get("org_456", idOf(answer)))!;
  const approval = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: kept.uri,
    payload_hash: kept.payload_hash,
  });
  expect(approval).toMatchObject({ outcome: "COMMITTED" });
  return { id: idOf(answer), uri: kept.uri };
}

/** The payments store loses its connection as it writes a draft: an accident, not a refusal. */
function breakTheWrite(w: RuleWorld): void {
  (w.drafted as unknown as { push: () => never }).push = () => {
    throw new Error("connection lost");
  };
}

/** From now on, the store labels each read of this kind with this label. */
function relabel(w: RuleWorld, which: "get" | "vendor", label: Freshness): void {
  const inner = memoryInvoices(w.bills, w.vendors);
  const read =
    which === "get"
      ? async (tenant: string, id: string) => ({
          ...(await inner.get(tenant, id)),
          freshness: label,
        })
      : async (tenant: string, id: string) => ({
          ...(await inner.vendor(tenant, id)),
          freshness: label,
        });
  Object.assign(w.registry.invoices, { [which]: read });
}

describe("review M1: memory undoes only what a call did, as the database's rollback does (step 32's README, D14)", () => {
  it("DSOR-APR-01c: an accident in a release's work leaves INV-1008's proposal APPROVED, with its history and its booking", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const before = (await w.proposals.get("org_456", id))!;
    breakTheWrite(w);
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri });
    expect(released).toMatchObject({ code: "INTERNAL_ERROR" });
    const after = await w.proposals.get("org_456", id);
    expect(after?.state).toBe("APPROVED");
    expect(after?.transitions).toStrictEqual(before.transitions);
    expect((await w.reservations.get("org_456", id))?.state).toBe("held");
  });

  it("DSOR-DEL-06d: an accident in a draft's own code leaves no proposal and no booking: INV-1002's 8,900.50 USD is not held for ever", async () => {
    const w = await ruleWorldOnTuesday();
    breakTheWrite(w);
    expect(await w.draft("INV-1002")).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await w.proposals.all()).toStrictEqual([]);
    expect(await w.reservations.all()).toStrictEqual([]);
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("0.00");
  });
});

describe("review M2: a release reads CURRENT state, whatever the contract permits (DSOR-APR-03a, D11)", () => {
  it("DSOR-APR-03a: payment.create permits 300 seconds of staleness; at the release, a vendor read 240 seconds old is FRESHNESS_UNSATISFIABLE, and INV-1008 still waits APPROVED", async () => {
    const changed = contract("payment.create");
    changed["preconditions"] = {
      ...(changed["preconditions"] as object),
      freshness: "bounded_staleness",
      max_age_seconds: 300,
    };
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(changed));
    const { id, uri } = await approved(w);
    // Thursday, the accounts team suspends VENDOR-44; a cache four minutes old still says approved.
    w.vendors.find((v) => v.tenant_id === "org_456" && v.id === "VENDOR-44")!.status = "suspended";
    const inner = memoryInvoices(w.bills, w.vendors);
    Object.assign(w.registry.invoices, {
      vendor: async (tenant: string, vendor: string) => {
        const read = await inner.vendor(tenant, vendor);
        const freshness: Freshness = {
          mode: "bounded_staleness",
          observed_at: new Date(Date.now() - 240_000).toISOString(),
          connector: "cache",
        };
        return { vendor: read.vendor && { ...read.vendor, status: "approved" }, freshness };
      },
    });
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri });
    expect(released).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
    expect(w.drafted).toStrictEqual([]);
  });
});

describe("review M3: the refusal names the waiting proposal to every caller (DSOR-EXC-01, D8)", () => {
  const INTAKE = { token: "tok_intake", tenant: "org_456" };
  const intake = {
    id: "intake-fte",
    type: "agent",
    memberships: [{ tenant_id: "org_456", roles: [] }],
  } as unknown as Principal;

  it("DSOR-EXC-01: intake-fte, an agent with no clearance, hears its second attempt on INV-1008 refused, naming the first", async () => {
    const w = await ruleWorldOnTuesday(undefined, [INTAKE_SLIP]);
    const ask = (): Promise<Answer> =>
      w.ask(keyed(INTAKE), "payment.create", {
        invoice: "dsor://org_456/invoice/INV-1008",
        expected_version: 1,
      });
    const [first, second] = await withPlanted("tok_intake", intake, async () => [
      await ask(),
      await ask(),
    ]);
    expect(first).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(second).toMatchObject({
      code: "CONFLICT",
      message: `invoice INV-1008 has an attempt in flight already: proposal ${String(
        "proposal" in first! ? first.proposal : "",
      )}, PENDING_APPROVAL`,
    });
  });
});

describe("review L1: a bound address must be an invoice's (D2)", () => {
  it("DSOR-RID-01a: with an input schema that no longer pins /invoice/, the address dsor://org_456/payment/INV-1008 is refused at line ⑨, and nothing waits", async () => {
    const inputs = shippedInputs.map((s) => {
      const schema = JSON.parse(s.text) as {
        title?: string;
        properties?: Record<string, Record<string, unknown>>;
      };
      if (schema.title !== "PaymentCreateRequest") return s;
      delete schema.properties!["invoice"]!["pattern"];
      return { file: s.file, text: JSON.stringify(schema) };
    });
    const w = await ruleWorldOnTuesday(undefined, undefined, inputs);
    const first = await w.ask(keyed(AGENT), "payment.create", {
      invoice: "dsor://org_456/payment/INV-1008",
      expected_version: 1,
    });
    expect(first).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(await w.draft("INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
  });
});

describe("review L2: a release's own contract lists no predicate (D3)", () => {
  it("Step 32: start-up refuses a predicate on proposal.execute, which checks the stored request's preconditions, never its own", () => {
    const changed = contract("proposal.execute");
    changed["preconditions"] = { freshness: "current", predicates: ["false"] };
    expect(() => withoutControls(shippedWith(changed), handlersFor(), shippedRoles)).toThrow(
      "proposal.execute: it lists predicates, which a release never evaluates",
    );
  });
});

describe("review L5, P2, P3, L8: each read must be as fresh as the contract asks (D5)", () => {
  const now = (seconds = 0): string => new Date(Date.now() - seconds * 1_000).toISOString();

  it("DSOR-FRS-02b: a connector_defined read of INV-1002, where the contract asks for current, is FRESHNESS_UNSATISFIABLE", async () => {
    const w = await ruleWorldOnTuesday();
    relabel(w, "get", { mode: "connector_defined", observed_at: now(), connector: "xero" });
    expect(word(await w.draft("INV-1002"))).toBe("FRESHNESS_UNSATISFIABLE");
  });

  it("DSOR-FRS-02a: a HIGH payment.create that permits 60 seconds of staleness refuses an observational read 20 seconds old", async () => {
    const changed = contract("payment.create");
    changed["risk"] = { level: "high" };
    changed["preconditions"] = {
      ...(changed["preconditions"] as object),
      freshness: "bounded_staleness",
      max_age_seconds: 60,
    };
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(changed));
    relabel(w, "get", { mode: "observational", observed_at: now(20), connector: "cache" });
    expect(word(await w.draft("INV-1002"))).toBe("FRESHNESS_UNSATISFIABLE");
  });

  it("DSOR-FRS-02b: a contract that asks connector_defined still refuses an observational read: a weaker label is refused", async () => {
    const changed = contract("payment.create");
    changed["preconditions"] = {
      ...(changed["preconditions"] as object),
      freshness: "connector_defined",
    };
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(changed));
    relabel(w, "get", { mode: "observational", observed_at: now(), connector: "cache" });
    expect(word(await w.draft("INV-1002"))).toBe("FRESHNESS_UNSATISFIABLE");
    relabel(w, "get", { mode: "connector_defined", observed_at: now(), connector: "xero" });
    expect(word(await w.draft("INV-1002"))).toBe("COMMITTED");
  });

  it("DSOR-OPR-06: a dry run of INV-1002 over a cached vendor read hears FRESHNESS_UNSATISFIABLE, as the real call does", async () => {
    const w = await ruleWorldOnTuesday();
    relabel(w, "vendor", { mode: "observational", observed_at: now(), connector: "memory" });
    const input = { invoice: "dsor://org_456/invoice/INV-1002", expected_version: 1 };
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "payment.create", input);
    const real = await w.ask(keyed(AGENT), "payment.create", input);
    expect([word(dry), word(real)]).toStrictEqual([
      "FRESHNESS_UNSATISFIABLE",
      "FRESHNESS_UNSATISFIABLE",
    ]);
  });
});

describe("review X4, X7, L7, M1-break, X8: the guards around one attempt at a time (D6, D7, D13)", () => {
  it("DSOR-EXC-01: in memory, ten prepared drafts of INV-1009 at once: one READY, and nine CONFLICT naming it", async () => {
    const w = await ruleWorldOnTuesday();
    const input = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };
    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", input),
      ),
    );
    expect(answers.map(word).sort()).toStrictEqual([...Array(9).fill("CONFLICT"), "READY"]);
    const ready = answers.find((a) => word(a) === "READY")!;
    const address = String("proposal" in ready ? ready.proposal : "");
    for (const refused of answers.filter((a) => word(a) === "CONFLICT")) {
      expect((refused as { message: string }).message).toContain(address);
    }
  });

  it("DSOR-EXC-01: memory's key stands behind the agent's real attempt: a proposal written beside it cannot move into flight", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await w.draft("INV-1008");
    const kept = (await w.proposals.get("org_456", idOf(first)))!;
    const uri = "dsor://org_456/invoice/INV-1008";
    const id = "prop_00000000-0000-4000-8000-000000000999";
    const by = {
      mover: dsorMover(kept.requester),
      cause: "planted",
      correlation: { request_id: "req_t" } as never,
    };
    const draft = {
      operation: "payment.create@1",
      mode: "propose_only" as const,
      payload: { invoice: uri, expected_version: 1 },
      payload_hash: `sha256:${"f".repeat(64)}`,
      resources: [uri],
      requester: kept.requester,
      idempotency_key: "k-planted",
      exclusive_over: uri,
    };
    await w.proposals.create("org_456", id, draft, by, "P7D");
    await expect(w.proposals.move("org_456", id, "PROPOSED", "READY", by)).rejects.toThrow(
      "two proposals of payment.create would be in flight",
    );
  });

  it("DSOR-EXC-01: memory's key refuses a second proposal over INV-1008 that starts to wait for the CFO beside a READY one", async () => {
    const proposals = memoryProposals();
    const uri = "dsor://org_456/invoice/INV-1008";
    const requester = {
      identity_mode: "direct" as const,
      subject: "user_123",
      subject_type: "human",
      actor_chain: [],
      active_tenant: "org_456",
      subject_authority: { source: "token" as const, as_of: "2026-10-16T09:00:00.000Z" },
    };
    const by = {
      mover: dsorMover(requester),
      cause: "planted",
      correlation: { request_id: "req_t" } as never,
    };
    const draft = (key: string) => ({
      operation: "payment.create@1",
      mode: "execute" as const,
      payload: { invoice: uri, expected_version: 1 },
      payload_hash: `sha256:${"a".repeat(64)}`,
      resources: [uri],
      requester,
      idempotency_key: key,
      exclusive_over: uri,
    });
    const one = "prop_00000000-0000-4000-8000-000000000501";
    const two = "prop_00000000-0000-4000-8000-000000000502";
    await proposals.create("org_456", one, draft("k1"), by, "P7D");
    await proposals.create("org_456", two, draft("k2"), by, "P7D");
    expect(await proposals.move("org_456", one, "PROPOSED", "READY", by)).toBe(true);
    const requires = [
      { approval: { role: "CFO", quorum: 1 }, control: "high-value-payment", control_version: 8 },
    ];
    await expect(
      proposals.move("org_456", two, "PROPOSED", "PENDING_APPROVAL", by, requires as never),
    ).rejects.toThrow("two proposals of payment.create would be in flight");
  });

  it("DSOR-CON-01b: while INV-1008 waits for the CFO, a second attempt decided on its old version hears STALE_STATE, facts before the conflict", async () => {
    const w = await ruleWorldOnTuesday();
    expect(word(await w.draft("INV-1008"))).toBe("PENDING_APPROVAL");
    w.bills.find((b) => b.tenant_id === "org_456" && b.id === "INV-1008")!.version = 2;
    expect(word(await w.draft("INV-1008"))).toBe("STALE_STATE");
  });

  it("Step 32: start-up refuses in_flight.exclusive_over on a query", () => {
    const changed = { ...contract("invoice.get"), in_flight: { exclusive_over: ["invoice"] } };
    expect(() => withoutControls(shippedWith(changed), handlersFor(), shippedRoles)).toThrow(
      "invoice.get: in_flight.exclusive_over",
    );
  });
});
