import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentView, ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { makeScenarioView, makeFakeActions, type Scenario } from "./harness.js";
import { BorgWorld } from "./world/model.js";
import { perceive, makePerceiveMemo } from "./perceive.js";
import { borgNotice, BI, borgPrepared, borgRestock, resetBorgCfg, setBorgCfg } from "./trait/index.js";
import { makeBorgRng } from "./rng.js";
import { makeCoreResolvers } from "./resolvers.js";
import { buildThinkSession, primeSession, installThinkSession, getThinkSession } from "./think-session.js";
import { borgLeaveLevel, borgThinkDungeon, borgThinkDungeonLight } from "./think-ladder.js";
import { getFightState, borgRecall, borgCaution } from "./fight/index.js";
import { createBorg } from "./controller.js";
import { SVAL, TV } from "./item/index.js";
import { FEAT } from "./core-api.js";
import { createActFacade } from "./api2/act.js";
import { borgDanger, getDangerGlobals, getFearCaches } from "./danger/index.js";
import { createTick } from "./api2/controller.js";
import type { Bridge } from "./api2/host.js";
import { fakeGame } from "./harness-api2.js";
import { borgNearMonsterType } from "./perceive-facts.js";

afterEach(() => resetBorgCfg());

function item(over: Partial<ItemView>): ItemView {
  return {
    handle: 1, kindKey: "", aware: true, nameColor: "", label: "item", tval: TV.AMULET, sval: 1, pval: 0, number: 1, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0,
    inscription: null, ...over,
  };
}

function scenario(options: {
  player?: Scenario["player"];
  inventory?: ItemView[];
  equipment?: ItemView[];
  books?: SpellbookView[];
  home?: ItemView[];
  sellable?: boolean;
  monsters?: Scenario["monsters"];
  stairs?: boolean;
  age?: number;
} = {}) {
  const source = makeScenarioView({
    width: 22, height: 22,
    player: { grid: { x: 10, y: 10 }, level: 50, maxLevel: 50, depth: 5, maxDepth: 5, hp: 800, maxHp: 800, light: 3, speed: 130,
      stats: [118, 118, 118, 118, 118], ...options.player },
    cells: options.stairs === false ? {} : { "11,10": { feat: FEAT.LESS }, "10,11": { feat: FEAT.MORE } },
    monsters: options.monsters ?? [],
  });
  const inventory = options.inventory ?? [
    item({ handle: 10, tval: TV.SCROLL, sval: SVAL.scroll.word_of_recall!, number: 3 }),
    item({ handle: 11, tval: TV.FOOD, sval: SVAL.food.ration!, number: 10 }),
    item({ handle: 12, tval: TV.SCROLL, sval: SVAL.scroll.phase_door!, number: 5 }),
    item({ handle: 13, tval: TV.SCROLL, sval: SVAL.scroll.teleport!, number: 6 }),
    item({ handle: 14, tval: TV.POTION, sval: SVAL.potion.healing!, number: 5 }),
  ];
  const equipment = options.equipment ?? [item({ handle: 20, flags: ["SEE_INVIS", "FREE_ACT", "TELEPATHY", "PROT_CONF", "PROT_BLIND"],
    resists: ["FIRE", "COLD", "ACID", "ELEC", "POIS", "CHAOS", "DISEN"].map((element) => ({ element, level: 1 })) })];
  const view: AgentView = { ...source, inventory: () => inventory, equipment: () => equipment,
    spellbooks: () => options.books ?? [],
    stores: () => options.home ? [{ feat: 0, featName: "Home", isHome: true, owner: { name: "", purse: 0 },
      stock: options.home.map((gear, index) => ({ ...gear, index })) }] : [] };
  const world = new BorgWorld();
  world.clock = 1000;
  const ctx = { world, view, act: createActFacade().act, rng: makeBorgRng(),
    bookKind: (tval: number, name: string) => options.books?.some((book) => book.tval === tval && book.name === name) ? { tval, sval: 1 } : null };
  borgNotice(ctx);
  perceive(world, view, makePerceiveMemo());
  const session = buildThinkSession({ ...makeCoreResolvers({ objects: {
    lookupKind: () => null, findEgo: () => null, findArtifact: (name) => ({ activation: { name } }),
  } }), ...(options.sellable ? { loadoutPower: () => world.self.power } : {}) });
  installThinkSession(world, session);
  primeSession(session, ctx);
  session.flow.state.borgBegan = world.clock - (options.age ?? 0);
  getFightState(world).began = session.flow.state.borgBegan;
  return { ctx, world, session, inventory, leave: (bored = false) => borgLeaveLevel(ctx, session, bored),
    think: () => borgThinkDungeon(ctx, session), caution: () => borgCaution(ctx, session.flow.state) };
}

