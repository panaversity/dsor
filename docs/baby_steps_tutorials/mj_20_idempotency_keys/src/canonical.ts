// NEW IN STEP 20: a request's fingerprint, its payload hash. Line ⑥ of §21 computes it, and the
// claim of an idempotency key stores it (DSOR-IDM-01b in specs/dsor/03-execution.md, section
// 22). A payload hash is SHA-256 over the RFC 8785 canonical JSON of the input (DSOR-APR-02b,
// section 26). Step 29 builds canonicalization in full; this step builds the part it needs,
// early (step 20's README, decision 5).
import { createHash } from "node:crypto";

// A piece of the text: one already written, or a value still to write.
type Piece = { text: string } | { value: unknown };

/**
 * The input as one canonical JSON text: each object's keys in order, a list's items in their
 * own order, and no spaces. The input is plain data, a copy that JSON made at line ①.
 */
export function canonicalJson(value: unknown): string {
  const written: string[] = [];
  // The pieces still to write, the next one last. A list, not a function that calls itself, so
  // any depth that JSON can carry is written, as checkAnswerInTenant walks in company.ts.
  const todo: Piece[] = [{ value }];
  while (todo.length > 0) {
    const piece = todo.pop()!;
    if ("text" in piece) {
      written.push(piece.text);
      continue;
    }
    const next: Piece[] = [];
    const inner = piece.value;
    if (Array.isArray(inner)) {
      // A list keeps its order: [1, 2] and [2, 1] are two requests.
      next.push({ text: "[" });
      inner.forEach((item, at) => {
        if (at > 0) next.push({ text: "," });
        next.push({ value: item });
      });
      next.push({ text: "]" });
    } else if (typeof inner === "object" && inner !== null) {
      // RFC 8785 sorts the keys by their UTF-16 code units, and sort() compares text that way.
      const keys = Object.keys(inner).sort();
      next.push({ text: "{" });
      keys.forEach((key, at) => {
        next.push({ text: `${at > 0 ? "," : ""}${JSON.stringify(key)}:` });
        next.push({ value: (inner as Record<string, unknown>)[key] });
      });
      next.push({ text: "}" });
    } else {
      // Text, a number, true, false, or null, as JSON writes it. RFC 8785 writes a number as
      // JavaScript does, so 1.50 and 1.5 are one value.
      next.push({ text: JSON.stringify(inner) });
    }
    // Pushed from the end, so the first piece is taken first. One at a time: a spread of a
    // long list would pass too many arguments to push.
    for (let at = next.length - 1; at >= 0; at -= 1) todo.push(next[at]!);
  }
  return written.join("");
}

/** The fingerprint of an input: `sha256:` and 64 hex digits. */
export function payloadHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
