#!/usr/bin/env node
// Guards the specification. Zero dependencies, so it runs before `pnpm install`.
//
//   node scripts/guard-spec.mjs                    check everything
//   node scripts/guard-spec.mjs --write            regenerate packages/spec/requirements.json
//   node scripts/guard-spec.mjs --coverage         count requirement ids named by a test
//   node scripts/guard-spec.mjs --coverage --list  ...and list the ids no test names yet
//
// Checks, each reported with a stable slug (AGENTS.md → Decisions 2 and 3):
//   unique-id         every requirement id is defined once
//   one-must          every requirement holds exactly one MUST / MUST NOT, and no SHOULD / MAY
//   known-id          every DSOR-XXX-NN mentioned in any markdown file, or in a baby step's
//                     code or tests, is defined by the spec
//   link-target       every relative markdown link, and its #anchor, resolves
//   registry-current  packages/spec/requirements.json equals what the spec says today
//   copied-pattern    a baby-step regex marked "// copied from <schema>#<pointer>" still
//                     equals that schema's pattern, with no flags but u or v. It relies on
//                     the marker: deleting the comment turns the check off for that regex,
//                     so review such a diff. A misspelled marker fails
//   rules-met         every row of rules-met.md links a test file with a test titled by
//                     that row's rule id
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_DIR = join(ROOT, "specs", "dsor");
const REGISTRY = join(ROOT, "packages", "spec", "requirements.json");
const REQUIREMENT = /^- \*\*\[(DSOR-[A-Z]+-\d+[a-z]?) · (L1|L2|L3|RP|STACK)\]\*\* (.*)$/;
const ID = /DSOR-[A-Z]+-\d+[a-z]?/g;
const SKIP = new Set(["node_modules", "dist", ".git"]);

const walk = (dir, keep) =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p, keep);
    return keep(p) ? [p] : [];
  });

const stripLinks = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
const stripCode = (s) => s.replace(/`[^`]*`/g, "");

// GitHub's heading-to-anchor rule, close enough for the headings this repo uses.
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");

/** Lines of a markdown file with fenced code blocks blanked out. */
const prose = (text) => {
  let fence = false;
  return text.split("\n").map((line) => {
    if (line.startsWith("```")) {
      fence = !fence;
      return "";
    }
    return fence ? "" : line;
  });
};

function readRequirements() {
  const found = [];
  const files = readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    let section = null;
    for (const line of prose(readFileSync(join(SPEC_DIR, file), "utf8"))) {
      const heading = line.match(/^## (\d+(?:\.\d+)?)[. ]/);
      if (heading) section = heading[1];
      const m = line.match(REQUIREMENT);
      if (m) {
        found.push({
          id: m[1],
          level: m[2],
          section,
          text: stripLinks(m[3]),
          file: `specs/dsor/${file}`,
        });
      }
    }
  }
  return found;
}

const failures = new Set();
const fail = (check, detail) => failures.add(`error: ${check} — ${detail}`);

const requirements = readRequirements();
const ids = new Set();
for (const r of requirements) {
  if (ids.has(r.id)) fail("unique-id", `${r.id} is defined twice`);
  ids.add(r.id);
  const bare = stripCode(r.text);
  const musts = (bare.match(/\bMUST\b/g) ?? []).length;
  if (musts !== 1) fail("one-must", `${r.id} has ${musts} MUSTs; one requirement, one MUST`);
  if (/\b(SHOULD|MAY)\b/.test(bare)) fail("one-must", `${r.id} mixes SHOULD or MAY into a MUST`);
}

const markdown = walk(ROOT, (p) => p.endsWith(".md"));
const anchors = new Map();
for (const file of markdown) {
  const set = new Set();
  for (const line of prose(readFileSync(file, "utf8"))) {
    const heading = line.match(/^#{1,6} (.*)$/);
    if (heading) set.add(slug(heading[1]));
  }
  anchors.set(normalize(file), set);
}
for (const file of markdown) {
  const where = relative(ROOT, file);
  for (const line of prose(readFileSync(file, "utf8"))) {
    const bare = stripCode(line);
    for (const id of bare.match(ID) ?? []) {
      if (!ids.has(id)) fail("known-id", `${where} mentions ${id}, which the spec does not define`);
    }
    for (const m of bare.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^[a-z]+:/i.test(href)) continue;
      const [path, anchor] = href.split("#");
      const target = normalize(path ? join(dirname(file), path) : file);
      if (!existsSync(target)) {
        fail("link-target", `${where} links to a missing file: ${href}`);
      } else if (anchor && target.endsWith(".md") && !anchors.get(target)?.has(anchor)) {
        fail("link-target", `${where} links to a missing anchor: ${href}`);
      }
    }
  }
}

// The baby steps are separate projects that must run outside this repository, so their
// tests cannot read the spec. The guard reads them instead, and fails when they drift.
const STEPS = join(ROOT, "docs", "baby_steps_tutorials");
const COPIED = /\/\/ copied from (packages\/spec\/schemas\/[\w.-]+\.json)#(\S+)/;
const stepCode = existsSync(STEPS) ? walk(STEPS, (p) => p.endsWith(".ts")) : [];

