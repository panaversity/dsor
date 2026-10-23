// NEW IN STEP 42: how the door turns an HTTP request into the three things call() takes: the
//   operation's name, the request envelope, and the input. It only translates. Every value is
//   handed over as it came, and anything odd is left for the checklist to refuse, after line ① has
//   asked who calls (DSOR-OPR-04b, DSOR-IDN-01; step 42's README, claims C3 to C5, decisions D3,
//   D5, A1, and A2).
import { findRoute, type Route } from "./routes.ts";

/** What the server read of one request: headers in lower case, each with all its values. */
export type HttpRequest = {
  method: string;
  url: string;
  headers: Readonly<Record<string, readonly string[]>>;
  // The body's text, or that it was over the cap, or none.
  body?: { text: string } | { over: true };
};

/** What the door hands to call(). */
export type Translated = { name: string; envelope: Record<string, unknown>; input: unknown };

// What call() gets in place of a body over the cap. Every input schema is an object, so line ⑥
//   refuses a text, after line ① (step 42's README, decision A2).
export const OVER = "the request body was over 65536 bytes, so the door read none of it";

/** The operation's name, the envelope, and the input of one HTTP request. */
export function translate(request: HttpRequest): Translated {
  const url = new URL(request.url, "http://door");
  const found = findRoute(request.method, url.pathname);
  // A request on no route keeps its method and path as the name. A name with a space matches no
  //   contract, so call() answers UNSUPPORTED_CAPABILITY, after line ① (decision A2).
  const name = found?.route.operation ?? `${request.method} ${url.pathname}`;
  const envelope = envelopeOf(request.headers);
  const parts: unknown[] = [];
  const body = bodyOf(request.body);
  if (body !== undefined) parts.push(body);
  const query = queryOf(url.searchParams, found?.route);
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

// Authorization's bearer token, Idempotency-Key, and each DSoR-<Name> header as <name>, with - read
//   as _. A field two headers give, or one header given twice, is the list of its values, which the
//   checklist refuses: the door never picks one (decisions D3 and D5).
function envelopeOf(headers: HttpRequest["headers"]): Record<string, unknown> {
  const fields = new Map<string, unknown[]>();
  const add = (field: string, value: unknown): void => {
    fields.set(field, [...(fields.get(field) ?? []), value]);
  };
  for (const [header, values] of Object.entries(headers)) {
    for (const value of values) {
      if (header === "authorization") add("token", value.replace(/^Bearer /i, ""));
      else if (header === "idempotency-key") add("idempotency_key", value);
      else if (header.startsWith("dsor-")) {
        const field = header.slice("dsor-".length).replaceAll("-", "_");
        add(field, field === "agent_asserted" ? jsonOrText(value) : value);
      }
    }
  }
  return Object.fromEntries([...fields].map(([field, all]) => [field, one(all)]));
}

// The body: none when it is empty, its JSON, or its text when it is not JSON (decision D5).
function bodyOf(body: HttpRequest["body"]): unknown {
  if (body === undefined) return undefined;
  if ("over" in body) return OVER;
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
