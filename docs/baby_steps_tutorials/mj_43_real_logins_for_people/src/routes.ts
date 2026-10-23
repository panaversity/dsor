// The door's table of routes. Each route is one HTTP method and one path, and names
//   one operation. The table only names; it decides nothing about who may call what, which stays
//   the checklist's (DSOR-OPR-04b; step 42's README, claim C2, decisions D1, D2, and A1).

/** One route: a method, a path, and the operation it names. */
export type Route = {
  method: "GET" | "POST";
  // A path, where {id} stands for one segment, the id of the input's address (decision A1).
  path: string;
  operation: string;
  // For a route with {id}: the input's field, and the kind of record the address names.
  id?: { field: string; entity: string };
  // For a list: the fields read from the query string, and how each is handed over (claim C4).
  query?: Record<string, "integer" | "string">;
};

// The two lists page with these, as their input schemas name them (step 13).
const PAGE = { limit: "integer", cursor: "string" } as const;

// The 18 operations a person or an app calls. Queries are GET, commands are POST, and only a route
//   with no body carries an id in its path (decisions D1, D2, and A1).
export const ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: "/invoices/{id}",
    operation: "invoice.get",
    id: { field: "invoice", entity: "invoice" },
  },
  { method: "GET", path: "/invoices", operation: "invoice.list", query: PAGE },
  { method: "GET", path: "/alerts", operation: "alert.list", query: PAGE },
  { method: "POST", path: "/invoices/issue", operation: "invoice.issue" },
  { method: "POST", path: "/payments", operation: "payment.create" },
  { method: "POST", path: "/payments/cancel", operation: "payment.cancel" },
  { method: "POST", path: "/payments/execute", operation: "payment.execute" },
  { method: "POST", path: "/payments/reconcile", operation: "payment.reconcile" },
  { method: "POST", path: "/payment-runs", operation: "payment.run" },
  { method: "POST", path: "/proposals/approve", operation: "proposal.approve" },
  { method: "POST", path: "/proposals/execute", operation: "proposal.execute" },
  { method: "POST", path: "/delegations/revoke", operation: "delegation.revoke" },
  { method: "POST", path: "/controls/suspend", operation: "control.suspend" },
  { method: "POST", path: "/controls/lift", operation: "control.lift" },
  { method: "POST", path: "/rules/draft", operation: "rule.draft" },
  { method: "POST", path: "/rules/activate", operation: "rule.activate" },
  { method: "POST", path: "/rules/suspend", operation: "rule.suspend" },
  { method: "POST", path: "/rules/retire", operation: "rule.retire" },
  // NEW IN STEP 43: and the two commands of the learner's R2 and R7, for a tenant administrator.
  { method: "POST", path: "/invitations", operation: "login.invite" },
  { method: "POST", path: "/logins/unlink", operation: "login.unlink" },
];

// The four operations only DSoR's own system logins call. They stay inside the program, run by
//   dsor-scheduler and dsor-rates, and get no route (decision D1).
export const INSIDE: readonly string[] = [
  "proposal.expire_due",
  "alert.escalate_due",
  "rule.check_authority",
  "rate.load",
];

/**
 * What is wrong with a table of routes, held against the contracts: a route that names no
 * operation, one of the four that stay inside, or a method and path given twice; an operation with
 * two routes; and a contract with no route that is not inside, so a new operation needs a decision.
 */
export function routeProblems(
  contracts: ReadonlyMap<string, unknown>,
  routes: readonly Route[] = ROUTES,
  inside: readonly string[] = INSIDE,
): string[] {
  const problems: string[] = [];
  const byOperation = new Map<string, Route>();
  const rows = new Set<string>();
  for (const route of routes) {
    const row = `${route.method} ${route.path}`;
    if (rows.has(row)) problems.push(`${row} has two rows`);
    rows.add(row);
    if (!contracts.has(route.operation)) {
      problems.push(`${row} names ${JSON.stringify(route.operation)}, which no contract has`);
    } else if (inside.includes(route.operation)) {
      const why = "stays inside, run by DSoR's own system logins, so it has no route";
      problems.push(`${JSON.stringify(route.operation)} ${why}`);
    }
    const first = byOperation.get(route.operation);
    if (first !== undefined) {
      const both = `${first.method} ${first.path} and ${row}`;
      problems.push(`${JSON.stringify(route.operation)} has two routes: ${both}`);
    } else {
      byOperation.set(route.operation, route);
    }
  }
  for (const operation of contracts.keys()) {
    if (!byOperation.has(operation) && !inside.includes(operation)) {
      const why = "has no route, and is not one of the operations that stay inside";
      problems.push(`${JSON.stringify(operation)} ${why}`);
    }
  }
  return problems;
}

/** The route of a method and a path, and the id its path carries, or none. */
export function findRoute(
  method: string,
  path: string,
  routes: readonly Route[] = ROUTES,
): { route: Route; id?: string } | undefined {
  const asked = path.split("/");
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/");
    if (pattern.length !== asked.length) continue;
    let id: string | undefined;
    const fits = pattern.every((part, i) => {
      const segment = asked[i] ?? "";
      if (part !== "{id}") return part === segment;
      id = decoded(segment);
      return segment !== "";
    });
    if (fits) return id === undefined ? { route } : { route, id };
  }
  return undefined;
}

// A percent sign that is not a code is kept as it came, so the door never refuses: line ⑥ decides
//   (decision D5).
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
