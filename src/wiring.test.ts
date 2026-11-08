/**
 * A zeroed buffer or factory default cannot wire a changing game fact. Only
 * per-field assignments count, including simulation and reset assignments.
 * Compiler symbols keep aliases of self, goal and facts tied to their types.
 */
import { describe, expect, it } from "vitest";
import ts from "@typescript/typescript6";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { WIRING_ALLOWLIST } from "./wiring-allowlist.js";

const srcRoot = dirname(fileURLToPath(import.meta.url));

function production(path: string): boolean {
  return path.endsWith(".ts") && !/\.(test|spec)\.ts$|\.d\.ts$/.test(path);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path)
      : production(path) ? [path] : [];
  });
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}

function access(node: ts.Node): { read: boolean; write: boolean } {
  let target = node;
  while (ts.isParenthesizedExpression(target.parent) || ts.isNonNullExpression(target.parent) || ts.isAsExpression(target.parent)) target = target.parent;
  const parent = target.parent;
  if (ts.isBinaryExpression(parent) && parent.left === target && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    return { read: parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken, write: true };
  }
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return { read: true, write: true };
  return { read: true, write: false };
}

function wiring(program: ts.Program): { reads: Map<string, string[]>; writes: Set<string> } {
  const checker = program.getTypeChecker();
  const reads = new Map<string, string[]>();
  const writes = new Set<string>();
  const fields = new Map<ts.Symbol, string>();
  const fieldDeclarations = new Map<ts.Declaration, string>();
  const traits = new Map<number, string>();
  const roots = new Set(program.getRootFileNames().filter(production).map((path) => path.replaceAll("\\", "/")));
  const files = program.getSourceFiles().filter((file) => !file.isDeclarationFile && roots.has(file.fileName.replaceAll("\\", "/")));
  if (files.length !== roots.size) throw new Error("The wiring scan did not load every production source file");
  const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };
  for (const file of files) walk(file, (node) => {
    if (ts.isInterfaceDeclaration(node) && /(^|\/)world\/model\.ts$/.test(file.fileName.replaceAll("\\", "/"))) {
      const prefix = ({ LevelFacts: "facts", BorgSelf: "self", Goals: "self.goal" } as Record<string, string>)[node.name.text];
      if (prefix) for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const type = checker.getTypeAtLocation(member);
        const parts = type.isUnion() ? type.types : [type];
        const primitive = ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike;
        if (!parts.some((part) => part.flags & primitive) || !parts.every((part) => part.flags & (primitive | ts.TypeFlags.Undefined))) continue;
        const symbol = checker.getSymbolAtLocation(member.name);
        if (symbol) {
          const name = `${prefix}.${member.name.getText()}`;
          fields.set(symbol, name);
          fieldDeclarations.set(member, name);
        }
      }
    }
    if (ts.isEnumDeclaration(node) && node.name.text === "BI") for (const member of node.members) {
      const value = checker.getConstantValue(member);
      if (typeof value === "number" && member.name.getText() !== "MAX") traits.set(value, `BI.${member.name.getText()}`);
    }
  });

  const symbolAt = (node: ts.Node): ts.Symbol | undefined => {
    const symbol = ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      ? checker.getTypeAtLocation(node.expression).getProperty(node.argumentExpression.text)
      : checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  };
  const isBI = (node: ts.Expression): boolean => {
    const symbol = symbolAt(ts.isPropertyAccessExpression(node) ? node.name : node);
    return symbol?.declarations?.some((decl) => ts.isEnumMember(decl) && ts.isEnumDeclaration(decl.parent) && decl.parent.name.text === "BI") ?? false;
  };
  const indices = (expression: ts.Expression, seen = new Set<ts.Symbol>()): number[] => {
    const node = unwrap(expression);
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isBI(node)) {
      const declaration = symbolAt(ts.isPropertyAccessExpression(node) ? node.name : node)?.declarations?.find(ts.isEnumMember);
      const value = declaration && checker.getConstantValue(declaration);
      return typeof value === "number" && traits.has(value) ? [value] : [];
    }
    if (ts.isConditionalExpression(node)) return [...indices(node.whenTrue, seen), ...indices(node.whenFalse, seen)];
    if (ts.isIdentifier(node)) {
      const symbol = symbolAt(node);
      if (symbol && !seen.has(symbol)) {
        const next = new Set(seen).add(symbol);
        return symbol.declarations?.flatMap((decl) => ts.isVariableDeclaration(decl) && decl.initializer ? indices(decl.initializer, next) : []) ?? [];
      }
    }
    /* The C enum stores each stat family in five consecutive slots. Expanding
     * the family avoids mistaking INT/DEX/etc. for unwritten traits. */
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const base = indices(node.left, seen);
      if (base.length && ts.isNumericLiteral(node.right)) {
        const offset = Number(node.right.text);
        return base.map((index) => index + offset);
      }
      if (base.length === 1 && ["BI.STR", "BI.ASTR", "BI.CSTR", "BI.STR_INDEX", "BI.ISFIXSTR"].includes(traits.get(base[0]!) ?? "")) {
        return Array.from({ length: 5 }, (_, i) => base[0]! + i);
      }
      if (base.length) throw new Error(`Unsupported computed BI index: ${node.getText()}`);
    }
    return [];
  };
  const record = (name: string, node: ts.Node, mode = access(node)): void => {
    if (mode.write) writes.add(name);
    if (mode.read) {
      const file = node.getSourceFile();
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const sites = reads.get(name) ?? [];
      sites.push(`${relative(srcRoot, file.fileName).replaceAll("\\", "/")}:${line}`);
      reads.set(name, sites);
    }
  };
  const fieldName = (base: ts.Expression, name: string): string | undefined => {
    const symbol = checker.getTypeAtLocation(base).getProperty(name);
    return symbol && (fields.get(symbol) ?? symbol.declarations?.map((decl) => fieldDeclarations.get(decl)).find((name) => name !== undefined));
  };
  for (const file of files) walk(file, (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const name = fieldName(node.expression, node.name.text);
      if (name) record(name, node);
    }
    if (ts.isElementAccessExpression(node)) {
      const key = unwrap(node.argumentExpression);
      const type = checker.getTypeAtLocation(key);
      const keys = ts.isStringLiteralLike(key) ? [key.text] : (type.isUnion() ? type.types : [type]).flatMap((part) => part.isStringLiteral() ? [part.value] : []);
      for (const key of keys) {
        const name = fieldName(node.expression, key);
        if (name) record(name, node);
      }
      for (const index of indices(key)) {
        const name = traits.get(index);
        if (name) record(name, node);
      }
    }
    /* Wrappers such as trait(), T(), tr() and on() receive the BI index as an
     * argument. Their dynamic array access has no additional named index. */
    if (ts.isCallExpression(node)) for (const arg of node.arguments) for (const index of indices(arg)) {
      const name = traits.get(index);
      if (name) record(name, arg, { read: true, write: false });
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) for (const binding of node.name.elements) {
      const key = binding.propertyName ?? binding.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
        const name = fieldName(node.initializer, key.text);
        if (name) record(name, binding, { read: true, write: false });
      }
    }
    /* Object overrides can assign live state, while the make* factories in
     * model.ts only establish defaults and must not hide missing producers. */
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const type = checker.getContextualType(node.parent);
      const key = ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText();
      const symbol = type?.getProperty(key);
      const name = symbol && fields.get(symbol);
      let factory = false;
      for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
        if (ts.isFunctionDeclaration(parent) && /^make(Goals|BorgSelf|LevelFacts)$/.test(parent.name?.text ?? "") && /(^|\/)world\/model\.ts$/.test(file.fileName.replaceAll("\\", "/"))) factory = true;
      }
      if (name && !factory) record(name, node, { read: false, write: true });
    }
  });
  return { reads, writes };
}

