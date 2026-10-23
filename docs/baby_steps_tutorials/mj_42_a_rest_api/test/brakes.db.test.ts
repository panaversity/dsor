// The emergency brake, on the database (DSOR-OPS-01a to DSOR-OPS-01d). A brake
// is a row of dsor.brakes, and its pull and its lift each leave one record in the same
// transaction. The race is the reason for this file: a draft on its way while the brake is
// pulled must finish before the brake takes effect, or be refused after it. A real PostgreSQL,
// never a mock (step 25b's README, claims C1 to C5, C7, C8, and C10).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { logins, type Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerBrakes,
  ownerInvoices,
  ownerLimits,
  tryThenRollBack,
} from "./db.ts";
import { ADMIN, FIRM_IN_456, FIRM_IN_789, keyed, storyDirectories, SUPERVISOR } from "./helpers.ts";

const observer = newPool();
const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);

// intake-fte works under del_190, which user_123 signed, and which the owner adds fresh before
// each test, with step 24's limits (test/owner-limits.ts). It is in DSoR's table of logins for
// the whole file, because a pull looks its target up there, and the target's own calls run
// between the pull and the lift.
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
// With the clearance of the story's own agents, so its read shows the invoice's id.
const intake = {
  id: "intake-fte",
  type: "agent",
  clearance: "internal",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
const INTAKE_URI = "dsor://org_456/agent/intake-fte";
const COMPANY_URI = "dsor://org_456/tenant/org_456";
const WHY = "intake-fte drafts one payment after another";
const table = logins as Map<string, Principal>;

beforeAll(() => {
  ownerInvoices("add");
  ownerInvoices("credit", "31400.00");
  table.set("tok_intake", intake);
});
afterAll(async () => {
  table.delete("tok_intake");
  ownerBrakes("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await observer.end();
  await pool.end();
});
// Each test starts with no brake on, del_190 active, and the whole day's room. Only the owner
// removes a brake: dsor_runtime may only lift one, and the lift stays in the history.
beforeEach(() => {
  ownerBrakes("clear");
  ownerLimits("add");
});

/** One statement as dsor_runtime inside a company, rolled back after, and its rows. */
async function rowsOf(
  sql: string,
  values: unknown[] = [],
  tenant = "org_456",
): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(observer, sql, tenant, values)).rows;
}

/** An invoice's version now, in its company. */
async function versionOf(id: string, tenant = "org_456"): Promise<number> {
  const rows = await rowsOf("SELECT version FROM app.invoices WHERE id = $1", [id], tenant);
  return Number(rows[0]?.["version"]);
}

/** intake-fte drafts a payment for INV-9001, with a fresh key, in the mode given. */
async function draft(
  envelope: RequestEnvelope = keyed(INTAKE),
  on = registry,
  // And the lines the call runs, as each one starts.
  observe?: (line: number) => void,
): Promise<Answer> {
  const input = {
    invoice: "dsor://org_456/invoice/INV-9001",
    expected_version: await versionOf("INV-9001"),
  };
  return call(on, log, envelope, "payment.create", input, observe);
}

/** A person pulls the brake on a target, with a fresh key. */
function pull(
  envelope: RequestEnvelope = keyed(SUPERVISOR),
  on = registry,
  target = INTAKE_URI,
): Promise<Answer> {
  return call(on, log, envelope, "control.suspend", { target, reason: WHY });
}

/** A person lifts the brake on a target, with a fresh key. */
function lift(envelope: RequestEnvelope = keyed(SUPERVISOR), target = INTAKE_URI) {
  const reason = "the invoice was at fault, not the agent";
  return call(registry, log, envelope, "control.lift", { target, reason });
}

const word = (answer: Answer): string =>
  "code" in answer ? answer.code : "outcome" in answer ? answer.outcome : "data";
const idOf = (answer: Answer): string =>
  String("proposal" in answer ? answer.proposal : "").slice("dsor://org_456/proposal/".length);

/** The one refusal of a command from a braked agent. */
const braked = (agent: string, tenant = "org_456"): string =>
  `${agent} may make no change in ${tenant}: an emergency brake is on`;

/**
 * Waits until a call in this database waits for the brake's lock. pg_locks lists every lock of
 * the server, so only this database's are counted: another database's tests hold locks too.
 */
