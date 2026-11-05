/**
 * The decision context handed to every Borg subsystem. Bundling the world
 * model, the perceive/act facades, and the Borg's private RNG into one object
 * lets the ported subsystems (flow, danger, power, fight, think) share state the
 * same way the C borg's file-scope globals did, without actual globals.
 */

import type { Rng } from "./rng.js";
import type { BorgActions, BorgView } from "./core-api.js";
import type { BorgWorld } from "./world/model.js";

/** Everything a decision subsystem needs, for one think. */
export interface BorgContext {
  /** Borg's remembered world (written by perceive, read by everyone). */
  world: BorgWorld;
  /** PERCEIVE: the frozen read facade (raw current view). */
  view: BorgView;
  /** ACT: the frozen command builders. */
  act: BorgActions;
  /** Borg's private simulation RNG (never the game RNG). */
  rng: Rng;
  /** Registered book identity (borg-magic.c:689-694). */
  bookKind?: ((tval: number, name: string) => { tval: number; sval: number } | null) | undefined;
  /** The spell's first effect (borg-magic.c:759). */
  spellEffect?: ((cls: string, sidx: number) => { name: string; aim: boolean } | null) | undefined;
}
