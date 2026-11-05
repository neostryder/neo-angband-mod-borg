/**
 * Wear/equip decisions from borg-item-wear.c: borg_wear_stuff, borg_best_stuff
 * and the ammo predicate borg_is_ammo.
 *
 * borg_wear_stuff simulates wearing each carried item (borg_notice/borg_power on
 * the swapped loadout) and wears whichever raises borg.power the most. The frozen
 * contract cannot re-run notice on a hypothetical loadout here, so the power of a
 * candidate loadout is provided by the `wearEval` seam. Home optimization uses
 * `bestEval` to score combinations in the C slot order and keeps a plan across
 * stash, retrieve, takeoff and wear commands (borg-item-wear.c:1077-1428).
 * Without the seam nothing improves on the current power, so the borg wears
 * nothing (the safe default). borg_remove_stuff lives in junk.ts (borgRemoveStuff).
 */

import type { BorgContext, ItemView, AgentCommand } from "./types.js";
import { BI } from "../trait/trait-index.js";
import { TV } from "./svals.js";
import type { ItemDeps } from "./deps.js";
import { trait, isAware, isIdent, isCursed, itemValue, canRest, needsIdent, packItems } from "./deps.js";
import { SVAL } from "./svals.js";
import { mod as modOf } from "../trait/item-util.js";
import type { BorgLoadoutChange, BorgLoadoutRef } from "../trait/simulate.js";
import {
  BORG_HOME, borgHomeFull, borgInventoryFull, homeWares, isOneRing,
  type StoreDeps,
} from "../store/store.js";

/** Wear-specific seams. */
export interface WearDeps extends ItemDeps {
  /** A free pack slot exists to push equipment into (borg_first_empty; def true). */
  hasHole?: boolean;
  /** birth_randarts option (skip un-IDd randart artifacts); default false. */
  randarts?: boolean;
  /** borg.power if `item` were worn (the C's borg_notice/borg_power sim). */
  wearEval?: (item: ItemView) => number;
  /** Power for a complete equipment combination (borg-item-wear.c:1229). */
  bestEval?: (choices: NonNullable<BorgLoadoutChange["wieldAt"]>) => number | null;
  /** A cursed item has a curse with power below 100 (borg-item-analyze.c:347). */
  uncursable?: (item: ItemView) => boolean;
  /**
   * borg_began: the Borg clock when it arrived on this level, for the
   * "been sitting here forever" guard (wear.c:779). Default 0, which with a
   * clock of 0 reads as "just arrived" and lets the scan run.
   */
  began?: number;
}

export interface RechargeDeps extends WearDeps {
  /** Continue the C's queued wear + R75 sequence on the next command. */
  restAfterWear?: (handle: number) => void;
}

/** borg_wear_recharge (borg-item-wear.c:1449-1535) queues wearing and R75. */
export function borgWearRecharge(ctx: BorgContext, d?: RechargeDeps): AgentCommand | null {
  if (!canRest(d) || trait(ctx, BI.ISWEAK)) return null;
  let best: ItemView | null = null;
  let worn = false;
  // borg-item-wear.c:1464 scans pack and equipment through INVEN_TOTAL.
  const pack = packItems(ctx);
  for (const [items, equipped] of [[pack, false], [ctx.view.equipment(), true]] as const) {
    for (const item of items) {
      if (!item || item.number <= 0 || !item.timeout) continue;
      // Preserve the C condition, even though its comment describes a narrower rod rule.
      if (item.tval === TV.ROD && item.sval !== SVAL.rod.recall && trait(ctx, BI.CDEPTH) === 0) continue;
      if (item.tval === TV.LIGHT && [SVAL.light.torch, SVAL.light.lantern].includes(item.sval)) continue;
      best = item;
      worn = equipped;
    }
  }
  if (!best) return null;
  if (worn || best.tval === TV.ROD) return ctx.act.rest(75);
  if (!wieldSlot(best)) return null;
  d?.restAfterWear?.(best.handle);
  return ctx.act.wear(best.handle);
}

/** borg_is_ammo(tval) (wear.c:1541). */
export function borgIsAmmo(tval: number): boolean {
  return tval === TV.SHOT || tval === TV.ARROW || tval === TV.BOLT;
}

/** The equipment "category" an item wields into, or null if unwearable. */
type Slot =
  | "weapon"
  | "bow"
  | "ring"
  | "amulet"
  | "light"
  | "body"
  | "cloak"
  | "shield"
  | "helm"
  | "gloves"
  | "boots";

