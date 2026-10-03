// The map of DSoR's own store, store.json (step 16's README, decisions 1
// and 3). Start-up checks the file here, with no database, beside the contracts and the
// labels. src/inspector.ts then compares the database with it.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { keysWrittenTwice } from "./json.ts";
import { isObject } from "./labels.ts";

/** Whose a schema is: the company's, DSoR's, or nobody's. */
export type Side = "company" | "dsor" | "none";

/** One schema's line in the map: its side, and dsor_runtime's privileges on it. */
export type SchemaLine = { side: Side; runtime: string[] };

/** One table's line in the map: its kind, its company key, and dsor_runtime's privileges. */
export type TableLine = {
  kind: string;
  tenant: string | null;
  runtime: { table: string[]; columns: Record<string, string[]> };
};

/** The map, once start-up has checked it. */
export type StoreMap = {
  schemas: ReadonlyMap<string, SchemaLine>;
  tables: ReadonlyMap<string, TableLine>;
};

/** The map's file, as it was read from disk: its file name and its text. */
export type StoreSource = { file: string; text: string };

/** A kind of table: its side, what dsor_runtime may do to it, and if it needs a company key. */
export type Kind = {
  side: Side;
  table: readonly string[];
  columns: readonly string[];
  key: boolean;
};

// Each kind allows only its own privileges, on its own side. A later step adds a kind
// here, beside the table that needs it (step 16's README, decision 3). No kind allows
// UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, or MAINTAIN.
/** Every kind of table the map may use. */
export const KINDS: ReadonlyMap<string, Kind> = new Map<string, Kind>([
  // The company's data: dsor_runtime only reads it.
  ["business", { side: "company", table: ["SELECT"], columns: [], key: true }],
  // DSoR's paperwork that grows and never changes, like the log: read it, and add rows
  // through named columns. INSERT on the whole table would include the columns the
  // database fills in (step 09's README, decision 6).
  ["append-only", { side: "dsor", table: ["SELECT"], columns: ["INSERT"], key: true }],
  // The owner's own records, such as the list of migrations: dsor_runtime has no business
  // there at all.
  ["bookkeeping", { side: "dsor", table: [], columns: [], key: false }],
]);

// USAGE lets dsor_runtime see into a schema. CREATE would let it make a table of its own,
// and own it (step 09's README, decision 5).
const SCHEMA_ALLOWS = ["USAGE"];
const SIDES: readonly string[] = ["company", "dsor", "none"];
// Each side in words, for the problems.
const WHOSE: Record<Side, string> = { company: "the company's", dsor: "DSoR's", none: "nobody's" };

const SHIPPED = fileURLToPath(new URL("../store.json", import.meta.url));

/** Reads the map: this step's own, unless another is named. */
export function readStore(path: string = SHIPPED): StoreSource {
  return { file: basename(path), text: readFileSync(path, "utf8") };
}

/** Checks the map, and names every problem. */
export function checkStore(source: StoreSource): { map: StoreMap; problems: string[] } {
  const { file, text } = source;
  const schemas = new Map<string, SchemaLine>();
  const tables = new Map<string, TableLine>();
  const map = { schemas, tables };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { map, problems: [`${file}: not valid JSON`] };
  }
  if (!isObject(data) || !hasOnly(data, ["schemas", "tables"], ["schemas", "tables"])) {
    return { map, problems: [`${file}: must be {"schemas": {...}, "tables": {...}}`] };
  }
  const { schemas: schemaLines, tables: tableLines } = data;
  if (!isObject(schemaLines) || !isObject(tableLines)) {
    return { map, problems: [`${file}: must be {"schemas": {...}, "tables": {...}}`] };
  }
  // JSON.parse keeps the last of two lines for one name, and says nothing (src/json.ts).
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [name, line] of Object.entries(schemaLines)) {
    const schema = `${file}: the schema ${name}`;
    if (!isObject(line) || !hasOnly(line, ["side", "runtime"]) || !isTextList(line.runtime)) {
      problems.push(`${schema} is not written as a schema line: {"side", "runtime": [...]}`);
    } else if (typeof line.side !== "string" || !SIDES.includes(line.side)) {
      const side = JSON.stringify(line.side);
      problems.push(`${schema} has the side ${side}, which is not company, dsor, or none`);
    } else {
      for (const privilege of line.runtime.filter((p) => !SCHEMA_ALLOWS.includes(p))) {
        problems.push(`${schema} lists ${privilege}, and a schema allows only USAGE`);
      }
      schemas.set(name, { side: line.side as Side, runtime: line.runtime });
    }
  }
  for (const [name, line] of Object.entries(tableLines)) {
    const found = tableProblems(name, line, Object.keys(schemaLines), schemas);
    problems.push(...found.map((problem) => `${file}: ${problem}`));
    if (found.length === 0) tables.set(name, line as TableLine);
  }
  return { map, problems };
}

