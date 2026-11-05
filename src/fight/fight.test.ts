/**
 * Combat/defense/escape tests (P8.4). Golden values are derived by hand from
 * reference/src/borg/borg-fight-attack.c, feeding the ported damage estimators
 * exact r_info-equivalent MonsterFacts (via an injected resolver) and pinned
 * traits, so the melee/missile/spell damage math matches the C constants. The
 * orchestrators (borg_attack / borg_caution) are smoke-tested through the
 * harness for their yield/commit contract.
 */

import { describe, expect, it } from "vitest";
import type { ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "../world/model.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { BI } from "../trait/trait-index.js";
import type { MonsterFacts } from "../danger/index.js";
import { getDangerGlobals, getFearCaches, MONBLOW } from "../danger/index.js";
import { BA, BF } from "./bf.js";
import { getFightState } from "./state.js";
import { borgThrustDamageOne, borgLaunchDamageOne, borgBestMult, borgAttack, borgLaunchBolt, borgCalculateAttackEffectiveness } from "./attack.js";
import { BD, borgCalculateDefenseEffectiveness, borgDefend } from "./defend.js";
import { borgNotice } from "../trait/index.js";
import { getDerived } from "../trait/state.js";
import { TV, SVAL } from "../item/svals.js";
import { Spell, ratingsForClass } from "../item/magic.js";
import { classIndexFromName } from "../trait/trait-index.js";
import { makeCoreResolvers } from "../resolvers.js";
import { borgNearMonsterType } from "../perceive-facts.js";
import { buildThinkSession, installThinkSession } from "../think-session.js";
import { createBorg } from "../controller.js";
import { borgCaution } from "./caution.js";
import { createFlowState } from "../flow/flow.js";
import { FEAT } from "../flow/flow-consts.js";

/** A fresh FlowState with the inert default hooks (borg_init_flow). */
function makeFlowState(): ReturnType<typeof createFlowState> {
  return createFlowState();
}

/** Build a seeded BorgContext with trait overrides applied after perceive. */
function makeCtx(
  scenario: Scenario = {},
  traits: Partial<Record<keyof typeof BI, number>> = {},
): BorgContext {
  const world = new BorgWorld();
  const view = makeScenarioView(scenario);
  perceive(world, view, makePerceiveMemo());
  for (const [k, v] of Object.entries(traits)) {
    world.self.trait[BI[k as keyof typeof BI]] = v;
  }
  return { world, view, act: makeFakeActions(), rng: makeBorgRng() };
}

/** MonsterFacts builder with faithful empty defaults. */
function facts(over: Partial<MonsterFacts> = {}): MonsterFacts {
  return {
    rIdx: 1,
    flags: new Set<string>(),
    level: 1,
    sleep: 0,
    spellPower: 0,
    freqInnate: 0,
    freqSpell: 0,
    hasFriends: false,
    blows: [],
    spells: [],
    ...over,
  };
}

/** A minimal ItemView carrying only the fields the estimators read. */
function item(over: Partial<ItemView> = {}): ItemView {
  return {
    handle: 1,
    kindKey: "",
    aware: true,
    nameColor: "",
    label: "x",
    tval: 0,
    sval: 0,
    pval: 0,
    number: 1,
    weight: 10,
    ac: 0,
    toA: 0,
    toH: 0,
    toD: 0,
    dd: 0,
    ds: 0,
    ego: false,
    artifact: false,
    flags: [],
    modifiers: [],
    brands: [],
    slays: [],
    resists: [],
    curses: [],
    egoName: null,
    artifactName: null,
    activation: false,
    timeout: 0,
    inscription: null,
    ...over,
  };
}

describe("borgBestMult (attack.c:374)", () => {
  it("fire brand vs non-immune -> x3", () => {
    expect(borgBestMult(item({ brands: ["FIRE"] }), facts())).toBe(3);
  });
  it("fire brand vs IM_FIRE -> x1 (no bonus)", () => {
    expect(borgBestMult(item({ brands: ["FIRE"] }), facts({ flags: new Set(["IM_FIRE"]) }))).toBe(1);
  });
  it("fire brand vs HURT_FIRE -> x6 (vuln doubles)", () => {
    expect(borgBestMult(item({ brands: ["FIRE"] }), facts({ flags: new Set(["HURT_FIRE"]) }))).toBe(6);
  });
  it("slay EVIL vs evil -> x2", () => {
    expect(borgBestMult(item({ slays: ["EVIL"] }), facts({ flags: new Set(["EVIL"]) }))).toBe(2);
  });
  it("slay UNDEAD vs undead -> x3", () => {
    expect(borgBestMult(item({ slays: ["UNDEAD"] }), facts({ flags: new Set(["UNDEAD"]) }))).toBe(3);
  });
  it("*slay* UNDEAD_5 vs undead -> x5", () => {
    expect(borgBestMult(item({ slays: ["UNDEAD_5"] }), facts({ flags: new Set(["UNDEAD"]) }))).toBe(5);
  });
});

describe("borgThrustDamageOne (attack.c:100)", () => {
  const traits = { WDD: 2, WDS: 6, BLOWS: 1, THN: 100, CLEVEL: 10, CDEPTH: 1 };
  it("2d6 warrior, chance capped at 95% -> 6", () => {
    const ctx = makeCtx({ monsters: [{ grid: { x: 21, y: 12 } }] }, traits);
    ctx.world.kills.at(1).power = 100;
    getDangerGlobals(ctx.world).resolveFacts = () => facts();
    /* base = 2*(6+1)/2 = 7; mult 1; *1 blow; chance 100->95; 7*95/100 = 6 */
    expect(borgThrustDamageOne(ctx, 1)).toBe(6);
  });
  it("unique below town gets the x6 targeting bonus (dam += dam*5)", () => {
    const ctx = makeCtx({ monsters: [{ grid: { x: 21, y: 12 } }] }, traits);
    ctx.world.kills.at(1).power = 100;
    getDangerGlobals(ctx.world).resolveFacts = () => facts({ flags: new Set(["UNIQUE"]) });
    /* 6 + 6*5 = 36 */
    expect(borgThrustDamageOne(ctx, 1)).toBe(36);
  });
});

describe("borgLaunchDamageOne resist switch (attack.c:437)", () => {
  const traits = { CDEPTH: 1, CLEVEL: 20 };
  function setup(fl: string[]) {
    const ctx = makeCtx({ monsters: [{ grid: { x: 25, y: 12 } }] }, traits);
    ctx.world.kills.at(1).power = 1000;
    getDangerGlobals(ctx.world).resolveFacts = () => facts({ flags: new Set(fl) });
    return ctx;
  }
  it("FIRE, no immunity -> full damage", () => {
    const ctx = setup([]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.FIRE, null)).toBe(100);
  });
  it("FIRE vs IM_FIRE -> 0", () => {
    const ctx = setup(["IM_FIRE"]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.FIRE, null)).toBe(0);
  });
  it("FIRE vs HURT_FIRE -> doubled", () => {
    const ctx = setup(["HURT_FIRE"]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.FIRE, null)).toBe(200);
  });
  it("HOLY_ORB vs EVIL -> doubled", () => {
    const ctx = setup(["EVIL"]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.HOLY_ORB, null)).toBe(200);
  });
});

