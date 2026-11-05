/**
 * TESTS FOR borg_play_magic (borg-magic-play.c:87).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentCommand, AgentView, ItemView, SpellbookView, SpellView } from "@rpgm-tools/neo-angband-core";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { JsonRecord, KnownWorldData } from "@rpgm-tools/neo-angband-mod-sdk";
import { createBridge } from "../api2/host.js";
import { createActFacade } from "../api2/act.js";
import { fakeGame } from "../harness-api2.js";
import { createBorg } from "../controller.js";
import { makeCoreResolvers } from "../resolvers.js";
import { borgBookHandle, borgBookPossessed, borgGetSpellNumber, borgSpellLegal, borgSpellFailRate } from "./magic.js";
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
  return { ctx: { world, view, act, rng: makeBorgRng(), bookKind: (tval) => ({ tval, sval: 1 }), spellEffect: () => ({ name: "BOLT_OR_BEAM", aim: true }) }, act };
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
    expect(borgCanPlaySpell(Spell.GLYPH_OF_WARDING, "GLYPH")).toBe(false);
    expect(borgCanPlaySpell(Spell.IDENTIFY_RUNE, "IDENTIFY")).toBe(false);
    expect(borgCanPlaySpell(Spell.MAGIC_MISSILE, "BOLT_OR_BEAM")).toBe(true);
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
    expect(NOT_TESTED_BY_EFFECT).toEqual(effects);
    expect(named.size).toBe(6);
  });
});

/** The published engine boots from the same content files the game loads. */
function loadPack(): Core.GamePack {
  const json = (name: string): { records: JsonRecord[] } => JSON.parse(readFileSync(join(CLASS_JSON!, "..", `${name}.json`), "utf8"));
  const records = (name: string): JsonRecord[] => json(name).records;
  return {
    constants: json("constants"), terrain: records("terrain"), roomTemplates: records("room_template"),
    vaults: records("vault"), dungeonProfiles: records("dungeon_profile"), projection: records("projection"),
    trap: records("trap"), names: records("names"), quest: records("quest"),
    obj: Object.fromEntries(Object.entries({ objectBase: "object_base", object: "object", egoItem: "ego_item", artifact: "artifact", curse: "curse", brand: "brand", slay: "slay", activation: "activation", objectProperty: "object_property", flavor: "flavor" }).map(([key, file]) => [key, json(file)])),
    mon: Object.fromEntries(Object.entries({ pain: "pain", blowMethods: "blow_methods", blowEffects: "blow_effects", monsterSpells: "monster_spell", monsterBases: "monster_base", monsters: "monster", summons: "summon", pits: "pit" }).map(([key, file]) => [key, records(file)])),
    player: Object.fromEntries(Object.entries({ races: "p_race", classes: "class", properties: "player_property", timed: "player_timed", shapes: "shape", bodies: "body", history: "history", realms: "realm" }).map(([key, file]) => [key, records(file)])),
  } as unknown as Core.GamePack;
}

