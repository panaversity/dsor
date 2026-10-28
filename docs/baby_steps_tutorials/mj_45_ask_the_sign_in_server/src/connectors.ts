// Connectors. A connector is DSoR's adapter for one outside system, and it publishes
// a declaration of what that system can do (DSOR-CNR-01a in specs/dsor/05-bindings.md, section 35).
// DSoR works out what each operation needs, and routes an operation only to a connector that
// declares it (DSOR-CNR-01b). In this step there is one connector, "accounting": the company's
// records, invoices, vendors, and payments, in the same database as DSoR's own store (step 34's
// README, decisions D1 and D2). The file connectors.json says which connector holds each company's
// records. Start-up checks it: a broken default connector stops start-up, and a broken connector
// that serves named companies only puts those companies' records out of service, so one company's
// mistake never stops another (decision D4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { BankLine } from "./bank.ts";
import type { Contract } from "./registry.ts";
import { Refusal } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import { isTenantId } from "./uri.ts";

/** One connector's declaration, once its schema has passed. */
export type Declaration = {
  id: string;
  capabilities: Record<string, unknown>;
  write_exclusivity: "exclusive" | "shared";
  extensions?: Record<string, unknown>;
};

/** The connectors file, as it was read from disk: its name and its text. */
export type ConnectorsSource = { file: string; text: string };

// A company names two connectors: one for its records, and one for its bank, from
//   which its payments are sent (step 35's README, decision D4).
/** A company's two connectors, by id. */
export type CompanyPlugs = { records: string; bank: string };

/** Which connectors serve each company, and why one is out of service. */
export type Plugs = {
  // The connectors of a company: its own, or the default's, "*".
  connectorOf: (tenant: string) => CompanyPlugs;
  // Why this company's connectors cannot take this operation, or undefined when they can.
  outOfService: (tenant: string, operation: string) => string | undefined;
  // Each operation that works on the company's records, with what it needs of the records'
  //   connector (decision D2).
  needs: ReadonlyMap<string, readonly Need[]>;
  // Each operation that sends money, and the release, which may run one, with what
  //   it needs of the bank (DSOR-UNK-03a; step 35's README, decision D2).
  bankNeeds: ReadonlyMap<string, readonly Need[]>;
  // The company's bank, with how long DSoR waits for it, when it is in service.
  bankOf: (tenant: string) => BankLine | undefined;
  // Why each connector that serves named companies only is out of service, for the people who run
  //   DSoR. Start-up shows them, and no caller hears them (step 34's review, F3).
  warnings: readonly string[];
};

/** One need: any one of these is enough. A capability, "freshness:<level>", or SHARED. */
export type Need = readonly string[];

// This step's own need of a command: its connector's store shares a transaction with DSoR's own
// store, so the claim, the work, and the record commit together (DSOR-EXE-04a; decision D1).
export const SHARED = "shares_dsor_transaction";
const STEPS = "org.panaversity.steps";

const SHIPPED = fileURLToPath(new URL("../connectors.json", import.meta.url));

// DSoR's own commands that read the company's records: an approval binds the state it was given
//   on, and reads it through the connector (src/approve.ts). Found by step 34's review, F2: it was
//   left out, and cfo_100 approved through a connector that was out of service (decision D3).
// And payment.reconcile, which marks a payment paid once the bank says it was sent
//   (step 38's README, decision D2).
export const READS_COMPANY_RECORDS: ReadonlySet<string> = new Set([
  "proposal.approve",
  "payment.reconcile",
]);

// The operations that send money through the company's bank. A list, as the one
//   above: no field of a contract says which system an operation's side effect reaches (step 35's
//   README, decision D4).
export const SENDS_MONEY: ReadonlySet<string> = new Set(["payment.execute"]);

// The operations that ask the company's bank and send nothing: what it needs of the
//   bank is its contract's connector_requirements, outcome_lookup (step 38's README, decision D1).
export const ASKS_BANK: ReadonlySet<string> = new Set(["payment.reconcile"]);

