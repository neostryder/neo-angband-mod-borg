/**
 * The bridge between the game's API 2 and the synchronous decision code.
 *
 * plugin.test.ts drives the built file end to end; these cover the pieces the
 * decisions lean on and cannot show failing on their own: the world read once per
 * decision, what the Borg sees with and without the hidden reads, the message
 * feed, and the caches that answer in the middle of a decision.
 */

import { describe, expect, it } from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { JsonRecord, KnownItem, LoadoutChange, LoadoutSimulation } from "@rpgm-tools/neo-angband-mod-sdk";
import { fakeGame, knownWorld, type FakeGame } from "../harness-api2.js";
import type { Scenario } from "../harness.js";
import { createBridge, type Bridge } from "./host.js";
import { LoadoutBook, RaceBook, SIMULATIONS_PER_ROUND, gearSignature } from "./caches.js";
import { borgTruth } from "./truth.js";
import { hasRandomPower, isCursed, isIdent, perItemValue } from "../item/deps.js";
import { TV } from "../item/svals.js";
import { makeCoreResolvers } from "../resolvers.js";
import { BorgWorld } from "../world/model.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { makeBorgRng } from "../rng.js";
import { makeFakeActions, makeScenarioView } from "../harness.js";
import { borgNotice } from "../trait/trait.js";
import { borgPower } from "../trait/power.js";
import { BI } from "../trait/trait-index.js";
import { SVAL } from "../item/svals.js";
import { borgView } from "../core-api.js";
import { borgFlowDarkInteresting, createFlowState } from "../flow/index.js";
import { contextSpellSeam } from "../trait/spell-seam.js";
import { borgSimulatePower } from "../trait/simulate.js";
import { defaultSpellSeam } from "../trait/config.js";

const SCENARIO: Scenario = {
  player: { grid: { x: 5, y: 5 }, depth: 3 },
  monsters: [
    { grid: { x: 6, y: 5 }, raceIndex: 42, hp: 7, maxHp: 10 },
    { grid: { x: 9, y: 9 }, raceIndex: 43, hp: 5, maxHp: 5 },
  ],
};

async function primed(options: Parameters<typeof fakeGame>[0] = {}): Promise<{ game: FakeGame; bridge: Bridge }> {
  const game = fakeGame({ scenario: SCENARIO, engine: { api: "1", core: Core, state: { actor: { player: { noscore: 0 } } } }, ...options });
  const bridge = createBridge(game.mod);
  await bridge.prime();
  return { game, bridge };
}

describe("remembered terrain through the API 2 bridge (#415)", () => {
  it.each([
    [Core.FEAT.GRANITE, false, Core.FEAT.SECRET],
    [Core.FEAT.CLOSED, false, Core.FEAT.OPEN],
    [Core.FEAT.GRANITE, false, Core.FEAT.FLOOR],
    [Core.FEAT.FLOOR, true, Core.FEAT.GRANITE],
    [Core.FEAT.OPEN, true, Core.FEAT.CLOSED],
  ] as const)("the map and exploration use remembered feature %i with passability %s instead of actual feature %i", async (feat, passable, actual) => {
    const { game, bridge } = await primed({ scenario: { player: { grid: { x: 5, y: 5 } } } });
    const base = knownWorld(game.view);
    const known = { ...base, level: { ...base.level!, cells: [{ x: 6, y: 5,
      remembered: { feat, passable, traps: [], objects: [], items: null },
      visible: false, lit: null, seen: false, glow: false,
      actual: { feat: actual, traps: [], objects: [], monster: 0 },
    }] } };
    game.mod.view.world = async () => ({ ok: true, value: known });
    const view = borgView((await bridge.readWorld())!.view);
    const world = new BorgWorld();
    perceive(world, view, makePerceiveMemo());
    expect(view.cell(6, 5)).toMatchObject({ feat, passable });
    expect(world.map.at(6, 5).feat).toBe(feat);
    const ctx = { world, view, act: makeFakeActions(), rng: makeBorgRng() };
    expect(borgFlowDarkInteresting(ctx, createFlowState(), 5, 6)).toBe(feat === Core.FEAT.CLOSED);
    expect(game.truthCalls).toEqual([]);
    await bridge.dispose();
  });

  it.each([false, true])("the illumination view requires current visibility %s", async (visible) => {
    const { game, bridge } = await primed();
    const base = knownWorld(game.view);
    const known = { ...base, level: { ...base.level!, cells: [{ x: 6, y: 5,
      remembered: { feat: Core.FEAT.FLOOR, passable: true, traps: [], objects: [], items: null },
      visible, lit: visible ? true : null, seen: visible, glow: true,
    }] } };
    game.mod.view.world = async () => ({ ok: true, value: known });
    const view = borgView((await bridge.readWorld())!.view);
    expect(view.cell(6, 5)?.glow).toBe(visible);
    expect(view.cell(7, 5)).toMatchObject({ feat: Core.FEAT.NONE, passable: false, known: false, glow: false });
    await bridge.dispose();
  });
});

