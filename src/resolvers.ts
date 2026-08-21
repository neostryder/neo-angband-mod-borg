/**
 * Host resolver factory: build the BorgResolvers seams from real engine data.
 *
 * The frozen AgentView deliberately omits per-race combat internals (blow[],
 * spell frequency, spell_power, sleep, friends) - a minimal, serializable
 * contract. The Borg is a TRUSTED, in-process mod, so its host CAN read the full
 * monster-race registry and hand the Borg an exact resolver. makeCoreResolvers
 * bridges core's MonsterRace records into the MonsterFacts the danger evaluator
 * needs, so the ported borg_danger math reproduces upstream verbatim instead of
 * running on the conservative zero-state defaults.
 *
 * The fourth seam it fills is the odd one out and worth naming. Danger vision,
 * activation identity and the in-shop signal are all facts the host READS and
 * passes down. Hypothetical-loadout power is a derive that only the engine can
 * run, reached through the frozen view's own `simulateLoadout` accessor, so
 * there is nothing for the host to hand over: the seam is installed
 * unconditionally and answers null when the view behind it cannot derive.
 *
 * It used to take a fourth input, `loadout`, carrying the answer to "can this
 * engine do that" - a probe the plugin ran because the mod loaded into games
 * that predated `simulateLoadout`. manifest.json now requires an engine that has
 * it, so the question has one answer and the input is gone.
 *
 * This depends only on @rpgm-tools/neo-angband-core, which the package already
 * depends on.
 */

import { MON_RACE_FLAG_ENTRIES, MON_SPELL_ENTRIES } from "./core-api.js";
import type { ItemView, MonsterRace } from "@rpgm-tools/neo-angband-core";
import type { BorgContext } from "./context.js";
import type { BorgResolvers } from "./think-session.js";
import type { BlowFacts, FactsResolver, MonsterFacts } from "./danger/facts.js";
import { defaultResolveMonsterFacts } from "./danger/facts.js";
import { borgMonBlowEffect } from "./danger/tables.js";
import { borgSimulatePower } from "./trait/simulate.js";

/** The one field every activation source (kind/ego/artifact) carries. */
interface ActivationLike {
  readonly name: string;
}

/**
 * The slice of ObjRegistry the activation-identity seam reads. Structural
 * rather than the class itself, so a test can hand in three plain functions
 * instead of building a real pack.
 */
export interface CoreObjectLookup {
  lookupKind(tval: number, sval: number): { activation: ActivationLike | null } | null;
  findEgo(name: string): { activation: ActivationLike | null } | null;
  findArtifact(name: string): { activation: ActivationLike | null } | null;
}

/**
 * The slice of the live GameState the in-shop seam reads: the player's grid
 * against the level's own feature table (square_shopnum, cave-square.c:1512).
 * Structural for the same reason as CoreObjectLookup.
 */
export interface CoreShopLookup {
  actor: { grid: { x: number; y: number } };
  chunk: { feature(grid: { x: number; y: number }): { shopnum: number } };
}

/** What the host supplies to build real resolvers. */
export interface CoreResolverInput {
  /** The bound monster-race registry (booted.registries...); indexed by ridx. */
  races: readonly MonsterRace[];
  /**
   * The bound object registry (`ctx.registries.objects`), for activation
   * identity. The plugin always passes it; omitting it leaves
   * resolveActivation/activateHandle on their conservative defaults, which is
   * what lets a test exercise one resolver without building the other's fixture.
   */
  objects?: CoreObjectLookup;
  /**
   * The live game state (`ctx.state`), for the in-shop signal. Optional on the
   * same terms as `objects`.
   */
  state?: CoreShopLookup;
}

/** RF_* code names for the set flags in a race flag set (index == RF value). */
function raceFlagNames(race: MonsterRace): Set<string> {
  const out = new Set<string>();
  for (const f of race.flags) {
    const entry = MON_RACE_FLAG_ENTRIES[f];
    if (entry) out.add(entry.name);
  }
  return out;
}

