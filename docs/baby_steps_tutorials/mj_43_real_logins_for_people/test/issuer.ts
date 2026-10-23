// What the tests of step 43 share: a real sign-in service on 127.0.0.1, in the shape Managed Better
// Auth gives. It holds an Ed25519 key, publishes the public half at /.well-known/jwks.json, and
// signs tokens. Not a test file itself.
import { createServer, type Server } from "node:http";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import type { Issuer } from "../src/issuers.ts";

/** A running issuer, and what a test may do with it. */
export type TestIssuer = Issuer & {
  /** A token for this subject, signed with the issuer's key, 15 minutes long, with these claims. */
  sign: (
    subject: string | undefined,
    claims?: JWTPayload,
    header?: { alg?: string; kid?: string },
  ) => Promise<string>;
  /** A new key; the old one is no longer published. */
  rotate: () => Promise<void>;
  /** Stops publishing keys: the address answers 503. */
  down: (isDown: boolean) => void;
  close: () => Promise<void>;
};

type Key = { kid: string; privateKey: CryptoKey; publicJwk: JWK };

async function newKey(kid: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "EdDSA", use: "sig" };
  return { kid, privateKey, publicJwk };
}

/** Starts an issuer on a free port of 127.0.0.1. Its issuer and audience are its origin, as Neon's are. */
export async function startIssuer(): Promise<TestIssuer> {
  let key = await newKey("key-1");
  let isDown = false;
  let rotations = 1;
  const server: Server = createServer((req, res) => {
    if (isDown || req.url !== "/.well-known/jwks.json") {
      res.writeHead(isDown ? 503 : 404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [key.publicJwk] }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  return {
    issuer: origin,
    audience: origin,
    jwks: `${origin}/.well-known/jwks.json`,
    sign: async (subject, claims = {}, header = {}) => {
      const jwt = new SignJWT({ email: `${subject ?? "nobody"}@example.com`, ...claims })
        .setProtectedHeader({ alg: header.alg ?? "EdDSA", kid: header.kid ?? key.kid, typ: "JWT" })
        .setIssuedAt();
      if (!("exp" in claims)) jwt.setExpirationTime("15m");
      if (subject !== undefined) jwt.setSubject(subject);
      if (!("iss" in claims)) jwt.setIssuer(origin);
      if (!("aud" in claims)) jwt.setAudience(origin);
      return jwt.sign(key.privateKey);
    },
    rotate: async () => {
      rotations++;
      key = await newKey(`key-${rotations}`);
    },
    down: (value) => {
      isDown = value;
    },
    close: () => new Promise((done) => server.close(() => done())),
  };
}
