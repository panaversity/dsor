// Step 39b on the database: a checkpoint of the real log covers every chain; the careful editor's
// rewrite of step 39b's "Why it matters" is caught against it; the newest record removed with its
// head is caught; a broken log is never signed; and the two scripts refuse to run without what they
// need (DSOR-AUD-04b, DSOR-AUD-04d; step 39b's README, claims C2, C4, C5).
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { dbRegistry, newPool, ownerCheckpoint, requestId } from "./db.ts";
import { SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const script = (name: string) => fileURLToPath(new URL(`../src/${name}`, import.meta.url));

// A key pair and a folder of the test's own, so the learner's own checkpoints are never touched.
const dir = mkdtempSync(join(tmpdir(), "dsor-39b-"));
const keys = generateKeyPairSync("ed25519");
const privateFile = join(dir, "private.pem");
const publicFile = join(dir, "public.pem");
const checkpoints = join(dir, "checkpoints");

/** What the checker reported, as the owner's program prints it. */
type Checked = {
  exit: 0 | 1 | 2;
  reports: { chain: string; records: number; broken?: { position: number; why: string } }[];
  files: { name: string; broken?: string }[];
  notes: string[];
};

/** user_123 reads INV-1008: one more record in org_456's chain. */
async function aRead(): Promise<void> {
  const answer: Answer = await call(
    registry,
    log,
    { ...SUPERVISOR, request_id: requestId("checkpoint") },
    "invoice.get",
    { invoice: "dsor://org_456/invoice/INV-1008" },
  );
  expect(answer).toHaveProperty("data");
}

/** org_456's first record, which the careful editor rewrites from. */
const firstOf456 = (): string =>
  (ownerCheckpoint("first", "org_456") as { record_id: string }).record_id;

beforeAll(async () => {
  writeFileSync(privateFile, keys.privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(publicFile, keys.publicKey.export({ type: "spki", format: "pem" }));
  await aRead();
  await aRead();
  expect(ownerCheckpoint("take", checkpoints, privateFile)).toHaveProperty("written");
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await pool.end();
});

describe("C2: a checkpoint of the real log", () => {
  it("DSOR-AUD-04d: the checkpoint names every chain the log holds, each at its head", () => {
    const [file] = readdirSync(checkpoints);
    const { checkpoint } = JSON.parse(readFileSync(join(checkpoints, file!), "utf8")) as {
      checkpoint: { chains: { chain: string; chain_position: string; record_hash: string }[] };
    };
    const now = ownerCheckpoint("chains") as {
      chains: string[];
      heads: { chain: string; chain_position: string }[];
    };
    expect(checkpoint.chains.map((c) => c.chain)).toStrictEqual(now.chains);
    // Each chain at its head as the database held it at the checkpoint: never past the head now.
    for (const noted of checkpoint.chains) {
      const head = now.heads.find((h) => h.chain === noted.chain)!;
      expect(Number(head.chain_position)).toBeGreaterThanOrEqual(Number(noted.chain_position));
    }
  });

  it("DSOR-AUD-04b: the untouched log matches its checkpoint", () => {
    const checked = ownerCheckpoint("verify", checkpoints, publicFile) as Checked;
    expect(checked.files).toStrictEqual([{ name: readdirSync(checkpoints)[0] }]);
    expect(checked.reports.find((r) => r.chain === "org_456")!.broken).toBeUndefined();
  });

  it("DSOR-AUD-04b: a log with one record turned over is never signed: refused, and no file written", () => {
    const before = readdirSync(checkpoints);
    const taken = ownerCheckpoint("edit-take", firstOf456(), checkpoints, privateFile);
    expect(taken).toHaveProperty("refused");
    expect(readdirSync(checkpoints)).toStrictEqual(before);
  });
});

describe("C4: the careful editor, against the checkpoint", () => {
  it("DSOR-AUD-04b: P1: org_456 rewritten from its first record on, head and all: named at the checkpoint's place, exit 1", () => {
    const checked = ownerCheckpoint("rewrite", firstOf456(), checkpoints, publicFile) as Checked;
    expect(checked.reports.find((r) => r.chain === "org_456")!.broken?.why).toContain(
      "its fingerprint is not the one checkpoint",
    );
    expect(checked.exit).toBe(1);
  });

  it("DSOR-AUD-04b: org_456's newest record removed and its head set back: the chain no longer reaches the checkpoint's place, exit 1", () => {
    const checked = ownerCheckpoint("trim", "org_456", checkpoints, publicFile) as Checked;
    expect(checked.reports.find((r) => r.chain === "org_456")!.broken?.why).toMatch(
      /^checkpoint .* noted place \d+, and the chain ends at place \d+$/,
    );
    expect(checked.exit).toBe(1);
  });

  it("DSOR-AUD-04b: the same rewrite held against a public key that is not the signer's: the checkpoint is named, exit 1", () => {
    const other = join(dir, "other.pem");
    writeFileSync(
      other,
      generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }),
    );
    const checked = ownerCheckpoint("verify", checkpoints, other) as Checked;
    expect(checked.files[0]!.broken).toBe("its signature does not match the committed public key");
    expect(checked.exit).toBe(1);
  });
});

