/**
 * FORK (Mandos #50), inherited DEFECT: restore the omitted borg-junk.c rungs.
 * Power is supplied by the existing loadout simulation. Knowledge uses the
 * existing ItemDeps seams; absent book/ego knowledge retains those items
 * conservatively, and absent simulation declines a speculative drop.
 */
import type { AgentCommand, BorgContext, ItemView } from "./types.js";
import type { ItemDeps } from "./deps.js";
import { danger, isAware, isIdent, itemValue, needsIdent, trait } from "./deps.js";
import { BI, CLASS_WARRIOR, CLASS_RANGER, CLASS_MAGE, CLASS_DRUID, CLASS_NECROMANCER, CLASS_PRIEST } from "../trait/trait-index.js";
import { FEAT } from "../core-api.js";
import { mod } from "../trait/item-util.js";
import { borgInventoryFull } from "../store/store.js";
import { TV, SVAL } from "./svals.js";
import { borgEat, borgQuaffPotion, borgReadScroll } from "./item-use.js";

export interface SpaceDeps extends ItemDeps {
  packFull?: boolean;
  dropEval?: (item: ItemView, quantity: number) => number | null;
  protectedHandles?: readonly number[];
  canBrowse?: (item: ItemView) => boolean;
  worthId?: (item: ItemView) => boolean;
  randomPower?: (item: ItemView) => boolean;
  randarts?: boolean;
  began?: number;
  quiverSize?: number;
  maxAmmoStack?: number;
}

function isBook(tval: number): boolean {
  return ([TV.MAGIC_BOOK, TV.PRAYER_BOOK, TV.NATURE_BOOK, TV.SHADOW_BOOK, TV.OTHER_BOOK] as readonly number[]).includes(tval);
}

function valuableGear(tval: number): boolean {
  return ([TV.AMULET, TV.BOW, TV.HAFTED, TV.POLEARM, TV.SWORD, TV.BOOTS, TV.GLOVES,
    TV.HELM, TV.CROWN, TV.SHIELD, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR] as readonly number[]).includes(tval);
}

function onFloor(ctx: BorgContext): boolean {
  const { x, y } = ctx.world.self.c;
  return ctx.world.map.at(x, y).feat === FEAT.FLOOR;
}

/** The C pack excludes quiver slots; inventory() includes their handles. */
function pack(ctx: BorgContext): ItemView[] {
  const quiver = new Set(ctx.view.quiver?.().map((item) => item.handle) ?? []);
  return ctx.view.inventory().filter((item) => item.number > 0 && !quiver.has(item.handle));
}

/** borg_consume (junk.c:74): consume only the C's named safe junk. */
export function borgConsume(ctx: BorgContext, item: ItemView, d?: SpaceDeps): AgentCommand | null {
  if (!isAware(item, d)) return null;
  const cls = trait(ctx, BI.CLASS);
  if (item.tval === TV.POTION) {
    const p = SVAL.potion;
    const safe = [p.slime_mold, p.cure_light, p.cure_serious, p.cure_critical,
      p.healing, p.star_healing, p.life, p.restore_life, p.restore_mana,
      p.heroism, p.berserk, p.resist_heat, p.resist_cold, p.infravision,
      p.detect_invis, p.cure_poison, p.speed, p.inc_exp];
    if (safe.includes(item.sval)) return borgQuaffPotion(ctx, item.sval, d);
    const trades: Array<[number | undefined, BI, boolean]> = [
      [p.inc_str2, BI.CSTR, ![CLASS_MAGE, CLASS_DRUID, CLASS_NECROMANCER].includes(cls)],
      [p.inc_int2, BI.CINT, cls === CLASS_MAGE || cls === CLASS_NECROMANCER],
      [p.inc_wis2, BI.CWIS, cls === CLASS_PRIEST || cls === CLASS_DRUID],
      [p.inc_dex2, BI.CDEX, ![CLASS_MAGE, CLASS_PRIEST, CLASS_DRUID, CLASS_NECROMANCER].includes(cls)],
      [p.inc_con2, BI.CCON, true],
    ];
    for (const [sval, stat, allowed] of trades) {
      if (item.sval === sval && trait(ctx, stat) < 118 && allowed) return borgQuaffPotion(ctx, item.sval, d);
    }
  }
  if (item.tval === TV.SCROLL) {
    const s = SVAL.scroll;
    if ([s.light, s.monster_confusion, s.trap_door_destruction, s.satisfy_hunger,
      s.dispel_undead, s.blessing, s.holy_chant, s.holy_prayer].includes(item.sval)) {
      return borgReadScroll(ctx, item.sval, d);
    }
  }
  if (!trait(ctx, BI.ISFULL)) {
    if (item.tval === TV.FOOD && [SVAL.food.ration, SVAL.food.slime_mold, SVAL.food.waybread].includes(item.sval)) {
      return borgEat(ctx, item.tval, item.sval, d);
    }
    const m = SVAL.mush;
    if (item.tval === TV.MUSHROOM && [m.second_sight, m.fast_recovery, m.cure_mind,
      m.restoring, m.emergency, m.terror, m.stoneskin, m.debility, m.sprinting, m.purging].includes(item.sval)) {
      return borgEat(ctx, item.tval, item.sval, d);
    }
  }
  return null;
}

