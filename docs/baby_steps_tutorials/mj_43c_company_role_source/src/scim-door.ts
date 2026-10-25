// NEW IN STEP 43c: the SCIM door, a second HTTP server, for a company's directory only. It takes
//   /scim/v2/ and nothing else, only for the host names it is given, and only with a directory's
//   own token. Each request becomes one call() of directory.push or directory.read, as the
//   directory's login, in the token's company; the answer goes back in SCIM's shape. The door holds
//   no store and no rule: who may do what, and what is kept, are call()'s (DSOR-OPR-04a,
//   DSOR-OPR-04b, DSOR-IDN-04a; step 43c's README, claims C2 and C3, decisions D1, D3, and D7).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { directoryLogins, type DirectoryClients } from "./directory-clients.ts";
import type { DecisionLog } from "./log.ts";
import { call } from "./pipeline.ts";
import type { Registry } from "./registry.ts";
import { reply, scimError, translate, type ScimReply } from "./scim-translate.ts";
import { readBody } from "./server.ts";

export { memoryClients } from "./directory-clients.ts";

const PREFIX = "/scim/v2/";

// What the door says it can do, when the directory first asks (F1). It holds no data, so it is the
//   one answer the door makes by itself, after the token is checked; it leaves no record.
const CONFIG = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: "oauthbearertoken",
      name: "Bearer token",
      description: "The token pnpm directory-token made",
    },
  ],
};

/** The SCIM door over this registry and log, for these credentials and these host names. */
export function scimDoorOver(
  registry: Registry,
  log: DecisionLog,
  clients: DirectoryClients,
  // The names a directory reaches this computer by, such as host.lima.internal:8044 (F9).
  hosts: readonly string[] = [],
): Server {
  // The door's logins are the directories' tokens only (decision D3).
  const logins = directoryLogins(clients);
  const door: Registry = { ...registry, logins };
  const send = (res: ServerResponse, answer: ScimReply): void => {
    const text = answer.body === undefined ? "" : JSON.stringify(answer.body);
    const headers: Record<string, string> = { "content-type": "application/scim+json" };
    if (answer.status === 401) headers["www-authenticate"] = 'Bearer realm="DSoR SCIM"';
    res.writeHead(answer.status, headers);
    res.end(text);
  };
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // The door answers only a name it was given, or its own 127.0.0.1 and port: a web page that
      //   points its own name at this computer never reaches it (as step 42's door, decision D8).
      const host = req.headersDistinct["host"] ?? [];
      const own = `127.0.0.1:${req.socket.localPort}`;
      if (host.length !== 1 || (host[0] !== own && !hosts.includes(host[0] as string))) {
        send(res, scimError(421, "this door answers only the host names it was given"));
        return;
      }
      const url = new URL(req.url ?? "/", "http://scim.invalid");
      if (!url.pathname.startsWith(PREFIX)) {
        send(res, scimError(404, `this door answers ${PREFIX} only`));
        return;
      }
      // Only a bearer token, exactly once.
      const auth = req.headersDistinct["authorization"] ?? [];
      const token = auth.length === 1 ? /^Bearer (\S+)$/.exec(auth[0] as string)?.[1] : undefined;
      const caller = await logins.find(token);
      // No directory's token: line ① refuses it, and records the refusal, as every refusal is
      //   recorded before its answer (DSOR-EXE-02). The door reads no body for an unknown caller.
      //   Changed by the real run of 2026-10-26: the door answered 401 by itself, and minutes of
      //   authentik's pushes with an ended token left no trace in DSoR's evidence.
      if (caller === undefined || "unavailable" in caller) {
        const name = req.method === "GET" ? "directory.read" : "directory.push";
        const answer = await call(door, log, { token }, name, {});
        send(
          res,
          reply(
            { method: req.method ?? "", path: "", query: url.searchParams, body: undefined },
            { name, input: {} },
            answer,
          ),
        );
        return;
      }
      // The company is the token's: its directory login has one membership (decision D3).
      const tenant = caller.memberships[0]?.tenant_id as string;
      const path = url.pathname.slice(PREFIX.length);
      if (req.method === "GET" && path === "ServiceProviderConfig") {
        send(res, { status: 200, body: CONFIG });
        return;
      }
      const read = await readBody(req);
      let body: unknown;
      if (read !== undefined && "text" in read) {
        try {
          body = JSON.parse(read.text);
        } catch {
          send(res, scimError(400, "the body is not JSON", "invalidSyntax"));
          return;
        }
      } else if (read !== undefined) {
        send(res, scimError(400, "the body could not be read", "invalidSyntax"));
        return;
      }
      const request = { method: req.method ?? "", path, query: url.searchParams, body };
      const asked = translate(request);
      if (!("name" in asked)) {
        send(res, asked);
        return;
      }
      const input = { company: `dsor://${tenant}/tenant/${tenant}`, ...asked.input };
      // A push carries a key of its own: authentik's retry of a refused push is a new request.
      const envelope =
        asked.name === "directory.push"
          ? { token, tenant, idempotency_key: `scim-${crypto.randomUUID()}` }
          : { token, tenant };
      const answer = await call(door, log, envelope, asked.name, input);
      send(res, reply(request, { ...asked, input }, answer));
    } catch {
      res.destroy();
    }
  };
  return createServer(handle);
}
