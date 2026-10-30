// Step 43: the programs themselves. pnpm dev-issuer, the stand-in for Managed Better Auth, signs a
// token; pnpm invite invites cfo_100, and her first call with the code links her login; pnpm serve,
// over the database, takes it, and refuses the fake tokens of people (step 43's README, claims C5
// and C8, decisions D1, D8, and D9; changed by the learner's R1 and R3).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbBook } from "../src/postgres.ts";
import { newPool } from "./db.ts";

const STEP = fileURLToPath(new URL("..", import.meta.url));
const running: ChildProcess[] = [];

let issuerOut = "";

/** Starts one of the step's programs, and waits for the line that says where it listens. */
function start(program: string, env: Record<string, string>): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(STEP, "src", program)], {
      cwd: STEP,
      env: { ...process.env, ...env },
    });
    running.push(child);
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (program === "dev-issuer.ts") issuerOut = out;
      const found = /listens on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (found?.[1] !== undefined) done(found[1]);
    });
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("exit", (code) => fail(new Error(`${program} stopped, ${code}: ${out}`)));
  });
}

let issuer: string;
let door: string;
let issuersFile: string;
// cfo_100's invitation code, which pnpm invite prints once.
let invitation: string;

/** cfo_100's sign-in code, which the stand-in prints in its own terminal only (the review's H1). */
function codeOf(email: string): string {
  const found = new RegExp(`${email.replace(".", "\\.")}\\s+(\\d{6})`).exec(issuerOut);
  if (found?.[1] === undefined) throw new Error(`no code for ${email} in: ${issuerOut}`);
  return found[1];
}
beforeAll(async () => {
  issuer = await start("dev-issuer.ts", { DSOR_DEV_ISSUER_PORT: "0" });
  const one = [
    { issuer, audience: issuer, jwks: `${issuer}/.well-known/jwks.json`, dedicated_to_dsor: true },
  ];
  const file = join(mkdtempSync(join(tmpdir(), "dsor43-")), "issuers.json");
  writeFileSync(file, JSON.stringify({ org_456: one, org_789: one }));
  // One live login for each person (the review's finding 1): another file may have linked her.
  const pool = newPool();
  await createDbBook(pool).unlink("org_456", "cfo_100", {
    person: "admin_100",
    reason: "serve test",
  });
  await pool.end();
  const invited = spawnSync(
    process.execPath,
    [join(STEP, "src", "invite.ts"), "org_456", "cfo_100", "the serve test"],
    {
      cwd: STEP,
      env: { ...process.env, DSOR_ISSUERS_FILE: file },
      encoding: "utf8",
    },
  );
  expect(invited.status).toBe(0);
  invitation = /code: (\S+)/.exec(invited.stdout)?.[1] ?? "";
  issuersFile = file;
  door = await start("serve.ts", {
    DSOR_HTTP_PORT: "0",
    DSOR_ISSUERS_FILE: file,
    DSOR_STAND_IN: "on",
  });
}, 60_000);
afterAll(() => {
  for (const child of running) child.kill("SIGINT");
});

async function invoice(
  token: string,
  code?: string,
): Promise<{ status: number; principal?: string }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "dsor-tenant": "org_456",
    ...(code === undefined ? {} : { "dsor-invitation": code }),
  };
  const response = await fetch(`${door}/invoices/INV-1008`, { headers });
  const body = (await response.json()) as { correlation: { principal_id?: string } };
  return { status: response.status, principal: body.correlation.principal_id };
}

describe("C8: pnpm serve takes real logins for people", () => {
  it("Step 43, R1: cfo_100 signs in at the stand-in, sends her invitation once, and pnpm serve answers her as cfo_100", async () => {
    const code = codeOf("cfo@org456.example");
    const signed = await fetch(`${issuer}/token?email=cfo@org456.example&code=${code}`);
    const { token } = (await signed.json()) as { token: string };
    expect(await invoice(token, invitation)).toStrictEqual({ status: 200, principal: "cfo_100" });
    expect(await invoice(token)).toStrictEqual({ status: 200, principal: "cfo_100" });
  });

  it("Step 43, R1: user_123, signed in at the stand-in but never invited, is no caller", async () => {
    const code = codeOf("user123@org456.example");
    const signed = await fetch(`${issuer}/token?email=user123@org456.example&code=${code}`);
    const { token } = (await signed.json()) as { token: string };
    expect(await invoice(token)).toStrictEqual({ status: 401, principal: undefined });
  });

  it("Step 43, D1: pnpm serve refuses tok_d4e8, the CFO's fake token, from the public file", async () => {
    expect(await invoice("tok_d4e8")).toStrictEqual({ status: 401, principal: undefined });
  });

  it("Step 43, D9: the stand-in signs in only the story's people", async () => {
    const response = await fetch(`${issuer}/token?email=someone@else.example&code=000000`);
    expect(response.status).toBe(401);
  });

  it.each([
    ["no code", ""],
    ["a wrong code", "&code=123456"],
    ["user_123's code", "&code=USER"],
  ])(
    "Step 43, D9: cfo_100 with %s gets no token: anyone on this computer is not anyone (the review's H1)",
    async (_kind, part) => {
      const code = part === "&code=USER" ? `&code=${codeOf("user123@org456.example")}` : part;
      const response = await fetch(`${issuer}/token?email=cfo@org456.example${code}`);
      expect(response.status).toBe(401);
    },
  );

  it("Step 43, D9: pnpm serve refuses to start with the stand-in as an issuer unless DSOR_STAND_IN=on says so", () => {
    const run = spawnSync(process.execPath, [join(STEP, "src", "serve.ts")], {
      cwd: STEP,
      env: {
        ...process.env,
        DSOR_HTTP_PORT: "0",
        DSOR_ISSUERS_FILE: issuersFile,
        DSOR_STAND_IN: "",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is plain http on this computer: a stand-in");
  });

  // From the code review of step 43b, finding 4: pnpm serve has no directory to ask, so a company
  //   whose role source is idp_lookup would fail at its first agent call, not at start-up.
  it("DSOR-IDN-05: pnpm serve refuses to start when role-sources.json names idp_lookup, which it has no directory for", () => {
    const file = join(mkdtempSync(join(tmpdir(), "dsor43b-")), "role-sources.json");
    writeFileSync(
      file,
      JSON.stringify({
        org_456: { kind: "dsor_assignments", max_staleness: "PT1H" },
        org_789: { kind: "idp_lookup", max_staleness: "PT1H" },
      }),
    );
    const run = spawnSync(process.execPath, [join(STEP, "src", "serve.ts")], {
      cwd: STEP,
      env: {
        ...process.env,
        DSOR_HTTP_PORT: "0",
        DSOR_ISSUERS_FILE: issuersFile,
        DSOR_STAND_IN: "on",
        DSOR_ROLE_SOURCES_FILE: file,
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      "role-sources.json: org_789's role source is idp_lookup, and pnpm serve has no directory to ask: name dsor_assignments",
    );
  });
});
