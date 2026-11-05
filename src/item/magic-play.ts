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
 * the book, as the C's keypresses do). The first effect comes from class content,
 * matching borg-magic.c:759. The munchkin-mode exceptions apply to munchkin mode,
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
  borgBookHandle,
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
 * borg_can_play_spell's first-effect checks (borg-magic-play.c:70-81).
 */
export const NOT_TESTED_BY_EFFECT: ReadonlySet<string> = new Set([
  "BRAND_BOLTS",
  "CREATE_ARROWS",
  "BRAND_AMMO",
  "ENCHANT",
  "IDENTIFY",
  "RECHARGE",
]);

/** borg_can_play_spell (borg-magic-play.c:44). */
export function borgCanPlaySpell(spell: Spell, effect: string): boolean {
  return !NOT_TESTED_BY_NAME.has(spell) && !NOT_TESTED_BY_EFFECT.has(effect);
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
    const handle = borgBookHandle(ctx, views.get(best)!.bidx);
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
    const effect = ctx.spellEffect?.(ctx.view.player().cls, sidx);
    if (!effect || !borgCanPlaySpell(spell, effect.name)) continue;
    const cmd = borgSpell(ctx, spell);
    if (cmd !== null) {
      /* The C targets self for aimed, random and teleport-to effects
       * (borg-magic-play.c:208-212). TELEPORT_TO asks its direction inside the effect. */
      if (effect.aim || effect.name === "RANDOM" || effect.name === "TELEPORT_TO") {
        ctx.act.setTargetLocation(w.self.c.x, w.self.c.y);
      }
      /* The C supplies Maggot's glyph to Banishment (borg-magic-play.c:215-218). */
      if (effect.name === "BANISH") return ctx.act.raw("cast", { spell: sidx, tgtsymbol: "h" });
      if (effect.name === "TELEPORT_TO") return ctx.act.raw("cast", { spell: sidx, tgtdir: 5 });
      return cmd;
    }
  }
  return null;
}