function gaps(result: ReturnType<typeof wiring>): string[] {
  return [...result.reads.keys()].filter((name) => !result.writes.has(name)).sort();
}

function fixture(source: string): ReturnType<typeof wiring> {
  const model = join(srcRoot, "world/model.ts").replaceAll("\\", "/");
  const code = join(srcRoot, "wiring-fixture.ts").replaceAll("\\", "/");
  const sources = new Map([
    [model, `
      export enum BI { STR, INT, WIS, DEX, CON, NEW, WRITTEN, SIMULATED, MAX }
      export interface LevelFacts { vault: boolean; depth: number }
      export interface BorgSelf { oldchp: number; active: boolean; trait: number[]; goal: Goals }
      export interface Goals { fleeing: boolean; type: number }
      export function makeLevelFacts(): LevelFacts { return { vault: false, depth: 0 }; }
      export function makeBorgSelf(): BorgSelf { return { oldchp: 0, active: false, trait: [], goal: makeGoals() }; }
      export function makeGoals(): Goals { return { fleeing: false, type: 0 }; }
    `],
    [code, `import { BI, type LevelFacts, type BorgSelf } from "./world/model.js";
      declare const world: { facts: LevelFacts; self: BorgSelf };
      declare const unrelated: { oldchp: number; vault: boolean };
      declare function trait(world: unknown, index: BI): number;
      declare function T(world: unknown, index: BI): number;
      ${source}`],
    [join(srcRoot, "wiring-fixture.test.ts").replaceAll("\\", "/"), `
      import { BI, makeBorgSelf, makeLevelFacts } from "./world/model.js";
      const self = makeBorgSelf();
      self.trait[BI.NEW] = 1; self.oldchp = 1; self.goal.fleeing = true;
      makeLevelFacts().vault = true;
      self.trait[BI.INT]; self.active;
    `],
  ]);
  const options: ts.CompilerOptions = { noLib: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  host.fileExists = (path) => sources.has(path.replaceAll("\\", "/"));
  host.readFile = (path) => sources.get(path.replaceAll("\\", "/"));
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
  };
  return wiring(ts.createProgram([...sources.keys()], options, host));
}

