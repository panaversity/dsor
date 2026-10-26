// NEW IN STEP 44: what the tests of step 44 share: a sign-in server on 127.0.0.1, in the Panaversity
// SSO's shape. It holds an RS256 key, publishes the public half at /api/auth/jwks, and signs tokens
// made for DSoR: aud DSoR's address and its own userinfo address, scope "openid dsor", the client in
// azp, one hour long. The key exists only inside the tests (step 44's README, decision 44-8). Not a
// test file itself.
import { createServer, type Server } from "node:http";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import type { SignIn } from "../src/sign-in.ts";

/** DSoR's own address, the audience a token must name (decision 44-3). */
export const DSOR = "http://127.0.0.1:8042";
/** DSoR's own client for people, the one sign-in.json lists (decision R2). */
export const PEOPLE_APP = "dsor-people";

/** A running sign-in server, and what a test may do with it. */
export type TestIssuer = {
  issuer: string;
  jwks: string;
  userinfo: string;
  /** What sign-in.json says about this server, for the token check. */
  signIn: SignIn;
  /**
   * A token for this subject, signed with the server's key, made for DSoR, with these claims laid
   * over the usual ones. A claim given as undefined is left out.
   */
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

async function newKey(kid: string, alg: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: "sig" };
  return { kid, privateKey, publicJwk };
}

/** Starts a sign-in server on a free port of 127.0.0.1, signing with RS256 unless told otherwise. */
export async function startIssuer(alg = "RS256"): Promise<TestIssuer> {
  let key = await newKey("key-1", alg);
  let isDown = false;
  let rotations = 1;
  const server: Server = createServer((req, res) => {
    if (isDown || req.url !== "/api/auth/jwks") {
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
  const userinfo = `${origin}/api/auth/oauth2/userinfo`;
  return {
    issuer: origin,
    jwks: `${origin}/api/auth/jwks`,
    userinfo,
    signIn: {
      issuer: origin,
      jwks: `${origin}/api/auth/jwks`,
      algorithms: ["RS256"],
      max_age: "1h",
      audience: DSOR,
      other_audiences: [userinfo],
      scope: "dsor",
      clients: [PEOPLE_APP],
    },
    sign: async (subject, claims = {}, header = {}) => {
      const usual: JWTPayload = {
        iss: origin,
        aud: [DSOR, userinfo],
        scope: "openid dsor",
        azp: PEOPLE_APP,
        email: `${subject ?? "nobody"}@example.com`,
      };
      // A claim given as undefined is left out of the token.
      const payload = Object.fromEntries(
        Object.entries({ ...usual, ...claims }).filter(([, value]) => value !== undefined),
      );
      const jwt = new SignJWT(payload)
        .setProtectedHeader({ alg: header.alg ?? alg, kid: header.kid ?? key.kid, typ: "JWT" })
        .setIssuedAt(typeof claims.iat === "number" ? claims.iat : undefined);
      if (!("exp" in claims)) jwt.setExpirationTime("1h");
      if (subject !== undefined) jwt.setSubject(subject);
      return jwt.sign(key.privateKey);
    },
    rotate: async () => {
      rotations++;
      key = await newKey(`key-${rotations}`, alg);
    },
    down: (value) => {
      isDown = value;
    },
    close: () => new Promise((done) => server.close(() => done())),
  };
}
