// NEW IN STEP 43: the sign-in services each company trusts. A token is accepted only from an issuer
//   that the company configured, here, as authoritative (DSOR-IDN-04a). Start-up checks the file
//   before any caller can ask (step 43's README, claim C1, decision D3).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Principal } from "./principals.ts";

/** One sign-in service: who signs its tokens, whom they are for, and where its public keys are. */
export type Issuer = { issuer: string; audience: string; jwks: string };

/** Each company's issuers. */
export type Issuers = ReadonlyMap<string, readonly Issuer[]>;

export type IssuersSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../issuers.json", import.meta.url));

/** The issuers file: this step's own, unless a path is given. */
export function readIssuers(path: string = SHIPPED): IssuersSource {
  return { file: "issuers.json", text: readFileSync(path, "utf8") };
}

const FIELDS = ["issuer", "audience", "jwks"] as const;

/**
 * The issuers in the file, and every problem with it: a company where people log in that names no
 * issuer, a company where nobody does, an address that is not https (or http on 127.0.0.1, for a
 * stand-in on this computer), a field the file does not know, and an issuer named twice.
 */
export function checkIssuers(
  source: IssuersSource,
  principals: Iterable<Principal>,
): { issuers: Issuers; problems: string[] } {
  const { file } = source;
  const problems: string[] = [];
  const issuers = new Map<string, Issuer[]>();
  const refused = new Set<string>();
  let data: unknown;
  try {
    data = JSON.parse(source.text);
  } catch (error) {
    return { issuers, problems: [`${file} is not JSON: ${(error as Error).message}`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { issuers, problems: [`${file} must be one list of issuers for each company`] };
  }
  // The companies where a person logs in. Agents and system logins keep step 05's table until step
  //   44 (decision D1).
  const people = [...principals].filter((p) => p.type === "human");
  const working = new Set(people.flatMap((p) => p.memberships.map((m) => m.tenant_id)));
  for (const [tenant, list] of Object.entries(data)) {
    if (!working.has(tenant)) {
      problems.push(`${file}: ${tenant} is no company where people log in`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`${file}: ${tenant} must be a list of issuers`);
      refused.add(tenant);
      continue;
    }
    const kept: Issuer[] = [];
    list.forEach((entry: unknown, i: number) => {
      const where = `${file}: ${tenant}, issuer ${i + 1}`;
      const fields =
        typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
      const extra = Object.keys(fields).find((f) => !(FIELDS as readonly string[]).includes(f));
      if (extra !== undefined) {
        const only = "an issuer has only issuer, audience, and jwks";
        problems.push(`${where}: ${only}, not ${JSON.stringify(extra.slice(0, 60))}`);
        return;
      }
      const bad = FIELDS.find((f) => !isTrustedAddress(fields[f]));
      if (bad !== undefined) {
        problems.push(`${where}: ${bad} must be an https address, or http on 127.0.0.1`);
        return;
      }
      const issuer = fields as Issuer;
      if (kept.some((k) => k.issuer === issuer.issuer)) {
        problems.push(`${file}: ${tenant} names ${issuer.issuer} twice`);
        return;
      }
      kept.push({ issuer: issuer.issuer, audience: issuer.audience, jwks: issuer.jwks });
    });
    if (kept.length === list.length && kept.length > 0) issuers.set(tenant, kept);
    else if (kept.length !== list.length) refused.add(tenant);
  }
  for (const tenant of [...working].sort()) {
    // A company whose list was refused is named once, for its list, not again here.
    if (!issuers.has(tenant) && !refused.has(tenant)) {
      problems.push(`${file}: ${tenant}, where people log in, names no issuer`);
    }
  }
  return { issuers, problems };
}

// An address DSoR may trust: https anywhere, or plain http only on this computer, where the
//   stand-in for Managed Better Auth runs (decisions D3 and D9).
function isTrustedAddress(value: unknown): boolean {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") return false;
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1");
}
