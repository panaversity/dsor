// NEW IN STEP 43c: what the SCIM door says in SCIM (RFC 7643, RFC 7644), and what it asks DSoR. A
//   request becomes one operation and its input; an answer becomes a SCIM status and body. The
//   translation decides nothing: who may push, which company, and what is kept are call()'s. Only
//   the forms authentik sent in the real check are read; any other is refused, never guessed
//   (step 43c's README, "The real check", F1 to F8, decisions D1 and D7).
import type { Answer } from "./envelope.ts";
import { STATUS } from "./statuses.ts";

/** One request, as the door read it: its method, its path and query, and its JSON body. */
export type ScimRequest = { method: string; path: string; query: URLSearchParams; body: unknown };

/** What the door asks: an operation, and its input, without the company, which the door adds. */
export type Asked = { name: "directory.push" | "directory.read"; input: Record<string, unknown> };

/** A SCIM reply: a status, and a body, or none. */
export type ScimReply = { status: number; body?: unknown };

const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";

/** A SCIM error, with its scimType when RFC 7644 names one. */
export function scimError(status: number, detail: string, scimType?: string): ScimReply {
  return {
    status,
    body: { schemas: [ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) },
  };
}

// What DSoR keeps of a user and a group, from the fields authentik's mapping sends (F8). A field
//   left out is left out, so the input schema refuses what DSoR cannot key (decision D5).
const record = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
// A list of members, each { "value": "<id>" } and nothing else, or why it is not one. Changed by the
//   review of step 43c, finding 2: a value that was no list threw, and the door dropped the connection.
function memberIds(list: unknown): string[] | string {
  if (!Array.isArray(list)) return "members must be a list of { value }";
  const ids: string[] = [];
  for (const member of list) {
    const fields = record(member);
    const keys = Object.keys(fields);
    if (keys.length !== 1 || keys[0] !== "value" || typeof fields["value"] !== "string") {
      return "each member must be { value } and nothing else";
    }
    ids.push(fields["value"]);
  }
  return ids;
}
const values = (list: unknown): unknown => {
  const ids = memberIds(list);
  // Not a list of members: left as it came, so the input schema refuses it.
  return typeof ids === "string" ? list : ids;
};
function account(body: unknown): Record<string, unknown> {
  const { userName, externalId, displayName, active } = record(body);
  return {
    user_name: userName,
    external_id: externalId,
    ...(displayName === undefined ? {} : { display_name: displayName }),
    // Changed by the review of step 43c, finding 3: never a default. A user with no active, or null,
    //   is refused by the input schema: a missing word read as "active" brought a leaver back.
    ...(active === undefined ? {} : { active }),
  };
}
function group(body: unknown): Record<string, unknown> {
  const { displayName, externalId, members } = record(body);
  return { name: displayName, external_id: externalId, members: values(members ?? []) };
}

// A search, as authentik asks after a conflict: `userName eq "admin_100"` (F5). Nothing else.
// not copied: RFC 7644's filter grammar is far wider; this is the one form authentik sent.
const FILTER = /^(userName|externalId|displayName) eq "([^"]*)"$/;
// A member's removal by its id, as authentik sends it: `members[value eq "<id>"]` (F7).
// not copied: RFC 7644's value path, in the one form authentik sent.
const MEMBER = /^members\[value eq "([^"]+)"\]$/;

/**
 * A PATCH of a group, as its operations in their order, or the reason it cannot be read. Changed by the
 * review of step 43c, finding 2: the operations were applied as replace, then add, then remove,
 * whatever their order; and a key the door did not read was dropped in silence. Only what authentik
 * sends, and RFC 7644's remove of every member, is read; anything else is refused, never guessed.
 */
function groupChange(id: string, body: unknown): Record<string, unknown> | string {
  const raw = record(body)["Operations"];
  if (!Array.isArray(raw) || raw.length === 0) return "a PATCH needs its Operations, a list";
  const operations: Record<string, unknown>[] = [];
  for (const one of raw) {
    const { op, path, value, ...more } = record(one);
    if (Object.keys(more).length > 0)
      return `the door does not read ${Object.keys(more).join(", ")}`;
    const verb = typeof op === "string" ? op.toLowerCase() : "";
    const member = typeof path === "string" ? MEMBER.exec(path) : null;
    const said = `the door does not read the operation ${JSON.stringify(op)} of ${JSON.stringify(path)}`;
    if (verb === "remove" && member !== null && value === undefined) {
      operations.push({ op: "remove", members: [member[1]] });
    } else if (verb === "remove" && path === "members" && value === undefined) {
      // RFC 7644, 3.5.2.2: a remove of the attribute, with no value, removes every member.
      operations.push({ op: "replace", members: [] });
    } else if ((verb === "add" || verb === "remove" || verb === "replace") && path === "members") {
      const ids = memberIds(value);
      if (typeof ids === "string") return ids;
      operations.push({ op: verb, members: ids });
    } else if (verb === "replace" && path === "displayName") {
      operations.push({ op: "rename", name: value });
    } else if (verb === "replace" && path === undefined) {
      const { displayName, members, ...rest } = record(value);
      if (Object.keys(rest).length > 0 || (displayName === undefined && members === undefined)) {
        return `the door reads displayName and members in a replace, and nothing else`;
      }
      if (displayName !== undefined) operations.push({ op: "rename", name: displayName });
      if (members !== undefined) {
        const ids = memberIds(members);
        if (typeof ids === "string") return ids;
        operations.push({ op: "replace", members: ids });
      }
    } else {
      return said;
    }
  }
  return { kind: "group.change", id, operations };
}

