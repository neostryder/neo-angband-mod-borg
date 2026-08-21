/**
 * Tests for makeCoreResolvers: the host wiring that turns core MonsterRace
 * records into the MonsterFacts the danger evaluator needs. Proves the bridge
 * reads blows (dice/sides/effect), flags, spell list, and the spell/frequency
 * fields the frozen AgentView cannot surface.
 */

import { describe, expect, it } from "vitest";
import { RF, RSF } from "@rpgm-tools/neo-angband-core";
import type { ItemView, MonsterRace } from "@rpgm-tools/neo-angband-core";
import { makeCoreResolvers } from "./resolvers.js";
import type { CoreObjectLookup, CoreShopLookup } from "./resolvers.js";
import { BorgWorld } from "./world/model.js";
import { makeScenarioView, makeFakeActions } from "./harness.js";
import { MONBLOW } from "./danger/tables.js";
import type { BorgContext } from "./context.js";

/** A minimal MonsterRace carrying only the fields the resolver reads. */
function fakeRace(over: Partial<MonsterRace> = {}): MonsterRace {
  const blow = {
    method: {} as never,
    effect: { name: "FIRE" } as never,
    dice: { randomValue: () => ({ base: 0, dice: 3, sides: 6, mBonus: 0 }) } as never,
    diceRaw: "3d6",
  };
  return {
    ridx: 7,
    name: "test-drake",
    flags: [RF.UNIQUE] as unknown as MonsterRace["flags"],
    spellFlags: [RSF.BR_FIRE] as unknown as MonsterRace["spellFlags"],
    level: 20,
    sleep: 10,
    spellPower: 25,
    freqInnate: 4,
    freqSpell: 4,
    friends: [],
    friendsBase: [],
    blows: [blow] as unknown as MonsterRace["blows"],
    ...over,
  } as MonsterRace;
}

/** A context whose world has one tracked kill of race ridx 7. */
function ctxWithKill(): BorgContext {
  const world = new BorgWorld();
  const idx = world.kills.alloc();
  const k = world.kills.at(idx);
  k.rIdx = 7;
  k.mIdx = 101;
  k.pos = { x: 5, y: 5 };
  return { world, view: makeScenarioView(), act: makeFakeActions(), rng: undefined as never };
}

describe("makeCoreResolvers", () => {
  it("builds MonsterFacts from a core race (blows, flags, spells, freq)", () => {
    const resolvers = makeCoreResolvers({ races: [fakeRace()] });
    const ctx = ctxWithKill();
    const facts = resolvers.resolveMonsterFacts!(ctx, 1);

    expect(facts.rIdx).toBe(7);
    expect(facts.level).toBe(20);
    expect(facts.sleep).toBe(10);
    expect(facts.spellPower).toBe(25);
    expect(facts.freqInnate).toBe(4);
    expect(facts.flags.has("UNIQUE")).toBe(true);
    // The single fire blow: 3d6, MONBLOW.FIRE.
    expect(facts.blows).toHaveLength(1);
    expect(facts.blows[0]).toEqual({ dice: 3, sides: 6, effect: MONBLOW.FIRE });
    // The spell list carries the BR_FIRE ordinal.
    expect(facts.spells).toContain(RSF.BR_FIRE as unknown as number);
  });

  it("falls back to MonsterView-derived facts for an unknown race", () => {
    const resolvers = makeCoreResolvers({ races: [] }); // no race ridx 7
    const ctx = ctxWithKill();
    const facts = resolvers.resolveMonsterFacts!(ctx, 1);
    // Unknown race -> default resolver: no blows, zero freq (conservative).
    expect(facts.rIdx).toBe(7);
    expect(facts.blows).toHaveLength(0);
    expect(facts.freqInnate).toBe(0);
  });

  it("gives a MOD'S monster the same real facts as one of core's", () => {
    /* A hard requirement of this mod: modded creatures must work with the Borg
     * the same as vanilla ones. Nothing here opts in to that - the resolver indexes
     * by ridx and never looks at `from`, so a mod's race is resolved by the same
     * line of code, and the only way to BREAK this would be to add a provenance
     * check. The test exists so that nobody adds one. */
    const modRace = fakeRace({
      name: "joiner ant",
      from: { owner: "tutorial-03" },
    } as Partial<MonsterRace>);
    const facts = makeCoreResolvers({ races: [modRace] }).resolveMonsterFacts!(
      ctxWithKill(),
      1,
    );
    /* Real facts, not the conservative fallback: a mod's monster is dangerous. */
    expect(facts.blows).toEqual([{ dice: 3, sides: 6, effect: MONBLOW.FIRE }]);
    expect(facts.freqInnate).toBe(4);
    expect(facts.flags.has("UNIQUE")).toBe(true);
  });

  it("marks races with companions as hasFriends", () => {
    const resolvers = makeCoreResolvers({
      races: [fakeRace({ friends: [{} as never] })],
    });
    const facts = resolvers.resolveMonsterFacts!(ctxWithKill(), 1);
    expect(facts.hasFriends).toBe(true);
  });
});