/** The value at a JSON pointer in a schema file, or undefined when there is none. */
const resolvePointer = (file, pointer) => {
  const path = join(ROOT, file);
  if (!existsSync(path)) return undefined;
  let node = JSON.parse(readFileSync(path, "utf8"));
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
};

for (const file of stepCode) {
  const where = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  for (const id of lines.join("\n").match(ID) ?? []) {
    if (!ids.has(id)) fail("known-id", `${where} mentions ${id}, which the spec does not define`);
  }
  lines.forEach((line, i) => {
    // Any "copied from" comment counts, so a misspelled marker fails instead of
    // quietly switching the check off.
    if (!/copied from/i.test(line)) return;
    const at = `${where}:${i + 1}`;
    const marker = line.match(COPIED);
    if (!marker) {
      fail(
        "copied-pattern",
        `${at}: write the marker as // copied from packages/spec/schemas/<file>.json#<pointer>`,
      );
      return;
    }
    const expected = resolvePointer(marker[1], marker[2]);
    if (typeof expected !== "string") {
      fail("copied-pattern", `${at}: ${marker[1]}#${marker[2]} is not a pattern in that schema`);
      return;
    }
    const code = lines.slice(i + 1).find((l) => !l.trim().startsWith("//")) ?? "";
    const literal = code.match(/=\s*\/(.+)\/([a-z]*);/);
    if (!literal) {
      fail("copied-pattern", `${at}: the next code line must be  const NAME = /pattern/;`);
      return;
    }
    // A flag changes what the pattern accepts: m lets "31400.00\n1" through, i lets "usd".
    if (/[^uv]/.test(literal[2])) {
      fail(
        "copied-pattern",
        `${at}: a copied pattern takes no flags but u or v, found "${literal[2]}"`,
      );
      return;
    }
    // Compare as regexes, not as text: a literal must write "/" as "\/", the schema not.
    let same = false;
    try {
      same = new RegExp(literal[1]).source === new RegExp(expected).source;
    } catch {}
    if (!same) fail("copied-pattern", `${at} no longer matches ${marker[1]}#${marker[2]}`);
  });
}

// rules-met.md may only claim what a step's tests name. CI runs each step's own tests.
const RULES_MET = join(STEPS, "rules-met.md");
if (existsSync(RULES_MET)) {
  for (const row of prose(readFileSync(RULES_MET, "utf8"))) {
    if (!row.startsWith("|") || !/DSOR-[A-Z]+-\d/.test(row)) continue;
    const id = row.match(/^\|\s*(DSOR-[A-Z]+-\d+[a-z]?)\s*\|/)?.[1];
    if (!id) {
      fail("rules-met", `a row does not start with a rule id: ${row.trim()}`);
      continue;
    }
    const tests = [...row.matchAll(/\]\(([^)\s#]+\.test\.ts)(?:#[^)\s]*)?\)/g)].map((m) => m[1]);
    if (tests.length === 0) fail("rules-met", `the ${id} row links to no test file`);
    // A title, not a mention: it("ID: …"), test("ID: …"), or it.each(…)("ID: …").
    // it.skip does not count, and DSOR-MON-01 does not match inside DSOR-MON-01a.
    const title = new RegExp(`\\b(?:it|test)(?:\\.each\\([\\s\\S]*?\\))?\\(\\s*["'\`]${id}:`);
    for (const href of tests) {
      const test = join(STEPS, href);
      if (existsSync(test) && !title.test(readFileSync(test, "utf8"))) {
        fail(
          "rules-met",
          `rules-met.md says ${href} proves ${id}, but no test there is titled "${id}: …"`,
        );
      }
    }
  }
}

const rendered =
  JSON.stringify(
    {
      specification: "DSoR",
      version: "1.4.0",
      note: "Generated by `pnpm guard --write` from specs/dsor/*.md. Do not edit by hand.",
      requirements,
    },
    null,
    2,
  ) + "\n";

if (process.argv.includes("--write")) {
  writeFileSync(REGISTRY, rendered);
  console.log(`wrote ${requirements.length} requirements to ${relative(ROOT, REGISTRY)}`);
} else if (!existsSync(REGISTRY) || readFileSync(REGISTRY, "utf8") !== rendered) {
  fail("registry-current", "packages/spec/requirements.json is stale; run: pnpm guard --write");
}

if (process.argv.includes("--coverage")) {
  const tests = walk(join(ROOT, "packages"), (p) => p.endsWith(".test.ts"));
  const named = new Set(tests.flatMap((t) => readFileSync(t, "utf8").match(ID) ?? []));
  for (const level of ["L1", "L2", "L3", "RP", "STACK"]) {
    const all = requirements.filter((r) => r.level === level);
    const open = all.filter((r) => !named.has(r.id));
    const done = String(all.length - open.length).padStart(3);
    console.log(`${level.padEnd(5)} ${done} / ${String(all.length).padStart(3)} named by a test`);
    if (process.argv.includes("--list")) {
      for (const r of open) console.log(`        ${r.id.padEnd(14)} §${r.section}`);
    }
  }
}

if (failures.size > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
if (!process.argv.includes("--coverage")) {
  console.log(
    `spec guard: ${requirements.length} requirements, ${markdown.length} markdown files, all checks pass`,
  );
}
