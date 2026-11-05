import { describe, expect, it } from "vitest";
import type { BorgContext } from "../context.js";
import { makeFakeActions, makeScenarioView } from "../harness.js";
import { BorgWorld } from "../world/model.js";
import { borgNotice } from "../trait/trait.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { makeBorgRng } from "../rng.js";
import { FEAT } from "../core-api.js";
import { getDangerGlobals } from "../danger/index.js";
import { getFightState } from "./state.js";
import { borgEscape } from "./escape.js";

const branches = [
  { name: "level 3", danger: 105, level: 20, cls: "Warrior" },
  { name: "level 4", danger: 75, level: 20, cls: "Warrior" },
  { name: "level 5", danger: 55, level: 5, cls: "Warrior" },
  { name: "level 6", danger: 65, level: 40, cls: "Mage" },
  { name: "level 8", danger: 0, level: 40, cls: "Warrior" },
] as const;

function scene(branch: typeof branches[number], onStair: boolean, elapsed: number) {
  const world = new BorgWorld();
  const view = makeScenarioView({
    player: { grid: { x: 10, y: 10 }, depth: 5, maxDepth: 5,
      cls: branch.cls, level: branch.level, maxLevel: branch.level,
      hp: 100, maxHp: 100, sp: 0, maxSp: branch.cls === "Mage" ? 100 : 0 },
    cells: { "10,10": { feat: onStair ? FEAT.LESS : FEAT.FLOOR, passable: true } },
  });
  const act = makeFakeActions();
  const ctx: BorgContext = { world, view, act, rng: makeBorgRng(1) };
  borgNotice(ctx);
  perceive(world, view, makePerceiveMemo());
  world.clock = 1000;
  world.self.timesTwitch = branch.name === "level 8" ? 51 : 0;
  world.self.escapes = 7;
  getDangerGlobals(world).avoidance = 100;
  const fs = getFightState(world);
  fs.tAntisummon = world.clock - elapsed;
  return { ctx, fs, act };
}

describe("escape returns the queued C stair action", () => {
  it.each(branches)("$name returns ascent even with no phase resource", (branch) => {
    const { ctx } = scene(branch, true, 100);
    // C borg_escape_stair queues '<' before later phase predicates run.
    expect(borgEscape(ctx, branch.danger)).toEqual({ code: "ascend" });
    expect(ctx.world.self.escapes).toBe(7);
  });

  it.each(branches)("$name does not gate stairs on the phase anti-summon timer", (branch) => {
    for (const elapsed of [0, 50]) {
      const { ctx } = scene(branch, true, elapsed);
      expect(borgEscape(ctx, branch.danger)).toEqual({ code: "ascend" });
    }
  });

  it.each(branches)("$name still declines without a stair or escape resource", (branch) => {
    const { ctx } = scene(branch, false, 100);
    expect(borgEscape(ctx, branch.danger)).toBeNull();
  });

  it("keeps the already-correct higher-danger stair choice", () => {
    const { ctx } = scene(branches[0], true, 100);
    expect(borgEscape(ctx, 200)).toEqual({ code: "ascend" });
  });
});