function wieldSlot(item: ItemView): Slot | null {
  switch (item.tval) {
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
      return "weapon";
    case TV.BOW:
      return "bow";
    case TV.RING:
      return "ring";
    case TV.AMULET:
      return "amulet";
    case TV.LIGHT:
      return "light";
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
      return "body";
    case TV.CLOAK:
      return "cloak";
    case TV.SHIELD:
      return "shield";
    case TV.HELM:
    case TV.CROWN:
      return "helm";
    case TV.GLOVES:
      return "gloves";
    case TV.BOOTS:
      return "boots";
    default:
      return null;
  }
}

/** borg-inventory.c:274-290 keeps wieldable items with unknown runes. */
export function borgItemWorthId(item: ItemView): boolean {
  return needsIdent(item) && wieldSlot(item) !== null;
}

/** The item currently worn in the same category, or null. */
function wornInSlot(ctx: BorgContext, slot: Slot): ItemView | null {
  for (const item of ctx.view.equipment()) {
    if (item && item.number > 0 && wieldSlot(item) === slot) return item;
  }
  return null;
}

/** borg_best_stuff_order (borg-item-wear.c:1042-1071), in body-slot indices. */
const BEST_ORDER = [1, 0, 6, 7, 8, 9, 10, 11, 3, 2, 5, 4] as const;
const BEST_SLOTS: readonly Slot[] = [
  "bow", "weapon", "body", "cloak", "shield", "helm", "gloves", "boots",
  "ring", "ring", "light", "amulet",
];

/** borg_best_stuff (borg-item-wear.c:1329-1428) searches only at home. */
export function borgBestStuff(
  ctx: BorgContext,
  shopNum: number,
  d?: WearDeps,
  stores?: StoreDeps,
): AgentCommand | null {
  if (shopNum !== BORG_HOME) return null;
  const goal = ctx.world.self.goal;
  if (goal.doBest) {
    if (borgHomeFull(ctx, stores) || borgInventoryFull(ctx, stores)) return null;
    const pack = packItems(ctx);
    const home = homeWares(ctx);
    const candidates = [
      ...pack.map((item) => ({ item, ref: { from: "gear", handle: item.handle } as BorgLoadoutRef, home: false })),
      ...home.map((item) => ({ item, ref: { from: "store", store: BORG_HOME, index: item.index } as BorgLoadoutRef, home: true })),
    ];
    const equipment = ctx.view.equipment();
    type Choice = (typeof candidates)[number];
    const trial: Array<Choice | null> = BEST_ORDER.map(() => null);
    let best = [...trial];
    let power = ctx.world.self.power;
    let incomplete = false;
    /* borg-item-wear.c:1210-1320 visits the current item before alternatives. */
    const search = (n: number): void => {
      if (n === BEST_ORDER.length) {
        const choices = trial.flatMap((choice, k) => choice ? [{ item: choice.ref, slot: BEST_ORDER[k]! }] : []);
        const score = d?.bestEval ? d.bestEval(choices) : ctx.world.self.power;
        if (score === null) {
          incomplete = true;
          return;
        }
        if (score > power) {
          power = score;
          best = [...trial];
        }
        return;
      }
      search(n + 1);
      for (const choice of candidates) {
        const item = choice.item;
        if (!item.number || !isAware(item, d) || !itemValue(item, d)) continue;
        if (isCursed(item) && !d?.uncursable?.(item)) continue;
        if (d?.randarts && item.artifact && !isIdent(item, d)) continue;
        if (wieldSlot(item) !== BEST_SLOTS[n]) continue;
        if (n === 9 && trial[8] === choice) continue;
        const worn = equipment[BEST_ORDER[n]!];
        if (worn && isOneRing(worn, stores)) continue;
        trial[n] = choice;
        search(n + 1);
        trial[n] = null;
      }
    };
    search(0);
    if (incomplete) return null;
    /* borg-item-wear.c:1378-1406 keeps identities across inventory reordering. */
    goal.bestItems = best.map((choice) => choice ? {
      tval: choice.item.tval, sval: choice.item.sval, pval: choice.item.pval, home: choice.home,
    } : null);
    goal.doBest = false;
  }

  /* borg_one_step_wearing_best (borg-item-wear.c:1077-1200) emits one action. */
  const plan = goal.bestItems;
  if (!plan) return null;
  for (let n = 0; n < plan.length; n++) {
    const choice = plan[n];
    if (!choice) continue;
    const worn = ctx.view.equipment()[BEST_ORDER[n]!];
    const matches = (item: ItemView): boolean =>
      item.tval === choice.tval && item.sval === choice.sval && item.pval === choice.pval;
    if (choice.home) {
      if (worn?.number) {
        if (borgHomeFull(ctx, stores)) continue;
        return ctx.act.shopSell(worn.handle, worn.number);
      }
      if (borgInventoryFull(ctx, stores)) continue;
      const item = homeWares(ctx).find(matches);
      if (!item) return null;
      choice.home = false;
      return ctx.act.shopBuy(item.index, 1);
    }
    if (worn?.number) {
      if (borgInventoryFull(ctx, stores)) continue;
      return ctx.act.takeoff(worn.handle);
    }
    const item = [...packItems(ctx), ...ctx.view.equipment().filter((entry): entry is ItemView => entry !== null)].find(matches);
    if (!item) return null;
    plan[n] = null;
    return ctx.act.wear(item.handle);
  }
  /* borg-item-wear.c:1105-1112 retries plans blocked by full storage. */
  goal.doBest = plan.some((choice) => choice !== null);
  delete goal.bestItems;
  return null;
}

