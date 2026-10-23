// NEW IN STEP 43: run with  pnpm dev-issuer
// A stand-in for Managed Better Auth, on this computer only, so the step runs without a Neon
// account. It makes a new Ed25519 key each time it starts, publishes the public half at
// /.well-known/jwks.json, and signs in the story's people at /token?email=…, with a token in the
// shape Neon's documentation gives: EdDSA, a kid, iss and aud its own origin, the user's id as sub,
// and 15 minutes of life. DSoR trusts it only where issuers.json names it (step 43's README,
// decision D9). Port 8043, unless DSOR_DEV_ISSUER_PORT names another; 0 picks a free one.
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// The story's people, by the email they sign in with, and their user id here. The ids are the
//   sign-in service's, not DSoR's principals: pnpm link-login links each one (decision D5).
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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };
  if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
    send(200, jwks);
    return;
  }
  const subject = USERS.get(url.searchParams.get("email") ?? "");
  if (req.method !== "GET" || url.pathname !== "/token" || subject === undefined) {
    send(404, { error: "the stand-in signs in only the story's people, at /token?email=…" });
    return;
  }
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  void new SignJWT({ email: url.searchParams.get("email") })
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
    .setIssuer(origin)
    .setAudience(origin)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey)
    .then((token) => send(200, { token }));
});

// Only this computer: the stand-in makes valid tokens, so nothing else may reach it.
server.listen(port, "127.0.0.1", () => {
  const bound = (server.address() as { port: number }).port;
  console.log(`the stand-in for Managed Better Auth listens on http://127.0.0.1:${bound}`);
});
process.once("SIGINT", () => server.close());
