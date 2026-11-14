/**
 * borg_notice counts what spells, class flags and activations give the
 * character (#69): borg_spell_legal_fail(PHASE_DOOR, 3) adds to BI_APHASE
 * (borg-trait.c), player_has(PF_BRAVERY_30) at level 30 resists fear. Driven
 * through createBorg's controller, the production path.
 */

import { describe, expect, it } from "vitest";
import type { ItemView, SpellbookView, SpellView } from "@rpgm-tools/neo-angband-core";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { createBorg } from "../controller.js";
import { BI } from "./trait-index.js";
import { TV } from "../item/svals.js";
import { makeCoreResolvers } from "../resolvers.js";
import { contextSpellSeam } from "./spell-seam.js";
import { borgNotice } from "./trait.js";
import { Spell, borgSpellFailRate } from "../item/magic.js";
import { BorgWorld } from "../world/model.js";
import { makeBorgRng } from "../rng.js";
import { CLASS_MAGE } from "./trait-index.js";

const spell = (over: Partial<SpellView>): SpellView => ({
  name: "", sidx: 0, bidx: 0, level: 1, mana: 1, fail: 0, learned: true, worked: true,
  forgotten: false, studyEligible: false, infoLine: "", ...over,
});

/** Magic for Beginners in Mage class order: Phase Door is class spell 3. */
function book(learned: boolean): SpellbookView {
  return {
    tval: TV.MAGIC_BOOK, name: "Magic for Beginners", realm: "arcane",
    spells: [
      spell({ name: "Magic Missile", sidx: 0 }),
      spell({ name: "Detect Monsters", sidx: 1 }),
      spell({ name: "Find Traps, Doors and Stairs", sidx: 2 }),
      spell({ name: "Phase Door", sidx: 3, level: 3, mana: 2, learned, worked: learned }),
    ],
  };
}

const bookItem = { handle: 7, kindKey: "", aware: true, nameColor: "", label: "Magic for Beginners", tval: TV.MAGIC_BOOK, sval: 1, pval: 0, number: 1, weight: 30, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [], timeout: 0 } as unknown as ItemView;

function noticed(player: Parameters<typeof makeScenarioView>[0], extra: Partial<ReturnType<typeof makeScenarioView>> = {}): number[] {
  const view = { ...makeScenarioView(player), ...extra };
  /* bookKind: the host's registered book identity (borg-magic.c:689-694). */
  const borg = createBorg({ resolvers: makeCoreResolvers({ bookKind: (tval) => ({ tval, sval: 1 }) }) });
  /* One think: the C reads BI_CLEVEL/BI_MAXSP/BI_FAIL* inside the same notice
   * (borg-trait.c:2839), and so does the port, from its first notice on. */
  borg.controller(view, makeFakeActions());
  return borg.world.self.trait;
}

describe("spell-provided abilities (borg_spell_legal_fail)", () => {
  const mage = (learned: boolean) =>
    noticed(
      { player: { cls: "Mage", level: 30, maxLevel: 30, sp: 40, maxSp: 40, stats: [10, 118, 10, 10, 10], classFlags: ["ZERO_FAIL"] } },
      { spellbooks: () => [book(learned)], inventory: () => [bookItem] },
    );

  it("a Mage who can cast Phase Door counts it as a phase source", () => {
    expect(mage(true)[BI.APHASE]).toBeGreaterThanOrEqual(1000);
  });

  it("control: an unlearned Phase Door counts for nothing", () => {
    expect(mage(false)[BI.APHASE]).toBeLessThan(1000);
  });
});

describe("class flags (player_has)", () => {
  const warrior = (level: number) =>
    noticed({ player: { cls: "Warrior", level, maxLevel: level, classFlags: ["BRAVERY_30"] } });

  it("a level-30 Warrior resists fear (PF_BRAVERY_30)", () => {
    expect(warrior(30)[BI.RFEAR]).toBe(1);
  });

  it("control: not before level 30", () => {
    expect(warrior(29)[BI.RFEAR]).toBe(0);
  });
});

describe("spell_chance(0) (borg-power.c:321)", () => {
  const seamFor = (chance?: number) => {
    const first = spell({ name: "Magic Missile", sidx: 0, fail: 22, mana: 1, ...(chance !== undefined ? { chance } : {}) });
    const view = { ...makeScenarioView({ player: { cls: "Mage", level: 1 } }), spellbooks: () => [{ tval: TV.MAGIC_BOOK, name: "Magic for Beginners", realm: "arcane", spells: [first] }] };
    const ctx = { world: new BorgWorld(), view, act: makeFakeActions(), rng: makeBorgRng() };
    ctx.world.self.trait[BI.CLASS] = CLASS_MAGE;
    return { seam: contextSpellSeam(ctx), ctx };
  };

  it("is the game's live chance for class spell 0, mana shortfall and all", () => {
    /* base 22 + the low-mana penalty the game adds: the view says 27. */
    expect(seamFor(27).seam.spellChance()).toBe(27);
  });

  it("control: without the game's figure, the Borg's own estimate", () => {
    const { seam, ctx } = seamFor();
    expect(seam.spellChance()).toBe(borgSpellFailRate(ctx, Spell.MAGIC_MISSILE));
  });
});

describe("notice reads its own traits, as the C's in-place notice does (borg-trait.c:2839)", () => {
  it("credits a castable Phase Door on the very first notice of a fresh world", () => {
    const view = {
      ...makeScenarioView({ player: { cls: "Mage", level: 30, maxLevel: 30, sp: 40, maxSp: 40, stats: [10, 118, 10, 10, 10], classFlags: ["ZERO_FAIL"] } }),
      spellbooks: () => [book(true)],
      inventory: () => [bookItem],
    };
    const ctx = { world: new BorgWorld(), view, act: makeFakeActions(), rng: makeBorgRng(), bookKind: (tval: number) => ({ tval, sval: 1 }), spellSeam: (c: Parameters<typeof contextSpellSeam>[0]) => contextSpellSeam(c) };
    borgNotice(ctx);
    expect(ctx.world.self.trait[BI.APHASE]).toBeGreaterThanOrEqual(1000);
  });
});