describe("the bridge", () => {
  it("will not prime without an engine, and says so", async () => {
    const game = fakeGame({ scenario: SCENARIO });
    (game.mod as { engine?: unknown }).engine = undefined;
    await expect(createBridge(game.mod).prime()).rejects.toThrow(/no engine/u);
  });

  it("reads nothing before it is primed", async () => {
    const game = fakeGame({ scenario: SCENARIO });
    expect(await createBridge(game.mod).readWorld()).toBeNull();
  });

  it("builds the view from one read of the world", async () => {
    const { bridge } = await primed();
    const world = (await bridge.readWorld())!;
    const player = world.view.player();
    expect(player.grid).toEqual({ x: 5, y: 5 });
    expect(player.depth).toBe(3);
    expect(world.view.monsters().map((monster) => monster.raceIndex).sort()).toEqual([42, 43]);
  });

  it("plays the known world when the game gives no truth domain, and asks for no hidden read", async () => {
    const { game, bridge } = await primed({ truth: false });
    expect(bridge.hasTruth).toBe(false);
    await bridge.readWorld();
    expect(game.truthCalls).toEqual([]);
  });

  it("reads exact monsters and each race once when the game gives the truth domain", async () => {
    const { game, bridge } = await primed({ truth: true });
    expect(bridge.hasTruth).toBe(true);
    await bridge.readWorld();
    await bridge.readWorld();
    expect(game.truthCalls.filter((call) => call === "monsters")).toHaveLength(2);
    expect(game.truthCalls.filter((call) => call.startsWith("race ")).sort()).toEqual(["race 42", "race 43"]);
    expect(game.truthCalls.filter((call) => call === "level" || call === "storeKnowledge")).toEqual([]);
  });

  it("collects messages between decisions and hands each one over once", async () => {
    const { game, bridge } = await primed();
    const listener = game.listeners.get("message") as unknown as (event: { text: string }) => void;
    listener({ text: "It bites you." });
    listener({ text: "You feel better." });
    const world = (await bridge.readWorld())!;
    expect(world.view.messages?.()).toEqual(["It bites you.", "You feel better."]);
    expect(world.view.messages?.()).toEqual([]);
  });

  it("stops listening on dispose", async () => {
    const { game, bridge } = await primed();
    await bridge.dispose();
    expect(game.unsubscribed).toEqual(["message"]);
  });

  it("answers the shop signal and prices from the last read", async () => {
    const { bridge } = await primed();
    await bridge.readWorld();
    const seams = bridge.resolverInput();
    expect(seams.shopnum?.()).toBeNull();
    expect(seams.kindCost?.(75, 1)).toBeNull();
  });

  it("dispatches store decisions only while the store screen is open", async () => {
    const { game, bridge } = await primed();
    const known = knownWorld(game.view);
    game.mod.view.world = async () => ({ ok: true, value: { ...known, player: { ...known.player!, shopnum: 3 } } });
    await bridge.readWorld();
    const seams = bridge.resolverInput();
    bridge.setInput(game.input({ phase: "play" }));
    expect(seams.shopnum?.()).toBeNull();
    bridge.setInput(game.input({ phase: "store" }));
    expect(seams.shopnum?.()).toBe(3);
    bridge.setInput(game.input({ phase: "play" }));
    expect(seams.shopnum?.()).toBeNull();
    await bridge.dispose();
  });

  it("adapts published item costs, books, activations, dice, ego powers and negative flags to C inventory values", async () => {
    const game = fakeGame({ engine: { api: "1", core: Core, state: { actor: { player: { noscore: 0 } } } } });
    const item = (over: Partial<KnownItem>): KnownItem => ({
      handle: 1, kindKey: "kind:0", baseName: "sword", carried: true, aware: true,
      label: "sword", nameColor: "white", tval: TV.SWORD, sval: 1, pval: 0, number: 4,
      weight: 10, ac: 0, toA: 1, toH: 2, toD: 3, dd: 2, ds: 4, ego: false,
      artifact: false, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
      egoName: null, artifactName: null, activation: false, charging: 0, unknownRunes: false,
      inscription: null, value: 99999, ...over,
    });
    const inventory = [item({}), item({ handle: 2, unknownRunes: true }),
      item({ handle: 3, tval: TV.WAND, pval: 10 }),
      item({ handle: 4, ego: true, egoName: "of Accuracy" }),
      item({ handle: 5, ego: true, egoName: "of Protection", unknownRunes: true }),
      item({ handle: 6, flags: ["DRAIN_EXP"] }),
      item({ handle: 7, artifact: true, artifactName: "'The One Ring'", tval: TV.RING,
        toA: 0, toH: 0, toD: 0, curses: ["doom"] }),
      item({ handle: 8, tval: TV.ARROW }),
      item({ handle: 9, tval: TV.BOOTS, toH: -2, toD: 1, toA: 2 }),
      item({ handle: 10, tval: TV.BOOTS, pval: 1, toA: 0, toH: 0, toD: 0,
        flags: ["SUST_STR"], modifiers: [{ code: "SPEED", value: 2 }] }),
      item({ handle: 11, kindKey: "kind:1" }),
      item({ handle: 12, kindKey: "kind:99" }),
      item({ handle: 13, ego: true, egoName: "of Doubt" }),
      ...[TV.MAGIC_BOOK, TV.PRAYER_BOOK, TV.NATURE_BOOK, TV.SHADOW_BOOK, TV.OTHER_BOOK].map((tval, index) =>
        item({ handle: 14 + index, tval })),
      item({ handle: 19, activation: true }),
    ];
    const known = { ...knownWorld(game.view), inventory };
    game.mod.view.world = () => Promise.resolve({ ok: true, value: known });
    const records: Record<string, JsonRecord[]> = {
      object: [{ name: "sword", cost: 100, attack: { hd: "1d4" } }, { name: "worthless" }],
      ego_item: [{ name: "of Accuracy", info: { cost: 500 } },
        { name: "of Protection", info: { cost: 600 }, flags: ["RAND_POWER"] },
        { name: "of Doubt", info: { cost: 100 } }, { name: "of Doubt", info: { cost: 200 } }],
      artifact: [{ name: "'The One Ring'", cost: 10000, act: "BIZARRE" }],
      object_property: [{ type: "flag", code: "DRAIN_EXP", power: -10 }],
    };
    const calls: string[] = [];
    game.mod.content.records = (file) => {
      calls.push(file);
      return Promise.resolve({ ok: true, value: records[file] ?? [] });
    };
    const bridge = createBridge(game.mod);
    await bridge.prime();
    const world = (await bridge.readWorld())!;
    const items = world.view.inventory();
    expect(items.map((entry) => perItemValue(entry))).toEqual([1500, 100, 150, 2000, 100, 0, 10000, 145, 400, 60300, 0, 24999, 24999,
      100, 100, 100, 100, 100, 1500]);
    expect(isIdent(items[1]!)).toBe(false);
    expect(hasRandomPower(items[3]!)).toBe(false);
    expect(hasRandomPower(items[4]!)).toBe(true);
    expect(isCursed(items[5]!)).toBe(true);
    await bridge.readWorld();
    expect(calls.filter((file) => file === "ego_item")).toHaveLength(1);
  });
});

