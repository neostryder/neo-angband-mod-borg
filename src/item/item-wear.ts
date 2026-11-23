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
import { trait, isAware, isIdent, isCursed, isOneRing, itemValue, canRest, clockOf, danger, needsIdent, packItems } from "./deps.js";
import { SVAL } from "./svals.js";
import { mod as modOf } from "../trait/item-util.js";
import { getDerived } from "../trait/state.js";
import { borgCfg } from "../trait/config.js";
import { getDangerGlobals } from "../danger/index.js";
import { getFightState } from "../fight/state.js";
import type { BorgLoadoutDangerAnswer } from "../trait/simulate.js";
import type { BorgLoadoutChange, BorgLoadoutRef } from "../trait/simulate.js";
import {
  BORG_HOME, borgHomeFull, borgInventoryFull, homeWares, isOneRing as isOneRingAt,
  type StoreDeps,
} from "../store/store.js";

/** Wear-specific seams. */
export interface WearDeps extends ItemDeps {
  /** A free pack slot exists to push equipment into (borg_first_empty; def true). */
  hasHole?: boolean;
  /** birth_randarts option (skip un-IDd randart artifacts); default false. */
  randarts?: boolean;
  /** Public known-loadout danger and critical traits for a backup candidate. */
  backupEval?: (item: ItemView, slot: number) => BorgLoadoutDangerAnswer | null;
  /** borg.power if `item` were worn (the C's borg_notice/borg_power sim). */
  wearEval?: (item: ItemView, slot?: number) => number;
  /** Power for a complete equipment combination (borg-item-wear.c:1229). */
  bestEval?: (choices: NonNullable<BorgLoadoutChange["wieldAt"]>) => number | null;
  /** A cursed item has a curse with power below 100 (borg-item-analyze.c:347). */
  uncursable?: (item: ItemView) => boolean;
  /** Local danger with the candidate in a particular ring slot. */
  wearDanger?: (item: ItemView, slot: number) => number | null;
  /** Power after moving the item in this slot into the pack. */
  removeEval?: (slot: number) => number | null;
  emptySlots?: number;
  /** The C queues both takeoffs when reordering rings in town. */
  queueRingTakeoff?: (handle: number) => void;
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
export type Slot =
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

export function wieldSlot(item: ItemView): Slot | null {
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
/** Loadouts the C's exhaustive home search may score before the slot-by-slot search takes over (#61). */
export const BEST_EXHAUSTIVE_LOADOUTS = 2000;
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
    const score = (): number | null => {
      const choices = trial.flatMap((choice, k) => choice ? [{ item: choice.ref, slot: BEST_ORDER[k]! }] : []);
      return d?.bestEval ? d.bestEval(choices) : ctx.world.self.power;
    };
    const fits = (choice: Choice, n: number): boolean => {
      const item = choice.item;
      if (!item.number || !isAware(item, d) || !itemValue(item, d)) return false;
      if (isCursed(item) && !d?.uncursable?.(item)) return false;
      if (d?.randarts && item.artifact && !isIdent(item, d)) return false;
      if (wieldSlot(item) !== BEST_SLOTS[n]) return false;
      /* One ring cannot fill both ring slots. */
      if (n === 9 && trial[8] === choice) return false;
      if (n === 8 && trial[9] === choice) return false;
      const worn = equipment[BEST_ORDER[n]!];
      if (worn && isOneRingAt(worn, stores)) return false;
      return true;
    };
    /* borg-item-wear.c:1210-1320 visits the current item before alternatives. */
    const exhaustive = (n: number): void => {
      if (n === BEST_ORDER.length) {
        const s = score();
        if (s === null) {
          incomplete = true;
          return;
        }
        if (s > power) {
          power = s;
          best = [...trial];
        }
        return;
      }
      exhaustive(n + 1);
      for (const choice of candidates) {
        if (!fits(choice, n)) continue;
        trial[n] = choice;
        exhaustive(n + 1);
        trial[n] = null;
      }
    };
    /*
     * FORK diegoami/neo-angband-borg-mod-tracker#61: borg_best_stuff_aux scores
     * every combination of every slot's candidates - the product over twelve
     * slots, 1.6 million loadouts for a 13-item pack and a 12-item home. The C
     * does that in-process; one port notice + power costs about 190
     * microseconds, so that walk would take minutes per decision. Up to
     * BEST_EXHAUSTIVE_LOADOUTS combinations the C walk runs unchanged. Beyond it,
     * search slot by slot (coordinate ascent): in the C slot order, try each
     * candidate for one slot with the other slots held, keep a strictly better
     * score (the C keeps the current item on a tie by visiting it first), and
     * repeat until a full pass changes nothing, for at most twelve passes. When the slots' contributions are
     * independent that reaches the C's optimum; where they interact (a change
     * that only pays together with another) it can stop where the C would not.
     */
    const ascent = (): void => {
      for (let pass = 0; pass < BEST_ORDER.length; pass++) {
        let improved = false;
        for (let n = 0; n < BEST_ORDER.length; n++) {
          const held = trial[n] ?? null;
          for (const choice of [null, ...candidates]) {
            if (choice === held) continue;
            if (choice !== null && !fits(choice, n)) continue;
            trial[n] = choice;
            const s = score();
            trial[n] = held;
            if (s === null) {
              incomplete = true;
              continue;
            }
            if (s > power) {
              power = s;
              best = [...trial];
              best[n] = choice;
              improved = true;
            }
          }
          trial[n] = best[n] ?? null;
        }
        if (!improved || incomplete) break;
      }
    };
    let loadouts = 1;
    for (let n = 0; n < BEST_ORDER.length && loadouts <= BEST_EXHAUSTIVE_LOADOUTS; n++) {
      loadouts *= 1 + candidates.filter((choice) => fits(choice, n)).length;
    }
    if (loadouts <= BEST_EXHAUSTIVE_LOADOUTS) exhaustive(0);
    else ascent();
    if (incomplete) return null;
    /* borg-item-wear.c:1378-1406 keeps identities across inventory reordering. */
    goal.bestItems = best.map((choice) => choice ? {
      tval: choice.item.tval, sval: choice.item.sval, pval: choice.item.pval, home: choice.home,
    } : null);
    goal.doBest = false;
  }