/** What the door asks DSoR for this request, or the SCIM error that answers it at once. */
function readRequest(request: ScimRequest): Asked | ScimReply {
  const parts = request.path.split("/").filter(Boolean);
  const [what, id, ...rest] = parts;
  const kind = what === "Users" ? "user" : what === "Groups" ? "group" : undefined;
  if (kind === undefined || rest.length > 0) return scimError(404, `no ${request.path}`);
  const push = (change: Record<string, unknown>): Asked => ({
    name: "directory.push",
    input: { change },
  });
  const plural = kind === "user" ? "users" : "groups";
  switch (request.method) {
    case "GET": {
      if (id !== undefined) return { name: "directory.read", input: { what: plural, id } };
      const filter = request.query.get("filter");
      if (filter === null) return { name: "directory.read", input: { what: plural } };
      const found = FILTER.exec(filter);
      if (found === null)
        return scimError(400, `the door reads no filter ${filter}`, "invalidFilter");
      return {
        name: "directory.read",
        input: { what: plural, filter: { field: found[1], value: found[2] } },
      };
    }
    case "POST":
      if (id !== undefined) return scimError(404, `no ${request.path}`);
      return kind === "user"
        ? push({ kind: "user.create", account: account(request.body) })
        : push({ kind: "group.create", group: group(request.body) });
    case "PUT":
      if (id === undefined) return scimError(404, `no ${request.path}`);
      return kind === "user"
        ? push({ kind: "user.replace", id, account: account(request.body) })
        : push({ kind: "group.replace", id, group: group(request.body) });
    case "PATCH": {
      // authentik changes a user with a PUT of the whole user (F1): a PATCH of one is not read.
      if (id === undefined || kind === "user") {
        return scimError(
          400,
          "the door takes a PUT of the whole user, never a PATCH",
          "invalidSyntax",
        );
      }
      const change = groupChange(id, request.body);
      return typeof change === "string" ? scimError(400, change, "invalidPath") : push(change);
    }
    case "DELETE":
      if (id === undefined) return scimError(404, `no ${request.path}`);
      return push({ kind: `${kind}.delete`, id });
    default:
      return scimError(405, `the door does not take ${request.method}`);
  }
}

/**
 * What the door asks DSoR for this request, or the SCIM error that answers it at once. It never throws:
 * a request it cannot read is a refusal, which the door records (the review of step 43c, finding 4).
 */
export function translate(request: ScimRequest): Asked | ScimReply {
  try {
    return readRequest(request);
  } catch {
    return scimError(400, "the door cannot read this request", "invalidSyntax");
  }
}

/** A row of the copy, as SCIM writes it. */
function resource(row: Record<string, unknown>): Record<string, unknown> {
  if (row["kind"] === "user") {
    return {
      schemas: [USER],
      id: row["id"],
      externalId: row["external_id"],
      userName: row["user_name"],
      ...(row["display_name"] === undefined ? {} : { displayName: row["display_name"] }),
      active: row["active"],
      meta: { resourceType: "User" },
    };
  }
  const members = (row["members"] as { id: string }[] | undefined) ?? [];
  return {
    schemas: [GROUP],
    id: row["id"],
    externalId: row["external_id"],
    displayName: row["name"],
    members: members.map((m) => ({ value: m.id })),
    meta: { resourceType: "Group" },
  };
}

// DSoR's codes as SCIM statuses: the shared table, but a request DSoR cannot read is SCIM's 400
//   invalidValue, and a conflict is 409 uniqueness, which authentik answers with a search (F5).
function failed(answer: Answer & { code: string; message: string }): ScimReply {
  if (answer.code === "VALIDATION_FAILED") return scimError(400, answer.message, "invalidValue");
  if (answer.code === "CONFLICT") return scimError(409, answer.message, "uniqueness");
  const status = STATUS[answer.code as keyof typeof STATUS] ?? 500;
  return scimError(status, answer.message);
}

/** The SCIM reply to DSoR's answer, for this request. */
export function reply(request: ScimRequest, asked: Asked, answer: Answer): ScimReply {
  if ("code" in answer) return failed(answer as Answer & { code: string; message: string });
  const data = record((answer as { data?: unknown }).data);
  if (asked.name === "directory.read") {
    const items = ((data["items"] as Record<string, unknown>[] | undefined) ?? []).map(resource);
    // One by its id: the row, or SCIM's 404. An empty page is how DSoR says "none here" (D4).
    if (asked.input["id"] !== undefined) {
      return items.length === 0
        ? scimError(404, `no ${request.path}`)
        : { status: 200, body: items[0] };
    }
    const start = Math.max(1, Number(request.query.get("startIndex") ?? "1") || 1);
    const count = Math.max(0, Number(request.query.get("count") ?? String(items.length)) || 0);
    const page = items.slice(start - 1, start - 1 + count);
    return {
      status: 200,
      body: {
        schemas: [LIST],
        totalResults: items.length,
        startIndex: start,
        itemsPerPage: page.length,
        Resources: page,
      },
    };
  }
  if (data["deleted"] === true) return { status: 204 };
  return { status: request.method === "POST" ? 201 : 200, body: resource(data) };
}
