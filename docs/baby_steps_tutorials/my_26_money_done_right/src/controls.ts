// STEP 25: the emergency brake, in DSoR's own store (decision 142).
//
// A suspension stops one agent in one company; a freeze stops every agent in it. Both live in
// `dsor.agent_controls`, which the agent never reads and nothing it sends can change, so stopping it
// does not depend on it agreeing to stop. Who may pull and release the brake is the commands'
// business (operations.ts); this file keeps the record.
//
// Rule DSOR-OPS-01a: DSoR MUST provide per-agent suspension and a tenant-wide agent freeze.

import { theDatabase } from "./store.ts";

/** One brake that is on. */
export interface Brake {
  readonly id: string;
  /** The agent it stops, or `undefined` for every agent in the company: a freeze. */
  readonly agent: string | undefined;
  readonly imposedBy: string;
  readonly reason: string;
}

/** What pulling the brake did. */
export type Pulled =
  | { readonly kind: "pulled"; readonly id: string }
  /** It was on already: the same brake, not a second one to lift. */
  | { readonly kind: "already" };

/** What releasing it did. */
export type Lifted = { readonly kind: "lifted"; readonly id: string } | { readonly kind: "none" };

/**
 * Pull the brake on one agent, or, with no agent, on every agent in the company.
 *
 * One INSERT, and the partial unique index of migration 024 decides: of two people pulling the same
 * brake at once, one record is written, and the other is told it is on already.
 */
export async function pullTheBrake(
  tenant: string,
  agent: string | undefined,
  by: string,
  reason: string,
): Promise<Pulled> {
  const { rows } = await theDatabase(tenant).query<{ id: string }>(
    `INSERT INTO dsor.agent_controls (tenant, agent, imposed_by, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant, (COALESCE(agent, '*'))) WHERE lifted_at IS NULL DO NOTHING
     RETURNING id`,
    [tenant, agent ?? null, by, reason],
  );
  const id = rows[0]?.id;

  return Object.freeze(id === undefined ? { kind: "already" } : { kind: "pulled", id });
}

/**
 * Release the brake on one agent, or the company's freeze. Who may is not this file's to say; that
 * only a human holding `control:suspend` may is the command's (DSOR-OPS-01d).
 */
export async function liftTheBrake(
  tenant: string,
  agent: string | undefined,
  by: string,
): Promise<Lifted> {
  const { rows } = await theDatabase(tenant).query<{ id: string }>(
    `UPDATE dsor.agent_controls SET lifted_by = $3, lifted_at = clock_timestamp()
      WHERE tenant = $1 AND agent IS NOT DISTINCT FROM $2 AND lifted_at IS NULL
      RETURNING id`,
    [tenant, agent ?? null, by],
  );
  const id = rows[0]?.id;

  return Object.freeze(id === undefined ? { kind: "none" } : { kind: "lifted", id });
}

/**
 * The brake that stops this agent in this company now, its own or the company's freeze, or
 * `undefined` when none does.
 */
export async function whatStops(tenant: string, agent: string): Promise<Brake | undefined> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    agent: string | null;
    imposed_by: string;
    reason: string;
  }>(
    `SELECT id, agent, imposed_by, reason FROM dsor.agent_controls
      WHERE tenant = $1 AND lifted_at IS NULL AND (agent = $2 OR agent IS NULL)
      ORDER BY agent NULLS LAST
      LIMIT 1`,
    [tenant, agent],
  );
  const row = rows[0];

  return row === undefined
    ? undefined
    : Object.freeze({
        id: row.id,
        agent: row.agent ?? undefined,
        imposedBy: row.imposed_by,
        reason: row.reason,
      });
}

/**
 * The condition, in SQL, that no brake stops an agent: for the statement that moves a proposal to
 * EXECUTING, so a brake pulled after §21.4 still stops it (DSOR-OPS-01c). `tenant` and `agent` are
 * the statement's own parameter numbers.
 */
export function noBrakeOn(tenant: string, agent: string): string {
  return `NOT EXISTS (SELECT 1 FROM dsor.agent_controls c
                       WHERE c.tenant = ${tenant} AND c.lifted_at IS NULL
                         AND (c.agent = ${agent} OR c.agent IS NULL))`;
}