describe("town recall decisions", () => {
  it("crawls rather than recalling to an unstocked depth 100", () => {
    const s = scenario({ player: { depth: 0, maxDepth: 100 } });
    expect(borgPrepared(s.ctx, 60)).toBeNull();
    expect(borgRestock(s.ctx, 100)).not.toBeNull();
    expect(s.leave(true)?.code).toBe("walk");
    expect(s.world.self.goal.fleeing).toBe(true);
    expect(s.world.self.stairMore).toBe(true);
    setBorgCfg({ playsRisky: true });
    expect(s.leave(true)?.code).toBe("read");
    resetBorgCfg();
    for (const { age, heals, code } of [
      { age: 0, heals: 14, code: "walk" }, { age: 0, heals: 15, code: "read" }, { age: 10, heals: 14, code: "read" },
    ]) {
      const stocked = scenario({ player: { depth: 0, maxDepth: 100 }, age });
      stocked.inventory.push(item({ tval: TV.POTION, sval: SVAL.potion.star_healing!, number: heals }));
      borgNotice(stocked.ctx);
      expect(stocked.leave(true)?.code).toBe(code);
    }
  });

  it("lets risky play bypass town preparedness", () => {
    const s = scenario({ player: { depth: 0, maxDepth: 20, maxLevel: 10, level: 10 } });
    expect(s.leave(true)?.code).toBe("walk");
    setBorgCfg({ playsRisky: true });
    expect(s.leave(true)?.code).toBe("read");
  });

  it("waits until max depth 10 when worshipping gold", () => {
    setBorgCfg({ worshipsGold: true });
    for (const maxDepth of [8, 9, 10]) {
      const s = scenario({ player: { depth: 0, maxDepth } });
      expect(s.leave(true)?.code).toBe(maxDepth < 10 ? "walk" : "read");
    }
  });
});