  /* borg_one_step_wearing_best (borg-item-wear.c:1077-1200) emits one action.
   * FORK diegoami/neo-angband-borg-mod-tracker#83: the C wears and takes off
   * gear with the home screen open; Neo's store phase accepts only buy, sell
   * and exit. A takeoff or wear step therefore leaves the store, plan kept,
   * and borgWearBestOutside carries it out in town. */
  const step = bestStep(ctx, stores);
  if (step === "done") return null;
  if (step === null) return null;
  if (!step.inStore) return ctx.act.shopExit();
  step.commit();
  return step.cmd;
}

/**
 * The plan's next step outside the store (#83): a takeoff or wear the home
 * screen could not take. A step that needs the home waits for the next home
 * visit, which doBest asks for.
 */
export function borgWearBestOutside(ctx: BorgContext, stores?: StoreDeps): AgentCommand | null {
  if (!ctx.world.self.goal.bestItems) return null;
  const step = bestStep(ctx, stores);
  if (step === "done" || step === null) return null;
  if (step.inStore) {
    ctx.world.self.goal.doBest = true;
    return null;
  }
  step.commit();
  return step.cmd;
}

type BestStep = { cmd: AgentCommand; inStore: boolean; commit: () => void };

/** The plan's next action, without consuming it; "done" once nothing is left. */
function bestStep(ctx: BorgContext, stores?: StoreDeps): BestStep | "done" | null {
  const goal = ctx.world.self.goal;
  const plan = goal.bestItems;
  if (!plan) return null;
  const none = (): void => undefined;
  for (let n = 0; n < plan.length; n++) {
    const choice = plan[n];
    if (!choice) continue;
    const worn = ctx.view.equipment()[BEST_ORDER[n]!];
    const matches = (item: ItemView): boolean =>
      item.tval === choice.tval && item.sval === choice.sval && item.pval === choice.pval;
    if (choice.home) {
      if (worn?.number) {
        if (borgHomeFull(ctx, stores)) continue;
        return { cmd: ctx.act.shopSell(worn.handle, worn.number), inStore: true, commit: none };
      }
      if (borgInventoryFull(ctx, stores)) continue;
      const item = homeWares(ctx).find(matches);
      if (!item) return null;
      return { cmd: ctx.act.shopBuy(item.index, 1), inStore: true, commit: () => { choice.home = false; } };
    }
    if (worn?.number) {
      if (borgInventoryFull(ctx, stores)) continue;
      return { cmd: ctx.act.takeoff(worn.handle), inStore: false, commit: none };
    }
    const item = [...packItems(ctx), ...ctx.view.equipment().filter((entry): entry is ItemView => entry !== null)].find(matches);
    if (!item) return null;
    return { cmd: ctx.act.wear(item.handle), inStore: false, commit: () => { plan[n] = null; } };
  }
  /* borg-item-wear.c:1105-1112 retries plans blocked by full storage. */
  goal.doBest = plan.some((choice) => choice !== null);
  delete goal.bestItems;
  return "done";
}

