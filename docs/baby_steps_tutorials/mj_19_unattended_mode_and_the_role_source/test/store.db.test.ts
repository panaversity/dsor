// The inspector on the real database (step 16's README, outcome 5, C2, C3,
// and decision 8). The unit tests prove the comparison on planted catalogs. These prove
// that the catalog the inspector reads is the real one, and that it can see every kind of
// privilege, and every kind of thing it must refuse.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCatalog, type Catalog } from "../src/catalog.ts";
import { storeDifferences } from "../src/inspector.ts";
import { checkStore, readStore } from "../src/store.ts";
import { columnIn, relationIn, today } from "./catalogs.ts";
import { newPool, ownerCatalog } from "./db.ts";

// The test's own window into the database: dsor_runtime, as the program logs in.
const observer = newPool();
afterAll(() => observer.end());
const { map } = checkStore(readStore());

/** Each privilege, then each again WITH GRANT OPTION, the order the catalog read uses. */
function andWithGrant(privileges: string[]): string[] {
  return [...privileges, ...privileges.map((p) => `${p} WITH GRANT OPTION`)];
}

describe("today's database and its map", () => {
  // If this fails, the unit tests are planting a database that does not exist.
  it("step 16's decision 7: the unit tests' planted catalog is the real one", async () => {
    expect(await readCatalog(observer)).toStrictEqual(today());
  });

  // Found by the review: this test was titled DSOR-MOD-01, but it proves only that the
  // store matches its map. DSOR-MOD-01 is carried by step 09's and step 10's tests.
  it("step 16's decision 7: DSoR's store, as the database holds it today, matches its map exactly", async () => {
    expect(storeDifferences(map, await readCatalog(observer))).toStrictEqual([]);
  });

  // SET LOCAL lasts only inside a transaction. Outside one, PostgreSQL ignores it and warns,
  // and a look-alike in public (below) could answer again. So the read the program runs, on
  // its pool, must open its own transaction, pin the path, read, and roll back, in that
  // order. The test notes each statement the pool's connection sends, and hears every
  // warning. Found while carrying step 09's fix forward: with the pool's BEGIN READ ONLY
  // removed, every test that reads the catalog still passed (step 16's README, decision 4).
  // The list of statements came from a review of step 15's port: a pool that skipped the
  // pin sent no SET LOCAL, so nothing warned, and the test passed.
  it("step 16's decision 4: the catalog read pins the search path inside a transaction of its own", async () => {
    const pool = newPool();
    const notices: string[] = [];
    const sent: string[] = [];
    pool.on("connect", (client) => {
      client.on("notice", (notice) => notices.push(String(notice.message)));
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      // Every statement goes to the database as it was written, and is noted first.
      client.query = ((...args: unknown[]) => {
        sent.push(typeof args[0] === "string" ? args[0].trim() : "(not text)");
        return query(...args);
      }) as typeof client.query;
    });
    try {
      expect(storeDifferences(map, await readCatalog(pool))).toStrictEqual([]);
      expect(sent).toStrictEqual([
        "BEGIN READ ONLY",
        "SET LOCAL search_path TO pg_catalog, pg_temp",
        expect.stringMatching(/^WITH who AS/),
        "ROLLBACK",
      ]);
      expect(notices).toStrictEqual([]);
    } finally {
      await pool.end();
    }
  });
});

