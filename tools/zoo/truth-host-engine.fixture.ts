import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "ENGINE/packages/core/dist/index.js";
import { createApi2Host, disposeApi2Host } from "ENGINE/packages/web/src/mod-api2-host.ts";
import { modPluginContext } from "ENGINE/packages/web/src/mod-context.ts";
import * as consent from "ENGINE/packages/web/src/mod-truth-consent.ts";
import { installTruthHost } from "./truth-host.mjs";
import { loadPack } from "./pack.ts";
import { run } from "./session.ts";
const packDir = process.argv[2], manifest = JSON.parse(readFileSync(process.argv[3], "utf8")).data;
const game = core.startGame(loadPack(packDir), { seed: 350019725, depth: 0 });
const state = game.state, rows: any[] = [];
const identity = { id: "borg", version: manifest.version, digest: "test-bundle", installation: "headless:test-bundle" };
const grants = { has: (name: string) => name === "engine:access" || manifest.capabilities.includes(name) };
const context = modPluginContext("borg", {}, state, {}, { capabilities: grants, registries: game.booted.registries });
const api = createApi2Host(context, { execution: "in-process", developerInProcess: true, grants, firstParty: { truth: true } });
const eye = game.booted.registries.monsters.races.find((r: any) => r.name === "floating eye")!;
assert.ok(eye);
assert.equal((await api.truth!.race(eye.ridx)).ok, false, "missing writer must remain denied");
let host = installTruthHost({ state, grants, identity, consent, record: row => rows.push(row) });
try {
  const race = await api.truth!.race(eye.ridx);
  assert.equal(race.ok, true);
  if (!race.ok) throw Error("race denied");
  assert.ok(race.value!.blows.some(b => b.effect === "PARALYZE"), "eye must have its real attack before any lore learns it");
  assert.equal((await api.truth!.monsters()).ok, true);
  assert.equal((await api.truth!.level()).ok, false, "never grant actual map");
  assert.equal(rows.length, 1, "both reads share one persisted capability receipt");
  assert.ok(state.actor.player.noscore & core.NOSCORE.DEBUG);
  assert.equal(rows[0].manifest.capabilityUse.entries[0].consequence, "hidden-information");
} finally { host.dispose(); }
assert.equal((await api.truth!.race(eye.ridx)).ok, false, "cleanup must remove authorization");
host = installTruthHost({ state, grants, identity, consent, record: () => { throw Error("disk full"); } });
try { assert.equal((await api.truth!.race(eye.ridx)).ok, false, "journal failure must deny real API read"); }
finally { host.dispose(); disposeApi2Host(api); }
console.log("PASS real API2: full eye attack; no map grant; durable receipt; failed-write denial; cleanup");
// Exercise session.ts itself so forgetting the installer there fails this gate.
const journal: any[] = [];
const result = await run({ seed: 350019725, turns: 500, decisions: 10000, packDir, manifest,
  truthIdentity: identity, onState: row => journal.push(row), onCommand: () => {}, onMessage: () => {} });
assert.notEqual(result.outcome, "harness_failure", result.error);
assert.equal(journal.filter(r => r.kind === "truth-use").length, 1, "production session must install and use the writer");
assert.equal(result.truthUse.capabilityUse.entries[0].digest, identity.digest);
assert.equal(result.truthUse.modNoscore, true);
console.log("PASS production session: durable truth-use recorded and included in run metadata");