function protectedForHole(ctx: BorgContext, item: ItemView): boolean {
  if (!item.aware) return false;
  if (item.tval === TV.POTION) {
    const p = SVAL.potion;
    return (item.sval === p.restore_mana && trait(ctx, BI.MAXSP) >= 1)
      || [p.healing, p.star_healing, p.life, p.speed].includes(item.sval);
  }
  if (item.tval === TV.SCROLL) {
    const s = SVAL.scroll;
    return [s.protection_from_evil, s.rune_of_protection].includes(item.sval)
      || (item.sval === s.teleport_level && trait(ctx, BI.ATELEPORTLVL) < 1000);
  }
  if (item.tval === TV.ROD) {
    return ((item.sval === SVAL.rod.healing || (item.sval === SVAL.rod.mapping && trait(ctx, BI.CLASS) === CLASS_WARRIOR)) && item.number <= 5)
      || (item.sval === SVAL.rod.light && trait(ctx, BI.LIGHT) <= 0);
  }
  return item.tval === TV.WAND && item.sval === SVAL.wand.teleport_away
    && trait(ctx, BI.CLASS) === CLASS_WARRIOR && trait(ctx, BI.ATPORTOTHER) <= 8;
}

/** Monetary penalties from junk.c:699-859; preserve even the C's odd ORs. */
function holeValue(ctx: BorgContext, item: ItemView, boost: number, d?: SpaceDeps): number {
  let value = itemValue(item, d) + boost;
  if (["STR", "INT", "WIS", "DEX", "CON"].some((stat) => mod(item, stat) > 0)) value += 20000;
  if (item.tval === trait(ctx, BI.AMMO_TVAL) && value > 0
    && trait(ctx, BI.AMISSILES) <= 35 && trait(ctx, BI.CDEPTH) >= 1) value += 5000;
  if (trait(ctx, BI.CLEVEL) > 35 && isAware(item, d)) {
    if (item.tval === TV.RING) value *= item.number * 10;
    else if (valuableGear(item.tval)) value *= item.number * 5;
    else if (item.tval === TV.CLOAK) value = item.number * (item.ego && (d?.randomPower?.(item) ?? true) ? 300000 : value);
    else if (item.tval === TV.ROD || item.tval === TV.WAND) {
      // The C's disjunction of unequal svals is always true, including for attack devices.
      value = item.number * 300000;
    } else if (item.tval === TV.STAFF) {
      const s = SVAL.staff;
      value = item.number * ((item.sval !== s.dispel_evil
        || ((item.sval !== s.power || item.sval !== s.holiness) && trait(ctx, BI.GOOD_S_CHG) < 2)
        || (item.sval !== s.destruction && trait(ctx, BI.ASTFDEST) < 2)) ? 300000 : Math.trunc(value / 2));
    } else if (item.tval === TV.SCROLL) value = item.number * 30000; // same OR quirk
    else if (item.tval === TV.POTION) value = item.number * 300000; // same OR quirk
    else value = item.number * Math.trunc(value / 3);
  } else value *= item.number;
  if (!isAware(item, d) && value > 0) {
    const depth = trait(ctx, BI.MAXDEPTH);
    switch (item.tval) {
      case TV.RING: case TV.AMULET: value = depth * 5000; break;
      case TV.ROD: value = depth * 3000; break;
      case TV.STAFF: case TV.WAND: value = depth * 2000; break;
      case TV.SCROLL: case TV.POTION: value = depth * 500; break;
      case TV.FOOD: value = depth * 10; break;
    }
  }
  if (!isIdent(item, d) && value > 0 && (d?.worthId?.(item) ?? false)) {
    switch (item.tval) {
      case TV.SHOT: case TV.ARROW: case TV.BOLT: value += 100; break;
      case TV.BOW: value += 20000; break;
      case TV.DIGGING: value += 10; break;
      case TV.HAFTED: case TV.POLEARM: case TV.SWORD: value += 10000; break;
      case TV.BOOTS: case TV.GLOVES: case TV.HELM: case TV.CROWN: case TV.SHIELD:
      case TV.SOFT_ARMOR: case TV.HARD_ARMOR: case TV.DRAG_ARMOR: case TV.CLOAK: value += 15000; break;
      case TV.RING: case TV.AMULET: value += 5000; break;
      case TV.STAFF: case TV.WAND: value += 1000; break;
    }
  }
  value = Math.trunc(value / 100);
  if (trait(ctx, BI.CDEPTH) === 0 && trait(ctx, BI.FOOD) === 0) value = Math.trunc(value / 500);
  return value;
}