// Today dsor_runtime holds nothing on a sequence, on the database, WITH GRANT OPTION, or
// CREATE on a schema, so an inspector blind to them would still find no difference. The
// owner holds them all, and dsor_runtime may ask about it without its password (step 16's
// README, decision 8).
describe("decision 8: the inspector sees every kind of privilege", () => {
  async function ownerOfTheTables(): Promise<string> {
    const { rows } = await observer.query<{ owner: string }>(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'dsor.audit'::regclass",
    );
    return rows[0]!.owner;
  }

  it("step 16's decision 8: asked about the owner, it sees a privilege on a table, a column, a sequence, a schema, and the database, each with grant option", async () => {
    const owner = await ownerOfTheTables();
    const catalog = await readCatalog(observer, owner);
    expect(catalog.user).toBe(owner);
    const audit = relationIn(catalog, "dsor.audit");
    expect(relationIn(catalog, "app.invoices").held).toStrictEqual(
      andWithGrant([
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN",
      ]),
    );
    expect(columnIn(audit, "sequence").held).toStrictEqual(
      andWithGrant(["SELECT", "INSERT", "UPDATE", "REFERENCES"]),
    );
    // Since step 17, the counter behind each payment's number too.
    expect(catalog.sequences).toStrictEqual([
      { name: "app.payments_number_seq", held: andWithGrant(["USAGE", "SELECT", "UPDATE"]) },
      { name: "dsor.audit_sequence_seq", held: andWithGrant(["USAGE", "SELECT", "UPDATE"]) },
    ]);
    expect(catalog.schemas.find((s) => s.name === "dsor")?.held).toStrictEqual(
      andWithGrant(["USAGE", "CREATE"]),
    );
    expect(catalog.database).toStrictEqual(andWithGrant(["CREATE"]));
  });

  it("step 16's decision 8: asked about the owner, it names the owner's UPDATE on app.invoices", async () => {
    const owner = await ownerOfTheTables();
    const found = storeDifferences(map, await readCatalog(observer, owner));
    expect(found).toContain(`app.invoices: ${owner} holds UPDATE, which store.json does not list`);
    expect(found).toContain(
      `dsor.audit_sequence_seq: ${owner} holds USAGE on a sequence, which no kind allows`,
    );
    expect(found).toContain(`the database: ${owner} holds CREATE, which no kind allows`);
  });
});

// Today's database holds no view, partitioned table, rule, trigger, or definer function, so
// the SQL could forget each one and pass every test above. The owner makes one of each in
// a transaction, the catalog is read on that connection, and all of it is rolled back
// (test/owner-catalog.ts). Found by the review and the sweep.
describe("decision 8: the inspector sees each thing it must refuse, made by the owner and rolled back", () => {
  let catalog: Catalog;
  beforeAll(() => {
    catalog = ownerCatalog() as Catalog;
  }, 60_000);

  it("step 16's decision 5: a view, a materialized view, and a partitioned table are read with their kinds", () => {
    const kinds = Object.fromEntries(catalog.relations.map((r) => [r.name, r.kind]));
    expect(kinds).toMatchObject({
      "dsor.fixture_view": "view",
      "dsor.fixture_copy": "materialized view",
      "dsor.fixture_events": "partitioned table",
    });
  });

  it("DSOR-RP-01b: row-level security forced but no longer enabled is read as it is", () => {
    expect(relationIn(catalog, "app.invoices").rowSecurity).toStrictEqual({
      enabled: false,
      forced: true,
    });
  });

  it("step 16's decision 3: a rule and a trigger on the log are read", () => {
    const audit = relationIn(catalog, "dsor.audit");
    expect(audit.rules).toStrictEqual(["fixture_swallow"]);
    expect(audit.triggers).toStrictEqual(["fixture_drop"]);
  });

  it("DSOR-AUD-04a: a SECURITY DEFINER function dsor_runtime may run is read", () => {
    expect(catalog.definers).toStrictEqual(["dsor.fixture_tidy()"]);
  });

  // The look-alike in public says no to every has_table_privilege. The catalog is read with
  // pg_catalog first, so PostgreSQL's own function answers (step 16's README, decision 4).
  it("step 16's decision 4: a look-alike function in public cannot blind the inspector", () => {
    expect(relationIn(catalog, "app.invoices").held).toStrictEqual(["SELECT"]);
  });

  it("step 16's decision 4: every one of them stops start-up, named", () => {
    expect(storeDifferences(map, catalog)).toEqual(
      expect.arrayContaining([
        "dsor.fixture_view is a view, and no kind in store.json allows one",
        "dsor.fixture_copy is a materialized view, and no kind in store.json allows one",
        "dsor.fixture_events is a partitioned table, and no kind in store.json allows one",
        "app.invoices has the company key tenant_id, and row-level security is not enabled",
        "dsor.audit has the rule fixture_swallow, which no kind allows",
        "dsor.audit has the trigger fixture_drop, which no kind allows",
        "dsor.fixture_tidy(): dsor_runtime may run it, and it runs with its owner's rights, which no kind allows",
      ]),
    );
  });

  it("step 16's decision 8: after the rollback, nothing the owner made is left", async () => {
    expect(storeDifferences(map, await readCatalog(observer))).toStrictEqual([]);
  });
});
