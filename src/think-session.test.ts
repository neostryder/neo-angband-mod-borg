/**
 * The fan-out from ONE hypothetical-loadout seam to the SEVEN questions the
 * ported subsystems ask.
 *
 * WHY THIS IS ITS OWN FILE. `resolvers.test.ts` proves the seam answers
 * correctly; this proves the answer reaches the decisions. Those are different
 * failures, and the second one is the one this mod has now hit four times: a
 * capability that exists in the tree and not in the product. Every assertion here
 * is about the deps bundle the ported code is actually handed, and the last one
 * drives a real decision through to the command it emits.
 */

import { describe, expect, it } from "vitest";
import type { AgentView, ItemView, StoreItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "./world/model.js";
import { makeScenarioView, makeFakeActions } from "./harness.js";
import { makeBorgRng } from "./rng.js";
import type { BorgContext } from "./context.js";
import { BI } from "./trait/trait-index.js";
import { TV } from "./item/svals.js";
import { borgWearStuff, borgRemoveStuff, Spell, borgGetSpellNumber, SVAL } from "./item/index.js";
import { borgFlowGlyph } from "./flow/flow-glyph.js";
import { borgFlowKillAim } from "./flow/flow-kill.js";
import { borgAttack } from "./fight/attack.js";
import { getFightState } from "./fight/state.js";
import { borgNotice } from "./trait/trait.js";
import { perceive, makePerceiveMemo } from "./perceive.js";
import { makeCoreResolvers } from "./resolvers.js";
import { primeSession } from "./think-session.js";
import { FEAT } from "./core-api.js";
import { buildItemDeps, buildStoreDeps, buildThinkSession } from "./think-session.js";
import type { BorgResolvers } from "./think-session.js";
import type { BorgLoadoutChange } from "./trait/simulate.js";

/** A minimal ItemView; only the fields the wear/store guards read matter. */
function item(over: Partial<ItemView> = {}): ItemView {
  return {
    handle: 11,
    kindKey: "",
    aware: true,
    nameColor: "",
    label: "test item",
    tval: TV.SOFT_ARMOR,
    sval: 2,
    pval: 0,
    number: 1,
    weight: 60,
    ac: 8,
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
    value: 50,
    ...over,
  };
}

function ware(over: Partial<StoreItemView> = {}): StoreItemView {
  return { ...item(), index: 3, price: 100, ...over };
}

/** A session primed with `resolvers` and a ctx over the given inventory. */
function primed(
  resolvers: BorgResolvers,
  inventory: ItemView[] = [],
  power = 1000,
): { session: ReturnType<typeof buildThinkSession>; ctx: BorgContext } {
  const base = makeScenarioView();
  const view: AgentView = { ...base, inventory: () => inventory, equipment: () => [] };
  const world = new BorgWorld();
  world.self.power = power;
  world.self.trait[BI.CURHP] = 40;
  const ctx: BorgContext = { world, view, act: makeFakeActions(), rng: makeBorgRng(1) };
  const session = buildThinkSession(resolvers);
  session.ctx = ctx;
  return { session, ctx };
}

/**
 * A resolver that records every change it is asked about, answering `base` for
 * the empty change and `power` for every other.
 *
 * THE EMPTY CHANGE IS PART OF THE CONTRACT. powerOf turns a simulated score into
 * a DELTA against the character as it stands, and it gets the second half by
 * asking this same seam about a change of nothing. A stub that answered one
 * number for everything would describe an engine on which no item improves
 * anything, which is a real state and not the one most of these tests want, so
 * `base` defaults to the current power rather than to `power`.
 */
function recorder(power: number | null, base: number | null = 1000): {
  resolvers: BorgResolvers;
  seen: BorgLoadoutChange[];
} {
  const seen: BorgLoadoutChange[] = [];
  const isEmpty = (c: BorgLoadoutChange): boolean => Object.keys(c).length === 0;
  return {
    seen,
    resolvers: {
      loadoutPower: (_ctx, change) => {
        seen.push(change);
        return isEmpty(change) ? base : power;
      },
    },
  };
}

/** The changes a recorder saw, with the baseline probes taken out. */
function candidates(seen: BorgLoadoutChange[]): BorgLoadoutChange[] {
  return seen.filter((c) => Object.keys(c).length > 0);
}

describe("the loadout seam reaches the wear decision", () => {
  it("supplies no wearEval at all when the seam is not wired", () => {
    const { session } = primed({});
    expect(buildItemDeps(session).wearEval).toBeUndefined();
  });

  it("asks for the power of WEARING the candidate, by its gear handle", () => {
    const { resolvers, seen } = recorder(2000);
    const { session } = primed(resolvers);
    const power = buildItemDeps(session).wearEval!(item({ handle: 42 }));
    /* The live power (1000) plus the simulated gain (2000 - 1000), NOT the raw
       simulated 2000: the two numbers the decision compares have to come from
       one derivation or a systematic offset between them reads as a gain on
       every candidate. See powerOf. */
    expect(power).toBe(2000);
    expect(candidates(seen)).toEqual([{ wield: [{ from: "gear", handle: 42 }] }]);
    expect(seen.some((c) => Object.keys(c).length === 0), "it asked for the baseline too").toBe(true);
  });

  it("cancels a systematic offset between the live and simulated derives", () => {
    /* THE TORCH LOOP, as an arithmetic statement. An engine whose simulated
       derive scores 14000 higher than the live one for the very same loadout made
       every wearable item look like a 14000-point upgrade, and the Borg swapped
       one wooden torch for an identical one 3964 times in 4000 decisions. With
       the baseline subtracted, an offset that applies to both sides cancels and
       an item that changes nothing reports no gain. */
    const { resolvers } = recorder(15_000, 14_000);
    const { session } = primed(resolvers, [], 1000);
    expect(buildItemDeps(session).wearEval!(item({ handle: 42 }))).toBe(2000);

    const flat = recorder(14_000, 14_000);
    const flatSession = primed(flat.resolvers, [], 1000).session;
    expect(buildItemDeps(flatSession).wearEval!(item({ handle: 42 }))).toBe(1000);
  });

  it("hands back the CURRENT power when the engine cannot answer", () => {
    /* The conservative default, restated where it matters: the ported code acts
       only on a gain, so the current power means "no improvement" and the borg
       wears nothing. Anything else here would make an engine with no loadout
       capability look like an engine reporting an upgrade. */
    const { resolvers } = recorder(null);
    const { session } = primed(resolvers, [], 777);
    expect(buildItemDeps(session).wearEval!(item())).toBe(777);
  });

  it("makes borg_wear_stuff actually wear the thing, end to end", () => {
    /* The claim the other tests cannot make. borgWearStuff compares each carried
       item's evaluated power against borg.power and emits a wear command for the
       best gain; with the seam inert it emits nothing, which is precisely the bug
       the seam exists to fix. */
    const candidate = item({ handle: 42, tval: TV.SOFT_ARMOR });
    const { resolvers } = recorder(5000);
    const { session, ctx } = primed(resolvers, [candidate], 1000);
    const cmd = borgWearStuff(ctx, buildItemDeps(session));
    expect(cmd).not.toBeNull();
    expect(cmd?.args?.["handle"]).toBe(42);

    /* And with no seam, the same scenario emits nothing. */
    const bare = primed({}, [candidate], 1000);
    expect(borgWearStuff(bare.ctx, buildItemDeps(bare.session))).toBeNull();
  });
});

describe("equipment removal (borg-junk.c:1259-1397)", () => {
  function removal(gear: ItemView[], score: number | null = 1000) {
    const record = recorder(score);
    const setup = primed(record.resolvers);
    setup.ctx.view = { ...setup.ctx.view, equipment: () => gear };
    return { ...setup, seen: record.seen };
  }

  it("keeps cursed gear when removing it lowers power or the answer is unavailable", () => {
    for (const score of [999, null]) {
      const { ctx, session } = removal([item({ curses: ["slowness"] })], score);
      expect(borgRemoveStuff(ctx, buildItemDeps(session))).toBeNull();
    }
  });

  it("removes the last qualifying slot and counts the action", () => {
    const { ctx, session, seen } = removal([item({ handle: 40 }), item({ handle: 41 })]);
    expect(borgRemoveStuff(ctx, buildItemDeps(session))).toMatchObject({ code: "takeoff", args: { handle: 41 } });
    expect(candidates(seen)).toEqual([{ remove: [0] }, { remove: [1] }]);
    expect(ctx.world.self.timeThisPanel).toBe(1);
  });

  it.each(["full", "hungry", "weak", "level", "panel"])("respects the %s guard", (guard) => {
    const { ctx, session, seen } = removal([item({ curses: ["slowness"] })]);
    if (guard === "full") ctx.view = { ...ctx.view, inventory: () => Array.from({ length: 23 }, (_, handle) => item({ handle })) };
    if (guard === "hungry") ctx.world.self.trait[BI.ISHUNGRY] = 1;
    if (guard === "weak") ctx.world.self.trait[BI.ISWEAK] = 1;
    if (guard === "level") ctx.world.clock = 2001;
    if (guard === "panel") ctx.world.self.timeThisPanel = 151;
    expect(borgRemoveStuff(ctx, buildItemDeps(session))).toBeNull();
    expect(seen).toEqual([]);
  });

  it.each([
    { aware: false },
    { inscription: "??" },
    { artifact: true, artifactName: "'The One Ring'", curses: ["slowness"] },
  ])("keeps protected equipment %j", (over) => {
    const { ctx, session, seen } = removal([item(over)]);
    expect(borgRemoveStuff(ctx, buildItemDeps(session))).toBeNull();
    expect(seen).toEqual([]);
  });

  it("allows unknown runes on cursed gear at the exact time limits", () => {
    const { ctx, session } = removal([item({ inscription: "??", curses: ["slowness"] })]);
    ctx.world.clock = 2100;
    session.flow.state.borgBegan = 100;
    ctx.world.self.timeThisPanel = 150;
    expect(borgRemoveStuff(ctx, buildItemDeps(session))?.code).toBe("takeoff");
    expect(ctx.world.self.timeThisPanel).toBe(151);
  });
});

describe("glyph and re-aim capability chains", () => {
  function capabilities(cls: string, spell?: Spell, fail = 5, scroll = false) {
    const source = makeScenarioView({
      player: { cls, grid: { x: 20, y: 12 }, level: 20, maxLevel: 20, sp: 100, maxSp: 100, depth: 10 },
      monsters: [{ grid: { x: 25, y: 12 } }],
    });
    const world = new BorgWorld();
    const ctx: BorgContext = { world, view: source, act: makeFakeActions(), rng: makeBorgRng(1), bookKind: (tval) => ({ tval, sval: 1 }) };
    const tval = cls === "Mage" ? TV.MAGIC_BOOK : cls === "Necromancer" ? TV.SHADOW_BOOK : TV.PRAYER_BOOK;
    const books: SpellbookView[] = spell === undefined ? [] : [{
      tval, realm: "test", name: "fixture",
      spells: [{ name: "fixture", sidx: borgGetSpellNumber(ctx, spell), bidx: 0,
        level: 20, mana: 1, fail, learned: true, worked: true, forgotten: false, studyEligible: false, infoLine: "" }],
    }];
    const gear = item({ handle: 42, artifact: true, artifactName: "glyph fixture", activation: true });
    ctx.view = { ...source, equipment: () => [gear],
      inventory: () => [item({ tval, sval: 1 }), item({ handle: 4, tval: TV.FOOD, sval: SVAL.food.ration! }),
        ...(scroll ? [item({ handle: 2, tval: TV.SCROLL, sval: SVAL.scroll.rune_of_protection! })] : [])],
      spellbooks: () => books };
    borgNotice(ctx);
    perceive(world, ctx.view, makePerceiveMemo());
    const session = buildThinkSession(makeCoreResolvers({ objects: {
      lookupKind: () => null, findEgo: () => null, findArtifact: () => ({ activation: { name: "GLYPH" } }),
    } }));
    primeSession(session, ctx);
    return { ctx, session, flow: session.flow.state };
  }

  it.each([[30, true, "cast"], [31, true, "read"], [31, false, "activate"]] as const)(
    "uses the C glyph chain at failure %i with scroll %s", (fail, scroll, code) => {
      const { ctx, flow } = capabilities("Priest", Spell.GLYPH_OF_WARDING, fail, scroll);
      flow.glyphX = ctx.world.self.c.x;
      flow.glyphY = ctx.world.self.c.y;
      expect(borgFlowGlyph(ctx, flow)?.code).toBe(code);
      expect(flow.glyph.num).toBe(1);
    },
  );

  it("rejects a charging glyph activation", () => {
    const { ctx, flow } = capabilities("Priest");
    const equipment = ctx.view.equipment().map((gear) => gear && { ...gear, timeout: 1 });
    ctx.view = { ...ctx.view, equipment: () => equipment };
    expect(flow.hooks.layGlyph(ctx)).toBeNull();
  });

  it.each([["Mage", Spell.MAGIC_MISSILE], ["Necromancer", Spell.NETHER_BOLT]] as const)(
    "finds a %s bolt without a launcher and rejects a blocked bolt", (cls, spell) => {
      const { ctx, flow } = capabilities(cls, spell);
      borgAttack(ctx);
      getFightState(ctx.world).simulate = true;
      getFightState(ctx.world).successfulTarget = 0;
      expect(flow.hooks.hasDistanceAttack(ctx.world)).toBe(true);
      ctx.world.map.at(23, 12).feat = FEAT.GRANITE;
      expect(flow.hooks.hasDistanceAttack(ctx.world)).toBe(false);
    },
  );

  it("uses quiver ammunition and does not treat shots without ammunition as an attack", () => {
    const { ctx, flow } = capabilities("Warrior");
    const bow = item({ tval: TV.BOW });
    const ammo = item({ handle: 3, tval: TV.ARROW, value: 10, dd: 1, ds: 4 });
    ctx.view = { ...ctx.view, equipment: () => [null, bow], quiver: () => [ammo] };
    ctx.world.self.trait[BI.AMMO_TVAL] = TV.ARROW;
    ctx.world.self.trait[BI.AMMO_POWER] = 2;
    ctx.world.self.trait[BI.SHOTS] = 1;
    ctx.world.self.trait[BI.THB] = 100;
    borgAttack(ctx);
    getFightState(ctx.world).simulate = true;
    getFightState(ctx.world).successfulTarget = 0;
    expect(flow.hooks.hasDistanceAttack(ctx.world)).toBe(true);
    const player = ctx.view.player();
    ctx.view = { ...ctx.view, player: () => ({ ...player, shots: 10 }), quiver: () => [] };
    expect(flow.hooks.hasDistanceAttack(ctx.world)).toBe(false);
  });

  it("draws for both spell probes before falling back to arrows, even without known spells", () => {
    const { ctx, flow } = capabilities("Warrior");
    ctx.world.self.trait[BI.CLEVEL] = 2;
    const expected = makeBorgRng(1);
    expected.randint0(100);
    expected.randint0(100);
    expect(flow.hooks.hasDistanceAttack(ctx.world)).toBe(false);
    expect(ctx.rng.randint0(10000)).toBe(expected.randint0(10000));
  });

  it("moves to a position with a bolt path and restores the real position", () => {
    const { ctx, flow } = capabilities("Mage", Spell.MAGIC_MISSILE);
    ctx.world.map.at(23, 12).feat = FEAT.GRANITE;
    borgAttack(ctx);
    getFightState(ctx.world).simulate = true;
    getFightState(ctx.world).successfulTarget = 0;
    expect(borgFlowKillAim(ctx, flow, true)).toMatchObject({ code: "walk" });
    expect(ctx.world.self.c).toEqual({ x: 20, y: 12 });
  });
});

describe("the loadout seam reaches the store decisions", () => {
  it("supplies none of the store evals when the seam is not wired", () => {
    const { session } = primed({});
    const deps = buildStoreDeps(session);
    expect(deps.buyShopEval).toBeUndefined();
    expect(deps.buyHomeEval).toBeUndefined();
    expect(deps.sellEval).toBeUndefined();
    expect(deps.sellHomeBadEval).toBeUndefined();
    expect(deps.mem).toBe(session.storeMem);
  });

  it("prices a non-wieldable ware as a purchase into the pack", () => {
    const { resolvers, seen } = recorder(2000);
    const { session, ctx } = primed(resolvers);
    const deps = buildStoreDeps(session);
    expect(
      deps.buyShopEval!(ctx, { item: ware({ index: 4 }), store: 1, qty: 3, wields: false }),
    ).toBe(2000);
    expect(candidates(seen)).toEqual([
      { carry: [{ item: { from: "store", store: 1, index: 4 }, number: 3 }] },
    ]);
  });

  it("prices a wieldable ware as worn, and carries the rest of the stack", () => {
    const { resolvers, seen } = recorder(2000);
    const { session, ctx } = primed(resolvers);
    const deps = buildStoreDeps(session);
    deps.buyShopEval!(ctx, { item: ware({ index: 4 }), store: 2, qty: 1, wields: true });
    deps.buyShopEval!(ctx, { item: ware({ index: 4 }), store: 2, qty: 2, wields: true });
    const asked = candidates(seen);
    expect(asked[0]).toEqual({ wield: [{ from: "store", store: 2, index: 4 }] });
    expect(asked[1]).toEqual({
      wield: [{ from: "store", store: 2, index: 4 }],
      carry: [{ item: { from: "store", store: 2, index: 4 }, number: 1 }],
    });
  });

  it("addresses a ware by its own stock index, not by its position in a filter", () => {
    /* The home optimiser walks a FILTERED list of wares, so its loop index is not
       the stock index the engine has to be given. StoreItemView.index is, and
       reading the wrong one would price a different item than the one being
       considered - a mistake that produces plausible numbers and wrong purchases. */
    const { resolvers, seen } = recorder(2000);
    const { session, ctx } = primed(resolvers);
    buildStoreDeps(session).buyHomeEval!(ctx, {
      item: ware({ index: 17 }),
      store: 7,
      qty: 1,
      wields: false,
    });
    expect(candidates(seen)).toEqual([
      { carry: [{ item: { from: "store", store: 7, index: 17 }, number: 1 }] },
    ]);
  });

  it("prices a sale as giving the stack up, and the home check as giving up ONE", () => {
    const { resolvers, seen } = recorder(2000);
    const { session, ctx } = primed(resolvers);
    const deps = buildStoreDeps(session);
    deps.sellEval!(ctx, item({ handle: 9 }), 4);
    deps.sellHomeBadEval!(ctx, item({ handle: 9 }));
    expect(candidates(seen)).toEqual([
      { release: [{ handle: 9, number: 4 }] },
      { release: [{ handle: 9, number: 1 }] },
    ]);
  });

  it("leaves the two SWAP valuations unwired, on purpose", () => {
    /* weapon_swap_value and armour_swap_value contribute 0 to borgPower in this
       port (the swap subsystem is not ported), so an evaluator here would compare
       two numbers equal by construction and buy on the tiebreak. Unreachable, not
       merely unwired - and this test is what stops somebody wiring it for
       symmetry. */
    const { resolvers } = recorder(2000);
    const { session } = primed(resolvers);
    const deps = buildStoreDeps(session);
    expect(deps.weaponSwapEval).toBeUndefined();
    expect(deps.armourSwapEval).toBeUndefined();
  });
});