describe("borgAttack (attack.c:5148)", () => {
  it("no monsters -> null (yield)", () => {
    const ctx = makeCtx();
    expect(borgAttack(ctx)).toBeNull();
  });
  it("adjacent monster, warrior -> a melee (walk) command", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 21, y: 12 } }] },
      { WDD: 2, WDS: 6, BLOWS: 1, THN: 100, CLEVEL: 10, CDEPTH: 1, SPEED: 110 },
    );
    /* place the borg adjacent to the monster and mark the grid on-panel */
    ctx.world.self.c = { x: 20, y: 12 };
    ctx.world.kills.at(1).power = 30;
    ctx.world.kills.at(1).awake = true;
    ctx.world.map.at(21, 12).info |= 0x20; /* BORG_VIEW, as perceive sets it: nothing sets BORG_OKAY */
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    const cmd = borgAttack(ctx);
    expect(cmd).not.toBeNull();
    expect(cmd!.code).toBe("walk");
  });
});

describe("borgAttack through perceive", () => {
  it("targets a monster the borg perceives, with the grid flags play really sets", async () => {
    /* No hand-set flags: the world is built by perceive, as in play. */
    const { BorgWorld } = await import("../world/model.js");
    const { perceive, makePerceiveMemo } = await import("../perceive.js");
    const { makeScenarioView, makeFakeActions } = await import("../harness.js");
    const { makeBorgRng } = await import("../rng.js");
    const { borgNotice, BI: TBI } = await import("../trait/index.js");
    const world = new BorgWorld();
    const view = makeScenarioView({ player: { grid: { x: 20, y: 12 } }, monsters: [{ grid: { x: 21, y: 12 } }] });
    const ctx = { world, view, act: makeFakeActions(), rng: makeBorgRng() };
    borgNotice(ctx as never);
    perceive(world, view, makePerceiveMemo());
    for (const [k, v] of Object.entries({ WDD: 2, WDS: 6, BLOWS: 1, THN: 100, CLEVEL: 10, CDEPTH: 1, SPEED: 110 })) world.self.trait[TBI[k as keyof typeof TBI]] = v;
    world.kills.at(1).power = 30;
    world.kills.at(1).awake = true;
    getDangerGlobals(world).resolveFacts = () => facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    expect(world.map.at(21, 12).info & 0x08).toBe(0); /* BORG_OKAY really is never set */
    const cmd = borgAttack(ctx as never);
    expect(cmd).not.toBeNull();
    expect(cmd!.code).toBe("walk");
  });
});

