// NEW IN STEP 16: the inspector. It compares what the catalog says (src/catalog.ts) with
// the map (step 16's README, decisions 4 and 5). Start-up refuses on any difference.
import { ON_COLUMNS, type Catalog, type Relation } from "./catalog.ts";
import type { StoreMap, TableLine } from "./store.ts";

// A column with one of these names holds a company (step 11's README, decision 1).
const COMPANY_COLUMNS = ["tenant_id", "tenant"];

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
  // A SECURITY DEFINER function runs with its owner's rights, so it reaches around every
  // privilege above. The review's deleted log records for dsor_runtime (step 16's README,
  // decision 5). Found by the review.
  for (const name of catalog.definers) {
    found.push(
      `${name}: ${user} may run it, and it runs with its owner's rights, which no kind allows`,
    );
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
    // The database numbers and times a record itself, so the map may never let the program
    // write such a column (step 09's README, decision 6). Found by the review: the map
    // listed at, a grant matched it, and a record was dated 2001.
    for (const { name } of relation.columns.filter((c) => c.filled && listed.includes(c.name))) {
      found.push(
        `${relation.name}: store.json lists ${p} on the column ${name}, which the database fills in`,
      );
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