describe("food cure wiring through published content", () => {
  it.each([
    ["BLIND", BI.FOOD_CURE_BLIND, 300],
    ["CONFUSED", BI.FOOD_CURE_CONF, 400],
  ] as const)("counts %s cures by stack quantity and applies the C power weight", async (subtype, trait, weight) => {
    const game = fakeGame({ engine: { core: Core } });
    const food = (over: Partial<KnownItem>): KnownItem => ({
      handle: 1, kindKey: "kind:0", baseName: "food", carried: true, aware: true,
      label: "food", nameColor: "white", tval: TV.FOOD, sval: 99, pval: 0, number: 2,
      weight: 0, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false,
      artifact: false, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
      egoName: null, artifactName: null, activation: false, charging: 0, unknownRunes: false,
      inscription: null, ...over,
    });
    const inventory = [food({}), food({ handle: 2, tval: TV.MUSHROOM, number: 1 }),
      food({ handle: 3, aware: false, number: 7 }),
      food({ handle: 4, kindKey: "kind:1", number: 8 }),
      food({ handle: 5, kindKey: "kind:2", number: 9 }),
      food({ handle: 6, tval: TV.POTION, number: 10 }),
      food({ handle: 7, curses: ["doom"], number: 11 }),
      food({ handle: 8, kindKey: "kind:3", number: 12 })];
    const known = { ...knownWorld(game.view), inventory };
    game.mod.view.world = async () => ({ ok: true, value: known });
    const cure = { eff: "CURE", type: subtype };
    game.mod.content.records = async (file) => ({ ok: true, value: file === "object" ? [
      { effect: [{ eff: "RANDOM" }, cure, cure] },
      { effect: [cure, { eff: "CRUNCH" }] },
      { effect: [cure, { eff: "TIMED_INC", type: "CONFUSED" }] },
      { effect: [{ eff: "TIMED_DEC", type: subtype }] },
    ] : [] });
    const bridge = createBridge(game.mod);
    await bridge.prime();
    const snapshot = (await bridge.readWorld())!;
    const ctx = { world: new BorgWorld(), view: snapshot.view, act: makeFakeActions(), rng: makeBorgRng() };
    borgNotice(ctx, { uncursable: () => false });
    expect(ctx.world.self.trait[trait]).toBe(3);
    const power = borgPower(ctx);
    ctx.world.self.trait[trait] = 0;
    expect(power - borgPower(ctx)).toBe(3 * weight);
    borgNotice(ctx);
    expect(ctx.world.self.trait[trait]).toBe(14);
    known.inventory = [food({ tval: TV.MUSHROOM, sval: SVAL.mush.cure_mind! })];
    const next = (await bridge.readWorld())!;
    borgNotice({ ...ctx, view: next.view }, { cfg: { munchkinStart: true, munchkinLevel: 12 } });
    expect(ctx.world.self.trait[trait]).toBe(0);
    borgNotice({ ...ctx, view: next.view }, { cfg: { munchkinStart: false } });
    expect(ctx.world.self.trait[trait]).toBe(2);
    known.inventory = [];
    borgNotice({ ...ctx, view: (await bridge.readWorld())!.view });
    expect(ctx.world.self.trait[trait]).toBe(0);
    await bridge.dispose();
  });
});

