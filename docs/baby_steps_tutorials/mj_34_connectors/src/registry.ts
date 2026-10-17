// Every operation has a name and a contract, checked at start-up.
// DSOR-OPR-01, DSOR-OPR-02a, DSOR-OPR-02b in specs/dsor/01-model.md, section 7.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import {
  checkRoleSettings,
  createRoleSource,
  readRoleSettings,
  type RoleSettingsSource,
  type RoleSource,
} from "./authority.ts";
import { bindProblems } from "./bound.ts";
import { exclusiveProblems } from "./inflight.ts";
import { freshnessProblems } from "./preconditions.ts";
import { NO_BRAKES, type BrakeStore } from "./brakes.ts";
import { keyProblems, memoryClaims, type ClaimStore } from "./claims.ts";
import { concurrencyProblems } from "./concurrency.ts";
import {
  checkConnectors,
  readConnectors,
  type ConnectorsSource,
  type Plugs,
} from "./connectors.ts";
import {
  checkClassifications,
  readClassifications,
  type ClassificationSource,
  type Kinds,
} from "./labels.ts";
import type { Company } from "./company.ts";
import { NO_DIRECTORIES, type Directories } from "./directory.ts";
import { checkCondition } from "./cel.ts";
import { ruleName, ruleProblems } from "./controls.ts";
import { NO_KSORS, type Ksors } from "./ksor.ts";
import { NO_CONTROLS, type ControlStore, type RuleCheck } from "./rulebook.ts";
import { checkInputs, readInputs, type InputChecks, type InputSource } from "./inputs.ts";
import { NO_STORE, type InvoiceStore } from "./invoice.ts";
import { keysWrittenTwice } from "./json.ts";
import {
  checkLifetimes,
  readLifetimes,
  type Lifetimes,
  type LifetimesSource,
} from "./lifetimes.ts";
import {
  checkMoneyPolicies,
  readMoneyPolicies,
  type MoneyPolicies,
  type PoliciesSource,
} from "./policies.ts";
import { maskingProblems } from "./masking.ts";
import { NO_PAYMENTS, type PaymentStore } from "./payment.ts";
import {
  approvePermissionOf,
  checkRoles,
  proposeProblems,
  type RoleTableSource,
  type Roles,
} from "./permissions.ts";
import { releaseProblems, releases } from "./release.ts";
import { ownProblems, type OwnWork } from "./revocation.ts";
import { undoProblems } from "./semantics.ts";
import { NO_SLIPS, type SlipStore } from "./slips.ts";
import { loginProblems, logins } from "./principals.ts";

/** One contract file, as it was read from disk: its name and its text. */
export type ContractSource = { file: string; text: string };

/** A contract that passed the schema. It is kept exactly as it was written. */
export type Contract = { readonly id: string; readonly [field: string]: unknown };

// The code is given the active company, which line ② checked. It never
// takes one from the input (step 10's README, decision 3). It gets that company's invoices
// only, never the store itself (step 10's README, decision 13). Found by the Stage 2
// review, and fixed from step 10 on.
/** The code that runs an operation, inside one company. */
export type Handler = (input: unknown, company: Company) => unknown;

