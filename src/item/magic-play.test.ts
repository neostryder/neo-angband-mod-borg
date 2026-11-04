/**
 * TESTS FOR borg_play_magic (borg-magic-play.c:87).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentCommand, AgentView, ItemView, SpellbookView, SpellView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "../world/model.js";
import { BORG_DARK } from "../world/grid.js";
import { makeScenarioView, makeFakeActions, type FakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { BI, CLASS_MAGE } from "../trait/trait-index.js";
import { TV, Spell, ratingsForClass } from "./index.js";
import { NOT_TESTED_BY_EFFECT, borgCanPlaySpell, borgPlayMagic } from "./magic-play.js";

function spell(p: Partial<SpellView> & { name: string; sidx: number }): SpellView {
  return { bidx: 0, level: 1, mana: 1, fail: 30, learned: false, worked: false, forgotten: false, studyEligible: true, infoLine: "", ...p };
}

/** Magic for Beginners with its first two spells, as the class data orders them. */
function beginners(s0: Partial<SpellView> = {}, s1: Partial<SpellView> = {}): SpellbookView {
  return {
    tval: TV.MAGIC_BOOK,
    name: "Magic for Beginners",
    realm: "arcane",
    spells: [spell({ name: "Magic Missile", sidx: 0, ...s0 }), spell({ name: "Detect Monsters", sidx: 1, level: 2, ...s1 })],
  };
}

const bookItem = { handle: 7, tval: TV.MAGIC_BOOK, sval: 1, number: 1 } as unknown as ItemView;

function mage(book: SpellbookView, traits: Partial<Record<keyof typeof BI, number>> = {}, carried = true): { ctx: BorgContext; act: FakeActions } {
  const world = new BorgWorld();
  const base = makeScenarioView({ player: { grid: { x: 10, y: 10 } } });
  const view: AgentView = { ...base, inventory: () => (carried ? [{ ...bookItem }] : []), spellbooks: () => [book] };
  world.self.c.x = 10;
  world.self.c.y = 10;
  const all = { CLASS: CLASS_MAGE, CLEVEL: 5, LIGHT: 1, CDEPTH: 1, ISSTUDY: 1, CURSP: 10, MAXSP: 10, ...traits };
  for (const [k, v] of Object.entries(all)) world.self.trait[BI[k as keyof typeof BI]] = v;
  const act = makeFakeActions();
  return { ctx: { world, view, act, rng: makeBorgRng() }, act };
}

const args = (cmd: AgentCommand | null): unknown => (cmd as { args?: unknown } | null)?.args;
const code = (cmd: AgentCommand | null): string | undefined => (cmd as { code?: string } | null)?.code;

describe("borg_play_magic: study", () => {
  it("learns the best-rated learnable spell from the carried book", () => {
    const { ctx } = mage(beginners());
    const ratings = ratingsForClass(CLASS_MAGE)!;
    const best = ratings[0]!.rating >= ratings[1]!.rating ? 0 : 1;
    const cmd = borgPlayMagic(ctx, true);
    expect(code(cmd)).toBe("study");
    expect(args(cmd)).toEqual({ handle: 7, spell: best });
  });

  it("does not study without new spells to learn, or without the book in the pack", () => {
    expect(borgPlayMagic(mage(beginners(), { ISSTUDY: 0 }).ctx, true)).toBeNull();
    expect(borgPlayMagic(mage(beginners(), {}, false).ctx, true)).toBeNull();
  });

  it("refuses when blind, confused, unlit or on a dark grid", () => {
    expect(borgPlayMagic(mage(beginners(), { ISBLIND: 1 }).ctx, true)).toBeNull();
    expect(borgPlayMagic(mage(beginners(), { ISCONFUSED: 1 }).ctx, true)).toBeNull();
    expect(borgPlayMagic(mage(beginners(), { LIGHT: 0 }).ctx, true)).toBeNull();
    const { ctx } = mage(beginners());
    ctx.world.map.at(10, 10).info = BORG_DARK;
    expect(borgPlayMagic(ctx, true)).toBeNull();
  });
});

describe("borg_play_magic: test", () => {
  /* Both spells learned; Magic Missile untried (status TEST). */
  const untried = (): SpellbookView => beginners({ learned: true, worked: false }, { learned: true, worked: true });

  it("casts an untried spell in town when bored, aimed at the borg", () => {
    const { ctx, act } = mage(untried(), { CDEPTH: 0, ISSTUDY: 0 });
    const cmd = borgPlayMagic(ctx, true);
    expect(code(cmd)).toBe("cast");
    expect(args(cmd)).toEqual({ spell: 0 });
    expect(act.targets).toEqual([{ x: 10, y: 10 }]);
  });

  it("does not test in the dungeon, or when not bored", () => {
    expect(borgPlayMagic(mage(untried(), { CDEPTH: 1, ISSTUDY: 0 }).ctx, true)).toBeNull();
    expect(borgPlayMagic(mage(untried(), { CDEPTH: 0, ISSTUDY: 0 }).ctx, false)).toBeNull();
  });
});

/** The game's checkout holding the content pack (the play tests' convention); null skips the data check. */
function classJson(): string | null {
  const roots = [process.env["NEO_ANGBAND_REPO"], fileURLToPath(new URL("../../../neo-angband/", import.meta.url))].filter(
    (r): r is string => typeof r === "string" && r.length > 0,
  );
  for (const root of roots) {
    const file = join(root, "packages", "content", "pack", "class.json");
    if (existsSync(file)) return file;
  }
  return null;
}
const CLASS_JSON = classJson();

describe("borg_can_play_spell", () => {
  it("skips the C's named spells and the effect-bound ones", () => {
    expect(borgCanPlaySpell(Spell.GLYPH_OF_WARDING)).toBe(false);
    expect(borgCanPlaySpell(Spell.IDENTIFY_RUNE)).toBe(false);
    expect(borgCanPlaySpell(Spell.MAGIC_MISSILE)).toBe(true);
  });

  it.skipIf(CLASS_JSON === null)("names exactly the spells the game gives those effects", () => {
    /* borg_can_play_spell checks EF_BRAND_BOLTS, EF_CREATE_ARROWS,
     * EF_BRAND_AMMO, EF_ENCHANT, EF_IDENTIFY and EF_RECHARGE; the SpellView
     * carries no effect, so the port names the spells. This pins that list
     * to class.json: a spell that gains one of those effects fails here. */
    const classes = (JSON.parse(readFileSync(CLASS_JSON!, "utf8")) as {
      records: { book?: { spell?: { name: string; effect?: { eff: string }[] }[] }[] }[];
    }).records;
    const effects = new Set(["BRAND_BOLTS", "CREATE_ARROWS", "BRAND_AMMO", "ENCHANT", "IDENTIFY", "RECHARGE"]);
    const named = new Set<string>();
    for (const cls of classes) for (const book of cls.book ?? []) for (const s of book.spell ?? []) {
      if ((s.effect ?? []).some((e) => effects.has(e.eff))) named.add(s.name.toUpperCase().replace(/[^A-Z]+/gu, "_"));
    }
    const ours = new Set([...NOT_TESTED_BY_EFFECT].map((s) => Spell[s]));
    expect([...named].sort()).toEqual([...ours].sort());
  });
});
