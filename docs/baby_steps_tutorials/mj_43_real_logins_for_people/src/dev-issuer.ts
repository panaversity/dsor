// NEW IN STEP 43: run with  pnpm dev-issuer
// A stand-in for Managed Better Auth, on this computer only, so the step runs without a Neon
// account. It makes a new Ed25519 key each time it starts, publishes the public half at
// /.well-known/jwks.json, and signs in the story's people at /token?email=…&code=…, with a token in the
// shape Neon's documentation gives: EdDSA, a kid, iss and aud its own origin, the user's id as sub,
// and 15 minutes of life. DSoR trusts it only where issuers.json names it (step 43's README,
// decision D9). Port 8043, unless DSOR_DEV_ISSUER_PORT names another; 0 picks a free one.
import { randomInt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// The story's people, by the email they sign in with, and their user id here. The ids are the
//   sign-in service's, not DSoR's principals: an invitation links each one (decision D5; changed by
//   the learner's R1).
const USERS: ReadonlyMap<string, string> = new Map([
  ["cfo@org456.example", "ba_8c1f"],
  ["user123@org456.example", "ba_2c91"],
  ["admin@org456.example", "ba_a100"],
  ["user700@org789.example", "ba_7e00"],
  ["admin@org789.example", "ba_a700"],
]);

const port = Number(process.env["DSOR_DEV_ISSUER_PORT"] ?? "8043");
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("DSOR_DEV_ISSUER_PORT must be a port number, 0 to 65535");
  process.exit(1);
}

const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
const kid = `dev-${Date.now()}`;
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: "EdDSA", use: "sig" }] };

// Changed by step 43's review, H1: a sign-in code for each person, new each time the stand-in starts,
//   printed in its own terminal only, never in the repository. Without it, anyone on this computer,
//   the agent too, could ask for cfo_100's token.
const CODES: ReadonlyMap<string, string> = new Map(
  [...USERS.keys()].map((email) => [email, String(randomInt(100000, 1000000))]),
);

/** Whether this is the person's code, compared in constant time. */
function codeFits(email: string, code: string): boolean {
  const expected = Buffer.from(CODES.get(email) ?? "");
  const given = Buffer.from(code);
  return (
    expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected)
  );
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };
  if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
    send(200, jwks);
    return;
  }
  if (req.method !== "GET" || url.pathname !== "/token") {
    send(404, { error: "the stand-in has /.well-known/jwks.json and /token?email=…&code=…" });
    return;
  }
  const email = url.searchParams.get("email") ?? "";
  const subject = USERS.get(email);
  if (subject === undefined || !codeFits(email, url.searchParams.get("code") ?? "")) {
    send(401, {
      error: "the stand-in signs in only the story's people, each with the code it printed",
    });
    return;
  }
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  void new SignJWT({ email })
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
    .setIssuer(origin)
    .setAudience(origin)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey)
    .then((token) => send(200, { token }));
});

// Only this computer: the stand-in makes valid tokens, so nothing else may reach it. The codes are
//   printed first, so whoever reads where it listens has read them.
server.listen(port, "127.0.0.1", () => {
  const bound = (server.address() as { port: number }).port;
  const lines = [...CODES].map(([email, code]) => `  ${email}  ${code}`);
  console.log(`sign-in codes, until this stand-in stops:\n${lines.join("\n")}`);
  console.log(`the stand-in for Managed Better Auth listens on http://127.0.0.1:${bound}`);
});
process.once("SIGINT", () => server.close());
