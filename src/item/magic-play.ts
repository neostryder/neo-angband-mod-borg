/**
 * borg_play_magic (borg-magic-play.c:87): study new spells, and test untried
 * ones in town when there is nothing better to do.
 *
 * Called from both of its think-ladder rungs (borg-think-dungeon.c:1579 and
 * :2038). Ported in the C's order:
 *
 *   1. never without magic, blind, confused, unlit or on a dark grid;
 *   2. the best learnable spell (status OKAY) from a carried book, by the
 *      class rating - "boring" ratings (<= 50) only when `bored` - and when
 *      the character may study (BI.ISSTUDY), learn it;
 *   3. otherwise, only in town and only when bored, cast the first untried
 *      spell (status TEST) worth testing (borg_can_play_spell), aimed at the
 *      borg's own grid as the C's '*' 't' does.
 *
 * Learning is the engine's "study" command (do_cmd_study: the book's handle,
 * and for PF_CHOOSE_SPELLS classes the spell; the others learn at random from
 * the book, as the C's keypresses do). borg_can_play_spell's effect checks
 * (EF_BRAND_BOLTS, EF_CREATE_ARROWS, EF_BRAND_AMMO, EF_ENCHANT, EF_IDENTIFY,
 * EF_RECHARGE) read an effect the frozen SpellView does not carry, so they
 * are named by spell here; magic-play.test.ts pins that list to the game's
 * own class data, so a renamed or added spell with one of those effects fails
 * there. The munchkin-mode exceptions are left out with munchkin mode itself,
 * which is off in stock config.
 */

import type { AgentCommand } from "@rpgm-tools/neo-angband-core";
import type { BorgContext } from "./types.js";
import { BI } from "../trait/trait-index.js";
import { BORG_DARK } from "../world/grid.js";
import {
  BORG_MAGIC_OKAY,
  BORG_MAGIC_TEST,
  Spell,
  borgBookPossessed,
  borgSpell,
  borgSpellStatus,
  classOf,
  ratingsForClass,
} from "./magic.js";
import { trait } from "./deps.js";

/** borg_can_play_spell's "not worth testing" spells (borg-magic-play.c:48-65). */
const NOT_TESTED_BY_NAME: ReadonlySet<Spell> = new Set([
  Spell.LIGHTNING_STRIKE,
  Spell.TAP_UNLIFE,
  Spell.TAP_MAGICAL_ENERGY,
  Spell.REMOVE_CURSE,
  Spell.TREMOR,
  Spell.WORD_OF_DESTRUCTION,
  Spell.GRONDS_BLOW,
  Spell.DECOY,
  Spell.GLYPH_OF_WARDING,
  Spell.SINGLE_COMBAT,
  Spell.VAMPIRE_STRIKE,
  Spell.COMMAND,
  Spell.CURSE,
  Spell.FORCEFUL_BLOW,
  Spell.MAIM_FOE,
]);

/**
 * borg_can_play_spell's effect checks (borg-magic-play.c:70-81), by the spells
 * that carry those effects in the game's data (pinned in magic-play.test.ts).
 */
export const NOT_TESTED_BY_EFFECT: ReadonlySet<Spell> = new Set([
  Spell.CREATE_ARROWS /* EF_CREATE_ARROWS */,
  Spell.BRAND_AMMUNITION /* EF_BRAND_AMMO */,
  Spell.ENCHANT_WEAPON /* EF_ENCHANT */,
  Spell.ENCHANT_ARMOUR /* EF_ENCHANT */,
  Spell.IDENTIFY_RUNE /* EF_IDENTIFY */,
  Spell.RECHARGING /* EF_RECHARGE */,
]);

/** borg_can_play_spell (borg-magic-play.c:44). */
export function borgCanPlaySpell(spell: Spell): boolean {
  return !NOT_TESTED_BY_NAME.has(spell) && !NOT_TESTED_BY_EFFECT.has(spell);
}

/** The pack's copy of the book holding spell sidx `bidx` (the C's book_idx), or null. */
function bookHandle(ctx: BorgContext, bidx: number): number | null {
  const books = ctx.view.spellbooks();
  const book = books[bidx];
  if (!book) return null;
  let svalPos = 0;
  for (let i = 0; i <= bidx; i++) if (books[i] && books[i]!.tval === book.tval) svalPos++;
  for (const item of ctx.view.inventory()) {
    if (item.number > 0 && item.tval === book.tval && item.sval === svalPos) return item.handle;
  }
  return null;
}

/** borg_play_magic(bored) (borg-magic-play.c:87): the command, or null. */
export function borgPlayMagic(ctx: BorgContext, bored: boolean): AgentCommand | null {
  const ratings = ratingsForClass(classOf(ctx));
  if (ratings === null) return null;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return null;
  if (!trait(ctx, BI.LIGHT)) return null;
  const w = ctx.world;
  if (w.map.inBounds(w.self.c.x, w.self.c.y) && w.map.at(w.self.c.x, w.self.c.y).info === BORG_DARK) return null;

  /* The spell views by class-wide index (sidx == ratings position). */
  const views = new Map<number, ReturnType<BorgContext["view"]["spellbooks"]>[number]["spells"][number]>();
  for (const book of ctx.view.spellbooks()) for (const s of book.spells) views.set(s.sidx, s);

  /* The best learnable spell, scanning backward as the C does. */
  let bestRating = -1;
  let best = -1;
  for (let sidx = ratings.length - 1; sidx >= 0; sidx--) {
    const view = views.get(sidx);
    if (view === undefined || !borgBookPossessed(ctx, view.bidx)) continue;
    if (borgSpellStatus(ctx, view) !== BORG_MAGIC_OKAY) continue;
    const r = ratings[sidx]!.rating;
    if (!bored && r <= 50) continue;
    if (r <= 0) continue;
    if (r <= bestRating) continue;
    bestRating = r;
    best = sidx;
  }

  /* Study. */
  if (trait(ctx, BI.ISSTUDY) && bestRating > 0 && best >= 0) {
    const handle = bookHandle(ctx, views.get(best)!.bidx);
    if (handle !== null) return ctx.act.raw("study", { handle, spell: best });
  }

  /* Test: only in town, only when bored. */
  if (trait(ctx, BI.CDEPTH)) return null;
  if (!bored) return null;
  for (let sidx = ratings.length - 1; sidx >= 0; sidx--) {
    const view = views.get(sidx);
    if (view === undefined || !borgBookPossessed(ctx, view.bidx)) continue;
    if (borgSpellStatus(ctx, view) !== BORG_MAGIC_TEST) continue;
    const spell = ratings[sidx]!.spell;
    if (!borgCanPlaySpell(spell)) continue;
    const cmd = borgSpell(ctx, spell);
    if (cmd !== null) {
      /* The C aims an aimed test cast at the borg itself ('*' 't'). */
      ctx.act.setTargetLocation(w.self.c.x, w.self.c.y);
      return cmd;
    }
  }
  return null;
}