describe("upward recall decisions", () => {
  it("leaves depth 100 only during the first ten turns when unprepared", () => {
    for (const age of [9, 10]) {
      const s = scenario({ player: { depth: 100, maxDepth: 100 }, age });
      expect(s.caution()?.code).toBe(age === 9 ? "walk" : undefined);
    }
  });

  it("uses level teleportation before stairs when unprepared on depth 100", () => {
    const scroll = scenario({ player: { depth: 100, maxDepth: 100 } });
    scroll.inventory.push(item({ handle: 42, tval: TV.SCROLL, sval: SVAL.scroll.teleport_level! }));
    expect(scroll.caution()).toEqual({ code: "read", args: { handle: 42 } });
    const activation = scenario({ player: { depth: 100, maxDepth: 100 },
      equipment: [item({ handle: 43, artifact: true, artifactName: "TELE_LEVEL", activation: true })] });
    expect(activation.caution()).toEqual({ code: "activate", args: { handle: 43 } });
  });
  it("gates rising recall at trip age 200", () => {
    for (const age of [200, 201]) {
      const s = scenario({ player: { depth: 9, maxDepth: 9, light: 1 }, age });
      s.world.self.goal.rising = true;
      expect(s.leave()?.code).toBe(age === 200 ? "walk" : "read");
    }
  });

  it("includes time spent on previous dungeon levels", () => {
    const s = scenario({ player: { depth: 9, maxDepth: 9, light: 1 } });
    s.world.self.goal.rising = true;
    getFightState(s.world).timeTown = 201;
    expect(s.leave()?.code).toBe("read");
  });

  it("recalls immediately for restocking after the 100-turn level grace", () => {
    const s = scenario({ age: 100 });
    s.inventory.splice(1, 1);
    borgNotice(s.ctx);
    expect(s.leave()?.code).toBe("read");
  });

  it("walks up from depth 100 when unprepared for 99", () => {
    const s = scenario({ player: { depth: 100, maxDepth: 100 }, age: 201 });
    s.world.self.goal.rising = true;
    expect(borgPrepared(s.ctx, 99)).not.toBeNull();
    expect(s.leave()?.code).toBe("walk");
  });

  it("recalls from a shallow level after 1000 turns without up stairs", () => {
    const s = scenario({ player: { depth: 3, maxDepth: 3, light: 1, level: 2, maxLevel: 2 }, stairs: false, age: 1000 });
    s.world.self.goal.rising = true;
    expect(s.leave(true)?.code).toBe("read");
  });

  it("stays on depth 1 for 200 turns to rotate shops", () => {
    const s = scenario({ player: { depth: 1, maxDepth: 1, light: 1, level: 11, maxLevel: 11 }, age: 199 });
    s.inventory.splice(4, 1);
    s.world.self.goal.rising = true;
    /* Low food keeps the stay-on-level limit above 200 turns for this character level. */
    s.world.self.trait[BI.FOOD] = 2;
    expect(s.leave(true)).toBeNull();
    s.world.clock += 1;
    expect(s.leave(true)?.code).toBe("walk");
  });

  it("returns after a long trip", () => {
    for (const age of [8000, 8001, 12001]) {
      const s = scenario({ player: { depth: 30, maxDepth: 30 }, age });
      s.leave(true);
      expect(s.world.self.goal.rising).toBe(age > 8000);
    }
  });

  it("returns after 3500 turns of shallow scumming", () => {
    const s = scenario({ player: { depth: 10, maxDepth: 20 }, age: 3501 });
    s.leave();
    expect(s.world.self.goal.rising).toBe(true);
  });

  it("recalls immediately to collect battle supplies from home", () => {
    const s = scenario({ player: { depth: 98, maxDepth: 100 },
      home: [item({ tval: TV.POTION, sval: SVAL.potion.star_healing!, number: 20 })] });
    s.inventory.push(item({ handle: 15, tval: TV.POTION, sval: SVAL.potion.star_healing!, number: 10 }));
    borgNotice(s.ctx);
    s.world.facts.vaultOnLevel = true;
    expect(borgPrepared(s.ctx, 98)).toBe("Collect from house (20 potions).");
    expect(s.leave()?.code).toBe("read");
  });

  it("returns to store battle potions", () => {
    const s = scenario({ player: { depth: 80, maxDepth: 99 } });
    s.inventory.push(item({ handle: 15, tval: TV.POTION, sval: SVAL.potion.star_healing!, number: 3 }));
    borgNotice(s.ctx);
    expect(s.world.self.trait[BI.PREP_BIG_FIGHT]).toBe(1);
    s.leave();
    expect(s.world.self.goal.rising).toBe(true);
  });

  it("climbs from 99 to scum after Sauron dies", () => {
    const s = scenario({ player: { depth: 99, maxDepth: 97, speed: 120 } });
    s.inventory.push(item({ handle: 15, tval: TV.POTION, sval: SVAL.potion.star_healing!, number: 30 }),
      item({ handle: 16, tval: TV.POTION, sval: SVAL.potion.speed!, number: 15 }));
    borgNotice(s.ctx);
    s.world.self.trait[BI.SAURON_DEAD] = 1;
    s.world.facts.uniqueOnLevel = 1;
    expect(s.leave()?.code).toBe("walk");
    expect(s.world.self.stairLess).toBe(true);
  });

  it.each([{ level: 14, gold: false }, { level: 25, gold: true }])("returns to sell without boredom: %j", ({ level, gold }) => {
    setBorgCfg({ worshipsGold: gold });
    const s = scenario({ player: { level, maxLevel: level }, sellable: true });
    for (let i = 0; i < 12; i++) s.inventory.push(item({ handle: 30 + i, tval: TV.CLOAK, value: 2000 }));
    s.leave();
    expect(s.world.self.goal.rising).toBe(true);
  });

  it("stops boredom and rising while Morgoth was recently seen", () => {
    const s = scenario({ player: { depth: 100, maxDepth: 100 } });
    s.inventory.push(item({ tval: TV.POTION, sval: SVAL.potion.star_healing!, number: 15 }));
    borgNotice(s.ctx);
    s.world.facts.morgothOnLevel = true;
    s.world.facts.vaultOnLevel = true;
    s.world.self.goal.rising = true;
    s.world.self.goal.leaving = true;
    s.leave(true);
    expect(s.world.self.goal.rising).toBe(false);
    expect(s.world.self.goal.leaving).toBe(false);
  });

  it("records a new Morgoth sighting before deciding whether to leave", () => {
    const s = scenario({ player: { depth: 100, maxDepth: 100 },
      monsters: [{ race: "Morgoth, Lord of Darkness", grid: { x: 11, y: 10 }, raceFlags: ["UNIQUE", "QUESTOR"] }] });
    s.world.clock = 7000;
    borgNearMonsterType(s.ctx, 20);
    expect(s.world.lastMorgoth).toBe(7000);
  });
});