/** Reads the connectors file: this step's own, unless another is named. */
export function readConnectors(path: string = SHIPPED): ConnectorsSource {
  return { file: "connectors.json", text: readFileSync(path, "utf8") };
}

// The specification's schemas, copied byte for byte (step 03's README, decision 3).
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
const validateDeclaration = ajv.compile(loadSchema("connector.schema.json"));
const CAPABILITIES = new Set(
  Object.keys(
    (
      loadSchema("connector.schema.json") as {
        properties: { capabilities: { properties: object } };
      }
    ).properties.capabilities.properties,
  ),
);

// not copied: this tutorial's own form for a connector's id and region, stricter than the schema's
// strings, so neither can carry a URL with a password in it (DSOR-CNR-02; decision D5).
const NAME = /^[a-z][a-z0-9_-]{0,62}$/;

/**
 * What one operation needs from its connector: what its contract's connector_requirements says,
 * and what follows from its execution semantics, its concurrency, its freshness, and its kind
 * (decision D2). An unknown requirement is a problem, never skipped.
 * Of the records' connector, or of the bank. For an operation that sends money, the
 *   contract's own requirements and its non_compensatable semantics are about the bank, and the
 *   rest about the records it reads and marks (step 35's README, decision D2).
 */
export function needsOf(
  contract: Contract,
  role: "records" | "bank" = "records",
): { needs: Need[]; problems: string[] } {
  const needs: Need[] = [];
  const problems: string[] = [];
  const execution = contract["execution"] as { semantics?: unknown } | undefined;
  // Changed in step 38: or asks the bank, which a reconcile does.
  const money = SENDS_MONEY.has(contract.id) || ASKS_BANK.has(contract.id);
  if (role === "bank") {
    if (!money) return { needs, problems };
  } else if (money) {
    return { needs: recordNeeds(contract), problems };
  }
  const asked = (contract["connector_requirements"] ?? {}) as Record<string, unknown>;
  for (const [key, required] of Object.entries(asked)) {
    // "downstream_idempotency_or_outcome_lookup" asks for either (§7's example).
    const either = key.split("_or_");
    const unknown = either.filter((name) => !CAPABILITIES.has(name) || name === "freshness");
    if (unknown.length > 0) {
      problems.push(
        `${contract.id}: connector_requirements names ${JSON.stringify(key)}, which no connector declares`,
      );
    } else if (required === true) needs.push(either);
  }
  if (role === "bank") {
    // What cannot be undone goes only where a repeat is refused or the outcome can be asked
    //   (DSOR-UNK-03a). Once, when the contract asks for the same already.
    const either = ["downstream_idempotency", "outcome_lookup"];
    const asked = needs.some((need) => need.join() === either.join());
    if (execution?.semantics === "non_compensatable" && !asked) needs.push(either);
    return { needs, problems };
  }
  needs.push(...recordNeeds(contract));
  return { needs, problems };
}

/** What follows, for the records' connector, from a contract's semantics, concurrency, freshness, and kind. */
function recordNeeds(contract: Contract): Need[] {
  const needs: Need[] = [];
  const execution = contract["execution"] as { semantics?: unknown } | undefined;
  if (execution?.semantics === "atomic") needs.push(["transactions"]);
  const concurrency = contract["concurrency"] as { strategy?: unknown } | undefined;
  if (concurrency?.strategy === "optimistic") needs.push(["optimistic_concurrency"]);
  const freshness = (contract["preconditions"] as { freshness?: unknown } | undefined)?.freshness;
  // A current read is fresher than any bound, so it satisfies bounded_staleness too.
  if (freshness === "current") needs.push(["freshness:current"]);
  if (freshness === "bounded_staleness") {
    needs.push(["freshness:bounded_staleness", "freshness:current"]);
  }
  if (contract["kind"] === "command") needs.push([SHARED]);
  return needs;
}

