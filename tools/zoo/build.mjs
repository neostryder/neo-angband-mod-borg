// Headless build step for borg-zoo (copied from diegoami/neo-angband-tracker
// 2668adc5ab3e, tools/original-borg/build.mjs).
//
// FORK: differences from the source, and why.
//  - The two hard-coded source pins are gone. --engine-pin / --borg-pin are
//    optional; when given, `git rev-parse HEAD` must equal them, otherwise the
//    commits are only recorded in build.json. The tracked-content and
//    approved-mode-change checks are kept unchanged.
//  - build.json's borg.repository is read from this checkout's git remote
//    instead of claiming to be neostryder/neo-angband-mod-borg.
//  - Schema names stay "neo-original-build@1" (here) and "neo-original/run@1"
//    (run.mjs) on purpose: borg-zoo's parser (zoo/neo_original.py) reads both,
//    and a rename would break it. They do not mean the Borg is the original.
//
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { sourceIntegrity } from "./source-integrity.mjs";
import { fileURLToPath } from "node:url";
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.reduce(
			(a, v, i, all) =>
				i % 2 ? a : (a.push([v.slice(2), all[i + 1]]), a),
			[],
		),
);
for (const name of ["engine-dir", "borg-dir", "out"])
	if (!args[name]) throw new Error("Missing --" + name);
if (args["c-gcc-coordinate-order"] === "true" && args["c-seed-startup"] !== "true")
	throw new Error("GCC coordinate adapter requires C seeded startup");
const pins = {
	engine: args["engine-pin"],
	borg: args["borg-pin"],
};
for (const k of ["engine-pin", "borg-pin"])
	if (k in args && !/^[0-9a-f]{40}$/.test(args[k]))
		throw new Error("--" + k + " must be a full 40-character commit id");
const engine = resolve(args["engine-dir"]),
	borg = resolve(args["borg-dir"]),
	out = resolve(args.out);
const git = (dir, ...a) =>
	execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
for (const [dir, pin] of [
	[engine, pins.engine],
	[borg, pins.borg],
]) {
	if (pin !== undefined && git(dir, "rev-parse", "HEAD") !== pin)
		throw new Error("Source commit does not match its pin: " + dir);
	if (
		git(dir, "diff", "HEAD", "--numstat")
			.split("\n")
			.filter(Boolean)
			.some((row) => !/^0\t0\t/.test(row))
	)
		throw new Error("Tracked source contents changed: " + dir);
	const modes = git(dir, "diff", "HEAD", "--summary");
	if (
		modes &&
		(dir !== engine ||
			modes
				.split("\n")
				.some(
					(row) =>
						!/^mode change 100644 => 100755 packages\/mod-sdk\/bin\/neo-angband-mod-(build|check)\.mjs$/.test(
							row.trim(),
						),
				))
	)
		throw new Error("Unapproved tracked mode changes");
}
const engineIntegrity=sourceIntegrity(engine,{engine:true}),borgIntegrity=sourceIntegrity(borg);
mkdirSync(out, { recursive: false });
const tool = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(engine, "packages/web/package.json"));
const { build } = await import(require.resolve("vite"));
const source = readFileSync(join(tool, "session.ts"), "utf8")
	.replaceAll('"ENGINE/', JSON.stringify(engine + "/").slice(0, -1))
	.replaceAll('"BORG/', JSON.stringify(borg + "/").slice(0, -1));
