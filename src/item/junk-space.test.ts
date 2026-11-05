import { describe, expect, it } from "vitest";
import type { AgentView, ItemView, PlayerView } from "@rpgm-tools/neo-angband-core";
import type { BorgContext } from "../context.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import { BorgWorld } from "../world/model.js";
import { BI, CLASS_WARRIOR } from "../trait/trait-index.js";
import { FEAT } from "../core-api.js";
import { TV, SVAL } from "./svals.js";
import { borgDropHole, borgDropSlow, borgDumpQuiver } from "./junk-space.js";
import { borgWearRecharge } from "./item-wear.js";
import { borgFirstEmptyInventorySlot } from "../store/store.js";
import { borgView } from "../core-api.js";
import { buildThinkSession, buildItemDeps, getThinkSession, primeSession } from "../think-session.js";
import { borgThinkDungeon } from "../think-ladder.js";
import { borgNotice, borgPower } from "../trait/index.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { itemView, playerView } from "../api2/world.js";
import { knownWorld } from "../harness-api2.js";
import { makeCoreResolvers } from "../resolvers.js";
import { createBorg } from "../controller.js";
import { perItemValue } from "./deps.js";
import type { KnownItem } from "@rpgm-tools/neo-angband-mod-sdk";

function item(p: Partial<ItemView> = {}): ItemView {
  return { handle: 1, kindKey: "", aware: true, nameColor: "", label: "fixture",
    tval: TV.SWORD, sval: 1, pval: 0, number: 1, weight: 10, ac: 0, toA: 0,
    toH: 0, toD: 0, dd: 1, ds: 4, ego: false, artifact: false, flags: [],
    modifiers: [], brands: [], slays: [], resists: [], curses: [], egoName: null,
    artifactName: null, activation: false, timeout: 0, inscription: null, value: 0, ...p };
}

function context(inventory: ItemView[] = [], equipment: Array<ItemView | null> = [], quiver: ItemView[] = []): BorgContext {
  const world = new BorgWorld();
  world.self.c.x = 10;
  world.self.c.y = 10;
  world.self.power = 10000;
  world.map.at(10, 10).feat = FEAT.FLOOR;
  for (const [key, value] of Object.entries({ CDEPTH: 1, CLEVEL: 10, MAXDEPTH: 1,
    CURHP: 100, MAXHP: 100, SPEED: 109, FOOD: 10, CLASS: CLASS_WARRIOR, AMMO_TVAL: TV.ARROW })) {
    world.self.trait[BI[key as keyof typeof BI]] = value;
  }
  const base = makeScenarioView({ player: { grid: { x: 10, y: 10 } } });
  return { world, rng: makeBorgRng(), act: makeFakeActions(),
    view: Object.assign(base, { inventory: () => inventory, equipment: () => equipment, quiver: () => quiver }) };
}

