/**
 * The spell/device seam borg_notice and borg_power read, answered from the
 * character as the C answers it: borg_spell_legal / borg_spell_legal_fail
 * (borg-magic.c), borg_equips_item(act, false) and borg_equips_ring
 * (borg-item-use.c), player_has(PF_*) and spell_chance(0).
 *
 * Built per context, so a simulated loadout is asked about its own
 * equipment, not the one it was simulated from.
 */

import type { BorgContext } from "../context.js";
import type { BorgSpellSeam } from "./config.js";
import { Spell, borgSpellLegal, borgSpellLegalFail, borgSpellFailRate, ratingsForClass } from "../item/magic.js";
import { borgEquipsRing } from "../item/item-use.js";
import { playerHas } from "./player-flags.js";
import { BI } from "./trait-index.js";

/** borg_equips_item(act, checkCharge), as the host's activation resolver answers it. */
export type ResolveActivation = (ctx: BorgContext, act: string, checkCharge: boolean) => boolean;

function spellNamed(name: string): Spell | null {
  const spell = (Spell as unknown as Record<string, Spell | undefined>)[name];
  return typeof spell === "number" ? spell : null;
}

export function contextSpellSeam(ctx: BorgContext, resolveActivation?: ResolveActivation): BorgSpellSeam {
  const has = (flag: string): boolean => playerHas(ctx, flag);
  return {
    spellLegal: (name) => {
      const spell = spellNamed(name);
      return spell !== null && borgSpellLegal(ctx, spell);
    },
    spellLegalFail: (name, fail) => {
      const spell = spellNamed(name);
      return spell !== null && borgSpellLegalFail(ctx, spell, fail, has);
    },
    /* Every borg_notice call passes check_charge = false (borg-trait.c). */
    equipsItem: (act) => resolveActivation?.(ctx, act, false) ?? false,
    equipsRing: (sval) => borgEquipsRing(ctx, sval),
    /* spell_chance(0) (borg-power.c:321): the game's own live failure for class
     * spell 0 - mana shortfall, fear, stun and amnesia included - which the
     * view carries as SpellView.chance. Without it, the Borg's own estimate. */
    spellChance: () => {
      for (const book of ctx.view.spellbooks()) {
        const first = book.spells.find((s) => s.sidx === 0);
        if (first && typeof first.chance === "number") return first.chance;
      }
      const first = ratingsForClass(ctx.world.self.trait[BI.CLASS] ?? -1)?.[0];
      return first ? borgSpellFailRate(ctx, first.spell, has) : 100;
    },
    playerHas: has,
  };
}
