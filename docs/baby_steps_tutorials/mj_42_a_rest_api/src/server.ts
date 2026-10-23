// NEW IN STEP 42: the front door, an HTTP server on Node's own node:http. Each request is read,
//   translated (door.ts), and answered by one call of call(), with the registry and the log the
//   program gives. The server holds no store, no log, and no rule of who may do what, and it has no
//   answer of its own: what call() answers is the body, and statuses.ts gives its status
//   (DSOR-OPR-04a, DSOR-OPR-04b; step 42's README, claims C1, C5, C6, and C7, decisions D6 and D7).
import { createServer, type Server } from "node:http";
import { translate, type HttpRequest } from "./door.ts";
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

/** The door over this registry and this log. A table of routes that does not fit the contracts stops it here. */
export function createDoor(
  registry: Registry,
  log: DecisionLog,
  routes: readonly Route[] = ROUTES,
): Server {
  const problems = routeProblems(registry.contracts, routes);
  if (problems.length > 0)
    throw new Error(`the routes refused to start:\n  ${problems.join("\n  ")}`);
  return createServer(async (req, res) => {
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
    const answer = await call(registry, log, envelope, name, input);
    res.writeHead(statusOf(answer), { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(answer));
  });
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
  for await (const chunk of stream) {
    const piece = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += piece.length;
    if (size <= cap) kept.push(piece);
  }
  if (size > cap) return { over: true };
  if (size === 0) return undefined;
  return { text: Buffer.concat(kept).toString("utf8") };
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