describe("inventory space and weight rungs", () => {
  it("makes a full-pack hole by dropping the whole least-cost stack, breaking ties by total weight", () => {
    const light = item({ handle: 1, number: 2, weight: 5 });
    const heavy = item({ handle: 2, number: 3, weight: 10 });
    const ctx = context([light, heavy]);
    expect(borgDropHole(ctx, false, { packFull: true, dropEval: () => 10000 }))
      .toMatchObject({ code: "drop", args: { handle: 2, quantity: 3 } });
    expect(borgDropHole(ctx, false, { packFull: false, dropEval: () => 10000 })).toBeNull();
    ctx.world.map.at(10, 10).feat = FEAT.LESS;
    expect(borgDropHole(ctx, false, { packFull: true, dropEval: () => 10000 })).toBeNull();
  });

  it("retries desperately when only unidentified boots remain, but preserves artifacts, food and books", () => {
    const boots = { ...item({ handle: 4, tval: TV.BOOTS }), unknownRunes: true };
    const { ctx, session } = production(fullPack([item({ artifact: true }), item({ handle: 2, tval: TV.FOOD }), item({ handle: 3, tval: TV.MAGIC_BOOK }), boots]));
    expect(borgDropHole(ctx, false, buildItemDeps(session)))
      .toMatchObject({ code: "drop", args: { handle: 4, quantity: 1 } });
  });

  it("values retained power above sale price when making a hole", () => {
    const ctx = context([item({ handle: 1 }), item({ handle: 2, value: 1000 })]);
    expect(borgDropHole(ctx, false, { packFull: true, dropEval: (candidate) => candidate.handle === 1 ? 9000 : 9900 }))
      .toMatchObject({ code: "drop", args: { handle: 2 } });
  });

  it("uses the C danger exception only at full HP, and consumes useful food before dropping it", () => {
    const ctx = context([item({ tval: TV.FOOD, sval: SVAL.food.ration! })]);
    expect(borgDropHole(ctx, false, { packFull: true, danger: 60, dropEval: () => 10000 }))
      .toMatchObject({ code: "eat" });
    ctx.world.self.trait[BI.CURHP] = 99;
    expect(borgDropHole(ctx, false, { packFull: true, danger: 60, dropEval: () => 10000 })).toBeNull();
  });

  it("sheds one heavy item when slow, using simulated power, weight and greed", () => {
    const ctx = context([item({ handle: 8, number: 7, weight: 20 })]);
    expect(borgDropSlow(ctx, { dropEval: (_item, quantity) => quantity === 1 ? 9000 : 0 }))
      .toMatchObject({ code: "drop", args: { handle: 8, quantity: 1 } });
    expect(borgDropSlow(ctx, { dropEval: () => 0 })).toBeNull();
    ctx.world.self.trait[BI.SPEED] = 110;
    expect(borgDropSlow(ctx, { dropEval: () => 10000 })).toBeNull();
  });

  it("restricts weight shedding to dungeon decisions with low danger and ordinary play", () => {
    const ctx = context([item()]);
    expect(borgDropSlow(ctx, { danger: 6, dropEval: () => 10000 })).toBeNull();
    ctx.world.self.trait[BI.CDEPTH] = 0;
    expect(borgDropSlow(ctx, { dropEval: () => 10000 })).toBeNull();
    ctx.world.self.trait[BI.CDEPTH] = 1;
    ctx.world.self.munchkinMode = true;
    expect(borgDropSlow(ctx, { dropEval: () => 10000 })).toBeNull();
  });

  it("penalizes expensive weight loss but ignores prices below the C greed threshold", () => {
    const ctx = context([item({ value: 1000, weight: 5 })]);
    ctx.world.self.trait[BI.GOLD] = 100000;
    expect(borgDropSlow(ctx, { dropEval: () => 10000 })).toBeNull();
    ctx.world.self.trait[BI.GOLD] = 200000;
    expect(borgDropSlow(ctx, { dropEval: () => 10000 })).toMatchObject({ code: "drop" });
  });

  it("dumps a whole bad quiver stack, preserving good matching ammo", () => {
    const good = item({ handle: 5, tval: TV.ARROW, number: 20 });
    const bad = item({ handle: 6, tval: TV.ARROW, number: 13, toH: -1 });
    const ctx = context([good, bad], [], [good, bad]);
    expect(borgDumpQuiver(ctx)).toMatchObject({ code: "drop", args: { handle: 6, quantity: 13 } });
    expect(ctx.world.self.timeThisPanel).toBe(1);
    expect(borgDumpQuiver(context([good], [], [good]))).toBeNull();
    ctx.world.self.trait[BI.ISHUNGRY] = 1;
    expect(borgDumpQuiver(ctx)).toBeNull();
  });

  it("keeps quiver membership through the production view without duplicating ammo or pack slots", () => {
    const q = [item({ handle: 101, tval: TV.ARROW, number: 10 }), item({ handle: 102, tval: TV.ARROW, number: 10 })];
    const inventory = [...Array.from({ length: 21 }, (_, i) => item({ handle: i + 10 })), ...q];
    const host = Object.assign(makeScenarioView(), { inventory: () => inventory, quiver: () => q });
    const ctx = context();
    ctx.view = borgView(host);
    expect(ctx.view.quiver?.()).toEqual(q);
    expect(ctx.view.inventory()).toHaveLength(23);
    // Two quiver stacks occupy ONE pack slot; one of 23 pack slots is still free.
    expect(borgFirstEmptyInventorySlot(ctx)).toBe(21);
  });
});

