// NEW IN STEP 12: the cross-tenant suite (DSOR-TEN-02b). Not a test file itself: the
// tests in cross-tenant.test.ts and cross-tenant.db.test.ts run it.
// It walks the registry, so an operation added later is attacked the moment it is
// registered, and nobody has to remember to write its test (step 12's README).
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Answer } from "../src/envelope.ts";
import type { DecisionLog } from "../src/log.ts";
import { permissionsOf } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { logins } from "../src/principals.ts";
import { readContracts, type ContractSource, type Registry } from "../src/registry.ts";
import { withoutRequestId } from "./helpers.ts";

/** A principal the suite attacks as: its id, and the login token DSoR gave it. */
export type Attacker = { id: string; token: string };

/** One URI of the company in an example, and the three requests that swap it. */
export type Swap = { uri: string; requests: unknown[] };

/** What the suite did, and every problem it found. No findings means a pass. */
export type Report = {
  // The operations it attacked from both companies, in the registry's order.
  attacked: string[];
  // Every attack: the company it worked in, the operation, and the request id, so a test
  // can find the record each one left.
  attacks: { home: string; operation: string; request_id: string }[];
  findings: string[];
};

/** The call function the suite sends its requests through. */
export type Send = typeof call;

// The suite works in org_456, the company of the running story, then in org_789. From each
// it reaches for the other, and for org_999, which does not exist (step 12's README,
// decisions 3 and 9).
const HOMES = ["org_456", "org_789"];
const OTHER: Readonly<Record<string, string>> = { org_456: "org_789", org_789: "org_456" };
const STRANGER = "org_999";
// The examples are written in org_456. For org_789, their URIs are moved there.
const WRITTEN_IN = "org_456";

// The example requests this step ships, one file for each operation (step 12's README,
// decision 2).
const EXAMPLES = fileURLToPath(new URL("../examples", import.meta.url));

/** Every example request in a folder: this step's own, unless a test names another. */
export function readExamples(dir: string = EXAMPLES): ContractSource[] {
  // Read the way the contracts folder is read: every .json file, in name order.
  return readContracts(dir);
}

// The permission the operation's contract names, which start-up made sure it has.
function permissionOf(registry: Registry, operation: string): unknown {
  const authorization = registry.contracts.get(operation)?.["authorization"];
  return (authorization as { permission?: unknown } | undefined)?.permission;
}

/** Every principal whose roles in this company grant the operation's permission. */
export function attackersOf(registry: Registry, operation: string, home: string): Attacker[] {
  const permission = permissionOf(registry, operation);
  const attackers: Attacker[] = [];
  // DSoR's own table of logins, in its order. A caller who may not call the operation
  // would be refused at line ⑤, before the URI's company is checked, and prove nothing
  // (step 12's README, decision 4).
  for (const [token, principal] of logins) {
    if (typeof permission !== "string") continue;
    if (permissionsOf(principal, registry.roles, home).has(permission)) {
      attackers.push({ id: principal.id, token });
    }
  }
  return attackers;
}

/** The three ways a URI of this company is swapped (step 12's README, decision 3). */
function waysFrom(home: string): { to: string; uri: (entity: string, id: string) => string }[] {
  const other = OTHER[home] ?? STRANGER;
  return [
    {
      to: `${other}, with the same id`,
      uri: (entity, id) => `dsor://${other}/${entity}/${id}`,
    },
    {
      to: `${other}, with an id it does not have`,
      uri: (entity) => `dsor://${other}/${entity}/NOPE`,
    },
    {
      to: `${STRANGER}, which does not exist`,
      uri: (entity, id) => `dsor://${STRANGER}/${entity}/${id}`,
    },
  ];
}

// A URI of this company, cut into its entity and its id. Written here, and not imported
// from src, so a mistake in src's parser is not copied into its own test. A company id is
// "org_" and digits, so it holds nothing a pattern would read as a rule.
function uriOf(home: string): RegExp {
  return new RegExp(`^dsor://${home}/([^/]+)/([^/]+)$`);
}

/** For each URI of this company in the example, the three requests that swap only it. */
export function swaps(example: unknown, home: string): Swap[] {
  const found: Swap[] = [];
  for (const [path, text] of texts(example)) {
    const match = uriOf(home).exec(text);
    if (match === null) continue;
    const [, entity = "", id = ""] = match;
    // One URI at a time: the others stay in the company, so each request carries exactly
    // one foreign URI (step 12's README, decision 3).
    const requests = waysFrom(home).map((way) => replaced(example, path, way.uri(entity, id)));
    found.push({ uri: text, requests });
  }
  return found;
}

