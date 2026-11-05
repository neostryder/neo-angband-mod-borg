import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentView, ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import type { BorgContext } from "../context.js";
import { FEAT, REST_ALL_POINTS } from "../core-api.js";
import { makeScenarioView, type Scenario } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import { createActFacade } from "../api2/act.js";
import { BorgWorld } from "../world/model.js";
import { BORG_GLOW, BORG_LIGHT, BORG_MARK } from "../world/grid.js";
import { BI, borgNotice, classIndexFromName } from "../trait/index.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { buildThinkSession, primeSession, buildItemDeps } from "../think-session.js";
import { makeCoreResolvers } from "../resolvers.js";
import { borgThinkDungeon, borgThinkDungeonLight, borgThinkDungeonBrave } from "../think-ladder.js";
import { borgCaution } from "../fight/caution.js";
import { borgDefend } from "../fight/defend.js";
import { getFearCaches } from "../danger/index.js";
import { borgRecover } from "./recover.js";
import { borgReadScroll, borgReadUnknown } from "./item-use.js";
import { borgSpell, borgSpellFailRate, ratingsForClass, Spell } from "./magic.js";
import * as light from "./light.js";
import { SVAL, TV } from "./svals.js";

afterEach(() => vi.restoreAllMocks());

function item(over: Partial<ItemView> = {}): ItemView {
  return {
    handle: 1, kindKey: "", aware: true, nameColor: "", label: "item", tval: TV.AMULET, sval: 1, pval: 0, number: 1, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0,
    inscription: null, ...over,
  };
}

function scenario(options: {
  player?: Scenario["player"];
  cells?: Scenario["cells"];
  monsters?: Scenario["monsters"];
  spells?: Spell[];
  mana?: number;
  fail?: number;
  inventory?: ItemView[];
  equipment?: ItemView[];
  glow?: boolean;
  food?: number;
  forceDescend?: boolean;
} = {}) {
  const base = makeScenarioView({
    player: { cls: "Mage", grid: { x: 10, y: 10 }, depth: 5, level: 25, maxLevel: 25,
      hp: 100, maxHp: 100, light: 0, sp: 10, maxSp: 20, ...options.player },
    cells: { "10,10": { glow: options.glow ?? true }, ...options.cells },
    monsters: options.monsters ?? [],
  });
  const cls = base.player().cls;
  const tval = cls === "Mage" ? TV.MAGIC_BOOK : cls === "Necromancer" ? TV.SHADOW_BOOK : TV.PRAYER_BOOK;
  const ratings = ratingsForClass(classIndexFromName(cls)) ?? [];
  const books: SpellbookView[] = [{
    tval, name: "book", realm: "test",
    spells: (options.spells ?? [Spell.LIGHT_ROOM]).map((spell) => ({
      name: Spell[spell], sidx: ratings.findIndex((r) => r.spell === spell), bidx: 0,
      mana: options.mana ?? 2, level: 1, fail: options.fail ?? 30, learned: true, worked: true,
      forgotten: false, studyEligible: false, infoLine: "",
    })),
  }];
  const view: AgentView = {
    ...base,
    spellbooks: () => books,
    inventory: () => [item({ tval, handle: 7 }),
      item({ tval: TV.FOOD, sval: SVAL.food.ration!, number: options.food ?? 10, handle: 8 }),
      ...(options.inventory ?? [])],
    equipment: () => options.equipment ?? [],
  };
  const world = new BorgWorld();
  const { act } = createActFacade();
  const ctx: BorgContext = { world, view, act, rng: makeBorgRng(), bookKind: (tval) => ({ tval, sval: 1 }) };
  borgNotice(ctx);
  perceive(world, view, makePerceiveMemo());
  world.clock = 100;
  const session = buildThinkSession({
    ...makeCoreResolvers({ objects: {
      lookupKind: () => null, findEgo: () => null,
      findArtifact: (name) => ({ activation: { name } }),
    } }),
    forceDescend: options.forceDescend ?? false,
  });
  primeSession(session, ctx);
  return { ctx, world, act, session, run: () => borgThinkDungeon(ctx, session),
    light: () => borgThinkDungeonLight(ctx, session),
    brave: () => borgThinkDungeonBrave(ctx, session) };
}

