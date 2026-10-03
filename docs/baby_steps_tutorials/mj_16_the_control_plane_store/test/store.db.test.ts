// NEW IN STEP 16: the inspector on the real database (step 16's README, outcome 5, C2, C3,
// and decision 8). The unit tests prove the comparison on planted catalogs. These prove
// that the catalog the inspector reads is the real one, and that it can see every kind of
// privilege.
import { afterAll, describe, expect, it } from "vitest";
import { readCatalog, storeDifferences } from "../src/inspector.ts";
import { checkStore, readStore } from "../src/store.ts";
import { columnIn, relationIn, today } from "./catalogs.ts";
import { newPool } from "./db.ts";

// The test's own window into the database: dsor_runtime, as the program logs in.
const observer = newPool();
afterAll(() => observer.end());
const { map } = checkStore(readStore());

describe("today's database and its map", () => {
  // If this fails, the unit tests are planting a database that does not exist.
  it("step 16's decision 7: the unit tests' planted catalog is the real one", async () => {
    expect(await readCatalog(observer)).toStrictEqual(today());
  });

  it("DSOR-MOD-01: DSoR's store, as the database holds it today, matches its map exactly", async () => {
    expect(storeDifferences(map, await readCatalog(observer))).toStrictEqual([]);
  });
});

// Today dsor_runtime holds nothing on a column alone, on a sequence, or CREATE on a schema,
// so an inspector blind to them would still find no difference. The owner holds them all,
// and dsor_runtime may ask about it without its password (step 16's README, decision 8).
describe("decision 8: the inspector sees every kind of privilege", () => {
  async function ownerOfTheTables(): Promise<string> {
    const { rows } = await observer.query<{ owner: string }>(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'dsor.audit'::regclass",
    );
    return rows[0]!.owner;
  }

  it("step 16's decision 8: asked about the owner, it sees a privilege on a table, a column, a sequence, and a schema", async () => {
    const owner = await ownerOfTheTables();
    const catalog = await readCatalog(observer, owner);
    expect(catalog.user).toBe(owner);
    const audit = relationIn(catalog, "dsor.audit");
    expect(relationIn(catalog, "app.invoices").held).toStrictEqual([
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
      "MAINTAIN",
    ]);
    expect(columnIn(audit, "sequence").held).toStrictEqual([
      "SELECT",
      "INSERT",
      "UPDATE",
      "REFERENCES",
    ]);
    expect(catalog.sequences).toStrictEqual([
      { name: "dsor.audit_sequence_seq", held: ["USAGE", "SELECT", "UPDATE"] },
    ]);
    expect(catalog.schemas.find((s) => s.name === "dsor")?.held).toStrictEqual(["USAGE", "CREATE"]);
  });

  it("step 16's decision 8: asked about the owner, it names the owner's UPDATE on app.invoices", async () => {
    const owner = await ownerOfTheTables();
    const found = storeDifferences(map, await readCatalog(observer, owner));
    expect(found).toContain(`app.invoices: ${owner} holds UPDATE, which store.json does not list`);
    expect(found).toContain(
      `dsor.audit_sequence_seq: ${owner} holds USAGE on a sequence, which no kind allows`,
    );
  });
});
