import { createHash } from "node:crypto";
import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	openSync,
	writeSync,
	closeSync,
	fsyncSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const a = Object.fromEntries(
	process.argv
		.slice(2)
		.reduce(
			(r, v, i, all) =>
				i % 2 ? r : (r.push([v.slice(2), all[i + 1]]), r),
			[],
		),
);
for (const k of ["bundle", "seed", "turns", "out"])
	if (!a[k]) throw new Error("Missing --" + k);
for (const k of ["seed", "turns", "decisions"])
	if (
		a[k] !== undefined &&
		(!Number.isSafeInteger(Number(a[k])) ||
			(k !== "seed" && Number(a[k]) < 1))
	)
		throw new Error("Invalid --" + k);
const bundle = resolve(a.bundle),
	out = resolve(a.out);
const build = JSON.parse(readFileSync(join(dirname(bundle), "build.json")));
mkdirSync(out, { recursive: false });
const states = openSync(join(out, "states.jsonl"), "wx"),
	commands = openSync(join(out, "commands.jsonl"), "wx");
const messageFile = openSync(join(out, "messages.jsonl"), "wx");
const observations = openSync(join(out, "observations.jsonl"), "wx");
const input = {
	seed: Number(a.seed),
	birthProfile: a["birth-profile"],
	race: a.race,
	class: a.class,
	turns: Number(a.turns ?? 100000),
	decisions: Number(a.decisions ?? 10000000),
};
if (build.cGccCoordinateOrder && input.birthProfile !== "c-seeded-point-buy-v2")
	throw new Error("Compiler coordinate adapter requires c-seeded-point-buy-v2");
if(a.record!==undefined&&!['true','false'].includes(a.record))throw Error('Invalid --record');
const recording=a.record==='true';
const started = performance.now();
const lastFrames = [];
let record;
try {
	const sha = (p) =>
		createHash("sha256").update(readFileSync(p)).digest("hex");
	if (sha(bundle) !== build.bundleSha256)
		throw new Error("Bundle hash mismatch");
	for (const [file, expected] of Object.entries(build.contentFiles))
		if (sha(join(dirname(bundle), "pack", file)) !== expected)
			throw new Error("Content hash mismatch: " + file);
	const m = await import(pathToFileURL(bundle));
	record = await m.run({
		...input,
		exactTickCap: build.exactTickCap === true,
		cSeedStartup: build.cSeedStartup === true,
		packDir: join(dirname(bundle), "pack"),
		manifest: build.borg.manifest.data,
        ...(recording ? {
          onFrame: (r) => { lastFrames.push(r); if(lastFrames.length>30)lastFrames.shift(); if(a.watch==='true')process.stdout.write(JSON.stringify({frame:r})+'\n'); },
          onObservation: (r) => { writeSync(observations,JSON.stringify(r)+'\n');if(a.watch==='true')process.stdout.write(JSON.stringify({frame:r})+'\n'); },
        } : {}),
        onSave: a['save-games'] === 'true' ? (stage, save) => writeFileSync(join(out, stage + '.save.json'), JSON.stringify(save) + '\n', { flag: 'wx' }) : undefined,
		truthIdentity: { id: build.borg.manifest.data.id, version: build.borg.manifest.data.version, digest: build.bundleSha256, installation: "headless:"+build.bundleSha256 },
        onState: (r) => { writeSync(states, JSON.stringify(r)+"\n"); if(r.kind==='truth-use')fsyncSync(states); },
		onCommand: (r) => writeSync(commands, r),
		onMessage: (r) => writeSync(messageFile, JSON.stringify(r) + "\n"),
	});
} catch (e) {
	record = { outcome: "harness_failure", error: String(e?.stack ?? e) };
}
record = {
	schema: "neo-original/run@1",
	...record,
	inputs: input,
	recording: { enabled: recording, frameWindow: recording?30:0 },
	provenance: build,
	runtime: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
	},
	wallSeconds: (performance.now() - started) / 1000,
};
writeFileSync(join(out, "run.json"), JSON.stringify(record, null, 2) + "\n");
if(recording&&record.finalKnownWorld)lastFrames.push({...record.finalKnownWorld,turn:record.turn,kind:'terminal',messages:record.messages?.slice(-5)??[]});
if(recording)writeFileSync(join(out,'last-actions.json'),JSON.stringify({schema:'neo-last-actions@1',frames:lastFrames},null,2)+'\n');
if (a.watch === 'true' && record.finalKnownWorld) process.stdout.write(JSON.stringify({frame:{...record.finalKnownWorld,turn:record.turn,kind:"final"}})+"\n");
for (const fd of [states, commands, messageFile, observations]) closeSync(fd);

console.log(
	JSON.stringify({
		out: join(out, "run.json"),
		outcome: record.outcome,
		turn: record.turn,
		causeOfDeath: record.causeOfDeath,
		wallSeconds: record.wallSeconds,
	}),
);
process.exitCode = record.outcome === "harness_failure" ? 1 : 0;
