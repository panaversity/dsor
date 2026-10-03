// NEW IN STEP 16: the inspector. It reads PostgreSQL's own catalog and compares it with
// the map (step 16's README, decisions 4, 5, and 8). Start-up refuses on any difference.
import type pg from "pg";
import type { StoreMap, TableLine } from "./store.ts";

/** A relation's kind, in words: PostgreSQL's relkind r, p, v, m, or f. */
export type RelationKind =
  | "table"
  | "partitioned table"
  | "view"
  | "materialized view"
  | "foreign table";

/** One relation, as the catalog describes it to one user. */
export type Relation = {
  name: string;
  kind: RelationKind;
  // The privileges the user holds on the whole relation.
  held: string[];
  // Every column, and the privileges the user holds on it.
  columns: { name: string; held: string[] }[];
  rowSecurity: { enabled: boolean; forced: boolean };
};

/** What the catalog says one user may do, outside PostgreSQL's own schemas. */
export type Catalog = {
  // The user the privileges below belong to.
  user: string;
  schemas: { name: string; held: string[] }[];
  relations: Relation[];
  sequences: { name: string; held: string[] }[];
};

// Every privilege PostgreSQL has for each kind of object, in the order it lists them.
// MAINTAIN came with PostgreSQL 17.
const ON_TABLES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];
const ON_COLUMNS = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const ON_SEQUENCES = ["USAGE", "SELECT", "UPDATE"];
const ON_SCHEMAS = ["USAGE", "CREATE"];
// The relations a query can read rows from, by relkind. Indexes, sequences, and the like
// hold no rows a query reads.
const KIND_OF: Record<string, RelationKind> = {
  r: "table",
  p: "partitioned table",
  v: "view",
  m: "materialized view",
  f: "foreign table",
};
// A column with one of these names holds a company (step 11's README, decision 1).
const COMPANY_COLUMNS = ["tenant_id", "tenant"];

// One statement, so every part comes from the same moment of the catalog. Every schema
// but PostgreSQL's own: information_schema, and every name that starts with pg_ (step 11's
// README, decision 1). has_..._privilege counts a privilege held directly, through PUBLIC,
// or through a role. $1 is the user asked about, and NULL means the login itself
// (step 16's README, decision 8).
const CATALOG = `
  WITH who AS (SELECT coalesce($1::name, current_user) AS name),
  outside AS (SELECT oid, nspname FROM pg_namespace
               WHERE nspname <> 'information_schema' AND nspname !~ '^pg_')
  SELECT (SELECT name::text FROM who) AS who,
    (SELECT coalesce(json_agg(json_build_object('name', o.nspname, 'held',
        array(SELECT p FROM unnest($5::text[]) WITH ORDINALITY u(p, i)
               WHERE has_schema_privilege(w.name, o.oid, p) ORDER BY i)) ORDER BY o.nspname), '[]')
       FROM outside o, who w) AS schemas,
    (SELECT coalesce(json_agg(json_build_object(
        'name', o.nspname || '.' || c.relname, 'relkind', c.relkind,
        'enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity,
        'held', array(SELECT p FROM unnest($2::text[]) WITH ORDINALITY u(p, i)
                       WHERE has_table_privilege(w.name, c.oid, p) ORDER BY i),
        'columns', (SELECT coalesce(json_agg(json_build_object('name', a.attname, 'held',
                      array(SELECT p FROM unnest($3::text[]) WITH ORDINALITY u(p, i)
                             WHERE has_column_privilege(w.name, c.oid, a.attnum, p) ORDER BY i))
                      ORDER BY a.attnum), '[]')
                      FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        ORDER BY o.nspname || '.' || c.relname), '[]')
       FROM pg_class c JOIN outside o ON o.oid = c.relnamespace, who w
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')) AS relations,
    (SELECT coalesce(json_agg(json_build_object('name', o.nspname || '.' || c.relname, 'held',
        array(SELECT p FROM unnest($4::text[]) WITH ORDINALITY u(p, i)
               WHERE has_sequence_privilege(w.name, c.oid, p) ORDER BY i))
        ORDER BY o.nspname || '.' || c.relname), '[]')
       FROM pg_class c JOIN outside o ON o.oid = c.relnamespace, who w
      WHERE c.relkind = 'S') AS sequences`;

// The row the statement gives back. json_agg arrives as JavaScript arrays and objects.
type CatalogRow = {
  who: string;
  schemas: Catalog["schemas"];
  relations: (Omit<Relation, "kind" | "rowSecurity"> & {
    relkind: string;
    enabled: boolean;
    forced: boolean;
  })[];
  sequences: Catalog["sequences"];
};