describe("activation credit for unworn candidates", () => {
  it.each([
    ["inventory", true], ["store", true], ["inventory", false], ["store", false],
  ] as const)("a %s candidate with learned activation %s receives only known activation credit", async (source, learned) => {
    const { game, bridge } = await primed({ truth: false });
    const candidate: KnownItem = {
      handle: 9, kindKey: "kind:0", baseName: "amulet", carried: source === "inventory", aware: true,
      label: "amulet", nameColor: "white", tval: TV.AMULET, sval: 1, pval: 0, number: 1,
      weight: 1, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false,
      artifact: false, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
      egoName: null, artifactName: null, activation: learned, charging: 1, unknownRunes: false,
      inscription: null,
    };
    const known = { ...knownWorld(game.view), equipment: Array<KnownItem | null>(12).fill(null),
      inventory: source === "inventory" ? [candidate] : [],
      stores: source === "store" ? [{ feat: 1, featName: "shop", isHome: false, owner: { name: "owner", purse: 1000 }, stock: [{ ...candidate, index: 0 }] }] : [],
    };
    game.mod.view.world = () => Promise.resolve({ ok: true, value: known });
    const calls: unknown[] = [];
    game.mod.content.activation = (ref) => {
      calls.push(ref);
      return Promise.resolve({ ok: true, value: { index: 1, name: "HASTE", aim: false, level: 1, power: 1, message: "", desc: "", effect: [] } });
    };
    const before = { player: known.player!, equipment: known.equipment, inventory: known.inventory, stats: {} as LoadoutSimulation["before"]["stats"] };
    game.mod.view.simulateLoadout = (change) => {
      const equipment = [...known.equipment];
      if (change.wield) equipment[4] = candidate;
      return Promise.resolve({ ok: true, value: { before, after: { ...before, equipment }, delta: {} as LoadoutSimulation["delta"], placements: [], unresolved: [] } });
    };
    const snapshot = (await bridge.readWorld())!;
    const resolvers = makeCoreResolvers(bridge.resolverInput());
    const ctx = { world: new BorgWorld(), view: snapshot.view, act: makeFakeActions(), rng: makeBorgRng(), frame: resolvers.frame,
      spellSeam: (c: Parameters<typeof contextSpellSeam>[0]) => contextSpellSeam(c, resolvers.resolveActivation),
    };
    const ref = source === "inventory" ? { from: "gear" as const, handle: candidate.handle } : { from: "store" as const, store: 0, index: 0 };
    const change = { wield: [ref] };
    expect(borgSimulatePower(ctx, change)).toBeNull();
    expect(await bridge.settleLoadouts()).toBe(2);
    expect(ctx.spellSeam(ctx).equipsItem("act_haste")).toBe(false);
    const power = borgSimulatePower(ctx, change);
    const control = borgSimulatePower(ctx, change, { spells: defaultSpellSeam() });
    if (learned) expect(power).toBeGreaterThan(control!);
    else expect(power).toBe(control);
    const worn = snapshot.view.simulateLoadout!(change)!.after.equipment[4]!;
    const hidden = { ...ctx, view: { ...ctx.view, equipment: () => [{ ...worn, activation: false }] } };
    expect(ctx.spellSeam(hidden).equipsItem("act_haste")).toBe(false);
    expect(calls).toEqual(learned ? [{ tval: TV.AMULET, sval: 1 }] : []);
    expect(game.truthCalls).toEqual([]);
    await bridge.dispose();
  });
});

