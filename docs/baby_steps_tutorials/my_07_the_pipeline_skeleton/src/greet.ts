// The smallest useful unit: a pure function. Same input, same output, no surprises.
// Almost every check DSoR makes will be built from functions like this one.

/** Greets a caller by name. */
export function greet(name: string): string {
  if (name.trim() === "") {
    throw new TypeError("a name is required");
  }
  return `Hello, ${name}.`;
}