/** Reads the catalog, as it describes this user: the pool's own login, unless one is named. */
export async function readCatalog(pool: pg.Pool, user?: string): Promise<Catalog> {
  const values = [user ?? null, ON_TABLES, ON_COLUMNS, ON_SEQUENCES, ON_SCHEMAS];
  const row = (await pool.query<CatalogRow>(CATALOG, values)).rows[0]!;
  return {
    user: row.who,
    schemas: row.schemas,
    relations: row.relations.map(({ name, relkind, held, columns, enabled, forced }) => ({
      name,
      kind: KIND_OF[relkind]!,
      held,
      columns,
      rowSecurity: { enabled, forced },
    })),
    sequences: row.sequences,
  };
}

/** Every difference between the database and the map. None means they match. */
export function storeDifferences(map: StoreMap, catalog: Catalog): string[] {
  const { user } = catalog;
  const found: string[] = [];
  // The database's own lists first, so what nobody wrote down is found too.
  for (const schema of catalog.schemas) {
    const line = map.schemas.get(schema.name);
    if (line === undefined) found.push(`the schema ${schema.name} is not in store.json`);
    else found.push(...compared(`the schema ${schema.name}`, user, schema.held, line.runtime));
  }
  for (const name of map.schemas.keys()) {
    if (!catalog.schemas.some((schema) => schema.name === name)) {
      found.push(`store.json names the schema ${name}, which the database does not have`);
    }
  }
  for (const relation of catalog.relations) {
    const line = map.tables.get(relation.name);
    // Only plain tables have a kind today (step 16's README, decision 5).
    if (relation.kind !== "table") {
      found.push(`${relation.name} is a ${relation.kind}, and no kind in store.json allows one`);
    } else if (line === undefined) {
      found.push(`${relation.name} is a table that store.json does not name`);
    } else {
      found.push(...privilegesOf(relation, line, user), ...lockOf(relation, line));
    }
  }
  for (const name of map.tables.keys()) {
    if (!catalog.relations.some((relation) => relation.name === name)) {
      found.push(`store.json names ${name}, which the database does not have`);
    }
  }
  // No kind allows a privilege on a sequence (step 16's README, decision 3).
  for (const { name, held } of catalog.sequences) {
    for (const p of held)
      found.push(`${name}: ${user} holds ${p} on a sequence, which no kind allows`);
  }
  return found;
}

// What the user holds on one object, against what the map lists for it.
function compared(what: string, user: string, held: string[], listed: string[]): string[] {
  return [
    ...held
      .filter((p) => !listed.includes(p))
      .map((p) => `${what}: ${user} holds ${p}, which store.json does not list`),
    ...listed
      .filter((p) => !held.includes(p))
      .map((p) => `${what}: ${user} lacks ${p}, which store.json lists`),
  ];
}

// The table's privileges, then its columns'. A privilege on the whole table covers every
// column, so columns are compared only for a privilege neither side gives the whole table.
// That way one difference is named once.
function privilegesOf(relation: Relation, line: TableLine, user: string): string[] {
  const { table, columns } = line.runtime;
  const found = compared(relation.name, user, relation.held, table);
  for (const p of ON_COLUMNS.filter((p) => !relation.held.includes(p) && !table.includes(p))) {
    const listed = columns[p] ?? [];
    for (const { name, held } of relation.columns) {
      const what = `${relation.name}: ${user}`;
      const on = `${p} on the column ${name}`;
      if (held.includes(p) && !listed.includes(name))
        found.push(`${what} holds ${on}, which store.json does not list`);
      if (listed.includes(name) && !held.includes(p))
        found.push(`${what} lacks ${on}, which store.json lists`);
    }
    for (const name of listed.filter((n) => !relation.columns.some((c) => c.name === n))) {
      found.push(
        `store.json lists ${p} on the column ${name} of ${relation.name}, which the table does not have`,
      );
    }
  }
  return found;
}

// A table with a company key must be locked by row-level security, enabled and forced
// (DSOR-RP-01b). A company column the map does not call a key would get no check at all.
function lockOf(relation: Relation, line: TableLine): string[] {
  const names = relation.columns.map((column) => column.name);
  if (line.tenant === null) {
    return names
      .filter((name) => COMPANY_COLUMNS.includes(name))
      .map(
        (name) =>
          `${relation.name} has a column ${name}, and store.json names no company key for it`,
      );
  }
  if (!names.includes(line.tenant)) {
    return [
      `store.json names ${line.tenant} as the company key of ${relation.name}, and the table has no such column`,
    ];
  }
  const locked = `${relation.name} has the company key ${line.tenant}, and row-level security is`;
  if (!relation.rowSecurity.enabled) return [`${locked} not enabled`];
  if (!relation.rowSecurity.forced) return [`${locked} not forced`];
  return [];
}
