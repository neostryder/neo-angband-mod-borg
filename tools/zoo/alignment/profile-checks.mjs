import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import fixture from "./native-birth-fixture.json" with { type: "json" };
import { C_POINT_BUY_PROFILE, alignedBirth } from "./profile.mjs";
import { loadPack } from "../pack.ts";
const engine = process.env.ALIGNMENT_ENGINE,
  packDir = process.env.ALIGNMENT_PACK;
if (!engine || !packDir)
  throw new Error(
    "Set ALIGNMENT_ENGINE to built pinned Core checkout and ALIGNMENT_PACK to its composed pack.",
  );
assert.equal(
  execFileSync("git", ["-C", engine, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  process.env.ALIGNMENT_ENGINE_PIN ?? fixture.source.Neo,
);
const core = await import(
    pathToFileURL(resolve(engine, "packages/core/dist/index.js"))
  ),
  pack = loadPack(packDir);
test("all nine point-buy allocations match observed native C births", () => {
  for (const c of fixture.cases)
    assert.deepEqual(
      alignedBirth(core, pack, C_POINT_BUY_PROFILE.id, c.race, c.class)
        .birthStats,
      c.stats,
      c.class,
    );
});
test("declared initial and active Boolean options match native observations", () => {
  assert.deepEqual(C_POINT_BUY_PROFILE.options, fixture.native_options);
  assert.deepEqual(
    { ...C_POINT_BUY_PROFILE.options, ...C_POINT_BUY_PROFILE.activeOptions },
    fixture.native_active_options,
  );
});
test("default remains opt-in and invalid profile/identity fail closed", () => {
  assert.deepEqual(alignedBirth(core, pack, undefined, "Human", "Warrior"), {});
  assert.throws(
    () => alignedBirth(core, pack, "typo", "Human", "Warrior"),
    /Unknown birth profile/,
  );
  assert.throws(
    () =>
      alignedBirth(core, pack, C_POINT_BUY_PROFILE.id, "missing", "Warrior"),
    /explicit valid/,
  );
});
test("real-Core no-profile control exposes old mismatch; aligned birth supplies C stats and options", () => {
  const c = fixture.cases[0];
  const ordinary = core.startGame(pack, {
    seed: c.seed,
    depth: 0,
    raceName: c.race,
    className: c.class,
  });
  assert.notDeepEqual([...ordinary.state.actor.player.statBirth], c.stats);
  assert.equal(ordinary.state.options.get("birth_no_selling"), false);
  const aligned = core.startGame(pack, {
    seed: c.seed,
    depth: 0,
    raceName: c.race,
    className: c.class,
    ...alignedBirth(core, pack, C_POINT_BUY_PROFILE.id, c.race, c.class),
  });
  assert.deepEqual([...aligned.state.actor.player.statBirth], c.stats);
  assert.equal(aligned.state.actor.player.chp, c.hp);
  assert.deepEqual(
    aligned.state.options.snapshot().values,
    fixture.native_options,
  );
});
