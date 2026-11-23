/**
 * The race/class frame (#68): borg_notice adds race->r_adj + class->c_adj to
 * each stat before indexing it (borg-trait.c:1795-1834), and borg_power's
 * armour-weight mana penalty reads class->magic.spell_weight / total_spells.
 * The expected numbers come from the game's own p_race / class records.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ItemView } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "../world/model.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { BI } from "./trait-index.js";
import { borgNotice } from "./trait.js";
import { borgPower } from "./power.js";
import { frameBook, frameFromRecords } from "./frame.js";
import { frameRecords } from "../api2/records.js";
import { TV } from "../item/svals.js";
import { createBorg } from "../controller.js";
import { makeCoreResolvers } from "../resolvers.js";

type Json = Record<string, unknown>;
const pack = (file: string): Json[] =>
  (JSON.parse(readFileSync(createRequire(import.meta.url).resolve(`@rpgm-tools/neo-angband-content/pack/${file}.json`), "utf8")) as { records: Json[] }).records;
const RACES = pack("p_race");
const CLASSES = pack("class");
const named = (records: Json[], name: string) => records.find((r) => r["name"] === name);

function character(race: string, cls: string, withFrame: boolean, equipment: Array<ItemView | null> = []): BorgContext {
  const base = makeScenarioView({ player: { race, cls, level: 20, maxLevel: 20, stats: [10, 10, 10, 10, 10] } });
  const view = { ...base, equipment: () => equipment };
  const ctx: BorgContext = { world: new BorgWorld(), view, act: makeFakeActions(), rng: makeBorgRng() };
  if (withFrame) ctx.frame = frameBook(RACES, CLASSES);
  return ctx;
}

describe("the race/class frame from the game's records", () => {
  it("adds race and class stat adjustments, and reads the class magic block", () => {
    /* Dwarf r_adj (+2, -3, +2, -2, +2) + Warrior c_adj (+3, -2, -2, +2, +2). */
    expect(frameFromRecords(named(RACES, "Dwarf"), named(CLASSES, "Warrior"))).toMatchObject({
      statAdj: [5, -5, 0, 0, 4],
      totalSpells: 0,
    });
    /* Rogue: first spell at level 5, 350 lb armour allowance, 6 + 4 spells. */
    expect(frameFromRecords(named(RACES, "Human"), named(CLASSES, "Rogue"))).toMatchObject({
      spellFirst: 5,
      spellWeight: 350,
      totalSpells: 10,
    });
  });

  it("frameRecords reads both record files, and gives no frame without them", async () => {
    const api = (records: boolean) => ({
      content: {
        records: (file: string) => Promise.resolve(records ? { ok: true as const, value: file === "p_race" ? RACES : CLASSES } : { ok: false as const }),
      },
    });
    const frame = await frameRecords(api(true) as never);
    expect(frame?.("Human", "Warrior")?.statAdj).toEqual([3, -2, -2, 2, 2]);
    expect(frame?.("Human", "No Such Class")).toBeNull();
    expect(await frameRecords(api(false) as never)).toBeNull();
  });
});

describe("borg_notice with the frame (borg-trait.c:1795-1834)", () => {
  it("indexes each stat after the race and class adjustments", () => {
    const ctx = character("Human", "Warrior", true);
    borgNotice(ctx);
    const t = ctx.world.self.trait;
    expect([t[BI.STR], t[BI.INT], t[BI.WIS], t[BI.DEX], t[BI.CON]]).toEqual([13, 8, 8, 12, 12]);
    /* stat_cur itself is unchanged: CSTR is the natural value. */
    expect(t[BI.CSTR]).toBe(10);
  });

  it("control: without the race/class records the stats stay natural", () => {
    const ctx = character("Human", "Warrior", false);
    borgNotice(ctx);
    const t = ctx.world.self.trait;
    expect([t[BI.STR], t[BI.INT]]).toEqual([10, 10]);
  });
});

describe("borg_power's armour-weight mana penalty (class->magic.spell_weight)", () => {
  /* 50 lb of body armour: 500 tenth-pounds, over a Mage's 300 allowance. */
  const plate = { handle: 9, kindKey: "", aware: true, nameColor: "", label: "plate", tval: TV.HARD_ARMOR, sval: 1, pval: 0, number: 1, weight: 500, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [], timeout: 0 } as unknown as ItemView;
  const worn = (item: ItemView | null): Array<ItemView | null> => [null, null, null, null, null, null, item, null, null, null, null, null];
  const delta = (cls: string): number => {
    const scored = (item: ItemView | null) => {
      const ctx = character("Human", cls, true, worn(item));
      borgNotice(ctx);
      return borgPower(ctx);
    };
    const unframed = (item: ItemView | null) => {
      const ctx = character("Human", cls, false, worn(item));
      borgNotice(ctx);
      return borgPower(ctx);
    };
    return (scored(plate) - scored(null)) - (unframed(plate) - unframed(null));
  };

  it("costs a caster for armour over its allowance", () => {
    expect(delta("Mage")).toBeLessThan(0);
  });

  it("control: a class without magic pays nothing", () => {
    expect(delta("Warrior")).toBe(0);
  });
});

describe("the controller hands the frame to every think", () => {
  it("uses the host's race/class records through the resolvers", () => {
    const view = makeScenarioView({ player: { race: "Human", cls: "Warrior", stats: [10, 10, 10, 10, 10] } });
    const borg = createBorg({ resolvers: makeCoreResolvers({ frame: frameBook(RACES, CLASSES) }) });
    borg.controller(view, makeFakeActions());
    expect(borg.world.self.trait[BI.STR]).toBe(13);
  });
});
