/**
 * borg_flow_recover's "do I need to recover some?" (borg-flow-misc.c:242-256),
 * branching on borg_primarily_caster (borg-magic.c:264-266: num_books > 3).
 */

import { describe, expect, it } from "vitest";
import { FEAT, TV, type ItemView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld, GOAL_RECOVER } from "../world/model.js";
import { borgNotice, BI } from "../trait/index.js";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { SVAL } from "../item/svals.js";
import { borgFlowRecover, borgNeedsRecover } from "./flow-misc.js";
import { createFlowState } from "./flow.js";

const classes = [
  ["Warrior", false, 0],
  ["Mage", true, 20],
  ["Druid", true, 20],
  ["Priest", true, 20],
  ["Necromancer", true, 20],
  ["Paladin", false, 20],
  ["Rogue", false, 20],
  ["Ranger", false, 20],
  ["Blackguard", false, 20],
] as const;

function lowSp(cls: string, player: Scenario["player"] = {}): BorgContext {
  const world = new BorgWorld();
  const base = makeScenarioView({
    floorFeat: FEAT.GRANITE,
    player: { cls, level: 10, maxLevel: 10, grid: { x: 10, y: 10 }, depth: 3,
      hp: 61, maxHp: 61, sp: cls === "Warrior" ? 0 : 1, maxSp: cls === "Warrior" ? 0 : 20, ...player },
    cells: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
      `${String(10 + i)},10`, { feat: i >= 6 ? FEAT.LESS : FEAT.FLOOR, passable: true },
    ])),
  });
  const food: ItemView = {
    handle: 0, kindKey: "ration", aware: true, nameColor: "", label: "Rations of Food",
    tval: TV.FOOD, sval: SVAL.food.ration!, pval: 0, number: 5, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0, inscription: null,
  };
  const view = { ...base, inventory: () => [food] };
  const ctx: BorgContext = { world, view, act: makeFakeActions(), rng: makeBorgRng() };
  world.clock = 1000;
  borgNotice(ctx);
  perceive(world, view, makePerceiveMemo());
  return ctx;
}

describe.each(classes)("%s recovery", (cls, primary, maxSp) => {
  it("uses the class and SP that borgNotice reads from the view", () => {
    const ctx = lowSp(cls);
    expect(ctx.world.self.trait[BI.MAXSP]).toBe(maxSp);
    expect(borgNeedsRecover(ctx)).toBe(primary);
  });

  it("selects a recovery destination for the primary caster branch", () => {
    /* A one-HP wound admits combat regenerators (borg-flow-misc.c:1219-1221). */
    const ctx = lowSp(cls, { hp: 60 });
    const flow = createFlowState();
    const cmd = borgFlowRecover(ctx, flow, 50);
    if (primary) {
      expect(cmd?.code).toBe("walk");
      expect(ctx.world.self.goal.type).toBe(GOAL_RECOVER);
      /* borg-flow-misc.c:288-294 admits the stair seven grids away. */
      expect(flow.tempN).toBe(1);
      expect([flow.tempX[0], flow.tempY[0]]).toEqual([17, 10]);
    } else {
      expect(cmd).toBeNull();
      expect(flow.tempN).toBe(0);
    }
  });

  it("recovers at one third HP and stays put above it with sufficient SP", () => {
    /* borg-flow-misc.c:244-256 uses integer division and a strict comparison. */
    expect(borgNeedsRecover(lowSp(cls, { hp: 20, sp: maxSp }))).toBe(true);
    expect(borgNeedsRecover(lowSp(cls, { hp: 21, sp: maxSp }))).toBe(false);
  });

  it.each([
    { cut: 1 }, { stun: 1 }, { stun: 51 }, { afraid: 1 },
  ])("recovers for the status %j with sufficient SP", (status) => {
    expect(borgNeedsRecover(lowSp(cls, { sp: maxSp, status }))).toBe(true);
  });
});

describe.each(classes.filter(([, primary]) => primary))("%s SP threshold", (cls) => {
  it("recovers at one quarter SP and stays put above it or at zero capacity", () => {
    /* borg-flow-misc.c:245-246 treats MAXSP == 0 as sufficient mana. */
    expect(borgNeedsRecover(lowSp(cls, { sp: 5, maxSp: 23 }))).toBe(true);
    expect(borgNeedsRecover(lowSp(cls, { sp: 6, maxSp: 23 }))).toBe(false);
    expect(borgNeedsRecover(lowSp(cls, { sp: 0, maxSp: 0 }))).toBe(false);
  });
});