async function aCallWaitsForTheBrake(): Promise<void> {
  // Ten seconds: under load, a call takes a moment to reach its lock.
  for (let tries = 0; tries < 400; tries++) {
    const { rows } = await observer.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no call waited for the brake's lock within 10 seconds");
}

describe("pulling and lifting the brake, on the database", () => {
  it("DSOR-OPS-01a: on the database, user_123 suspends intake-fte: each command from it, in every mode, hears AGENT_SUSPENDED, and its read answers", async () => {
    expect(await pull()).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", target: INTAKE_URI, status: "on" },
    });
    for (const envelope of [
      keyed(INTAKE),
      { ...keyed(INTAKE), mode: "propose_only" },
      { ...INTAKE, mode: "validate_only" },
    ]) {
      expect(await draft(envelope)).toMatchObject({
        code: "AGENT_SUSPENDED",
        message: braked("intake-fte"),
        retry: "never",
      });
    }
    const read = await call(registry, log, INTAKE, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9001",
    });
    expect(read).toMatchObject({ data: { id: "INV-9001" } });
  });

  it("DSOR-OPS-01b: on the database, the brake reaches the next draft, and so does its lift", async () => {
    expect(word(await draft())).toBe("COMMITTED");
    expect(word(await pull())).toBe("COMMITTED");
    expect(word(await draft())).toBe("AGENT_SUSPENDED");
    expect(await lift()).toMatchObject({ outcome: "COMMITTED", data: { status: "lifted" } });
    expect(word(await draft())).toBe("COMMITTED");
  });

  it("DSOR-OPS-01a: on the database, a freeze of org_456 stops intake-fte and firm-ap-fte in org_456, and not firm-ap-fte in org_789", async () => {
    expect(word(await pull(keyed(ADMIN), registry, COMPANY_URI))).toBe("COMMITTED");
    expect(await draft({ ...INTAKE, mode: "validate_only" })).toMatchObject({
      code: "AGENT_SUSPENDED",
    });
    const ours = { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 };
    const firm456 = await call(
      registry,
      log,
      { ...FIRM_IN_456, mode: "validate_only" },
      "payment.create",
      ours,
    );
    expect(firm456).toMatchObject({ code: "AGENT_SUSPENDED", message: braked("firm-ap-fte") });
    const theirs = {
      invoice: "dsor://org_789/invoice/INV-2001",
      expected_version: await versionOf("INV-2001", "org_789"),
    };
    const firm789 = await call(
      registry,
      log,
      { ...FIRM_IN_789, mode: "validate_only" },
      "payment.create",
      theirs,
    );
    expect(word(firm789)).toBe("VALIDATED");
  });

  it("DSOR-OPS-01d: on the database, the braked agent cannot lift its own brake, and another agent cannot lift it: line ④ and line ⑤ refuse them", async () => {
    expect(word(await pull())).toBe("COMMITTED");
    expect(await lift(keyed(INTAKE))).toMatchObject({
      code: "AGENT_SUSPENDED",
      message: braked("intake-fte"),
    });
    expect(await lift(keyed(FIRM_IN_456))).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.lift" is for people only, and firm-ap-fte is not a person',
    });
    expect(await draft({ ...INTAKE, mode: "validate_only" })).toMatchObject({
      code: "AGENT_SUSPENDED",
    });
  });

  it("DSOR-AUD-01: on the database, a pull and a lift each leave one operational_control record, with the person, their words, the call, and the target", async () => {
    const pulled = await pull();
    const lifted = await lift(keyed(ADMIN));
    const rows = await rowsOf(
      `SELECT result, reason, resources, identity->>'subject' AS person,
              correlation->>'request_id' AS request_id
         FROM dsor.audit
        WHERE kind = 'operational_control' AND correlation->>'request_id' = ANY($1)
        ORDER BY sequence`,
      [[pulled.correlation.request_id, lifted.correlation.request_id]],
    );
    expect(rows).toStrictEqual([
      {
        result: "suspended",
        reason: WHY,
        resources: [INTAKE_URI],
        person: "user_123",
        request_id: pulled.correlation.request_id,
      },
      {
        result: "lifted",
        reason: "the invoice was at fault, not the agent",
        resources: [INTAKE_URI],
        person: "admin_100",
        request_id: lifted.correlation.request_id,
      },
    ]);
  });

  it("Step 25b: on the database, two pulls of one brake at once leave one brake on: one COMMITTED, one CONFLICT (step 25b's README, decision L9)", async () => {
    const answers = await Promise.all([pull(keyed(SUPERVISOR)), pull(keyed(ADMIN))]);
    expect(answers.map(word).sort()).toStrictEqual(["COMMITTED", "CONFLICT"]);
    const rows = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.brakes WHERE agent = 'intake-fte' AND lifted_at IS NULL",
    );
    expect(rows).toStrictEqual([{ n: 1 }]);
  });
});

