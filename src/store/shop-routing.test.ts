/**
 * Getting to a shop: the pieces borg_flow_shop_entry needs.
 *
 * - borg_update_map records each shop door it sees: ag->store and
 *   track_shop_x/y[square_shopnum] (borg-update.c, "Shop Doors").
 * - borg_flow_shop_entry flows to that door, and re-enters a shop the Borg is
 *   already standing on with keypress '5', stay in place (borg-flow-misc.c:780).
 * - A level change clears goal.shop/ware/item to -1 (borg-update.c:2128), and
 *   town entry asks for the home optimisation (borg-update.c:2155-2157).
 */

import { describe, expect, it } from "vitest";
import { BorgWorld } from "../world/model.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { FEAT } from "../core-api.js";
import { perceive, makePerceiveMemo } from "../perceive.js";
import { createFlow } from "../flow/index.js";
import { BORG_HOME } from "./store.js";
import { borgChooseShop } from "./think-store.js";
import { borgNotice } from "../trait/trait.js";

function town(cells: Record<string, { feat: number }>, at = { x: 20, y: 10 }): BorgContext {
  const base = makeScenarioView({ player: { grid: at, depth: 0 }, cells });
  const view = { ...base, stores: () => Array.from({ length: 8 }, (_, index) => ({
    feat: FEAT.STORE_GENERAL + index, featName: "Store", isHome: index === BORG_HOME,
    owner: { name: "", purse: 0 }, stock: [],
  })) };
  const world = new BorgWorld();
  world.wipeLevel(0);
  const ctx: BorgContext = { world, view, act: makeFakeActions(), rng: makeBorgRng() };
  perceive(world, view, makePerceiveMemo());
  borgNotice(ctx);
  return ctx;
}

describe("shop doors (borg-update.c Shop Doors, borg-flow-misc.c:780)", () => {
  it("records the door of every shop it sees, indexed as square_shopnum", () => {
    const ctx = town({
      "30,10": { feat: FEAT.STORE_GENERAL },
      "35,8": { feat: FEAT.HOME },
    });
    const flow = createFlow();
    flow.toShop(ctx, 0);
    expect([flow.state.shopX[0], flow.state.shopY[0]]).toEqual([30, 10]);
    expect([flow.state.shopX[BORG_HOME], flow.state.shopY[BORG_HOME]]).toEqual([35, 8]);
    expect(ctx.world.map.at(30, 10).store).toBe(0);
    expect(ctx.world.map.at(35, 8).store).toBe(BORG_HOME);
  });

  it("flows to a seen shop's door, and not to one it has not seen", () => {
    const ctx = town({ "30,10": { feat: FEAT.STORE_GENERAL } });
    const flow = createFlow();
    expect(flow.toShop(ctx, 0)).toMatchObject({ code: "walk", dir: 6 });
    /* Control: shop 1 has no recorded door, so there is nowhere to go. */
    expect(flow.toShop(ctx, 1)).toBeNull();
  });

  it("re-enters the shop it stands on by holding still, not by walking direction 5", () => {
    const ctx = town({ "20,10": { feat: FEAT.STORE_GENERAL } });
    expect(createFlow().toShop(ctx, 0)).toEqual({ code: "hold" });
  });
});

describe("shop goals on a new level (borg-update.c:2128, 2155-2157)", () => {
  it("starts with no shop goal", () => {
    const world = new BorgWorld();
    expect([world.self.goal.shop, world.self.goal.ware, world.self.goal.item]).toEqual([-1, -1, -1]);
    world.wipeLevel(3);
    expect([world.self.goal.shop, world.self.goal.ware, world.self.goal.item]).toEqual([-1, -1, -1]);
  });

  it("chooses the home on town entry so the gear can be optimised", () => {
    const ctx = town({ "30,10": { feat: FEAT.STORE_GENERAL } });
    expect(ctx.world.self.goal.doBest).toBe(true);
    expect(borgChooseShop(ctx)).toBe(true);
    expect(ctx.world.self.goal.shop).toBe(BORG_HOME);
  });

  it("control: with no optimisation asked, a town visit with nothing to do chooses no shop", () => {
    const ctx = town({ "30,10": { feat: FEAT.STORE_GENERAL } });
    ctx.world.self.goal.doBest = false;
    expect(borgChooseShop(ctx)).toBe(false);
    expect(ctx.world.self.goal.shop).toBe(-1);
  });
});
