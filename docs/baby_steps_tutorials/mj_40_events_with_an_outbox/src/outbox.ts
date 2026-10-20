// NEW IN STEP 40: the outbox, DSoR's table of events not yet delivered (DSOR-EVT-01a in
// specs/dsor/03-execution.md, section 31). An event is written into it in the same transaction as
// the change it reports, so the two commit together or not at all. A sender reads it later and
// delivers each company's events to that company's channel, at least once. This file holds the
// memory outbox and its sender, and the writer a claim uses on the database; src/sender.ts holds
// the database's sender (step 40's README, decisions D1, D2, D4, D8, and D11).
import type pg from "pg";
import { eventProblems, type DomainEvent, type EventDraft } from "./events.ts";

/** One event in the outbox, and whether it was sent. */
export type OutboxRow = { event: DomainEvent; sent: boolean };

/** What one run of the sender did for one company. */
export type Sent = { sent: string[]; failed?: { event_id: string; why: string }; busy?: true };

/** Where an event is written, in the transaction of the change it reports. */
export type OutboxWriter = { add: (tenant: string, draft: EventDraft) => Promise<DomainEvent> };

/** The outbox outside a claim: its events, and the sender. */
export type Outbox = OutboxWriter & {
  events: (tenant: string) => Promise<OutboxRow[]>;
  /**
   * Delivers the company's unsent events, oldest first, at most `limit`, and marks the delivered
   * ones sent. It stops at the first delivery that fails.
   */
  send: (
    tenant: string,
    deliver: (event: DomainEvent) => Promise<void>,
    limit?: number,
  ) => Promise<Sent>;
};

/** The outbox in memory. */
export type MemoryOutbox = Outbox;

/** How many events one run of the sender takes for one company, unless it is told another. */
export const SEND_LIMIT = 100;

/**
 * The draft, numbered among its resource's events, and checked before any outbox takes it: it is
 * an event of the company whose outbox it is written in, and it validates against
 * event.schema.json. An event that fails stops its change (DSOR-EVT-01b; decision D7).
 */
export function numbered(tenant: string, draft: EventDraft, ordering_key: number): DomainEvent {
  if (draft.tenant !== tenant) {
    throw new Error(`an event of ${draft.tenant} is never written in company ${tenant}'s outbox`);
  }
  const event: DomainEvent = { ...draft, ordering_key };
  const problems = eventProblems(event);
  if (problems.length > 0) {
    throw new Error(
      `the event does not validate against event.schema.json: ${problems.join("; ")}`,
    );
  }
  return event;
}

/** The words of a failed delivery, never more than a line. */
function whyOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/**
 * The outbox in memory. Memory has no transaction: an event written by a call stays with that
 * call's draft, as the draft itself stays (decision D11).
 */
export function memoryOutbox(): MemoryOutbox {
  const rows: OutboxRow[] = [];
  // The companies a sender is working on now: one sender per company at a time (decision D8).
  const sending = new Set<string>();
  return {
    add: async (tenant, draft) => {
      const before = rows.filter(
        (row) => row.event.tenant === tenant && row.event.resource === draft.resource,
      );
      const event = numbered(tenant, draft, before.length + 1);
      rows.push({ event, sent: false });
      return event;
    },
    events: async (tenant) =>
      rows
        .filter((row) => row.event.tenant === tenant)
        .map(({ event, sent }) => ({ event: structuredClone(event), sent })),
    send: async (tenant, deliver, limit = SEND_LIMIT) => {
      if (sending.has(tenant)) return { sent: [], busy: true };
      sending.add(tenant);
      try {
        const due = rows.filter((row) => row.event.tenant === tenant && !row.sent).slice(0, limit);
        const sent: string[] = [];
        let failed: Sent["failed"];
        for (const row of due) {
          try {
            await deliver(structuredClone(row.event));
          } catch (error) {
            // A failure stops the run, so a resource's later event never passes its earlier one.
            failed = { event_id: row.event.event_id, why: whyOf(error) };
            break;
          }
          sent.push(row.event.event_id);
        }
        // Marked at the end of the run, as the database's sender marks them in its last
        //   statement before its commit: a run that dies before this marks nothing.
        for (const row of due) if (sent.includes(row.event.event_id)) row.sent = true;
        return failed === undefined ? { sent } : { sent, failed };
      } finally {
        sending.delete(tenant);
      }
    },
  };
}

/**
 * The outbox's writer inside a claim on the database: the event is numbered among its resource's
 * events while the claim's transaction holds the resource's row, and inserted through the claim's
 * own connection, so it commits with the change or not at all (DSOR-EVT-01a; decisions D1 and D4).
 */
export function outboxIn(client: pg.ClientBase): OutboxWriter {
  return {
    add: async (tenant, draft) => {
      const { rows } = await client.query<{ next: number }>(
        `SELECT coalesce(max(ordering_key), 0) + 1 AS next FROM dsor.outbox
          WHERE tenant_id = $1 AND resource = $2`,
        [tenant, draft.resource],
      );
      const event = numbered(tenant, draft, rows[0]!.next);
      await client.query(
        `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.event_id, tenant, event.type, event.resource, event.ordering_key, event],
      );
      return event;
    },
  };
}