describe("no-light ladder illumination (borg-think-dungeon-util.c:251-319)", () => {
  it.each([
    ["Mage", Spell.LIGHT_ROOM, 1], ["Priest", Spell.CALL_LIGHT, 0], ["Paladin", Spell.CALL_LIGHT, 2],
  ] as const)("casts %s illumination on glow before fleeing", (cls, spell, sidx) => {
    const s = scenario({ player: { cls }, spells: [spell] });
    s.session.flow.state.less.add(10, 14);
    const draw = vi.spyOn(s.ctx.rng, "randint0");
    expect(s.run()).toEqual({ code: "cast", args: { spell: sidx } });
    expect(s.world.self.whenCallLight).toBe(100);
    expect(draw).not.toHaveBeenCalled();
  });

  it("casts without the recovery failure cap", () => {
    const s = scenario({ player: { level: 1, maxLevel: 1 }, fail: 50 });
    expect(borgSpellFailRate(s.ctx, Spell.LIGHT_ROOM)).toBeGreaterThan(40);
    expect(s.run()).toEqual({ code: "cast", args: { spell: 1 } });
  });

  it.each([[0, true], [92, true], [93, false], [94, false]] as const)("uses call-light timestamp %i at turn 100", (last, casts) => {
    expect(scenario().light()?.code).toBe("cast");
    const s = scenario();
    s.world.self.whenCallLight = last;
    expect(s.light()).toEqual(casts ? { code: "cast", args: { spell: 1 } } : null);
    expect(s.world.self.whenCallLight).toBe(casts ? 100 : last);
  });

  it("skips glowing neighbors and walls, then finds a dark neighbor", () => {
    expect(scenario().light()?.code).toBe("cast");
    const s = scenario();
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) s.world.map.at(x, y).info = BORG_MARK | BORG_GLOW;
    s.world.map.at(10, 11).feat = FEAT.RUBBLE;
    s.world.map.at(10, 11).info = 0;
    expect(s.light()).toBeNull();
    s.world.map.at(9, 9).info = BORG_MARK;
    expect(s.light()).toEqual({ code: "cast", args: { spell: 1 } });
  });

  it("uses a session activation before spells in complete darkness", () => {
    const s = scenario({ glow: false, equipment: [item({ handle: 42, artifact: true, artifactName: "ILLUMINATION", activation: true })] });
    const draw = vi.spyOn(s.ctx.rng, "randint0");
    expect(s.run()).toEqual({ code: "activate", args: { handle: 42 } });
    expect(s.world.self.whenCallLight).toBe(100);
    expect(draw).not.toHaveBeenCalled();
  });

  it("uses a charged staff in complete darkness", () => {
    const s = scenario({ glow: false, inventory: [item({ handle: 42, tval: TV.STAFF, sval: SVAL.staff.light!, pval: 1 })] });
    const draw = vi.spyOn(s.ctx.rng, "randint0");
    expect(s.run()).toEqual({ code: "use-staff", args: { handle: 42 } });
    expect(draw).not.toHaveBeenCalled();
  });

  it("tries the directional beam after room illumination fails", () => {
    const s = scenario({ glow: false, spells: [], cells: { "10,9": { known: false, feat: FEAT.NONE } },
      inventory: [item({ handle: 42, tval: TV.WAND, sval: SVAL.wand.light!, pval: 1 })] });
    expect(s.run()).toEqual({ code: "aim-wand", args: { handle: 42 }, dir: 8 });
    expect(s.world.self.whenCallLight).toBe(0);
  });
});