/** RSF_* ordinals the race can cast, ascending (matches the C preload loop). */
function raceSpellOrdinals(race: MonsterRace): number[] {
  const out: number[] = [];
  for (const f of race.spellFlags) {
    // Only real spell entries (index maps to a known RSF_*), skip padding.
    if (MON_SPELL_ENTRIES[f]) out.push(f);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** race.blow[] -> BlowFacts (dice/sides via Dice.randomValue, effect via name). */
function raceBlows(race: MonsterRace): BlowFacts[] {
  return race.blows.map((b) => {
    const rv = b.dice ? b.dice.randomValue() : null;
    return {
      dice: rv ? rv.dice : 0,
      sides: rv ? rv.sides : 0,
      effect: borgMonBlowEffect(b.effect.name),
    };
  });
}

/**
 * borg's "act_<NAME>" token for an activation record, e.g. an activation named
 * "LIGHT" in the data (activation.txt's own name: field, upstream's identifier
 * casing) becomes "act_light" - the token the ported trait/item code already
 * passes to resolveActivation/activateHandle (trait.ts's applySpellGrants,
 * item/light.ts). Reworked from the file's own casing rather than guessed:
 * upstream's activation.txt names are already the act_* identifiers uppercased
 * (LIGHT, ILLUMINATION, DETECT_ALL, ...), so lowercasing and prefixing is exact,
 * not a heuristic.
 */
function actToken(activation: ActivationLike): string {
  return `act_${activation.name.toLowerCase()}`;
}

/**
 * The activation an equipped item currently grants, or null. Mirrors
 * obj-make.c's own precedence (copy_artifact_data / ego_apply_magic): an
 * artifact's or ego's activation overrides the base kind's, and falls back to
 * the kind's when the artifact/ego carries none of its own. ItemView.activation
 * is only a boolean ("has one"), so identifying WHICH one means walking back
 * through egoName/artifactName/tval+sval to the record that supplied it.
 */
function equippedActivation(
  item: ItemView,
  objects: CoreObjectLookup,
): ActivationLike | null {
  if (!item.activation) return null;
  if (item.artifact && item.artifactName) {
    const art = objects.findArtifact(item.artifactName);
    if (art?.activation) return art.activation;
  }
  if (item.ego && item.egoName) {
    const ego = objects.findEgo(item.egoName);
    if (ego?.activation) return ego.activation;
  }
  return objects.lookupKind(item.tval, item.sval)?.activation ?? null;
}

/** The first equipped item granting `act`, honoring checkCharge, or null. */
function findActivatedItem(
  ctx: BorgContext,
  act: string,
  checkCharge: boolean,
  objects: CoreObjectLookup,
): ItemView | null {
  for (const item of ctx.view.equipment()) {
    if (!item) continue;
    const record = equippedActivation(item, objects);
    if (!record || actToken(record) !== act) continue;
    if (checkCharge && item.timeout >= 1) continue;
    return item;
  }
  return null;
}

/**
 * Build the resolvers that give the Borg real danger vision, activation
 * identity, the in-shop signal and hypothetical-loadout power. The first and the
 * last are unconditional; `objects` and `state` may be omitted, which leaves
 * their two seams on the conservative defaults documented in BorgResolvers.
 */
export function makeCoreResolvers(input: CoreResolverInput): BorgResolvers {
  const byRidx = new Map<number, MonsterRace>();
  for (const r of input.races) byRidx.set(r.ridx, r);

  const resolveMonsterFacts: FactsResolver = (ctx, killIndex): MonsterFacts => {
    const kill = ctx.world.kills.at(killIndex);
    const race = byRidx.get(kill.rIdx);
    // Unknown race (e.g. a mod race the registry lacks): fall back to the
    // MonsterView-derived defaults rather than throwing.
    if (!race) return defaultResolveMonsterFacts(ctx, killIndex);

    return {
      rIdx: race.ridx,
      flags: raceFlagNames(race),
      level: race.level,
      sleep: race.sleep,
      spellPower: race.spellPower,
      freqInnate: race.freqInnate,
      freqSpell: race.freqSpell,
      hasFriends: race.friends.length > 0 || race.friendsBase.length > 0,
      blows: raceBlows(race),
      spells: raceSpellOrdinals(race),
    };
  };

  const objects = input.objects;
  const resolveActivation: BorgResolvers["resolveActivation"] = (
    ctx,
    act,
    checkCharge,
  ): boolean => {
    if (!objects) return false;
    return findActivatedItem(ctx, act, checkCharge, objects) !== null;
  };
  const activateHandle: BorgResolvers["activateHandle"] = (ctx, act): number | null => {
    if (!objects) return null;
    // borg_activate_item always requires a charged item (borg-item-use.c:947).
    const item = findActivatedItem(ctx, act, true, objects);
    return item ? item.handle : null;
  };

  const state = input.state;
  const inShop: BorgResolvers["inShop"] = (_ctx): number | null => {
    if (!state) return null;
    // square_shopnum (cave-square.c:1512): f_info[feat].shopnum - 1, or -1
    // (here null) when the grid is not a shop entrance.
    const shopnum = state.chunk.feature(state.actor.grid).shopnum;
    return shopnum > 0 ? shopnum - 1 : null;
  };

  return {
    resolveMonsterFacts,
    resolveActivation,
    activateHandle,
    inShop,
    // Installed unconditionally. borgSimulatePower reads view.simulateLoadout,
    // which the agent API declares optional on the view itself, and answers null
    // when there is no live derive behind it (a worldless harness) - so this is
    // correct without asking the host anything.
    loadoutPower: (ctx, change) => borgSimulatePower(ctx, change),
  };
}