/** Every operation this program knows, each with its contract, and code for some. */
export type Registry = {
  contracts: ReadonlyMap<string, Contract>;
  handlers: ReadonlyMap<string, Handler>;
  // What each role grants (step 06's README, decision 1).
  roles: Roles;
  // The check for each operation's input (step 07's README, decision 2).
  inputs: InputChecks;
  // Each field's label (step 14's README, decision 1).
  classifications: Kinds;
  // The store the operations read. Only the pipeline uses it, to give the code the active
  // company's invoices (step 10's README, decision 13). Found by the Stage 2 review, and
  // fixed from step 10 on.
  invoices: InvoiceStore;
  // The store the commands write, held beside the invoices (step 17's
  // README, outcome 1). Only the pipeline uses it, as it uses the invoices.
  payments: PaymentStore;
  // The permission slips, held in DSoR's own store. Only line ③ reads them
  // (DSOR-DEL-01a; step 18's README, decision 3).
  delegations: SlipStore;
  // Each company's role source: its setting, its directory, and the answers
  // DSoR keeps. Only line ③ asks it (DSOR-IDN-05; step 19's README, decisions 1, 3, and 8).
  roleSource: RoleSource;
  // The claims of idempotency keys. Only line ⑦ uses them, and the command's
  // code works inside them (DSOR-IDM-01b; step 20's README, decision 6).
  claims: ClaimStore;
  // DSoR's own work, for the commands that change DSoR's own store, kept apart
  // from the company's code (step 25's README, decision D2).
  own: ReadonlyMap<string, OwnWork>;
  // The brakes, held in DSoR's own store. Line ④ reads them (DSOR-OPS-01b; step
  // 25b's README, decision D3).
  brakes: BrakeStore;
  // Each company's READY lifetime, checked at start-up. Line ⑧ gives it to the
  // store, which sets each proposal's expiry (step 25c's README, decisions L2 and D2).
  lifetimes: Lifetimes;
  // Each company's money policy, checked at start-up. Line ⑩ reads its rate source
  // and its max_rate_age when it converts (step 26's README, decision L3).
  moneyPolicies: MoneyPolicies;
  // Each company's controls that line ⑩ evaluates, checked and tested at
  // start-up (DSOR-CTL-01a, DSOR-CTL-02c; step 27's README, decisions D1 to D3).
  // In a store, which line ⑩ reads at every call, and DSoR's own work changes
  // (step 28's README, decisions D2 and D5).
  controls: ControlStore;
  // The check of one control, with this registry's contracts and money policies,
  // which start-up, rule.draft, and rule.activate run (step 28's README, decisions D6, D11, and
  // D12).
  checkRule: RuleCheck;
  // Each company's KSoR, which DSoR's own work asks which version of a policy is
  // in force (step 28b's README, decisions D1 and D2).
  ksors: Ksors;
  // NEW IN STEP 34: which connector holds each company's records, and whether it is in service.
  //   Line ④ reads it (DSOR-CNR-01b; step 34's README, decision D3).
  plugs: Plugs;
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
  // The role table, checked with the contracts (step 06's README, decision 1).
  roleTable: RoleTableSource,
  // The input schemas. This step's own, unless the caller gives others.
  inputSources: InputSource[] = readInputs(),
  // The labels. This step's own, unless the caller gives others.
  classificationSource: ClassificationSource = readClassifications(),
  // The store the operations read: the database for the program, memory for the unit
  // tests. Without one, every read fails (step 10's README, decision 13). Found by the
  // Stage 2 review, and fixed from step 10 on.
  invoices: InvoiceStore = NO_STORE,
  // The store of payments. Without one, every write fails, as every read
  // fails without a store of invoices.
  payments: PaymentStore = NO_PAYMENTS,
  // The store of slips. Without one, no agent holds a slip, so every call
  // from an agent is refused at line ③.
  delegations: SlipStore = NO_SLIPS,
  // Each company's directory. Without one, nobody's job is known, so every
  // call from an agent is refused at line ③ (step 19's README, decision 1).
  directories: Directories = NO_DIRECTORIES,
  // Each company's role source setting. This step's own, unless the caller
  // gives others (step 19's README, decision 8).
  roleSettings: RoleSettingsSource = readRoleSettings(),
  // The claims of idempotency keys. In memory, beside these stores, unless the
  // caller gives others. The program and the database tests give the database's (step 20's
  // README, decision 6).
  // Beside these slips too, so DSoR's own work tears up the slips that line ③ reads.
  claims: ClaimStore = memoryClaims(invoices, payments, undefined, undefined, delegations),
  // DSoR's own work. None, unless the caller gives it: the program and the tests
  // of DSoR's own commands give ownWorkFor() (step 25's README, decision D2).
  own: Record<string, OwnWork> = {},
  // The brakes. None, unless the caller gives them, so line ④ finds no brake.
  // The claims above must be given the same ones, so that a pull is seen by line ④.
  brakes: BrakeStore = NO_BRAKES,
  // Each company's READY lifetime. This step's own file, unless the caller gives
  // another (step 25c's README, decision D2).
  lifetimeSource: LifetimesSource = readLifetimes(),
  // Each company's money policy. This step's own file, unless the caller gives
  // another (step 26's README, decision L3).
  policySource: PoliciesSource = readMoneyPolicies(),
  // Each company's controls.
  // A store of them. None, unless the caller gives one, so a world of an earlier
  // step's idea has no rule. The claims above must be given the same store, so that a change one
  // command makes is the change that line ⑩ reads, as with the brakes (step 28's README, decisions
  // D5 and D18).
  controls: ControlStore = NO_CONTROLS,
  // Each company's KSoR. None, unless the caller gives them, so no policy is
  // known: no version that cites one can be switched on, and the sweep hears no answer (step 28b's
  // README, decision D1).
  ksors: Ksors = NO_KSORS,
  // NEW IN STEP 34: the connectors, and the companies each one serves. This step's own file,
  //   unless the caller gives another (step 34's README, decisions D1 and D3).
  connectorSource: ConnectorsSource = readConnectors(),
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

  // And DSoR's own work, which must have a contract, must not share a name with
  // the company's code, and must be a command (step 25's README, decision D2).
  problems.push(...ownProblems(own, new Set(fileOf.keys()), contracts, code));
  const ownWork = new Map<string, OwnWork>(Object.entries(own));

  // The role table, and every role in DSoR's table of logins, are checked too. Their
  // problems are named with the contracts' problems (DSOR-AUT-01a).
  const { roles, problems: roleProblems } = checkRoles(roleTable, logins.values());
  problems.push(...roleProblems);
  // Every undo a contract names is a real command that DSoR can run, and
  // that some role may run, so a label that says "can be undone" is true (DSOR-EXE-05c; step
  // 17's README, decision 8). After the roles, which it reads. Its problems are named with
  // the others.
  problems.push(...undoProblems(contracts, code, roles));
  // And every command requires an idempotency key, and no query does, so the
  // contract promises callers what line ⑦ does (DSOR-IDM-01a; step 20's README, decision 3).
  problems.push(...keyProblems(contracts.values()));
  // And no contract names a .propose form as the permission it needs (step 23's
  // README, decision 14).
  problems.push(...proposeProblems(contracts.values()));
  // And only proposal.execute is a release, whose caller line ⑨ decides, and it
  // says so (step 31's README, decision D12).
  problems.push(...releaseProblems(contracts.values()));
  // And every bind is a path line ⑨ can read, and every spends names a bound
  // invoice (step 24's README, decision 2).
  problems.push(...bindProblems(contracts.values()));
  // And a HIGH or CRITICAL command's preconditions are read current, unless its
  //   contract permits bounded staleness with an age (DSOR-FRS-02a; step 32's README, decision D5).
  problems.push(...freshnessProblems(contracts.values()));
  // And what a command is exclusive over (step 32's README, decision D6).
  problems.push(...exclusiveProblems(contracts.values()));
  // And every command's strategy is one this step keeps, and an optimistic
  // command's input asks for the version its caller decided on (DSOR-CON-01a; step 21's README,
  // decision 10).
  problems.push(...concurrencyProblems(contracts.values(), inputSources));
  // And every clearance in the table must be one of the four labels, or none, and every
  // type one of the four kinds of caller (step 14's README, decisions 2 and 5). Found by the
  // Stage 2 review, and fixed from step 14 on.
  problems.push(...maskingProblems(logins.values()));
  // And one name, one principal, because line ③ finds a slip's signer by
  // name (step 18's README, decision 19).
  problems.push(...loginProblems(logins.values()));
  // And every company where a login works has a role source setting that
  // this step can use, within the bound of §44 (DSOR-IDN-05, DSOR-BND-02; step 19's README,
  // decision 8). Its problems are named with the others.
  const { settings, problems: settingProblems } = checkRoleSettings(roleSettings, logins.values());
  problems.push(...settingProblems);
  // And every company where a login works has a READY lifetime, more than zero and
  // at most §44's 30 days for an approval (step 25c's README, claim C6).
  const { lifetimes, problems: lifetimeProblems } = checkLifetimes(lifetimeSource, logins.values());
  problems.push(...lifetimeProblems);
  // And every company where a login works has a money policy, as the
  // specification's schema has it, with a max_rate_age within §44's 7 days (step 26's README,
  // claim C6).
  const { policies: moneyPolicies, problems: policyProblems } = checkMoneyPolicies(
    policySource,
    logins.values(),
  );
  problems.push(...policyProblems);
  // And each control, against control.schema.json, with a condition in CEL, on a
  // command with the company's own code, and with every test passing before line ⑩ may evaluate
  // it (DSOR-CTL-01a, DSOR-CTL-05, DSOR-CTL-02c; step 27's README, decisions D2 and D18).
  const governable = (operation: string): string | undefined => {
    const contract = contracts.get(operation);
    // A contract that a file wrote and start-up refused is named once, with its own problem.
    if (contract === undefined) return fileOf.has(operation) ? undefined : "which no contract has";
    if (contract["kind"] !== "command") return "which is a query: a query waits for nobody";
    if (ownWork.has(operation)) return "which is DSoR's own: it must answer at once";
    if (!code.has(operation)) return "which has no code of the company's";
    return undefined;
  };
  // The operation's risk level, which a condition reads as `risk` (Appendix B).
  const riskOf = (operation: string): string =>
    String((contracts.get(operation)?.["risk"] as { level?: unknown } | undefined)?.level ?? "");
  // The check of one control, which no longer runs here: a store is read at
  //   start-up, and a read of the database waits (step 28's README, decision D6).
  const checkRule: RuleCheck = (tenant, raw, tests, place = 1) => {
    const policy = moneyPolicies.get(tenant);
    if (policy === undefined)
      return [`${tenant} has controls, and no money policy to count them in`];
    // And who approves each operation, and who may call proposal.approve at all
    // (step 29's README, decision D13).
    const approvePermission = (operation: string): string | undefined =>
      approvePermissionOf(contracts.get(operation));
    const approving = contracts.get("proposal.approve")?.["authorization"] as
      | { permission?: unknown }
      | undefined;
    const approveCall =
      typeof approving?.permission === "string" ? approving.permission : undefined;
    const context = { governable, riskOf, policy, roles, approvePermission, approveCall };
    return ruleProblems(ruleName(tenant, raw, place), raw, tenant, context, tests);
  };
  // And each contract's predicates are CEL in Appendix B's environment, as a
  // control's condition is (DSOR-CTL-05).
  // Line ⑨ evaluates a command's predicates now, so a command that runs code may
  //   list them. A query's line ⑨ is its code's read, which evaluates none, so a query that runs
  //   code still may not: a predicate that is never evaluated would let through a call that it
  //   should stop. Step 27's review, finding M3, refused them on every operation that runs code
  //   (step 27's README, decision D20).
  for (const contract of contracts.values()) {
    const listed = (contract["preconditions"] as { predicates?: unknown } | undefined)?.predicates;
    const predicates = Array.isArray(listed) ? (listed as unknown[]) : [];
    for (const predicate of predicates) {
      const broken = checkCondition(String(predicate));
      if (broken === undefined) continue;
      const said = broken.startsWith("it ") ? broken.slice(3) : broken;
      problems.push(`${contract.id}: its predicate ${JSON.stringify(predicate)} ${said}`);
    }
    const runs = code.has(contract.id) || ownWork.has(contract.id);
    if (predicates.length > 0 && runs && contract["kind"] !== "command") {
      problems.push(`${contract.id}: it lists predicates, which no step evaluates for a query`);
    }
    // And a release's own: it checks the stored request's preconditions, never its
    //   own, so a predicate in its contract would be taken and skipped. Found by step 32's review,
    //   finding L2: the predicate false on proposal.execute, and the release was COMMITTED.
    if (predicates.length > 0 && releases(contract)) {
      problems.push(
        `${contract.id}: it lists predicates, which a release never evaluates: it checks the stored request's`,
      );
    }
  }

  // Every contract's input schema must have a file, and compile. A contract
  // with no check for its input would let anything through line ⑥.
  const { inputs, problems: inputProblems } = checkInputs(contracts.values(), inputSources);
  problems.push(...inputProblems);

  // A label that is not one of the four stops start-up, with the rest.
  const { kinds, problems: labelProblems } = checkClassifications(classificationSource);
  problems.push(...labelProblems);
  // Every contract's output kind must have its lines, or its answer would be masked by
  // "confidential" alone and name no row in its record (step 14's README, decisions 1 and
  // 7). Found by the Stage 2 review, and fixed from step 14 on.
  for (const contract of contracts.values()) {
    const kind = (contract["output"] as { schema: string }).schema;
    if (!kinds.has(kind)) {
      const where = "has no entry in classifications.json";
      problems.push(`${contract.id}: its output kind ${JSON.stringify(kind)} ${where}`);
    }
  }

  // NEW IN STEP 34: every connector's declaration, against connector.schema.json, and against what
  //   each operation on the company's records needs: an operation with the company's code, and the
  //   release, which runs one (DSOR-CNR-01a, DSOR-CNR-01b; step 34's README, decisions D2 and D3).
  //   DSoR's own commands work on DSoR's own store, and no connector serves them.
  const routed = (contract: Contract): boolean => code.has(contract.id) || releases(contract);
  const { plugs, problems: connectorProblems } = checkConnectors(
    connectorSource,
    contracts.values(),
    routed,
  );
  problems.push(...connectorProblems);

  if (problems.length > 0) {
    throw new Error(`the registry refused to start:\n  ${problems.join("\n  ")}`);
  }
  return {
    contracts,
    handlers: code,
    roles,
    inputs,
    classifications: kinds,
    invoices,
    payments,
    delegations,
    roleSource: createRoleSource(settings, directories),
    claims,
    own: ownWork,
    brakes,
    lifetimes,
    moneyPolicies,
    controls,
    checkRule,
    ksors,
    plugs,
  };
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
