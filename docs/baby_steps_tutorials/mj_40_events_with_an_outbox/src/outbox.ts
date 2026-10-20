// NEW IN STEP 40: the outbox (red: not built yet).
import type { DomainEvent, EventDraft } from "./events.ts";

/** One event in the outbox, and whether it was sent. */
export type OutboxRow = { event: DomainEvent; sent: boolean };

/** What one run of the sender did for one company. */
export type Sent = { sent: string[]; failed?: { event_id: string; why: string }; busy?: true };

/** Where an event is written, in the transaction of the change it reports. */
export type OutboxWriter = { add: (tenant: string, draft: EventDraft) => Promise<DomainEvent> };

/** The outbox outside a claim: its events, and the sender. */
export type Outbox = OutboxWriter & {
  events: (tenant: string) => Promise<OutboxRow[]>;
  send: (
    tenant: string,
    deliver: (event: DomainEvent) => Promise<void>,
    limit?: number,
  ) => Promise<Sent>;
};

/** The outbox in memory. */
export type MemoryOutbox = Outbox;

export function memoryOutbox(): MemoryOutbox {
  const fail = async (): Promise<never> => {
    throw new Error("not built yet: step 40");
  };
  return { add: fail, events: fail, send: fail };
}
