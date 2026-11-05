import { describe, expect, it, vi } from "vitest";
import type { AgentView, ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness.js";
import { knownWorld } from "../harness-api2.js";
import { playerView } from "../api2/world.js";
import { BorgWorld } from "../world/model.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { borgNearMonsterType } from "../perceive-facts.js";
import { borgNotice } from "../trait/trait.js";
import { makeBorgRng } from "../rng.js";
import { makeCoreResolvers } from "../resolvers.js";
import { buildThinkSession, primeSession } from "../think-session.js";
import { SVAL, TV } from "../item/index.js";
import { borgPlayStep } from "./flow.js";
import { BI, FEAT } from "./flow-consts.js";

function item(over: Partial<ItemView>): ItemView {
  return {
    handle: 1, kindKey: "", aware: true, nameColor: "", label: "item", tval: TV.AMULET, sval: 1, pval: 0, number: 1, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0,
    inscription: null, ...over,
  };
}

function activation(name: string, handle = 42, timeout = 0): ItemView {
  return item({ handle, artifact: true, artifactName: name, activation: true, timeout });
}

/* The spell identities and book positions follow class.json's class-wide indices. */
function book(cls: string): SpellbookView[] {
  const [bidx, sidx, name, mana, level, fail, tval, realm] = cls === "Mage"
    ? [2, 13, "Disable Traps, Destroy Doors", 5, 5, 30, TV.MAGIC_BOOK, "arcane"] as const
    : cls === "Druid"
      ? [1, 8, "Turn Stone to Mud", 3, 8, 25, TV.NATURE_BOOK, "nature"] as const
      : [0, 3, "Shatter Stone", 3, 7, 20, TV.SHADOW_BOOK, "shadow"] as const;
  return Array.from({ length: bidx + 1 }, (_, index) => ({
    tval, realm, name: `book ${index}`,
    spells: index === bidx ? [{ name, sidx, bidx, level, mana, fail, learned: true, worked: true, forgotten: false, studyEligible: false, infoLine: "" }] : [],
  }));
}

function step(options: {
  trap?: boolean;
  player?: Scenario["player"];
  monsters?: Scenario["monsters"];
  equipment?: ItemView[];
  inventory?: ItemView[];
  spells?: boolean;
  panelTime?: number;
} = {}) {
  const source = makeScenarioView({
    player: { grid: { x: 10, y: 10 }, level: 25, maxLevel: 25, depth: 5, sp: 100, maxSp: 100, ...options.player },
    cells: { "11,10": options.trap ? { trap: true } : { feat: FEAT.CLOSED } },
    monsters: options.monsters ?? [],
  });
  const books = options.spells ? book(source.player().cls) : [];
  const equipment: Array<ItemView | null> = new Array<ItemView | null>(12).fill(null);
  for (const [index, gear] of (options.equipment ?? []).entries()) equipment[index + 2] = gear;
  const inventory = options.inventory ?? books.map((b, index) => item({ tval: b.tval, sval: index + 1, handle: index + 1 }));
  const known = knownWorld(source).player;
  if (known === null) throw new Error("the scenario has a player");
  const status = source.player().status;
  const player = playerView({
    ...known,
    status: {
      ...known.status,
      terror: null,
      amnesia: null,
      image: null,
      blind: status.blind ? "Blind" : null,
      confused: status.confused ? "Confused" : null,
      afraid: status.afraid ? "Afraid" : null,
    },
  }, new Map());
  const view: AgentView = {
    ...source,
    player: () => player,
    equipment: () => equipment,
    inventory: () => inventory,
    spellbooks: () => books,
  };
  const world = new BorgWorld();
  const act = makeFakeActions();
  /* The fixture's pack holds each class book at its 1-based position, so the
   * shared book lookup answers with that position as the sval. */
  const bookKind = (tval: number, name: string) => {
    const position = books.findIndex((b) => b.tval === tval && b.name === name);
    return position < 0 ? null : { tval, sval: position + 1 };
  };
  const ctx = { world, view, act, rng: makeBorgRng(), bookKind };
  borgNotice(ctx);
  perceive(world, view, makePerceiveMemo());
  const session = buildThinkSession(makeCoreResolvers({
    objects: {
      lookupKind: () => null,
      findEgo: () => null,
      findArtifact: (name) => ({ activation: { name } }),
    },
  }));
  primeSession(session, ctx);
  borgNearMonsterType(ctx, 20);
  const flow = session.flow.state;
  flow.closed.add(10, 11);
  world.self.timeThisPanel = options.panelTime ?? 500;
  return { ctx, flow, act, play: () => borgPlayStep(ctx, flow, 10, 11) };
}

describe("borg_play_step through the session item dependencies", () => {
  /* borg-flow.c:903-913, 969-987; borg-item-use.c:936-948. */
  it.each([
    ["DISABLE_TRAPS", true, true, 1],
    ["DESTROY_DOORS", false, false, 1],
    ["STONE_TO_MUD", false, true, 0],
  ] as const)("resolves %s on charged equipment", (name, trap, targeted, closed) => {
    const { ctx, flow, act, play } = step({ trap, equipment: [activation(name)], player: { sp: 0 } });
    expect(play()).toEqual({ code: "activate", args: { handle: 42 } });
    expect(act.targets).toEqual(targeted ? [{ x: 11, y: 10 }] : []);
    expect(flow.closed.num).toBe(closed);
    expect(ctx.world.self.noRestPrep).toBe(trap ? 3000 : 0);
    expect(ctx.world.map.at(11, 10).trap).toBe(false);
  });

  it.each(["DISABLE_TRAPS", "DESTROY_DOORS", "STONE_TO_MUD"])("falls back when %s is charging or carried in the pack", (name) => {
    for (const gear of [{ equipment: [activation(name, 42, 1)] }, { inventory: [activation(name)] }]) {
      const { ctx, flow, act, play } = step({ trap: name === "DISABLE_TRAPS", ...gear });
      expect(play()?.code).toBe(name === "DISABLE_TRAPS" ? "disarm" : "open");
      expect(act.targets).toEqual([]);
      expect(ctx.world.self.noRestPrep).toBe(0);
      expect(flow.closed.num).toBe(name === "DISABLE_TRAPS" ? 1 : 0);
    }
  });

  /* borg-flow.c:903 precedes :918; :968 precedes :969 and :975-977. */
  it("prefers the trap activation to its spell", () => {
    const { play } = step({ trap: true, equipment: [activation("DISABLE_TRAPS")], player: { cls: "Mage" }, spells: true });
    expect(play()).toEqual({ code: "activate", args: { handle: 42 } });
  });

  it.each([80, 81])("gates the trap spell at %i of 100 mana", (sp) => {
    const { ctx, act, play } = step({ trap: true, player: { cls: "Mage", sp }, spells: true });
    expect(ctx.world.self.trait[BI.CURSP]).toBe(sp);
    expect(play()).toEqual(sp === 81 ? { code: "cast", args: { spell: 13 } } : { code: "disarm", dir: 6 });
    expect(ctx.world.self.noRestPrep).toBe(sp === 81 ? 3000 : 0);
    expect(ctx.world.map.at(11, 10).trap).toBe(false);
    expect(act.targets).toEqual([]);
  });

  it("uses the trap spell after a charging activation", () => {
    const { play } = step({ trap: true, equipment: [activation("DISABLE_TRAPS", 42, 1)], player: { cls: "Mage" }, spells: true });
    expect(play()).toEqual({ code: "cast", args: { spell: 13 } });
  });

  it.each([
    { light: 0 },
    { status: { blind: 1 } },
    { status: { confused: 1 } },
  ])("walks across a trap when the player guard rejects disarming: %j", (player) => {
    const { ctx, act, play } = step({ trap: true, player, equipment: [activation("DISABLE_TRAPS")] });
    expect(play()).toEqual({ code: "walk", dir: 6 });
    expect(ctx.world.map.at(11, 10).trap).toBe(true);
    expect(ctx.world.self.noRestPrep).toBe(0);
    expect(act.targets).toEqual([]);
  });

  it("prefers the destruction spell to destruction and melting activations", () => {
    const { flow, act, play } = step({ player: { cls: "Mage", sp: 10 }, spells: true, equipment: [activation("DESTROY_DOORS"), activation("STONE_TO_MUD", 43)] });
    expect(play()).toEqual({ code: "cast", args: { spell: 13 } });
    expect(flow.closed.num).toBe(1);
    expect(act.targets).toEqual([]);
  });

  it("prefers the destruction activation to the melting activation", () => {
    const { flow, play } = step({ equipment: [activation("DESTROY_DOORS"), activation("STONE_TO_MUD", 43)] });
    expect(play()).toEqual({ code: "activate", args: { handle: 42 } });
    expect(flow.closed.num).toBe(1);
  });

  it.each([["Druid", 8], ["Blackguard", 3]] as const)("prefers the %s melting spell to item melting", (cls, spell) => {
    const { flow, act, play } = step({ player: { cls }, spells: true, equipment: [activation("STONE_TO_MUD")] });
    expect(play()).toEqual({ code: "cast", args: { spell } });
    expect(flow.closed.num).toBe(0);
    expect(act.targets).toEqual([{ x: 11, y: 10 }]);
  });

  it("prefers a charged digging ring to the melting activation", () => {
    const ring = item({ handle: 44, tval: TV.RING, sval: SVAL.ring.digging!, activation: true });
    const { flow, act, play } = step({ equipment: [activation("STONE_TO_MUD"), ring] });
    expect(play()).toEqual({ code: "activate", args: { handle: 44 } });
    expect(flow.closed.num).toBe(0);
    expect(act.targets).toEqual([{ x: 11, y: 10 }]);
  });

  it("walks across a trap when perception records a scary monster", () => {
    const { ctx, play } = step({ trap: true, player: { level: 5 }, monsters: [{ race: "Grip", grid: { x: 15, y: 10 } }], equipment: [activation("DISABLE_TRAPS")] });
    expect(ctx.world.facts.scaryGuyOnLevel).toBe(true);
    expect(play()).toEqual({ code: "walk", dir: 6 });
    expect(ctx.world.map.at(11, 10).trap).toBe(true);
    expect(ctx.world.self.noRestPrep).toBe(0);
  });
});

describe("borg_play_step door random draws (borg-flow.c:941-966)", () => {
  it.each([499, 500])("draws twice before opening at %i panel turns", (panelTime) => {
    const { ctx, flow, play } = step({ panelTime });
    const draw = vi.spyOn(ctx.rng, "randint0").mockReturnValueOnce(1).mockReturnValueOnce(1);
    expect(play()).toEqual({ code: "open", dir: 6 });
    expect(draw.mock.calls).toEqual([[100], [100]]);
    expect(flow.closed.num).toBe(0);
  });

  it("stops at the paranoia draw before attempting magic", () => {
    const { ctx, flow, act, play } = step({ equipment: [activation("DESTROY_DOORS")] });
    const draw = vi.spyOn(ctx.rng, "randint0").mockReturnValue(0);
    expect(play()).toBeNull();
    expect(draw.mock.calls).toEqual([[100]]);
    expect(flow.closed.num).toBe(1);
    expect(act.log).toEqual([]);
  });

  it.each([[14, false, 1], [14, true, 2], [15, false, 2]] as const)("checks adjacent monsters at level %i with fear %s", (level, afraid, draws) => {
    const { ctx, act, play } = step({ player: { level, status: { afraid: afraid ? 1 : 0 } }, monsters: [{ grid: { x: 10, y: 11 } }] });
    expect(ctx.world.map.at(10, 11).kill).toBeGreaterThan(0);
    const draw = vi.spyOn(ctx.rng, "randint0").mockReturnValue(1);
    expect(play()?.code ?? null).toBe(draws === 1 ? null : "open");
    expect(draw.mock.calls).toEqual(Array.from({ length: draws }, () => [100]));
    if (draws === 1) expect(act.log).toEqual([]);
  });

  it.each([[0, 499, "activate"], [1, 499, "open"], [1, 500, "activate"]] as const)("uses the second draw %i and panel time %i", (second, panelTime, code) => {
    const { ctx, play } = step({ panelTime, equipment: [activation("DESTROY_DOORS")] });
    const draw = vi.spyOn(ctx.rng, "randint0").mockReturnValueOnce(1).mockReturnValueOnce(second);
    expect(play()?.code).toBe(code);
    expect(draw.mock.calls).toEqual([[100], [100]]);
  });
});
