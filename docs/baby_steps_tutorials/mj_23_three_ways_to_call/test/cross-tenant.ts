// The cross-tenant suite (DSOR-TEN-02b). Not a test file itself: the
// tests in cross-tenant.test.ts and cross-tenant.db.test.ts run it.
// It walks the registry, so an operation added later is attacked the moment it is
// registered, and nobody has to remember to write its test (step 12's README).
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { checkDelegation } from "../src/delegation.ts";
import type { Answer } from "../src/envelope.ts";
import type { DecisionLog } from "../src/log.ts";
import { effectivePermissions } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { logins, type Principal } from "../src/principals.ts";
import type { Slip } from "../src/slips.ts";
import {
  readContracts,
  type Contract,
  type ContractSource,
  type Registry,
} from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  HOMES,
  WRITTEN_IN,
  foreignIn,
  isPage,
  movedTo,
  pageProblem,
  pairsFor,
  swaps,
  waysFrom,
} from "./companies.ts";
import { forComparing, keyed } from "./helpers.ts";

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

// The most pages the suite reads from one call of a list, the first one included. A list
// whose cursor never ends would keep the suite asking forever (step 13's README, decision
// 6). Found by the Stage 2 review, and fixed from step 13 on.
const MAX_PAGES = 10;

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

/** Every principal that lines ③ and ⑤ let call the operation in this company. */
export async function attackersOf(
  registry: Registry,
  operation: string,
  home: string,
): Promise<Attacker[]> {
  const permission = permissionOf(registry, operation);
  const contract = registry.contracts.get(operation);
  const attackers: Attacker[] = [];
  // DSoR's own table of logins, in its order. A caller who may not call the operation
  // would be refused at line ⑤, before the URI's company is checked, and prove nothing
  // (step 12's README, decision 4).
  for (const [token, principal] of logins) {
    if (typeof permission !== "string" || contract === undefined) continue;
    // The same for line ③. An agent's command is refused there, before the
    // URI's company is checked. The suite asks line ③'s own question, so an agent that a
    // delegation lets through in step 18 attacks again, with no change here (step 17's
    // README, "Think it through").
    // With the registry's slips, in this company. An agent with a slip here
    // attacks, as step 17's README said it would.
    const lineThree = await passesLineThree(principal, contract, registry, home);
    if (!lineThree.passes) continue;
    // And line ⑤'s own question: a person's roles, or an agent's slip cut down to its signer
    // (DSOR-DEL-02). Her roles now, as line ③ found them.
    const may = effectivePermissions(
      principal,
      registry.roles,
      home,
      lineThree.slip,
      lineThree.signerRoles,
    );
    if (may.has(permission)) {
      attackers.push({ id: principal.id, token });
    }
  }
  return attackers;
}

// Whether line ③ lets this caller call the operation at all.
async function passesLineThree(
  principal: Principal,
  contract: Contract,
  registry: Registry,
  home: string,
): Promise<{ passes: boolean; slip: Slip | undefined; signerRoles: string[] | undefined }> {
  try {
    const slip = await checkDelegation(principal, contract, registry.delegations, home);
    if (slip === undefined) return { passes: true, slip, signerRoles: undefined };
    // And line ③'s last question, the signer's current authority from her
    // company's directory (step 19's README, decisions 2 and 12).
    const name = JSON.stringify(contract.id);
    const { roles } = await registry.roleSource.authorityOf(home, slip, name);
    return { passes: true, slip, signerRoles: roles };
  } catch {
    return { passes: false, slip: undefined, signerRoles: undefined };
  }
}

/** Why this answer to a foreign request is a finding, or undefined when it is a pass. */
export function judge(answer: Answer): string | undefined {
  // Only TENANT_MISMATCH shows that the company check refused the call. Any other refusal
  // came from another line, for another reason (step 12's README, decision 4).
  if (!("code" in answer)) return "answered with data, not TENANT_MISMATCH";
  if (answer.code !== "TENANT_MISMATCH") return `answered ${answer.code}, not TENANT_MISMATCH`;
  return undefined;
}

