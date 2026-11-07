import { registeredTorchFixture } from "../test/fixtures/known-light.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentView, ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { FEAT } from "./core-api.js";
import { makeScenarioView, makeFakeActions, type Scenario } from "./harness.js";
import { knownWorld } from "./harness-api2.js";
import { playerView } from "./api2/world.js";
import { BorgWorld, GOAL_DARK, GOAL_KILL, GOAL_TAKE, GOAL_VAULT } from "./world/model.js";
import { BORG_GLOW, BORG_IGNORE_MAP } from "./world/grid.js";
import { perceive, makePerceiveMemo } from "./perceive.js";
import { borgNotice, BI } from "./trait/index.js";
import { makeBorgRng } from "./rng.js";
import { makeCoreResolvers, type CoreResolverInput } from "./resolvers.js";
import { buildThinkSession, primeSession } from "./think-session.js";
import { borgThinkDungeon, borgThinkDungeonBrave } from "./think-ladder.js";
import { getFightState } from "./fight/index.js";
import { borgUpdateMonsterFear, getFearCaches } from "./danger/index.js";
import { SVAL, TV } from "./item/index.js";

function item(over: Partial<ItemView>): ItemView {
  return {
    handle: 1, kindKey: "", aware: true, nameColor: "", label: "item", tval: TV.AMULET, sval: 1, pval: 0, number: 1, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0,
    inscription: null, ...over,
  };
}

function run(options: {
  cells?: Scenario["cells"];
  monsters?: Scenario["monsters"];
  floor?: Scenario["floor"];
  player?: Scenario["player"];
  equipment?: ItemView[];
  spells?: boolean;
  fail?: number;
  maxRange?: number;
  width?: number;
  height?: number;
  raceRecord?: CoreResolverInput["raceRecord"];
} = {}) {
  const source = makeScenarioView({
    width: options.width ?? 100, height: options.height ?? 25,
    player: { grid: { x: 10, y: 10 }, depth: 5, maxDepth: 5, level: 30, maxLevel: 30,
      hp: 1000, maxHp: 1000, sp: 100, maxSp: 100, gold: 100000,
      stats: [118, 118, 118, 118, 118], skills: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
      status: { image: 0, amnesia: 0, terror: 0 }, ...options.player },
    cells: options.cells ?? { "5,10": { feat: FEAT.GRANITE }, "4,10": { feat: FEAT.PERM } },
    monsters: options.monsters ?? [], ...(options.floor ? { floor: options.floor } : {}),
  });
  const cls = source.player().cls;
  const bidx = cls === "Druid" ? 1 : 0;
  const tval = cls === "Druid" ? TV.NATURE_BOOK : TV.SHADOW_BOOK;
  const books: SpellbookView[] = options.spells ? Array.from({ length: bidx + 1 }, (_, index) => ({
    tval, realm: cls === "Druid" ? "nature" : "shadow", name: `book ${index}`,
    spells: index === bidx ? [{ name: cls === "Druid" ? "Turn Stone to Mud" : "Shatter Stone",
      sidx: cls === "Druid" ? 8 : 3, bidx, level: 8, mana: 3, fail: options.fail ?? 25,
      learned: true, worked: true, forgotten: false, studyEligible: false, infoLine: "" }] : [],
  })) : [];
  const equipment: Array<ItemView | null> = new Array<ItemView | null>(12).fill(null);
  for (const [i, gear] of (options.equipment ?? []).entries()) equipment[i + 2] = gear;
  // The ladder re-notices equipment; give this lit-gate fixture a real known Torch.
  const lit = registeredTorchFixture(); equipment[5] = lit.torch;
  const view: AgentView = {
    ...source, player: () => playerView({ ...knownWorld(source).player!, light: lit.light }, new Map()),
    inventory: () => [item({ handle: 99, tval: TV.FOOD, sval: SVAL.food.ration!, number: 5, value: 100 }),
      ...books.map((b, i) => item({ tval: b.tval, sval: i + 1, handle: i + 1 }))],
    equipment: () => equipment, spellbooks: () => books,
    constants: () => ({ ...source.constants(), maxRange: options.maxRange ?? 20 }),
  };
  const world = new BorgWorld();
  world.clock = 1000;
  const act = makeFakeActions();
  const ctx = { world, view, act, rng: makeBorgRng(1), bookKind: (kind: number, name: string) => {
    const index = books.findIndex((b) => b.tval === kind && b.name === name);
    return index < 0 ? null : { tval: kind, sval: index + 1 };
  } };
  borgNotice(ctx);
  const memo = makePerceiveMemo();
  perceive(world, view, memo);
  const session = buildThinkSession(makeCoreResolvers({ ...(options.raceRecord ? { raceRecord: options.raceRecord } : {}), objects: {
    lookupKind: () => null, findEgo: () => null, findArtifact: (name) => ({ activation: { name } }),
  } }));
  primeSession(session, ctx);
  session.flow.state.borgBegan = world.clock;
  getFightState(world).began = world.clock;
  return { ctx, session, act, memo, main: () => borgThinkDungeon(ctx, session), brave: () => borgThinkDungeonBrave(ctx, session) };
}

