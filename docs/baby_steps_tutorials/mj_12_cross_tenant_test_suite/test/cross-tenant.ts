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
import { HOMES, WRITTEN_IN, foreignIn, movedTo, pairsFor, swaps, waysFrom } from "./companies.ts";
import { withoutRequestId } from "./helpers.ts";

/** A principal the suite attacks as: its id, and the login token DSoR gave it. */
export type Attacker = { id: string; token: string };

/** What the suite did, and every problem it found. No findings means a pass. */
export type Report = {
  // The operations it attacked from both companies, in the registry's order.
  attacked: string[];
  // Every attack: the company it worked in, the operation, and the request id, so a test
  // can find the record each one left.
  attacks: { home: string; operation: string; request_id: string }[];
  // Every in-company pair it sent: the company, the operation, and the URI whose id it
  // changed (step 12's README, C2). Found by the Stage 2 review, and fixed from step 12 on.
  pairs: { home: string; operation: string; uri: string }[];
  findings: string[];
};

/** The call function the suite sends its requests through. */
export type Send = typeof call;

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

/**
 * Why the two answers of an in-company pair are a finding, or undefined when they are the
 * same apart from the request id and the id each request named. An answer may repeat the id
 * it was sent, as "no invoice" does, and that tells the caller nothing new (DSOR-ERR-01b).
 * Found by the Stage 2 review, and fixed from step 12 on.
 */
export function comparePair(answers: Answer[], ids: string[]): string | undefined {
  // Each id as it is written inside JSON text, so it is found there.
  const [named, nobody] = ids.map((id) => JSON.stringify(id).slice(1, -1));
  const [first, second] = answers.map((answer) => JSON.stringify(withoutRequestId(answer)));
  // The second answer is written as if it had been asked for the first id, and must then
  // be the first answer, word for word. Masking both ids with one mark let an answer that
  // wrote the mark itself pass. Found by a hostile pass on the Stage 2 review's fix.
  const asked = (second ?? "").split(nobody ?? "").join(named ?? "");
  return first === asked ? undefined : "the two answers differ";
}

/** Attacks every operation in the registry, and gives back what it found. */
export async function crossTenantSuite(
  registry: Registry,
  log: DecisionLog,
  examples: ContractSource[],
  // Every request goes through this function: call, unless a test hands the suite a fake
  // DSoR, to prove it would notice what the fake does (step 12's README, decision 10).
  send: Send = call,
): Promise<Report> {
  const report: Report = { attacked: [], attacks: [], pairs: [], findings: [] };
  // An example that no operation names is most likely a name spelled wrong, and the
  // operation it was meant for has none (step 12's README, decision 2).
  for (const { file } of examples) {
    const named = file.slice(0, -".json".length);
    if (!registry.contracts.has(named)) {
      report.findings.push(`examples/${file}: no operation has this name`);
    }
  }
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
        await attackAs(attacker, { registry, log, send, operation, home, own }, report);
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
  send: Send;
  operation: string;
  home: string;
  // The operation's own request, its example moved into this company.
  own: unknown;
};

// One caller's attacks on one operation, from one company. First the same-company call,
// then each URI swapped, three ways, then the in-company pair.
async function attackAs(attacker: Attacker, target: Target, report: Report): Promise<void> {
  const { registry, log, send, operation, home, own } = target;
  const who = `${operation} as ${attacker.id} in ${home}`;
  const request = { token: attacker.token, tenant: home };
  // The same-company call: the example unchanged, in its own company. It must not be
  // refused as foreign. Then a TENANT_MISMATCH below can only come from the company that
  // changed (step 12's README, decision 8).
  const answer = await send(registry, log, request, operation, own);
  const query = registry.contracts.get(operation)?.["kind"] === "query";
  const not = "its same-company call is not answered with data";
  if (!("data" in answer)) {
    if (answer.code === "TENANT_MISMATCH") {
      report.findings.push(`${who}: its same-company call is answered TENANT_MISMATCH`);
    } else if (query) {
      // A query's must answer with data. Then its example names a thing this company has,
      // and the first way of the swap, the same id elsewhere, one the other company has
      // (step 12's README, decision 8). Found by the sweep.
      report.findings.push(`${who}: ${not}: ${answer.code}`);
    }
  } else if (query && isEmpty(answer.data)) {
    // { data: undefined } is no data either, nor {}, [], or "". Found by the Stage 2 review,
    // and fixed from step 12 on.
    const data = JSON.stringify(answer.data) ?? String(answer.data);
    report.findings.push(`${who}: ${not}: the data is ${data}`);
  }
  // This request reaches the operation's own code, and so do the in-company pair's below,
  // so the code's own leaks show here: the answer may hold nothing of another company (C8).
  // The whole answer, a refusal's message too (step 12's README, decision 8). Found by the
  // Stage 2 review, and fixed from step 12 on.
  const what = foreignIn(answer, home, own);
  const said = "its same-company call answered with another company's data";
  if (what !== undefined) report.findings.push(`${who}: ${said}: ${what}`);
  const ways = waysFrom(home);
  for (const swap of swaps(own, home)) {
    const answers: Answer[] = [];
    for (const [i, input] of swap.requests.entries()) {
      // One at a time, so the records are written in the order of the attacks.
      const foreign = await send(registry, log, request, operation, input);
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
  // The in-company pair, for a query: each URI of this company, named with an id only the
  // other company holds, then with one nobody holds. Both reach the code, so its own "not
  // found" must not tell them apart (DSOR-ERR-01b; step 12's README, C2). Found by the Stage
  // 2 review, and fixed from step 12 on.
  if (!query) return;
  for (const pair of pairsFor(own, home)) {
    report.pairs.push({ home, operation, uri: pair.uri });
    const named = `${pair.named}, which only ${pair.other} has`;
    const nobody = `${pair.nobody}, which nobody has`;
    const answers: Answer[] = [];
    for (const [i, input] of pair.requests.entries()) {
      const answer = await send(registry, log, request, operation, input);
      answers.push(answer);
      // Each answer is searched, as the same-company call's is: a fallback that answers
      // both alike with another company's data shows nothing in the comparison. Found by
      // a hostile pass on the Stage 2 review's fix.
      const what = foreignIn(answer, home, input);
      const sent = i === 0 ? named : nobody;
      const said = `answered with another company's data: ${what}`;
      if (what !== undefined) report.findings.push(`${who}, ${sent}: ${said}`);
    }
    const differ = comparePair(answers, pair.ids);
    if (differ !== undefined) report.findings.push(`${who}, ${named}, and ${nobody}: ${differ}`);
  }
}

// Data that holds nothing: none at all, or an empty object, list, or text.
function isEmpty(data: unknown): boolean {
  if (data === undefined || data === null || data === "") return true;
  return typeof data === "object" && Object.keys(data).length === 0;
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
  // Every field the schema lists, so a field that may hold a URI is attacked too, even one
  // that the operation does not require (step 12's README, decision 2).
  const listed = Object.keys((check.schema as { properties?: object }).properties ?? {});
  const left = listed.filter((field) => !Object.hasOwn(example as object, field));
  if (left.length > 0) {
    const fields = left.map((field) => JSON.stringify(field)).join(", ");
    return gap(`its example leaves out ${fields}, which its input schema lists`);
  }
  if (swaps(example, WRITTEN_IN).length === 0) {
    return gap(`no URI of ${WRITTEN_IN} in its example`);
  }
  return example;
}