/** Whether a declaration meets one need. */
function meets(declaration: Declaration, need: Need): boolean {
  return need.some((name) => {
    if (name === SHARED) return shares(declaration);
    if (name.startsWith("freshness:")) {
      const levels = declaration.capabilities["freshness"] as unknown[];
      return levels.includes(name.slice("freshness:".length));
    }
    return declaration.capabilities[name] === true;
  });
}

function shares(declaration: Declaration): boolean {
  const ours = declaration.extensions?.[STEPS] as Record<string, unknown> | undefined;
  return ours?.[SHARED] === true;
}

/** Why one declaration cannot be used, in words, or none: its schema, its names, its extensions. */
function declarationProblems(raw: unknown, place: number): string[] {
  const where = `connector ${place}`;
  if (!validateDeclaration(raw)) {
    return (validateDeclaration.errors ?? []).map((error) => `${where}: ${explain(error)}`);
  }
  const declaration = raw as Declaration & { region: string };
  const problems: string[] = [];
  if (!NAME.test(declaration.id)) problems.push(`${where}: its id must be a short lowercase name`);
  if (!NAME.test(declaration.region))
    problems.push(`${where}: its region must be a short lowercase name`);
  // The declaration is published, so it holds nothing DSoR does not read: in its extensions,
  // only this step's one flag (DSOR-CNR-02; decision D5).
  const extensions = declaration.extensions ?? {};
  const ours = extensions[STEPS];
  const fields = typeof ours === "object" && ours !== null ? Object.keys(ours) : [];
  const onlyOurs = Object.keys(extensions).every((key) => key === STEPS);
  if (
    !onlyOurs ||
    fields.some((field) => field !== SHARED) ||
    (ours !== undefined && fields.length === 0)
  ) {
    problems.push(`${where}: its extensions may hold only ${STEPS}.${SHARED}`);
  } else if (ours !== undefined && typeof (ours as Record<string, unknown>)[SHARED] !== "boolean") {
    problems.push(`${where}: its ${SHARED} must be true or false`);
  }
  // The schema leaves change_detection and field_fidelity open, so a key could hide in them. This
  //   step allows only what DSoR reads (step 34's review, F4).
  const detection = (raw as { change_detection?: object }).change_detection;
  if (
    detection !== undefined &&
    Object.keys(detection).some((key) => !["method", "max_detection_lag_seconds"].includes(key))
  ) {
    problems.push(
      `${where}: its change_detection may hold only method and max_detection_lag_seconds`,
    );
  }
  const fidelity = (raw as { field_fidelity?: Record<string, object> }).field_fidelity ?? {};
  const names = Object.entries(fidelity).flatMap(([entity, fields]) => [
    entity,
    ...Object.keys(fields),
  ]);
  if (names.some((name) => !NAME.test(name))) {
    problems.push(
      `${where}: its field_fidelity names an entity or a field that is not a short lowercase name`,
    );
  }
  return problems;
}

