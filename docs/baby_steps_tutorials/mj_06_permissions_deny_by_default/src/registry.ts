// Every operation has a name and a contract, checked at start-up.
// DSOR-OPR-01, DSOR-OPR-02a, DSOR-OPR-02b in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import { checkPermission, checkRoles, type RoleSource, type Roles } from "./permissions.ts";
import { callerIds, checkNamedPrincipals, logins, whoIsCalling } from "./principals.ts";
import { checkRequestId, usableRequestId, type RequestEnvelope } from "./request.ts";

/** One contract file, as it was read from disk: its name and its text. */
export type ContractSource = { file: string; text: string };

/** A contract that passed the schema. It is kept exactly as it was written. */
export type Contract = { readonly id: string; readonly [field: string]: unknown };

/** The code that runs an operation. */
export type Handler = (input: unknown) => unknown;

/** Every operation this program knows, each with its contract, and code for some. */
export type Registry = {
  contracts: ReadonlyMap<string, Contract>;
  handlers: ReadonlyMap<string, Handler>;
  // NEW IN STEP 06: what each role grants (step 06's README, decision 1).
  roles: Roles;
};

// The specification's own schemas, copied byte for byte (step 03's README, decision 3).
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}

// Ajv2020, because the schemas are written in the 2020-12 edition of JSON Schema.
// allErrors: name every problem, not only the first. The next three are off by default.
// They are written here because each one changes the contract while checking it, and
// DSOR-OPR-02b says the contract is kept as it was written. strict is off because strict
// mode refuses to read the specification's schema (step 03's README, decision 5).
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
const validateContract = ajv.compile(loadSchema("operation-contract.schema.json"));

/** Reads every contract file in a folder. */
export function readContracts(dir: string): ContractSource[] {
  const files = contractFiles(readdirSync(dir));
  return files.map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));
}

/** The contract files among a folder's file names, in name order. */
export function contractFiles(names: string[]): string[] {
  // Sorted, so the problems are always named in the same order. A folder may list its
  // files in any order. macOS lists them by name anyway, so only a test of this
  // function, not of a real folder, sees a missing sort there.
  return names.filter((file) => file.endsWith(".json")).sort();
}

/** Checks every contract and every handler, and refuses to build if anything is wrong. */
export function buildRegistry(
  sources: ContractSource[],
  handlers: Record<string, Handler>,
  // NEW IN STEP 06: the role table, checked with the contracts (step 06's README, decision 1).
  roleSource: RoleSource,
): Registry {
  // Every problem is collected first, and the refusal names them all (step 03's
  // README, decision 2).
  const problems: string[] = [];
  const contracts = new Map<string, Contract>();
  // Which file first wrote each id, broken files too. So two files with one id are named
  // at once, and the code for a broken contract is not also called "no contract".
  const fileOf = new Map<string, string>();

  for (const { file, text } of sources) {
    // The text is parsed here and checked at once. Nothing touches it in between.
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      problems.push(`${file}: not valid JSON`);
      continue;
    }
    // JSON.parse keeps the last of two values for one key, and says nothing. Keeping one
    // would be a guess, as with two contracts for one id (step 03's README, decision 7).
    // Found by step 06's review, and fixed from step 03 on.
    for (const key of keysWrittenTwice(text)) {
      problems.push(`${file}: ${JSON.stringify(key)} is written twice in one object`);
    }
    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id === "string") {
      const first = fileOf.get(id);
      // Keeping one of two would be a guess about which one the author meant.
      if (first === undefined) fileOf.set(id, file);
      else problems.push(`${preview(id)} has two contracts: ${first} and ${file}`);
    }

    if (!validateContract(data)) {
      for (const error of validateContract.errors ?? [])
        problems.push(`${file}: ${explain(error)}`);
      continue;
    }
    contracts.set((data as Contract).id, data as Contract);
  }

  // A Map, not the plain object: a plain object already has "toString" and "constructor".
  const code = new Map<string, Handler>();
  for (const [name, handler] of Object.entries(handlers)) {
    if (!fileOf.has(name)) problems.push(`${name} has code but no contract`);
    code.set(name, handler);
  }

  // NEW IN STEP 06: the role table, and every role in DSoR's table of logins, are checked
  // too. Their problems are named with the contracts' problems (DSOR-AUT-01a).
  const { roles, problems: roleProblems } = checkRoles(roleSource, logins.values());
  problems.push(...roleProblems);

  if (problems.length > 0) {
    throw new Error(`the registry refused to start:\n  ${problems.join("\n  ")}`);
  }
  return { contracts, handlers: code, roles };
}

/** Runs an operation by its name. It answers with an envelope, and never throws. */
export function call(
  registry: Registry,
  // The request envelope, beside the arguments (step 05's README, decision 1).
  request: RequestEnvelope,
  name: string,
  input: unknown,
): Answer {
  // DSoR makes a request id first, so every answer carries one (DSOR-COR-01b).
  let correlation: Correlation = { request_id: `req_${randomUUID()}` };
  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  try {
    // The caller's own request id labels every answer, when DSoR can use it, and a bad one
    // is refused below (step 05's README, decisions 6 and 7). Nothing in the input is read
    // for it. It is read inside the try, so an envelope whose request_id cannot be read
    // gets an answer, not a throw. Found by step 07's review, and fixed from step 05 on.
    correlation = { request_id: usableRequestId(request) ?? correlation.request_id };
    // Who is calling is found before anything is checked (DSOR-IDN-01),
    // from the token and DSoR's own table only (DSOR-SRC-02a). From here, answers name it.
    const caller = whoIsCalling(request);
    correlation = { ...correlation, ...callerIds(caller) };
    // Then what the caller sent is checked: first any principal the
    // arguments name (DSOR-SRC-02b), then the request id (step 05's README, decisions 6 and 7).
    checkNamedPrincipals(input, caller);
    checkRequestId(request);
    // NEW IN STEP 06: the contract is kept, because the permission it names is checked next.
    const contract = registry.contracts.get(name);
    if (contract === undefined) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `no operation named ${preview(name)}`);
    }
    // NEW IN STEP 06: the caller must hold that permission, or the call is denied
    // (DSOR-AUT-01b). It is checked before "is it built", so "not allowed" is never
    // answered as "not built yet" (step 06's README, C5).
    checkPermission(caller, contract, registry.roles);
    const handler = registry.handlers.get(name);
    if (!handler) throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} is not built yet`);
    // A command's success needs a result envelope, and that needs a
    // proposal (step 22). So a command is refused before its code runs (step 04's
    // README, decision 1). NEW IN STEP 06: it reads the contract found above.
    if (contract["kind"] !== "query") {
      const why = "is a command, and commands are not built yet";
      throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} ${why}`);
    }
    // A query's answer is { data, correlation } (step 04's README, decision 3).
    return { data: handler(input), correlation };
  } catch (thrown) {
    return toEnvelope(thrown, correlation);
  }
}

// One problem, as ajv found it: where in the contract, and what is wrong there.
function explain(error: ErrorObject): string {
  const where = error.instancePath === "" ? "" : `${error.instancePath} `;
  const field = error.params["additionalProperty"];
  return `${where}${error.message}${field === undefined ? "" : `: ${JSON.stringify(field)}`}`;
}

// The refused input may be anything, even something huge. Show a short piece of it.
// Exported, so a handler's refusal can show a piece of the input too.
export function preview(input: unknown): string {
  return typeof input === "string" ? JSON.stringify(input.slice(0, 60)) : typeof input;
}
