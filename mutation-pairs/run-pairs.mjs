import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suite = join(root, "mutation-pairs");
const baseline = "7eb4b78";
const scratchRoot = join(root, ".scratch");
mkdirSync(scratchRoot, { recursive: true });
const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const env = { ...process.env, BORG_MUTATION_PAIRS: "1", GIT_CEILING_DIRECTORIES: root };
const scratch = mkdtempSync(join(scratchRoot, "mutation-pairs-"));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: "utf8", windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function git(args, cwd = root) {
  const result = run("git", args, cwd);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function check(file, cwd, report) {
  const result = run(process.execPath, [
    vitest, "run", "--maxWorkers=1", "--reporter=json",
    "--outputFile=" + report, file,
  ], cwd);
  if (!existsSync(report)) throw new Error("Vitest wrote no report: " + result.stderr + result.stdout);
  const data = JSON.parse(readFileSync(report, "utf8"));
  const tests = data.testResults.flatMap((entry) => entry.assertionResults);
  const assertion = tests[0];
  const pass = result.status === 0 && data.numPassedTests === 1 && tests.length === 1;
  const fail = result.status === 1 && data.numFailedTests === 1 && tests.length === 1 &&
    assertion.status === "failed" && assertion.failureMessages.some((message) => message.includes("AssertionError"));
  if (!pass && !fail) throw new Error("The check did not produce one assertion verdict: " + file + "\n" + result.stdout + result.stderr);
  return { status: pass ? "pass" : "fail", exitCode: result.status };
}

function removeScratch(directory) {
  const target = realpathSync(directory);
  const rel = relative(realpathSync(scratchRoot), target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("The scratch cleanup target is outside .scratch.");
  rmSync(target, { recursive: true, force: true });
}

function copyTree(destination) {
  mkdirSync(destination);
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const file of files) {
    if (file.startsWith(".scratch/") || file.startsWith("node_modules/")) continue;
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  symlinkSync(join(root, "node_modules"), join(destination, "node_modules"), "junction");
}

const rows = [];
let error = null;
try {
  git(["diff", "--exit-code", baseline, "--", "src"]);
  const pairs = git(["ls-files", "--cached", "--others", "--exclude-standard", "mutation-pairs/pairs/*/pair.json"])
    .split(/\r?\n/).filter(Boolean).sort();
  if (pairs.length < 10 || pairs.length > 20) throw new Error("The suite requires 10 to 20 pairs.");
  for (const metadata of pairs) {
    const pair = JSON.parse(readFileSync(join(root, metadata), "utf8"));
    const dir = dirname(metadata).split(sep).join("/");
    const original = dir + "/original.test.ts";
    const twin = dir + "/twin.test.ts";
    const patch = join(root, dir, "twin.patch");
    const originalOnMaster = check(original, root, join(scratch, pair.id + "-original.json"));
    const twinOnMaster = check(twin, root, join(scratch, pair.id + "-twin.json"));
    const tree = join(scratch, pair.id);
    copyTree(tree);
    git(["apply", "--check", patch], tree);
    const numstat = git(["apply", "--numstat", patch], tree).split(/\r?\n/);
    let added = 0, removed = 0;
    for (const line of numstat) {
      const [plus, minus, file] = line.split("\t");
      if (!file?.startsWith("src/") || !Number.isFinite(Number(plus)) || !Number.isFinite(Number(minus))) {
        throw new Error("A reference patch must change source text only.");
      }
      added += Number(plus);
      removed += Number(minus);
    }
    git(["apply", patch], tree);
    const twinPatched = check(twin, tree, join(scratch, pair.id + "-twin-patched.json"));
    const originalPatched = check(original, tree, join(scratch, pair.id + "-original-patched.json"));
    const valid = originalOnMaster.status === "pass" && twinOnMaster.status === "fail" &&
      twinPatched.status === "pass" && originalPatched.status === "fail";
    rows.push({ ...pair, originalOnMaster, twinOnMaster, twinPatched, originalPatched,
      patchLines: { added, removed, total: added + removed }, valid });
    process.stdout.write(pair.id + ": " + (valid ? "expected verdicts" : "BROKEN EXPECTATIONS") + "\n");
    removeScratch(tree);
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  removeScratch(scratch);
}

const originalPassRate = rows.length ? rows.filter((row) => row.originalOnMaster.status === "pass").length / rows.length : 0;
const twinPassRate = rows.length ? rows.filter((row) => row.twinOnMaster.status === "pass").length / rows.length : 0;
const spread = originalPassRate - twinPassRate;
const complete = error === null && rows.length >= 10 && rows.every((row) => row.valid);
const report = { baseline: git(["rev-parse", baseline]), pairs: rows, originalPassRate, twinPassRate, spread, complete, error };
const table = [
  "| Pair | Area | Original | Twin | Patched twin | Patched original | Patch lines (+/-) | Verdict |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((row) => "| " + [row.id, row.area, row.originalOnMaster.status, row.twinOnMaster.status,
    row.twinPatched.status, row.originalPatched.status,
    row.patchLines.total + " (+" + row.patchLines.added + "/-" + row.patchLines.removed + ")", row.valid ? "expected" : "FLAG"].join(" | ") + " |"),
].join("\n");
const text = "# Mutation-pair results\n\nReference source: " + report.baseline + ".\n\n" + table +
  "\n\nOriginal pass rate: " + (originalPassRate * 100) + "%. Twin pass rate: " + (twinPassRate * 100) +
  "%. Spread: " + (spread * 100) + " percentage points.\n\n" +
  (complete ? "Every pair produces the four expected verdicts." : "The matrix is incomplete or contains broken expectations.") +
  (error ? "\n\nRunner error: " + error : "") + "\n";
writeFileSync(join(suite, "results.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(suite, "RESULTS.md"), text);
process.stdout.write("\n" + table + "\nSpread: " + (spread * 100) + " percentage points.\n");
if (error) process.stderr.write(error + "\n");
process.exitCode = complete ? 0 : 1;
