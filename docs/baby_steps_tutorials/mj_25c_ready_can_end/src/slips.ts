// The permission slip, which the specification calls a delegation. A person
// signs it for an agent, and DSoR keeps it in its own store (DSOR-DEL-01a in
// specs/dsor/02-security.md, section 13). Its shape is the specification's own,
// schemas/delegation.schema.json, copied byte for byte (step 18's README, decision 13).
import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import {
  changeOf,
  revocationOf,
  type DelegationChange,
  type RevokeReason,
  type SuspendReason,
} from "./log.ts";

/** A permission slip, in the specification's shape, once it has passed the schema check. */
export type Slip = {
  id: string;
  tenant: string;
  delegator: string;
  delegate: string;
  modes: string[];
  permissions: string[];
  constraints: Record<string, unknown>;
  subdelegation: { allowed: boolean; max_depth?: number };
  parent?: string;
  status: "active" | "suspended" | "revoked" | "expired";
  expires_at: string;
  extensions?: Record<string, unknown>;
};

// The store answers with the slip as it holds it, not yet checked, and says whether its
// expires_at has passed by the store's own clock: the database's now() for the database
// (step 18's README, decision 12).
/** One slip, as the store found it, and whether its time has passed. */
export type FoundSlip = { slip: unknown; past: boolean };

// One agent has at most one slip in one company (step 18's README, decision 7).
/** Where DSoR keeps its slips: the slip of this agent in this company, if there is one. */
export type SlipStore = {
  find: (tenant: string, delegate: string) => Promise<FoundSlip | undefined>;
  // And suspend every active slip that one person signed in one company, with
  // one record each, all or nothing. It answers with the ids of the slips it changed (step 19b's
  // README, decisions 1, 3, and 4).
  suspend: (tenant: string, delegator: string, why: SuspendReason) => Promise<string[]>;
  // One slip of one company, by its id, for the tear-up, which names the slip
  // (step 25's README, decision D3).
  get: (tenant: string, id: string) => Promise<FoundSlip | undefined>;
  // NEW IN STEP 25c: the same, inside the claim's transaction, for line ③ again, right after line
  // ⑧. On the database it first takes the slip's lock, shared, until the transaction ends: a
  // tear-up meanwhile waits for this call, and this call waits for a tear-up already under way
  // (step 25c's README, decision D12).
  hold: (tenant: string, id: string) => Promise<FoundSlip | undefined>;
  // And tear up one slip, with its record, both or neither. Only a slip that is
  // active or suspended, and not past its date: the check and the change are one step. True when
  // it tore the slip up. False when the slip was not there to tear up, or had changed meanwhile
  // (DSOR-DEL-04a; step 25's README, decisions D5 and D6).
  revoke: (tenant: string, id: string, why: RevokeReason) => Promise<boolean>;
};

// A registry built with no store of slips gives every agent none. When the answer is
// missing, the answer is no.
/** A store that holds no slip. */
export const NO_SLIPS: SlipStore = Object.freeze({
  find: async () => undefined,
  // No slip, so nothing to suspend.
  suspend: async () => [],
  // And nothing to find or tear up.
  get: async () => undefined,
  hold: async () => undefined,
  revoke: async () => false,
});

// And the records of the suspensions it made, which the tests read.
/** Slips in memory, and the records of the suspensions it made. */
export type MemorySlips = SlipStore & { changes: () => Promise<DelegationChange[]> };

// And for the program's suspension, which it tells in memory, because a
// suspension in the shared database is permanent (step 19b's README, decision 11).
/**
 * Slips in memory, for the unit tests. Like the database, it holds one slip per agent and
 * company, and it reads the clock it is given, the program's by default.
 */
