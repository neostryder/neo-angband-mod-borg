/** Syntax trees keep assertions, whitespace and quoted URLs from hiding host reads. */

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(srcRoot);

/** The adapter itself, and the vitest setup file that stands in for the host. */
const ALLOWED = new Set(["src/core-api.ts", "src/test-bind-core.ts"]);

/** Fakes for tests are built from the host's own view and action types. */
const MAY_NAME_HOST_TYPES = new Set(["src/harness.ts"]);

const HOST_MEMBERS = new Set([
  "core", "state", "registries", "snapshot", "intent", "events", "characterStore",
  "prefs", "ui", "keymaps", "inspect", "flags", "log", "controllerArmed",
  "id", "api", "engine", "settings", "authoring", "assetUrl", "data", "display",
  "subwindows", "driver", "controller", "mods", "knownLevel", "prompt", "tiles",
  "keyRepeat", "options", "keybindings", "knowledge", "saves", "session", "shared",
  "title", "profiles", "character", "newCharacter", "net", "backupFolder", "installMod",
  "reloadGame", "loadModForSession", "readMod", "debug", "wizard", "composedRecords",
]);
const TITLE_MEMBERS = new Set(["id", "title", "profiles", "saves"]);
const HOST_TYPES = new Set(["AgentView", "AgentActions"]);
const ENGINE = "@rpgm-tools/neo-angband-core";

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

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    node = node.expression;
  }
  return node;
}

function member(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

function violations(text: string, mayNameHostTypes = false, api2 = false, title = false): string[] {
  const source = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (/engine$/iu.test(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) found.add("an engine namespace read");
      if (api2 && node.text === "ctx") found.add("an API 1 context identifier");
      if (!mayNameHostTypes && HOST_TYPES.has(node.text)) found.add("a host view or action type");
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = unwrap(node.expression);
      const name = member(node);
      if (ts.isIdentifier(base) && base.text === "ctx" && name && HOST_MEMBERS.has(name) && !(title && TITLE_MEMBERS.has(name))) found.add("a plugin-context read");
      if (name === "registries") found.add("a registry read");
      if (ts.isIdentifier(base) && /engine$/iu.test(base.text)) found.add("an engine namespace read");
    }
    if (ts.isCallExpression(node)) {
      const call = unwrap(node.expression);
      const name = member(call);
      if (name && ["randomValue", "lookupKind", "findEgo", "findArtifact"].includes(name)) found.add("an engine record method");
      if ((ts.isPropertyAccessExpression(call) || ts.isElementAccessExpression(call)) && name === "feature" && member(unwrap(call.expression)) === "chunk") found.add("a live level read");
      if (ts.isIdentifier(call) && call.text === "bindCore") found.add("binding the engine");
      if (call.kind === ts.SyntaxKind.ImportKeyword && node.arguments.some((arg) => ts.isStringLiteralLike(arg) && arg.text === ENGINE)) found.add("a runtime engine import");
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text === ENGINE) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      const erased = clause?.isTypeOnly || (!clause?.name && names && ts.isNamedImports(names) && names.elements.every((name) => name.isTypeOnly));
      if (!erased) found.add("a runtime engine import");
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text === ENGINE) {
      const names = node.exportClause;
      const erased = node.isTypeOnly || (names && ts.isNamedExports(names) && names.elements.every((name) => name.isTypeOnly));
      if (!erased) found.add("a runtime engine import");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
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
      .map((f) => ({ file: f.rel, reads: violations(readFileSync(f.p, "utf8"), MAY_NAME_HOST_TYPES.has(f.rel), f.rel === "src/core-adapter-api2.ts", f.rel === "title.ts") }))
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
    expect(violations("ctx.title")).toContain("a plugin-context read");
    expect(violations("ctx.title; ctx.id; ctx.saves; ctx.profiles", false, false, true)).toEqual([]);
    expect(violations("ctx.core", false, false, true)).toContain("a plugin-context read");
  });

  it.each([
    "ctx!.core.FEAT", "(ctx as any).state", "ctx . core", "ctx[\"core\"]",
    "(ctx satisfies Host).core", "const url = \"https://example.com\"; ctx.core;",
    `export { FEAT } from "${ENGINE}";`, `export * from "${ENGINE}";`,
    `import("${ENGINE}");`, `import "${ENGINE}";`,
    "gameEngine.FEAT", "engine.FEAT", "otherengine.FEAT", "(gameEngine as any) . FEAT", "const { FEAT } = gameEngine;",
  ])("rejects the restored violation: %s", (text) => {
    expect(violations(text).length).toBeGreaterThan(0);
  });

  it.each(["ctx", "ctx.id", "ctx!.title", "(ctx as any).world", "const { id } = ctx;"])("rejects an API 1 context in the API 2 twin: %s", (text) => {
    expect(violations(text, false, true)).toContain("an API 1 context identifier");
  });

  it("allows erased imports and the Borg's delegated engine group", () => {
    expect(violations(`import type { ItemView } from "${ENGINE}"; export { type ItemView } from "${ENGINE}"; host.engine.noscore();`)).toEqual([]);
    expect(violations('const url = "https://example.com/ctx.core"; // ctx.core')).toEqual([]);
  });
});
