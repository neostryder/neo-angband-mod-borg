/**
 * The Borg, as a mod's entry point.
 *
 * This file is short because it is the only new code in the mod: everything
 * under src/ is the port, carried over from the game's repository unchanged. Its
 * whole job is to satisfy the plugin ABI, hand the port the live engine, and
 * return a controller.
 *
 * ------------------------------------------------------------------
 * WHY THE BORG IS A MOD AT ALL
 * ------------------------------------------------------------------
 *
 * Upstream, the borg hooks the game at `inkey_hack`: when Angband asks for a
 * keypress, the borg perceives the world, decides, and returns keystrokes. That
 * is a privileged position inside the C. Here it is not privileged at all - it
 * is `ModPlugin.controller`, the same seam any third-party agent mod uses, over
 * the same frozen perceive/act API. The Borg is the most demanding possible
 * consumer of "read the whole game, drive every command", so a faithful Borg
 * that plays correctly IS the acceptance test that the surface is complete.
 *
 * ------------------------------------------------------------------
 * WHY bindCore RUNS FIRST
 * ------------------------------------------------------------------
 *
 * A plugin cannot `import` the engine: a bare specifier does not resolve in a
 * module fetched from a folder, and bundling core into plugin.js would give this
 * mod its own registries and singletons while the game ran on another set. The
 * host passes the engine in as `ctx.core` instead, and src/core-api.ts is the one
 * file that holds it - read that file's header for how, and for the single rule
 * it imposes on the rest of the port.
 *
 * bindCore is called in `controller()`, which the host invokes after register()
 * and after the game is booted, so `ctx.core` is the live namespace by then.
 *
 * ------------------------------------------------------------------
 * WHY THIS DECLARES NO HOOKS AND REGISTERS NOTHING
 * ------------------------------------------------------------------
 *
 * The Borg changes no rule, adds no record, and overrides no system. It plays
 * the game exactly as a player can, through commands the engine already accepts.
 * A plugin whose only member is `controller` used to be refused by the host as
 * "would do nothing"; that check now counts a controller, because playing the
 * game is not nothing.
 */

import type * as Core from "@rpgm-tools/neo-angband-core";
import type { AgentController } from "@rpgm-tools/neo-angband-core";
import { bindCore, coreIsBound } from "./src/core-api.js";
import { createBorg } from "./src/controller.js";
import { makeCoreResolvers } from "./src/resolvers.js";
import { defaultCfg, type BorgCfg } from "./src/trait/config.js";

/**
 * What this plugin needs from the host's context, structurally. Declared here
 * rather than imported from the host's mod-plugin.ts because this file has to
 * compile in a standalone mod repository that holds no copy of the host - the
 * same reason bug-fixes and qol declare theirs.
 */
interface ControllerCtx {
  readonly flags: Readonly<Record<string, boolean>>;
  /** The live engine namespace, at the version manifest.json requires. */
  readonly core: typeof Core;
  readonly log: (msg: string) => void;
  /**
   * The bound content registries (host `ctx.registries`).
   *
   * Required, not optional. This is the controller seam's contract rather than
   * the host's whole `ModPluginContext`, which declares the field optional
   * because the same type also serves `hooks(ctx)` - and `hooks` runs before the
   * game exists. At the one call site that invokes `controller()` the host has
   * already latched the bound registries, so the field is always there.
   * `Core.CoreRegistries` rather than a hand-written shape, so a change to the
   * registry the Borg reads fails this repository's build instead of surfacing as
   * bad play.
   */
  readonly registries: Core.CoreRegistries;
  /**
   * The live game state (host `ctx.state`). Required for the same reason as
   * `registries`: `controller()` runs after boot, so a character with a grid
   * exists by then. Declared as the narrow shape resolvers.ts actually reads
   * (player grid + level feature lookup) rather than imported, because
   * `GameState` is an internal host type and not part of the published surface.
   */
  readonly state: {
    readonly actor: { readonly grid: { readonly x: number; readonly y: number } };
    readonly chunk: {
      feature(grid: { x: number; y: number }): { shopnum: number };
    };
    /* Flavour awareness, for pricing a floor object the way borg_new_take
     * does. Optional in the declared shape because it is optional on the host's
     * own state; absent, every kind reads as unaware, which is upstream's
     * "worth 1, pick it up and find out". */
    readonly isAware?: (kind: unknown) => boolean;
  };
}