export function memorySlips(slips: readonly unknown[], now: () => number = Date.now): MemorySlips {
  // A copy, so a test that changes its own list cannot change the store afterwards.
  const kept = structuredClone(slips) as {
    id?: unknown;
    tenant?: unknown;
    delegator?: unknown;
    delegate?: unknown;
    status?: unknown;
    expires_at?: unknown;
  }[];
  // The records of the suspensions this store made.
  const changes: DelegationChange[] = [];
  const seen = new Set<string>();
  for (const slip of kept) {
    const key = JSON.stringify([slip.tenant, slip.delegate]);
    // The database's unique key refuses a second slip, so the memory store does too.
    if (seen.has(key)) throw new Error(`two slips for one agent in one company: ${key}`);
    seen.add(key);
  }
  // A time that cannot be read counts as passed: when the answer is missing, the answer is no.
  const isPast = (slip: { expires_at?: unknown }): boolean =>
    !(Date.parse(String(slip.expires_at)) > now());
  // One slip of one company, by its id.
  const get = async (tenant: string, id: string): Promise<FoundSlip | undefined> => {
    const slip = kept.find((s) => s.tenant === tenant && s.id === id);
    if (slip === undefined) return undefined;
    return { slip: structuredClone(slip), past: isPast(slip) };
  };
  return Object.freeze({
    find: async (tenant: string, delegate: string): Promise<FoundSlip | undefined> => {
      // DSoR's own filter, the company first, as the database's WHERE (DSOR-TEN-01b).
      const slip = kept.find((s) => s.tenant === tenant && s.delegate === delegate);
      if (slip === undefined) return undefined;
      return { slip: structuredClone(slip), past: isPast(slip) };
    },
    // The same, by the slip's id.
    get,
    // NEW IN STEP 25c: memory has no transactions, so hold holds nothing: it reads, as get does.
    hold: get,
    // As the database does it, in one step: the check and the change, and the
    // record with them.
    revoke: async (tenant: string, id: string, why: RevokeReason): Promise<boolean> => {
      const slip = kept.find((s) => s.tenant === tenant && s.id === id);
      if (slip === undefined || isPast(slip)) return false;
      if (slip.status !== "active" && slip.status !== "suspended") return false;
      slip.status = "revoked";
      changes.push(revocationOf(tenant, id, why));
      return true;
    },
    // As the database does it, in one step: her active slips in this company
    // are suspended, and each leaves one record (step 19b's README, decisions 1 and 4).
    suspend: async (tenant: string, delegator: string, why: SuspendReason): Promise<string[]> => {
      // DSoR's own filter, the company first, as the database's WHERE (DSOR-IDN-03b). Only an
      // active slip: a torn-up or expired one is never suspended (C8).
      const changing = kept.filter(
        (s) => s.tenant === tenant && s.delegator === delegator && s.status === "active",
      );
      for (const slip of changing) slip.status = "suspended";
      const ids = changing.map((slip) => String(slip.id)).sort();
      changes.push(...ids.map((id) => changeOf(tenant, id, why)));
      return ids;
    },
    // A copy, so a reader cannot change what it read.
    changes: async (): Promise<DelegationChange[]> => structuredClone(changes),
  });
}

// The specification's schemas, copied byte for byte (step 03's README, decision 3).
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}

// As registry.ts builds its checker: name every problem, and never change the slip while
// checking it. validateFormats is off, because ajv knows no formats without a package of
// its own. So "date-time" is not checked here. The database's timestamptz column refuses a
// time it cannot read, the database's store leaves out one that JavaScript cannot write,
// such as infinity, and the memory store counts one it cannot read as passed (step 18's
// README, decision 13).
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
  validateFormats: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
const validateSlip = ajv.compile(loadSchema("delegation.schema.json"));

/** Every way this slip breaks the specification's schema, or this tutorial's rule beyond it. None for a good slip. */
export function slipProblems(slip: unknown): string[] {
  if (!validateSlip(slip)) return (validateSlip.errors ?? []).map(explain);
  // The schema allows an empty id and an empty signer. The record would then name no slip,
  // or no person, so DSoR counts either as a broken slip. Found by step 18's review (step
  // 18's README, decision 13).
  const { id, delegator } = slip as Slip;
  return [
    ...(id === "" ? ["/id is empty"] : []),
    ...(delegator === "" ? ["/delegator is empty"] : []),
  ];
}

// One problem, as ajv found it: where in the slip, and what is wrong there.
function explain(error: ErrorObject): string {
  const where = error.instancePath === "" ? "the slip" : error.instancePath;
  return `${where} ${error.message ?? "is wrong"}`;
}