describe("borgCaution (caution.c:799)", () => {
  it("healthy, no monsters -> null (nothing to do)", () => {
    const ctx = makeCtx({}, { CURHP: 50, MAXHP: 50, CLEVEL: 20, CDEPTH: 5 });
    expect(borgCaution(ctx, makeFlowState())).toBeNull();
  });

  /* THE STALL THIS BLOCK EXISTS TO END. Every other ladder stage flows toward a
   * staircase and sets stairLess / stairMore; caution.c:1169 is the only place
   * that spends a turn on one. While it was missing, the borg walked onto an up
   * staircase, ran out of flow, explored one step off it, and was pulled back --
   * for as long as anybody left it running. */
  it("takes an up staircase it is standing on while leaving (caution.c:1169)", () => {
    const ctx = makeCtx(
      { cells: { "20,12": { feat: FEAT.LESS } }, player: { grid: { x: 20, y: 12 } } },
      { CURHP: 50, MAXHP: 50, CLEVEL: 20, CDEPTH: 5 },
    );
    /* Past the 200-turn restock grace (caution.c:1064), so the restock arm runs
     * and normalises readyMorgoth from -1 to 0 - which is what the stair choice
     * below tests for. Asserting the chain rather than hand-setting the flag: the
     * flag staying at -1 was the whole defect. */
    ctx.world.clock = 500;
    ctx.world.self.goal.leaving = true;
    const cmd = borgCaution(ctx, makeFlowState());
    expect(ctx.world.self.readyMorgoth).toBe(0);
    expect(cmd?.code).toBe("ascend");
    expect(ctx.world.self.stairLess).toBe(true);
  });

  it("takes a down staircase it is standing on while leaving (caution.c:1188)", () => {
    const ctx = makeCtx(
      { cells: { "20,12": { feat: FEAT.MORE } }, player: { grid: { x: 20, y: 12 } } },
      { CURHP: 50, MAXHP: 50, CLEVEL: 20, CDEPTH: 5 },
    );
    ctx.world.self.goal.leaving = true;
    const cmd = borgCaution(ctx, makeFlowState());
    expect(cmd?.code).toBe("descend");
  });

  it("prefers up over down when there is an up stair and the borg is hungry", () => {
    /* caution.c:1148: "don't go down if we can go up and are hungry". The gate
     * is track_less being non-empty, so a flow state that knows an up stair is
     * what makes the branch reachable at all. */
    const flow = makeFlowState();
    flow.less.add(4, 4);
    const ctx = makeCtx(
      { cells: { "20,12": { feat: FEAT.MORE } }, player: { grid: { x: 20, y: 12 } } },
      { CURHP: 50, MAXHP: 50, CLEVEL: 20, CDEPTH: 5, ISHUNGRY: 1 },
    );
    ctx.world.self.goal.leaving = true;
    expect(borgCaution(ctx, flow)).toBeNull();
    expect(ctx.world.self.stairMore).toBe(false);
  });

  it("does not touch a staircase when it has no reason to leave", () => {
    const ctx = makeCtx(
      { cells: { "20,12": { feat: FEAT.MORE } }, player: { grid: { x: 20, y: 12 } } },
      { CURHP: 50, MAXHP: 50, CLEVEL: 20, CDEPTH: 5 },
    );
    expect(borgCaution(ctx, makeFlowState())).toBeNull();
  });
});

/*
 * *** Back away *** (caution.c:1664). Borg's entire short-range tactical
 * retreat, and for a long stretch it was not ported at all: caution ran, found
 * no escape item, and returned null, after which the ladder went straight to
 * attack. A first-level character with an adjacent monster and no phase door
 * therefore had exactly one move available, and made it every time, which is
 * how a fresh character dies to an ordinary town rogue.
 *
 * The corridor is not incidental to the scenario. Upstream latches
 * adjacent_monster once and never clears it, so a single candidate square that
 * sits next to the monster kills the whole search - and in open floor next to
 * an adjacent monster, the first candidate always does. Backing away is a
 * corridor manoeuvre in practice. That is upstream 4.2.6, warts kept.
 */
describe("borgBackAway (caution.c:1664)", () => {
  /** Borg at (10,3) in a one-square-high corridor, a monster at (11,3). */
  function corridor(): BorgContext {
    const cells: Record<string, { feat: number }> = {};
    for (let x = 1; x < 19; x++) cells[`${String(x)},3`] = { feat: FEAT.FLOOR };
    const ctx = makeCtx(
      {
        width: 20,
        height: 7,
        floorFeat: FEAT.GRANITE,
        cells,
        player: { grid: { x: 10, y: 3 } },
        monsters: [{ grid: { x: 11, y: 3 } }],
      },
      /* LIGHT matters: an unlit borg is "nasty" (caution.c:810) and nasty
       * refuses to give up a square, so a scenario without it tests nothing. */
      { CURHP: 20, MAXHP: 20, CLEVEL: 1, MAXCLEVEL: 1, CDEPTH: 1, SPEED: 110, LIGHT: 1 },
    );
    ctx.world.self.c = { x: 10, y: 3 };
    /* Past the anti-summon quiet period (caution.c:1676) and short of the
     * 200-turn restock grace (caution.c:1064). */
    ctx.world.clock = 100;
    const k = ctx.world.kills.at(1);
    k.power = 30;
    k.awake = true;
    k.speed = 110;
    k.when = ctx.world.clock;
    ctx.world.map.at(11, 3).info |= 0x20; /* BORG_VIEW, as perceive sets it */
    getDangerGlobals(ctx.world).avoidance = 20;
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 3, sides: 6, effect: MONBLOW.HURT }] });
    return ctx;
  }

  it("steps away from an adjacent monster down a corridor", () => {
    const ctx = corridor();
    const cmd = borgCaution(ctx, makeFlowState());
    expect(cmd?.code).toBe("walk");
    /* Away from the monster, which is east: keypad 4 is west. */
    expect(cmd?.dir).toBe(4);
    expect(ctx.world.self.goal.g).toEqual({ x: 9, y: 3 });
  });

  it("stands its ground when the danger is not worth a step", () => {
    const ctx = corridor();
    /* caution.c:1670 - a nasty situation is no time to give up a square. */
    ctx.world.self.trait[BI.ISBLIND] = 1;
    expect(borgCaution(ctx, makeFlowState())).toBeNull();
  });

  it("stays put while the anti-summon corridor timer is running", () => {
    const ctx = corridor();
    /* caution.c:1676 - the Borg fought its way into this spot on purpose. */
    getFightState(ctx.world).tAntisummon = ctx.world.clock - 10;
    expect(borgCaution(ctx, makeFlowState())).toBeNull();
  });

  it("cannot predict where a step lands while confused", () => {
    const ctx = corridor();
    ctx.world.self.trait[BI.ISCONFUSED] = 1;
    expect(borgCaution(ctx, makeFlowState())).toBeNull();
  });
});