// The example moved to another company: each of its URIs of org_456 now names that
// company, with the same entity and id (step 12's README, decision 9).
function movedTo(home: string, example: unknown): unknown {
  let moved = example;
  for (const [path, text] of texts(example)) {
    const match = uriOf(WRITTEN_IN).exec(text);
    if (match === null) continue;
    const [, entity = "", id = ""] = match;
    moved = replaced(moved, path, `dsor://${home}/${entity}/${id}`);
  }
  return moved;
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
export function compare(answers: Answer[]): string | undefined {
  // Word for word, once the request id is set aside: DSoR makes a new one for every call.
  // A difference would tell the caller something about the other company, such as
  // whether it has the thing, or exists at all (DSOR-ERR-01b).
  const [first, ...others] = answers.map(withoutRequestId);
  const same = others.every((other) => isDeepStrictEqual(other, first));
  return same ? undefined : "the three answers differ";
}

// The company a URI names, as the checklist reads it: "dsor://" may be in capitals
// (step 10's README, decision 4).
const URI_COMPANY = /^dsor:\/\/([^/]*)/i;

/**
 * Another company's thing in the data, or undefined when it holds only this company's. Two
 * signs name a company: a tenant_id field, and a URI (step 12's README, decision 8).
 */
export function foreignIn(data: unknown, home: string): string | undefined {
  for (const [path, text] of texts(data)) {
    const field = path[path.length - 1];
    if (field === "tenant_id" && text !== home) return `tenant_id ${JSON.stringify(text)}`;
    const company = URI_COMPANY.exec(text)?.[1];
    if (company !== undefined && company !== home) return JSON.stringify(text);
  }
  return undefined;
}

/** Attacks every operation in the registry, and gives back what it found. */
export async function crossTenantSuite(
  registry: Registry,
  log: DecisionLog,
  examples: ContractSource[],
  // Used from decision 10's commit on.
  _send: Send = call,
): Promise<Report> {
  const report: Report = { attacked: [], attacks: [], findings: [] };
  for (const operation of registry.contracts.keys()) {
    // A gap is a finding, never a skip: a skipped operation looks exactly like a tested
    // one when every test is green (step 12's README, outcome 5). Every gap is named.
    const example = exampleOf(registry, operation, examples, report.findings);
    let everywhere = example !== undefined;
    for (const home of HOMES) {
      const attackers = attackersOf(registry, operation, home);
      if (attackers.length === 0) {
        const permission = String(permissionOf(registry, operation));
        const why = `nobody in ${home} holds ${permission}, so nobody can attack it there`;
        report.findings.push(`${operation}: ${why}`);
        everywhere = false;
      }
      if (example === undefined) continue;
      const own = movedTo(home, example);
      for (const attacker of attackers) {
        await attackAs(attacker, { registry, log, operation, home, own }, report);
      }
    }
    // Attacked from both companies, with nothing in the way.
    if (everywhere) report.attacked.push(operation);
  }
  return report;
}

/** One operation, attacked from one company: what an attacker needs to know. */
type Target = {
  registry: Registry;
  log: DecisionLog;
  operation: string;
  home: string;
  // The operation's own request, its example moved into this company.
  own: unknown;
};

// One caller's attacks on one operation, from one company. First the same-company call,
// then each URI swapped, three ways.
async function attackAs(attacker: Attacker, target: Target, report: Report): Promise<void> {
  const { registry, log, operation, home, own } = target;
  const who = `${operation} as ${attacker.id} in ${home}`;
  const request = { token: attacker.token, tenant: home };
  // The same-company call: the example unchanged, in its own company. It must not be
  // refused as foreign. Then a TENANT_MISMATCH below can only come from the company that
  // changed (step 12's README, decision 8).
  const answer = await call(registry, log, request, operation, own);
  if (!("data" in answer) && answer.code === "TENANT_MISMATCH") {
    report.findings.push(`${who}: its same-company call is answered TENANT_MISMATCH`);
  }
  // This is the only request that reaches the operation's own code, so the code's own
  // leaks show here: its answer may hold nothing of another company (C8).
  if ("data" in answer) {
    const what = foreignIn(answer.data, home);
    const said = "its same-company call answered with another company's data";
    if (what !== undefined) report.findings.push(`${who}: ${said}: ${what}`);
  }
  const ways = waysFrom(home);
  for (const swap of swaps(own, home)) {
    const answers: Answer[] = [];
    for (const [i, input] of swap.requests.entries()) {
      // One at a time, so the records are written in the order of the attacks.
      const foreign = await call(registry, log, request, operation, input);
      const { request_id } = foreign.correlation;
      report.attacks.push({ home, operation, request_id });
      answers.push(foreign);
      const why = judge(foreign);
      if (why !== undefined)
        report.findings.push(`${who}, ${swap.uri} sent to ${ways[i]!.to}: ${why}`);
    }
    const differ = compare(answers);
    if (differ !== undefined) report.findings.push(`${who}, ${swap.uri}: ${differ}`);
  }
}

/**
 * The operation's example, or undefined, with a finding that says why there is none to use:
 * no example, one that is not JSON, one that line ⑥ would refuse, or one that holds no URI
 * of org_456 to swap (step 12's README, decision 2).
 */
function exampleOf(
  registry: Registry,
  operation: string,
  examples: ContractSource[],
  findings: string[],
): unknown {
  const gap = (why: string): undefined => {
    findings.push(`${operation}: ${why}`);
    return undefined;
  };
  const file = `${operation}.json`;
  const source = examples.find((example) => example.file === file);
  if (source === undefined) return gap(`no example request in examples/${file}`);
  let example: unknown;
  try {
    example = JSON.parse(source.text);
  } catch {
    return gap("its example is not valid JSON");
  }
  // The check line ⑥ runs. An example it refuses would be refused there in every attack,
  // for its shape, and the company check would never run.
  const check = registry.inputs.get(operation);
  if (check === undefined || !check(example)) {
    return gap("its example does not pass its input schema");
  }
  if (swaps(example, WRITTEN_IN).length === 0) {
    return gap(`no URI of ${WRITTEN_IN} in its example`);
  }
  return example;
}