writeFileSync(join(out, "entry.ts"), source);
cpSync(join(tool, "pack.ts"), join(out, "pack.ts"));
cpSync(join(tool, "message-host.mjs"), join(out, "message-host.mjs"));
cpSync(join(tool, "truth-host.mjs"), join(out, "truth-host.mjs"));
mkdirSync(join(out, "alignment"));
cpSync(join(tool, "alignment/profile.mjs"), join(out, "alignment/profile.mjs"));
cpSync(join(tool, "alignment/seed-startup.mjs"), join(out, "alignment/seed-startup.mjs"));
let exactTickSites = 0;
const startupSites = { birth: 0, borg: 0, gcc: 0 };
await build({
	configFile: false,
	// FORK: opt-in observers and explicit C startup/compiler adapters in the bundle.
	plugins: (args["alignment-probes"] === "true" || args["exact-tick-cap"] === "true" || args["c-seed-startup"] === "true") ? [{
		name: "explicit-c-startup-and-observations",
		transform(code, id) {
			if (id === engine + "/packages/core/dist/game/loop.js" && args["exact-tick-cap"] === "true") {
				const needle = "state.turn++;";
				if (code.split(needle).length !== 2) throw new Error("Missing unique world tick boundary");
				exactTickSites++;
				return code.replace(needle, needle + " globalThis.__alignmentTickCap?.(state);");
			}
			if (id === engine + "/packages/core/dist/store/store.js" && args["c-seed-startup"] === "true") {
				const start = code.indexOf("function storeReset(ctx)");
				const end = code.indexOf("\n}", start) + 2;
				if (start < 0 || end < start) throw new Error("Missing store reset probe site");
				let part = code.slice(start,end);
				part = part.replace("for (const store of ctx.stores) {", "for (const [i, store] of ctx.stores.entries()) { globalThis.__observeBirthRng?.(`store-${i}-owner-before`,ctx.rng);");
				part = part.replace("store.owner = storeChooseOwner(ctx.rng, store);", "store.owner = storeChooseOwner(ctx.rng, store); globalThis.__observeBirthRng?.(`store-${i}-owner-after`,ctx.rng);");
				part = part.replace(/for \(let j = 0; j < 10; j\+\+\)\s*storeMaint\(ctx, store\);/, "for (let j = 0; j < 10; j++) { globalThis.__observeBirthRng?.(`store-${i}-maint-${j}-before`,ctx.rng); storeMaint(ctx,store); globalThis.__observeBirthRng?.(`store-${i}-maint-${j}-after`,ctx.rng); }");
				return code.slice(0,start)+part+code.slice(end);
			}
			if (id === engine + "/packages/core/dist/session/game.js" && args["c-seed-startup"] === "true") {
				code = code.replace("earlyStores = createTownStores(", "globalThis.__observeBirthRng?.('stores-before',mainRng); earlyStores = createTownStores(");
				code = code.replace("let resolved = false;", "globalThis.__observeBirthRng?.('stores-after',mainRng); let resolved = false;");
				code = code.replace("const booted = bootLevel(pack,", "globalThis.__observeBirthRng?.('outfit-after',mainRng); const booted = bootLevel(pack,");
				return code;
			}
			if (id === engine + "/packages/core/dist/gen/cave.js" && args["c-seed-startup"] === "true") {
				const needle = "function townGenLayout(g) {";
				if (!code.includes(needle)) throw new Error("Missing town layout probe site");
				code = code.replace(needle, needle + " globalThis.__observeBirthRng?.('town-before',g.rng);");
                const stream = /for \(let n = 0; n < 3 \+ numLava; n\+\+\)\s*buildStreamer\(g, FEAT.LAVA, 0\);/;
                if (!stream.test(code)) throw new Error("Missing town streamer probe site");
                code = code.replace(stream, "for (let n=0;n<3+numLava;n++) { globalThis.__observeBirthRng?.(`town-stream-${n}-before`,g.rng); buildStreamer(g,FEAT.LAVA,0); globalThis.__observeBirthRng?.(`town-stream-${n}-after`,g.rng); }");
                if (args["c-gcc-coordinate-order"] === "true") {
                    const old = "let grid = loc(g.rng.randSpread(Math.trunc(c.width / 2), 15), g.rng.randSpread(Math.trunc(c.height / 2), 10));";
                    if (code.split(old).length !== 2) throw new Error("Missing unique streamer rand_loc site");
                    startupSites.gcc++;
                    code = code.replace(old, "const gccY = g.rng.randSpread(Math.trunc(c.height / 2), 10); let grid = loc(g.rng.randSpread(Math.trunc(c.width / 2), 15), gccY);");
                }
                return code;
			}
			if (id === engine + "/packages/core/dist/gen/util.js" && args["c-gcc-coordinate-order"] === "true") {
                const old = "const grid = loc(g.rng.randint0(c.width), g.rng.randint0(c.height));";
                if (code.split(old).length !== 2) throw new Error("Missing unique distant monster coordinate site");
                startupSites.gcc++;
                return code.replace(old, "const gccY = g.rng.randint0(c.height); const grid = loc(g.rng.randint0(c.width), gccY);");
            }
			if (id === borg + "/plugin.ts" && args["c-seed-startup"] === "true") {
				const needle = /createBorg\(\{\s*resolvers:/;
				if (!needle.test(code)) throw new Error("Missing Borg construction site");
				startupSites.borg++;
				return code.replace(needle, "createBorg({ rngSeed: globalThis.__cSeedBorg?.(), resolvers:");
			}
			if (args["alignment-probes"] !== "true" && args["c-seed-startup"] !== "true") return;
			if (id !== engine + "/packages/core/dist/player/birth.js") return;
			for (const [needle, tag] of [
				["rollHp(player, rng);", "hp"],
				["const ahw = rollAhw(race, rng);", "ahw"],
				["const rolledHistory = generateHistory(options.historyChart, rng);", "history"],
			]) {
				if (!code.includes(needle)) throw new Error("Missing alignment probe site: " + needle);
				code = code.replace(needle, `globalThis.__observeBirthRng?.('${tag}-before',rng); ${needle} globalThis.__observeBirthRng?.('${tag}-after',rng);`);
			}
			if (args["c-seed-startup"] === "true") {
				startupSites.birth++;
				code = code.replace("const ahw = rollAhw(race, rng);", "const ahw = globalThis.__cSeedBirth?.ahw ?? rollAhw(race, rng);");
				code = code.replace("const rolledHistory = generateHistory(options.historyChart, rng);", "const rolledHistory = globalThis.__cSeedBirth?.history ?? generateHistory(options.historyChart, rng);");
			}
			return code;
		},
	}] : [],
	root: join(engine, "packages/web"),
	logLevel: "warn",
	define: {
		"import.meta.env.DEV": "false",
		"import.meta.env.PROD": "true",
		"import.meta.env.MODE": '"production"',
	},
	resolve: {
		alias: [
            { find: "@rpgm-tools/neo-angband-mod-sdk/backup-policy", replacement: join(engine, "packages/mod-sdk/dist/backup-policy.js") },
			{
				find: "@rpgm-tools/neo-angband-core/log",
				replacement: join(engine, "packages/core/dist/log.js"),
			},
			{
				find: "@rpgm-tools/neo-angband-core",
				replacement: join(engine, "packages/core/dist/index.js"),
			},
			{
				find: /^@rpgm-tools\/neo-angband-mod-sdk$/,
				replacement: join(engine, "packages/mod-sdk/dist/index.js"),
			},
		],
	},
	ssr: { noExternal: true },
	build: {
		ssr: join(out, "entry.ts"),
		outDir: out,
		emptyOutDir: false,
		target: "node22",
		minify: false,
		rollupOptions: {
			output: {
				entryFileNames: "bundle.mjs",
				inlineDynamicImports: true,
			},
		},
	},
});

if (args["exact-tick-cap"] === "true" && exactTickSites !== 1) throw new Error("Exact tick observer was not installed");
if (args["c-seed-startup"] === "true" && (startupSites.birth !== 1 || startupSites.borg !== 1))
	throw new Error("C startup adapters were not installed exactly once");
if (args["c-gcc-coordinate-order"] === "true" && startupSites.gcc !== 2)
	throw new Error("GCC coordinate adapter was not installed exactly once");

cpSync(join(engine, "packages/content/pack"), join(out, "pack"), {
	recursive: true,
});
const repositoryOf = (checkout) => {
	try {
		const url = git(checkout, "remote", "get-url", "origin");
		return url.replace(/\.git$/, "").replace(/^.*github\.com[:/]/, "");
	} catch {
		return "unknown";
	}
};
const borgRepository = repositoryOf(borg);
const engineRepository = repositoryOf(engine);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
writeFileSync(
	join(out, "build.json"),
	JSON.stringify(
		{
			schema: "neo-original-build@1",
            sourcePaths: {engine,borg,bundle:join(out,"bundle.mjs")},
			alignmentProbes: args["alignment-probes"] === "true",
			exactTickCap: args["exact-tick-cap"] === "true",
			cSeedStartup: args["c-seed-startup"] === "true",
			cGccCoordinateOrder: args["c-gcc-coordinate-order"] === "true",
			versions: Object.fromEntries(
				["core", "content", "mod-sdk"].map((n) => [
					n,
					JSON.parse(
						readFileSync(
							join(engine, "packages", n, "package.json"),
						),
					).version,
				]),
			),
			appliedPatches: [
				...(args["c-seed-startup"] === "true" ? ["c-native-menu-birth-and-borg-startup-v2"] : []),
				...(args["c-gcc-coordinate-order"] === "true" ? ["gcc14-native-rand-loc-y-before-x"] : []),
			],
			lockSha256: sha(join(engine, "pnpm-lock.yaml")),
			engine: {
				repository: engineRepository,
                sourceIntegrity:engineIntegrity,
				commit: git(engine, "rev-parse", "HEAD"),
				dirty: git(engine, "status", "--porcelain") !== "",
				version: JSON.parse(readFileSync(join(engine, "package.json")))
					.version,
			},
			borg: {
				repository: borgRepository,
                sourceIntegrity:borgIntegrity,
				commit: git(borg, "rev-parse", "HEAD"),
				dirty: git(borg, "status", "--porcelain") !== "",
				manifest: JSON.parse(readFileSync(join(borg, "manifest.json"))),
			},
			bundleSha256: sha(join(out, "bundle.mjs")),
			packSha256: createHash("sha256")
				.update(
					execFileSync(
						"git",
						[
							"-C",
							engine,
							"ls-tree",
							"-r",
							"HEAD",
							"packages/content/pack",
						],
						{ encoding: "utf8" },
					),
				)
				.digest("hex"),
			officialHostModules: Object.fromEntries(
				[
					"mod-api2-host.ts",
					"intent-gate.ts",
					"mod-context.ts",
					"input-snapshot.ts",
				].map((f) => [f, sha(join(engine, "packages/web/src", f))]),
			),
			contentFiles: Object.fromEntries(
				(await import("node:fs"))
					.readdirSync(join(out, "pack"))
					.filter((f) => f.endsWith(".json"))
					.sort()
					.map((f) => [f, sha(join(out, "pack", f))]),
			),
			toolSha256: Object.fromEntries(
				["session.ts", "pack.ts", "message-host.mjs", "truth-host.mjs", "source-integrity.mjs", "build.mjs", "run.mjs", "alignment/profile.mjs", "alignment/seed-startup.mjs"].map((f) => [
					f,
					sha(join(tool, f)),
				]),
			),
		},
		null,
		2,
	) + "\n",
);