/** The same notice, perception and race-fact paths the controller uses. */
function defenseScenario(
  scenario: Scenario & { inventory?: ItemView[] } = {},
  spells: Spell[] = [],
  symbols: Record<number, string> = {},
  blows = 0,
) {
  const cls = scenario.player?.cls ?? "Mage";
  const ratings = ratingsForClass(classIndexFromName(cls))!;
  const book: SpellbookView = {
    name: "defence book", tval: TV.MAGIC_BOOK, realm: "arcane",
    spells: spells.map((spell) => ({
      name: Spell[spell], sidx: ratings.findIndex((r) => r.spell === spell), bidx: 0,
      level: 1, mana: 1, fail: 0, learned: true, worked: true, forgotten: false,
      studyEligible: false, infoLine: "",
    })),
  };
  const world = new BorgWorld();
  const base = makeScenarioView({ width: 80, ...scenario, player: {
    grid: { x: 20, y: 12 }, depth: 50, level: 50, maxLevel: 50,
    hp: 1000, maxHp: 1000, sp: 200, maxSp: 200, stats: [118, 118, 118, 118, 118],
    ...scenario.player, cls,
  } });
  const view = { ...base, spellbooks: () => [book], inventory: () => [
    item({ handle: 99, tval: TV.MAGIC_BOOK, sval: 1 }), ...(scenario.inventory ?? []),
  ] };
  const act = makeFakeActions();
  const resolvers = makeCoreResolvers({ raceRecord: (ridx) => ({
    ridx, dChar: symbols[ridx], flags: new Set(view.monsters().find((m) => m.raceIndex === ridx)?.raceFlags),
    level: 1, sleep: 0, spellPower: 0, freqInnate: 0, freqSpell: 0, hasFriends: false,
    blows: blows ? [{ dice: blows, sides: 100, effect: "HURT" }] : [], spells: [],
  }) });
  const ctx: BorgContext = { world, view, act, rng: makeBorgRng(), bookKind: () => ({ tval: TV.MAGIC_BOOK, sval: 1 }) };
  installThinkSession(world, buildThinkSession(resolvers));
  borgNotice(ctx);
  const memo = makePerceiveMemo();
  perceive(world, view, memo, undefined, undefined, (i) => resolvers.resolveMonsterFacts!(ctx, i).dChar);
  getDangerGlobals(world).resolveFacts = resolvers.resolveMonsterFacts!;
  getDangerGlobals(world).avoidance = 100;
  borgNearMonsterType(ctx, 20);
  return { ctx, act, book, memo, view };
}

function defenseScore(ctx: BorgContext, maneuver: BD, danger = 0, simulate = true): number {
  const fs = getFightState(ctx.world);
  fs.simulate = simulate;
  fs.pending = null;
  return borgCalculateDefenseEffectiveness(ctx, fs, maneuver, danger);
}

const morgoth: NonNullable<Scenario["monsters"]>[number] = {
  raceIndex: 99, race: "Morgoth, Lord of Darkness", grid: { x: 28, y: 12 },
  raceFlags: ["UNIQUE", "QUESTOR", "EVIL"], hp: 20000, maxHp: 20000,
};