/** A minimal ItemView carrying only the fields the activation seam reads. */
function fakeItem(over: Partial<ItemView> = {}): ItemView {
  return {
    handle: 1,
    label: "test item",
    tval: 30,
    sval: 5,
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

/** A BorgContext whose view.equipment() returns the given items. */
function ctxWithEquipment(items: ItemView[]): BorgContext {
  return {
    world: new BorgWorld(),
    view: { ...makeScenarioView(), equipment: () => items },
    act: makeFakeActions(),
    rng: undefined as never,
  };
}

/** A CoreObjectLookup that answers one kind, one ego and one artifact. */
function fakeObjects(over: Partial<CoreObjectLookup> = {}): CoreObjectLookup {
  return {
    lookupKind: () => null,
    findEgo: () => null,
    findArtifact: () => null,
    ...over,
  };
}

describe("makeCoreResolvers: activation identity", () => {
  it("finds a kind-level activation on an equipped item, charged", () => {
    const objects = fakeObjects({
      lookupKind: (tval, sval) =>
        tval === 30 && sval === 5 ? { activation: { name: "LIGHT" } } : null,
    });
    const resolvers = makeCoreResolvers({ races: [], objects });
    const ctx = ctxWithEquipment([fakeItem({ activation: true, timeout: 0 })]);

    expect(resolvers.resolveActivation!(ctx, "act_light", true)).toBe(true);
    expect(resolvers.activateHandle!(ctx, "act_light")).toBe(1);
  });

  it("an artifact's activation overrides its base kind's", () => {
    const objects = fakeObjects({
      lookupKind: () => ({ activation: { name: "LIGHT" } }),
      findArtifact: (name) =>
        name === "Foo" ? { activation: { name: "ILLUMINATION" } } : null,
    });
    const resolvers = makeCoreResolvers({ races: [], objects });
    const ctx = ctxWithEquipment([
      fakeItem({ activation: true, artifact: true, artifactName: "Foo" }),
    ]);

    expect(resolvers.resolveActivation!(ctx, "act_light", false)).toBe(false);
    expect(resolvers.resolveActivation!(ctx, "act_illumination", false)).toBe(true);
  });

  it("falls back to the kind when an ego item carries no activation of its own", () => {
    const objects = fakeObjects({
      lookupKind: () => ({ activation: { name: "LIGHT" } }),
      findEgo: (name) => (name === "of Foo" ? { activation: null } : null),
    });
    const resolvers = makeCoreResolvers({ races: [], objects });
    const ctx = ctxWithEquipment([
      fakeItem({ activation: true, ego: true, egoName: "of Foo" }),
    ]);

    expect(resolvers.resolveActivation!(ctx, "act_light", false)).toBe(true);
  });

  it("checkCharge rejects a discharged item, and activateHandle always requires a charge", () => {
    const objects = fakeObjects({
      lookupKind: () => ({ activation: { name: "LIGHT" } }),
    });
    const resolvers = makeCoreResolvers({ races: [], objects });
    const ctx = ctxWithEquipment([fakeItem({ activation: true, timeout: 5 })]);

    expect(resolvers.resolveActivation!(ctx, "act_light", true)).toBe(false);
    expect(resolvers.resolveActivation!(ctx, "act_light", false)).toBe(true);
    expect(resolvers.activateHandle!(ctx, "act_light")).toBeNull();
  });

  it("stays on the conservative default with no object registry", () => {
    const resolvers = makeCoreResolvers({ races: [] });
    const ctx = ctxWithEquipment([fakeItem({ activation: true })]);

    expect(resolvers.resolveActivation!(ctx, "act_light", false)).toBe(false);
    expect(resolvers.activateHandle!(ctx, "act_light")).toBeNull();
  });
});

describe("makeCoreResolvers: in-shop signal", () => {
  function fakeState(shopnum: number): CoreShopLookup {
    return {
      actor: { grid: { x: 5, y: 5 } },
      chunk: { feature: () => ({ shopnum }) },
    };
  }

  it("reports the store number (shopnum - 1) when standing on an entrance", () => {
    const resolvers = makeCoreResolvers({ races: [], state: fakeState(3) });
    expect(resolvers.inShop!(ctxWithEquipment([]))).toBe(2);
  });

  it("reports null off a shop entrance", () => {
    const resolvers = makeCoreResolvers({ races: [], state: fakeState(0) });
    expect(resolvers.inShop!(ctxWithEquipment([]))).toBeNull();
  });

  it("stays on the conservative default with no live state", () => {
    const resolvers = makeCoreResolvers({ races: [] });
    expect(resolvers.inShop!(ctxWithEquipment([]))).toBeNull();
  });
});