async function caster(cls: string, experience = 0) {
  const game = Core.startGame(loadPack(), { seed: 441, depth: 0, className: cls, rolledStats: [18, 18, 18, 18, 18, 18] });
  const { state } = game;
  const player = state.actor.player;
  state.turn = state.z.dayLength * 5;
  state.updateBonuses?.();
  if (experience > 0) {
    Core.playerExpGain(player, experience, { rng: state.rng, onLevelChange: () => state.updateBonuses?.() });
    Core.calcSpells(player, state.playerState!.statInd);
    player.csp = player.msp;
    player.chp = player.mhp;
  }
  const deps = { resolver: new Core.ContentIdResolver({ objects: game.booted.registries.objects, playerRaces: game.players.races, playerClasses: game.players.classes }), reg: game.booted.registries.objects };
  const mod = fakeGame({ engine: { api: "1", core: Core } }).mod;
  mod.content.records = async (file) => ({ ok: true, value: (JSON.parse(readFileSync(join(CLASS_JSON!, "..", `${file}.json`), "utf8")) as { records: JsonRecord[] }).records });
  mod.content.boundRecords = async () => ({ ok: true, value: game.booted.registries.objects.kinds.map((kind) => ({ key: kind.name, name: kind.name, index: kind.kidx, tval: kind.tval, owner: "core" })) });
  mod.view.world = async () => ({ ok: true, value: Core.buildKnownWorld(state, deps) as KnownWorldData });
  const bridge = createBridge(mod);
  await bridge.prime();
  const resolvers = makeCoreResolvers(bridge.resolverInput());
  const borg = createBorg({ resolvers });
  const read = async () => {
    const view = (await bridge.readWorld())!.view;
    const facade = createActFacade();
    const command = borg.controller(view, facade.act);
    const ctx: BorgContext = { world: borg.world, view, act: facade.act, rng: borg.rng, bookKind: resolvers.bookKind, spellEffect: resolvers.spellEffect };
    return { command, ctx, facade };
  };
  const execute = (command: AgentCommand): number => game.registry.get(command.code)!(state, command);
  const carry = (bidx: number, note: string | null = null): number => {
    const book = player.cls.magic.books[bidx]!;
    for (const handle of state.gear.pack) {
      const object = state.gear.store.get(handle)!;
      if (object.tval === book.tvalIdx && object.sval === book.sval && object.note === note) return handle;
    }
    const kind = game.booted.registries.objects.lookupKind(book.tvalIdx, book.sval)!;
    const constants = game.booted.registries.constants;
    const object = Core.objectPrep(state.rng, game.booted.registries.objects, constants, kind, player.lev, "average");
    object.note = note;
    const handle = Core.invenCarry(state.gear, player, object, constants);
    Core.calcInventory(state.gear, game.booted.registries.constants);
    return handle;
  };
  return { game, player, borg, read, execute, carry, bridge };
}