describe("genocide defences through notice and perceive", () => {
  it("scores mass genocide at 120 percent danger, reads before casting, and forgets non-uniques across the level", () => {
    const { ctx } = defenseScenario({ monsters: [
      { raceIndex: 1, grid: { x: 21, y: 12 } }, morgoth,
      { raceIndex: 2, grid: { x: 50, y: 12 } },
    ], inventory: [item({ handle: 7, tval: TV.SCROLL, sval: SVAL.scroll.mass_banishment! })] }, [Spell.MASS_BANISHMENT], {}, 100);
    expect(defenseScore(ctx, BD.MASS_GENOCIDE, 119)).toBe(0);
    expect(defenseScore(ctx, BD.MASS_GENOCIDE, 120)).toBe(117);
    expect([...ctx.world.kills.entries()]).toHaveLength(3);
    expect(borgDefend(ctx, 120)).toEqual({ code: "read", args: { handle: 7 } });
    expect([...ctx.world.kills.entries()].map(([, k]) => k.rIdx)).toEqual([99]);
    expect(ctx.world.map.at(21, 12).kill).toBe(0);
    expect(ctx.world.map.at(50, 12).kill).toBe(0);
  });

  it("rejects lethal mass-genocide strain and discounts a crowd during the Morgoth fight", () => {
    const monsters = Array.from({ length: 9 }, (_, i) => ({ grid: { x: 21 + i, y: 12 } }));
    const { ctx } = defenseScenario({ monsters }, [Spell.MASS_BANISHMENT], {}, 100);
    getFightState(ctx.world).fightingUnique = 10;
    expect(defenseScore(ctx, BD.MASS_GENOCIDE, 120)).toBe(104);
    ctx.world.self.trait[BI.CURHP] = 32;
    expect(defenseScore(ctx, BD.MASS_GENOCIDE, 120)).toBe(0);
  });

  it("banishes a distant level threat by default symbol and preserves uniques sharing it", () => {
    const { ctx } = defenseScenario({ player: { hp: 500, maxHp: 500 }, monsters: [
      { raceIndex: 1, glyph: "!", grid: { x: 45, y: 12 } },
      { raceIndex: 2, raceFlags: ["UNIQUE"], grid: { x: 46, y: 12 } },
    ], inventory: [item({ handle: 7, tval: TV.SCROLL, sval: SVAL.scroll.banishment! })] }, [Spell.BANISHMENT], { 1: "o", 2: "o" }, 100);
    expect(defenseScore(ctx, BD.GENOCIDE)).toBe(2000);
    expect(borgDefend(ctx, 0)).toEqual({ code: "read", args: { handle: 7, tgtsymbol: "o" } });
    expect([...ctx.world.kills.entries()].map(([, k]) => k.rIdx)).toEqual([2]);
  });

  it("subtracts both fear caches before the immediate-danger gates and keeps the C's <= gate", () => {
    const { ctx } = defenseScenario({ monsters: [
      { raceIndex: 1, grid: { x: 21, y: 12 } },
      { raceIndex: 2, grid: { x: 20, y: 13 } },
    ] }, [Spell.BANISHMENT], { 1: "a", 2: "b" }, 100);
    expect(defenseScore(ctx, BD.GENOCIDE, 3000)).toBe(1000);
    const fear = getFearCaches(ctx.world);
    fear.region2d[1]![1] = 100;
    fear.monsters2d[12]![20] = 200;
    expect(defenseScore(ctx, BD.GENOCIDE, 3000)).toBe(700);
    ctx.world.kills.delete(2);
    expect(defenseScore(ctx, BD.GENOCIDE, 3000)).toBe(0);
    ctx.world.self.trait[BI.CURHP] = 75;
    expect(defenseScore(ctx, BD.GENOCIDE, 3000)).toBe(0);
  });

  it("counts nasties once, keeps historical counts, chooses the last qualifying symbol, and resets only that count", () => {
    const { ctx, memo } = defenseScenario({ monsters: Array.from({ length: 10 }, (_, i) => ({
      raceIndex: 1, grid: { x: 30 + i, y: 12 },
    })) }, [Spell.BANISHMENT], { 1: "D" });
    borgNearMonsterType(ctx, 20);
    perceive(ctx.world, ctx.view, memo, undefined, undefined, () => "D");
    expect(ctx.world.facts.nastiesCount).toEqual([25, 0, 0, 0, 0, 0, 10]);
    ctx.world.kills.delete(1);
    expect(defenseScore(ctx, BD.GENOCIDE_NASTIES)).toBe(10);
    expect(borgDefend(ctx, 0)).toEqual({ code: "cast", args: { spell: 27, tgtsymbol: "D" } });
    expect(ctx.world.facts.nastiesCount).toEqual([25, 0, 0, 0, 0, 0, 0]);
    expect([...ctx.world.kills.entries()]).toHaveLength(0);
    expect(defenseScore(ctx, BD.GENOCIDE_NASTIES, 26)).toBe(0);
    expect(defenseScore(ctx, BD.GENOCIDE_NASTIES, 25, false)).toBe(10);
    expect(getFightState(ctx.world).pending?.args?.tgtsymbol).toBe("Z");
  });

  it("uses banishment for assumed hounds through the production controller", () => {
    const { ctx, view, act } = defenseScenario({ player: { depth: 100 }, monsters: [morgoth] }, [Spell.BANISHMENT]);
    const borg = createBorg({ resolvers: {
      bookKind: ctx.bookKind,
      resolveMonsterFacts: getDangerGlobals(ctx.world).resolveFacts,
    } });
    expect(borg.controller(view, act)).toEqual({ code: "cast", args: { spell: 27, tgtsymbol: "Z" } });
    expect(borg.world.facts.nastiesCount[0]).toBe(0);
  });

  it.each([BI.ISBLIND, BI.ISCONFUSED, BI.ISFORGET])("rejects genocide manoeuvres under status %s", (status) => {
    const { ctx } = defenseScenario({}, [Spell.BANISHMENT, Spell.MASS_BANISHMENT]);
    ctx.world.self.trait[status] = 1;
    for (const maneuver of [BD.GENOCIDE, BD.MASS_GENOCIDE, BD.GENOCIDE_NASTIES]) expect(defenseScore(ctx, maneuver, 120)).toBe(0);
  });
});