/* borg-item.h:134-135 orders the tight ring before the loose ring. */
const RIGHT_RING = 2;
const LEFT_RING = 3;

/** borg-item-wear.c:259-379 reorders rings in town. */
export function borgSwapRings(ctx: BorgContext, d?: WearDeps): AgentCommand | null {
  if (d?.hasHole === false || (d?.emptySlots ?? 2) < 2) return null;
  if (clockOf(ctx, d) - (d?.began ?? 0) > 1000 || trait(ctx, BI.CDEPTH) !== 0) return null;
  const equipment = ctx.view.equipment();
  const right = equipment[RIGHT_RING];
  const left = equipment[LEFT_RING];
  if (left?.number && !right?.number && !isOneRing(left)) return ctx.act.takeoff(left.handle);
  if (!right?.number || isOneRing(right)) return null;
  const v1 = left?.number ? ctx.world.self.power : d?.removeEval?.(LEFT_RING);
  const v2 = d?.removeEval?.(RIGHT_RING);
  if (v1 == null || v2 == null || v2 <= v1) return null;
  if (left?.number) d?.queueRingTakeoff?.(left.handle);
  return ctx.act.takeoff(right.handle);
}

/** borg-item-wear.c:397-519 chooses the last best ring when both fingers are empty. */
export function borgWearRings(ctx: BorgContext, d?: WearDeps): AgentCommand | null {
  if (d?.hasHole === false || (d?.emptySlots ?? 2) < 2) return null;
  const equipment = ctx.view.equipment();
  if (equipment[LEFT_RING]?.number || equipment[RIGHT_RING]?.number) return null;
  if (trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK)) return null;
  if (clockOf(ctx, d) - (d?.began ?? 0) > 2000) return null;
  let best: ItemView | null = null;
  let bestPower = 0;
  for (const item of packItems(ctx)) {
    if (!isAware(item, d) || itemValue(item, d) === 0) continue;
    if (d?.randarts && item.artifact && !isIdent(item, d)) continue;
    if (item.tval !== TV.RING) continue;
    let p = d?.wearEval?.(item, LEFT_RING) ?? ctx.world.self.power;
    if (isOneRing(item)) p = ctx.world.self.power * 2;
    if (best && p < bestPower) continue;
    best = item;
    bestPower = p;
  }
  if (!best || bestPower <= ctx.world.self.power) return null;
  ctx.world.self.timeThisPanel++;
  return ctx.act.wear(best.handle);
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
  let bestRingSlot = -1;
  const equipment = ctx.view.equipment();
  const left = equipment[LEFT_RING];
  const right = equipment[RIGHT_RING];

  for (const item of packItems(ctx)) {
    if (item.number <= 0) continue;
    if (!isAware(item, d)) continue;
    if (itemValue(item, d) <= 0) continue; /* worthless (wear.c:801) */

    /* Do not wear un-*IDd* randart artifacts (wear.c:805). */
    if ((d?.randarts ?? false) && item.artifact && !isIdent(item, d)) continue;

    const slot = wieldSlot(item);
    if (!slot) continue;

    /* Over weight limit: only swap in more-STR items (wear.c:836). */
    if (trait(ctx, BI.ISENCUMB)) {
      const worn = slot === "ring" ? left : wornInSlot(ctx, slot);
      if (worn && modOf(worn, "STR") > modOf(item, "STR")) continue;
    }

    const fullRings = slot === "ring" && !!left?.number && !!right?.number;
    if (!fullRings) {
      /* Evaluate the loadout (wear.c:858). Without the seam, no improvement. */
      let p = d?.wearEval ? d.wearEval(item, slot === "ring" ? LEFT_RING : undefined) : currentPower;
      if (isOneRing(item) && !left?.tval) p = -99999;
      if (slot === "ring") {
        const afterDanger = d?.wearDanger?.(item, LEFT_RING);
        if (afterDanger == null || danger(d) < afterDanger) continue;
      }

      /* The 50-point margin prevents equal-value equipment swap loops (wear.c:913).
       * Non-ring danger simulation remains outside this ring port. */
      if (p <= bestPower + 50) continue;

      bestPower = p;
      best = item;
    }

    /* The C draws even for a non-ring or the One Ring (wear.c:921). */
    if (ctx.rng.randint0(100) === 10 || isOneRing(item)) {
      if (!fullRings) continue;
      for (const ringSlot of [RIGHT_RING, LEFT_RING]) {
        let p = d?.wearEval?.(item, ringSlot) ?? currentPower;
        const afterDanger = d?.wearDanger?.(item, ringSlot);
        if (ringSlot === LEFT_RING && isOneRing(item)) p = -99999;
        if (p < bestPower) continue;
        if (afterDanger == null || (danger(d) <= afterDanger && danger(d) !== 0)) continue;
        best = item;
        bestPower = p;
        bestRingSlot = ringSlot;
      }
    }
  }

  /* The final gate is against the CURRENT power, not against the running best
   * (wear.c:993): the margin above only decides which candidate wins. */
  if (best && bestPower > currentPower) {
    /* borg.time_this_panel++ (wear.c:1021): a wear is an action, and the panel
     * clock is what the ladder's own anti-loop rungs read. */
    ctx.world.self.timeThisPanel++;
    if (bestRingSlot >= 0 && best.tval === TV.RING) {
      return ctx.act.takeoff(equipment[bestRingSlot]!.handle);
    }
    return ctx.act.wear(best.handle);
  }
  return null;
}

