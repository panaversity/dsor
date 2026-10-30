// NEW IN STEP 26: each company's money policy: the currency its controls count in, where its
// exchange rates come from, how old a rate may be, and what happens when an amount cannot be
// converted (DSOR-MON-04 in specs/dsor/01-model.md, section 9; step 26's README, decisions L3 and
// D11). It is read from money-policies.json at start-up, and checked there against the money part
// of the specification's tenant policy, as role-sources.json is checked against its role_source
// part (step 19's README, decision 8).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { millisecondsOf } from "./authority.ts";
import { keysWrittenTwice } from "./json.ts";
import { isCurrency } from "./money.ts";
import type { Principal } from "./principals.ts";
import { isTenantId } from "./uri.ts";

/** One company's money policy, once start-up has checked it, with its age in milliseconds. */
export type MoneyPolicy = {
  control_currency: string;
  rate_source: string;
  max_rate_age: string;
  on_unconvertible: "restrictive";
  maxAgeMs: number;
};

/** Each company's money policy, by company. */
export type MoneyPolicies = ReadonlyMap<string, MoneyPolicy>;

/** The policies file, as it was read from disk: its name and its text. */
export type PoliciesSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../money-policies.json", import.meta.url));

/** Reads the policies file: this step's own, unless another is named. */
export function readMoneyPolicies(path: string = SHIPPED): PoliciesSource {
  return { file: "money-policies.json", text: readFileSync(path, "utf8") };
}

// The specification's schemas, copied byte for byte (step 03's README, decision 3).
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
// As registry.ts builds its checker: name every problem, and never change what is checked.
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
ajv.addSchema(loadSchema("tenant-policy.schema.json"));
const validatePolicy = ajv.compile({ $ref: "urn:dsor:schema:1.3:tenant-policy#/properties/money" });

// §44's ceiling for a rate's age at L2 is 7 days. L3's is 3 (step 26's README, decision D11).
const CEILING = 7 * 24 * 60 * 60 * 1000;

/** Checks each company's money policy, and names every problem. */
export function checkMoneyPolicies(
  source: PoliciesSource,
  principals: Iterable<Principal>,
): { policies: MoneyPolicies; problems: string[] } {
  const { file, text } = source;
  const policies = new Map<string, MoneyPolicy>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { policies, problems: [`${file}: not valid JSON`] };
  }
  // A list and null are objects in JavaScript too. Neither one names a company.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const problem = `${file}: must be an object that gives each company its money policy`;
    return { policies, problems: [problem] };
  }
  // JSON.parse keeps the last of two lines for one company, and says nothing.
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [tenant, policy] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    // The specification's shape first: its four fields, and nothing else.
    if (!validatePolicy(policy)) {
      for (const error of validatePolicy.errors ?? []) {
        problems.push(`${file}: ${tenant}${error.instancePath} ${error.message ?? "is wrong"}`);
      }
      continue;
    }
    const { control_currency, rate_source, max_rate_age } = policy as MoneyPolicy;
    // Three capitals pass the schema. Only a currency on the list is one, as for money.
    if (!isCurrency(control_currency)) {
      const named = JSON.stringify(control_currency);
      problems.push(`${file}: ${tenant}'s control_currency ${named} is not an ISO 4217 currency`);
      continue;
    }
    // And §44's ceiling. A tighter value, zero too, is the company's to set: with zero, no rate is
    // ever fresh enough, and every amount in another currency is refused.
    const maxAgeMs = millisecondsOf(max_rate_age);
    if (maxAgeMs > CEILING) {
      const why = "is over 7 days, the most §44 allows at L2 (DSOR-MON-04)";
      problems.push(`${file}: ${tenant}'s max_rate_age ${JSON.stringify(max_rate_age)} ${why}`);
      continue;
    }
    policies.set(tenant, {
      control_currency,
      rate_source,
      max_rate_age,
      on_unconvertible: "restrictive",
      maxAgeMs,
    });
  }
  // Every company where a login works needs a policy, or no amount could be converted there. A
  // policy for a company where no login works is a typo, like a role nobody holds.
  const working = new Set([...principals].flatMap((p) => p.memberships.map((m) => m.tenant_id)));
  for (const tenant of [...working].sort()) {
    if (!Object.hasOwn(data, tenant)) {
      problems.push(`${file}: ${tenant}, where logins work, has no money policy`);
    }
  }
  for (const tenant of Object.keys(data)) {
    if (isTenantId(tenant) && !working.has(tenant)) {
      problems.push(`${file}: ${tenant} has a money policy, and no login works there`);
    }
  }
  return { policies, problems };
}
