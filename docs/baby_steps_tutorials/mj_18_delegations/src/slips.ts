// NEW IN STEP 18: the permission slip, which the specification calls a delegation. A person
// signs it for an agent, and DSoR keeps it in its own store (DSOR-DEL-01a in
// specs/dsor/02-security.md, section 13). Its shape is the specification's own,
// schemas/delegation.schema.json, copied byte for byte (step 18's README, decision 13).
import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

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
};

// A registry built with no store of slips gives every agent none. When the answer is
// missing, the answer is no.
/** A store that holds no slip. */
export const NO_SLIPS: SlipStore = Object.freeze({ find: async () => undefined });

/**
 * Slips in memory, for the unit tests. Like the database, it holds one slip per agent and
 * company, and it reads the clock it is given, the program's by default.
 */
export function memorySlips(slips: readonly unknown[], now: () => number = Date.now): SlipStore {
  // A copy, so a test that changes its own list cannot change the store afterwards.
  const kept = structuredClone(slips) as { tenant?: unknown; delegate?: unknown }[];
  const seen = new Set<string>();
  for (const slip of kept) {
    const key = JSON.stringify([slip.tenant, slip.delegate]);
    // The database's unique key refuses a second slip, so the memory store does too.
    if (seen.has(key)) throw new Error(`two slips for one agent in one company: ${key}`);
    seen.add(key);
  }
  return Object.freeze({
    find: async (tenant: string, delegate: string): Promise<FoundSlip | undefined> => {
      // DSoR's own filter, the company first, as the database's WHERE (DSOR-TEN-01b).
      const slip = kept.find((s) => s.tenant === tenant && s.delegate === delegate);
      if (slip === undefined) return undefined;
      // A time that cannot be read counts as passed: when the answer is missing, the
      // answer is no.
      const until = Date.parse(String((slip as { expires_at?: unknown }).expires_at));
      return { slip: structuredClone(slip), past: !(until > now()) };
    },
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