describe("Morgoth defences through notice and perceive", () => {
  it("scores teleport-away, targets the remembered grid, and requires ten glyphs", () => {
    const { ctx, act } = defenseScenario({ player: { depth: 100 }, monsters: [morgoth], inventory: [
      item({ tval: TV.SCROLL, sval: SVAL.scroll.rune_of_protection!, number: 10 }),
    ] }, [Spell.TELEPORT_OTHER]);
    expect(defenseScore(ctx, BD.TELE_AWAY_MORGOTH)).toBe(100);
    expect(act.targets).toEqual([]);
    expect(borgDefend(ctx, 0)).toEqual({ code: "cast", args: { spell: 15 } });
    expect(act.targets).toEqual([{ x: 28, y: 12 }]);
    expect(getFightState(ctx.world).successfulTarget).toBe(-1);
    expect(getFightState(ctx.world).tempN).toBe(0);
    expect(getDangerGlobals(ctx.world).tpOtherIndices).toEqual([]);
    ctx.world.self.trait[BI.AGLYPH] = 9;
    expect(defenseScore(ctx, BD.TELE_AWAY_MORGOTH)).toBe(0);
  });

  it("uses the glyph and low-mana teleport values in C order", () => {
    const { ctx } = defenseScenario({ player: { depth: 100 }, monsters: [morgoth], inventory: [
      item({ tval: TV.SCROLL, sval: SVAL.scroll.rune_of_protection!, number: 10 }),
    ] }, [Spell.TELEPORT_OTHER]);
    ctx.world.map.at(29, 12).glyph = true;
    getDangerGlobals(ctx.world).morgothPosition = true;
    expect(defenseScore(ctx, BD.TELE_AWAY_MORGOTH)).toBe(300);
    ctx.world.self.trait[BI.CURSP] = 35;
    expect(defenseScore(ctx, BD.TELE_AWAY_MORGOTH)).toBe(150);
  });

  it("scores crowded banishment at 1500, counts close monsters twice, and casts mass before evil", () => {
    const { ctx } = defenseScenario({ player: { depth: 100 }, monsters: [morgoth,
      ...Array.from({ length: 4 }, (_, i) => ({ grid: { x: 22 + i, y: 13 } })),
    ] }, [Spell.MASS_BANISHMENT]);
    expect(defenseScore(ctx, BD.BANISHMENT_MORGOTH)).toBe(1500);
    expect([...ctx.world.kills.entries()]).toHaveLength(5);
    expect(defenseScore(ctx, BD.BANISHMENT_MORGOTH, 0, false)).toBe(1000);
    expect(getFightState(ctx.world).pending).toEqual({ code: "cast", args: { spell: 28 } });
    expect([...ctx.world.kills.entries()].map(([, k]) => k.rIdx)).toEqual([99]);
  });

  it("requires more than seven weighted targets and filters non-evil monsters for banish evil", () => {
    const { ctx } = defenseScenario({ player: { cls: "Priest", depth: 100 }, monsters: [morgoth,
      ...Array.from({ length: 3 }, (_, i) => ({ grid: { x: 22 + i, y: 13 } })),
    ] }, [Spell.BANISH_EVIL]);
    expect(defenseScore(ctx, BD.BANISHMENT_MORGOTH)).toBe(0);
  });

  it("lights a dark path to Morgoth using the tracked position, with 500 simulation and 200 execution values", () => {
    const { ctx, act } = defenseScenario({ player: { cls: "Priest", depth: 100 }, monsters: [morgoth],
      cells: { "24,12": { known: false, inView: false } },
    }, [Spell.SPEAR_OF_LIGHT, Spell.CLAIRVOYANCE]);
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH)).toBe(0);
    getDangerGlobals(ctx.world).morgothPosition = true;
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH)).toBe(500);
    expect(act.targets).toEqual([]);
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH, 0, false)).toBe(200);
    expect(getFightState(ctx.world).pending).toEqual({ code: "cast", args: { spell: 7 } });
    expect(act.targets).toEqual([{ x: 28, y: 12 }]);
    ctx.world.map.at(24, 12).feat = FEAT.FLOOR;
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH)).toBe(0);
  });
});

