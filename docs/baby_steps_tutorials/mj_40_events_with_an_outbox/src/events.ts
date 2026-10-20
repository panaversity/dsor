// NEW IN STEP 40: events, DSoR's messages to other systems about what it did (DSOR-EVT-01b,
// DSOR-EVT-01c, and DSOR-COR-01a in specs/dsor/03-execution.md, sections 31 and 32). An event names
// the change, the resource it changed, the company, and the call's ids; its data is the resource as
// DSoR holds it, through the classification, so no RESTRICTED value leaves; and it is checked
// against event.schema.json before the outbox takes it (step 40's README, decisions D3 and D5 to D7).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Correlation } from "./envelope.ts";
import type { Kinds, Label } from "./labels.ts";
import { show } from "./masking.ts";
import type { OutboxWriter } from "./outbox.ts";
import type { Cancelled, Draft, Drafted, PaymentStatus, PaymentStore } from "./payment.ts";
import { formatUri, parseUri } from "./uri.ts";

/** The events this step writes: three of the four §31 names (decision D0). */
export type EventType = "payment.created" | "payment.executed" | "proposal.approved";

/** An event's correlation: the call's ids, as DSoR keeps them in its record, and the company's. */
export type EventCorrelation = Correlation & { tenant_id: string };

/** One event, as event.schema.json describes it. */
export type DomainEvent = {
  event_id: string;
  type: EventType;
  tenant: string;
  resource: string;
  ordering_key: number;
  origin: "dsor";
  at: string;
  classification: Label;
  data: unknown;
  correlation: EventCorrelation;
};

/** An event before the outbox numbers it among its resource's events (decision D4). */
export type EventDraft = Omit<DomainEvent, "ordering_key">;

/** What an event is built from: the change, the resource, its data and its kind, and the call. */
export type EventFacts = {
  type: EventType;
  tenant: string;
  resource: string;
  kind: string;
  data: unknown;
  correlation: Correlation;
};

/**
 * The clearance an event is shown with: a RESTRICTED field never leaves in an event, whoever
 * receives it (DSOR-EVT-01c; decision D5).
 */
export const EVENT_CLEARANCE: Label = "confidential";

/** An event, built from its facts, before the outbox numbers it. */
export function buildEvent(facts: EventFacts, kinds: Kinds): EventDraft {
  const { type, tenant, resource, kind, data, correlation } = facts;
  // Step 14's masking, with the events' clearance: a field above it is left out, and the label is
  //   the highest of the fields left.
  const shown = show(data, kind, kinds, EVENT_CLEARANCE);
  // Only the ids the record keeps, named one by one, so nothing else rides along (decision D6).
  const ids: EventCorrelation = { request_id: correlation.request_id, tenant_id: tenant };
  if (correlation.agent_id !== undefined) ids.agent_id = correlation.agent_id;
  if (correlation.principal_id !== undefined) ids.principal_id = correlation.principal_id;
  return {
    event_id: `evt_${randomUUID()}`,
    type,
    tenant,
    resource,
    origin: "dsor",
    // DSoR's clock, when the event is written, inside the change's transaction (decision D3).
    at: new Date().toISOString(),
    classification: shown.classification,
    data: shown.data,
    correlation: ids,
  };
}

// The specification's schemas, copied byte for byte (step 03's README, decision 3), with the
// options of bundle.ts: name every problem, and never change what is checked.
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
  validateFormats: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
const passesSchema = ajv.compile(loadSchema("event.schema.json"));

/** Every way the event fails event.schema.json, in words. None when it passes (DSOR-EVT-01b). */
export function eventProblems(event: unknown): string[] {
  if (passesSchema(event)) return [];
  return (passesSchema.errors ?? []).map(
    (error) => `${error.instancePath || "the event"} ${error.message ?? "is not valid"}`,
  );
}

/** Writes events of one call: its company, its ids, and the classifications are DSoR's. */
export type EventWriter = {
  write: (type: EventType, resource: string, kind: string, data: unknown) => Promise<DomainEvent>;
};

