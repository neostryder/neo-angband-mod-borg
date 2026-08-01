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

/**
 * What this plugin needs from the host's context, structurally. Declared here
 * rather than imported from the host's mod-plugin.ts because this file has to
 * compile in a standalone mod repository that holds no copy of the host - the
 * same reason bug-fixes and qol declare theirs.
 */
interface ControllerCtx {
  readonly flags: Readonly<Record<string, boolean>>;
  readonly core: typeof Core;
  readonly log: (msg: string) => void;
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

    const borg = createBorg();
    ctx.log("the Borg has the keyboard");
    return borg.controller;
  },
};