describe("recall means and waiting", () => {
  it("rests 100 turns to recharge a recall rod", () => {
    const s = scenario();
    s.inventory.push(item({ handle: 42, tval: TV.ROD, sval: SVAL.rod.recall!, pval: 0 }));
    s.world.self.inShop = true;
    expect(s.think()).toEqual({ code: "rest", args: { count: 100 } });
    expect(s.world.self.inShop).toBe(false);
  });
  it("activates recall through the real session resolver", () => {
    const s = scenario({ equipment: [item({ handle: 42, artifact: true, artifactName: "RECALL", activation: true })] });
    expect(borgRecall(s.ctx)).toEqual({ code: "activate", args: { handle: 42 } });
  });

  it("short-circuits after the rod and leaves shopping goals alone", () => {
    const s = scenario();
    s.inventory.push(item({ handle: 43, tval: TV.ROD, sval: SVAL.rod.recall!, pval: 1 }));
    const read = vi.spyOn(s.ctx.act, "read");
    Object.assign(s.world.self.goal, { shop: 1, ware: 2, item: 3 });
    expect(borgRecall(s.ctx)).toEqual({ code: "zap-rod", args: { handle: 43 } });
    expect(read).not.toHaveBeenCalled();
    expect([s.world.self.goal.shop, s.world.self.goal.ware, s.world.self.goal.item]).toEqual([1, 2, 3]);
  });

  it("clears shopping goals after the recall scroll", () => {
    const s = scenario();
    Object.assign(s.world.self.goal, { shop: 1, ware: 2, item: 3 });
    expect(borgRecall(s.ctx)?.code).toBe("read");
    expect([s.world.self.goal.shop, s.world.self.goal.ware, s.world.self.goal.item]).toEqual([-1, -1, -1]);
  });

  it("rests 500 turns while safe in the dungeon", () => {
    const s = scenario();
    s.world.self.goal.recalling = 10000;
    expect(s.think()).toEqual({ code: "rest", args: { count: 500 } });
  });

  it("rests nine turns without light while recalling", () => {
    const s = scenario({ player: { light: 0 } });
    s.world.self.goal.recalling = 10000;
    expect(s.think()).toEqual({ code: "rest", args: { count: 9 } });
    expect(borgThinkDungeonLight(s.ctx, s.session)).toEqual({ code: "rest", args: { count: 9 } });
  });

  it("waits nine turns at the ladder tail when caution cannot rest", () => {
    const s = scenario({ inventory: [item({ tval: TV.FOOD, sval: SVAL.food.ration!, number: 10 })],
      player: { classFlags: ["COMBAT_REGEN"] }, stairs: false });
    s.world.self.goal.recalling = 10000;
    for (let y = 0; y < s.world.map.height; y++) {
      for (let x = 0; x < s.world.map.width; x++) s.world.map.at(x, y).feat = FEAT.PERM;
    }
    s.world.map.at(10, 10).feat = FEAT.FLOOR;
    expect(s.think()).toEqual({ code: "rest", args: { count: 9 } });
  });

  it("prepares for recall just before leaving town", () => {
    const books: SpellbookView[] = [{ tval: TV.NATURE_BOOK, realm: "nature", name: "haste book", spells: [
      { name: "Haste Self", sidx: 18, bidx: 0, level: 1, mana: 5, fail: 0,
        learned: true, worked: true, forgotten: false, studyEligible: false, infoLine: "" },
    ] }];
    const s = scenario({ player: { cls: "Druid", depth: 0, sp: 100, maxSp: 100 }, books });
    s.inventory.push(item({ handle: 42, tval: TV.NATURE_BOOK, sval: 1 }));
    s.world.self.goal.recalling = s.world.self.gameRatio * 2;
    expect(s.caution()).toEqual({ code: "cast", args: { spell: 18 } });
    expect(s.world.self.noRestPrep).toBe(5000);
  });

  it.each([{ sidx: 10, name: "Protection from Evil", rest: 50000 },
    { sidx: 3, name: "Bless", rest: 11000 }, { sidx: 22, name: "Demon Bane", rest: 11000 }])(
    "prepares $name before town recall", ({ sidx, name, rest }) => {
      const books: SpellbookView[] = [{ tval: TV.PRAYER_BOOK, realm: "divine", name: "prayer book", spells: [
        { name, sidx, bidx: 0, level: 1, mana: 5, fail: 0,
          learned: true, worked: true, forgotten: false, studyEligible: false, infoLine: "" },
      ] }];
      const s = scenario({ player: { cls: "Priest", depth: 0, sp: 100, maxSp: 100 }, books });
      s.inventory.push(item({ handle: 42, tval: TV.PRAYER_BOOK, sval: 1 }));
      s.world.self.goal.recalling = s.world.self.gameRatio * 2;
      expect(s.caution()).toEqual({ code: "cast", args: { spell: sidx } });
      expect(s.world.self.noRestPrep).toBe(rest);
    });

  it.each([
    { hp: 800, tval: "scroll", sval: "phase_door", code: "read" },
    { hp: 800, tval: "potion", sval: "cure_light", code: "quaff" },
    { hp: 600, tval: "rod", sval: "healing", code: "zap-rod" },
  ] as const)("buys time during recall with $sval", ({ hp, tval, sval, code }) => {
    const gear = tval === "scroll" ? item({ handle: 42, tval: TV.SCROLL, sval: SVAL.scroll.phase_door! })
      : tval === "potion" ? item({ handle: 42, tval: TV.POTION, sval: SVAL.potion.cure_light! })
      : item({ handle: 42, tval: TV.ROD, sval: SVAL.rod.healing!, pval: 1 });
    const s = scenario({ player: { depth: 100, maxDepth: 100, hp }, inventory: [gear] });
    s.world.self.goal.recalling = 10000;
    s.world.self.goal.fleeing = true;
    getDangerGlobals(s.world).morgothPosition = true;
    getFearCaches(s.world).monsters2d[10]![10] = 3000;
    expect(borgDanger(s.ctx, 10, 10, 1, true, false)).toBeGreaterThan(hp * 2);
    expect(s.caution()).toEqual({ code, args: { handle: 42 } });
  });

  it("recalls from the caution rung when fleeing", () => {
    const s = scenario();
    s.world.self.goal.fleeing = true;
    expect(s.caution()).toEqual({ code: "read", args: { handle: 10 } });
    s.world.self.goal.fleeingToTown = true;
    expect(s.caution()).toBeNull();
  });
});

