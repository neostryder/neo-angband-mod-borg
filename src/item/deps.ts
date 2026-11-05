/**
 * Shared seams and low-level accessors for the P8.5 item/magic/recovery port.
 *
 * Knowledge reads awareness and the API 2 unknown-rune marker. Values in the
 * published ItemView price a stack; perItemValue adapts them for the C's
 * single-item inventory penalties (borg-item-analyze.c:611-622).
 * The `danger` at the borg's grid (borg_danger, P8.2) is taken as a plain number
 * defaulting to 0 (no danger), per the P8.5 architecture note - never imported.
 */

import type { BorgContext, ItemView } from "./types.js";
import { BI } from "../trait/trait-index.js";
import { TV, SVAL } from "./svals.js";

/** Published content facts used by borg-item-analyze.c:43-259,413-425. */
export interface ItemAnalysis {
  cost: number | null;
  egoCost: number | null;
  artifactCost: number | null;
  dd: number;
  ds: number;
  cursed: boolean;
  oneRing: boolean;
  randomPower: boolean;
  effects?: readonly { index: string; subtype: string }[];
}

type AnalyzedItem = ItemView & { borgAnalysis?: ItemAnalysis };

/** Kind effects follow the full chain, including effects after RANDOM. */
export function hasKindEffect(item: ItemView, index: string, subtype?: string): boolean {
  return (item as AnalyzedItem).borgAnalysis?.effects?.some((effect) =>
    effect.index === index && (subtype === undefined || effect.subtype === subtype)) ?? false;
}

/** borg-item-analyze.c:498-503 also treats negative-power flags as cursed. */
export function isCursed(item: ItemView): boolean {
  return (item as AnalyzedItem).borgAnalysis?.cursed ?? item.curses.length > 0;
}

export function isOneRing(item: ItemView): boolean {
  return (item as AnalyzedItem).borgAnalysis?.oneRing ?? item.artifactName === "'The One Ring'";
}

export function hasRandomPower(item: ItemView): boolean {
  return (item as AnalyzedItem).borgAnalysis?.randomPower ?? true;
}

/** borg.trait[bi], default 0 before borg_notice has run. */
export function trait(ctx: BorgContext, bi: BI): number {
  return ctx.world.self.trait[bi] ?? 0;
}

/** Permanent glow lights the player's grid without a lamp (borg-magic.c:430). */
export function noLight(ctx: BorgContext): boolean {
  const { x, y } = ctx.view.player().grid;
  return trait(ctx, BI.LIGHT) <= 0 && !ctx.view.cell(x, y)?.glow;
}

/** The optional knowledge/level/danger seams (see module header). */
export interface ItemDeps {
  /** Danger at the borg's grid this think (borg_danger); default 0. */
  danger?: number;
  /** avoidance threshold (borg.avoidance); default 0 so p>avoidance/4 is rare. */
  avoidance?: number;
  /** Object kind level for an item (device fail math); default 0. */
  itemLevel?: (item: ItemView) => number;
  /** object_flavor_is_aware; default the view's own `aware` (an unidentified flavour shows `aware: false`). */
  isAware?: (item: ItemView) => boolean;
  /** Identification from the item's published awareness and rune marker. */
  isIdent?: (item: ItemView) => boolean;
  /** The player's unknown-rune marker (borg-item-id.c:145-154). */
  needsIdent?: (item: ItemView) => boolean;
  /** object value (gold); default ItemView.value ?? 0. */
  itemValue?: (item: ItemView) => number;
  /** player_has(PF_*): class ability query; default derived from class. */
  playerHas?: (flag: string) => boolean;
  /** borg_check_rest(y,x): safe to rest here; default true. */
  canRest?: boolean;
  /** borg_fear_region[y/11][x/11] at the borg's grid; default +inf (no fear). */
  fearRegion?: number;
  /** borg_t: the borg clock; default ctx.world.clock. */
  clock?: number;
  /**
   * borg_equips_item(act, checkCharge): an equipped item grants activation
   * `act` (a charged one when checkCharge). ItemView exposes only a boolean
   * `activation`, not its index, so this is a seam; default false (the borg has
   * no identified artifact activations). Mirrors the trait subsystem's seam.
   */
  equipsItem?: (act: string, checkCharge: boolean) => boolean;
  /**
   * borg_activate_item(act): the gear handle of the equipped, charged item that
   * bears activation `act`, or null. Default null. Same fidelity boundary.
   */
  activateItem?: (act: string) => number | null;
}

/** borg_check_rest(y,x): default true (safe to rest). */
export function canRest(d?: ItemDeps): boolean {
  return d?.canRest ?? true;
}
/** borg_equips_item seam (default: none). */
export function equipsItem(act: string, checkCharge: boolean, d?: ItemDeps): boolean {
  return d?.equipsItem ? d.equipsItem(act, checkCharge) : false;
}
/** borg_activate_item seam -> handle (default: none). */
export function activateHandle(act: string, d?: ItemDeps): number | null {
  return d?.activateItem ? d.activateItem(act) : null;
}

