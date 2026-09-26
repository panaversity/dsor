// NEW IN STEP 07: line ⑥ of the checklist, "is the input valid?". Each operation's input
// schema says exactly which fields its input may have (step 07's README, decision 2).
import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { Refusal } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import { preview, readContracts, type Contract } from "./registry.ts";

/** One input schema file, as it was read from disk: its name and its text. */
export type InputSource = { file: string; text: string };

/** The check for each operation's input, keyed by the operation's name. */
export type InputChecks = ReadonlyMap<string, ValidateFunction>;

/** Reads every input schema file in a folder, the way the contracts folder is read. */
export function readInputs(dir: string): InputSource[] {
  return readContracts(dir);
}

// The specification's shared definitions, such as resourceUri, that an input schema may
// point at by their URN.
const COMMON = new URL("../schemas/common.schema.json", import.meta.url);

/** Finds and compiles every contract's input schema, and names every problem. */
export function checkInputs(
  contracts: Iterable<Contract>,
  sources: InputSource[],
): { inputs: InputChecks; problems: string[] } {
  // A new ajv for each start-up, so the schemas of one registry never leak into another.
  // Its options never change an input while checking it: no default filled in, no text
  // turned into a number, and no field removed. A field the schema does not list must be
  // refused, not quietly deleted.
  const ajv = new Ajv2020({
    useDefaults: false,
    coerceTypes: false,
    removeAdditional: false,
    strict: false,
  });
  ajv.addSchema(JSON.parse(readFileSync(COMMON, "utf8")) as object);

  // Looked up among the files that were read, never by a path built from a contract's text.
  const texts = new Map(sources.map(({ file, text }) => [file, text]));
  const compiled = new Map<string, ValidateFunction | undefined>();
  const inputs = new Map<string, ValidateFunction>();
  const problems: string[] = [];
  for (const contract of contracts) {
    // The contract schema makes every contract name its input schema.
    const name = (contract["input"] as { schema: string }).schema;
    const file = `${name}.schema.json`;
    const text = texts.get(file);
    if (text === undefined) {
      problems.push(`${contract.id}: its input schema ${name} has no file inputs/${file}`);
      continue;
    }
    // Two contracts may share one input schema. It is compiled, and its problems named, once.
    if (!compiled.has(file)) compiled.set(file, compile(ajv, `inputs/${file}`, text, problems));
    const check = compiled.get(file);
    if (check !== undefined) inputs.set(contract.id, check);
  }
  return { inputs, problems };
}

// One input schema file, compiled, or undefined with its problems named.
function compile(
  ajv: Ajv2020,
  where: string,
  text: string,
  problems: string[],
): ValidateFunction | undefined {
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch {
    problems.push(`${where}: not valid JSON`);
    return undefined;
  }
  // Step 03's lesson: JSON.parse keeps the second of two values for one key, and says nothing.
  const twice = keysWrittenTwice(text);
  for (const key of twice)
    problems.push(`${where}: ${JSON.stringify(key)} is written twice in one object`);
  if (twice.length > 0) return undefined;
  try {
    return ajv.compile(schema as object);
  } catch (error) {
    problems.push(`${where}: not a valid JSON Schema: ${(error as Error).message}`);
    return undefined;
  }
}

/** Refuses the call unless its input passes the operation's input schema. */
export function checkInput(name: string, inputs: InputChecks, input: unknown): void {
  const check = inputs.get(name);
  // Start-up gives every contract its check. If one ever had none, nothing would pass:
  // when the answer is missing, the answer is no.
  if (check === undefined || !check(input)) {
    const problem = check?.errors?.[0];
    const why = problem === undefined ? "it has no input schema" : explain(problem);
    throw new Refusal("VALIDATION_FAILED", `the input of ${preview(name)} is not valid: ${why}`);
  }
}

// One problem, as ajv found it. A field the schema does not list is named by the caller, so
// it may be anything, even something huge. Only a short piece of it is shown.
function explain(error: ErrorObject): string {
  const where = error.instancePath === "" ? "" : `${error.instancePath} `;
  const field: unknown = error.params["additionalProperty"];
  return `${where}${error.message}${field === undefined ? "" : `: ${preview(field)}`}`;
}