describe("Borg state wiring", () => {
  it("distinguishes reads, writes, aliases, simulations and defaults", () => {
    const result = fixture(`
      const self = world.self;
      const { goal } = self;
      const facts = world.facts;
      const t = self.trait;
      const index = BI.NEW;
      trait(world, BI.NEW); T(world, BI.NEW); t[index]; self.trait[BI["NEW"]];
      const { oldchp: previousHP } = self;
      const vaultKey = "vault";
      goal.fleeing; facts[vaultKey];
      unrelated.oldchp = 5; unrelated.vault = true;
      t[BI.WRITTEN] = 1;
      t[BI.WRITTEN] += 2;
      t[BI.WRITTEN]++;
      const writer = BI.WRITTEN; t[writer] = 3;
      for (let i = 0; i < 5; i++) t[BI.STR + i] = 10;
      t[BI.CON];
      t[BI.SIMULATED] = 1; const saved = t[BI.SIMULATED]; t[BI.SIMULATED] = saved;
      facts.depth = 1; goal.type++; self.active = true;
      // t[BI.NEW] = 1; self.oldchp = 5;
      const text = "facts.vault = true";
    `);
    expect(gaps(result)).toEqual(["BI.NEW", "facts.vault", "self.goal.fleeing", "self.oldchp"]);
    expect(result.reads.get("BI.NEW")).toHaveLength(4);
    expect(result.reads.has("BI.WRITTEN")).toBe(true);
    expect(result.reads.has("self.active")).toBe(false);
    expect(result.reads.has("BI.INT")).toBe(false);
    expect(result.writes.has("BI.CON")).toBe(true);
    expect(result.writes.has("BI.SIMULATED")).toBe(true);
    expect(result.writes.has("facts.vault")).toBe(false);
    expect(gaps(fixture("world.self.oldchp; world.self.oldchp = 10;"))).toEqual([]);
  });

  it("allows exactly the documented unwritten reads", () => {
    const config = ts.readConfigFile(join(srcRoot, "../tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(srcRoot));
    const result = wiring(ts.createProgram(sourceFiles(srcRoot), parsed.options));
    expect(result.reads.size).toBeGreaterThan(200);
    expect(result.writes.size).toBeGreaterThan(200);
    const allowed = WIRING_ALLOWLIST.map((entry) => entry.name).sort();
    const actual = gaps(result);
    const newReads = actual.filter((name) => !allowed.includes(name)).map((name) => `${name}: ${result.reads.get(name)!.join(", ")}`);
    expect(newReads, "New reads without a production writer").toEqual([]);
    expect(allowed, "Remove entries that gained a writer or lost their readers").toEqual(actual);
    expect(new Set(allowed).size).toBe(allowed.length);
    for (const entry of WIRING_ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.c).toMatch(/\.c:\d+/);
    }
  }, 30_000);
});
