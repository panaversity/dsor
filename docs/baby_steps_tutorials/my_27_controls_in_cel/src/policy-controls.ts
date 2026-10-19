// NEW IN STEP 27: the company's policy, as controls kept in DSoR's own store (decision 162).
//
// A control is a policy sentence translated into a condition a program can evaluate: "payments
// above 25,000 USD need the CFO" becomes `dsor_exceeds(input.amount, dsor_money("25000", "USD"))`,
// with the effect `require_approval` by the CFO. It is kept with its owner, the policy sentence and
// version it came from, and test cases that must pass before it is switched on (§17). One row per
// company, control and version, in `dsor.controls`, under the same two locks as everything there.
//
// Not to be confused with `controls.ts`, step 25's emergency brake: §18's operational controls.
//
// Rule DSOR-CTL-01a: A control MUST validate against `control.schema.json`, which requires a version,
// a condition, an effect, a status, a named human owner, and an authority reference.

import { theDatabase } from "./store.ts";

/** The six states §17 gives a control. */
export type ControlStatus =
  | "draft"
  | "in_review"
  | "active"
  | "stale_authority"
  | "suspended"
  | "retired";

/** One control, as control.schema.json says it: its record, with its status beside it. */
export interface Control {
  readonly id: string;
  readonly version: number;
  readonly status: ControlStatus;
  readonly operation: string;
  /** The whole record, status included, exactly as the schema checks it. */
  readonly record: Readonly<Record<string, unknown>>;
}

/** A copy that nothing handed out can change: the record is read from JSON, so it is plain data. */
function frozenDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) {
      frozenDeep(inner);
    }

    Object.freeze(value);
  }

  return value;
}

/** Rows as the store hands them back, made into controls. */
function controlsFrom(
  rows: readonly {
    id: string;
    version: number;
    status: ControlStatus;
    operation: string;
    record: Record<string, unknown>;
  }[],
): readonly Control[] {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: row.id,
        version: row.version,
        status: row.status,
        operation: row.operation,
        // The status is the column's, the one part of a control that changes; the record never
        // holds one (migration 028).
        record: frozenDeep({ ...row.record, status: row.status }),
      }),
    ),
  );
}

/** Every control a company has, every version, in any state, by id and version. */
export async function controlsOf(tenant: string): Promise<readonly Control[]> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    version: number;
    status: ControlStatus;
    operation: string;
    record: Record<string, unknown>;
  }>(
    `SELECT id, version, status, operation, record FROM dsor.controls
      WHERE tenant = $1 ORDER BY id, version`,
    [tenant],
  );

  return controlsFrom(rows);
}

/**
 * The controls in force on one operation in one company: the ones switched on. A control waiting
 * for review, suspended or retired governs nothing. Read at every decision, never kept: a control
 * switched on a moment ago applies to the next request.
 */
export async function controlsInForce(
  tenant: string,
  operation: string,
): Promise<readonly Control[]> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    version: number;
    status: ControlStatus;
    operation: string;
    record: Record<string, unknown>;
  }>(
    `SELECT id, version, status, operation, record FROM dsor.controls
      WHERE tenant = $1 AND operation = $2 AND status = 'active' ORDER BY id`,
    [tenant, operation],
  );

  return controlsFrom(rows);
}
