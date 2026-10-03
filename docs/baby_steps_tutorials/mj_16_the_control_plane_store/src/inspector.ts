// NEW IN STEP 16: the inspector. It reads PostgreSQL's own catalog and compares it with
// the map (step 16's README, decisions 4, 5, and 8).
// SHELL: the shape only. It reads nothing and finds no difference until the code is written.
import type pg from "pg";
import type { StoreMap } from "./store.ts";

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

/** Reads the catalog, as it describes this user: the pool's own login, unless one is named. */
export async function readCatalog(_pool: pg.Pool, user?: string): Promise<Catalog> {
  return { user: user ?? "", schemas: [], relations: [], sequences: [] };
}

/** Every difference between the database and the map. None means they match. */
export function storeDifferences(_map: StoreMap, _catalog: Catalog): string[] {
  return [];
}