/**
 * Whether the player has asked the Borg to take over.
 *
 * A mod being ENABLED and a mod being IN CHARGE are different things, and for
 * this mod the difference is the whole game. Every other mod's toggles change
 * how the world behaves; this one's decides whether anyone is playing. So the
 * flag defaults to off in manifest.json: installing the Borg and enabling it
 * gets you a Borg you can switch on, not a character that starts walking.
 */
const AUTOPLAY_FLAG = "borg.autoplay";

/**
 * The settings a player can move, and the `borg_cfg[]` entry each one is.
 *
 * ------------------------------------------------------------------
 * WHY A MANIFEST RULE AND NOT A SETTINGS FILE
 * ------------------------------------------------------------------
 *
 * Upstream reads `borg.txt` out of the user directory at start-up. There is no
 * user directory here and no path a player could reach on a phone, so the
 * question is which of the host's own surfaces carries a setting. Three exist. A
 * manifest `rule` is a labelled toggle in the mod manager, resolved per mod and
 * handed to the plugin as `ctx.flags`. `ctx.prefs` is a JSON blob the host
 * stores and nothing edits. `ctx.ui.openPanel` is a real form, behind a
 * capability a player has to consent to and a panel the game has to be given a
 * way to open.
 *
 * Rules win for everything that is a yes or a no, which is most of upstream's
 * table: the toggle already exists, it is where the one existing Borg setting
 * lives, it needs no new permission on a screen a player reads before handing
 * over a character, and changing one re-composes the page - so a session never
 * sees a setting move under it, which is exactly the lifetime `borg_cfg[]` has.
 * The numeric settings (depth ceilings, the enchant limit, a pinned respawn race
 * or class) have no yes-or-no shape and are not here; PLANNED.md carries what
 * each of them still needs.
 *
 * ONLY SETTINGS THE PORT READS ARE LISTED. A toggle for something no ported line
 * consults is worse than an absent one: it reads as a feature, it survives every
 * test, and the only way to find out is to watch a Borg ignore it. Four of
 * upstream's settings are held back on exactly that ground, and each is a
 * different distance from working:
 *
 *   - `borg_kills_uniques` has no reader at all. Its branch needs the live-unique
 *     census (`borg_numb_live_unique`, `borg_depth_hunted_unique`), built upstream
 *     by scanning the whole race table for unique population counts
 *     (borg-update.c) - state this port does not keep.
 *   - `borg_uses_dynamic_calcs` switches the power/depth/restock math from the
 *     internal calculations to a formula language upstream parses out of
 *     `borg.txt`'s own FORMULA SECTION (borg-formulas.c). That is a second
 *     calculation engine, not a flag on this one, and porting it is its own
 *     project.
 *   - `borg_uses_swaps` has a reader (`borgUsesSwaps`, store.ts) that gates two
 *     store functions which return early regardless of its value, because the
 *     swap valuation seams (`weaponSwapEval`/`armourSwapEval`) are deliberately
 *     unwired - see think-session.ts. A swap also contributes zero to
 *     `borg_power` here, so the toggle would tick and the Borg would play
 *     identically either way.
 *   - The numeric settings (`borg_no_deeper`, `borg_munchkin_level`,
 *     `borg_enchant_limit`) have no yes-or-no shape, and the host's manifest rule
 *     schema (`PackRule` in `@rpgm-tools/neo-angband-mod-sdk`) carries only a
 *     boolean `default` - there is no numeric or range rule type to ask for one
 *     with. See PLANNED.md for what a host-side fix would need.
 *
 * `borg_munchkin_start` is NOT on this list any more: it moves real gear
 * valuation (`trait/power.ts`) even though the stair-scum diving mode it is
 * named for is not ported, and that is enough of a working setting to ship - the
 * manifest rule's own description says exactly which half it is.
 */
