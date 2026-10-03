// NEW IN STEP 16: what the database really holds, read from PostgreSQL's own catalog
// (step 16's README, decisions 4, 5, and 8). src/inspector.ts compares it with the map.
import type pg from "pg";

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
  // Every column, the privileges the user holds on it, and whether the database fills it
  // in: an identity, a default, or a generated column.
  columns: { name: string; held: string[]; filled: boolean }[];
  rowSecurity: { enabled: boolean; forced: boolean };
  // The rules and the triggers on the relation, by name.
  rules: string[];
  triggers: string[];
};

/** What the catalog says one user may do, outside PostgreSQL's own schemas. */
export type Catalog = {
  // The user the privileges below belong to.
  user: string;
  schemas: { name: string; held: string[] }[];
  relations: Relation[];
  sequences: { name: string; held: string[] }[];
  // The privileges the user holds on the database itself.
  database: string[];
  // Every SECURITY DEFINER function the user may run, as schema.name(arguments).
  definers: string[];
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
export const ON_COLUMNS: string[] = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
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
  relations: (Omit<Relation, "kind" | "rowSecurity" | "columns" | "rules" | "triggers"> & {
    columns: { name: string; held: string[] }[];
    relkind: string;
    enabled: boolean;
    forced: boolean;
  })[];
  sequences: Catalog["sequences"];
};

/** Reads the catalog, as it describes this user: the pool's own login, unless one is named. */
export async function readCatalog(pool: pg.Pool | pg.ClientBase, user?: string): Promise<Catalog> {
  const values = [user ?? null, ON_TABLES, ON_COLUMNS, ON_SEQUENCES, ON_SCHEMAS];
  const row = (await pool.query<CatalogRow>(CATALOG, values)).rows[0]!;
  return {
    user: row.who,
    schemas: row.schemas,
    relations: row.relations.map(({ name, relkind, held, columns, enabled, forced }) => ({
      name,
      kind: KIND_OF[relkind]!,
      held,
      columns: columns.map((column) => ({ ...column, filled: false })),
      rowSecurity: { enabled, forced },
      rules: [],
      triggers: [],
    })),
    sequences: row.sequences,
    database: [],
    definers: [],
  };
}
