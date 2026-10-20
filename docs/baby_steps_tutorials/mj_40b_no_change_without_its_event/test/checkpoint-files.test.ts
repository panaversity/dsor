// Step 39b: the files on the disk. The key pair, with the private key outside the repository; a
// checkpoint file never overwritten; every checkpoint file read, and anything in the folder that is
// not a small regular file named, never trusted and never a reason to stop checking (DSOR-AUD-04b;
// step 39b's README, claims C1 and C3, decisions D8 and D11).
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { takeCheckpoint, writeCheckpoint } from "../src/checkpoint.ts";
import { checkAgainstCheckpoints } from "../src/checkpoint-check.ts";
import {
  makeKeyPair,
  MAX_FILE_BYTES,
  readCheckpointFiles,
  readPrivateKey,
  readPublicKey,
} from "../src/checkpoint-files.ts";
import { AT_10, AT_9, check, DB, fileOf, KEYS, LOG } from "./checkpoints.ts";

const dir = mkdtempSync(join(tmpdir(), "dsor-39b-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("C1: the key pair", () => {
  const privateFile = join(dir, "private.pem");
  const publicFile = join(dir, "public.pem");

  it("DSOR-AUD-04b: the private key is readable by its owner only, and the pair signs a checkpoint the checker accepts", () => {
    makeKeyPair(privateFile, publicFile);
    expect(statSync(privateFile).mode & 0o777).toBe(0o600);
    const taken = takeCheckpoint({ rows: LOG(), database: DB }, AT_9, null);
    if (!("checkpoint" in taken)) throw new Error("the test's log is broken");
    const out = join(dir, "signed");
    const name = writeCheckpoint(out, taken.checkpoint, readPrivateKey(privateFile));
    const files = readCheckpointFiles(out);
    const log = { rows: LOG(), database: DB };
    const result = checkAgainstCheckpoints(log, files, readPublicKey(publicFile), AT_10);
    expect(result.files).toStrictEqual([{ name }]);
    expect(result.exit).toBe(0);
  });

  it("DSOR-AUD-04b: a private key file already there is never overwritten", () => {
    expect(() => makeKeyPair(privateFile, join(dir, "public2.pem"))).toThrow();
  });

  // Found by the review, L4: a second run replaced the public key, and every older checkpoint
  //   turned broken.
  it("DSOR-AUD-04b: a public key already there is kept, unless replacing it is asked for", () => {
    const before = readFileSync(publicFile, "utf8");
    expect(() => makeKeyPair(join(dir, "private2.pem"), publicFile)).toThrow(/--replace/);
    expect(readFileSync(publicFile, "utf8")).toBe(before);
    makeKeyPair(join(dir, "private3.pem"), publicFile, { replace: true });
    expect(readFileSync(publicFile, "utf8")).not.toBe(before);
  });

  // Found by the review, M3: "..secret.pem" counted as outside, and the README's own example wrote
  //   the key inside the repository. The repository here is a folder of the test's own, so the
  //   test runs the same in a copy of this step outside git.
  const root = join(dir, "repo");
  it.each(["private.pem", "..secret.pem", "step/../keys/private.pem", "a/b/c.pem"])(
    "DSOR-AUD-04b: a private key is never written inside the repository, where git could pick it up: %s",
    (path) => {
      expect(() => makeKeyPair(join(root, path), join(dir, "unused.pem"), { root })).toThrow(
        /outside the repository/,
      );
    },
  );

  it("DSOR-AUD-04b: a private key is never written inside this folder, wherever the repository is", () => {
    const inside = fileURLToPath(new URL("../private.pem", import.meta.url));
    expect(() => makeKeyPair(inside, join(dir, "unused.pem"))).toThrow(/outside the repository/);
  });

  it("DSOR-AUD-04b: a private key beside the repository, not in it, is allowed", () => {
    makeKeyPair(join(dir, "repo-keys.pem"), join(dir, "public4.pem"), { root });
    expect(statSync(join(dir, "repo-keys.pem")).isFile()).toBe(true);
  });
});

describe("D11: the checkpoint files", () => {
  // Found by the review, M7.
  it("DSOR-AUD-04b: a checkpoint file is never overwritten, not by one of the same moment", () => {
    const out = join(dir, "twice");
    const { checkpoint } = fileOf(LOG(), AT_9);
    writeCheckpoint(out, checkpoint, KEYS.privateKey);
    expect(() => writeCheckpoint(out, checkpoint, KEYS.privateKey)).toThrow();
  });

  // Found by the review, M20: a reader that returned only the last file passed.
  it("DSOR-AUD-04b: every checkpoint file is read, oldest first, and nothing else", () => {
    const out = join(dir, "many");
    mkdirSync(out);
    for (const at of [AT_10, AT_9]) {
      const { checkpoint } = fileOf(LOG(), at);
      writeCheckpoint(out, checkpoint, KEYS.privateKey);
    }
    writeFileSync(join(out, "notes.txt"), "not a checkpoint");
    expect(readCheckpointFiles(out).map((f) => f.name)).toStrictEqual([
      "2026-10-20T09-00-00.000Z.json",
      "2026-10-20T10-00-00.000Z.json",
    ]);
  });

  it("DSOR-AUD-04b: a folder that is not there holds no checkpoint", () => {
    expect(readCheckpointFiles(join(dir, "none"))).toStrictEqual([]);
  });

  // Found by the review, M1: one planted entry made the script stop with exit 2, or hang.
  it("DSOR-AUD-04b: a folder, a link, and a file over the size limit, each named .json, are named broken: exit 1, and the real checkpoint still used", () => {
    const out = join(dir, "planted");
    const { checkpoint } = fileOf(LOG(), AT_9);
    const name = writeCheckpoint(out, checkpoint, KEYS.privateKey);
    mkdirSync(join(out, "a-folder.json"));
    symlinkSync(join(out, name), join(out, "b-link.json"));
    writeFileSync(join(out, "c-big.json"), "x".repeat(MAX_FILE_BYTES + 1));
    const result = check(LOG(), readCheckpointFiles(out));
    const odd = "it is not a file of at most 1 MB";
    expect(result.files).toStrictEqual([
      { name },
      { name: "a-folder.json", broken: odd },
      { name: "b-link.json", broken: odd },
      { name: "c-big.json", broken: odd },
    ]);
    expect(result.exit).toBe(1);
  });
});
