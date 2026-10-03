// NEW IN STEP 16: what the database really holds, read from PostgreSQL's own catalog
// (step 16's README, decisions 4, 5, and 8). src/inspector.ts compares it with the map.
import pg from "pg";

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
        -- Every rule but _RETURN, the one that makes a view a view. Every trigger but those
        -- PostgreSQL makes itself, such as for a foreign key.
        'rules', array(SELECT r.rulename::text FROM pg_rewrite r
                        WHERE r.ev_class = c.oid AND r.rulename <> '_RETURN' ORDER BY 1),
        'triggers', array(SELECT t.tgname::text FROM pg_trigger t
                           WHERE t.tgrelid = c.oid AND NOT t.tgisinternal ORDER BY 1),
        'held', array(SELECT p FROM unnest($2::text[]) WITH ORDINALITY u(p, i)
                       WHERE has_table_privilege(w.name, c.oid, p) ORDER BY i),
        'columns', (SELECT coalesce(json_agg(json_build_object('name', a.attname,
                      'filled', a.attidentity <> '' OR a.atthasdef OR a.attgenerated <> '',
                      'held',
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
      WHERE c.relkind = 'S') AS sequences,
    (SELECT coalesce(json_agg(o.nspname || '.' || p.proname || '('
                                || pg_get_function_identity_arguments(p.oid) || ')'
                              ORDER BY o.nspname, p.proname), '[]')
       FROM pg_proc p JOIN outside o ON o.oid = p.pronamespace, who w
      WHERE p.prosecdef AND has_function_privilege(w.name, p.oid, 'EXECUTE')) AS definers`;

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
  definers: string[];
};

/**
 * Reads the catalog, as it describes this user: the login itself, unless one is named. A
 * pool reads in a read-only transaction of its own. One connection reads inside the
 * transaction its caller has open.
 */
export async function readCatalog(db: pg.Pool | pg.ClientBase, user?: string): Promise<Catalog> {
  if (db instanceof pg.Pool) {
    const client = await db.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const catalog = await readCatalog(client, user);
      await client.query("ROLLBACK");
      client.release();
      return catalog;
    } catch (error) {
      // A connection whose read failed is closed, never lent again, as in inCompany.
      await client.query("ROLLBACK").catch(() => {});
      client.release(true);
      throw error;
    }
  }
  // Every name in the statement is looked up in pg_catalog first, and in pg_temp last.
  // Otherwise a function in public named has_table_privilege, or a temporary table named
  // pg_class, could answer for PostgreSQL's own. SET LOCAL lasts until the transaction
  // ends (step 16's README, decision 4). Found by the review.
  await db.query("SET LOCAL search_path TO pg_catalog, pg_temp");
  const values = [user ?? null, ON_TABLES, ON_COLUMNS, ON_SEQUENCES, ON_SCHEMAS];
  const row = (await db.query<CatalogRow>(CATALOG, values)).rows[0]!;
  return {
    user: row.who,
    schemas: row.schemas,
    relations: row.relations.map(
      ({ name, relkind, held, columns, enabled, forced, rules, triggers }) => ({
        name,
        kind: KIND_OF[relkind]!,
        held,
        columns,
        rowSecurity: { enabled, forced },
        rules,
        triggers,
      }),
    ),
    sequences: row.sequences,
    database: [],
    definers: row.definers,
  };
}