/** Why these answers are a finding, or undefined when they are the same. */
export function compare(answers: Answer[]): string | undefined {
  // Word for word, once the request id is set aside: DSoR makes a new one for every call.
  // And the time of each read, which every call's read has of its own.
  // A difference would tell the caller something about the other company, such as
  // whether it has the thing, or exists at all (DSOR-ERR-01b).
  const [first, ...others] = answers.map(forComparing);
  const same = others.every((other) => isDeepStrictEqual(other, first));
  return same ? undefined : "the three answers differ";
}

/**
 * Why the two answers of an in-company pair are a finding, or undefined when they are the
 * same apart from the request id, the time of its read, and the id each request named. An
 * answer may repeat the id it was sent, as "no invoice" does, and that tells the caller
 * nothing new (DSOR-ERR-01b). Found by the Stage 2 review, and fixed from step 12 on.
 */
export function comparePair(answers: Answer[], ids: string[]): string | undefined {
  // Each id as it is written inside JSON text, so it is found there.
  const [named, nobody] = ids.map((id) => JSON.stringify(id).slice(1, -1));
  const [first, second] = answers.map((answer) => JSON.stringify(forComparing(answer)));
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
  sendAsIs: Send = call,
): Promise<Report> {
  // Every command the suite sends carries a key of its own. So the same-company
  // call reaches the command's code, as before, and a refusal at line ⑦ never stands in for
  // the company check (step 20's README, decision 3). Found while building step 20: without
  // keys, every command stopped at line ⑦, and the suite still passed.
  const send: Send = (on, to, request, operation, ...rest) =>
    sendAsIs(
      on,
      to,
      on.contracts.get(operation)?.["kind"] === "command" ? keyed(request) : request,
      operation,
      ...rest,
    );
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
    let example = exampleOf(registry, operation, examples, report.findings);
    // An example with no URI of org_456 has nothing to swap. It is kept
    // only when the operation answers with a page, whose rows are checked instead. If not,
    // it is step 12's finding, word for word (step 13's README, decision 6).
    if (example !== undefined && swaps(example, WRITTEN_IN).length === 0) {
      if (!(await answersWithPage(registry, log, send, operation, example))) {
        report.findings.push(`${operation}: no URI of ${WRITTEN_IN} in its example`);
        example = undefined;
      }
    }
    let everywhere = example !== undefined;
    for (const home of HOMES) {
      const attackers = await attackersOf(registry, operation, home);
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
  if ("code" in answer) {
    if (answer.code === "TENANT_MISMATCH") {
      report.findings.push(`${who}: its same-company call is answered TENANT_MISMATCH`);
    } else if (query) {
      // A query's must answer with data. Then its example names a thing this company has,
      // and the first way of the swap, the same id elsewhere, one the other company has
      // (step 12's README, decision 8). Found by the sweep.
      report.findings.push(`${who}: ${not}: ${answer.code}`);
    }
  } else if (query && (!("data" in answer) || isEmpty(answer.data))) {
    // { data: undefined } is no data either, nor {}, [], or "". Found by the Stage 2 review,
    // and fixed from step 12 on.
    const data = "data" in answer ? (JSON.stringify(answer.data) ?? String(answer.data)) : "none";
    report.findings.push(`${who}: ${not}: the data is ${data}`);
  }
  // This request reaches the operation's own code, and so do the in-company pair's below,
  // so the code's own leaks show here: the answer may hold nothing of another company (C8).
  // The whole answer, a refusal's message too (step 12's README, decision 8). Found by the
  // Stage 2 review, and fixed from step 12 on.
  const what = foreignIn(answer, home, own);
  const said = "its same-company call answered with another company's data";
  if (what !== undefined) report.findings.push(`${who}: ${said}: ${what}`);
  // A list has no URI to swap. Every item of its page must carry this
  // company instead (step 13's README, decision 6). A refusal is a finding above already.
  if (swaps(own, home).length === 0) {
    if ("data" in answer) {
      const why = pageProblem(answer.data, home);
      if (why !== undefined) report.findings.push(`${who}: ${why}`);
    }
    // Then every page after the first. Found by the Stage 2 review, and fixed from step 13
    // on.
    await walk({ ...target, input: own, first: answer, where: who }, request, report);
    // Asked again with only the fields its input schema requires, because a list may leak
    // on a path its example does not take, such as no cursor. Found by the review.
    const input = requiredOf(registry, operation, own);
    const bare = await send(registry, log, request, operation, input);
    const where = `${who}, asked with only its required fields`;
    checkPage(bare, input, home, where, report);
    await walk({ ...target, input, first: bare, where }, request, report);
  }
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

// One page of a list, and what is wrong with it: anything of another
// company in it, then a refusal, or an item that does not carry this company (step 13's
// README, decision 6).
function checkPage(
  page: Answer,
  input: unknown,
  home: string,
  where: string,
  report: Report,
): void {
  // The whole page is searched, as the same-company call is: every key and every text, for
  // the other company's canaries (step 12's README, decision 8). The bare call's page was
  // checked only for its items. Found by the Stage 2 review, and fixed from step 13 on.
  const what = foreignIn(page, home, input);
  const said = "answered with another company's data";
  if (what !== undefined) report.findings.push(`${where}: ${said}: ${what}`);
  const why =
    "data" in page
      ? pageProblem(page.data, home)
      : `it is not answered with data: ${"code" in page ? page.code : page.outcome}`;
  if (why !== undefined) report.findings.push(`${where}: ${why}`);
}

/** One call of a list to follow: what was sent, its first page, and how a finding names it. */
type Walk = Target & { input: unknown; first: Answer; where: string };

/**
 * Follows a list's next_cursor from its first page, and checks every page after it as the
 * first is checked, until a page has no cursor (step 13's README, decision 6). The cursor goes
 * back as the input's cursor, as invoice.list takes it (decisions 1 and 4). After MAX_PAGES
 * pages, the first included, the walk stops and names the list: the pages after them were
 * not checked. The suite read page 1 only, so a row slipped onto page 2 gave no finding.
 * Found by the Stage 2 review, and fixed from step 13 on.
 */
async function walk(list: Walk, request: RequestEnvelope, report: Report): Promise<void> {
  const { registry, log, send, operation, home, input, where } = list;
  let page = list.first;
  for (let number = 2; ; number++) {
    const data = "data" in page ? (page.data as { next_cursor?: unknown } | null) : null;
    const cursor = data?.next_cursor;
    if (cursor === undefined) return;
    if (number > MAX_PAGES) {
      const said = `its cursor had not ended after ${MAX_PAGES} pages`;
      report.findings.push(`${where}: ${said}, so the pages after them were not checked`);
      return;
    }
    const next = { ...(input as object), cursor };
    page = await send(registry, log, request, operation, next);
    checkPage(page, next, home, `${where}, page ${number}`, report);
  }
}

/**
 * The operation's example, or undefined, with a finding that says why there is none to use:
 * no example, one that is not JSON, or one that line ⑥ would refuse (step 12's README,
 * decision 2). One that holds no URI of org_456 is decided by the operation's answer
 * (step 13's README, decision 6).
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
  return example;
}

// Asked once, as the first caller of org_456 who may call it, with the
// example as it is (step 13's README, decision 6). With no such caller, or for a command,
// the answer is no.
/** Whether the operation answers its example with a page. */
async function answersWithPage(
  registry: Registry,
  log: DecisionLog,
  send: Send,
  operation: string,
  example: unknown,
): Promise<boolean> {
  // Only a query is asked. A command that runs would change something. Found by the review.
  if (registry.contracts.get(operation)?.["kind"] !== "query") return false;
  const first = (await attackersOf(registry, operation, WRITTEN_IN))[0];
  if (first === undefined) return false;
  const request = { token: first.token, tenant: WRITTEN_IN };
  const answer = await send(registry, log, request, operation, example);
  return "data" in answer && isPage(answer.data);
}

// The example with only the fields its input schema requires, {} for
// invoice.list (step 13's README, decision 6).
function requiredOf(registry: Registry, operation: string, example: unknown): unknown {
  const schema = registry.inputs.get(operation)?.schema as { required?: unknown } | undefined;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const fields = Object.entries(example as object);
  return Object.fromEntries(fields.filter(([field]) => required.includes(field)));
}
