// STEP 22, decision 157: every move and its record, in a crowd, on a real server.
//
// PGlite runs one statement at a time, so a request that loses its place in the log waits, and then
// goes next, whatever its pause. A real PostgreSQL lets twenty requests read the same end of the log
// together, and all but one of them lose the place. Tried again at once, they read the same new end
// together, and lose again. This is the tier that can see the pause has to be random.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like pool.db.test.ts.
// Decision 157, found by a review: and how many of the twenty are carried out is asked only of a
// server on this machine. Why is beside that test, at the end.
//
// Rule DSOR-AUD-01: every command decision, every proposal transition, and every read covered by
// DSOR-CLS-05 MUST produce a durable audit record that validates against audit-record.schema.json.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theHead, theLog, verifyChain } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import type { OperationAnswer } from "../src/operations.ts";
import { useDatabase } from "../src/store.ts";
import { callOperation } from "./support/door.ts";
import { storyStatements } from "./support/story.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

/**
 * Decision 157, found by a review: is the application's server on this machine? Its address says so:
 * 127.0.0.1, localhost or ::1. A connection string that cannot be read as an address is taken as
 * one far away.
 */
function onThisMachine(url: string | undefined): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url ?? "").hostname.toLowerCase());
  } catch {
    return false;
  }
}

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const A_SMALL_PAYMENT = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "100.00", currency: "USD" },
};

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  // Twenty connections, so twenty requests really are at the database at once.
  application = new Pool({ connectionString: APPLICATION, max: 20 });
  useDatabase(overPool(application));
});

beforeEach(async () => {
  if (!haveAServer) {
    return;
  }

  // As the story starts, with org_456's log empty: the moves first, which empties the proposals
  // too, then the log, whose records the moves named.
  for (const statement of storyStatements()) {
    await owner.query(statement);
  }

  await owner.query("DELETE FROM dsor.audit WHERE tenant = 'org_456'");
});

afterAll(async () => {
  await application?.end();
  await owner?.end();
});

/** Twenty payments by the agent, sent at once, each with a key of its own. */
const twentyAtOnce = (): Promise<OperationAnswer[]> =>
  Promise.all(
    Array.from({ length: 20 }, () => callOperation(AGENT, "payment.create", A_SMALL_PAYMENT)),
  );

describe.skipIf(!haveAServer)("twenty commands at once, on a real pool", () => {
  it("DSOR-AUD-01: twenty commands at once on a real server: every move has its record, saying the state it entered, every record of a move has its move, and every refusal leaves its proposal DENIED or made none", async () => {
    // Decision 157, found by a review: two minutes for this test, not the tier's thirty seconds.
    // With up to 100 ms on each round trip, twenty at once took 22 to 25 seconds, and with up to
    // 200 ms, 43 to 57, measured. A test that runs out of time fails, whatever the server did.
    const answers = await twentyAtOnce();

    // As the owner, the company's moves beside the records they name, and the records of moves
    // that no move names.
    const { rows: pairs } = await owner.query<{
      proposal: string;
      to_state: string;
      result: string;
      kind: string;
      resources: readonly string[] | null;
      request: string;
    }>(
      `SELECT m.proposal, m.to_state, a.result, a.kind, a.resources,
              a.correlation ->> 'request_id' AS request
         FROM dsor.proposal_moves m JOIN dsor.audit a ON a.record_id = m.record
        WHERE m.tenant = 'org_456'`,
    );
    const { rows: unnamed } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dsor.audit a
        WHERE a.tenant = 'org_456' AND a.kind = 'proposal_transition'
          AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves m WHERE m.record = a.record_id)`,
    );
    const { rows: moves } = await owner.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM dsor.proposal_moves WHERE tenant = 'org_456'",
    );

    // Every move has its record: the join lost none of them.
    expect(pairs).toHaveLength(moves[0]?.n ?? -1);
    expect(pairs.every((p) => p.kind === "proposal_transition" && p.result === p.to_state)).toBe(
      true,
    );
    // And every record of a move has its move.
    expect(unnamed[0]?.n).toBe(0);
    expect(verifyChain(await theLog("org_456"), await theHead("org_456"))).toBe(true);

    // Found by a review: the foreign key says only that a move's record exists, so a move given
    // another request's record passed every check above. Each record names its move's proposal, all
    // but the creation's, which cannot, and the records of one proposal's moves are one request's.
    for (const pair of pairs) {
      expect(pair.resources).toStrictEqual(
        pair.to_state === "PROPOSED" ? null : [`dsor://org_456/proposal/${pair.proposal}`],
      );
    }

    const requestsOf = new Map<string, Set<string>>();

    for (const pair of pairs) {
      requestsOf.set(pair.proposal, (requestsOf.get(pair.proposal) ?? new Set()).add(pair.request));
    }

    expect([...requestsOf.values()].every((requests) => requests.size === 1)).toBe(true);

    // Decision 157, found by a review: and every command refused in the crowd was refused before it
    // ran: its proposal is DENIED, or it made none. On this machine most runs refuse none. With a
    // slow link several are refused, each because it lost ten places in a row, and in every run
    // measured, up to 200 ms on each round trip, each of them was DENIED or had made none.
    const { rows: made } = await owner.query<{ request: string; state: string }>(
      `SELECT a.correlation ->> 'request_id' AS request,
              (SELECT n.to_state FROM dsor.proposal_moves n
                WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                  AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves x
                                   WHERE x.tenant = n.tenant AND x.proposal = n.proposal
                                     AND x.from_state = n.to_state)) AS state
         FROM dsor.proposal_moves m JOIN dsor.audit a ON a.record_id = m.record
        WHERE m.tenant = 'org_456' AND m.from_state IS NULL`,
    );
    // Each request's proposal, by the request named in the record of its first move.
    const whereItIs = new Map(made.map((row) => [row.request, row.state]));

    for (const answer of answers) {
      if (answer.kind === "error") {
        expect(["DENIED", undefined]).toContain(
          whereItIs.get(answer.envelope.correlation.request_id),
        );
      }
    }
  }, 120_000);

  // Decision 157, found by a review: asked only of a server on this machine. How many are carried
  // out depends on how long each statement holds its place at the end of the log, and across a
  // network that is several round trips: more requests read the same end together, and more of them
  // lose ten places in a row. Measured on PostgreSQL 17 with a pool of twenty: on this machine, 20 of
  // 20 every run. With a pause of up to 30 ms before and after each statement, 12 to 15. With up to
  // 10 ms on each round trip inside a statement's transaction, as a server far away adds them, 8 to
  // 11, and with up to 100 ms, 4 to 8. On Neon the bar would fail with nothing wrong, so it is
  // skipped there, and the report says so. The test above holds on every server.
  it.skipIf(!onThisMachine(APPLICATION))(
    "DSOR-AUD-01: most of twenty commands at once are carried out on a server on this machine, because a lost place is tried again after a random pause",
    async () => {
      // On this machine: 20 of 20, every run. With no pause, 4 of 20; with one try, none.
      const answers = await twentyAtOnce();

      expect(answers.filter((a) => a.kind === "result").length).toBeGreaterThanOrEqual(15);
    },
  );
});