/**
 * The settings a rule can carry: the yes-or-no half of `BorgCfg`.
 *
 * Derived rather than listed, so wiring a rule to a numeric setting - a depth
 * ceiling, the enchant limit - is a compile error here rather than a toggle that
 * writes `true` into a field the decision code compares against a level.
 */
type BoolCfgKey = {
  [K in keyof BorgCfg]: BorgCfg[K] extends boolean ? K : never;
}[keyof BorgCfg];

const RULE_CFG: Readonly<Record<string, BoolCfgKey>> = {
  "borg.playsRisky": "playsRisky",
  "borg.worshipsDamage": "worshipsDamage",
  "borg.worshipsSpeed": "worshipsSpeed",
  "borg.worshipsHp": "worshipsHp",
  "borg.worshipsMana": "worshipsMana",
  "borg.worshipsAc": "worshipsAc",
  "borg.worshipsGold": "worshipsGold",
  "borg.selfScum": "selfScum",
  "borg.munchkinStart": "munchkinStart",
};

/**
 * Fold the resolved rule flags into a settings override.
 *
 * A flag the host did not resolve is left out rather than read as false. The
 * host resolves every rule this mod's own manifest declares, so a missing one
 * means the manifest and this table have drifted - and `selfScum` defaults to
 * ON, so reading absence as false would quietly switch off a setting upstream
 * ships enabled. src/manifest-tunables.test.ts is what stops the drift; this is
 * what stops it costing anything if it happens.
 */
function cfgFromFlags(
  flags: Readonly<Record<string, boolean>>,
): { [K in BoolCfgKey]?: boolean } {
  const cfg: { [K in BoolCfgKey]?: boolean } = {};
  for (const [flag, key] of Object.entries(RULE_CFG)) {
    const value = flags[flag];
    if (typeof value === "boolean") cfg[key] = value;
  }
  return cfg;
}

/**
 * The settings that are NOT on their stock value, for the log line.
 *
 * Named rather than counted, because the log of an unattended run is the only
 * record of what the Borg was told to do, and "3 settings changed" does not
 * explain a Borg that dived to depth twelve at character level four.
 */
function changedFrom(cfg: Partial<BorgCfg>): string[] {
  const stock = defaultCfg();
  return Object.entries(cfg)
    .filter(([key, value]) => stock[key as keyof BorgCfg] !== value)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
}