describe("forced level updates", () => {
  it("discards a reset request when a decision is retried", () => {
    const borg = createBorg();
    const view = makeScenarioView({ width: 1, height: 1, player: { depth: 0 } });
    borg.controller(view, makeFakeActions());
    borg.world.clock = 1801;
    borg.controller(view, makeFakeActions());
    expect(borg.world.resetLevel).toBe(true);
    borg.rewind();
    expect(borg.world.resetLevel).toBe(false);
    borg.controller(view, makeFakeActions());
    expect(borg.world.clock).toBe(1802);
  });
  it.each([12000, 25000])("re-explores and re-shops at clock %i", (clock) => {
    const borg = createBorg();
    const view = makeScenarioView({ player: { depth: 0 } });
    borg.controller(view, makeFakeActions());
    borg.world.clock = clock - 1;
    expect(borg.controller(view, makeFakeActions())?.code).toBe("hold");
    expect(borg.world.resetLevel).toBe(true);
    const session = getThinkSession(borg.world);
    session.storeMem.soldNum = 7;
    borg.world.map.at(100, 50).feat = FEAT.CLOSED;
    borg.world.self.timesTwitch = 100;
    borg.controller(view, makeFakeActions());
    expect(borg.world.clock).toBe(1000);
    expect(session.flow.state.borgBegan).toBe(1000);
    expect(session.storeMem.soldNum).toBe(0);
    expect(borg.world.map.at(100, 50).feat).toBe(FEAT.NONE);
    expect(borg.world.self.timesTwitch).toBeLessThan(100);
    expect(borg.world.resetLevel).toBe(false);
  });

  it("requests a reset only after the town and clock thresholds", () => {
    for (const { depth, age, reset } of [
      { depth: 0, age: 800, reset: false }, { depth: 0, age: 801, reset: true },
      { depth: 4, age: 27000, reset: false }, { depth: 4, age: 27001, reset: true },
    ]) {
      const s = scenario({ player: { depth, light: 1 }, inventory: [], stairs: false, age });
      s.world.clock = 1000 + age;
      s.session.flow.state.borgBegan = 1000;
      getFightState(s.world).began = 1000;
      s.world.map.wipe();
      for (let y = 0; y < s.world.map.height; y++) {
        for (let x = 0; x < s.world.map.width; x++) s.world.map.at(x, y).feat = FEAT.PERM;
      }
      s.world.map.at(10, 10).feat = FEAT.FLOOR;
      s.think();
      expect(s.world.resetLevel).toBe(reset);
    }
  });
});