/** Checks the connectors file against the operations that work on the company's records and money. */
export function checkConnectors(
  source: ConnectorsSource,
  contracts: Iterable<Contract>,
  routed: (contract: Contract) => boolean,
  // The banks DSoR can call, by connector id (step 35's README, decision D1).
  banks: ReadonlyMap<string, BankLine> = new Map(),
  // Whether an operation is the release, which may run a payment that sends money.
  releases: (contract: Contract) => boolean = () => false,
): { plugs: Plugs; problems: string[] } {
  const { file, text } = source;
  const problems: string[] = [];
  const needs = new Map<string, Need[]>();
  const bankNeeds = new Map<string, Need[]>();
  const list = [...contracts];
  for (const contract of list) {
    if (!routed(contract)) continue;
    const found = needsOf(contract);
    problems.push(...found.problems);
    needs.set(contract.id, found.needs);
    const forBank = needsOf(contract, "bank");
    problems.push(...forBank.problems);
    if (SENDS_MONEY.has(contract.id) || ASKS_BANK.has(contract.id)) {
      bankNeeds.set(contract.id, forBank.needs);
    }
    // A command that cannot be undone must say where its side effect goes: on the list, to the
    //   bank. Otherwise DSOR-UNK-03a would ask nothing of any connector. Found by step 35's review,
    //   F4: a non_compensatable payment.create went to the records, which refuse no repeat.
    const semantics = (contract["execution"] as { semantics?: unknown } | undefined)?.semantics;
    if (semantics === "non_compensatable" && !SENDS_MONEY.has(contract.id)) {
      problems.push(
        `${contract.id}: it cannot be undone, and no connector it is routed to is a bank (DSOR-UNK-03a)`,
      );
    }
  }
  // A release may run any of them, so it needs what every one of them needs of the bank.
  // Changed in step 38: of the ones that send money, not the ones that only ask.
  const allMoney = [...bankNeeds].flatMap(([id, wanted]) => (SENDS_MONEY.has(id) ? wanted : []));
  for (const contract of list) {
    if (routed(contract) && releases(contract) && allMoney.length > 0) {
      bankNeeds.set(contract.id, allMoney);
    }
  }
  const closed: Plugs = {
    connectorOf: () => ({ records: "*", bank: "*" }),
    outOfService: () => "no connector",
    needs,
    bankNeeds,
    bankOf: () => undefined,
    warnings: [],
  };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { plugs: closed, problems: [...problems, `${file}: not valid JSON`] };
  }
  problems.push(
    ...keysWrittenTwice(text).map(
      (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
    ),
  );
  const { connectors, companies } = (data ?? {}) as { connectors?: unknown; companies?: unknown };
  if (
    !Array.isArray(connectors) ||
    typeof companies !== "object" ||
    companies === null ||
    Array.isArray(companies)
  ) {
    problems.push(`${file}: must hold a list of connectors and the companies each one serves`);
    return { plugs: closed, problems };
  }
  // Each connector, by id, with why it cannot be used at all, if it cannot.
  const declared = new Map<string, Declaration>();
  const broken = new Map<string, string>();
  connectors.forEach((raw, index) => {
    const id = (raw as { id?: unknown } | null)?.id;
    const name = typeof id === "string" ? id : `#${index + 1}`;
    if (declared.has(name) || broken.has(name)) {
      problems.push(`${file}: two connectors have the id ${JSON.stringify(name)}`);
      return;
    }
    const found = declarationProblems(raw, index + 1);
    if (found.length > 0) broken.set(name, found.join("; "));
    else declared.set(name, raw as Declaration);
  });
  // Why a connector cannot serve in one role: its declaration, what it lacks, or, as a bank, no
  //   bank DSoR can call by that id.
  const unfit = (id: string, role: "records" | "bank"): string | undefined => {
    const why = broken.get(id);
    if (why !== undefined) return why;
    const declaration = declared.get(id)!;
    const wanted = role === "records" ? needs : bankNeeds;
    const lacking: string[] = [];
    for (const [operation, all] of wanted) {
      for (const need of all) {
        if (!meets(declaration, need)) lacking.push(`${operation} needs ${need.join(" or ")}`);
      }
    }
    if (lacking.length > 0) {
      return `connector ${JSON.stringify(id)} cannot serve as ${role === "records" ? "the records" : "the bank"}: ${lacking.join("; ")}`;
    }
    if (role === "bank" && !banks.has(id)) {
      return `connector ${JSON.stringify(id)} has no bank that DSoR can call`;
    }
    return undefined;
  };
  const serving = new Map<string, CompanyPlugs>();
  for (const [company, named] of Object.entries(companies)) {
    const pair = named as Partial<Record<string, unknown>> | null;
    if (company !== "*" && !isTenantId(company)) {
      problems.push(`${file}: ${JSON.stringify(company)} is not a company id`);
      continue;
    }
    if (typeof pair !== "object" || pair === null || Array.isArray(pair)) {
      problems.push(`${file}: ${company} must name its records and its bank`);
      continue;
    }
    const extra = Object.keys(pair).filter((key) => key !== "records" && key !== "bank");
    if (extra.length > 0) problems.push(`${file}: ${company} names only its records and its bank`);
    let fine = extra.length === 0;
    for (const role of ["records", "bank"] as const) {
      const id = pair[role];
      if (typeof id !== "string" || (!declared.has(id) && !broken.has(id))) {
        problems.push(
          `${file}: ${company}'s ${role} names ${JSON.stringify(id)}, which no connector declares`,
        );
        fine = false;
      }
    }
    if (fine)
      serving.set(company, { records: pair["records"] as string, bank: pair["bank"] as string });
  }
  // The default connectors serve every company the file does not name. If either is unfit, every
  // company is, so start-up stops (decision D4).
  const fallback = serving.get("*");
  if (fallback === undefined) problems.push(`${file}: names no default connectors, "*"`);
  else {
    for (const role of ["records", "bank"] as const) {
      const why = unfit(fallback[role], role);
      if (why !== undefined)
        problems.push(`${file}: the default ${role} connector is broken: ${why}`);
    }
  }
  const connectorOf = (tenant: string): CompanyPlugs =>
    serving.get(tenant) ?? fallback ?? { records: "*", bank: "*" };
  // An operation is out of service when the records' connector is unfit, or, for one that sends
  //   money and for the release, when the bank is (step 35's README, decision D4).
  const outOfService = (tenant: string, operation: string): string | undefined => {
    const plugs = connectorOf(tenant);
    const records = unfit(plugs.records, "records");
    if (records !== undefined) return records;
    return bankNeeds.has(operation) ? unfit(plugs.bank, "bank") : undefined;
  };
  const bankOf = (tenant: string): BankLine | undefined => {
    const id = connectorOf(tenant).bank;
    return unfit(id, "bank") === undefined ? banks.get(id) : undefined;
  };
  const warnings: string[] = [];
  for (const [company, plugs] of serving) {
    if (company === "*") continue;
    for (const role of ["records", "bank"] as const) {
      if (fallback !== undefined && plugs[role] === fallback[role]) continue;
      const why = unfit(plugs[role], role);
      if (why !== undefined) {
        warnings.push(
          `${file}: connector ${JSON.stringify(plugs[role])}, ${company}'s ${role}, is out of service: ${why}`,
        );
      }
    }
  }
  return { plugs: { connectorOf, outOfService, needs, bankNeeds, bankOf, warnings }, problems };
}