/** The writer for one call, into the outbox of the call's own transaction (decision D1). */
export function eventWriter(
  outbox: OutboxWriter,
  tenant: string,
  correlation: Correlation,
  kinds: Kinds,
): EventWriter {
  return {
    write: (type, resource, kind, data) =>
      outbox.add(tenant, buildEvent({ type, tenant, resource, kind, data, correlation }, kinds)),
  };
}

/** The writer of a call that writes no event: the expiry sweep's, run by a test outside a claim. */
export const NO_EVENTS: EventWriter = Object.freeze({
  write: async (): Promise<never> => {
    throw new Error("this work writes no event");
  },
});

/** A change the company's code made to a payment through DSoR's store, as the store answered it. */
export type PaymentChange = { change: "drafted" | "paid"; id: string; version: number };

/**
 * The company's payments, noting each draft written and each payment marked paid, as the store
 * answers them. An event is of a change noted here, never of what the code returns (decision D1;
 * found by step 40's review, H1).
 */
export function noting(payments: PaymentStore, changes: PaymentChange[]): PaymentStore {
  return Object.freeze({
    ...payments,
    create: async (tenant: string, draft: Draft, invoiceVersion: number): Promise<Drafted> => {
      const drafted = await payments.create(tenant, draft, invoiceVersion);
      if ("payment" in drafted) {
        const { id, version } = drafted.payment;
        changes.push({ change: "drafted", id, version });
      }
      return drafted;
    },
    pay: async (tenant: string, id: string, version: number): Promise<Cancelled> => {
      const paid = await payments.pay(tenant, id, version);
      if (paid.changed && paid.payment !== undefined) {
        changes.push({ change: "paid", id: paid.payment.id, version: paid.payment.version });
      }
      return paid;
    },
  });
}

// The one change each operation's code makes to a payment, its event, and the state the payment
//   is in after it.
const AFTER_CODE: Readonly<
  Record<string, { change: PaymentChange["change"]; type: EventType; status: PaymentStatus }>
> = {
  "payment.create": { change: "drafted", type: "payment.created", status: "draft" },
  "payment.execute": { change: "paid", type: "payment.executed", status: "paid" },
};

/**
 * The event of what the company's code changed, written as soon as the code returns, with the work
 * and before the record is sealed. DSoR never takes the code's word: the payment is the one the
 * store noted the code changing, read again from that store, and the code made exactly the one
 * change its operation names. For payment.execute, that is the payment the validated request names,
 * or the request the proposal stored. Anything else is an accident, and the work is not kept
 * (decision D1; found by step 40's review, H1 and M1).
 */
export async function eventsOfCode(
  operation: string,
  input: unknown,
  changes: readonly PaymentChange[],
  tenant: string,
  payments: PaymentStore,
  events: EventWriter,
): Promise<void> {
  const after = AFTER_CODE[operation];
  // An operation with no event drafts and pays nothing: a change with no event is never kept.
  if (after === undefined) {
    if (changes.length > 0) throw new Error(`${operation} changed a payment, and has no event`);
    return;
  }
  const [change, ...more] = changes;
  if (change === undefined || more.length > 0 || change.change !== after.change) {
    const made = changes.map((c) => `${c.change} ${c.id}`).join(", ") || "nothing";
    throw new Error(`${operation}'s code must make one change, ${after.change}; it made ${made}`);
  }
  if (operation === "payment.execute") {
    const named = parseUri((input as { payment: string }).payment).id;
    if (change.id !== named) {
      throw new Error(`payment.execute was asked to pay ${named}, and its code paid ${change.id}`);
    }
  }
  const payment = await payments.get(tenant, change.id);
  if (payment?.status !== after.status || payment.version !== change.version) {
    throw new Error(`payment ${change.id} changed again after its code ${after.change} it`);
  }
  const resource = formatUri({ tenant_id: tenant, entity: "payment", id: payment.id });
  await events.write(after.type, resource, "Payment", payment);
}