/** borg_backup_swap (4.2.6/current wear.c:534–727), preserving original C82. */
export function borgBackupSwap(ctx: BorgContext, p: number, d?: WearDeps): AgentCommand | null {
  if (!borgCfg().usesSwaps || trait(ctx,BI.MAXDEPTH)>=90 || trait(ctx,BI.ISHUNGRY) || trait(ctx,BI.ISWEAK)
    || ctx.world.self.timeThisPanel>300) return null;
  const derived=getDerived(ctx.world), pack=packItems(ctx);
  const armour=pack.find(item=>item.handle===derived.armourSwap.handle), weapon=pack.find(item=>item.handle===derived.weaponSwap.handle);
  if ((!armour && !weapon) || !d?.backupEval) return null;
  // Native initializes these only in the armour branch; preserve the weapon-only oddity.
  const initial=armour ? {rconf:trait(ctx,BI.RCONF),rblind:trait(ctx,BI.RBLIND),fract:trait(ctx,BI.FRACT)} : {rconf:0,rblind:0,fract:0};
  const evaluate=(item:ItemView):number|null => {
    const category=wieldSlot(item);
    if (!category) return null;
    const slots: Record<Slot,number>={weapon:0,bow:1,ring:LEFT_RING,amulet:4,light:5,body:6,cloak:7,shield:8,helm:9,gloves:10,boots:11};
    const answer=d.backupEval!(item,slots[category]);
    if (!answer) return null;
    const t=answer.traits;
    if ((initial.rconf&&!t.rconf) || (initial.rblind&&!t.rblind&&!t.rlite&&!t.rdark&&t.sav<100)
      || (initial.fract&&!t.fract&&t.sav<100)) return 9999;
    // Missing birth-option knowledge cannot authorize an unidentified artifact.
    if (d.randarts!==false && item.artifact && !isIdent(item,d)) return 9999;
    const uncursable=category==="weapon" ? derived.weaponSwapOpts.weaponSwap?.uncursable :
      derived.armourSwapOpts.armourSwap?.uncursable ?? derived.armourSwapOpts.weaponSwap?.uncursable;
    if (isCursed(item) && !uncursable?.(item)) return 9999;
    return answer.danger;
  };
  const ap=armour ? evaluate(armour) : 0, wp=weapon ? evaluate(weapon) : 0;
  if (ap===null || wp===null) return null; // Let unresolved public loadout requests settle; no invented score.
  // C82 is intentionally retained: the higher danger wins; ties choose weapon.
  const chosen=ap<=wp ? weapon : armour, score=ap<=wp ? wp : ap;
  const avoidance=getDangerGlobals(ctx.world).avoidance;
  const ceiling=getFightState(ctx.world).fightingUnique ? Math.trunc(avoidance*2/3) : Math.trunc(avoidance/2);
  // Native can select an absent sentinel on a zero tie. No public command expresses an invalid handle.
  if (!chosen || p<=score || score>ceiling) return null;
  return ctx.act.wear(chosen.handle);
}
