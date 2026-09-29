// NEW IN STEP 09: the program checks who it logged in as, and refuses to run as a user that
// could change the log (step 09's README, decision 17). Each wrong fact is named.
import { describe, expect, it } from "vitest";
import { problemsOf, type RoleFacts } from "../src/postgres.ts";

// What Postgres says about dsor_runtime when the migration made it.
const RIGHT: RoleFacts = {
  who: "dsor_runtime",
  superuser: false,
  bypassrls: false,
  writes_all: false,
  owns: 0,
  can_change_audit: false,
};

describe("decision 17: the start-up check names every problem", () => {
  it("DSOR-AUD-04a: finds no problem with dsor_runtime as the migration made it", () => {
    expect(problemsOf(RIGHT)).toStrictEqual([]);
  });

  it.each<[string, Partial<RoleFacts>, string]>([
    ["the owner's login", { who: "neondb_owner" }, 'logged in as "neondb_owner", not dsor_runtime'],
    ["a superuser", { superuser: true }, "is a superuser"],
    ["BYPASSRLS", { bypassrls: true }, "holds BYPASSRLS"],
    ["a console role", { writes_all: true }, "is a member of pg_write_all_data"],
    ["an owner of tables", { owns: 2 }, "owns 2 tables"],
    ["UPDATE on the log", { can_change_audit: true }, "can change or remove records in dsor.audit"],
  ])("DSOR-AUD-04a: refuses %s", (_why, wrong, problem) => {
    expect(problemsOf({ ...RIGHT, ...wrong })).toStrictEqual([problem]);
  });

  it("names every problem at once, not only the first", () => {
    expect(problemsOf({ ...RIGHT, who: "neondb_owner", owns: 2 })).toHaveLength(2);
  });
});
