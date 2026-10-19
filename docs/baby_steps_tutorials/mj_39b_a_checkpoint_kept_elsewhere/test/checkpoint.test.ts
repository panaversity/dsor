// Step 39b: checkpoints. A checkpoint notes where each chain ends, signed with a private key kept
// outside the database. The checker holds every chain against every checkpoint it is given: a
// rewrite from an edit on now shows, and a forged checkpoint shows too (DSOR-AUD-04b, DSOR-AUD-04d;
// step 39b's README, claims C1 to C6).
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fingerprint, GENESIS, NO_CHAIN, type ChainRow } from "../src/audit-chain.ts";
import {
  checkpointFileName,
  checkpointText,
  signCheckpoint,
  takeCheckpoint,
  type Checkpoint,
} from "../src/checkpoint.ts";
import { checkAgainstCheckpoints, MAX_AGE_HOURS } from "../src/checkpoint-check.ts";
import { makeKeyPair, readPrivateKey, readPublicKey } from "../src/checkpoint-files.ts";

/** A chain of records, fingerprinted as the database does. */
function chainOf(chain: string, records: (string | null)[][]): ChainRow[] {
  const rows: ChainRow[] = [];
  let previous = GENESIS;
  records.forEach((fields, i) => {
    const position = String(i + 1);
    const record_hash = fingerprint(previous, chain, position, fields);
    rows.push({ chain, chain_position: position, previous_hash: previous, record_hash, fields });
    previous = record_hash;
  });
  return rows;
}

/** org_456's three records: a draft, the denied reconcile, a release. */
const STORY = (): (string | null)[][] => [
  ["1", "aud_1", "2026-10-20T09:00:00.000000Z", "decision", "payment.create@1", "ALLOW"],
  ["2", "aud_2", "2026-10-20T09:01:00.000000Z", "decision", "payment.reconcile@1", "DENY"],
  ["3", "aud_3", "2026-10-20T09:02:00.000000Z", "decision", "proposal.execute@1", "ALLOW"],
];

/** The log of the story: org_456's three records, and one record of no company. */
const LOG = (): ChainRow[] => [
  ...chainOf("org_456", STORY()),
  ...chainOf("no_company", [["4", "aud_4", "2026-10-20T09:03:00.000000Z", "decision"]]),
];

const KEYS = generateKeyPairSync("ed25519");
const OTHER = generateKeyPairSync("ed25519");
const AT_9 = "2026-10-20T09:00:00.000Z";
const AT_10 = "2026-10-20T10:00:00.000Z";

/** A checkpoint of these rows, taken at this time, as the file the script would write. */
function fileOf(rows: ChainRow[], at: string, key: KeyObject = KEYS.privateKey) {
  const taken = takeCheckpoint(rows, undefined, at);
  if (!("checkpoint" in taken)) throw new Error("the test's log is broken");
  const text = JSON.stringify(signCheckpoint(taken.checkpoint, key), null, 2);
  return { name: checkpointFileName(taken.checkpoint), text };
}

/** The careful editor: place 2 turned to ALLOW, and every fingerprint from there written again. */
function rewritten(): ChainRow[] {
  const story = STORY();
  story[1]![5] = "ALLOW";
  return [...chainOf("org_456", story), ...LOG().filter((r) => r.chain === "no_company")];
}

const check = (rows: ChainRow[], files: { name: string; text: string }[], now = AT_10) =>
  checkAgainstCheckpoints(rows, undefined, files, KEYS.publicKey, now);

