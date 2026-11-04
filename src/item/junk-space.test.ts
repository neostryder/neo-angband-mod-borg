import { describe, expect, it } from "vitest";
import type { ItemView } from "@rpgm-tools/neo-angband-core";
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
import { buildThinkSession, buildItemDeps } from "../think-session.js";
import { borgThinkDungeon } from "../think-ladder.js";

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

describe("the omitted junk rungs (#50)", () => {
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
    const boots = item({ handle: 4, tval: TV.BOOTS });
    const ctx = context([item({ artifact: true }), item({ tval: TV.FOOD }), item({ tval: TV.MAGIC_BOOK }), boots]);
    ctx.world.self.trait[BI.FOOD] = 1;
    expect(borgDropHole(ctx, false, { packFull: true, isIdent: () => false, dropEval: () => 10000 }))
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

  it("does not shed weight in town, danger or munchkin mode", () => {
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

describe("borg_wear_recharge (#50)", () => {
  it("rests for 75 turns for an equipped activation, but not for torch fuel", () => {
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
    expect(session.rechargeRest).toBe(true);
    let turns: number | undefined;
    ctx.act = { ...ctx.act, rest: (n) => { turns = n; return { code: "rest" }; } };
    expect(borgThinkDungeon(ctx, session)).toMatchObject({ code: "rest" });
    expect(turns).toBe(75);
    expect(session.rechargeRest).toBe(false);
  });
});