describe("the truth allowlist wrapper", () => {
  it("reads only the monsters the character perceives", async () => {
    const game = fakeGame({ scenario: SCENARIO, truth: true });
    const truth = borgTruth(game.mod)!;
    const seen = (await truth.perceivedMonsters())!;
    expect(seen.every((monster) => monster.perceived)).toBe(true);
  });

  it("is absent without the domain", () => {
    expect(borgTruth(fakeGame({ scenario: SCENARIO }).mod)).toBeNull();
  });
});

describe("the race cache", () => {
  it("asks once per race, remembers a miss, and never asks a race twice", async () => {
    const calls: number[] = [];
    const truth = {
      perceivedMonsters: () => Promise.resolve([]),
      race: (index: number) => {
        calls.push(index);
        return Promise.resolve(index === 9 ? null : ({ ridx: index, flags: ["EVIL"], spells: [3, 1], blows: [{ dice: 1, sides: 6, effect: "HURT" }], level: 4, sleep: 10, spellPower: 2, freqInnate: 0, freqSpell: 5, hasFriends: true } as never));
      },
    };
    const book = new RaceBook();
    await book.ensure(truth, [1, 1, 9]);
    await book.ensure(truth, [1, 9, 2]);
    expect(calls.sort()).toEqual([1, 2, 9]);
    expect(book.get(1)?.flags.has("EVIL")).toBe(true);
    expect(book.get(1)?.spells).toEqual([1, 3]);
    expect(book.get(9)).toBeUndefined();
  });
});

