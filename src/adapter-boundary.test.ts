/**
 * Only src/core-api.ts reads the host. Every other file reaches the plugin
 * context, the registries, the live state and the engine's record methods
 * through it, so moving to API 2 rewrites one file. This scan fails on a direct
 * read anywhere else. Comments are stripped first, because plenty of them still
 * name what a file used to read.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(srcRoot);

/** The adapter itself, and the vitest setup file that stands in for the host. */
const ALLOWED = new Set(["src/core-api.ts", "src/test-bind-core.ts"]);

/** Fakes for tests are built from the host's own view and action types. */
const MAY_NAME_HOST_TYPES = new Set(["src/harness.ts"]);

/** Reads only the adapter may make. */
const HOST_READS: readonly [string, RegExp][] = [
  [
    "a plugin-context read",
    /\bctx\s*\??\.\s*(?:core|state|registries|snapshot|intent|events|characterStore|prefs|ui|keymaps|inspect|flags|log|controllerArmed)\b/u,
  ],
  ["a registry read", /\.registries\b/u],
  ["an engine record method", /\.\s*(?:randomValue|lookupKind|findEgo|findArtifact)\s*\(/u],
  ["a live level read", /\.chunk\s*\.\s*feature\s*\(/u],
  ["binding the engine", /\bbindCore\s*\(/u],
];

/** The host's view and action types, which only the adapter wraps. */
const HOST_TYPES = /\b(?:AgentView|AgentActions)\b/u;

/** Every non-test .ts under src/, plus the entry files at the repository root. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(srcRoot);
  for (const name of readdirSync(repoRoot)) {
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(join(repoRoot, name));
  }
  return out;
}

/** Source text with comments and one-line quoted strings removed. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\n]*/gu, "")
    .replace(/"[^"\n]*"|'[^'\n]*'/gu, '""');
}

/** What a file reads that only the adapter may read. */
function violations(text: string, mayNameHostTypes = false): string[] {
  const body = code(text);
  const found = HOST_READS.filter(([, re]) => re.test(body)).map(([what]) => what);
  if (!mayNameHostTypes && HOST_TYPES.test(body)) found.push("a host view or action type");
  return found;
}

describe("only the adapter reads the host", () => {
  const files = sourceFiles().map((p) => ({ p, rel: relative(repoRoot, p).replaceAll("\\", "/") }));

  it("scans the port and the entry files", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["plugin.ts", "src/core-api.ts"]));
  });

  it("finds no host read outside the adapter", () => {
    const offenders = files
      .filter((f) => !ALLOWED.has(f.rel))
      .map((f) => ({ file: f.rel, reads: violations(readFileSync(f.p, "utf8"), MAY_NAME_HOST_TYPES.has(f.rel)) }))
      .filter((o) => o.reads.length > 0);
    expect(offenders).toEqual([]);
  });

  it("catches each kind of read, and ignores comments and strings", () => {
    expect(violations("const core = ctx.core;")).toEqual(["a plugin-context read"]);
    expect(violations("const n = ctx.state?.actor;")).toEqual(["a plugin-context read"]);
    expect(violations("const r = host.registries.monsters;")).toEqual(["a registry read"]);
    expect(violations("const rv = b.dice.randomValue();")).toEqual(["an engine record method"]);
    expect(violations("objects.lookupKind(1, 2);")).toEqual(["an engine record method"]);
    expect(violations("state.chunk.feature(grid);")).toEqual(["a live level read"]);
    expect(violations("bindCore(core);")).toEqual(["binding the engine"]);
    expect(violations("function f(view: AgentView) {}")).toEqual(["a host view or action type"]);
    expect(violations("function f(view: AgentView) {}", true)).toEqual([]);
    expect(violations("// reads ctx.core\n/* ctx.registries */\nconst m = \"from ctx.core\";")).toEqual([]);
    expect(violations("const x = ctx.world.kills;")).toEqual([]);
  });
});
