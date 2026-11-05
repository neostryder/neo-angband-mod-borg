/** B81: production store wiring must retain the item analysis already used by inventory. */
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
import { borgGoodSell, borgCountSell, borgThinkShopSellUseless, borgThinkShopSell } from "./sell.js";
import { borgNoticeHome } from "./home.js";
import { itemValue, isAware, isIdent, needsIdent, isOneRing } from "./store.js";

let analyze: ItemAnalyzer;
beforeAll(async () => {
  const tables: Record<string, JsonRecord[]> = {
    object: [{ cost: 100, attack: { hd: "1d4" } }, { cost: 200, attack: { hd: "1d4" } }],
    ego_item: [], artifact: [{ name: "'The One Ring'", cost: 5000, act: "BIZARRE" }],
    object_property: [{ type: "flag", code: "AGGRAVATE", power: -10 }],
  };
  analyze = await itemAnalyzer({ content: {
    records: async (name: string) => ({ ok: true, value: tables[name] ?? [] }),
  } } as unknown as Parameters<typeof itemAnalyzer>[0]);
});

function item(over: Partial<ItemView> & { unknownRunes?: boolean } = {}): ItemView {
  return itemView({ handle: 1, kindKey: "kind:0", aware: true, nameColor: "", label: "spare dagger",
    baseName: "Dagger", carried: true, tval: TV.SWORD, sval: 1, pval: 0, number: 1, weight: 12,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 1, ds: 4, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, charging: 0, inscription: null,
    unknownRunes: false, value: 100, ...over } as KnownItem, analyze);
}
function scene(items: ItemView[], evaluator = true) {
  const base = makeScenarioView({ player: { depth: 0, maxDepth: 10, level: 20, maxLevel: 20,
    hp: 100, maxHp: 100, grid: { x: 10, y: 10 } } });
  const shops = Array.from({ length: 3 }, (_, feat): StoreView => ({ feat, featName: "shop",
    isHome: false, owner: { name: "keeper", purse: 30000 }, stock: [] }));
  const view: AgentView = { ...base, inventory: () => items, equipment: () => [], stores: () => shops };
  const ctx: BorgContext = { view, world: new BorgWorld(), act: makeFakeActions(), rng: makeBorgRng(1) };
  borgNotice(ctx);
  perceive(ctx.world, ctx.view, makePerceiveMemo());
  ctx.world.self.power = 10000;
  // A spare dagger has no loadout benefit in this scenario. Keep that score fixed
  // on both sides so the test isolates knowledge, rather than assuming an upgrade.
  const session = buildThinkSession(evaluator ? { loadoutPower: () => 10000 } : {});
  primeSession(session, ctx);
  return { ctx, deps: buildStoreDeps(session) };
}

describe("store decisions receive C item knowledge", () => {
  it("keeps a single unknown-rune weapon instead of selecting it for sale", () => {
    const { ctx, deps } = scene([item({ unknownRunes: true })]);
    expect(borgGoodSell(ctx, ctx.view.inventory()[0]!, 2, deps)).toBe(false);
    expect(borgThinkShopSellUseless(ctx, deps)).toBe(false);
    expect(borgCountSell(ctx, deps)).toBe(0);
  });
  it("does not count the unknown-rune spare as saleable stair-choice loot", () => {
    const { ctx, deps } = scene([item({ unknownRunes: true })]);
    expect(borgCountSell(ctx, deps)).toBe(0);
  });
  it("retains the unknown-rune guard on the full sale selector", () => {
    const { ctx, deps } = scene([item({ unknownRunes: true })]);
    expect(borgThinkShopSellUseless(ctx, deps)).toBe(false);
  });
  it("selects the cheaper unit-price stack rather than the cheaper stack total", () => {
    const { ctx, deps } = scene([item({ number: 4, value: 400 }),
      item({ handle: 2, kindKey: "kind:1", value: 200 })]);
    expect(borgThinkShopSellUseless(ctx, deps)).toBe(true);
    expect(borgThinkShopSell(ctx, 2, deps)).toMatchObject({ code: "shop-sell", args: { handle: 1 } });
  });
  it("still selects and emits the sale for the fully known control", () => {
    const { ctx, deps } = scene([item()]);
    expect(borgThinkShopSellUseless(ctx, deps)).toBe(true);
    expect(borgThinkShopSell(ctx, 2, deps)).toMatchObject({ code: "shop-sell", args: { handle: 1 } });
  });
  it.each([false, true])("counts unidentified home wares with loadout evaluator=%s", (evaluator) => {
    const unknown = item({ unknownRunes: true });
    const { ctx, deps } = scene([], evaluator);
    expect(borgNoticeHome(ctx, { items: [unknown] }, deps).home_un_id).toBe(1);
    expect(borgNoticeHome(ctx, { items: [item()] }, deps).home_un_id).toBe(0);
    expect(isAware(item({ aware: false }), deps)).toBe(false);
    expect(isIdent(unknown, deps)).toBe(false);
    expect(needsIdent(unknown, deps)).toBe(true);
  });
  it("prices a stack per item and preserves charge rounding", () => {
    const { deps } = scene([]);
    expect(itemValue(item({ number: 4, value: 400 }), deps)).toBe(100);
    expect(itemValue(item({ tval: TV.WAND, number: 2, pval: 3, value: 999 }), deps)).toBe(115);
  });
  it("rejects adverse-flag value while retaining the One Ring exception", () => {
    const { deps } = scene([]);
    expect(itemValue(item({ flags: ["AGGRAVATE"], value: 2000 }), deps)).toBe(0);
    const ring = item({ tval: TV.RING, artifact: true, artifactName: "'The One Ring'", flags: ["AGGRAVATE"], value: 8000 });
    expect(isOneRing(ring, deps)).toBe(true);
    expect(itemValue(ring, deps)).toBe(5000);
  });
});