/** The published item and player adapters feed notice, perception and loadout scoring. */
function production(
  inventory: Array<ItemView & { unknownRunes?: boolean }>,
  equipment: Array<ItemView | null> = [],
  quiver: ItemView[] = [],
  player: Partial<PlayerView> = {},
) {
  const base = makeScenarioView({ width: 3, height: 3, player: {
    grid: { x: 1, y: 1 }, depth: 1, maxDepth: 1, level: 20, maxLevel: 20,
    hp: 100, maxHp: 100, stats: [118, 118, 118, 118, 118], status: { image: 0, amnesia: 0, terror: 0 }, ...player,
  } });
  const known = knownWorld(base).player!;
  const adapt = (entry: ItemView & { unknownRunes?: boolean }) => {
    const { timeout, ...rest } = entry;
    return itemView({ ...rest, charging: timeout, unknownRunes: entry.unknownRunes ?? false,
      carried: true, baseName: entry.label } as KnownItem);
  };
  const items = inventory.map(adapt);
  const worn = equipment.map((entry) => entry === null ? null : adapt(entry));
  const missiles = quiver.map(adapt);
  const view: AgentView = { ...base, player: () => playerView(known, new Map()),
    inventory: () => items, equipment: () => worn, quiver: () => missiles,
    simulateLoadout: (change) => {
      const after = items.flatMap((entry) => {
        const release = change.release?.find((candidate) => candidate.handle === entry.handle);
        const number = entry.number - (release ? release.number ?? entry.number : 0);
        return number > 0 ? [{ ...entry, number,
          ...(entry.value === undefined ? {} : { value: Math.trunc(entry.value * number / entry.number) }) }] : [];
      });
      const equipment = [...worn];
      for (const slot of change.remove ?? []) {
        const removed = equipment[slot];
        if (removed) after.push(removed);
        equipment[slot] = null;
      }
      return { after: { player: view.player(), equipment, inventory: after } } as never;
    },
  };
  const ctx: BorgContext = { view: borgView(view), act: makeFakeActions(), rng: makeBorgRng(1), world: new BorgWorld() };
  ctx.world.clock = 1000;
  borgNotice(ctx);
  perceive(ctx.world, ctx.view, makePerceiveMemo());
  ctx.world.self.power = borgPower(ctx);
  const session = buildThinkSession(makeCoreResolvers({}));
  primeSession(session, ctx);
  return { ctx, session, view, items, worn, missiles };
}

function fullPack(candidates: ItemView[]): ItemView[] {
  return [...Array.from({ length: 23 - candidates.length }, (_, index) =>
    item({ handle: 100 + index, artifact: true, tval: TV.AMULET })), ...candidates];
}