describe("rest on glow (borg-think-dungeon-util.c:203-249)", () => {
  it("rests for HP and mana before fleeing without drawing randomness", () => {
    const s = scenario({ player: { sp: 0 } });
    const draw = vi.spyOn(s.ctx.rng, "randint0");
    expect(s.run()).toEqual({ code: "rest", args: { count: REST_ALL_POINTS } });
    expect(draw).not.toHaveBeenCalled();
  });

  it.each(["no glow", "weak", "food", "no spell", "adjacent monster", "regional fear", "monster fear"])("rejects rest with %s", (guard) => {
    expect(scenario({ player: { sp: 0 } }).light()).toEqual({ code: "rest", args: { count: REST_ALL_POINTS } });
    const s = scenario({ player: { sp: 0, ...(guard === "weak" ? { status: { food: 0 } } : {}) },
      glow: guard !== "no glow", food: guard === "food" ? 4 : 10,
      spells: guard === "no spell" ? [] : [Spell.LIGHT_ROOM],
      monsters: guard === "adjacent monster" ? [{ grid: { x: 11, y: 10 } }] : [] });
    const fear = getFearCaches(s.world);
    if (guard === "regional fear") fear.region2d[0]![0] = 11;
    if (guard === "monster fear") fear.monsters2d[10]![10] = 11;
    expect(s.light()?.code ?? null).not.toBe("rest");
  });

  it("accepts fear equal to HP divided by ten", () => {
    const s = scenario({ player: { sp: 0 } });
    const fear = getFearCaches(s.world);
    fear.region2d[0]![0] = 10;
    fear.monsters2d[10]![10] = 10;
    expect(s.light()).toEqual({ code: "rest", args: { count: REST_ALL_POINTS } });
  });

  it("waits nine turns for recall before trying illumination", () => {
    const s = scenario();
    s.world.self.goal.recalling = 10;
    expect(s.run()).toEqual({ code: "rest", args: { count: 9 } });
  });
});

describe("glow supplies reading light (borg-magic.c:430; borg-item-use.c:158)", () => {
  it("casts on glow while retaining blindness and darkness guards", () => {
    expect(borgSpell(scenario().ctx, Spell.LIGHT_ROOM)?.code).toBe("cast");
    expect(borgSpell(scenario({ glow: false }).ctx, Spell.LIGHT_ROOM)).toBeNull();
    expect(borgSpell(scenario({ player: { status: { blind: 1 } } }).ctx, Spell.LIGHT_ROOM)).toBeNull();
  });

  it.each([true, false])("reads the light scroll on glow with awareness %s", (aware) => {
    const s = scenario({ spells: [], inventory: [item({ handle: 42, tval: TV.SCROLL, sval: SVAL.scroll.light!, aware })] });
    const read = aware ? borgReadScroll(s.ctx, SVAL.scroll.light!, buildItemDeps(s.session)) : borgReadUnknown(s.ctx, buildItemDeps(s.session));
    expect(read).toEqual({ code: "read", args: { handle: 42 } });
    if (aware) expect(s.run()).toEqual(read);
  });
});

describe("fuel in caution (borg-caution.c:1211-1227)", () => {
  it("refuels before proceeding to escape", () => {
    const s = scenario({ spells: [], equipment: [item({ tval: TV.LIGHT, sval: SVAL.light.lantern!, timeout: 0 })],
      inventory: [item({ handle: 42, tval: TV.FLASK, sval: SVAL.flask.oil! })] });
    expect(borgCaution(s.ctx, s.session.flow.state)).toEqual({ code: "refill", args: { handle: 42 } });
  });

  it("sets leaving when dungeon fuel is unavailable", () => {
    const s = scenario({ spells: [] });
    borgCaution(s.ctx, s.session.flow.state);
    expect(s.world.self.goal.leaving).toBe(true);
  });
});

describe("caution fuel timeout (borg-caution.c:810)", () => {
  it("allows backing away when the equipped lantern has at least 250 fuel", () => {
    for (const timeout of [249, 1000]) {
      const s = scenario({ spells: [], equipment: [item({ tval: TV.LIGHT, sval: SVAL.light.lantern!, timeout })] });
      getFearCaches(s.world).monsters2d[10]![10] = 100;
      expect(borgCaution(s.ctx, s.session.flow.state)?.code ?? null).toBe(timeout === 1000 ? "walk" : null);
    }
  });
});