describe("Orb of Draining (attack.c:3904)", () => {
  it.each([29, 30])("scores and casts the prayer at level %s", (level) => {
    const { ctx, act } = defenseScenario({ player: { cls: "Priest", level }, monsters: [
      { raceFlags: ["EVIL"], grid: { x: 25, y: 12 }, hp: 1000, maxHp: 1000 },
      { raceFlags: ["EVIL"], grid: { x: 25, y: 9 }, hp: 1000, maxHp: 1000 },
    ] }, [Spell.ORB_OF_DRAINING]);
    const fs = getFightState(ctx.world);
    fs.tempN = 1;
    fs.tempX[0] = 25;
    fs.tempY[0] = 12;
    const expected = level === 29 ? 106 : 136;
    expect(borgCalculateAttackEffectiveness(ctx, fs, BF.PRAYER_HOLY_ORB_BALL)).toBe(expected);
    expect(act.targets).toEqual([]);
    expect(borgAttack(ctx)).toEqual({ code: "cast", args: { spell: 6 } });
    expect(act.targets).toHaveLength(1);
    expect(act.targets[0]?.x).toBe(25);
  });
});

describe("floor destruction penalties through perceive (attack.c:1344)", () => {
  it.each([
    [BA.ACID, TV.BOOTS, 0, false, 20], [BA.ACID, TV.BOOTS, 0, true, 0],
    [BA.FIRE, TV.BOOTS, 0, false, 20], [BA.FIRE, TV.BOOTS, 0, true, 0],
    [BA.ELEC, TV.RING, SVAL.ring.speed!, false, 20], [BA.ELEC, TV.RING, SVAL.ring.speed!, true, 2000],
    [BA.COLD, TV.POTION, SVAL.potion.healing!, true, 2000],
    [BA.COLD, TV.POTION, SVAL.potion.star_healing!, true, 2000],
    [BA.COLD, TV.POTION, SVAL.potion.life!, true, 2000],
    [BA.COLD, TV.POTION, SVAL.potion.cure_light!, false, 2000],
    [BA.COLD, TV.POTION, SVAL.potion.cure_light!, true, 20],
    [BA.MANA, TV.POTION, SVAL.potion.life!, true, 0],
  ])("applies %s to tval %s sval %s aware %s with penalty %s", (type, tval, sval, aware, penalty) => {
    const { ctx } = defenseScenario({ monsters: [{ grid: { x: 25, y: 12 }, hp: 10000, maxHp: 10000 }],
      floor: { "25,12": [item({ tval: Number(tval), sval: Number(sval), aware: Boolean(aware) })] },
    });
    const fs = getFightState(ctx.world);
    fs.tempN = 1;
    fs.tempX[0] = 25;
    fs.tempY[0] = 12;
    const score = borgLaunchBolt(ctx, fs, 2, 3000, Number(type), 20, null);
    expect(score).toBe(3000 - Number(penalty));
  });

  it.each(["inc_str", "inc_int", "inc_wis", "inc_dex", "inc_con"] as const)("protects %s only while the stat needs raising", (stat) => {
    const { ctx } = defenseScenario({ monsters: [{ grid: { x: 25, y: 12 }, hp: 10000, maxHp: 10000 }],
      floor: { "25,12": [item({ tval: TV.POTION, sval: SVAL.potion[stat]!, aware: true })] },
    });
    const fs = getFightState(ctx.world);
    fs.tempN = 1;
    fs.tempX[0] = 25;
    fs.tempY[0] = 12;
    expect(borgLaunchBolt(ctx, fs, 2, 3000, BA.COLD, 20, null)).toBe(2980);
    getDerived(ctx.world).needStatgain[["inc_str", "inc_int", "inc_wis", "inc_dex", "inc_con"].indexOf(stat)] = true;
    expect(borgLaunchBolt(ctx, fs, 2, 3000, BA.COLD, 20, null)).toBe(1000);
  });
});


describe("banishment action order", () => {
  function activation(ctx: BorgContext) {
    ctx.view = { ...ctx.view, equipment: () => [item({ handle: 42, tval: TV.RING, sval: 1, activation: true })] };
    installThinkSession(ctx.world, buildThinkSession(makeCoreResolvers({ objects: {
      lookupKind: () => ({ activation: { name: "BANISHMENT" } }),
      findEgo: () => null, findArtifact: () => null,
    } })));
  }

  it("uses the mass-genocide activation ahead of its spell", () => {
    const { ctx } = defenseScenario({ monsters: [{ grid: { x: 21, y: 12 } }] }, [Spell.MASS_BANISHMENT], {}, 100);
    activation(ctx);
    expect(defenseScore(ctx, BD.MASS_GENOCIDE, 120, false)).toBe(117);
    expect(getFightState(ctx.world).pending).toEqual({ code: "activate", args: { handle: 42 } });
  });

  it.each([true, false])("prefers a genocide spell to its activation when spell=%s", (spell) => {
    const { ctx } = defenseScenario({ player: { hp: 500, maxHp: 500 }, monsters: [
      { grid: { x: 45, y: 12 } },
    ] }, spell ? [Spell.BANISHMENT] : [], { 1: "o" }, 100);
    activation(ctx);
    expect(defenseScore(ctx, BD.GENOCIDE, 0, false)).toBe(2000);
    expect(getFightState(ctx.world).pending).toEqual(spell
      ? { code: "cast", args: { spell: 27, tgtsymbol: "o" } }
      : { code: "activate", args: { handle: 42, tgtsymbol: "o" } });
  });

  it.each([true, false])("prefers a nasty activation to its staff and spell when activation=%s", (worn) => {
    const { ctx } = defenseScenario({ player: { skills: [0, 0, 100, 0, 0, 0, 0, 0, 0, 0] }, inventory: [
      item({ handle: 8, tval: TV.STAFF, sval: SVAL.staff.banishment!, pval: 1 }),
    ] }, [Spell.BANISHMENT]);
    if (worn) activation(ctx);
    expect(defenseScore(ctx, BD.GENOCIDE_NASTIES, 0, false)).toBe(10);
    expect(getFightState(ctx.world).pending).toEqual(worn
      ? { code: "activate", args: { handle: 42, tgtsymbol: "Z" } }
      : { code: "use-staff", args: { handle: 8, tgtsymbol: "Z" } });
  });

  it("uses a staff when no other genocide source exists", () => {
    const { ctx } = defenseScenario({ player: { hp: 500, maxHp: 500, skills: [0, 0, 100, 0, 0, 0, 0, 0, 0, 0] },
      monsters: [{ grid: { x: 45, y: 12 } }], inventory: [
        item({ handle: 8, tval: TV.STAFF, sval: SVAL.staff.banishment!, pval: 1 }),
      ],
    }, [], { 1: "o" }, 100);
    expect(defenseScore(ctx, BD.GENOCIDE, 0, false)).toBe(2000);
    expect(getFightState(ctx.world).pending).toEqual({ code: "use-staff", args: { handle: 8, tgtsymbol: "o" } });
  });
});