describe("recall depth prompts", () => {
  it("discards the old depth answer before choosing another command", async () => {
    const s = scenario({ player: { depth: 0, maxDepth: 0 } });
    const borg = createBorg();
    borg.world.resetRecallDepth = true;
    borg.controller(s.ctx.view, createActFacade().act);
    const game = fakeGame();
    const tick = createTick({ setInput: () => undefined } as unknown as Bridge,
      { controller: borg.controller, rewind: borg.rewind });
    await tick(game.mod, game.input({ prompt: { kind: "confirm", promptId: 7, label: "Set recall depth to current depth?" } }));
    expect(game.answered).toEqual([{ promptId: 7, answer: false }]);
  });

  it.each([
    { depth: 40, maxDepth: 60, hunted: 40, live: 5, answer: true },
    { depth: 40, maxDepth: 60, hunted: 127, live: 0, answer: false },
    { depth: 35, maxDepth: 60, hunted: 40, live: 5, answer: false },
    { depth: 45, maxDepth: 60, hunted: 40, live: 5, answer: true },
    { depth: 40, maxDepth: 45, hunted: 40, live: 5, answer: false },
    { depth: 100, maxDepth: 110, hunted: 100, live: 5, answer: false },
    { depth: 100, maxDepth: 110, hunted: 100, live: 5, winner: true, answer: true },
    { depth: 40, maxDepth: 99, hunted: 40, live: 4, answer: false },
    { depth: 40, maxDepth: 99, hunted: 40, live: 5, answer: true },
    { depth: 80, maxDepth: 99, hunted: 80, live: 0, sauron: true, answer: true },
    { depth: 40, maxDepth: 99, hunted: 40, live: 0, munchkin: true, answer: true },
  ])("answers through the tick using the recall decision: %j", async (options) => {
    const s = scenario({ player: { depth: options.depth, maxDepth: options.maxDepth, winner: "winner" in options } });
    const borg = createBorg();
    borg.controller(s.ctx.view, createActFacade().act);
    const ctx = getThinkSession(borg.world).ctx!;
    borg.world.depthHuntedUnique = options.hunted;
    borg.world.liveUniques = options.live;
    borg.world.self.trait[BI.SAURON_DEAD] = Number("sauron" in options);
    borg.world.self.goal.fleeingMunchkin = "munchkin" in options;
    expect(borgRecall(ctx)).not.toBeNull();
    const game = fakeGame();
    const tick = createTick({ setInput: () => undefined } as unknown as Bridge,
      { controller: borg.controller, rewind: borg.rewind });
    await tick(game.mod, game.input({ prompt: { kind: "confirm", promptId: 7, label: "Set recall depth to current depth?" } }));
    expect(game.answered).toEqual([{ promptId: 7, answer: options.answer }]);
  });
});
