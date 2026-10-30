// Step 43b: what the code review of this step found in the defaults. A world that gives the
// registry no table of people, as the shared test registry and pnpm start's worlds do, must still
// have one table, which the commands write and line ① reads; and a world with no book of logins
// must still remove a person (step 43b's README, "What the code review found").
import { describe, expect, it } from "vitest";
import { readRoleSettings, STEP_19_ROLE_SOURCES } from "../src/authority.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices as storyInvoices, memoryInvoices } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  storyDirectories,
  testSlips,
} from "./helpers.ts";

const ADMIN: RequestEnvelope = { token: "tok_a100", tenant: "org_456" };
const SUPERVISOR: RequestEnvelope = { token: "tok_2c91", tenant: "org_456" };
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** A registry built as the shared test registry and pnpm start build theirs: no table given. */
function worldWithNoTableGiven(): {
  registry: Registry;
  ask: (who: RequestEnvelope, name: string, input: unknown) => Promise<Answer>;
} {
  const invoices = memoryInvoices(structuredClone(storyInvoices));
  const payments = memoryPayments([]);
  const slips = testSlips();
  const registry = buildRegistry(
    shipped,
    handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    invoices,
    payments,
    slips,
    storyDirectories(),
    readRoleSettings(STEP_19_ROLE_SOURCES),
    memoryClaims(invoices, payments, undefined, undefined, slips),
    ownWorkFor(),
  );
  const log = createLog();
  return { registry, ask: (who, name, input) => call(registry, log, who, name, input) };
}

describe("From the code review of step 43b, finding 1: one table, written and read", () => {
  it("DSOR-IDN-01: with no table given, a role.revoke that answers COMMITTED is gone from user_123's next call", async () => {
    const { ask } = worldWithNoTableGiven();
    const revoked = await ask(keyed(ADMIN), "role.revoke", {
      person: "dsor://org_456/person/user_123",
      role: "ap_supervisor",
      reason: "moved",
    });
    expect(revoked).toMatchObject({ outcome: "COMMITTED" });
    expect(await ask(SUPERVISOR, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});

describe("From the code review of step 43b, finding 2: a world with no book still removes a person", () => {
  it("DSOR-IDN-01: with no book of logins, person.remove answers COMMITTED, and user_123's next call is no caller", async () => {
    const { ask } = worldWithNoTableGiven();
    const removed = await ask(keyed(ADMIN), "person.remove", {
      person: "dsor://org_456/person/user_123",
      reason: "left the company",
    });
    expect(removed).toMatchObject({ outcome: "COMMITTED", data: { status: "deprovisioned" } });
    expect(await ask(SUPERVISOR, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });
});
