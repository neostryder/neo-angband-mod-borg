import { test } from "node:test";
import assert from "node:assert/strict";
import { installTruthHost } from "./truth-host.mjs";
function fixture(record = () => {}) {
  let writer;
  const state = { actor: { player: { noscore: 0 } }, turn: 12, chunk: { depth: 1 } };
  const identity = { id: "borg", version: "test", digest: "bundle", installation: "headless:bundle" };
  const host = installTruthHost({ state, identity, grants: { has: c => c === "state:monsters-actual.read" }, record,
    consent: { setTruthSaveWriter: w => { writer = w; }, recordTruthUse: (manifest, player, who, capability, activation) => {
      player.noscore = 8; manifest.modNoscore = true;
      manifest.capabilityUse = { schema: 1, entries: [{ ...who, capability, activation, consequence: "hidden-information" }] };
    } } });
  return { state, host, read: (...a) => writer?.(...a), identity };
}
test("journals identity, noscore and hidden-information consequence before releasing monster truth", () => {
  const rows = [], f = fixture(row => rows.push(row));
  assert.equal(f.read("borg", "state:monsters-actual.read", f.state), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "truth-use");
  assert.equal(rows[0].playerNoscore, 8);
  assert.deepEqual(rows[0].manifest.capabilityUse.entries[0], { ...f.identity,
    capability: "state:monsters-actual.read", activation: { turn: 12, depth: 1 }, consequence: "hidden-information" });
  assert.equal(f.read("borg", "state:monsters-actual.read", f.state), true);
  assert.equal(rows.length, 1);
  f.host.dispose(); assert.equal(f.read("borg", "state:monsters-actual.read", f.state), undefined);
});
test("rejects another mod, state and map capability without journaling", () => {
  const rows = [], f = fixture(row => rows.push(row));
  for (const args of [["other", "state:monsters-actual.read", f.state], ["borg", "state:monsters-actual.read", {}],
    ["borg", "state:map-actual.read", f.state]]) assert.equal(f.read(...args), false);
  assert.deepEqual(rows, []); f.host.dispose();
});
test("a failed journal write does not authorize subsequent reads; it can be retried", () => {
  let fail = true, writes = 0;
  const f = fixture(() => { writes++; if (fail) throw new Error("disk full"); });
  assert.throws(() => f.read("borg", "state:monsters-actual.read", f.state), /disk full/);
  fail = false;
  assert.equal(f.read("borg", "state:monsters-actual.read", f.state), true);
  assert.equal(writes, 2); f.host.dispose();
});
test("requires a measured identity rather than writing an anonymous permission receipt", () => {
  assert.throws(() => installTruthHost({ identity: undefined }), /bundle identity/);
});
