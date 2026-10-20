// NEW IN STEP 40: events (red: not built yet).
import type { Correlation } from "./envelope.ts";
import type { Kinds, Label } from "./labels.ts";

/** The events this step writes. */
export type EventType = "payment.created" | "payment.executed" | "proposal.approved";

/** An event's correlation: the call's ids and the company's. */
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

/** An event before the outbox numbers it. */
export type EventDraft = Omit<DomainEvent, "ordering_key">;

/** What an event is built from. */
export type EventFacts = {
  type: EventType;
  tenant: string;
  resource: string;
  kind: string;
  data: unknown;
  correlation: Correlation;
};

export function buildEvent(_facts: EventFacts, _kinds: Kinds): EventDraft {
  throw new Error("not built yet: step 40");
}

export function eventProblems(_event: unknown): string[] {
  throw new Error("not built yet: step 40");
}