/** FORK (#50), DEFECT: borg_drop_hole (junk.c:514), one entire stack. */
export function borgDropHole(ctx: BorgContext, desperate = false, d?: SpaceDeps): AgentCommand | null {
  if (!(d?.packFull ?? borgInventoryFull(ctx)) || !onFloor(ctx) || !d?.dropEval) return null;
  const hp = trait(ctx, BI.CURHP);
  if (trait(ctx, BI.CDEPTH) && danger(d) > Math.trunc(hp / 10)
    && (hp !== trait(ctx, BI.MAXHP) || danger(d) > Math.trunc(hp * 2 / 3))) return null;
  let best: ItemView | null = null;
  let bestPower = 0;
  let bestWeight = 0;
  const digger = ctx.view.equipment()[0]?.tval === TV.DIGGING;
  for (const item of pack(ctx)) {
    if (item.artifact || (item.tval === TV.FOOD && trait(ctx, BI.FOOD) < 5)) continue;
    if (d.protectedHandles?.includes(item.handle)) continue;
    // The optional book/ego knowledge seams share the existing port's conservative defaults.
    if (d.canBrowse?.(item) ?? isBook(item.tval)) continue;
    let boost = 0;
    if ((item.tval === TV.BOOTS && !isIdent(item, d))
      || (item.tval >= TV.DIGGING && item.tval <= TV.SWORD && digger)) {
      if (!desperate) continue;
      boost = 10000;
    }
    if (needsIdent(item, d)) {
      if (!desperate) continue;
      boost = 5000;
    }
    if (!desperate) {
      if (protectedForHole(ctx, item)) continue;
    } else boost = 7000; // C overwrites earlier boosts here (junk.c:650).
    if (item.ego && !isIdent(item, d) && (d.randomPower?.(item) ?? true)) {
      if (!desperate) continue;
      boost = 10000;
    }
    const simulated = d.dropEval(item, item.number);
    if (simulated === null) continue;
    const power = simulated - holeValue(ctx, item, boost, d);
    const weight = item.weight * item.number;
    if (best && power < bestPower) continue;
    if (power === bestPower && weight < bestWeight) continue;
    best = item;
    bestPower = power;
    bestWeight = weight;
  }
  if (best) return borgConsume(ctx, best, d) ?? ctx.act.drop(best.handle, best.number);
  return desperate ? null : borgDropHole(ctx, true, d);
}

