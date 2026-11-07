import { afterEach, expect, it } from "vitest";
import type { ItemView } from "@rpgm-tools/neo-angband-core";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { BorgWorld } from "../world/model.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { resetBorgCfg } from "./config.js";
import { borgNotice } from "./trait.js";
import { borgSimulatePower, borgSimulateDanger } from "./simulate.js";
import { getDerived } from "./state.js";
import { TV } from "../item/svals.js";

afterEach(resetBorgCfg);

/* borg_notice(bool notice_swap), borg-trait.c:2825. The C passes false for its
 * hypothetical loadouts (borg-item-wear.c:339, 602, 667), so the weapon backup
 * stays whatever the last full notice found. */

function sword(): ItemView {
  return { handle: 7, kindKey: "kind:0", nameColor: "", label: "known test sword", aware: true,
    tval: TV.SWORD, sval: 1, pval: 0, number: 1, weight: 100, ac: 0,
    toA: 0, toH: 3, toD: 4, dd: 2, ds: 6, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0,
    inscription: null, value: 1000 };
}

/** A view that carries a spare sword and simulates a loadout with no pack at all. */
function view(): BorgContext["view"] {
  const base = makeScenarioView();
  const player = { ...base.player(), maxDepth: 60 };
  return {
    ...base,
    player: () => player,
    inventory: () => [sword()],
    simulateLoadout: () => ({ after: { player, equipment: [], inventory: [] } }),
  } as unknown as BorgContext["view"];
}

function context(): BorgContext {
  return { view: view(), world: new BorgWorld(), act: makeFakeActions(), rng: makeBorgRng(1) };
}

it("keeps the last full notice's backup when noticeSwap is false", () => {
  const ctx = context();
  borgNotice(ctx);
  const found = getDerived(ctx.world).weaponSwap;
  expect(found.handle).toBe(7);
  expect(found.value).toBeGreaterThan(1000);

  /* The pack no longer holds the sword, but a hypothetical notice must not know that. */
  const emptied = { ...ctx, view: { ...ctx.view, inventory: () => [] } } as BorgContext;
  borgNotice(emptied, { noticeSwap: false });
  expect(getDerived(ctx.world).weaponSwap).toEqual(found);

  borgNotice(emptied);
  expect(getDerived(ctx.world).weaponSwap).toEqual({ handle: null, value: -1 });
});

it("scores a simulated loadout with the live backup, as the C does", () => {
  const live = context();
  borgNotice(live);
  const found = getDerived(live.world).weaponSwap.value;
  expect(found).toBeGreaterThan(1000);

  /* Same simulated loadout, but no earlier notice, so the backup is the -1 sentinel. */
  const cold = context();
  const withLive = borgSimulatePower(live, {});
  const withoutLive = borgSimulatePower(cold, {});
  expect(withLive! - withoutLive!).toBe(found + 1);
});

it("leaves the live backup untouched by a simulation", () => {
  const ctx = context();
  borgNotice(ctx);
  const before = { ...getDerived(ctx.world).weaponSwap };
  borgSimulatePower(ctx, {});
  borgSimulateDanger(ctx, {});
  expect(getDerived(ctx.world).weaponSwap).toEqual(before);
});