export function danger(d?: ItemDeps): number {
  return d?.danger ?? 0;
}
export function avoidance(d?: ItemDeps): number {
  return d?.avoidance ?? 0;
}
export function itemLevel(item: ItemView, d?: ItemDeps): number {
  return d?.itemLevel ? d.itemLevel(item) : 0;
}
export function isAware(item: ItemView, d?: ItemDeps): boolean {
  return d?.isAware ? d.isAware(item) : item.aware;
}
export function isIdent(item: ItemView, d?: ItemDeps): boolean {
  return d?.isIdent ? d.isIdent(item) : item.aware && !needsIdent(item);
}
export function needsIdent(item: ItemView, d?: ItemDeps): boolean {
  if (d?.needsIdent) return d.needsIdent(item);
  /* borg-item-analyze.c:450,460 records knowledge independently of price.
   * API 2 publishes the player's rune knowledge as the item's {??} marker. */
  return (item as ItemView & { unknownRunes?: boolean }).unknownRunes
    ?? (item.name?.includes("{??}") === true || item.inscription?.includes("??") === true);
}
/**
 * borg-item-analyze.c:611-622 uses one item's price and zeros cursed gear.
 * Published content costs and known properties follow the C formula. Missing
 * records use the engine's stack estimate in single-item units.
 */
export function perItemValue(item: ItemView): number {
  const facts = (item as AnalyzedItem).borgAnalysis;
  if (isCursed(item) && !isOneRing(item)) return 0;
  if (!item.aware) return guessedValue(item);
  const fallback = item.number > 0 ? Math.trunc((item.value ?? 0) / item.number) : 0;
  if (facts?.cost == null) return fallback;
  if (!isIdent(item)) return facts.cost;
  let value = facts.cost;
  if (!value) return 0;
  if (item.artifact) {
    if (facts.artifactCost === null) return fallback;
    value = facts.artifactCost;
    if (!value) return 0;
  }
  if (item.ego) {
    if (facts.egoCost === null) return fallback;
    if (!facts.egoCost) return 0;
    value += facts.egoCost;
  }
  const ammo = ([TV.SHOT, TV.ARROW, TV.BOLT] as readonly number[]).includes(item.tval);
  const armor = ([TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK,
    TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR] as readonly number[]).includes(item.tval);
  const weapon = ([TV.BOW, TV.DIGGING, TV.HAFTED, TV.SWORD, TV.POLEARM] as readonly number[]).includes(item.tval);
  const jewel = item.tval === TV.RING || item.tval === TV.AMULET;
  if (item.tval === TV.WAND || item.tval === TV.STAFF) value += Math.trunc(value / 20) * item.pval;
  else if (ammo || armor || weapon || jewel || item.tval === TV.LIGHT) {
    if (item.pval < 0) return 0;
    if (item.pval) {
      /* borg-item-analyze.c:123-132 passes stat indices 0-4 to of_has.
       * list-object-flags.h:17-20 maps indices 1-4 to these sustain flags. */
      for (const flag of ["SUST_STR", "SUST_INT", "SUST_WIS", "SUST_DEX"]) {
        if (item.flags.includes(flag)) value += item.pval * 200;
      }
      for (const [code, multiplier] of [["STEALTH", 100], ["SEARCH", 100], ["INFRA", 50],
        ["TUNNEL", 50], ["SHOTS", 2000], ["SPEED", 30000], ["LIGHT", 100],
        ["MIGHT", 100], ["MOVES", 100], ["DAM_RED", 200]] as const) {
        value += (item.modifiers.find((modifier) => modifier.code === code)?.value ?? 0) * multiplier;
      }
      value += Math.min(5, item.modifiers.find((modifier) => modifier.code === "BLOWS")?.value ?? 0) * 2000;
    }
  }
  /* borg-item-analyze.c:173-256 applies category bonuses and extra dice. */
  if (jewel) {
    if (item.tval === TV.RING && item.sval === SVAL.ring.dog) return 0;
    if (item.toA < 0 || item.toH < 0 || item.toD < 0) return 0;
    value += (item.toH + item.toD + item.toA) * 100;
  } else if (armor) {
    if (item.toA < 0) return 0;
    value += (item.toD + item.toA + (item.toH < 0 && item.toH > -5 ? 0 : item.toH)) * 100;
  } else if (weapon || ammo) {
    if (item.toH + item.toD < 0) return 0;
    value += (item.toH + item.toD + (ammo ? 0 : item.toA)) * (ammo ? 5 : 100);
    if (item.dd > facts.dd && item.ds === facts.ds) value += (item.dd - facts.dd) * item.ds * (ammo ? 5 : 200);
  }
  return value;
}