describe.skipIf(CLASS_JSON === null)("spell progression through the engine and API 2 controller", () => {
  it("studies from the last matching pack slot when inscriptions split book stacks", async () => {
    const run = await caster("Mage");
    run.carry(0, "first");
    run.carry(0, "second");
    const { ctx, command } = await run.read();
    const books = ctx.view.inventory().filter((item) => item.tval === run.player.cls.magic.books[0]!.tvalIdx);
    expect(books).toHaveLength(2);
    expect(command?.code).toBe("study");
    expect(command?.args!["handle"]).toBe(books.at(-1)!.handle);
    expect(run.execute(command!)).toBeGreaterThan(0);
    await run.bridge.dispose();
  });

  it.each(["Mage", "Druid", "Priest", "Necromancer", "Paladin", "Rogue", "Ranger", "Blackguard"])("recognizes every %s book by its registered kind", async (cls) => {
    const initial = await caster(cls);
    const count = initial.player.cls.magic.books.length;
    await initial.bridge.dispose();
    for (let bidx = 0; bidx < count; bidx++) {
      const run = await caster(cls, 100000000);
      if (bidx > 0) {
        const first = run.player.cls.magic.books[0]!;
        for (const handle of [...run.game.state.gear.pack]) {
          const object = run.game.state.gear.store.get(handle)!;
          if (object.tval === first.tvalIdx && object.sval === first.sval) run.execute({ code: "drop", args: { handle, quantity: object.number } });
        }
      }
      const handle = run.carry(bidx);
      const { ctx } = await run.read();
      const book = run.player.cls.magic.books[bidx]!;
      expect(ctx.bookKind!(book.tvalIdx, book.name)).toEqual({ tval: book.tvalIdx, sval: book.sval });
      expect(borgBookPossessed(ctx, bidx)).toBe(true);
      expect(borgBookHandle(ctx, bidx)).toBe(handle);
      const command = borgPlayMagic(ctx, true)!;
      expect(command.code).toBe("study");
      expect(command.args!["handle"]).toBe(handle);
      /* Rogue's first book declares seven slots for six spells. The engine's
       * spellByIndex therefore indexes Arcane Control after a vacant slot. */
      if (cls === "Rogue" && bidx === 1) {
        await run.bridge.dispose();
        continue;
      }
      expect(run.execute(command)).toBeGreaterThan(0);
      const learned = (await run.read()).ctx.view.spellbooks().flatMap((b) => b.spells).find((spell) => spell.learned && spell.bidx === bidx);
      expect(learned).toBeDefined();
      const rating = ratingsForClass(ctx.world.self.trait[BI.CLASS]!)![learned!.sidx]!;
      expect(borgSpellLegal((await run.read()).ctx, rating.spell)).toBe(learned!.mana <= run.player.msp);
      await run.bridge.dispose();
    }
  });

  it.each(["Mage", "Druid", "Priest", "Necromancer", "Paladin", "Rogue", "Ranger", "Blackguard"])("learns and tests spells for a fresh %s through the ladder", async (cls) => {
    const run = await caster(cls, 200);
    let studies = 0;
    for (let attempt = 0; attempt < 15; attempt++) {
      const { ctx, command, facade } = await run.read();
      expect(ctx.world.self.trait[BI.ISSTUDY]).toBe(ctx.view.player().learnableSpells > 0 ? 1 : 0);
      for (const target of facade.take()) if ("x" in target) Core.targetSetLocation(run.game.state, target);
      if (command?.code === "study") {
        expect(run.execute(command)).toBeGreaterThan(0);
        studies++;
      } else break;
    }
    expect(studies).toBeGreaterThan(0);
    let tested = false;
    const codes: string[] = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      run.player.csp = run.player.msp;
      const { ctx, command, facade } = await run.read();
      codes.push(`${command?.code}:${String(command?.args?.["spell"])}`);
      if (command?.code === "study") { run.execute(command); continue; }
      if (command?.code !== "cast") continue;
      const sidx = command.args!["spell"] as number;
      const before = ctx.view.spellbooks().flatMap((b) => b.spells).find((s) => s.sidx === sidx)!;
      expect(borgSpellLegal(ctx, ratingsForClass(ctx.world.self.trait[BI.CLASS]!)![sidx]!.spell)).toBe(true);
      for (const target of facade.take()) if ("x" in target) Core.targetSetLocation(run.game.state, target);
      run.execute(command);
      const after = Core.createAgentView(run.game.state, undefined, { reg: run.game.booted.registries.objects }).spellbooks().flatMap((b) => b.spells).find((s) => s.sidx === sidx)!;
      if (!before.worked && after.worked) { tested = true; break; }
    }
    expect(tested, codes.join(" ")).toBe(true);
    await run.bridge.dispose();
  });

  it.each([
    { cls: "Mage", spell: Spell.BANISHMENT, name: "Banishment" },
    { cls: "Mage", spell: Spell.DIMENSION_DOOR, name: "Dimension Door" },
    { cls: "Mage", spell: Spell.MAGIC_MISSILE, name: "Magic Missile" },
    { cls: "Mage", spell: Spell.LIGHT_ROOM, name: "Light Room" },
    { cls: "Necromancer", spell: Spell.UNLEASH_CHAOS, name: "Unleash Chaos" },
  ])("completes the test cast of $name with its effect's target and prompt", async ({ cls, spell }) => {
    const run = await caster(cls, 100000000);
    const first = run.player.cls.magic.books[0]!;
    for (const handle of [...run.game.state.gear.pack]) {
      const object = run.game.state.gear.store.get(handle)!;
      if (object.tval === first.tvalIdx && object.sval === first.sval) run.execute({ code: "drop", args: { handle, quantity: object.number } });
    }
    let { ctx } = await run.read();
    const sidx = borgGetSpellNumber(ctx, spell);
    const view = ctx.view.spellbooks().flatMap((book) => book.spells).find((s) => s.sidx === sidx)!;
    const handle = run.carry(view.bidx);
    const book = run.player.cls.magic.books[view.bidx]!;
    for (const s of book.spells) expect(run.execute({ code: "study", args: { handle, spell: s.sidx } })).toBeGreaterThan(0);
    for (const s of book.spells.filter((s) => s.sidx > sidx)) {
      for (let attempt = 0; attempt < 50 && !(run.player.spellFlags[s.sidx]! & Core.PY_SPELL.WORKED); attempt++) {
        run.player.csp = run.player.msp;
        Core.targetSetLocation(run.game.state, run.game.state.actor.grid);
        run.execute({ code: "cast", args: { spell: s.sidx } });
      }
      expect(run.player.spellFlags[s.sidx]! & Core.PY_SPELL.WORKED).toBeTruthy();
    }
    let worked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      run.player.csp = run.player.msp;
      const next = await run.read();
      ctx = next.ctx;
      next.facade.take();
      const command = borgPlayMagic(ctx, true)!;
      const expected = spell === Spell.BANISHMENT ? { spell: sidx, tgtsymbol: "h" } : spell === Spell.DIMENSION_DOOR ? { spell: sidx, tgtdir: 5 } : { spell: sidx };
      expect(command.args).toEqual(expected);
      const targets = next.facade.take();
      expect(targets).toEqual(spell === Spell.BANISHMENT || spell === Spell.LIGHT_ROOM ? [] : [{ kind: "target", ...run.game.state.actor.grid }]);
      for (const target of targets) if ("x" in target) Core.targetSetLocation(run.game.state, target);
      expect(run.execute(command)).toBeGreaterThan(0);
      if (run.player.spellFlags[sidx]! & Core.PY_SPELL.WORKED) { worked = true; break; }
    }
    expect(worked).toBe(true);
    await run.bridge.dispose();
  });

  it.each(["Priest", "Paladin"])("lets the engine choose the %s prayer from the selected book", async (cls) => {
    const run = await caster(cls, 200);
    const { ctx, command } = await run.read();
    expect(run.player.cls.pflags.has(Core.PF.CHOOSE_SPELLS)).toBe(false);
    expect(command?.code).toBe("study");
    expect(run.execute(command!)).toBeGreaterThan(0);
    const learned = (await run.read()).ctx.view.spellbooks().flatMap((book) => book.spells).filter((s) => s.learned);
    expect(learned).toHaveLength(1);
    expect(learned[0]!.bidx).toBe(ctx.view.spellbooks().flatMap((book) => book.spells).find((s) => s.sidx === command!.args!["spell"])!.bidx);
    expect(learned[0]!.sidx).not.toBe(command!.args!["spell"]);
    await run.bridge.dispose();
  });

  it("reads study, hallucination and amnesia through the known player", async () => {
    const run = await caster("Mage");
    const initial = await run.read();
    const fail = borgSpellFailRate(initial.ctx, Spell.MAGIC_MISSILE);
    expect(initial.ctx.world.self.trait[BI.ISSTUDY]).toBe(1);
    run.player.timed[Core.TMD.IMAGE] = 10;
    run.player.timed[Core.TMD.AMNESIA] = 10;
    let { ctx } = await run.read();
    expect(ctx.world.self.trait[BI.ISIMAGE]).toBe(1);
    expect(ctx.world.self.trait[BI.ISFORGET]).toBe(1);
    expect(borgSpellFailRate(ctx, Spell.MAGIC_MISSILE)).toBe(Math.min(95, fail * 2));
    expect(borgPlayMagic(ctx, false)?.code).toBe("study");
    run.player.timed[Core.TMD.BLIND] = 10;
    ctx = (await run.read()).ctx;
    expect(borgPlayMagic(ctx, true)).toBeNull();
    run.player.timed[Core.TMD.BLIND] = 0;
    run.player.timed[Core.TMD.CONFUSED] = 10;
    ctx = (await run.read()).ctx;
    expect(borgPlayMagic(ctx, true)).toBeNull();
    await run.bridge.dispose();
  });
});
