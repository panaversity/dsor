// What JSON.parse does not tell you: a key written twice in one object. JSON.parse keeps
// the last value and drops the others without a word, so a file could say one thing to
// the person who reads it and another to the program. Found by step 06's review, and
// fixed from step 03 on.

/** Every key that one object in this JSON text writes twice. JSON.parse has read it first. */
export function keysWrittenTwice(text: string): string[] {
  const twice: string[] = [];
  // One entry for each object or list the scan is inside: the keys that object has
  // written so far, or null for a list.
  const open: (Set<string> | null)[] = [];
  // True where the next text in quotes is a key: after "{", and after "," in an object.
  let atKey = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // The text runs to the next quote. A backslash hides the character after it.
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const keys = open.at(-1);
      if (atKey && keys) {
        // JSON.parse reads the key too, so "risk" and "risk" are the same key.
        const key = JSON.parse(text.slice(i, end + 1)) as string;
        if (keys.has(key)) twice.push(key);
        keys.add(key);
        atKey = false;
      }
      i = end;
    } else if (ch === "{") {
      open.push(new Set());
      atKey = true;
    } else if (ch === "[") {
      open.push(null);
      atKey = false;
    } else if (ch === "}" || ch === "]") {
      open.pop();
      atKey = false;
    } else if (ch === ",") {
      atKey = open.at(-1) instanceof Set;
    }
  }
  return twice;
}