describe("the loadout cache", () => {
  const change = (n: number): LoadoutChange => ({ add: [{ slot: n }] }) as unknown as LoadoutChange;
  const answerOf = (n: number) => ({ n }) as never;
  const same = (value: unknown): never => value as never;

  /** A game that answers every question, and counts the asks. */
  function game() {
    const asked: string[] = [];
    return {
      asked,
      api: {
        view: {
          simulateLoadout: (c: LoadoutChange) => {
            asked.push(JSON.stringify(c));
            return Promise.resolve({ ok: true as const, value: answerOf(Object.keys(c).length === 0 ? 0 : 1) });
          },
        },
      } as never,
    };
  }

  it("says it does not know on the first ask, and records the question and the baseline", () => {
    const book = new LoadoutBook();
    book.begin("gear");
    expect(book.answer(change(1))).toBeNull();
    expect(book.pending).toBe(true);
  });

  it("answers after one round, and withholds a candidate until the baseline is known", async () => {
    const book = new LoadoutBook();
    const { api, asked } = game();
    book.begin("gear");
    book.answer(change(1));
    expect(await book.settle(api, same)).toBe(2);
    expect(asked).toHaveLength(2);
    expect(book.answer(change(1))).not.toBeNull();
    expect(book.answer({})).not.toBeNull();
    expect(book.pending).toBe(false);
  });

  it("does not ask the same question twice", async () => {
    const book = new LoadoutBook();
    const { api, asked } = game();
    book.begin("gear");
    book.answer(change(1));
    await book.settle(api, same);
    book.answer(change(1));
    expect(book.pending).toBe(false);
    expect(await book.settle(api, same)).toBe(0);
    expect(asked).toHaveLength(2);
  });

  it("reads at most a round's worth of questions at once", async () => {
    const book = new LoadoutBook();
    const { api, asked } = game();
    book.begin("gear");
    for (let n = 0; n < SIMULATIONS_PER_ROUND + 20; n++) book.answer(change(n));
    await book.settle(api, same);
    expect(asked).toHaveLength(SIMULATIONS_PER_ROUND);
    expect(book.pending).toBe(true);
  });

  it("drops every answer when the gear changes", async () => {
    const book = new LoadoutBook();
    const { api } = game();
    book.begin("gear");
    book.answer(change(1));
    await book.settle(api, same);
    book.begin("gear");
    expect(book.answer(change(1))).not.toBeNull();
    book.begin("other gear");
    expect(book.answer(change(1))).toBeNull();
  });

  it("throws away an answer that arrives after the gear moved", async () => {
    const book = new LoadoutBook();
    book.begin("gear");
    book.answer(change(1));
    const slow = {
      view: {
        simulateLoadout: () => {
          book.begin("moved");
          return Promise.resolve({ ok: true as const, value: answerOf(1) });
        },
      },
    } as never;
    expect(await book.settle(slow, same)).toBe(0);
    expect(book.size).toBe(0);
  });

  it("keeps a refused question unanswered rather than inventing an answer", async () => {
    const book = new LoadoutBook();
    book.begin("gear");
    book.answer(change(1));
    const refusing = { view: { simulateLoadout: () => Promise.resolve({ ok: false as const, reason: "refused", code: "x", message: "no" }) } } as never;
    expect(await book.settle(refusing, same)).toBe(0);
    expect(book.answer(change(1))).toBeNull();
  });
});

describe("the gear signature", () => {
  const item = (over: Record<string, unknown>): KnownItem => ({ handle: 1, kindKey: "k", number: 1, toH: 0, toD: 0, toA: 0, ...over }) as unknown as KnownItem;

  it("moves when the pack, the worn set, a store's stock or the level does, and not otherwise", () => {
    const base = gearSignature([item({})], [null], [{ feat: 1, stock: [item({})] }], null);
    expect(gearSignature([item({})], [null], [{ feat: 1, stock: [item({})] }], null)).toBe(base);
    expect(gearSignature([item({ number: 2 })], [null], [{ feat: 1, stock: [item({})] }], null)).not.toBe(base);
    expect(gearSignature([item({})], [item({ handle: 2 })], [{ feat: 1, stock: [item({})] }], null)).not.toBe(base);
    expect(gearSignature([item({})], [null], [{ feat: 1, stock: [] }], null)).not.toBe(base);
    expect(gearSignature([item({})], [null], [{ feat: 2, stock: [item({})] }], null)).not.toBe(base);
  });

  it("retries a refused store simulation after entering the shop with unchanged remembered stock", async () => {
    const player = knownWorld(makeScenarioView()).player!;
    let shopnum: number | null = null;
    const signature = () => gearSignature([], [], [{ feat: 1, stock: [item({})] }], { ...player, shopnum });
    const change = { carry: [{ item: { from: "store" as const, store: 0, index: 0 }, number: 1 }] };
    const book = new LoadoutBook();
    const calls: LoadoutChange[] = [];
    const api = { view: { simulateLoadout: async (query: LoadoutChange) => {
      calls.push(query);
      return shopnum === null && query.carry
        ? { ok: false as const, reason: "refused", code: "unobserved-item", message: "The store item is not currently seen." }
        : { ok: true as const, value: {} as LoadoutSimulation };
    } } } as never;
    book.begin(signature());
    expect(book.answer(change)).toBeNull();
    await book.settle(api, () => ({ allowed: true }) as never);
    expect(book.answer(change)).toBeNull();
    shopnum = 0;
    book.begin(signature());
    expect(book.answer(change)).toBeNull();
    await book.settle(api, () => ({ allowed: true }) as never);
    expect(book.answer(change)).toEqual({ allowed: true });
    expect(calls.filter((query) => query.carry)).toHaveLength(2);
  });
});


