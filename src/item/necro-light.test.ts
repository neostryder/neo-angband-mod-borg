import { describe, expect, it } from "vitest";
import type { ItemView, SpellView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "../world/model.js";
import { BORG_GLOW, BORG_LIGHT } from "../world/grid.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import { borgNotice, BI } from "../trait/index.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import type { BorgContext } from "../context.js";
import { borgSpellFailRate, borgSpellOkayFail, Spell } from "./magic.js";
import { TV } from "./svals.js";

function item(tval: number): ItemView {
  return {
    handle: tval, kindKey: "", aware: true, nameColor: "", label: "fixture",
    tval, sval: 1, pval: 0, number: 1, weight: 0, ac: 0, toA: 0,
    toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 5000,
    inscription: null,
  };
}

/** Notice and perceive the same torchless UNLIGHT birth the engine provides. */
function necromancer(lamp = false, glow = false, zeroFail = true): BorgContext {
  const base = makeScenarioView({
    player: { cls: "Necromancer", classFlags: zeroFail ? ["UNLIGHT", "ZERO_FAIL"] : ["UNLIGHT"],
      grid: { x: 10, y: 10 }, depth: 1, level: 5, maxLevel: 5, sp: 20, maxSp: 20 },
    cells: { "10,10": { glow } },
  });
  const bolt: SpellView = {
    name: "Nether Bolt", sidx: 0, bidx: 0, level: 1, mana: 1, fail: 30,
    learned: true, worked: true, forgotten: false, studyEligible: false, infoLine: "",
  };
  const light = { ...item(TV.LIGHT), flags: ["LIGHT_2"] };
  const ctx: BorgContext = {
    world: new BorgWorld(), act: makeFakeActions(), rng: makeBorgRng(),
    bookKind: (tval) => ({ tval, sval: 1 }),
    view: { ...base,
      equipment: () => [null, null, null, null, null, lamp ? light : null],
      inventory: () => [item(TV.SHADOW_BOOK)],
      spellbooks: () => [{ tval: TV.SHADOW_BOOK, name: "Into the Shadows", realm: "shadow", spells: [bolt] }],
    },
  };
  borgNotice(ctx);
  perceive(ctx.world, ctx.view, makePerceiveMemo());
  // Hold the formula inputs fixed so these cases isolate light and player flags.
  ctx.world.self.trait[BI.FAIL1] = 0;
  ctx.world.self.trait[BI.FAIL2] = 0;
  return ctx;
}

describe("Necromancer light and spell eligibility (#68, C borg_update_light)", () => {
  it("does not turn virtual UNLIGHT vision into torchlight", () => {
    const ctx = necromancer();
    expect(ctx.world.self.trait[BI.LIGHT]).toBe(1);
    expect(ctx.world.map.at(10, 10).info & BORG_LIGHT).toBe(0);
    expect(borgSpellFailRate(ctx, Spell.NETHER_BOLT)).toBe(18);
    expect(borgSpellOkayFail(ctx, Spell.NETHER_BOLT, 25)).toBe(true);
  });

  it("applies the C's +25 penalty when a lamp is actually equipped", () => {
    const ctx = necromancer(true);
    expect(ctx.world.map.at(10, 10).info & BORG_LIGHT).not.toBe(0);
    expect(borgSpellFailRate(ctx, Spell.NETHER_BOLT)).toBe(43);
    expect(borgSpellOkayFail(ctx, Spell.NETHER_BOLT, 25)).toBe(false);
    // Taking the lamp off also clears the old torchlight flags.
    ctx.view = { ...ctx.view, equipment: () => [] };
    perceive(ctx.world, ctx.view, makePerceiveMemo());
    expect(ctx.world.map.at(10, 10).info & BORG_LIGHT).toBe(0);
  });

  it("does not substitute permanent glow for the C's BORG_LIGHT predicate", () => {
    const ctx = necromancer(false, true);
    expect(ctx.world.map.at(10, 10).info & BORG_GLOW).not.toBe(0);
    expect(borgSpellFailRate(ctx, Spell.NETHER_BOLT)).toBe(18);
  });

  it("lights only the player's grid when an equipped lamp has radius zero", () => {
    const ctx = necromancer(true);
    ctx.world.self.trait[BI.LIGHT] = 0;
    perceive(ctx.world, ctx.view, makePerceiveMemo());
    expect(ctx.world.map.at(10, 10).info & BORG_LIGHT).not.toBe(0);
    expect(ctx.world.map.at(11, 10).info & BORG_LIGHT).toBe(0);
  });

  it("reads ZERO_FAIL from the player's class flags, including Necromancers", () => {
    const ctx = necromancer();
    ctx.world.map.at(10, 10).info &= ~BORG_LIGHT;
    ctx.world.self.trait[BI.CLEVEL] = 50;
    expect(borgSpellFailRate(ctx, Spell.NETHER_BOLT)).toBe(0);
    const ordinary = necromancer(false, false, false);
    ordinary.world.map.at(10, 10).info &= ~BORG_LIGHT;
    ordinary.world.self.trait[BI.CLEVEL] = 50;
    expect(borgSpellFailRate(ordinary, Spell.NETHER_BOLT)).toBe(5);
  });
});