describe("vault decisions through the session and ladder", () => {
  it("detects interior permanent walls before choosing a vault over a distant remembered monster", () => {
    const { ctx, main } = run({
      cells: { "5,10": { feat: FEAT.GRANITE }, "4,10": { feat: FEAT.PERM }, "60,10": { inView: false } },
      monsters: [{ grid: { x: 60, y: 10 } }],
    });
    expect(ctx.world.facts.vaultOnLevel).toBe(true);
    expect(main()).toEqual({ code: "walk", dir: 4 });
    expect(ctx.world.self.goal.type).toBe(GOAL_VAULT);
  });

  it("excavates a vault wall from range before pursuing a distant monster", () => {
    const { ctx, session, act, main } = run({ player: { cls: "Druid" }, spells: true,
      cells: { "5,10": { feat: FEAT.GRANITE }, "4,10": { feat: FEAT.PERM }, "60,10": { inView: false } },
      monsters: [{ grid: { x: 60, y: 10 } }],
    });
    session.flow.state.vein.add(10, 5);
    expect(main()).toEqual({ code: "cast", args: { spell: 8 } });
    expect(act.targets).toEqual([{ x: 5, y: 10 }]);
    expect(ctx.world.map.at(5, 10).feat).toBe(FEAT.FLOOR);
    expect(ctx.world.map.at(5, 10).info & (BORG_GLOW | BORG_IGNORE_MAP)).toBe(BORG_GLOW | BORG_IGNORE_MAP);
    expect(session.flow.state.vein.num).toBe(0);
  });

  it("uses the constant range for close monsters before excavating", () => {
    const { ctx, session, main } = run({ player: { cls: "Druid" }, spells: true, maxRange: 25,
      cells: { "5,10": { feat: FEAT.GRANITE }, "4,10": { feat: FEAT.PERM }, "36,10": { inView: false } },
      monsters: [{ grid: { x: 36, y: 10 } }],
    });
    const kills = vi.spyOn(session.flow, "toKills");
    expect(main()).toEqual({ code: "walk", dir: 6 });
    expect(kills).toHaveBeenCalledWith(ctx, 26, false);
    expect(ctx.world.self.goal.type).toBe(GOAL_KILL);
  });

  it("tries the special-level targets in C order", () => {
    const { ctx, session, main } = run({ player: { cls: "Druid" }, spells: true });
    const kills = vi.spyOn(session.flow, "toKills");
    const takes = vi.spyOn(session.flow, "toTakes");
    const veins = vi.spyOn(session.flow, "toVein");
    expect(main()?.code).toBe("cast");
    expect(kills).toHaveBeenCalledWith(ctx, 21, false);
    expect(takes).toHaveBeenCalledWith(ctx, false, 35);
    expect(veins).toHaveBeenCalledWith(ctx, false, 35);
    const order = [kills, takes, veins].map((spy) => spy.mock.invocationCallOrder.at(-1)!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("defers a bored vault town trip until the C timeout", () => {
    for (const turns of [8000, 8001, 12000, 12001]) for (const vault of [false, true]) {
      const { ctx, brave } = run({ width: 198, height: 66,
        cells: vault ? { "100,30": { feat: FEAT.PERM } } : {},
      });
      getFightState(ctx.world).timeTown = turns;
      brave();
      expect(ctx.world.self.goal.rising).toBe(turns > (vault ? 12000 : 8000));
    }
  });

  it.each([[BI.AEZHEAL, 3], [BI.ALIFE, 1]])("defers potion delivery in a vault for trait %i", (trait, count) => {
    for (const vault of [false, true]) {
      const { ctx, brave } = run({ width: 198, height: 66,
        cells: vault ? { "100,30": { feat: FEAT.PERM } } : {},
      });
      ctx.world.self.trait[BI.PREP_BIG_FIGHT] = 1;
      ctx.world.self.trait[trait] = count;
      brave();
      expect(ctx.world.self.goal.rising).toBe(!vault);
    }
  });
});

describe("vault excavation guards and side effects", () => {
  it("keeps the excavated floor while unseen and refreshes it when seen", () => {
    const { ctx, memo, main } = run({ player: { cls: "Druid" }, spells: true });
    expect(main()?.code).toBe("cast");
    const remembered: AgentView = { ...ctx.view, cell: (x, y) => {
      const cell = ctx.view.cell(x, y);
      return cell && { ...cell, inView: false };
    } };
    perceive(ctx.world, remembered, memo);
    expect(ctx.world.map.at(5, 10).feat).toBe(FEAT.FLOOR);
    expect(ctx.world.facts.vaultOnLevel).toBe(true);
    perceive(ctx.world, ctx.view, memo);
    expect(ctx.world.map.at(5, 10).feat).toBe(FEAT.GRANITE);
    expect(ctx.world.map.at(5, 10).info & BORG_IGNORE_MAP).toBe(0);
  });

  it("uses max_range minus two and requires line of sight and a 30 percent spell", () => {
    for (const options of [
      { x: 17, blocked: false, fail: 25, cast: true },
      { x: 18, blocked: false, fail: 25, cast: false },
      { x: 17, blocked: true, fail: 25, cast: false },
      { x: 17, blocked: false, fail: 95, cast: false },
    ]) {
      const { ctx, main } = run({ player: { cls: "Druid", level: 8, stats: [10, 10, 10, 10, 10] },
        spells: true, fail: options.fail, maxRange: 9,
        cells: { [`${options.x},10`]: { feat: FEAT.GRANITE }, [`${options.x + 1},10`]: { feat: FEAT.PERM },
          ...(options.blocked ? { "13,10": { feat: FEAT.GRANITE } } : {}) },
      });
      expect(main()?.code === "cast").toBe(options.cast);
      expect(ctx.world.map.at(options.x, 10).feat).toBe(options.cast ? FEAT.FLOOR : FEAT.GRANITE);
    }
  });

  it("requires a castable digging spell even when a melting activation is equipped", () => {
    for (const spells of [false, true]) {
      const { ctx, main } = run({ player: { cls: "Blackguard" }, spells,
        equipment: [item({ handle: 42, artifact: true, artifactName: "STONE_TO_MUD", activation: true })],
      });
      expect(main()?.code).toBe(spells ? "activate" : "walk");
      expect(ctx.world.map.at(5, 10).feat).toBe(spells ? FEAT.FLOOR : FEAT.GRANITE);
    }
  });

  it("uses the spell, ring and activation order and restricts Shatter Stone to adjacent walls", () => {
    const ring = item({ handle: 43, tval: TV.RING, sval: SVAL.ring.digging!, activation: true });
    const activation = item({ handle: 42, artifact: true, artifactName: "STONE_TO_MUD", activation: true });
    for (const options of [
      { cls: "Druid", x: 5, equipment: [ring, activation], command: { code: "cast", args: { spell: 8 } } },
      { cls: "Blackguard", x: 5, equipment: [ring, activation], command: { code: "activate", args: { handle: 43 } } },
      { cls: "Blackguard", x: 5, equipment: [{ ...ring, timeout: 1 }, activation], command: { code: "activate", args: { handle: 42 } } },
      { cls: "Blackguard", x: 9, equipment: [], command: { code: "cast", args: { spell: 3 } } },
      { cls: "Blackguard", x: 5, equipment: [], command: { code: "walk", dir: 4 } },
    ]) {
      const { ctx, act, main } = run({ player: { cls: options.cls }, spells: true, equipment: options.equipment,
        cells: { [`${options.x},10`]: { feat: FEAT.GRANITE }, [`${options.x - 1},10`]: { feat: FEAT.PERM },
          [`${options.x - 1},9`]: { feat: FEAT.PERM } },
      });
      expect(main()).toEqual(options.command);
      expect(act.targets).toEqual([{ x: options.x, y: 10 }]);
      expect(ctx.world.map.at(options.x, 10).feat).toBe(options.command.code === "walk" ? FEAT.GRANITE : FEAT.FLOOR);
    }
  });
});

describe("vault wall steps through committed ladder flows", () => {
  it("melts walls before tunneling with the session spell and equipment dependencies", () => {
    for (const options of [
      { cls: "Druid", spells: true, equipment: [], command: { code: "cast", args: { spell: 8 } } },
      { cls: "Blackguard", spells: true, equipment: [], command: { code: "cast", args: { spell: 3 } } },
      { cls: "Warrior", spells: false, equipment: [item({ handle: 43, tval: TV.RING, sval: SVAL.ring.digging!, activation: true })], command: { code: "activate", args: { handle: 43 } } },
      { cls: "Warrior", spells: false, equipment: [item({ handle: 42, artifact: true, artifactName: "STONE_TO_MUD", activation: true })], command: { code: "activate", args: { handle: 42 } } },
    ]) {
      const { ctx, session, act, main } = run({ player: { cls: options.cls }, spells: options.spells, equipment: options.equipment,
        cells: { "9,10": { feat: FEAT.GRANITE }, "8,10": { feat: FEAT.PERM } },
      });
      const st = session.flow.state;
      st.flow.fill(255);
      st.flow[10 * 198 + 10] = 1;
      st.flow[10 * 198 + 9] = 0;
      st.vein.add(10, 9);
      ctx.world.self.goal.type = GOAL_VAULT;
      const draw = vi.spyOn(ctx.rng, "randint0");
      expect(main()).toEqual(options.command);
      expect(act.targets).toEqual([{ x: 9, y: 10 }]);
      expect(st.vein.num).toBe(0);
      expect(draw.mock.calls.some(([n]) => n === 500)).toBe(false);
    }
  });

  it("draws the loop abort before checking the vault exemption", () => {
    for (const vault of [false, true]) for (const value of [5, 6]) {
      const { ctx, session, main } = run({ cells: { "9,10": { feat: FEAT.GRANITE },
        ...(vault ? { "8,10": { feat: FEAT.PERM } } : {}) } });
      const st = session.flow.state;
      st.flow.fill(255);
      st.flow[10 * 198 + 10] = 1;
      st.flow[10 * 198 + 9] = 0;
      st.vein.add(10, 9);
      ctx.world.self.goal.type = GOAL_VAULT;
      const draw = vi.spyOn(ctx.rng, "randint0").mockImplementation((n) => n === 500 ? value : 1);
      const command = main();
      expect(draw).toHaveBeenCalledWith(500);
      expect(command?.code === "tunnel").toBe(vault || value === 6);
      expect(st.vein.num).toBe(vault || value === 6 ? 0 : 1);
    }
  });
});

describe("vault level perception and monster fear", () => {
  it("requires a known interior dungeon wall and resets the vault fact on level change", () => {
    for (const options of [
      { cells: { "0,10": { feat: FEAT.PERM } }, player: { depth: 5 }, vault: false },
      { cells: { "99,10": { feat: FEAT.PERM } }, player: { depth: 5 }, vault: false },
      { cells: { "5,0": { feat: FEAT.PERM } }, player: { depth: 5 }, vault: false },
      { cells: { "5,24": { feat: FEAT.PERM } }, player: { depth: 5 }, vault: false },
      { cells: { "5,10": { feat: FEAT.PERM } }, player: { depth: 0 }, vault: false },
      { cells: { "5,10": { feat: FEAT.PERM, known: false, inView: false } }, player: { depth: 5 }, vault: false },
      { cells: { "5,10": { feat: FEAT.PERM } }, player: { depth: 5 }, vault: true },
    ]) {
      const { ctx, memo, main } = run(options);
      main();
      expect(ctx.world.facts.vaultOnLevel).toBe(options.vault);
      const source = makeScenarioView({ player: { depth: 6 } });
      perceive(ctx.world, source, memo);
      expect(ctx.world.facts.vaultOnLevel).toBe(false);
    }
  });

  it("omits grid fear only for monsters adjacent to permanent vault walls", () => {
    for (const adjacent of [false, true]) {
      const { ctx, main } = run({ cells: { [adjacent ? "16,10" : "30,10"]: { feat: FEAT.PERM } },
        monsters: [{ grid: { x: 15, y: 10 }, level: 20 }],
        raceRecord: (ridx) => ({ ridx, flags: new Set<string>(), level: 20, sleep: 0, spellPower: 0,
          freqInnate: 0, freqSpell: 0, hasFriends: false, spells: [],
          blows: [{ dice: 10, sides: 10, effect: "HURT" }] }),
      });
      borgUpdateMonsterFear(ctx);
      const total = getFearCaches(ctx.world).monsters2d.flat().reduce((sum, n) => sum + n, 0);
      expect(total === 0).toBe(adjacent);
      expect(main()).not.toBeNull();
    }
  });
});

describe("vault target priority", () => {
  it("takes remembered objects within 35 before excavating", () => {
    for (const x of [45, 46]) {
      const { ctx, main } = run({ player: { cls: "Druid" }, spells: true,
        cells: { "5,10": { feat: FEAT.GRANITE }, "4,10": { feat: FEAT.PERM }, [`${x},10`]: { inView: false } },
        floor: { [`${x},10`]: [item({ tval: TV.AMULET })] },
      });
      expect(main()).toEqual(x === 45 ? { code: "walk", dir: 6 } : { code: "cast", args: { spell: 8 } });
      if (x === 45) expect(ctx.world.self.goal.type).toBe(GOAL_TAKE);
    }
  });

  it("mines remembered veins within 35 before excavating", () => {
    for (const x of [45, 46]) {
      const { ctx, session, main } = run({ player: { cls: "Druid", gold: 1000 }, spells: true,
        cells: { "5,10": { feat: FEAT.GRANITE }, "4,10": { feat: FEAT.PERM }, [`${x},10`]: { feat: FEAT.QUARTZ_K, inView: false } },
      });
      session.flow.state.vein.add(10, x);
      expect(main()).toEqual(x === 45 ? { code: "walk", dir: 6 } : { code: "cast", args: { spell: 8 } });
      if (x === 45) expect(ctx.world.self.goal.type).toBe(GOAL_TAKE);
    }
  });

  it("explores nearby interesting grids before pursuing distant monsters on vault levels", () => {
    const { ctx, main } = run({ cells: { "80,10": { feat: FEAT.PERM },
      "8,10": { feat: FEAT.NONE, inView: false }, "60,10": { inView: false } },
      monsters: [{ grid: { x: 60, y: 10 } }],
    });
    expect(main()).toEqual({ code: "walk", dir: 4 });
    expect(ctx.world.self.goal.type).toBe(GOAL_DARK);
  });
});