describe("default monster symbols through the API 2 bridge", () => {
  it.each([true, false])("resolves inherited and overridden symbols by bound index with truth=%s", async (truth) => {
    const game = fakeGame({ scenario: { monsters: [
      { grid: { x: 6, y: 5 }, raceIndex: 42, glyph: "!" },
      { grid: { x: 7, y: 5 }, raceIndex: 43, glyph: "?" },
    ] }, truth, engine: { core: Core } });
    const records: Record<string, readonly JsonRecord[]> = {
      monster_base: [{ name: "hound", glyph: "Z" }],
      monster: [
        { name: "inherited", base: "hound" },
        { name: "refused duplicate", base: "missing" },
        { name: "overridden", base: "hound", glyph: "C" },
      ],
    };
    game.mod.content.records = async (file) => ({ ok: true, value: records[file] ?? [] });
    game.mod.content.boundRecords = async (file) => ({ ok: true, value: file === "monster" ? [
      { index: 43, name: "overridden", key: "overridden", owner: "test" },
      { index: 42, name: "inherited", key: "inherited", owner: "core" },
    ] : [] });
    const bridge = createBridge(game.mod);
    await bridge.prime();
    const snapshot = (await bridge.readWorld())!;
    const world = new BorgWorld();
    perceive(world, snapshot.view, makePerceiveMemo());
    const ctx = { world, view: snapshot.view, act: makeFakeActions(), rng: makeBorgRng() };
    const resolve = makeCoreResolvers(bridge.resolverInput()).resolveMonsterFacts!;
    expect(resolve(ctx, 1).dChar).toBe("Z");
    expect(resolve(ctx, 2).dChar).toBe("C");
    await bridge.dispose();
  });
});


describe("public birth options for backup equipment",()=>{
  it.each([true,false,null] as const)("preserves the declared birth flag or denial (%s)",async flag=>{
    const game=fakeGame({engine:{api:"1",core:Core,state:{actor:{player:{noscore:0}}}}});
    const mod={...game.mod,view:{...game.mod.view,options:async()=>flag===null?{ok:false as const,reason:"not-granted",code:"not-granted",message:"player read denied"}:{ok:true as const,value:{birth:{birth_randarts:flag},values:{},hitpointWarn:0,delayFactor:0,lazymoveDelay:0}}}};
    const bridge=createBridge(mod as never);await bridge.prime();await bridge.readWorld();
    expect(bridge.resolverInput().birthRandarts?.()).toBe(flag);
    expect(makeCoreResolvers(bridge.resolverInput()).birthRandarts?.()).toBe(flag);await bridge.dispose();
  });
  it("refreshes birth options on a new public world frame",async()=>{
    const game=fakeGame({engine:{api:"1",core:Core,state:{actor:{player:{noscore:0}}}}});let flag=true;
    const mod={...game.mod,view:{...game.mod.view,options:async()=>({ok:true as const,value:{birth:{birth_randarts:flag},values:{},hitpointWarn:0,delayFactor:0,lazymoveDelay:0}})}};
    const bridge=createBridge(mod as never);await bridge.prime();await bridge.readWorld();expect(bridge.resolverInput().birthRandarts?.()).toBe(true);
    flag=false;await bridge.readWorld();expect(bridge.resolverInput().birthRandarts?.()).toBe(false);await bridge.dispose();
  });
});
