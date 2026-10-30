// Where pnpm serve asks each company's sign-in server about a person, and with which
// key (step 45's README, C1 and D11). The address is in lookups.json. The key is never in a file:
// it comes from the environment, as DSOR_LOOKUP_KEY_ORG_456 for org_456, so it never sits where an
// agent or a model could read it (DSOR-CNR-02). Start-up checks both before any caller can ask.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keysWrittenTwice } from "./json.ts";
import { isTrustedAddress } from "./sign-in.ts";
import { isTenantId } from "./uri.ts";

/** One company's lookup: the address DSoR asks, and the company key it sends there. */
export type Lookup = { address: string; key: string };

/** The lookups file, as it was read from disk: its name and its text. */
export type LookupsSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../lookups.json", import.meta.url));

/** The lookups file: this step's own, unless a path is given. */
export function readLookups(path: string = SHIPPED): LookupsSource {
  return { file: "lookups.json", text: readFileSync(path, "utf8") };
}

/** The variable that holds a company's key: DSOR_LOOKUP_KEY_ORG_456 for org_456. */
export function keyVariable(tenant: string): string {
  return `DSOR_LOOKUP_KEY_${tenant.toUpperCase()}`;
}

// A key travels in the Authorization header as a Bearer credential (D14), so it has that form: a
// space or a line break would break the header, and fetch would refuse it at the first call.
// not copied: RFC 6750's b64token, the form of a Bearer credential; the specification has no key.
const BEARER = /^[A-Za-z0-9._~+/-]+=*$/;

const ADDRESS =
  "must be an https address, or http on this computer (127.0.0.1 or localhost), with no query";

/**
 * Each company's lookup, from the file and the environment, and every problem found. Every company
 * with a role source needs a lookup, and a lookup needs a role source. A problem names a variable,
 * never its value.
 */
export function checkLookups(
  source: LookupsSource,
  companies: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): { lookups: ReadonlyMap<string, Lookup>; problems: string[] } {
  const { file, text } = source;
  const lookups = new Map<string, Lookup>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { lookups, problems: [`${file}: not valid JSON`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { lookups, problems: [`${file}: must be an object that gives each company its lookup`] };
  }
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  const wanted = new Set(companies);
  for (const [tenant, entry] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    // A lookup for a company with no role source is a typo, like a role nobody holds.
    if (!wanted.has(tenant)) {
      problems.push(`${file}: ${tenant} has a lookup, but no role source`);
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      problems.push(`${file}: ${tenant} must be an object with its address`);
      continue;
    }
    // Only the address. A key written here would be a key in a file (DSOR-CNR-02).
    const extra = Object.keys(entry).filter((field) => field !== "address");
    if (extra.length > 0) {
      const named = extra.map((field) => JSON.stringify(field.slice(0, 60))).join(", ");
      const why = `its key comes from ${keyVariable(tenant)}, never from a file`;
      problems.push(`${file}: ${tenant} has only an address, not ${named}: ${why}`);
      continue;
    }
    const address = (entry as Record<string, unknown>)["address"];
    // The lookup adds its own tenant and person, so an address brings no query of its own.
    if (!isTrustedAddress(address) || new URL(address as string).search !== "") {
      problems.push(`${file}: ${tenant}'s address ${ADDRESS}`);
      continue;
    }
    const key = env[keyVariable(tenant)];
    if (key === undefined || key === "") {
      problems.push(`${file}: ${tenant} has a lookup, and ${keyVariable(tenant)} is not set`);
      continue;
    }
    if (!BEARER.test(key)) {
      const form = "letters, digits, and - . _ ~ + /, as a Bearer credential has";
      problems.push(`${file}: ${keyVariable(tenant)} must be one word of ${form}`);
      continue;
    }
    lookups.set(tenant, { address: address as string, key });
  }
  for (const tenant of [...wanted].sort()) {
    if (!Object.hasOwn(data, tenant)) {
      problems.push(`${file}: ${tenant}, which has a role source, has no lookup`);
    }
  }
  return { lookups, problems };
}
