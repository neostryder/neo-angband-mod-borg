/**
 * The ONE place the Borg reaches into the engine for a runtime value.
 *
 * WHY THIS FILE EXISTS, and it is not tidiness. The mod builder REFUSES a plugin
 * that bundles a copy of the engine: a second `@rpgm-tools/neo-angband-core`
 * inside plugin.js would give it its own registries while the game ran on
 * another set, and the two would agree right up until they did not. A mod
 * receives the live engine as `ctx.core` instead - the same module instance the
 * game is running on.
 *
 * Which meant every bare `import ... from "@rpgm-tools/neo-angband-core"` in the
 * Borg was a line that had to change on the way out of the engine repository.
 * Measured before the move: 37 files mentioned the package and **28 of those
 * were `import type`**, which compiles to nothing and could stay exactly as it
 * was. The runtime coupling was six symbols across eight files, funnelled here
 * so the extraction replaced ONE file. `core-import-census.test.ts` is what
 * keeps that true: it fails if a second file grows a value import.
 *
 * HOW THE INDIRECTION WORKS: ESM live bindings, not a Proxy. `export let` is a
 * binding importers see through, so `bindCore` reassigning FEAT here updates
 * `FEAT` at every use site, and esbuild preserves that inside the bundle. A
 * Proxy would also work and is worse: it would have to get iteration, spread and
 * `new` right for six symbols of three different kinds, and each of those is a
 * way to be subtly wrong. A reassigned variable IS the engine's own object.
 *
 * THE ONE RULE THIS IMPOSES: nothing may read these at MODULE TOP LEVEL, because
 * modules evaluate at import time and `bindCore` runs after. Measured across the
 * whole port: exactly one site did - a `const` array of TV values in
 * think-ladder.ts - and it was made lazy. `top-level-core-use.test.ts` fails if
 * a second appears, because the alternative symptom is an `undefined` read
 * somewhere inside a decision ladder.
 *
 * Type-only imports are deliberately NOT funnelled. They are erased, they cost
 * the mod nothing, and routing them through here would hide which engine types
 * each module actually speaks in.
 */

import type * as Core from "@rpgm-tools/neo-angband-core";

/* Both a TYPE and a VALUE, because the Borg uses Rng as both: `new Rng(...)` in
 * rng.ts and `rng: Rng` in a great many signatures. TypeScript keeps the type
 * and value declaration spaces separate, so one name can be both. */
export type Rng = Core.Rng;

export let FEAT!: typeof Core.FEAT;
export let TV!: typeof Core.TV;
export let RSF!: typeof Core.RSF;
export let Rng!: typeof Core.Rng;
export let MON_RACE_FLAG_ENTRIES!: typeof Core.MON_RACE_FLAG_ENTRIES;
export let MON_SPELL_ENTRIES!: typeof Core.MON_SPELL_ENTRIES;

let bound = false;

/**
 * Hand the Borg the live engine. Called once from plugin.ts, with `ctx.core`,
 * before any other Borg code runs.
 */
export function bindCore(core: typeof Core): void {
  FEAT = core.FEAT;
  TV = core.TV;
  RSF = core.RSF;
  Rng = core.Rng;
  MON_RACE_FLAG_ENTRIES = core.MON_RACE_FLAG_ENTRIES;
  MON_SPELL_ENTRIES = core.MON_SPELL_ENTRIES;
  bound = true;
}

/**
 * Whether bindCore has run. Exists so the entry point can refuse to build a Borg
 * against an unbound engine with a sentence, rather than letting the first
 * `FEAT.MORE` read undefined several hundred decisions later.
 */
export function coreIsBound(): boolean {
  return bound;
}
