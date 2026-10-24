// Step 42: the door's table of routes, checked against the contracts before the door opens (step
// 42's README, claim C2, decisions D1, D2, and A1).
import { describe, expect, it } from "vitest";
import { findRoute, INSIDE, routeProblems, ROUTES, type Route } from "../src/routes.ts";
import { registry } from "./helpers.ts";

const contracts = registry.contracts;

describe("C2: the routes, checked against the contracts", () => {
  it("Step 42, D1: the shipped table passes: 20 routes, and the four system jobs stay inside", () => {
    expect(routeProblems(contracts)).toStrictEqual([]);
    // Changed in step 43: login.invite and login.unlink, DSoR's own commands (step 43's README, revisions R2 and R7): POST /invitations and POST /logins/unlink.
    expect(ROUTES).toHaveLength(20);
    expect([...INSIDE].sort()).toStrictEqual([
      "alert.escalate_due",
      "proposal.expire_due",
      "rate.load",
      "rule.check_authority",
    ]);
  });

  it("Step 42, D2: a route that names no operation is refused", () => {
    const routes: Route[] = [
      ...ROUTES,
      { method: "POST", path: "/proposals/cancel", operation: "proposal.cancel" },
    ];
    expect(routeProblems(contracts, routes)).toStrictEqual([
      'POST /proposals/cancel names "proposal.cancel", which no contract has',
    ]);
  });

  it("Step 42, D2: an operation with two routes is refused", () => {
    const routes: Route[] = [
      ...ROUTES,
      { method: "POST", path: "/approvals", operation: "proposal.approve" },
    ];
    expect(routeProblems(contracts, routes)).toStrictEqual([
      '"proposal.approve" has two routes: POST /proposals/approve and POST /approvals',
    ]);
  });

  it("Step 42, D2: two rows for one method and path are refused", () => {
    const routes: Route[] = [
      ...ROUTES.filter((r) => r.operation !== "payment.cancel"),
      { method: "POST", path: "/payments", operation: "payment.cancel" },
    ];
    expect(routeProblems(contracts, routes)).toStrictEqual(["POST /payments has two rows"]);
  });

  it("Step 42, D1: a contract with no route that is not inside is refused, so a new operation needs a decision", () => {
    const routes = ROUTES.filter((r) => r.operation !== "payment.cancel");
    expect(routeProblems(contracts, routes)).toStrictEqual([
      '"payment.cancel" has no route, and is not one of the operations that stay inside',
    ]);
  });

  it("Step 42, D1: a route for one of the four system jobs is refused", () => {
    const routes: Route[] = [
      ...ROUTES,
      { method: "POST", path: "/proposals/expire-due", operation: "proposal.expire_due" },
    ];
    expect(routeProblems(contracts, routes)).toStrictEqual([
      '"proposal.expire_due" stays inside, run by DSoR\'s own system logins, so it has no route',
    ]);
  });

  it("Step 42, D2: queries are GET and commands are POST", () => {
    for (const route of ROUTES) {
      const kind = contracts.get(route.operation)?.["kind"];
      expect([route.operation, route.method]).toStrictEqual([
        route.operation,
        kind === "query" ? "GET" : "POST",
      ]);
    }
  });
});

describe("C2: a request's route", () => {
  it("Step 42, A1: GET /invoices/INV-1008 is invoice.get, with the id from the path", () => {
    expect(findRoute("GET", "/invoices/INV-1008")).toMatchObject({
      route: { operation: "invoice.get" },
      id: "INV-1008",
    });
  });

  it("Step 42, A1: an id is read as the path spells it, percent signs decoded", () => {
    expect(findRoute("GET", "/invoices/INV%2D1008")?.id).toBe("INV-1008");
    // A percent sign that is not a code is kept as it came; line ⑥ decides.
    expect(findRoute("GET", "/invoices/INV%ZZ")?.id).toBe("INV%ZZ");
  });

  it("Step 42, D2: the method counts, a trailing slash counts, and an empty id is no id", () => {
    expect(findRoute("POST", "/payments")?.route.operation).toBe("payment.create");
    expect(findRoute("GET", "/payments")).toBeUndefined();
    expect(findRoute("POST", "/payments/")).toBeUndefined();
    expect(findRoute("GET", "/invoices/")).toBeUndefined();
    expect(findRoute("GET", "/invoices/INV-1008/extra")).toBeUndefined();
    expect(findRoute("get", "/invoices")).toBeUndefined();
  });
});
