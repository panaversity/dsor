// The outbox, DSoR's table of events not yet delivered (DSOR-EVT-01a in
// specs/dsor/03-execution.md, section 31). An event is written into it in the same transaction as
// the change it reports, so the two commit together or not at all. A sender reads it later and
// delivers each company's events to that company's channel, at least once. This file holds the
// memory outbox and its sender, and the writer a claim uses on the database; src/sender.ts holds
// the database's sender (step 40's README, decisions D1, D2, D4, D8, and D11).
import type pg from "pg";
import { eventProblems, type DomainEvent, type EventDraft, type EventType } from "./events.ts";

/** One event in the outbox, and whether it was sent. */
export type OutboxRow = { event: DomainEvent; sent: boolean };

// Changed in step 40c: a run's failures are a list, one for each payment it held back, with the
//   payment's address, so a person can be told which payment waits (step 40c's README, decision D1).
/** One event a run could not deliver: its id, its payment's address, and the receiver's reason. */
export type Failed = { event_id: string; resource: string; why: string };

/** What one run of the sender did for one company. */
export type Sent = { sent: string[]; failed?: Failed[]; busy?: true };

/** Where an event is written, in the transaction of the change it reports. */
export type OutboxWriter = {
  add: (tenant: string, draft: EventDraft) => Promise<DomainEvent>;
  // And whether a resource has an event of this type already, so a reconcile writes a payment's
  //   payment.executed once (found by step 40's review, L1).
  /** Whether the company's outbox holds an event of this type about this resource. */
  has: (tenant: string, type: EventType, resource: string) => Promise<boolean>;
};

/** The outbox outside a claim: its events, and the sender. */
export type Outbox = OutboxWriter & {
  events: (tenant: string) => Promise<OutboxRow[]>;
  /**
   * Delivers the company's unsent events, oldest first, at most `limit`, and marks the delivered
   * ones sent. A delivery that fails holds back the rest of its payment's events in this run, and
   * the run goes on with the other payments (step 40c's README, decision D1).
   */
  send: (
    tenant: string,
    deliver: (event: DomainEvent) => Promise<void>,
    limit?: number,
  ) => Promise<Sent>;
};

/** The outbox in memory. */
export type MemoryOutbox = Outbox;

/** The outbox of a call that changes nothing, a query or a dry run: it takes no event. */
export const NO_OUTBOX: OutboxWriter = Object.freeze({
  add: async (): Promise<never> => {
    throw new Error("this call changes nothing, so it writes no event");
  },
  has: async (): Promise<boolean> => false,
});

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
// Changed in step 40c: the reason is kept in dsor.outbox_tries and shown by pnpm send-events, so it
//   is cleaned first. Found by step 40c's review, H1 and L5: a reason with no words, a NUL byte, or
//   more than 200 bytes could not be kept and aborted the whole run, and one with a newline forged
//   a line of the script's output.
/**
 * A receiver's reason, as DSoR keeps and shows it: control characters become single spaces, no
 * reason becomes "the receiver gave no reason", and it is cut to 200 bytes, never inside a character.
 */
export function reasonOf(error: unknown): string {
  const said = (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  if (said === "") return "the receiver gave no reason";
  let cut = "";
  for (const character of said) {
    if (Buffer.byteLength(cut + character, "utf8") > 200) break;
    cut += character;
  }
  return cut;
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
    has: async (tenant, type, resource) =>
      rows.some(
        (row) =>
          row.event.tenant === tenant && row.event.type === type && row.event.resource === resource,
      ),
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
        const failed: Failed[] = [];
        // NEW IN STEP 40c: the payments held back in this run. A failure holds back the rest of its
        //   payment's events, so a payment's later event never passes its earlier one, and every
        //   other payment goes on (step 40c's README, decisions D1 and D6).
        const held = new Set<string>();
        for (const row of due) {
          if (held.has(row.event.resource)) continue;
          try {
            await deliver(structuredClone(row.event));
          } catch (error) {
            held.add(row.event.resource);
            failed.push({
              event_id: row.event.event_id,
              resource: row.event.resource,
              why: reasonOf(error),
            });
            continue;
          }
          sent.push(row.event.event_id);
        }
        // Marked at the end of the run, as the database's sender marks them in its last
        //   statement before its commit: a run that dies before this marks nothing.
        for (const row of due) if (sent.includes(row.event.event_id)) row.sent = true;
        return failed.length === 0 ? { sent } : { sent, failed };
      } finally {
        sending.delete(tenant);
      }
    },
  };
}

/**
 * The outbox's writer inside a claim on the database: the event is numbered among its resource's
 * events while the claim's transaction holds the resource's lock, and inserted through the claim's
 * own connection, so it commits with the change or not at all (DSOR-EVT-01a; decisions D1 and D4).
 */
export function outboxIn(client: pg.ClientBase): OutboxWriter {
  return {
    add: async (tenant, draft) => {
      // The resource's own lock, held to the end of the transaction, so a second event about it
      //   waits for the first to commit and then reads its number. Found by step 40's review, L2:
      //   the number came from max() + 1 with no lock of its own, so two writers could read the
      //   same highest number, and the unique key refused the second's whole change.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `dsor.outbox ${tenant} ${draft.resource}`,
      ]);
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
    has: async (tenant, type, resource) => {
      const { rows } = await client.query<{ has: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM dsor.outbox
                         WHERE tenant_id = $1 AND type = $2 AND resource = $3) AS has`,
        [tenant, type, resource],
      );
      return rows[0]?.has === true;
    },
  };
}