/** Unaware prices from borg-item-analyze.c:266-311, before stack multiplication. */
export function guessedValue(item: ItemView): number {
  switch (item.tval) {
    case TV.FOOD: return 5;
    case TV.POTION: case TV.SCROLL: return 20;
    case TV.STAFF: return 70;
    case TV.WAND: return 50;
    case TV.ROD: return 90;
    case TV.RING: case TV.AMULET:
      if (item.modifiers.some((modifier) => modifier.value < 0)) return 0;
      return item.toA < 0 || item.toH < 0 || item.toD < 0 ? 0 : 45;
    default: return item.toA < 0 || item.toH < 0 || item.toD < 0 ? 0 : 20;
  }
}

/** borg-junk.c:566-568 uses browsability; the published view marks foreign books slate. */
export function canBrowse(item: ItemView): boolean {
  return ([TV.MAGIC_BOOK, TV.PRAYER_BOOK, TV.NATURE_BOOK, TV.SHADOW_BOOK, TV.OTHER_BOOK] as readonly number[]).includes(item.tval)
    && item.nameColor !== "slate";
}

/** The pack listing follows earlier_object (player-calcs.c:939-1002). */
export function packItems(ctx: BorgContext): ItemView[] {
  const quiver = new Set(ctx.view.quiver?.().map((item) => item.handle) ?? []);
  const ammo = (item: ItemView) => ([TV.SHOT, TV.ARROW, TV.BOLT] as readonly number[]).includes(item.tval);
  const price = (item: ItemView) => item.number > 0 ? Math.trunc((item.value ?? 0) / item.number) : 0;
  return ctx.view.inventory().filter((item) => item.number > 0 && !quiver.has(item.handle)).sort((a, b) => {
    if (canBrowse(a) !== canBrowse(b)) return canBrowse(a) ? -1 : 1;
    if (ammo(a) && ammo(b)) {
      const usable = trait(ctx, BI.AMMO_TVAL);
      if ((a.tval === usable) !== (b.tval === usable)) return a.tval === usable ? -1 : 1;
    }
    if (a.tval !== b.tval) return b.tval - a.tval;
    if (a.aware !== b.aware) return a.aware ? -1 : 1;
    if (!a.aware) return 0;
    if (a.sval !== b.sval) return a.sval - b.sval;
    if (a.tval === TV.LIGHT && a.pval !== b.pval) return b.pval - a.pval;
    return ammo(a) ? price(a) - price(b) : price(b) - price(a);
  });
}
export function itemValue(item: ItemView, d?: ItemDeps): number {
  if (d?.itemValue) return d.itemValue(item);
  return item.value ?? 0;
}
export function clockOf(ctx: BorgContext, d?: ItemDeps): number {
  return d?.clock ?? ctx.world.clock;
}

/**
 * borg_slot(tval, sval): find the best pack item of a given tval+sval, or null.
 * Faithful to borg-inventory.c: aware-only, prefer smallest pile, then larger
 * pval on a smaller pile (borg_slot loop). Returns the ItemView (whose `handle`
 * drives the act verbs).
 */
export function borgSlot(
  ctx: BorgContext,
  tval: number,
  sval: number,
  d?: ItemDeps,
): ItemView | null {
  let best: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (!isAware(item, d)) continue;
    if (item.tval !== tval) continue;
    if (item.sval !== sval) continue;
    if (best) {
      /* Prefer smallest pile */
      if (item.number > best.number) continue;
      /* Prefer largest pval (even on a smaller pile) */
      if (item.pval < best.pval && item.number > best.number) continue;
    }
    best = item;
  }
  return best;
}

/** True when the pack holds a matching, aware item (borg_slot >= 0). */
export function hasSlot(
  ctx: BorgContext,
  tval: number,
  sval: number,
  d?: ItemDeps,
): boolean {
  return borgSlot(ctx, tval, sval, d) !== null;
}

/**
 * The device fail formula shared by rods/staves/wands/dragon/ring/activation
 * (borg-item-use.c, e.g. borg_zap_rod:478). Returns the relative fail number
 * (lower is better; 500 is the borg's usability cutoff). Integer arithmetic via
 * Math.trunc to match C's `/`.
 */
export function deviceFail(ctx: BorgContext, lev: number): number {
  let skill = trait(ctx, BI.DEV);
  if (trait(ctx, BI.ISCONFUSED)) skill = Math.trunc((skill * 75) / 100);
  const numerator = skill - lev - (141 - 1);
  let denominator = lev - skill - (100 - 10);
  /* borg_equips_dragon guards div-by-zero; other sites cannot hit 0 here but this
   * function guards uniformly to avoid NaN (faithful: sign of numerator decides). */
  if (denominator === 0) denominator = numerator > 0 ? 1 : -1;
  return Math.trunc((100 * numerator) / denominator);
}
