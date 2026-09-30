// NEW IN STEP 12: the cross-tenant suite (DSOR-TEN-02b). Not a test file itself: the
// tests in cross-tenant.test.ts and cross-tenant.db.test.ts run it.
// It walks the registry, so an operation added later is attacked the moment it is
// registered, and nobody has to remember to write its test (step 12's README).
import { fileURLToPath } from "node:url";
import type { Answer } from "../src/envelope.ts";
import type { DecisionLog } from "../src/log.ts";
import { permissionsOf } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { logins } from "../src/principals.ts";
import { readContracts, type ContractSource, type Registry } from "../src/registry.ts";

/** A principal the suite attacks as: its id, and the login token DSoR gave it. */
export type Attacker = { id: string; token: string };

/** One URI of org_456 in an example, and the three requests that swap it. */
export type Swap = { uri: string; requests: unknown[] };

/** What the suite did, and every problem it found. No findings means a pass. */
export type Report = {
  // The operations it attacked, in the registry's order.
  attacked: string[];
  // The request id of every attack, so a test can find the records they left.
  attacks: string[];
  findings: string[];
};

// Every attack works in org_456, the company of the running story.
const HOME = "org_456";

// The example requests this step ships, one file for each operation (step 12's README,
// decision 2).
const EXAMPLES = fileURLToPath(new URL("../examples", import.meta.url));

/** Every example request in a folder: this step's own, unless a test names another. */
export function readExamples(dir: string = EXAMPLES): ContractSource[] {
  // Read the way the contracts folder is read: every .json file, in name order.
  return readContracts(dir);
}

/** Every principal whose roles in org_456 grant the operation's permission. */
export function attackersOf(registry: Registry, operation: string): Attacker[] {
  const authorization = registry.contracts.get(operation)?.["authorization"];
  const permission = (authorization as { permission?: unknown } | undefined)?.permission;
  const attackers: Attacker[] = [];
  // DSoR's own table of logins, in its order. A caller who may not call the operation
  // would be refused at line ⑤, before the company is checked, and prove nothing
  // (step 12's README, decision 4).
  for (const [token, principal] of logins) {
    if (typeof permission !== "string") continue;
    if (permissionsOf(principal, registry.roles, HOME).has(permission)) {
      attackers.push({ id: principal.id, token });
    }
  }
  return attackers;
}

// The three ways a URI of org_456 is swapped (step 12's README, decision 3).
const WAYS: { to: string; uri: (entity: string, id: string) => string }[] = [
  { to: "org_789, where it exists", uri: (entity, id) => `dsor://org_789/${entity}/${id}` },
  { to: "org_789, where it does not", uri: (entity) => `dsor://org_789/${entity}/NOPE` },
  { to: "org_999, which does not exist", uri: (entity, id) => `dsor://org_999/${entity}/${id}` },
];

// A URI of org_456, cut into its entity and its id. Written here, and not imported from
// src, so a mistake in src's parser is not copied into its own test.
const HOME_URI = /^dsor:\/\/org_456\/([^/]+)\/([^/]+)$/;

/** For each URI of org_456 in the example, the three requests that swap only it. */
export function swaps(example: unknown): Swap[] {
  const found: Swap[] = [];
  for (const [path, text] of texts(example)) {
    const match = HOME_URI.exec(text);
    if (match === null) continue;
    const [, entity = "", id = ""] = match;
    // One URI at a time: the others stay in org_456, so each request carries exactly one
    // foreign URI (step 12's README, decision 3).
    const requests = WAYS.map((way) => replaced(example, path, way.uri(entity, id)));
    found.push({ uri: text, requests });
  }
  return found;
}

// Every text in a value, however deep, with the path of keys that leads to it.
function texts(value: unknown, path: string[] = []): [string[], string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  // A list's keys are its positions, "0", "1", and so on.
  return Object.entries(value).flatMap(([key, inner]) => texts(inner, [...path, key]));
}

// A copy of the example with the text at this path replaced. The example is left as it was.
function replaced(example: unknown, path: string[], text: string): unknown {
  if (path.length === 0) return text;
  const copy = structuredClone(example);
  let parent = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path[path.length - 1]!] = text;
  return copy;
}

/** Why this answer to a foreign request is a finding, or undefined when it is a pass. */
export function judge(answer: Answer): string | undefined {
  // Only TENANT_MISMATCH shows that the company check refused the call. Any other refusal
  // came from another line, for another reason (step 12's README, decision 4).
  if ("data" in answer) return "answered with data, not TENANT_MISMATCH";
  if (answer.code !== "TENANT_MISMATCH") return `answered ${answer.code}, not TENANT_MISMATCH`;
  return undefined;
}

/** Why these answers are a finding, or undefined when they are the same. */
export function compare(_answers: Answer[]): string | undefined {
  return undefined;
}

/** Attacks every operation in the registry, and gives back what it found. */
export async function crossTenantSuite(
  registry: Registry,
  log: DecisionLog,
  examples: ContractSource[],
): Promise<Report> {
  const report: Report = { attacked: [], attacks: [], findings: [] };
  for (const operation of registry.contracts.keys()) {
    const source = examples.find(({ file }) => file === `${operation}.json`);
    const example: unknown = JSON.parse(source!.text);
    for (const attacker of attackersOf(registry, operation)) {
      const request = { token: attacker.token, tenant: HOME };
      for (const swap of swaps(example)) {
        for (const [i, input] of swap.requests.entries()) {
          // One at a time, so the records are written in the order of the attacks.
          const answer = await call(registry, log, request, operation, input);
          report.attacks.push(answer.correlation.request_id);
          const why = judge(answer);
          const sent = `${swap.uri} sent to ${WAYS[i]!.to}`;
          if (why !== undefined)
            report.findings.push(`${operation} as ${attacker.id}, ${sent}: ${why}`);
        }
      }
    }
    report.attacked.push(operation);
  }
  return report;
}
