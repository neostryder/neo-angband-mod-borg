/** B81: C home classification uses random-power ego metadata independently of rune knowledge. */
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentView, ItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import type { JsonRecord, KnownItem } from "@rpgm-tools/neo-angband-mod-sdk";
import { itemView } from "../api2/world.js";
import { itemAnalyzer, type ItemAnalyzer } from "../api2/records.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { BorgWorld } from "../world/model.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { borgNotice } from "../trait/trait.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { buildThinkSession, buildStoreDeps, primeSession } from "../think-session.js";
import { TV } from "../item/svals.js";
import { borgThinkHomeGrabUseless } from "./buy.js";
import { borgNoticeHome, borgPowerHomeFrom } from "./home.js";
import { needsIdent, isAware } from "../item/deps.js";

let analyze: ItemAnalyzer;
beforeAll(async () => {
  const ignore = "IGNORE_ACID | IGNORE_ELEC | IGNORE_FIRE | IGNORE_COLD";
  // Relevant composed-record fields match the shipped cloak egos. The content
  // call is synthetic; no hidden item knowledge or engine rule is changed.
  const tables: Record<string, JsonRecord[]> = {
    object: [{ cost: 1, attack: { hd: "0d0" } }],
    ego_item: [{ name: "of Aman", flags: [ignore, "RAND_HI_RES"], info: { cost: 4000 } },
      { name: "of Protection", flags: [ignore], info: { cost: 1500 } }],
    artifact: [], object_property: [],
  };
  analyze = await itemAnalyzer({ content: {
    records: async (name: string) => ({ ok: true, value: tables[name] ?? [] }),
  } } as unknown as Parameters<typeof itemAnalyzer>[0]);
});

function item(over: Partial<ItemView> & { unknownRunes?: boolean } = {}): ItemView {
  return itemView({ handle: 1, kindKey: "kind:0", aware: true, nameColor: "", label: "Cloak",
    baseName: "Cloak", carried: true, tval: TV.CLOAK, sval: 1, pval: 0, number: 1, weight: 10,
    ac: 1, toA: 15, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: ["IGNORE_ACID", "IGNORE_ELEC", "IGNORE_FIRE", "IGNORE_COLD"], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, charging: 0, inscription: null,
    unknownRunes: false, value: 10000, ...over } as KnownItem, analyze);
}
function scene(items: ItemView[], evaluator = true, home: ItemView[] = []) {
  const base = makeScenarioView({ player: { depth: 0, maxDepth: 10, level: 20, maxLevel: 20,
    hp: 100, maxHp: 100, grid: { x: 10, y: 10 } } });
  const shops = Array.from({ length: 8 }, (_, feat): StoreView => ({ feat, featName: "shop",
    isHome: feat === 7, owner: { name: "keeper", purse: 30000 },
    stock: feat === 7 ? home.map((entry, index) => ({ ...entry, index })) : [] }));
  const view: AgentView = { ...base, inventory: () => items, equipment: () => [], stores: () => shops };
  const ctx: BorgContext = { view, world: new BorgWorld(), act: makeFakeActions(), rng: makeBorgRng(1) };
  borgNotice(ctx);
  perceive(ctx.world, ctx.view, makePerceiveMemo());
  ctx.world.self.power = 10000;
  // A spare dagger has no loadout benefit in this scenario. Keep that score fixed
  // on both sides so the test isolates knowledge, rather than assuming an upgrade.
  const session = buildThinkSession(evaluator ? { loadoutPower: () => 10000 } : {});
  primeSession(session, ctx);
  // Isolate home classification from the independent store-wiring repair in
  // Neo PR64; use the public knowledge seams already present on master.
  return { ctx, deps: { ...buildStoreDeps(session), needsIdent, isAware } };
}

describe("home random-power ego classification (B81)", () => {
  const cloak = (handle: number, random = true, unknownRunes = false) => item({
    handle, tval: TV.CLOAK, modifiers: random ? [{ code: "STEALTH", value: 2 }] : [], ego: true, egoName: random ? "of Aman" : "of Protection", unknownRunes,
  });
  it("keeps known random-power egos out of the duplicate penalty", () => {
    const wares = [cloak(1), cloak(2)];
    const { ctx, deps } = scene([], true, wares);
    const counts = borgNoticeHome(ctx, { items: wares }, deps);
    expect(counts.num_duplicate_items).toBe(0);
    expect(borgPowerHomeFrom(ctx, counts)).toBe(borgPowerHomeFrom(ctx, { ...counts, num_duplicate_items: 0 }));
  });
  it("does not pull a useful random-power cloak from home as duplicate clutter", () => {
    const wares = [
      item({ ...cloak(1), resists: [{ element: "POIS", level: 1 }] }),
      item({ ...cloak(2), resists: [{ element: "CHAOS", level: 1 }] }),
    ];
    const { ctx, deps } = scene([], true, wares);
    expect(borgThinkHomeGrabUseless(ctx, deps)).toBe(false);
  });
  it("still penalizes known fixed-power duplicates", () => {
    const wares = [cloak(1, false), cloak(2, false)];
    const { ctx, deps } = scene([], true, wares);
    expect(borgNoticeHome(ctx, { items: wares }, deps).num_duplicate_items).toBe(1);
    expect(borgThinkHomeGrabUseless(ctx, deps)).toBe(true);
  });
  it.each([false, true])("counts only random-power unknown egos for the ID premium (random=%s)", (random) => {
    const wares = [cloak(1, random, true)];
    const { ctx, deps } = scene([], true, wares);
    const counts = borgNoticeHome(ctx, { items: wares }, deps);
    expect(counts.num_ego).toBe(random ? 1 : 0);
    expect(counts.home_un_id).toBe(1);
    expect(counts.num_duplicate_items).toBe(0);
  });
});