describe("production inventory decisions", () => {
  it("keeps unidentified boots and unknown runes while choosing a whole known stack", () => {
    const boots = { ...item({ handle: 1, tval: TV.BOOTS }), unknownRunes: true };
    const sword = { ...item({ handle: 2 }), unknownRunes: true };
    const known = item({ handle: 3, tval: TV.CHEST, number: 2 });
    const { ctx, session } = production(fullPack([boots, sword, known]));
    const deps = buildItemDeps(session);
    expect(deps.isIdent!(ctx.view.inventory().find((entry) => entry.handle === 1)!)).toBe(false);
    expect(deps.needsIdent!(ctx.view.inventory().find((entry) => entry.handle === 2)!)).toBe(true);
    expect(deps.worthId!(ctx.view.inventory().find((entry) => entry.handle === 2)!)).toBe(true);
    expect(borgDropHole(ctx, false, deps)).toMatchObject({ code: "drop", args: { handle: 3, quantity: 2 } });
    const slow = production([boots, sword], [], [], { speed: 109 });
    expect(borgDropSlow(slow.ctx, buildItemDeps(slow.session))).toBeNull();
  });

  it("compares stack prices once for a hole and one item's price for slowness", () => {
    const stack = item({ handle: 1, tval: TV.CHEST, number: 10, value: 1000, weight: 2 });
    const single = item({ handle: 2, tval: TV.CHEST, value: 2000, weight: 2 });
    const hole = production(fullPack([stack, single]));
    expect(buildItemDeps(hole.session).itemValue!(hole.items.at(-2)!)).toBe(100);
    expect(borgDropHole(hole.ctx, false, buildItemDeps(hole.session)))
      .toMatchObject({ code: "drop", args: { handle: 1, quantity: 10 } });
    const slow = production([stack], [], [], { speed: 109 });
    expect(borgDropSlow(slow.ctx, buildItemDeps(slow.session)))
      .toMatchObject({ code: "drop", args: { handle: 1, quantity: 1 } });
  });

  it("applies the C unaware price and cursed-item zero before multiplying quantities", () => {
    const { ctx, session } = production([
      item({ aware: false, tval: TV.ROD, number: 4, value: 40000 }),
      item({ handle: 2, curses: ["fragility"], number: 2, value: 5000 }),
    ]);
    const values = ctx.view.inventory().map(buildItemDeps(session).itemValue!);
    expect(values).toEqual([90, 0]);
    expect(perItemValue(item({ number: 3, value: 100 }))).toBe(33);
  });

  it("uses the remaining missile count for the hole's preservation penalty", () => {
    const ammo = item({ handle: 1, tval: TV.ARROW, number: 40, value: 40, weight: 1 });
    const chest = item({ handle: 2, tval: TV.CHEST, value: 500000, weight: 1 });
    const bow = item({ handle: 9, tval: TV.BOW, sval: SVAL.bow.short_bow! });
    const { ctx, session } = production(fullPack([ammo, chest]), [null, bow]);
    expect(ctx.world.self.trait[BI.AMISSILES]).toBe(40);
    expect(borgDropHole(ctx, false, buildItemDeps(session))).toMatchObject({ code: "drop", args: { handle: 2 } });
  });

  it("counts quiver entries for power and weighted quantities for pack capacity", () => {
    const q = Array.from({ length: 5 }, (_, index) => item({ handle: index + 1, tval: TV.ARROW, number: 1 }));
    const five = production(q, [], q);
    const two = [item({ handle: 1, tval: TV.ARROW, number: 2 }), item({ handle: 2, tval: TV.ARROW, number: 3 })];
    const fewer = production(two, [], two);
    expect(five.ctx.world.self.trait[BI.QUIVER_SLOTS]).toBe(5);
    expect(five.ctx.world.self.power - fewer.ctx.world.self.power).toBe(-10000);
    const pack = fullPack([]).slice(0, 21);
    const capacity = production([...pack, ...two], [], two);
    expect(capacity.ctx.world.self.trait[BI.QUIVER_SLOTS]).toBe(2);
    expect(borgFirstEmptyInventorySlot(capacity.ctx)).toBe(21);
  });

  it("preserves unknown matching quiver runes and drops the earliest mismatched stack", () => {
    const matching = { ...item({ handle: 1, tval: TV.ARROW, number: 10, toH: -1 }), unknownRunes: true };
    const bad = item({ handle: 2, tval: TV.BOLT, number: 13 });
    const later = item({ handle: 3, tval: TV.SHOT, number: 7 });
    const bow = item({ handle: 9, tval: TV.BOW, sval: SVAL.bow.short_bow! });
    const { ctx, session } = production([matching, bad, later], [null, bow], [matching, bad, later]);
    expect(borgDumpQuiver(ctx, buildItemDeps(session))).toMatchObject({ code: "drop", args: { handle: 2, quantity: 13 } });
  });

  it("excludes quiver timeouts from recharge selection and requires a completed wear for R75", () => {
    const amulet = item({ handle: 7, tval: TV.AMULET, timeout: 10 });
    const ammo = item({ handle: 8, tval: TV.ARROW, timeout: 1 });
    const food = item({ handle: 9, tval: TV.FOOD, sval: SVAL.food.ration!, number: 5 });
    const { ctx, session, worn, items } = production([food, amulet, ammo], [], [ammo]);
    expect(borgWearRecharge(ctx, buildItemDeps(session))).toMatchObject({ code: "wield", args: { handle: 7 } });
    expect(session.rechargeRest).toBe(7);
    worn.push(items.splice(items.findIndex((entry) => entry.handle === amulet.handle), 1)[0]!);
    expect(borgThinkDungeon(ctx, session)).toMatchObject({ code: "rest" });
    expect(session.rechargeRest).toBe(false);
  });

  it("rewinds a speculative drop before a settled candidate wins through the controller", () => {
    const first = item({ handle: 1, tval: TV.CHEST, sval: 1, value: 2000 });
    const second = item({ handle: 2, tval: TV.CHEST, sval: 2, value: 1000 });
    const { view } = production(fullPack([first, second]));
    const simulate = view.simulateLoadout!;
    let settled = false;
    view.simulateLoadout = (change) => !settled && change.release?.[0]?.handle === 2 ? null : simulate(change);
    const borg = createBorg({ resolvers: makeCoreResolvers({}), rngSeed: 1 });
    const session = getThinkSession(borg.world);
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "drop", args: { handle: 1 } });
    expect(session.junked.size).toBe(1);
    borg.rewind();
    expect(session.junked.size).toBe(0);
    settled = true;
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "drop", args: { handle: 2 } });
    expect([...session.junked]).toEqual([`${TV.CHEST}:2`]);
  });

  it("rewinds the quiver rung's panel increment and discard memory before deciding again", () => {
    const ammo = item({ handle: 1, tval: TV.BOLT, number: 9 });
    const food = item({ handle: 2, tval: TV.FOOD, sval: SVAL.food.ration!, number: 5 });
    const weapon = item({ handle: 3 });
    const { view } = production([food, ammo], [weapon], [ammo]);
    const borg = createBorg({ resolvers: makeCoreResolvers({}), rngSeed: 1 });
    const session = getThinkSession(borg.world);
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "drop", args: { handle: 1, quantity: 9 } });
    expect(borg.world.self.timeThisPanel).toBe(2);
    borg.rewind();
    expect(borg.world.self.timeThisPanel).toBe(0);
    expect(session.junked.size).toBe(0);
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "drop", args: { handle: 1, quantity: 9 } });
    expect(borg.world.self.timeThisPanel).toBe(2);
  });

  it("refreshes a pending baseline after a speculative controller pass", () => {
    const { view } = production(fullPack([item({ handle: 1, tval: TV.CHEST, value: 1000 })]));
    const simulate = view.simulateLoadout!;
    let settled = false;
    view.simulateLoadout = (change) => Object.keys(change).length === 0 && !settled ? null : simulate(change);
    const borg = createBorg({ resolvers: makeCoreResolvers({}), rngSeed: 1 });
    expect(borg.controller(view, makeFakeActions())).not.toMatchObject({ code: "drop", args: { handle: 1 } });
    borg.rewind();
    settled = true;
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "drop", args: { handle: 1 } });
  });

  it("visits quiver entries after pack entries when weight-loss scores tie", () => {
    const ammo = item({ handle: 1, tval: TV.ARROW, weight: 1 });
    const chest = item({ handle: 2, tval: TV.CHEST, weight: 1 });
    const { ctx, session } = production([ammo, chest], [], [ammo], { speed: 109 });
    expect(borgDropSlow(ctx, buildItemDeps(session))).toMatchObject({ code: "drop", args: { handle: 1, quantity: 1 } });
  });

  it("uses the inventory listing order for tied hole candidates and permits foreign books", () => {
    const chest = item({ handle: 1, tval: TV.CHEST });
    const sword = item({ handle: 2 });
    const tied = production(fullPack([chest, sword]));
    expect(borgDropHole(tied.ctx, false, buildItemDeps(tied.session)))
      .toMatchObject({ code: "drop", args: { handle: 1 } });
    const book = item({ handle: 3, tval: TV.MAGIC_BOOK, nameColor: "slate" });
    const foreign = production(fullPack([book]));
    expect(borgDropHole(foreign.ctx, false, buildItemDeps(foreign.session)))
      .toMatchObject({ code: "drop", args: { handle: 3 } });
  });

  it("reaches worn recharge through the controller after the earlier inventory rungs yield", () => {
    const amulet = item({ handle: 7, tval: TV.AMULET, timeout: 10, value: 100 });
    const food = item({ handle: 8, tval: TV.FOOD, sval: SVAL.food.ration!, number: 5, value: 50 });
    const weapon = item({ handle: 9, value: 100 });
    const { view, worn, items } = production([food, amulet], [weapon]);
    const cell = view.cell;
    view.cell = (x, y) => {
      const grid = cell(x, y);
      return grid && (x !== 1 || y !== 1) ? { ...grid, feat: FEAT.PERM, passable: false } : grid;
    };
    const borg = createBorg({ resolvers: makeCoreResolvers({}), rngSeed: 1 });
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "wield", args: { handle: 7 } });
    const session = getThinkSession(borg.world);
    expect(session.rechargeRest).toBe(7);
    borg.rewind();
    expect(session.rechargeRest).toBe(false);
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "wield", args: { handle: 7 } });
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "wield", args: { handle: 7 } });
    worn.push(items.splice(items.findIndex((entry) => entry.handle === 7), 1)[0]!);
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "rest" });
    borg.rewind();
    expect(session.rechargeRest).toBe(7);
    expect(borg.controller(view, makeFakeActions())).toMatchObject({ code: "rest" });
    expect(session.rechargeRest).toBe(false);
  });
});

