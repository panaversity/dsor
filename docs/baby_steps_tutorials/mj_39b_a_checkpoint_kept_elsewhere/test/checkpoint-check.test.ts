// Step 39b: the log held against its checkpoints. A rewrite from an edit on shows; a forged, odd,
// future, or foreign checkpoint shows; a checkpoint removed from the middle shows; and with no
// fresh checkpoint the checker never says whole (DSOR-AUD-04b; step 39b's README, claims C3 to C6).
import { describe, expect, it } from "vitest";
import type { Checkpoint } from "../src/checkpoint.ts";
import { checkAgainstCheckpoints, MAX_AGE_HOURS } from "../src/checkpoint-check.ts";
import {
  AT_10,
  AT_9,
  chainOf,
  check,
  DB,
  fileOf,
  KEYS,
  LOG,
  OTHER,
  rewritten,
  signedAfter,
  STORY,
} from "./checkpoints.ts";

const org456 = (result: ReturnType<typeof check>) =>
  result.reports.find((r) => r.chain === "org_456")!;
const NOT_SIGNED = "its signature does not match the committed public key";
const NOT_A_CHECKPOINT = "it is not a checkpoint";

describe("C4: every chain against every checkpoint", () => {
  it("DSOR-AUD-04b: an untouched log matches its checkpoint, exit 0", () => {
    const result = check(LOG(), [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(0);
    expect(result.reports.every((r) => r.broken === undefined)).toBe(true);
  });

  it("DSOR-AUD-04b: P1: the careful editor's rewrite from place 2 on is named at the checkpoint's place 3, exit 1", () => {
    const result = check(rewritten(), [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(1);
    expect(org456(result).broken).toStrictEqual({
      position: 3,
      record_id: "aud_3",
      why: "its fingerprint is not the one checkpoint 2026-10-20T09-00-00.000Z.json noted",
    });
  });

  it("DSOR-AUD-04b: the newest record removed and the head set back: the chain no longer reaches the checkpoint's place, exit 1", () => {
    const result = check(
      LOG().filter((r) => r.fields[1] !== "aud_3"),
      [fileOf(LOG(), AT_9)],
    );
    expect(result.exit).toBe(1);
    expect(org456(result).broken).toStrictEqual({
      position: 3,
      record_id: null,
      why: "checkpoint 2026-10-20T09-00-00.000Z.json noted place 3, and the chain ends at place 2",
    });
  });

  it("DSOR-AUD-04b: every record of a chain removed, head and all: the checkpoint still names the chain, exit 1", () => {
    const result = check(
      LOG().filter((r) => r.chain !== "no_company"),
      [fileOf(LOG(), AT_9)],
    );
    expect(result.reports.find((r) => r.chain === "no_company")).toMatchObject({
      records: 0,
      broken: { position: 1, record_id: null },
    });
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: every checkpoint is checked: a newer one, taken after the rewrite, does not hide it from an older one", () => {
    const older = fileOf(LOG(), AT_9);
    // The newer follows the older, so only the chains can show the rewrite, not the link.
    const newer = fileOf(rewritten(), AT_10, { previous: older.hash });
    // In the order the script reads them, by name, oldest first. Found by break B6.
    const result = check(rewritten(), [older, newer]);
    expect(result.files).toStrictEqual([{ name: older.name }, { name: newer.name }]);
    expect(org456(result).broken?.position).toBe(3);
  });

  // Found by the review, M5b: a checker that read only the oldest checkpoint passed every test.
  it("DSOR-AUD-04b: every checkpoint is checked: a record written after the older one is still held by the newer one", () => {
    const grown = [...STORY(), ["4", "aud_5", AT_10, "decision", "payment.create@1", "DENY"]];
    const older = fileOf(chainOf("org_456", STORY()), AT_9);
    const newer = fileOf(chainOf("org_456", grown), AT_10, { previous: older.hash });
    grown[3]![5] = "ALLOW";
    const result = check(chainOf("org_456", grown), [older, newer], AT_10);
    expect(org456(result).broken?.position).toBe(4);
  });

  it("DSOR-AUD-04b: a chain no checkpoint names yet is reported, not broken: org_789's first record came after it", () => {
    const rows = [...LOG(), ...chainOf("org_789", [["5", "aud_5", AT_10, "decision"]])];
    const result = check(rows, [fileOf(LOG(), AT_9)]);
    expect(result.exit).toBe(0);
    expect(result.notes).toContain("org_789: not yet in a checkpoint");
  });

  it("DSOR-AUD-04b: step 39's own break comes first: an edited record is named at its own place, not at the checkpoint's", () => {
    const rows = LOG();
    rows[1]!.fields[5] = "ALLOW";
    expect(org456(check(rows, [fileOf(LOG(), AT_9)])).broken).toMatchObject({ position: 2 });
  });
});

describe("C3: a checkpoint file the checker does not use", () => {
  it("DSOR-AUD-04b: P2: a checkpoint edited to hold the rewritten fingerprint fails its signature: named, not used, exit 1", () => {
    const file = fileOf(LOG(), AT_9);
    const forged = JSON.parse(file.text) as { checkpoint: { chains: { record_hash: string }[] } };
    forged.checkpoint.chains[1]!.record_hash = rewritten()[2]!.record_hash;
    const result = check(rewritten(), [{ name: file.name, text: JSON.stringify(forged) }]);
    expect(result.files).toStrictEqual([{ name: file.name, broken: NOT_SIGNED }]);
    expect(result.notes).toContain("not checked: there is no checkpoint whose signature holds");
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: a checkpoint signed by another key is named, exit 1", () => {
    const result = check(LOG(), [fileOf(LOG(), AT_9, { key: OTHER.privateKey })]);
    expect(result.files[0]!.broken).toBe(NOT_SIGNED);
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: a file that is not JSON, or has a field added, is not a checkpoint, exit 1", () => {
    const extra = JSON.parse(fileOf(LOG(), AT_9).text) as { checkpoint: Record<string, unknown> };
    extra.checkpoint["note"] = "trust me";
    const result = check(LOG(), [
      { name: "a.json", text: "not json" },
      { name: "b.json", text: JSON.stringify(extra) },
    ]);
    expect(result.files.map((f) => f.broken)).toStrictEqual([NOT_A_CHECKPOINT, NOT_A_CHECKPOINT]);
    expect(result.exit).toBe(1);
  });

  // Found by the review, M9 to M12: each form rule survived when removed. Each file below is signed
  //   with the right key, so only the form rule can refuse it.
  it.each([
    ["two entries for one chain", (c: Checkpoint) => void c.chains.push({ ...c.chains[0]! })],
    ["a place written 03", (c: Checkpoint) => void (c.chains[1]!.chain_position = "03")],
    [
      "a fingerprint of the wrong form",
      (c: Checkpoint) => void (c.chains[1]!.record_hash = "sha256:xyz"),
    ],
    ["a time that is no date", (c: Checkpoint) => void (c.taken_at = "2026-13-45T09:00:00.000Z")],
    [
      "a database id that is not a number",
      (c: Checkpoint) => void (c.database.system_identifier = "x1"),
    ],
    ["a previous of the wrong form", (c: Checkpoint) => void (c.previous = "yesterday")],
  ])("DSOR-AUD-04b: a signed checkpoint with %s is not a checkpoint, exit 1", (_, edit) => {
    const result = check(LOG(), [signedAfter(fileOf(LOG(), AT_9), edit)]);
    expect(result.files[0]!.broken).toBe(NOT_A_CHECKPOINT);
    expect(result.exit).toBe(1);
  });

  // Found by the review, L3: Node skips letters that are not base64, so junk passed.
  it("DSOR-AUD-04b: a signature with a letter added is not a checkpoint", () => {
    const file = fileOf(LOG(), AT_9);
    const odd = JSON.parse(file.text) as { signature: string };
    odd.signature = `${odd.signature.slice(0, 10)}!${odd.signature.slice(10)}`;
    const result = check(LOG(), [{ name: file.name, text: JSON.stringify(odd) }]);
    expect(result.files[0]!.broken).toBe(NOT_A_CHECKPOINT);
  });

  // Found by the review, M2: a checkpoint of another database, signed by the same key, was used.
  it("DSOR-AUD-04b: a checkpoint of another database, signed by the same key, is named, not used, exit 1", () => {
    const staging = { system_identifier: "7300000000000000002", name: "neondb" };
    const result = check(LOG(), [fileOf([], AT_9, { database: staging })]);
    expect(result.files[0]!.broken).toBe("it is a checkpoint of another database");
    expect(result.exit).toBe(1);
  });

  // Found by the review, H2: a checkpoint dated in the future never grew old.
  it("DSOR-AUD-04b: a checkpoint dated more than 5 minutes after the checker's clock is named, exit 1", () => {
    const result = check(LOG(), [fileOf(LOG(), "2099-01-01T00:00:00.000Z")]);
    expect(result.files[0]!.broken).toBe("its time is after the checker's clock");
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: a checkpoint dated 4 minutes after the checker's clock is used: clocks differ a little", () => {
    expect(check(LOG(), [fileOf(LOG(), "2026-10-20T10:04:00.000Z")]).exit).toBe(0);
  });
});

describe("D13: the checkpoints follow each other (the review, H1)", () => {
  const three = () => {
    const a = fileOf(LOG(), AT_9);
    const b = fileOf(LOG(), "2026-10-20T09:30:00.000Z", { previous: a.hash });
    const c = fileOf(LOG(), AT_10, { previous: b.hash });
    return [a, b, c];
  };

  it("DSOR-AUD-04b: three checkpoints, each following the one before, are whole", () => {
    expect(check(LOG(), three()).exit).toBe(0);
  });

  it("DSOR-AUD-04b: the middle checkpoint removed: the one after it is named, exit 1", () => {
    const [a, , c] = three();
    const result = check(LOG(), [a!, c!]);
    expect(result.files[1]).toStrictEqual({
      name: c!.name,
      broken: "it does not follow the checkpoint before it in the folder: one was removed",
    });
    expect(result.exit).toBe(1);
  });

  it("DSOR-AUD-04b: the oldest checkpoints removed, to keep the folder small, is allowed: exit 0", () => {
    const [, b, c] = three();
    expect(check(LOG(), [b!, c!]).exit).toBe(0);
  });
});

describe("C5: when the log is not vouched for", () => {
  it("DSOR-AUD-04b: P3: no checkpoint at all: not checked, exit 2", () => {
    const result = check(LOG(), []);
    expect(result.exit).toBe(2);
    expect(result.notes).toContain("not checked: there is no checkpoint");
  });

  it("DSOR-AUD-04b: P3: every checkpoint deleted, then the chain rewritten: not checked, exit 2, never whole", () => {
    expect(check(rewritten(), []).exit).toBe(2);
  });

  // Found by the review, M19.
  it("DSOR-AUD-04b: no public key: no checkpoint can be used, exit 2", () => {
    const log = { rows: LOG(), database: DB };
    const result = checkAgainstCheckpoints(log, [fileOf(LOG(), AT_9)], undefined, AT_10);
    expect(result.notes).toContain(
      "not checked: there is no public key, checkpoint-public-key.pem",
    );
    expect(result.exit).toBe(2);
  });

  it("DSOR-AUD-04b: a newest checkpoint older than 24 hours by the checker's clock: not checked, exit 2", () => {
    expect(MAX_AGE_HOURS).toBe(24);
    const result = check(LOG(), [fileOf(LOG(), AT_9)], "2026-10-21T09:00:00.001Z");
    expect(result.notes).toContain(
      "not checked: the newest checkpoint is older than 24 hours (2026-10-20T09:00:00.000Z)",
    );
    expect(result.exit).toBe(2);
  });

  it("DSOR-AUD-04b: exactly 24 hours old is still fresh, exit 0", () => {
    expect(check(LOG(), [fileOf(LOG(), AT_9)], "2026-10-21T09:00:00.000Z").exit).toBe(0);
  });

  it("DSOR-AUD-04b: a broken chain beats a stale checkpoint: exit 1, not 2", () => {
    const rows = LOG();
    rows[1]!.fields[5] = "ALLOW";
    expect(check(rows, [fileOf(LOG(), AT_9)], "2026-10-25T09:00:00.000Z").exit).toBe(1);
  });

  it("DSOR-AUD-04b: the public key used is the one given: KEYS checks KEYS' signatures", () => {
    const log = { rows: LOG(), database: DB };
    const file = fileOf(LOG(), AT_9);
    expect(checkAgainstCheckpoints(log, [file], KEYS.publicKey, AT_10).exit).toBe(0);
    expect(checkAgainstCheckpoints(log, [file], OTHER.publicKey, AT_10).exit).toBe(1);
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
      "not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key",
    );
  });
});
