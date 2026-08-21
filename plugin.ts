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

/**
 * What this plugin needs from the host's context, structurally. Declared here
 * rather than imported from the host's mod-plugin.ts because this file has to
 * compile in a standalone mod repository that holds no copy of the host - the
 * same reason bug-fixes and qol declare theirs.
 */
interface ControllerCtx {
  readonly flags: Readonly<Record<string, boolean>>;
  /**
   * The live engine namespace.
   *
   * Intersected with the ONE export that is newer than the engine version this
   * repository compiles against (`simulateLoadout`, Neo Angband 0.25.0). Declared
   * optional and read as a probe rather than called: this mod's engine range is
   * permissive on purpose, so it has to compile against the published 0.24.0
   * types and still recognise a newer game at runtime. See src/resolvers.ts's
   * CoreResolverInput.loadout for what the probe decides.
   */
  readonly core: typeof Core & { readonly simulateLoadout?: unknown };
  readonly log: (msg: string) => void;
  /**
   * The bound content registries (host `ctx.registries`, added 2026-08-21).
   *
   * Structurally optional and read defensively, because this file has to compile
   * and RUN against a host that predates the field: a mod installed into an older
   * game gets `undefined` here and must degrade rather than throw. `Core.CoreRegistries`
   * rather than a hand-written shape, so a change to the registry the Borg reads
   * fails this repository's build instead of surfacing as bad play.
   */
  readonly registries?: Core.CoreRegistries;
  /**
   * The live game state (host `ctx.state`), absent only during content
   * composition, before any character exists to have a grid. Declared as the
   * narrow shape resolvers.ts actually reads (player grid + level feature
   * lookup) rather than imported, for the same reason as ControllerCtx itself:
   * `GameState` is an internal host type, not part of the published surface.
   */
  readonly state?: {
    readonly actor: { readonly grid: { readonly x: number; readonly y: number } };
    readonly chunk: {
      feature(grid: { x: number; y: number }): { shopnum: number };
    };
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
     * `ctx.registries.objects` and `ctx.state`. Both are independently
     * optional in makeCoreResolvers, so a host with registries but a state
     * built before boot (or vice versa) still gets whichever half applies -
     * the four seams do not have to land together.
     *
     * LOADOUT EVALUATION is the fourth, and it is a capability question rather
     * than a datum. The wear / buy / sell decisions score a loadout the
     * character is not in, which only the engine's own calc_bonuses can derive;
     * `ctx.core.simulateLoadout` existing is what says this engine can. The
     * evaluation itself runs through the frozen view's own accessor, so the
     * ItemViews it produces are the same ones the live view produces - see
     * src/resolvers.ts. Probed rather than assumed, because this mod's engine
     * range stays permissive and an older game must degrade rather than throw.
     *
     * The force-descend option is still on its default and is NOT covered by
     * this call; see PLANNED.md.
     */
    const races = ctx.registries?.monsters.races;
    const objects = ctx.registries?.objects;
    const state = ctx.state;
    const loadout = typeof ctx.core.simulateLoadout === "function";
    const borg = races
      ? createBorg({
          resolvers: makeCoreResolvers({
            races,
            ...(objects ? { objects } : {}),
            ...(state ? { state } : {}),
            ...(loadout ? { loadout } : {}),
          }),
        })
      : createBorg();
    if (races) {
      const parts = [`danger vision over ${races.length} races`];
      parts.push(objects ? "activation identity" : "no activation identity");
      parts.push(state ? "in-shop signal" : "no in-shop signal");
      parts.push(loadout ? "loadout evaluation" : "no loadout evaluation");
      ctx.log(`the Borg has the keyboard, and ${parts.join(", ")}`);
    } else {
      /* An older host, or a context built before binding. Say which, because
       * "the Borg plays badly" and "the Borg was handed no monster data" look
       * identical from the outside and have completely different fixes. */
      ctx.log("the Borg has the keyboard, but this host supplies no monster registry: playing blind");
    }
    return borg.controller;
  },
};