describe("the race: a draft on its way while the brake is pulled", () => {
  // The draft takes the brake's lock, shared, right after line ⑧. Then it waits at line ⑩, on
  // the day's total, which another transaction holds. A pull must wait for it.
  it("DSOR-OPS-01c: on the database, a draft already inside its transaction when the brake is pulled finishes first: the pull waits for it, and the next draft is refused", async () => {
    expect(word(await draft())).toBe("COMMITTED");
    const holder = await observer.connect();
    let committed = false;
    // The calls this test starts, which must end before it does.
    const inFlight: Promise<unknown>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await holder.query(
        "SELECT used FROM dsor.limit_counters WHERE delegation = 'del_190' FOR UPDATE",
      );
      let reached = (): void => {};
      const atLineTen = new Promise<void>((resolve) => (reached = resolve));
      const pending = draft(keyed(INTAKE), registry, (line) => {
        if (line === 10) reached();
      });
      inFlight.push(pending);
      await atLineTen;
      let answered = false;
      const pulling = pull().then((answer) => {
        answered = true;
        return answer;
      });
      inFlight.push(pulling);
      await aCallWaitsForTheBrake();
      // The draft is on its way, so the brake has not taken effect.
      expect(answered).toBe(false);
      // The database's clock, just before the draft may go on.
      const { rows } = await holder.query<{ at: Date }>("SELECT clock_timestamp() AS at");
      await holder.query("COMMIT");
      committed = true;
      expect(word(await pending)).toBe("COMMITTED");
      expect(word(await pulling)).toBe("COMMITTED");
      // The brake's time is when it was written, after the wait, not when its pull began
      // (step 25b's README, decision D11).
      const brake = await rowsOf("SELECT pulled_at > $1 AS later FROM dsor.brakes", [rows[0]!.at]);
      expect(brake).toStrictEqual([{ later: true }]);
    } finally {
      // A test that fails before the COMMIT lets the draft go too, so the file does not wait for
      // ever. Found by step 25b's sweep.
      if (!committed) await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      // And the calls end before the next test begins. Its owner script blocks this process, so
      // a draft still on its way would hold its lock, and the script would wait for it for ever.
      // Found by step 25b's sweep.
      await Promise.allSettled(inFlight);
    }
    expect(await draft()).toMatchObject({ code: "AGENT_SUSPENDED" });
  });

  // The pull has written the brake, and its transaction is still open. A draft passes line ④,
  // which cannot see a brake that is not committed. Inside its claim it waits for the pull.
  it("DSOR-OPS-01c: on the database, a draft that comes while the brake is being pulled waits for it, then hears AGENT_SUSPENDED, and its proposal ends DENIED, never EXECUTING", async () => {
    const shipped = ownWorkFor();
    const suspend = shipped["control.suspend"]!;
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let written = (): void => {};
    const inside = new Promise<void>((resolve) => (written = resolve));
    const gated = dbRegistry(pool, storyDirectories(), handlersFor(), {
      ...shipped,
      "control.suspend": {
        check: suspend.check,
        change: async (input, work) => {
          const done = await suspend.change(input, work);
          written();
          await gate;
          return done;
        },
      },
    });
    const pulling = pull(keyed(SUPERVISOR), gated);
    await inside;
    const lines: number[] = [];
    const pending = draft(keyed(INTAKE), registry, (line) => lines.push(line));
    try {
      await aCallWaitsForTheBrake();
    } finally {
      // The pull goes on whatever happens, and both calls end before this test does, so a test
      // that fails here holds no transaction open. Found by step 25b's sweep.
      open();
      await Promise.allSettled([pulling, pending]);
    }
    expect(word(await pulling)).toBe("COMMITTED");
    const answer = await pending;
    expect(answer).toMatchObject({ code: "AGENT_SUSPENDED", message: braked("intake-fte") });
    // Line ④ let it through, and the check after line ⑧ refused it.
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 11]);
    // Its moves, each with its record: PROPOSED, then DENIED. Never READY, never EXECUTING.
    const moves = await rowsOf(
      `SELECT result FROM dsor.audit
        WHERE kind = 'proposal_transition' AND resources[1] = $1 ORDER BY sequence`,
      [`dsor://org_456/proposal/${idOf(answer)}`],
    );
    expect(moves).toStrictEqual([{ result: "PROPOSED" }, { result: "DENIED" }]);
    const state = await rowsOf("SELECT state FROM dsor.proposals WHERE id = $1", [idOf(answer)]);
    expect(state).toStrictEqual([{ state: "DENIED" }]);
    const record = await rowsOf(
      `SELECT "authorization", result FROM dsor.audit
        WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
      [answer.correlation.request_id],
    );
    expect(record).toStrictEqual([{ authorization: "DENY", result: "AGENT_SUSPENDED" }]);
  });
});

describe("from step 25b's sweep, on the database", () => {
  // K13: with the pull's ON CONFLICT gone, every test stayed green. The second pull of "two at
  // once" always came after the first had committed, so line ⑨ refused it, and its INSERT never
  // ran. Here the first pull waits after its INSERT, so the second passes line ⑨, which cannot
  // see a brake that is not committed, and waits for the lock.
  it("Step 25b: on the database, a pull that passed line ⑨ while another pull was under way hears CONFLICT from its own statement, and one brake is on (step 25b's README, decision L9)", async () => {
    const shipped = ownWorkFor();
    const suspend = shipped["control.suspend"]!;
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let written = (): void => {};
    const inside = new Promise<void>((resolve) => (written = resolve));
    const gated = dbRegistry(pool, storyDirectories(), handlersFor(), {
      ...shipped,
      "control.suspend": {
        check: suspend.check,
        change: async (input, work) => {
          const done = await suspend.change(input, work);
          written();
          await gate;
          return done;
        },
      },
    });
    const first = pull(keyed(SUPERVISOR), gated);
    await inside;
    const second = pull(keyed(ADMIN));
    try {
      await aCallWaitsForTheBrake();
    } finally {
      open();
      await Promise.allSettled([first, second]);
    }
    expect(word(await first)).toBe("COMMITTED");
    expect(await second).toMatchObject({
      code: "CONFLICT",
      message: "the brake on intake-fte is on already",
    });
    const rows = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.brakes WHERE agent = 'intake-fte' AND lifted_at IS NULL",
    );
    expect(rows).toStrictEqual([{ n: 1 }]);
  });
});

describe("the database's own rules for brakes", () => {
  it("Step 25b: dsor_runtime cannot delete a brake, or change who pulled it, when, or why", async () => {
    expect(word(await pull())).toBe("COMMITTED");
    for (const sql of [
      "DELETE FROM dsor.brakes",
      "UPDATE dsor.brakes SET pulled_by = 'someone-else'",
      "UPDATE dsor.brakes SET pulled_at = now() - interval '1 day'",
      "UPDATE dsor.brakes SET reason = 'another reason'",
      "UPDATE dsor.brakes SET agent = 'firm-ap-fte'",
    ]) {
      await expect(tryThenRollBack(observer, sql, "org_456"), sql).rejects.toMatchObject(
        NO_PRIVILEGE,
      );
    }
  });

  it("Step 25b: dsor_runtime lifts a brake once, wholly, and never puts it back on", async () => {
    expect(word(await pull())).toBe("COMMITTED");
    expect(word(await lift())).toBe("COMMITTED");
    // A lifted brake is lifted again by nobody: the policy reaches only a brake that is on.
    const again = await tryThenRollBack(
      observer,
      `UPDATE dsor.brakes SET lifted_by = 'x', lifted_at = now(), lift_reason = 'y'
        WHERE agent = 'intake-fte'`,
      "org_456",
    );
    expect(again.rowCount).toBe(0);
    // A lift is whole: who, when, and why, or none of them. This one passes the policy, and
    // leaves out the why.
    expect(word(await pull())).toBe("COMMITTED");
    await expect(
      tryThenRollBack(
        observer,
        `UPDATE dsor.brakes SET lifted_by = 'x', lifted_at = now()
          WHERE agent = 'intake-fte' AND lifted_at IS NULL`,
        "org_456",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // And a brake that is on stays on, unless it is lifted.
    await expect(
      tryThenRollBack(
        observer,
        `UPDATE dsor.brakes SET lifted_at = NULL WHERE agent = 'intake-fte' AND lifted_at IS NULL`,
        "org_456",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("Step 25b: dsor_runtime adds a brake only as one that is on, through named columns", async () => {
    const id = `brk_${randomUUID()}`;
    await expect(
      tryThenRollBack(
        observer,
        `INSERT INTO dsor.brakes (tenant_id, id, agent, pulled_by, reason, lifted_by, lifted_at,
                                  lift_reason)
         VALUES ('org_456', $1, 'intake-fte', 'user_123', 'r', 'user_123', now(), 'r')`,
        "org_456",
        [id],
      ),
    ).rejects.toMatchObject(NO_PRIVILEGE);
    const added = await tryThenRollBack(
      observer,
      `INSERT INTO dsor.brakes (tenant_id, id, agent, pulled_by, reason)
       VALUES ('org_456', $1, 'intake-fte', 'user_123', 'r')`,
      "org_456",
      [id],
    );
    expect(added.rowCount).toBe(1);
  });

  it("DSOR-TEN-01b: on the database, inside org_789 no brake of org_456 is seen, or lifted", async () => {
    expect(word(await pull())).toBe("COMMITTED");
    expect(await rowsOf("SELECT count(*)::int AS n FROM dsor.brakes", [], "org_789")).toStrictEqual(
      [{ n: 0 }],
    );
    const lifted = await tryThenRollBack(
      observer,
      `UPDATE dsor.brakes SET lifted_by = 'x', lifted_at = now(), lift_reason = 'y'`,
      "org_789",
    );
    expect(lifted.rowCount).toBe(0);
  });

  // The owner, whom no policy stops, runs DSoR's own statements for org_456 beside a brake on
  // intake-fte in org_789 and a freeze of org_789, so only DSoR's own WHERE is left.
  it("DSOR-TEN-01b: DSoR's own WHERE alone keeps the brakes' statements inside the company", async () => {
    expect(ownerBrakes("filters", `req_${randomUUID()}`)).toStrictEqual({
      on: false,
      found: null,
      lifted: false,
      twins: ["on", "on"],
      // And org_456's old brake, lifted long ago, is not lifted again.
      old: "lifted: lifted long ago",
    });
  });
});

/** A registry whose pull writes its brake, then waits at a gate, with its transaction open. */
function gatedPull(): {
  gated: ReturnType<typeof dbRegistry>;
  open: () => void;
  inside: Promise<void>;
} {
  const shipped = ownWorkFor();
  const suspend = shipped["control.suspend"]!;
  let open = (): void => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  let written = (): void => {};
  const inside = new Promise<void>((resolve) => (written = resolve));
  const gated = dbRegistry(pool, storyDirectories(), handlersFor(), {
    ...shipped,
    "control.suspend": {
      check: suspend.check,
      change: async (input, work) => {
        const done = await suspend.change(input, work);
        written();
        await gate;
        return done;
      },
    },
  });
  return { gated, open, inside };
}

describe("from step 25b's review, on the database", () => {
  // M2: the race tests braked one agent only. With the company's number left out of the lock, or
  // out of the check's own read, every test stayed green, and a freeze slipped past a draft.
  it("DSOR-OPS-01c: on the database, a freeze pulled while a draft is inside its transaction waits for the draft", async () => {
    expect(word(await draft())).toBe("COMMITTED");
    const holder = await observer.connect();
    let committed = false;
    const inFlight: Promise<unknown>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await holder.query(
        "SELECT used FROM dsor.limit_counters WHERE delegation = 'del_190' FOR UPDATE",
      );
      let reached = (): void => {};
      const atLineTen = new Promise<void>((resolve) => (reached = resolve));
      const pending = draft(keyed(INTAKE), registry, (line) => {
        if (line === 10) reached();
      });
      inFlight.push(pending);
      await atLineTen;
      let answered = false;
      const freezing = pull(keyed(ADMIN), registry, COMPANY_URI).then((answer) => {
        answered = true;
        return answer;
      });
      inFlight.push(freezing);
      await aCallWaitsForTheBrake();
      expect(answered).toBe(false);
      await holder.query("COMMIT");
      committed = true;
      expect(word(await pending)).toBe("COMMITTED");
      expect(word(await freezing)).toBe("COMMITTED");
    } finally {
      if (!committed) await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      await Promise.allSettled(inFlight);
    }
    expect(await draft()).toMatchObject({ code: "AGENT_SUSPENDED" });
  });

  it("DSOR-OPS-01c: on the database, a draft that comes while a freeze is being pulled waits for it, then hears AGENT_SUSPENDED, its proposal DENIED", async () => {
    const { gated, open, inside } = gatedPull();
    const freezing = pull(keyed(ADMIN), gated, COMPANY_URI);
    await inside;
    const lines: number[] = [];
    const pending = draft(keyed(INTAKE), registry, (line) => lines.push(line));
    try {
      await aCallWaitsForTheBrake();
    } finally {
      open();
      await Promise.allSettled([freezing, pending]);
    }
    expect(word(await freezing)).toBe("COMMITTED");
    const answer = await pending;
    expect(answer).toMatchObject({ code: "AGENT_SUSPENDED", message: braked("intake-fte") });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 11]);
    const state = await rowsOf("SELECT state FROM dsor.proposals WHERE id = $1", [idOf(answer)]);
    expect(state).toStrictEqual([{ state: "DENIED" }]);
  });

  // M3: with get comparing the agent by =, a freeze could never be lifted on the database.
  it("DSOR-OPS-01b: on the database, a freeze is lifted, the agent's next draft is made, and a second freeze while one is on is refused at line ⑨", async () => {
    expect(word(await pull(keyed(ADMIN), registry, COMPANY_URI))).toBe("COMMITTED");
    expect(word(await draft())).toBe("AGENT_SUSPENDED");
    expect(await lift(keyed(SUPERVISOR), COMPANY_URI)).toMatchObject({
      outcome: "COMMITTED",
      data: { target: COMPANY_URI, status: "lifted" },
    });
    expect(word(await draft())).toBe("COMMITTED");
    expect(word(await pull(keyed(ADMIN), registry, COMPANY_URI))).toBe("COMMITTED");
    const again = await pull(keyed(SUPERVISOR), registry, COMPANY_URI);
    expect(again).toMatchObject({
      code: "CONFLICT",
      message: "the brake on every agent of org_456 is on already",
    });
    const state = await rowsOf("SELECT state FROM dsor.proposals WHERE id = $1", [idOf(again)]);
    expect(state).toStrictEqual([{ state: "DENIED" }]);
  });

  // L1: with the check inside the claim run in execute mode only, a prepared call that raced a
  // pull left a READY proposal of a braked agent.
  it("DSOR-OPS-01a: on the database, a prepared call that comes while the brake is being pulled is refused inside the claim, and leaves no READY proposal", async () => {
    const { gated, open, inside } = gatedPull();
    const pulling = pull(keyed(SUPERVISOR), gated);
    await inside;
    const pending = draft({ ...keyed(INTAKE), mode: "propose_only" });
    try {
      await aCallWaitsForTheBrake();
    } finally {
      open();
      await Promise.allSettled([pulling, pending]);
    }
    const answer = await pending;
    expect(answer).toMatchObject({ code: "AGENT_SUSPENDED" });
    const state = await rowsOf("SELECT state FROM dsor.proposals WHERE id = $1", [idOf(answer)]);
    expect(state).toStrictEqual([{ state: "DENIED" }]);
  });

  // L2: with a dry run's line ⑨ given no brakes, a dry run of a second pull said VALIDATED.
  it("DSOR-OPR-05: on the database, a person's dry run of the brake's own commands hears the real call's answer", async () => {
    expect(word(await pull())).toBe("COMMITTED");
    const dry = { ...SUPERVISOR, mode: "validate_only" };
    const again = await call(registry, log, dry, "control.suspend", {
      target: INTAKE_URI,
      reason: "a second pull",
    });
    expect(again).toMatchObject({
      code: "CONFLICT",
      message: "the brake on intake-fte is on already",
    });
    const lifting = await call(registry, log, dry, "control.lift", {
      target: INTAKE_URI,
      reason: "would it lift?",
    });
    expect(word(lifting)).toBe("VALIDATED");
  });

  // L5: lifted_at is a column dsor_runtime writes, so its value is DSoR's statement's, and a
  // CHECK keeps a lift after its pull.
  it("Step 25b: dsor_runtime cannot lift a brake at a time before it was pulled", async () => {
    expect(word(await pull())).toBe("COMMITTED");
    await expect(
      tryThenRollBack(
        observer,
        `UPDATE dsor.brakes SET lifted_by = 'x', lifted_at = '2000-01-01', lift_reason = 'y'
          WHERE agent = 'intake-fte' AND lifted_at IS NULL`,
        "org_456",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