/**
 * borg_wear_stuff (wear.c:745): wear the carried item that most improves power.
 * Returns the wear command, or null.
 */
export function borgWearStuff(
  ctx: BorgContext,
  d?: WearDeps,
): AgentCommand | null {
  /* Hack against the swap-till-you-drop loop (wear.c:770). */
  if (trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK)) return null;

  /* Need an empty slot to simulate pushing equipment (wear.c:774). */
  if (d?.hasHole === false) return null;

  /* "Forbid if been sitting on level forever" (wear.c:779). Both halves are
   * anti-loop: a borg that has spent this long without leaving is not going to
   * be rescued by another equipment swap, and the swap is what is keeping it
   * there. */
  if ((d?.clock ?? 0) - (d?.began ?? 0) > 2000) return null;
  if (ctx.world.self.timeThisPanel > 1300) return null;

  const currentPower = ctx.world.self.power;
  let bestPower = currentPower;
  let best: ItemView | null = null;

  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (!isAware(item, d)) continue;
    if (itemValue(item, d) <= 0) continue; /* worthless (wear.c:801) */

    /* Do not wear un-*IDd* randart artifacts (wear.c:805). */
    if ((d?.randarts ?? false) && item.artifact && !isIdent(item, d)) continue;

    const slot = wieldSlot(item);
    if (!slot) continue;

    /* Over weight limit: only swap in more-STR items (wear.c:836). */
    if (trait(ctx, BI.ISENCUMB)) {
      const worn = wornInSlot(ctx, slot);
      if (worn && modOf(worn, "STR") > modOf(item, "STR")) continue;
    }

    /* Evaluate the loadout (wear.c:858). Without the seam, no improvement. */
    const p = d?.wearEval ? d.wearEval(item) : currentPower;

    /* "Ignore essentially equal swaps" (wear.c:913). THE MARGIN IS THE ANTI-LOOP,
     * and 50 rather than 0 is the whole point: two wooden torches with a few turns
     * of fuel between them score within a handful of points of each other, so a
     * plain `p > bestPower` made each the better choice in turn and the borg spent
     * every turn of the rest of its life swapping one for the other. Measured over
     * a headless run before this line existed: 3964 wield commands out of 4000
     * decisions.
     *
     * NOT PORTED, and honestly: upstream also refuses a swap that raises the
     * danger at the current grid (`if (danger < d) continue`, wear.c:908), which
     * needs borg_danger re-run over the simulated loadout. The wearEval seam
     * answers with a power and nothing else, so there is no simulated world here
     * to ask. It costs the borg a swap it should have declined, not a loop. */
    if (p <= bestPower + 50) continue;

    bestPower = p;
    best = item;
    /* borg-item-wear.c:921 draws for the ring check after a regular upgrade. */
    ctx.rng.randint0(100);
  }

  /* The final gate is against the CURRENT power, not against the running best
   * (wear.c:993): the margin above only decides which candidate wins. */
  if (best && bestPower > currentPower) {
    /* borg.time_this_panel++ (wear.c:1021): a wear is an action, and the panel
     * clock is what the ladder's own anti-loop rungs read. */
    ctx.world.self.timeThisPanel++;
    return ctx.act.wear(best.handle);
  }
  return null;
}