describe("defence boundaries from the C", () => {
  it.each([
    [{ hp: 249, maxHp: 250, depth: 25 }, 0, 0],
    [{ hp: 250, maxHp: 250, depth: 25 }, 25, 10],
    [{ hp: 250, maxHp: 250, depth: 24 }, 0, 0],
    [{ hp: 699, maxHp: 1000, depth: 25 }, 0, 0],
    [{ hp: 700, maxHp: 1000, depth: 25 }, 0, 10],
    [{ hp: 700, maxHp: 1000, depth: 25 }, 26, 0],
  ] as const)("scores nasty health/depth %o at danger %s as %s", (player, danger, value) => {
    const { ctx } = defenseScenario({ player }, [Spell.BANISHMENT]);
    expect(defenseScore(ctx, BD.GENOCIDE_NASTIES, danger)).toBe(value);
  });

  it("rejects a genocide level threat below 375 HP or at 75 monsters", () => {
    const low = defenseScenario({ player: { hp: 374, maxHp: 500 }, monsters: [
      { grid: { x: 45, y: 12 } },
    ] }, [Spell.BANISHMENT], { 1: "o" }, 100).ctx;
    expect(defenseScore(low, BD.GENOCIDE)).toBe(0);
    low.world.self.trait[BI.CURHP] = 375;
    expect(defenseScore(low, BD.GENOCIDE)).toBe(2000);
    const pit = defenseScenario({ monsters: Array.from({ length: 75 }, (_, i) => ({
      grid: { x: 45 + i % 20, y: 2 + Math.trunc(i / 20) },
    })) }, [Spell.BANISHMENT], { 1: "o" }, 100).ctx;
    expect(defenseScore(pit, BD.GENOCIDE)).toBe(0);
    pit.world.kills.delete(75);
    expect(defenseScore(pit, BD.GENOCIDE)).toBeGreaterThan(0);
  });

  it("casts banish evil on a crowd and preserves uniques while forgetting all other races", () => {
    const { ctx, book } = defenseScenario({ player: { cls: "Priest", depth: 100 }, monsters: [morgoth,
      ...Array.from({ length: 4 }, (_, i) => ({ raceIndex: 1, grid: { x: 22 + i, y: 13 }, raceFlags: ["EVIL"] })),
      { raceIndex: 2, grid: { x: 50, y: 12 } },
    ] }, [Spell.BANISH_EVIL]);
    expect(defenseScore(ctx, BD.BANISHMENT_MORGOTH)).toBe(1500);
    expect(borgDefend(ctx, 0)).toEqual({ code: "cast", args: { spell: book.spells[0]!.sidx } });
    expect([...ctx.world.kills.entries()].map(([, k]) => k.rIdx)).toEqual([99]);
  });

  it.each([Spell.CLAIRVOYANCE, Spell.FUME_OF_MORDOR])("uses Morgoth light fallback %s", (spell) => {
    const { ctx, book } = defenseScenario({ player: { cls: spell === Spell.CLAIRVOYANCE ? "Priest" : "Necromancer", depth: 100 },
      monsters: [morgoth], cells: { "24,12": { known: false, inView: false } },
    }, [spell]);
    getDangerGlobals(ctx.world).morgothPosition = true;
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH, 0, false)).toBe(200);
    expect(getFightState(ctx.world).pending).toEqual({ code: "cast", args: { spell: book.spells[0]!.sidx } });
    ctx.world.kills.at(1).pos.x = 25;
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH)).toBe(0);
    ctx.world.kills.at(1).pos.x = 28;
    ctx.world.kills.at(1).when = ctx.world.clock - 3;
    expect(defenseScore(ctx, BD.LIGHT_MORGOTH)).toBe(0);
  });
});
