/**
 * Curse removal - a faithful port of borg-item-decurse.c.
 *
 * Each helper checks for a decurse means (Remove Curse scroll / staff / spell /
 * *Remove Curse* / an act_remove_curse activation) and, if found, returns the
 * command carrying the cursed item's handle (the C pressed its letter).
 * The engine's default curse selection is the first removable curse, matching
 * the C's final Enter key, without inventing a hidden curse index.
 *
 * The swap subsystem (weapon_swap / armour_swap / decurse_*_swap) is a separate
 * borg module (borg-trait-swap) not part of P8.5, so borg_decurse_armour/weapon
 * are gated behind a swap seam and inert by default (borg_uses_swaps aside, there
 * is no swap item to decurse). borg_decurse_any (driven by BI_FIRST_CURSED) is
 * ported fully.
 */

import type { BorgContext, AgentCommand } from "./types.js";
import { BI } from "../trait/trait-index.js";
import { TV, SVAL } from "./svals.js";
import type { ItemDeps } from "./deps.js";
import { hasSlot, packItems, withItemTarget } from "./deps.js";
import { Spell, borgSpell, borgSpellOkayFail } from "./magic.js";
import {
  borgReadScroll,
  borgUseStaff,
  borgActivateItem,
  borgEquipsStaffFail,
} from "./item-use.js";

/** True when any Remove-Curse means is available (decurse.c:43 guard). */
function decurseMeans(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): boolean {
  return (
    hasSlot(ctx, TV.SCROLL, SVAL.scroll.remove_curse!, d) ||
    borgEquipsStaffFail(ctx, SVAL.staff.remove_curse!, d) ||
    borgSpellOkayFail(ctx, Spell.REMOVE_CURSE, 40, playerHas) ||
    hasSlot(ctx, TV.SCROLL, SVAL.scroll.star_remove_curse!, d) ||
    borgEquipsItemPresent(ctx, d)
  );
}

function borgEquipsItemPresent(ctx: BorgContext, d?: ItemDeps): boolean {
  return (
    borgActivateItem(ctx, "act_remove_curse", d) !== null ||
    borgActivateItem(ctx, "act_remove_curse2", d) !== null
  );
}

/**
 * Emit the actual decurse command from whatever means is available.
 *
 * Takes no playerHas, and that is upstream's shape, not an omission: the MEANS
 * check above asks borg_spell_okay_fail(REMOVE_CURSE, 40), which needs the
 * fail-rate inputs, while the command half calls plain borg_spell(REMOVE_CURSE),
 * which has no fail threshold to compute (decurse.c:111-125).
 */
function decurseCommand(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  return (
    borgReadScroll(ctx, SVAL.scroll.remove_curse!, d) ||
    borgUseStaff(ctx, SVAL.staff.remove_curse!, d) ||
    borgSpell(ctx, Spell.REMOVE_CURSE) ||
    borgReadScroll(ctx, SVAL.scroll.star_remove_curse!, d) ||
    borgActivateItem(ctx, "act_remove_curse", d) ||
    borgActivateItem(ctx, "act_remove_curse2", d)
  );
}

/**
 * borg_decurse_any (decurse.c:111): if any equipped/carried item is cursed
 * (BI_FIRST_CURSED) and a decurse means exists, use it.
 */
export function borgDecurseAny(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (!ctx.world.self.trait[BI.FIRST_CURSED]) return null;
  /* FIRST_CURSED is a presence marker in the port, not a gear handle. C's
   * inventory indices scan pack, worn slots, then quiver. Resolve that order
   * against the current public views, including the real gear identities. */
  const target = [
    ...packItems(ctx),
    ...ctx.view.equipment().filter((item) => item !== null),
    ...(ctx.view.quiver?.() ?? []),
  ].find((item) => item.handle > 0 && item.number > 0 && item.curses.length > 0);
  if (!target) return null;
  if (!decurseMeans(ctx, d, playerHas)) return null;
  return withItemTarget(ctx, decurseCommand(ctx, d), target.handle);
}
