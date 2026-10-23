// NEW IN STEP 42: the front door, an HTTP server on Node's own node:http. Each request is read,
//   translated (door.ts), and answered by one call of call(), with the registry and the log the
//   program gives. The server holds no store, no log, and no rule of who may do what, and it has no
//   answer of its own: what call() answers is the body, and statuses.ts gives its status
//   (DSOR-OPR-04a, DSOR-OPR-04b; step 42's README, claims C1, C5, C6, and C7, decisions D6 and D7).
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { translate, type HttpRequest } from "./door.ts";
import type { Answer } from "./envelope.ts";
import type { DecisionLog } from "./log.ts";
import { call } from "./pipeline.ts";
import type { Registry } from "./registry.ts";
import { routeProblems, ROUTES, type Route } from "./routes.ts";
import { statusOf } from "./statuses.ts";

// The most of a body the door keeps: 64 KiB, the size of step 13's cap on an answer. A run of 50
//   lines is about 10 KiB (step 42's README, decision A2).
export const CAP = 65536;

// The only address the door listens on while the logins are step 05's fake table: tok_d4e8 is
//   cfo_100, in a public file. Step 43 lifts this (step 42's README, decision D7).
const ONLY_HOST = "127.0.0.1";

/** The one thing the door may do: ask the checklist, with what the request held, and wait. */
export type Ask = (
  envelope: Record<string, unknown>,
  name: string,
  input: unknown,
) => Promise<Answer>;

/** The door over this registry and this log: it asks call(), and nothing else. */
export function doorOver(
  registry: Registry,
  log: DecisionLog,
  routes: readonly Route[] = ROUTES,
): Server {
  return createDoor(
    (envelope, name, input) => call(registry, log, envelope, name, input),
    registry.contracts,
    routes,
  );
}

/**
 * A door that answers each request with one ask. It gets no registry, so it can reach no store
 * and no rule; the contracts are only the names its routes are checked against (the review's M1).
 * A table of routes that does not fit them stops it here.
 */
export function createDoor(
  ask: Ask,
  operations: ReadonlyMap<string, unknown>,
  routes: readonly Route[] = ROUTES,
): Server {
  const problems = routeProblems(operations, routes);
  if (problems.length > 0)
    throw new Error(`the routes refused to start:\n  ${problems.join("\n  ")}`);
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Nothing a request does may stop the program: an error here would end every call in flight.
    //   translate and readBody never throw, and call() never throws; this is the last guard, and it
    //   only closes the one connection (the review's H1).
    // NEW IN STEP 42: a request meant for another name is refused before anything else: a web page
    //   that made its own name point at 127.0.0.1 (DNS rebinding) must not reach the fake logins. A
    //   check of the wire, not of who may do what, so DSOR-OPR-04b allows it. The one answer the door
    //   makes by itself, and it leaves no record (the learner's D8, answering the review's M4).
    if (!meantForThisDoor(req)) {
      misdirected(res);
      return;
    }
    try {
      const request: HttpRequest = {
        method: req.method ?? "",
        url: req.url ?? "/",
        // Every value of every header, so a header sent twice is never cut to one (decision D5).
        headers: req.headersDistinct as Record<string, string[]>,
        body: await readBody(req),
      };
      const { name, envelope, input } = translate(request, routes);
      // call() never throws: every refusal is an answer, recorded before it is returned (step 04's
      //   README, C7; DSOR-EXE-02).
      const answer = await ask(envelope, name, input);
      const status = statusOf(answer);
      const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
      // A 401 names the scheme a caller must use, as RFC 9110 asks (the review's L4).
      if (status === 401) headers["www-authenticate"] = "Bearer";
      res.writeHead(status, headers);
      res.end(JSON.stringify(answer));
    } catch {
      res.destroy();
    }
  };
  const server = createServer(handle);
  // An Expect header Node does not know would get Node's own 417, with no call() and no record.
  //   With this, call() answers it too (the review's M3).
  server.on("checkExpectation", handle);
  return server;
}

/** Whether the request names this door: exactly one Host, 127.0.0.1 and the port it came in on. */
function meantForThisDoor(req: IncomingMessage): boolean {
  const hosts = req.headersDistinct["host"] ?? [];
  return hosts.length === 1 && hosts[0] === `${ONLY_HOST}:${req.socket.localPort}`;
}

// 421 Misdirected Request, with an error envelope of §28's shape, so a caller reads every refusal
//   the same way. Its request id is made here, since call() never saw the request (DSOR-COR-01b).
function misdirected(res: ServerResponse): void {
  const envelope = {
    code: "VALIDATION_FAILED",
    message: `this door answers only requests for ${ONLY_HOST} and its own port, named in the Host header`,
    retry: "never",
    correlation: { request_id: `req_${randomUUID()}` },
  };
  const body = JSON.stringify(envelope);
  res.writeHead(421, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    connection: "close",
  });
  res.end(body);
}

/**
 * The body's text, or that it was over the cap, or none when it is empty. A body over the cap is
 * read to its end and thrown away, so its sender hears an answer, and no more than the cap is kept.
 */
export async function readBody(
  stream: AsyncIterable<Buffer | string>,
  cap: number = CAP,
): Promise<HttpRequest["body"]> {
  const kept: Buffer[] = [];
  let size = 0;
  // A body cut off before its end, by a lost connection or the server's own time limit, is
  //   marked so, and still goes to call() (the review's H1).
  try {
    for await (const chunk of stream) {
      const piece = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += piece.length;
      if (size <= cap) kept.push(piece);
    }
  } catch {
    return { aborted: true };
  }
  if (size > cap) return { over: true };
  if (size === 0) return undefined;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(kept)) };
  } catch {
    return { notUtf8: true };
  }
}

/** Listens on 127.0.0.1 and this port, or a free one for 0, and gives the port. Any other address is refused. */
export async function listen(server: Server, host: string, port: number): Promise<number> {
  if (host !== ONLY_HOST) {
    const why = "while the logins are step 05's fake table";
    throw new Error(`the door listens only on ${ONLY_HOST} ${why}, not on ${host}`);
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : port;
}