describe("C5: the scripts", () => {
  const run = (name: string, env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [script(name)], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, ...env },
    });

  it("DSOR-AUD-04b: P3: pnpm verify-audit with a folder holding no checkpoint: every chain checked as in step 39, then not checked, exit 2", () => {
    const empty = mkdtempSync(join(tmpdir(), "dsor-39b-none-"));
    try {
      const verify = run("verify-audit.ts", { DSOR_CHECKPOINT_DIR: empty });
      expect(verify.stdout).toContain("org_456: whole");
      expect(verify.stdout).toContain("not checked:");
      expect(verify.status).toBe(2);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("DSOR-AUD-04b: pnpm checkpoint-audit signs with the key DSOR_CHECKPOINT_KEY names, into DSOR_CHECKPOINT_DIR, exit 0", () => {
    const out = join(dir, "by-script");
    const taken = run("checkpoint-audit.ts", {
      DSOR_CHECKPOINT_KEY: privateFile,
      DSOR_CHECKPOINT_DIR: out,
    });
    expect(taken.stdout).toMatch(/^checkpoint written: .*\.json, \d+ chains$/m);
    expect(taken.status).toBe(0);
    const checked = ownerCheckpoint("verify", out, publicFile) as Checked;
    expect(checked.files).toHaveLength(1);
    expect(checked.files[0]!.broken).toBeUndefined();
    // The private key is never printed.
    expect(taken.stdout + taken.stderr).not.toContain("PRIVATE KEY");
  });

  it("DSOR-AUD-04b: pnpm checkpoint-audit with no private key named: signs nothing, exit 2", () => {
    const out = join(dir, "no-key");
    const taken = run("checkpoint-audit.ts", { DSOR_CHECKPOINT_KEY: "", DSOR_CHECKPOINT_DIR: out });
    expect(taken.stdout).toContain("not taken: DSOR_CHECKPOINT_KEY");
    expect(taken.status).toBe(2);
    expect(() => readdirSync(out)).toThrow();
  });

  it("DSOR-AUD-04b: pnpm checkpoint-audit as dsor_runtime, which cannot see every record: signs nothing, exit 2", () => {
    const out = join(dir, "runtime");
    const taken = run("checkpoint-audit.ts", {
      DSOR_MIGRATION_URL: process.env["DSOR_DB_URL"],
      DSOR_CHECKPOINT_KEY: privateFile,
      DSOR_CHECKPOINT_DIR: out,
    });
    expect(taken.stdout).toContain("not taken: this login cannot see every record");
    expect(taken.status).toBe(2);
    expect(() => readdirSync(out)).toThrow();
  });
});