export default {
  api: 1,

  controller(ctx: ControllerCtx): AgentController | undefined {
    /* Returning undefined is a decline, and the host leaves the human at the
     * keyboard. This is the normal case: the mod is installed and enabled, and
     * the player has not asked it to play. */
    if (ctx.flags[AUTOPLAY_FLAG] !== true) return undefined;

    bindCore(ctx.core);
    if (!coreIsBound()) {
      /* Unreachable unless bindCore itself changes shape. Checked anyway,
       * because the failure it guards against is not an exception - it is FEAT
       * and TV reading undefined inside a decision ladder, which looks like the
       * Borg making bad choices rather than like a broken mod. */
      throw new Error("the Borg could not take the engine from ctx.core");
    }

    /*
     * DANGER VISION. Without this the Borg plays blind: every seam in
     * BorgResolvers falls back to a deliberately inert default, and the one that
     * matters is resolveMonsterFacts - zero blows and zero spell frequency, so
     * borg_danger returns no threat, so nothing is ever worth fleeing. The ported
     * math was correct the whole time and was being fed zeroes.
     *
     * `makeCoreResolvers` has existed in src/resolvers.ts since the port landed
     * and had NO CALLER, because the facts resolver is asked about a monster the
     * Borg is TRACKING rather than one on screen, which needs the race registry
     * by ridx, and no path from a plugin to that registry existed. `ctx.registries`
     * is that path.
     *
     * MODDED CREATURES COME FREE, which is the point of reading the registry
     * rather than shipping a table. Binding runs after mods compose, so a mod's
     * monster is a MonsterRace at a real ridx in this list and the Borg fears it
     * on exactly the same arithmetic as one of core's. A vanilla-only table would
     * have made every modded monster invisible to the danger math - the same
     * defect as the inert default, restricted to modded content, and much harder
     * to notice.
     *
     * ACTIVATION IDENTITY AND THE IN-SHOP SIGNAL are wired the same way, from
     * `ctx.registries.objects` and `ctx.state`. Both are passed unconditionally.
     * They used to be spread in only when present, back when this mod loaded
     * into games that predated them; the engine floor now covers that, and a
     * half-wired Borg is not a state worth being able to reach.
     *
     * LOADOUT EVALUATION is the fourth, and it is the odd one out: the wear /
     * buy / sell decisions score a loadout the character is not in, which only
     * the engine's own calc_bonuses can derive. It arrives through the frozen
     * view's own `simulateLoadout` accessor rather than through anything read
     * here, so the ItemViews it produces are the same ones the live view
     * produces - see src/resolvers.ts. Nothing about it is conditional any more:
     * manifest.json requires an engine that has it.
     *
     * THE ATTACK-MESSAGE TABLE is the fifth, and it decides whether the Borg
     * notices being hit by something it cannot see. Upstream builds it from
     * blow_methods at start-up; this reads the same records from
     * `ctx.registries.monsters.blowMethods`, so a mod's own blow method is
     * recognised on the same terms. Without it an unexplained blow raises no
     * regional fear and the Borg will rest through a beating.
     *
     * The force-descend option is still on its default and is NOT covered by
     * this call; see PLANNED.md.
     */
    const missing: string[] = [];
    if (!ctx.registries) missing.push("ctx.registries");
    if (!ctx.state) missing.push("ctx.state");
    if (missing.length > 0) {
      /* Unreachable through the game's own loader. manifest.json declares
       * `engine: ">=0.25.0"`, and for a mod that ships CODE an out-of-range
       * engine is a hard refusal in the host: the plugin is never imported, so
       * this function never runs on a game that predates either field. Checked
       * anyway, because the loader is not the only thing that can call a plugin
       * ABI, and because the failure it guards against is invisible in play - a
       * Borg built without these resolvers still returns a legal command every
       * turn and merely plays badly, which is the exact failure mode PLANNED.md
       * exists to describe. Naming the missing half is the difference between a
       * five-minute fix and a week of watching it lose. */
      throw new Error(
        `the Borg was given no ${missing.join(" and no ")}: a host that calls ` +
          `controller() supplies both, and this one did not`,
      );
    }

    const races = ctx.registries.monsters.races;
    const blowMethods = ctx.registries.monsters.blowMethods.values();
    const cfg = cfgFromFlags(ctx.flags);
    const borg = createBorg({
      resolvers: makeCoreResolvers({
        races,
        objects: ctx.registries.objects,
        state: ctx.state,
        blowMethods,
      }),
      cfg,
    });
    /* The race count is in the message because an empty registry is the one
     * remaining way to get a Borg that cannot see danger, and it looks from the
     * outside exactly like a Borg that plays badly. */
    ctx.log(
      `the Borg has the keyboard, and danger vision over ${races.length} races, ` +
        `activation identity, the in-shop signal and loadout evaluation`,
    );
    const changed = changedFrom(cfg);
    ctx.log(
      changed.length === 0
        ? "the Borg is on upstream's stock settings"
        : `the Borg's settings differ from stock: ${changed.join(", ")}`,
    );
    return borg.controller;
  },
};
