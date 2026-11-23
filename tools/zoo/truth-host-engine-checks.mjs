// FORK #100: compile the actual API2 host and production session, not an API mock.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const engine = resolve(process.argv[2]), borg = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { build } = await import(createRequire(join(engine, "packages/web/package.json")).resolve("vite"));
const out = mkdtempSync(join(tmpdir(), "borg-truth-host-"));
try {
  await build({ configFile: false, root: join(engine, "packages/web"), logLevel: "error",
    plugins: [{ name: "pinned-test-imports", transform(code, id) {
      if (id.startsWith(borg + "/tools/zoo/")) return code.replaceAll('"ENGINE/', JSON.stringify(engine + "/").slice(0, -1)).replaceAll('"BORG/', JSON.stringify(borg + "/").slice(0, -1));
    } }],
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"' },
    resolve: { alias: [
      { find: "@rpgm-tools/neo-angband-mod-sdk/backup-policy", replacement: join(engine, "packages/mod-sdk/dist/backup-policy.js") },
      { find: "@rpgm-tools/neo-angband-core/log", replacement: join(engine, "packages/core/dist/log.js") },
      { find: "@rpgm-tools/neo-angband-core", replacement: join(engine, "packages/core/dist/index.js") },
      { find: /^@rpgm-tools\/neo-angband-mod-sdk$/, replacement: join(engine, "packages/mod-sdk/dist/index.js") },
    ] }, ssr: { noExternal: true }, build: { ssr: join(borg, "tools/zoo/truth-host-engine.fixture.ts"),
      outDir: out, target: "node26", minify: false, rollupOptions: { output: { entryFileNames: "checks.mjs", inlineDynamicImports: true } } } });
  execFileSync(process.execPath, [join(out, "checks.mjs"), join(engine, "packages/content/pack"), join(borg, "manifest.json")], { stdio: "inherit" });
} finally { rmSync(out, { recursive: true, force: true }); }