describe("borg_wear_recharge", () => {
  it("rests for 75 turns for an equipped activation and excludes torch fuel", () => {
    const ctx = context([], [item({ activation: true, timeout: 10 })]);
    let turns: number | undefined;
    ctx.act = { ...ctx.act, rest: (n) => { turns = n; return { code: "rest" }; } };
    expect(borgWearRecharge(ctx, { canRest: true })).toMatchObject({ code: "rest" });
    expect(turns).toBe(75);
    expect(borgWearRecharge(context([], [item({ tval: TV.LIGHT, sval: SVAL.light.torch!, timeout: 500 })]), { canRest: true })).toBeNull();
    expect(borgWearRecharge(context([], [item({ timeout: 10 })]), { canRest: false })).toBeNull();
  });

  it("wears a carried activation and queues its following rest", () => {
    const ctx = context([item({ handle: 7, tval: TV.AMULET, activation: true, timeout: 10 })]);
    let queued = false;
    expect(borgWearRecharge(ctx, { canRest: true, restAfterWear: () => { queued = true; } }))
      .toMatchObject({ code: "wield", args: { handle: 7 } });
    expect(queued).toBe(true);
  });

  it("continues the wired wear/rest sequence before another ladder decision", () => {
    const ctx = context([item({ handle: 7, tval: TV.AMULET, timeout: 10 })]);
    const session = buildThinkSession();
    session.ctx = ctx;
    expect(borgWearRecharge(ctx, { ...buildItemDeps(session), canRest: true })).toMatchObject({ code: "wield" });
    expect(session.rechargeRest).toBe(7);
    ctx.view.equipment = () => ctx.view.inventory();
    let turns: number | undefined;
    ctx.act = { ...ctx.act, rest: (n) => { turns = n; return { code: "rest" }; } };
    expect(borgThinkDungeon(ctx, session)).toMatchObject({ code: "rest" });
    expect(turns).toBe(75);
    expect(session.rechargeRest).toBe(false);
  });
});
