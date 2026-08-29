/**
 * borg_notice_player's buff-timer cross-check (borg-trait.c:3010-3037).
 *
 * Buff bookkeeping here is message-driven: `perceive-messages.ts` raises and
 * clears `world.self.temp.*` from the twenty-two on/off lines
 * (borg-messages.c:772-1025), and that table is the primary record. Upstream
 * keeps a second, redundant record beside it, reading the player's real timers
 * out of the game on every think and reconciling them against the flags the
 * messages produced. Its own comment introduces the block as "A quick cheat to
 * see if I missed a message about my status on some timed spells".
 *
 * The failure that covers is the one the message table structurally cannot: a
 * line that never arrives, or arrives in a form no entry matches, leaves the
 * Borg believing a buff is still running long after it expired. Every
 * buff-aware maneuver in `fight/defend.ts` and `fight/perm.ts` opens by
 * returning 0 when its flag is set, so one stale flag removes that maneuver
 * from the ladder for the rest of the character's life, and a Borg that
 * believes it is blessed mid-fight never casts bless again.
 *
 * TWO SHAPES, AND THE DIFFERENCE IS LOAD-BEARING.
 *
 *  - Protection from evil and haste are RAISED by the timer and never lowered
 *    by it (borg-trait.c:3013-3022, both written as `if (!flag && timer)`).
 *    A missed "on" message for those two is repaired; a missed "off" message
 *    is not. Preserved exactly rather than tidied into the other shape: the
 *    rungs reading `temp.fast` also decide speed-potion spending, and a flag
 *    that both halves of the bookkeeping can lower is a different Borg.
 *  - The five temporary elemental resists, bless, shield/stoneskin, fastcast,
 *    hero and berserk are ASSIGNED from the timer (:3023-3037), so the engine
 *    both raises and clears them. That half is the safety net proper.
 *
 * WHAT STAYS MESSAGE-ONLY. Upstream also cross-checks regeneration
 * (TMD_HEAL), venom (TMD_ATT_POIS), smite evil (TMD_ATT_EVIL), see-invisible
 * (TMD_SINVIS) and word of recall. `PlayerStatusView` carries no timer for any
 * of those, so there is nothing to reconcile them against and those flags are
 * left to the message table alone.
 */

import type { PlayerStatusView } from "@rpgm-tools/neo-angband-core";
import type { Temp } from "../world/model.js";

/**
 * The buff half of `PlayerStatusView` (Agent API 1.4.0).
 *
 * Declared as an optional overlay rather than read straight off the imported
 * type on purpose. `manifest.json` already requires an engine that carries
 * these fields, so a running game always reports them; the type package this
 * repository compiles and tests against is older than that floor, and a
 * scenario view is free to describe only the fields it cares about. Absent
 * therefore means "no engine record to reconcile against", which is the one
 * reading under which skipping the cross-check is correct rather than
 * destructive: clearing every flag because nothing reported a timer would
 * throw the message table's answer away instead of checking it.
 */
interface BuffTimers {
  /** Haste (p->timed[TMD_FAST]). */
  fast?: number;
  /** The Ranger/Rogue sprint effect (p->timed[TMD_SPRINT]). */
  sprint?: number;
  /** Protection from evil (p->timed[TMD_PROTEVIL]). */
  protEvil?: number;
  /** Heroism (p->timed[TMD_HERO]). */
  hero?: number;
  /** Berserker strength (p->timed[TMD_SHERO]). */
  shero?: number;
  /** Mystic shield (p->timed[TMD_SHIELD]). */
  shield?: number;
  /** Stoneskin (p->timed[TMD_STONESKIN]). */
  stoneskin?: number;
  /** Blessed (p->timed[TMD_BLESSED]). */
  blessed?: number;
  /** Fast spellcasting (p->timed[TMD_FASTCAST]). */
  fastcast?: number;
  /** Temporary acid resistance (p->timed[TMD_OPP_ACID]). */
  resAcid?: number;
  /** Temporary lightning resistance (p->timed[TMD_OPP_ELEC]). */
  resElec?: number;
  /** Temporary fire resistance (p->timed[TMD_OPP_FIRE]). */
  resFire?: number;
  /** Temporary cold resistance (p->timed[TMD_OPP_COLD]). */
  resCold?: number;
  /** Temporary poison resistance (p->timed[TMD_OPP_POIS]). */
  resPois?: number;
}

/** The status view as this module reads it: afflictions plus optional buffs. */
export type BorgTimedStatus = PlayerStatusView & BuffTimers;

/** Every field Agent API 1.4.0 added, in the order borg-trait.c reads them. */
const BUFF_TIMER_FIELDS: readonly (keyof BuffTimers)[] = [
  "protEvil",
  "fast",
  "sprint",
  "resAcid",
  "resElec",
  "resFire",
  "resCold",
  "resPois",
  "blessed",
  "shield",
  "stoneskin",
  "fastcast",
  "hero",
  "shero",
];

/**
 * Whether this status view reports buff timers at all. The fourteen fields
 * landed together in one additive API bump, so one of them answering is the
 * whole set answering.
 */
export function borgHasBuffTimers(status: PlayerStatusView): boolean {
  const s = status as BorgTimedStatus;
  return BUFF_TIMER_FIELDS.some((f) => typeof s[f] === "number");
}

/** A timer counts as active while it has turns left on it. */
function on(turns: number | undefined): boolean {
  return (turns ?? 0) > 0;
}

/**
 * Reconcile the message-derived buff flags against the engine's own timers
 * (borg-trait.c:3010-3037). Writes `temp` in place, and does nothing at all on
 * a view that reports no timers.
 */
export function borgCheatBuffTimers(
  temp: Temp,
  status: PlayerStatusView,
): void {
  if (!borgHasBuffTimers(status)) return;
  const s = status as BorgTimedStatus;

  /* Raised by the timer, never lowered by it (:3013-3022). */
  if (!temp.protFromEvil && on(s.protEvil)) temp.protFromEvil = true;
  if (!temp.fast && (on(s.fast) || on(s.sprint))) temp.fast = true;

  /* Assigned from the timer, so the engine clears a stale flag (:3023-3037). */
  temp.resAcid = on(s.resAcid);
  temp.resElec = on(s.resElec);
  temp.resFire = on(s.resFire);
  temp.resCold = on(s.resCold);
  temp.resPois = on(s.resPois);
  temp.bless = on(s.blessed);
  temp.shield = on(s.shield) || on(s.stoneskin);
  temp.fastcast = on(s.fastcast);
  temp.hero = on(s.hero);
  temp.berserk = on(s.shero);
}
