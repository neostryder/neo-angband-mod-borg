/**
 * borg_notice derives the item-dependent traits from the items, the stats and
 * the race/class records (borg-trait.c:1233-2050, 2914-2924), not from the
 * engine's figures for the gear actually worn. That is what lets a loadout the
 * character is not wearing be scored in-process, as borg_best_stuff does.
 *
 * Oracle: at birth the engine's own calc_bonuses (a 4.2.6 port) and C Borg
 * agree on every skill except where C Borg adds its own terms - the stealth
 * "bonus one" (:1994) and the weapon weight on digging (:1983) - and the shot
 * count, which C Borg keeps as a count rather than the engine's tenths.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { ItemView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "../world/model.js";
import { makeFakeActions, makeScenarioView } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { BI } from "./trait-index.js";
import { borgNotice } from "./trait.js";
import { frameBook } from "./frame.js";
import { TV } from "../item/svals.js";

const DIR = dirname(createRequire(import.meta.url).resolve("@rpgm-tools/neo-angband-content/pack/class.json"));
const json = (n: string) => JSON.parse(readFileSync(join(DIR, `${n}.json`), "utf8")) as { records: Record<string, unknown>[] };
const records = (n: string) => json(n).records;
const PACK = {
  constants: json("constants"), terrain: records("terrain"), roomTemplates: records("room_template"), vaults: records("vault"),
  dungeonProfiles: records("dungeon_profile"), projection: records("projection"), trap: records("trap"), names: records("names"), quest: records("quest"),
  obj: Object.fromEntries(Object.entries({ objectBase: "object_base", object: "object", egoItem: "ego_item", artifact: "artifact", curse: "curse", brand: "brand", slay: "slay", activation: "activation", objectProperty: "object_property", flavor: "flavor" }).map(([k, f]) => [k, json(f)])),
  mon: Object.fromEntries(Object.entries({ pain: "pain", blowMethods: "blow_methods", blowEffects: "blow_effects", monsterSpells: "monster_spell", monsterBases: "monster_base", monsters: "monster", summons: "summon", pits: "pit" }).map(([k, f]) => [k, records(f)])),
  player: Object.fromEntries(Object.entries({ races: "p_race", classes: "class", properties: "player_property", timed: "player_timed", shapes: "shape", bodies: "body", history: "history", realms: "realm" }).map(([k, f]) => [k, records(f)])),
} as unknown as Core.GamePack;
const FRAME = frameBook(records("p_race"), records("class"));

function noticed(view: BorgContext["view"]): number[] {
  const ctx: BorgContext = { world: new BorgWorld(), view, act: makeFakeActions(), rng: makeBorgRng(), frame: FRAME };
  borgNotice(ctx);
  return ctx.world.self.trait;
}

describe("derived traits agree with the game at birth", () => {
  const CLASSES = ["Warrior", "Mage", "Druid", "Priest", "Necromancer", "Paladin", "Rogue", "Ranger", "Blackguard"];
  const RACES = ["Human", "Dwarf", "High-Elf", "Hobbit", "Half-Troll"];
  it.each(CLASSES.flatMap((cls) => RACES.map((race) => [cls, race])))("%s %s", (cls, race) => {
    const game = Core.startGame(PACK, { seed: 7, depth: 0, className: cls, raceName: race });
    const view = Core.createAgentView(game.state, undefined, { reg: game.booted.registries.objects });
    const t = noticed(view);
    const p = view.player();
    const sk = p.skills;
    expect([t[BI.DISP], t[BI.DISM], t[BI.DEV], t[BI.SAV], t[BI.SRCH], t[BI.THN], t[BI.THB], t[BI.THT]])
      .toEqual([sk[0], sk[1], sk[2], sk[3], sk[4], sk[6], sk[7], sk[8]]);
    /* C's stealth "bonus one"; where the engine shows 0 it may have clamped a
     * negative raw value, which C also clamps after its +1. */
    if (sk[5]! > 0) expect(t[BI.STL]).toBe(Math.min(30, sk[5]! + 1));
    else expect([0, 1]).toContain(t[BI.STL]);
    const weapon = view.equipment()[0];
    expect(t[BI.DIG]).toBe(sk[9]! + (weapon ? Math.trunc(weapon.weight / 10) : 0));
    expect(t[BI.BLOWS]).toBe(Math.max(1, Math.trunc(p.blows / 100)));
    expect([t[BI.SPEED], t[BI.INFRA]]).toEqual([p.speed, p.seeInfra]);
  });
});

describe("derived traits that the worn gear does not decide", () => {
  const boots = { handle: 5, kindKey: "", aware: true, nameColor: "", label: "boots", tval: TV.BOOTS, sval: 1, pval: 3, number: 1, weight: 20, ac: 2, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: true, artifact: false, flags: [], modifiers: [{ code: "SPEED", value: 3 }], brands: [], slays: [], resists: [], curses: [], timeout: 0 } as unknown as ItemView;
  const feet = (item: ItemView | null): Array<ItemView | null> => [null, null, null, null, null, null, null, null, null, null, null, item];

  it("counts worn speed once, from the item (engine speed 113 with +3 boots)", () => {
    const base = makeScenarioView({ player: { race: "Human", cls: "Warrior", speed: 113 } });
    const t = noticed({ ...base, equipment: () => feet(boots) });
    expect(t[BI.SPEED]).toBe(113);
  });

  it("adds haste (+10) as the C does from the timed effect", () => {
    const t = noticed(makeScenarioView({ player: { race: "Human", cls: "Warrior", speed: 120, status: { fast: 20 } } }));
    expect(t[BI.SPEED]).toBe(120);
  });

  it("scales skills by ten-level increments of the maximum level", () => {
    /* Human Warrior melee: c_skills 70 + x_skills 45 * 30 / 10. */
    const t = noticed(makeScenarioView({ player: { race: "Human", cls: "Warrior", level: 30, maxLevel: 30 } }));
    expect(t[BI.THN]).toBe(70 + 135);
  });
});

describe("hitpoints as the C values them (borg-trait.c:1836)", () => {
  /* Level-30 Human Warrior, natural CON 10 (12 with the Warrior's +2), rolled
   * player_hp[29] = 299, with or without a +5 CON ring: CON 17 or 12. */
  const conRing = { handle: 6, kindKey: "", aware: true, nameColor: "", label: "ring", tval: TV.RING, sval: 1, pval: 5, number: 1, weight: 1, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false, flags: [], modifiers: [{ code: "CON", value: 5 }], brands: [], slays: [], resists: [], curses: [], timeout: 0 } as unknown as ItemView;
  const hp = (ring: boolean): number => {
    const base = makeScenarioView({ player: { race: "Human", cls: "Warrior", level: 30, maxLevel: 30, maxHp: 329, stats: [10, 10, 10, 10, 10] } });
    const equipment: Array<ItemView | null> = Array(12).fill(null);
    if (ring) equipment[2] = conRing;
    const ctx: BorgContext = { world: new BorgWorld(), view: { ...base, equipment: () => equipment }, act: makeFakeActions(), rng: makeBorgRng(), frame: FRAME };
    borgNotice(ctx, { frame: { ...FRAME("Human", "Warrior")!, playerHp: 299 } });
    return ctx.world.self.trait[BI.HP_ADJ]!;
  };

  it("follows the CON the loadout gives: 299 + adj_con_mhp * 30 / 100", () => {
    expect(hp(true)).toBe(299 + 30);
    expect(hp(false)).toBe(299 + 1);
  });
});