/**
 * Line ④'s look at the company's connectors: an operation on the company's records, or one that
 * sends its money, is refused before any claim while a connector it needs is out of service
 * (§10.2's breaker; decision D4). A retry with the same key is safe: nothing was claimed, and
 * nothing ran.
 */
export function checkConnector(plugs: Plugs, tenant: string, contract: Contract): void {
  if (!plugs.needs.has(contract.id)) return;
  if (plugs.outOfService(tenant, contract.id) === undefined) return;
  // Fixed words. Why it is out of service is the operators' to read, at start-up: a declaration's
  //   own text never reaches a caller (DSOR-CNR-02; step 34's review, F3).
  const message = `${contract.id}: ${tenant}'s connector is out of service`;
  throw new Refusal("CONNECTOR_UNAVAILABLE", message, "internal");
}

// One problem, as ajv found it: where in the declaration, and what is wrong there.
function explain(error: ErrorObject): string {
  const where = error.instancePath === "" ? "" : `${error.instancePath} `;
  // An extra field's name is the author's own text, and may be a URL, so it is named only when it
  //   is a short lowercase name (step 34's review, F4).
  const field = error.params["additionalProperty"];
  const named = typeof field === "string" && NAME.test(field) ? `: ${JSON.stringify(field)}` : "";
  return `${where}${error.message}${named}`;
}