// Every problem with one table's line. A schema named on the map but written wrong has a
// problem of its own already, so its tables are not checked against its side.
function tableProblems(
  name: string,
  line: unknown,
  named: readonly string[],
  schemas: ReadonlyMap<string, SchemaLine>,
): string[] {
  const [schemaName, tableName, ...more] = name.split(".");
  if (!schemaName || !tableName || more.length > 0) {
    return [`${JSON.stringify(name)} must be named schema.table`];
  }
  if (!named.includes(schemaName)) {
    return [`${name} is in the schema ${schemaName}, which the map does not name`];
  }
  if (!isTableLine(line)) {
    const form = '{"kind", "tenant", "runtime": {"table": [...], "columns": {...}}}';
    return [`${name} is not written as a table line: ${form}`];
  }
  // A line with no columns has none. Filled in here, so the inspector reads one shape.
  line.runtime.columns ??= {};
  const kind = KINDS.get(line.kind);
  if (kind === undefined) {
    const known = "which is not business, append-only, or bookkeeping";
    return [`${name} has the kind ${JSON.stringify(line.kind)}, ${known}`];
  }
  const schema = schemas.get(schemaName);
  if (schema !== undefined && schema.side !== kind.side) {
    return [
      `${name} is ${line.kind}, which lives on ${WHOSE[kind.side]} side, and the schema ` +
        `${schemaName} is ${WHOSE[schema.side]}`,
    ];
  }
  // Rows that belong to a company say which column says so, so the lock check is never
  // skipped for a company column named org_id (DSOR-RP-01b). Found by the review.
  const keyless = kind.key && line.tenant === null;
  const a = /^[aeiou]/.test(line.kind) ? "an" : "a";
  const refused = `which ${a} ${line.kind} table does not allow`;
  return [
    ...(keyless ? [`${name} is ${line.kind}, which needs a company key, and names none`] : []),
    ...line.runtime.table
      .filter((p) => !kind.table.includes(p))
      .map((p) => `${name} lists ${p}, ${refused}`),
    ...Object.keys(line.runtime.columns)
      .filter((p) => !kind.columns.includes(p))
      .map((p) => `${name} lists ${p} on columns, ${refused}`),
  ];
}

// The form of a table's line: exactly kind, tenant, and runtime, and inside runtime a list
// "table" and, if it is there, lists of column names under "columns". A misspelled field
// is refused, so "tenent" can never quietly mean "no company key".
function isTableLine(line: unknown): line is Omit<TableLine, "runtime"> & {
  runtime: { table: string[]; columns?: Record<string, string[]> };
} {
  if (!isObject(line) || !hasOnly(line, ["kind", "tenant", "runtime"])) return false;
  const { kind, tenant, runtime } = line;
  if (typeof kind !== "string" || (tenant !== null && typeof tenant !== "string")) return false;
  if (!isObject(runtime) || !hasOnly(runtime, ["table", "columns"], ["table"])) return false;
  if (!isTextList(runtime.table)) return false;
  const { columns } = runtime;
  return columns === undefined || (isObject(columns) && Object.values(columns).every(isTextList));
}

// True when the object has every required key, and no key outside the allowed ones.
// Without a list of required keys, every allowed key is required.
function hasOnly(
  value: { [key: string]: unknown },
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const keys = Object.keys(value);
  return keys.every((k) => allowed.includes(k)) && required.every((k) => keys.includes(k));
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