describe("corridor beams (borg-light.c:673-904; borg-fight-defend.c:2802-2810)", () => {
  function corridor(options: Parameters<typeof scenario>[0] = {}) {
    return scenario({ player: { light: 1, sp: 20 }, spells: [],
      cells: { "10,8": { known: false, feat: FEAT.NONE }, "9,10": { feat: FEAT.GRANITE, passable: false },
        "11,10": { feat: FEAT.GRANITE, passable: false } },
      inventory: [item({ handle: 42, tval: TV.WAND, sval: SVAL.wand.light!, pval: 1 })], ...options });
  }

  it("uses the charged wand through the defense simulation and execution", () => {
    const s = corridor();
    s.world.self.temp.needSeeInvis = 100;
    expect(borgDefend(s.ctx, 0)).toEqual({ code: "aim-wand", args: { handle: 42 }, dir: 8 });
  });

  it("uses the same direction through the brave ladder", () => {
    expect(corridor().brave()).toEqual({ code: "aim-wand", args: { handle: 42 }, dir: 8 });
  });

  it("uses the C's 20 percent spell failure limit", () => {
    for (const fail of [20, 21]) {
      const s = corridor({ player: { cls: "Priest", light: 1, level: 1, maxLevel: 1 },
        spells: [Spell.SPEAR_OF_LIGHT], inventory: [], fail });
      s.world.self.temp.needSeeInvis = 100;
      expect(borgDefend(s.ctx, 0)).toEqual(fail === 20 ? { code: "cast", args: { spell: 7 }, dir: 8 } : null);
    }
  });

  it("rejects the C's north and south panel-edge rows", () => {
    for (const [y, dy, dir, blocked] of [[12, -1, 8, false], [13, -1, 8, true], [17, 1, 2, false], [18, 1, 2, true]] as const) {
      const s = scenario({ player: { grid: { x: 10, y }, light: 1 }, spells: [],
        cells: { [`10,${y + dy * 2}`]: { feat: FEAT.NONE, known: false } },
        inventory: [item({ handle: 42, tval: TV.WAND, sval: SVAL.wand.light!, pval: 1 })] });
      expect(light.borgLightBeam(s.ctx, buildItemDeps(s.session))).toEqual(blocked ? null : { code: "aim-wand", args: { handle: 42 }, dir });
    }
  });

  it("chooses east and west after north and south are known", () => {
    for (const [x, dir] of [[12, 6], [8, 4]] as const) {
      const s = scenario({ player: { light: 1 }, spells: [], cells: { [`${x},10`]: { feat: FEAT.NONE, known: false } },
        inventory: [item({ handle: 42, tval: TV.WAND, sval: SVAL.wand.light!, pval: 1 })] });
      expect(light.borgLightBeam(s.ctx, buildItemDeps(s.session))).toEqual({ code: "aim-wand", args: { handle: 42 }, dir });
    }
  });

  it("does not beam into a known floor or a closed door", () => {
    for (const feat of [FEAT.FLOOR, FEAT.CLOSED]) {
      const s = corridor({ cells: { "10,8": { feat }, "10,12": { feat: FEAT.GRANITE },
        "12,10": { feat: FEAT.GRANITE }, "8,10": { feat: FEAT.GRANITE } } });
      expect(light.borgLightBeam(s.ctx, buildItemDeps(s.session))).toBeNull();
    }
  });

  it("keeps the C's zero-radius west loop empty", () => {
    expect(corridor().brave()).toEqual({ code: "aim-wand", args: { handle: 42 }, dir: 8 });
    const s = scenario({ spells: [], cells: { "9,10": { known: false, feat: FEAT.NONE } },
      inventory: [item({ tval: TV.WAND, sval: SVAL.wand.light!, pval: 1 })] });
    expect(s.light()).toBeNull();
  });
});