/** FORK (#50), DEFECT: borg_drop_slow (junk.c:959), ONE item, not its stack. */
export function borgDropSlow(ctx: BorgContext, d?: SpaceDeps): AgentCommand | null {
  if (danger(d) > Math.trunc(trait(ctx, BI.CURHP) / 20) || !trait(ctx, BI.CDEPTH)
    || trait(ctx, BI.SPEED) >= 110 || ctx.world.self.munchkinMode || !d?.dropEval) return null;
  let greed = Math.trunc(trait(ctx, BI.GOLD) / 100) + 100;
  if (greed < 500 && trait(ctx, BI.CLEVEL) > 35) greed = 500;
  greed = Math.min(25000, greed);
  greed = Math.max(0, greed - (110 - trait(ctx, BI.SPEED)) * 500);
  let best: ItemView | null = null;
  let bestPower = 0;
  const digger = ctx.view.equipment()[0]?.tval === TV.DIGGING;
  // inventory() already contains quivered handles. Do not count them twice.
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0 || d.protectedHandles?.includes(item.handle)) continue;
    if (!isIdent(item, d) && ((d.worthId?.(item) ?? false) || item.tval === TV.BOOTS)) continue;
    if (d.randarts && item.artifact && !isIdent(item, d)) continue;
    if (needsIdent(item, d)) continue;
    if (item.tval >= TV.DIGGING && item.tval <= TV.SWORD && digger) continue;
    if (item.tval === TV.ROD && isAware(item, d)
      && (item.sval === SVAL.rod.healing || (item.sval === SVAL.rod.light && trait(ctx, BI.LIGHT) <= 0))) continue;
    const simulated = d.dropEval(item, 1);
    if (simulated === null) continue;
    let price = Math.min(itemValue(item, d), 30000);
    if (price < greed) price = 0;
    const power = simulated - price + item.weight * 100;
    if (power < bestPower) continue;
    best = item;
    bestPower = power;
  }
  if (!best || bestPower < ctx.world.self.power) return null;
  return borgConsume(ctx, best, d) ?? ctx.act.drop(best.handle, 1);
}

/** FORK (#50), DEFECT: borg_dump_quiver (junk.c:1154), earliest bad stack. */
export function borgDumpQuiver(ctx: BorgContext, d?: SpaceDeps): AgentCommand | null {
  if (trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK) || !onFloor(ctx)) return null;
  if ((d?.clock ?? ctx.world.clock) - (d?.began ?? 0) > 2000 || ctx.world.self.timeThisPanel > 150) return null;
  const cls = trait(ctx, BI.CLASS);
  const capacity = ((d?.maxAmmoStack ?? 40) - 1) * (cls === CLASS_WARRIOR || cls === CLASS_RANGER ? 2 : 1) * (d?.quiverSize ?? 10);
  const quiver = ctx.view.quiver?.() ?? [];
  let best: ItemView | null = null;
  for (let i = quiver.length - 1; i >= 0; i--) {
    const item = quiver[i]!;
    if (item.number <= 0) continue;
    if (item.curses.length === 0 && item.tval === trait(ctx, BI.AMMO_TVAL)) {
      if (item.toD > 0 && item.toH > 0) continue;
      if (needsIdent(item, d)) continue;
      if (trait(ctx, BI.AMISSILES) <= capacity && item.toD >= 0 && item.toH >= 0) continue;
    }
    best = item;
  }
  if (!best) return null;
  ctx.world.self.timeThisPanel++;
  return ctx.act.drop(best.handle, best.number);
}
