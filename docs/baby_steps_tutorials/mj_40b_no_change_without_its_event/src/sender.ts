// The outbox on the database, outside any claim, and its sender (DSOR-EVT-01a and
// DSOR-EVT-01d in specs/dsor/03-execution.md, section 31). The sender works as DSoR's own login,
// one company at a time, inside one transaction for that company: it takes the company's lock for
// sending, reads its unsent events in the order they were written, delivers each, marks the
// delivered ones sent, and commits. A run that dies before its commit marks nothing, so its
// deliveries happen again: at least once (step 40's README, decisions D8 and D11; claims C6, C7).
import type pg from "pg";
import { fileChannel } from "./channels.ts";
import type { DomainEvent } from "./events.ts";
import { outboxIn, SEND_LIMIT, type Outbox, type Sent } from "./outbox.ts";
import { inCompany } from "./postgres.ts";

/** The words of a failed delivery, never more than a line. */
function whyOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** dsor.outbox, one company at a time, as dsor_runtime sees it. */
export function createDbOutbox(pool: pg.Pool): Outbox {
  return {
    // An event written outside a claim, in a transaction of its own: for a test only. The program
    //   writes each event inside its change's claim (decision D1).
    add: (tenant, draft) =>
      inCompany(pool, tenant, (client) => outboxIn(client).add(tenant, draft)),
    has: (tenant, type, resource) =>
      inCompany(pool, tenant, (client) => outboxIn(client).has(tenant, type, resource)),
    events: (tenant) =>
      inCompany(pool, tenant, async (client) => {
        const { rows } = await client.query<{ event: DomainEvent; sent: boolean }>(
          `SELECT event, sent_at IS NOT NULL AS sent FROM dsor.outbox
            WHERE tenant_id = $1 ORDER BY written`,
          [tenant],
        );
        return rows;
      }),
    send: (tenant, deliver, limit = SEND_LIMIT) =>
      inCompany(pool, tenant, async (client): Promise<Sent> => {
        // One sender per company at a time: a second finds the lock taken, and leaves the company
        //   alone, so two never deliver one company's events side by side, out of order (D8).
        const { rows: lock } = await client.query<{ got: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS got",
          [`dsor.outbox ${tenant}`],
        );
        if (lock[0]?.got !== true) return { sent: [], busy: true };
        const { rows } = await client.query<{ event_id: string; event: DomainEvent }>(
          `SELECT event_id, event FROM dsor.outbox
            WHERE tenant_id = $1 AND sent_at IS NULL ORDER BY written LIMIT $2`,
          [tenant, limit],
        );
        const sent: string[] = [];
        let failed: Sent["failed"];
        for (const { event_id, event } of rows) {
          try {
            await deliver(event);
          } catch (error) {
            // A failure stops the run, so a resource's later event never passes its earlier one.
            failed = { event_id, why: whyOf(error) };
            break;
          }
          sent.push(event_id);
        }
        // The mark, in the transaction that read them: it commits after every delivery of the run,
        //   so a run that dies before the commit delivers again next time (C7).
        if (sent.length > 0) {
          await client.query(
            "UPDATE dsor.outbox SET sent_at = now() WHERE tenant_id = $1 AND event_id = ANY($2::text[])",
            [tenant, sent],
          );
        }
        return failed === undefined ? { sent } : { sent, failed };
      }),
  };
}

/**
 * Sends each company's unsent events to its channel, one company after another, and says what each
 * did. 0 when every company sent all it took, 1 when one did not (decision D8).
 */
export async function sendEach(
  outbox: Outbox,
  channels: ReadonlyMap<string, string>,
  dir: string,
  say: (line: string) => void,
): Promise<0 | 1> {
  let failed = false;
  for (const [tenant, file] of channels) {
    let run: Sent;
    try {
      run = await outbox.send(tenant, fileChannel(dir, file));
    } catch (error) {
      // One company's failure never stops the next company's sending. Never the error itself: a
      //   connection error can repeat the login. Found by step 40's review, L5: the first company
      //   that threw ended the whole run.
      failed = true;
      const code = (error as { code?: string }).code ?? "error";
      say(`${tenant}: not sent: the outbox could not be read (${code})`);
      continue;
    }
    if (run.busy === true) {
      say(`${tenant}: another sender is at work, so this one sent nothing`);
      continue;
    }
    const n = run.sent.length;
    say(`${tenant}: sent ${n} event${n === 1 ? "" : "s"}`);
    if (run.failed !== undefined) {
      failed = true;
      say(`${tenant}: stopped at ${run.failed.event_id}: ${run.failed.why}`);
    }
  }
  return failed ? 1 : 0;
}