describe("recovery illumination scans (borg-light.c:139-220)", () => {
  it("counts remembered diagonal walls before recovery rest", () => {
    const s = scenario({ player: { light: 1, hp: 90 },
      equipment: [item({ artifact: true, artifactName: "ILLUMINATION", activation: true, handle: 42 })] });
    for (const [x, y] of [[9, 9], [11, 9], [9, 11]] as const) s.world.map.at(x, y).feat = FEAT.GRANITE;
    expect(borgRecover(s.ctx, buildItemDeps(s.session))?.code).toBe("rest");
  });

  it("counts torchlight flags instead of visible floors before recovery rest", () => {
    const s = scenario({ player: { light: 2, hp: 90 },
      equipment: [item({ artifact: true, artifactName: "ILLUMINATION", activation: true, handle: 42 })] });
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) s.world.map.at(x, y).info &= ~BORG_LIGHT;
    expect(borgRecover(s.ctx, buildItemDeps(s.session))?.code).toBe("rest");
  });
});

describe("late detection (borg-think-dungeon.c:2042-2044, 2074-2076)", () => {
  it("checks both fallback slots only when the door timestamp is absent or 500 turns old", () => {
    for (const last of [0, 1, 2]) {
      const s = scenario({ player: { light: 1, sp: 20 }, spells: [] });
      s.world.clock = 501;
      s.world.self.whenDetectDoors = last;
      for (let y = 0; y < s.world.map.height; y++) for (let x = 0; x < s.world.map.width; x++) {
        s.world.map.at(x, y).feat = FEAT.PERM;
      }
      s.world.map.at(10, 10).feat = FEAT.FLOOR;
      const detect = vi.spyOn(light, "borgCheckLight");
      const search = vi.spyOn(s.session.flow, "spastic");
      s.run();
      expect(search.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([false, true]);
      expect(detect).toHaveBeenCalledTimes(last === 2 ? 1 : 3);
      if (last !== 2) {
        expect(detect.mock.invocationCallOrder[1]).toBeLessThan(search.mock.invocationCallOrder[0]!);
        expect(detect.mock.invocationCallOrder[2]).toBeGreaterThan(search.mock.invocationCallOrder[0]!);
        expect(detect.mock.invocationCallOrder[2]).toBeLessThan(search.mock.invocationCallOrder[1]!);
      }
      vi.restoreAllMocks();
    }
  });
});

describe("lantern maintenance (borg-light.c:544-658)", () => {
  it("clears shop goals after refuelling", () => {
    const s = scenario({ equipment: [item({ tval: TV.LIGHT, sval: SVAL.light.lantern! })],
      inventory: [item({ handle: 42, tval: TV.FLASK, sval: SVAL.flask.oil! })] });
    const goal = s.world.self.goal;
    goal.shop = goal.ware = goal.item = 3;
    expect(light.borgMaintainLight(s.ctx, buildItemDeps(s.session)).cmd).toEqual({ code: "refill", args: { handle: 42 } });
    expect([goal.shop, goal.ware, goal.item]).toEqual([-1, -1, -1]);
  });

  it("stops spare-lantern scanning at the next item type", () => {
    const s = scenario({ equipment: [item({ tval: TV.LIGHT, sval: SVAL.light.lantern! })], inventory: [
      item({ handle: 40, tval: TV.LIGHT, sval: SVAL.light.lantern!, flags: ["NO_FUEL"] }),
      item({ handle: 41 }),
      item({ handle: 42, tval: TV.LIGHT, sval: SVAL.light.lantern!, number: 2, timeout: 1000 }),
    ] });
    expect(light.borgMaintainLight(s.ctx, buildItemDeps(s.session)).need).toBe(light.BorgNeed.UNMET_NEED);
  });
});

describe("darkness recovery (borg-light.c:44-99)", () => {
  it("counts remembered floor terrain before calling darkness", () => {
    const cells: NonNullable<Scenario["cells"]> = {};
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) cells[`${x},${y}`] = { glow: true };
    const s = scenario({ player: { cls: "Necromancer", light: 1, hp: 90 }, spells: [Spell.CREATE_DARKNESS], cells });
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) {
      if ((y - 8) * 5 + x - 8 < 16 && (x !== 10 || y !== 10)) s.world.map.at(x, y).feat = FEAT.GRANITE;
    }
    expect(borgRecover(s.ctx, buildItemDeps(s.session))?.code).toBe("rest");
  });
});
