// Pnpm checkpoint-keys <file>. Makes the Ed25519 key pair checkpoints are signed
// with: the private key to <file>, outside the repository, readable by you only; the public key to
// checkpoint-public-key.pem here, to commit. Run it once (step 39b's README, claim C1, decisions D2
// and D8). --replace replaces a public key already there; the old checkpoints then fail.
import { existsSync } from "node:fs";
import { makeKeyPair, PUBLIC_KEY_FILE } from "./checkpoint-files.ts";

const words = process.argv.slice(2);
const replace = words.includes("--replace");
const [file] = words.filter((word) => word !== "--replace");
if (file === undefined) {
  console.log(
    "usage: pnpm checkpoint-keys <file for the private key, outside the repository> [--replace]",
  );
  process.exitCode = 2;
} else {
  try {
    const replaced = existsSync(PUBLIC_KEY_FILE);
    makeKeyPair(file, PUBLIC_KEY_FILE, { replace });
    console.log(
      `private key written: ${file}. Keep it secret; set DSOR_CHECKPOINT_KEY to it in .env`,
    );
    console.log("public key written: checkpoint-public-key.pem. Commit it");
    if (replaced) {
      console.log("the old public key was replaced: move the old checkpoints away (decision D9)");
    }
  } catch (error) {
    console.log(`no key made: ${(error as Error).message}`);
    process.exitCode = 2;
  }
}
