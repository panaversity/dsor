// How the door turns an HTTP request into the three things call() takes: the
//   operation's name, the request envelope, and the input. It only translates. Every value is
//   handed over as it came, and anything odd is left for the checklist to refuse, after line ① has
//   asked who calls (DSOR-OPR-04b, DSOR-IDN-01; step 42's README, claims C3 to C5, decisions D3,
//   D5, A1, and A2).
import { findRoute, ROUTES, type Route } from "./routes.ts";

/** What the server read of one request: headers in lower case, each with all its values. */
export type HttpRequest = {
  method: string;
  url: string;
  headers: Readonly<Record<string, readonly string[]>>;
  // The body's text, or that it was over the cap, cut off before its end, or not UTF-8, or none.
  body?: { text: string } | { over: true } | { aborted: true } | { notUtf8: true };
};

/** What the door hands to call(). */
export type Translated = { name: string; envelope: Record<string, unknown>; input: unknown };

// What call() gets in place of a body over the cap. Every input schema is an object, so line ⑥
//   refuses a text, after line ① (step 42's README, decision A2).
export const OVER = "the request body was over 65536 bytes, so the door read none of it";
// And in place of a body cut off before its end, as a phone that loses its signal mid-upload cuts
//   it (the review's H1).
export const ABORTED = "the request body was cut off before its end, so the door read none of it";
// And in place of a body that is not UTF-8: a decoder that guessed would make two different bodies
//   one input and one payload hash (the review's L6).
export const NOT_UTF8 = "the request body was not UTF-8 text, so the door read none of it";

/** The operation's name, the envelope, and the input of one HTTP request. */
export function translate(request: HttpRequest, routes: readonly Route[] = ROUTES): Translated {
  // The path exactly as it was sent, up to the first ?. No URL parser: one rewrites /a/../b to /b
  //   and throws on a target such as http://a:99999/x, and the door must neither pick a meaning
  //   nor stop (the review's H1 and L2).
  const cut = request.url.indexOf("?");
  const path = cut === -1 ? request.url : request.url.slice(0, cut);
  const found = findRoute(request.method, path, routes);
  // A request on no route keeps its method and path as the name. A name with a space matches no
  //   contract, so call() answers UNSUPPORTED_CAPABILITY, after line ① (decision A2).
  const name = found?.route.operation ?? `${request.method} ${path}`;
  const envelope = envelopeOf(request.headers);
  const parts: unknown[] = [];
  const body = bodyOf(request.body);
  if (body !== undefined) parts.push(body);
  const query = queryOf(
    new URLSearchParams(cut === -1 ? "" : request.url.slice(cut + 1)),
    found?.route,
  );
  if (query !== undefined) parts.push(query);
  if (found?.id !== undefined && found.route.id !== undefined) {
    // One fixed template, with the DSoR-Tenant header's text. A missing or doubled header leaves
    //   an address line ② refuses with the envelope (decision A1).
    const tenant = typeof envelope["tenant"] === "string" ? envelope["tenant"] : "";
    const { field, entity } = found.route.id;
    parts.push({ [field]: `dsor://${tenant}/${entity}/${found.id}` });
  }
  return { name, envelope, input: joined(parts) };
}

// The one header for each field of the envelope, besides Authorization's bearer token (§39: "one
//   canonical representation per interface"; decision D3).
const FIELDS: Readonly<Record<string, string>> = {
  "idempotency-key": "idempotency_key",
  "dsor-tenant": "tenant",
  "dsor-mode": "mode",
  "dsor-request-id": "request_id",
  "dsor-supersedes": "supersedes",
  "dsor-agent-asserted": "agent_asserted",
  // Changed in step 43: and an invitation's code, for a person's first call (revision R1).
  "dsor-invitation": "invitation",
};

// Authorization's bearer token, and each header of FIELDS as its field. A field one header gives
//   twice is the list of its values, which the checklist refuses: the door never picks one. Any
//   other header that starts with dsor, and an Authorization that is not a bearer token, are handed
//   over under their own names, which the closed envelope refuses, so a second spelling never
//   counts and a near miss is never dropped (decisions D3 and D5; the review's L1 and L3).
function envelopeOf(headers: HttpRequest["headers"]): Record<string, unknown> {
  const fields = new Map<string, unknown[]>();
  const add = (field: string, value: unknown): void => {
    fields.set(field, [...(fields.get(field) ?? []), value]);
  };
  for (const [header, values] of Object.entries(headers)) {
    for (const value of values) {
      const field = FIELDS[header];
      const bearer = /^Bearer (.*)$/is.exec(value);
      if (header === "authorization") {
        if (bearer !== null) add("token", bearer[1]);
        else add("authorization", value);
      } else if (field !== undefined) {
        add(field, field === "agent_asserted" ? jsonOrText(value) : value);
      } else if (/^dsor[-_]/.test(header)) {
        add(header.replaceAll("-", "_"), value);
      }
    }
  }
  return Object.fromEntries([...fields].map(([field, all]) => [field, one(all)]));
}

// The body: none when it is empty, its JSON, or its text when it is not JSON (decision D5).
function bodyOf(body: HttpRequest["body"]): unknown {
  if (body === undefined) return undefined;
  if ("over" in body) return OVER;
  if ("aborted" in body) return ABORTED;
  if ("notUtf8" in body) return NOT_UTF8;
  return body.text === "" ? undefined : jsonOrText(body.text);
}

// The query string's fields. A field the route reads as an integer is a number when it is one;
//   everything else is text. A field given twice is the list of both (claim C4).
function queryOf(params: URLSearchParams, route: Route | undefined): unknown {
  const fields = new Map<string, unknown[]>();
  for (const [field, text] of params) {
    const integer = route?.query?.[field] === "integer" && /^-?\d+$/.test(text);
    const value = integer && Number.isSafeInteger(Number(text)) ? Number(text) : text;
    fields.set(field, [...(fields.get(field) ?? []), value]);
  }
  if (fields.size === 0) return undefined;
  return Object.fromEntries([...fields].map(([field, all]) => [field, one(all)]));
}

// The input from its parts: none is {}, one is itself, objects are joined field by field, a field
//   two parts name is the list of both, and anything else is the list of the parts. The door never
//   picks a winner; line ⑥ refuses what is not one plain object (decision D5).
function joined(parts: unknown[]): unknown {
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  if (!parts.every(isPlainObject)) return parts;
  const fields = new Map<string, unknown[]>();
  for (const part of parts) {
    for (const [field, value] of Object.entries(part)) {
      fields.set(field, [...(fields.get(field) ?? []), value]);
    }
  }
  return Object.fromEntries([...fields].map(([field, all]) => [field, one(all)]));
}

function one(values: unknown[]): unknown {
  return values.length === 1 ? values[0] : values;
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