describe("C1: the key pair", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsor-39b-keys-"));
  const privateFile = join(dir, "private.pem");
  const publicFile = join(dir, "public.pem");

  it("DSOR-AUD-04b: the private key is readable by its owner only, and the pair signs a checkpoint the checker accepts", () => {
    makeKeyPair(privateFile, publicFile);
    expect(statSync(privateFile).mode & 0o777).toBe(0o600);
    const taken = takeCheckpoint(LOG(), undefined, AT_9);
    if (!("checkpoint" in taken)) throw new Error("the test's log is broken");
    const text = JSON.stringify(signCheckpoint(taken.checkpoint, readPrivateKey(privateFile)));
    const name = checkpointFileName(taken.checkpoint);
    const result = checkAgainstCheckpoints(
      LOG(),
      undefined,
      [{ name, text }],
      readPublicKey(publicFile),
      AT_10,
    );
    expect(result.exit).toBe(0);
  });

  it("DSOR-AUD-04b: a private key file already there is never overwritten", () => {
    expect(() => makeKeyPair(privateFile, publicFile)).toThrow();
  });

  it("DSOR-AUD-04b: a private key is never written inside this folder, where git could pick it up", () => {
    const inside = fileURLToPath(new URL("../private.pem", import.meta.url));
    expect(() => makeKeyPair(inside, publicFile)).toThrow(/outside this folder/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("C2: taking a checkpoint", () => {
  it("DSOR-AUD-04d: a checkpoint covers every chain of the log, no_company included, each at its last place", () => {
    const taken = takeCheckpoint(LOG(), undefined, AT_9);
    expect("checkpoint" in taken && taken.checkpoint).toStrictEqual({
      taken_at: AT_9,
      chains: [
        { chain: "no_company", chain_position: "1", record_hash: LOG()[3]!.record_hash },
        { chain: "org_456", chain_position: "3", record_hash: LOG()[2]!.record_hash },
      ],
    });
  });

  it("DSOR-AUD-04b: a broken log is never signed: the checkpoint is refused, and the break is named", () => {
    const rows = LOG();
    rows[1]!.fields[5] = "ALLOW";
    const taken = takeCheckpoint(rows, undefined, AT_9);
    expect("checkpoint" in taken).toBe(false);
    expect("refused" in taken && taken.refused).toMatchObject([
      { chain: "no_company" },
      { chain: "org_456", broken: { position: 2, record_id: "aud_2" } },
    ]);
  });

  it("DSOR-AUD-04b: a record with no chain is a broken log, so no checkpoint", () => {
    const rows = [
      ...LOG(),
      { chain: NO_CHAIN, chain_position: "0", previous_hash: "", record_hash: "", fields: ["9"] },
    ];
    expect("checkpoint" in takeCheckpoint(rows, undefined, AT_9)).toBe(false);
  });

  it("DSOR-AUD-04b: the signed text has its fields in a fixed order and its chains sorted, whatever order they came in", () => {
    const a: Checkpoint = {
      taken_at: AT_9,
      chains: [
        { chain: "org_456", chain_position: "3", record_hash: "sha256:b" },
        { chain: "no_company", chain_position: "1", record_hash: "sha256:a" },
      ],
    };
    const b: Checkpoint = {
      chains: [...a.chains].reverse().map((c) => ({
        record_hash: c.record_hash,
        chain: c.chain,
        chain_position: c.chain_position,
      })),
      taken_at: AT_9,
    };
    expect(checkpointText(a)).toBe(checkpointText(b));
  });

  it("DSOR-AUD-04b: a checkpoint's file is named by its time, with no colon", () => {
    expect(checkpointFileName({ taken_at: AT_9, chains: [] })).toBe(
      "2026-10-20T09-00-00.000Z.json",
    );
  });
});

describe("C3 to C5: the log held against its checkpoints", () => {
  it("DSOR-AUD-04b: an untouched log matches its checkpoint, exit 0", () => {
    const result = check(LOG(), [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(0);
    expect(result.reports.every((r) => r.broken === undefined)).toBe(true);
  });

  it("DSOR-AUD-04b: P1: the careful editor's rewrite from place 2 on is named at the checkpoint's place 3, exit 1", () => {
    const result = check(rewritten(), [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(1);
    expect(result.reports.find((r) => r.chain === "org_456")!.broken).toStrictEqual({
      position: 3,
      record_id: "aud_3",
      why: "its fingerprint is not the one checkpoint 2026-10-20T09-00-00.000Z.json noted",
    });
  });

  it("DSOR-AUD-04b: the newest record removed and the head set back: the chain no longer reaches the checkpoint's place, exit 1", () => {
    const rows = LOG().filter((r) => r.fields[1] !== "aud_3");
    const result = check(rows, [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(1);
    expect(result.reports.find((r) => r.chain === "org_456")!.broken).toStrictEqual({
      position: 3,
      record_id: null,
      why: "checkpoint 2026-10-20T09-00-00.000Z.json noted place 3, and the chain ends at place 2",
    });
  });

  it("DSOR-AUD-04b: every record of a chain removed, head and all: the checkpoint still names the chain, exit 1", () => {
    const rows = LOG().filter((r) => r.chain !== "no_company");
    const result = check(rows, [fileOf(LOG(), AT_9)]);
    expect(result.reports.find((r) => r.chain === "no_company")).toMatchObject({
      records: 0,
      broken: { position: 1, record_id: null },
    });
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: P2: a checkpoint edited to hold the rewritten fingerprint fails its signature: the file is named, not used, exit 1", () => {
    const forged = fileOf(LOG(), AT_9);
    const honest = JSON.parse(forged.text) as { checkpoint: Checkpoint };
    const rows = rewritten();
    honest.checkpoint.chains[1]!.record_hash = rows[2]!.record_hash;
    forged.text = JSON.stringify(honest);
    const result = check(rows, [forged]);
    expect(result.files).toStrictEqual([
      { name: forged.name, broken: "its signature does not match the committed public key" },
    ]);
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: a checkpoint signed by another key is named, exit 1", () => {
    const result = check(LOG(), [fileOf(LOG(), AT_9, OTHER.privateKey)]);
    expect(result.files[0]!.broken).toBe("its signature does not match the committed public key");
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: a file that is not a checkpoint, or one with a field added, is named, exit 1", () => {
    const good = fileOf(LOG(), AT_9);
    const extra = JSON.parse(good.text) as { checkpoint: Record<string, unknown> };
    extra.checkpoint["note"] = "trust me";
    const result = check(LOG(), [
      { name: "a.json", text: "not json" },
      { name: "b.json", text: JSON.stringify(extra) },
    ]);
    expect(result.files.map((f) => f.broken)).toStrictEqual([
      "it is not a checkpoint",
      "it is not a checkpoint",
    ]);
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: P3: no checkpoint at all: not checked, exit 2", () => {
    const result = check(LOG(), []);
    expect(result.exit).toBe(2);
    expect(result.notes).toContain("not checked: there is no checkpoint");
  });

  it("DSOR-AUD-04b: P3: every checkpoint deleted, then the chain rewritten: not checked, exit 2, never whole", () => {
    expect(check(rewritten(), []).exit).toBe(2);
  });

  it("DSOR-AUD-04b: a newest checkpoint older than 24 hours: not checked, exit 2", () => {
    expect(MAX_AGE_HOURS).toBe(24);
    const result = check(LOG(), [fileOf(LOG(), AT_9)], "2026-10-21T09:00:00.001Z");
    expect(result.exit).toBe(2);
    expect(result.notes).toContain(
      "not checked: the newest checkpoint is older than 24 hours (2026-10-20T09:00:00.000Z)",
    );
  });

  it("DSOR-AUD-04b: exactly 24 hours old is still fresh, exit 0", () => {
    expect(check(LOG(), [fileOf(LOG(), AT_9)], "2026-10-21T09:00:00.000Z").exit).toBe(0);
  });

  it("DSOR-AUD-04b: a broken chain beats a stale checkpoint: exit 1, not 2", () => {
    const rows = LOG();
    rows[1]!.fields[5] = "ALLOW";
    expect(check(rows, [fileOf(LOG(), AT_9)], "2026-10-25T09:00:00.000Z").exit).toBe(1);
  });

  it("DSOR-AUD-04b: every checkpoint is checked: the newest deleted, an older one still names the rewrite", () => {
    const older = fileOf(LOG(), AT_9);
    // The newest, taken after the rewrite, vouches for it; the older one does not.
    const newer = fileOf(rewritten(), AT_10);
    const result = check(rewritten(), [newer, older]);
    expect(result.reports.find((r) => r.chain === "org_456")!.broken?.position).toBe(3);
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: a forged file does not count as the newest: with no other checkpoint, the log is not vouched for", () => {
    const forged = fileOf(LOG(), AT_10, OTHER.privateKey);
    const result = check(LOG(), [forged]);
    expect(result.notes).toContain("not checked: there is no checkpoint");
  });

  it("DSOR-AUD-04b: a chain no checkpoint names yet is reported, not broken: org_789's first record came after it", () => {
    const rows = [...LOG(), ...chainOf("org_789", [["5", "aud_5", AT_10, "decision"]])];
    const result = check(rows, [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(0);
    expect(result.notes).toContain("org_789: not yet in a checkpoint");
    expect(result.reports.find((r) => r.chain === "org_789")!.broken).toBeUndefined();
  });

  it("DSOR-AUD-04b: step 39's own break comes first: an edited record is named at its own place, not at the checkpoint's", () => {
    const rows = LOG();
    rows[1]!.fields[5] = "ALLOW";
    const report = check(rows, [fileOf(LOG(), AT_9)]).reports.find((r) => r.chain === "org_456");
    expect(report!.broken).toMatchObject({ position: 2, record_id: "aud_2" });
  });
});

describe("C6: what a checkpoint cannot see, said plainly", () => {
  it("DSOR-AUD-04b: P4: a record written after the newest checkpoint, edited and rewritten, passes: exit 0", () => {
    const story = [...STORY(), ["9", "aud_9", AT_10, "decision", "payment.create@1", "DENY"]];
    const file = fileOf(chainOf("org_456", story.slice(0, 3)), AT_9);
    story[3]![5] = "ALLOW";
    expect(check(chainOf("org_456", story), [file]).exit).toBe(0);
  });

  it("DSOR-AUD-04b: the checker says what it cannot see, every time", () => {
    expect(check(LOG(), [fileOf(LOG(), AT_9)]).notes).toContain(
      "not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key",
    );
  });
});
