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

/** Which connector holds each company's records, and why one is out of service. */
export type Plugs = {
  // The connector of a company: its own, or the default, "*".
  connectorOf: (tenant: string) => string;
  // Why that connector cannot take this company's calls, or undefined when it can.
  outOfService: (tenant: string) => string | undefined;
  // Each operation that works on the company's records, with what it needs (decision D2).
  needs: ReadonlyMap<string, readonly Need[]>;
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
export const READS_COMPANY_RECORDS: ReadonlySet<string> = new Set(["proposal.approve"]);

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
 */
export function needsOf(contract: Contract): { needs: Need[]; problems: string[] } {
  const needs: Need[] = [];
  const problems: string[] = [];
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
  return { needs, problems };
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

/** Checks the connectors file against the operations that work on the company's records. */
export function checkConnectors(
  source: ConnectorsSource,
  contracts: Iterable<Contract>,
  routed: (contract: Contract) => boolean,
): { plugs: Plugs; problems: string[] } {
  const { file, text } = source;
  const problems: string[] = [];
  const needs = new Map<string, Need[]>();
  for (const contract of contracts) {
    if (!routed(contract)) continue;
    const found = needsOf(contract);
    problems.push(...found.problems);
    needs.set(contract.id, found.needs);
  }
  const closed: Plugs = {
    connectorOf: () => "*",
    outOfService: () => "no connector",
    needs,
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
  // Each connector, by id, with why it cannot be used, if it cannot.
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
  // A connector that cannot serve every operation on the records it holds is out of service.
  for (const [id, declaration] of declared) {
    const lacking: string[] = [];
    for (const [operation, wanted] of needs) {
      for (const need of wanted) {
        if (!meets(declaration, need)) lacking.push(`${operation} needs ${need.join(" or ")}`);
      }
    }
    if (lacking.length > 0)
      broken.set(id, `connector ${JSON.stringify(id)} cannot serve: ${lacking.join("; ")}`);
  }
  const serving = new Map<string, string>();
  for (const [company, id] of Object.entries(companies)) {
    if (company !== "*" && !isTenantId(company)) {
      problems.push(`${file}: ${JSON.stringify(company)} is not a company id`);
    } else if (typeof id !== "string" || (!declared.has(id) && !broken.has(id))) {
      problems.push(`${file}: ${company} names ${JSON.stringify(id)}, which no connector declares`);
    } else serving.set(company, id);
  }
  // The default connector serves every company the file does not name. If it is broken, every
  // company is, so start-up stops (decision D4).
  const fallback = serving.get("*");
  if (fallback === undefined) problems.push(`${file}: names no default connector, "*"`);
  else if (broken.has(fallback))
    problems.push(`${file}: the default connector is broken: ${broken.get(fallback)}`);
  const connectorOf = (tenant: string): string => serving.get(tenant) ?? fallback ?? "*";
  const outOfService = (tenant: string): string | undefined => broken.get(connectorOf(tenant));
  const warnings = [...serving]
    .filter(([company, id]) => company !== "*" && id !== fallback && broken.has(id))
    .map(
      ([company, id]) =>
        `${file}: connector ${JSON.stringify(id)}, which serves ${company}, is out of service: ${broken.get(id)}`,
    );
  return { plugs: { connectorOf, outOfService, needs, warnings }, problems };
}

/**
 * Line ④'s look at the company's connector: an operation on the company's records is refused before
 * any claim, while that company's connector is out of service (§10.2's breaker; decision D4). A
 * retry with the same key is safe: nothing was claimed, and nothing ran.
 */
export function checkConnector(plugs: Plugs, tenant: string, contract: Contract): void {
  if (!plugs.needs.has(contract.id)) return;
  if (plugs.outOfService(tenant) === undefined) return;
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
