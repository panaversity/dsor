// A small sign-in server for the tests. It answers DSoR's lookup contract for one
// company, from a list of people, as the company's real server would (step 45's README, D1, D4).
// It accepts only the company's test key, sent as Authorization: Bearer (D14), and stamps each
// answer with when it read its facts. Its switches make it answer about someone else, reply with
// something unreadable, serve old facts, fail, or hang. Test-only, like step 44's test/issuer.ts:
// `pnpm start` gets a stand-in of its own (D7).
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Entry } from "./role-source-list.ts";

/** The path of the lookup on this server. A real server chooses its own (D11). */
const PATH = "/dsor/lookup";

/** A running test server, and its switches. */
export type SignInServer = {
  /** The lookup's address, as lookups.json names it. */
  address: string;
  /** The one company key this server accepts. */
  key: string;
  /** How many requests reached the lookup. */
  asked: () => number;
  /** Each request that reached the lookup: whom it asked about, and its Authorization header. */
  seen: () => { tenant: string | null; person: string | null; authorization: string | undefined }[];
  /** From now on, every request is sent on to the same lookup at this address with ?via=redirect. */
  redirect: (on: boolean) => void;
  /** What the company says about this person from now on; undefined forgets the person. */
  set: (person: string, entry: Entry | undefined) => void;
  /** From now on, every answer is about this person, whoever was asked about; undefined ends it. */
  answerAbout: (person: string | undefined) => void;
  /** From now on, every reply is a page that is not an answer. */
  replyUnreadable: () => void;
  /** From now on, every answer says its facts were read at this time (ISO); undefined means now. */
  readAt: (time: string | undefined) => void;
  /** From now on, every reply is this status with no answer; undefined ends it. */
  replyStatus: (status: number | undefined) => void;
  /** From now on, every answer comes with this status instead of 200; undefined ends it. */
  answerStatus: (status: number | undefined) => void;
  /** How many requests their sender let go of before the server replied. */
  dropped: () => number;
  /** From now on, the server takes each request and never replies. */
  hang: () => void;
  // So a test can hold a lookup in flight, and send calls while it waits (step
  // 45b's README, D9).
  /** From now on, the server keeps each reply back, until release() sends it. */
  hold: () => void;
  /** Sends every reply kept back, as the switches stand then, and keeps no more back. */
  release: () => void;
  /** Closes the server, and every request it holds. */
  stop: () => Promise<void>;
};

/** Starts a test server for one company, on 127.0.0.1, at a port the system picks. */
export async function startSignInServer(
  tenant: string,
  people: Record<string, Entry>,
  key = `dsor_test_${tenant}`,
): Promise<SignInServer> {
  const known = new Map(Object.entries(structuredClone(people)));
  let about: string | undefined;
  let unreadable = false;
  let readTime: string | undefined;
  let status: number | undefined;
  let answeredWith = 200;
  let droppedRequests = 0;
  let hanging = false;
  let requests = 0;
  let redirecting = false;
  let holding = false;
  const held: (() => void)[] = [];
  const log: { tenant: string | null; person: string | null; authorization: string | undefined }[] =
    [];
  const sockets = new Set<Socket>();

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== PATH) {
      response.writeHead(404).end();
      return;
    }
    requests += 1;
    log.push({
      tenant: url.searchParams.get("tenant"),
      person: url.searchParams.get("person"),
      authorization: request.headers.authorization,
    });
    if (hanging) {
      // The sender gives up: its side closes before this side ever replies.
      response.on("close", () => {
        if (!response.writableEnded) droppedRequests += 1;
      });
      return;
    }
    // The reply, sent now, or kept back until release() while the server holds its replies.
    const reply = (): void => {
      // A redirect to a lookup that would answer well: DSoR must not follow it (step 45's lookup.ts).
      if (redirecting && !url.searchParams.has("via")) {
        url.searchParams.set("via", "redirect");
        response.writeHead(302, { location: `${url.pathname}${url.search}` }).end();
        return;
      }
      if (status !== undefined) {
        response.writeHead(status).end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${key}`) {
        response.writeHead(401).end();
        return;
      }
      const asked = url.searchParams.get("tenant");
      if (asked !== tenant) {
        response.writeHead(403).end();
        return;
      }
      if (unreadable) {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>Sign in</html>");
        return;
      }
      const person = about ?? url.searchParams.get("person") ?? "";
      // A person this company does not know is gone: left, or never had an account (D4).
      const entry = known.get(person) ?? { status: "gone", roles: [] };
      const answer = {
        tenant,
        person,
        status: entry.status,
        roles: entry.status === "active" ? entry.roles : [],
        as_of: readTime ?? new Date().toISOString(),
      };
      response
        .writeHead(answeredWith, { "content-type": "application/json" })
        .end(JSON.stringify(answer));
    };
    if (holding) {
      // A sender that gave up meanwhile gets nothing: its side is closed.
      held.push(() => {
        if (!response.destroyed) reply();
      });
      return;
    }
    reply();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const running: SignInServer = {
    address: `http://127.0.0.1:${port}${PATH}`,
    key,
    asked: () => requests,
    seen: () => structuredClone(log),
    redirect: (on) => {
      redirecting = on;
    },
    set: (person, entry) => {
      if (entry === undefined) known.delete(person);
      else known.set(person, structuredClone(entry));
    },
    answerAbout: (person) => {
      about = person;
    },
    replyUnreadable: () => {
      unreadable = true;
    },
    readAt: (time) => {
      readTime = time;
    },
    replyStatus: (code) => {
      status = code;
    },
    answerStatus: (code) => {
      answeredWith = code ?? 200;
    },
    dropped: () => droppedRequests,
    hang: () => {
      hanging = true;
    },
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const send of held.splice(0)) send();
    },
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
  return Object.freeze(running);
}
