/**
 * borg_flow_recover's "do I need to recover some?" (borg-flow-misc.c:242-256),
 * branching on borg_primarily_caster (borg-magic.c:264: num_books > 3).
 */

import { describe, expect, it } from "vitest";
import { BorgWorld } from "../world/model.js";
import { borgNotice, BI } from "../trait/index.js";
import { CLASS_BLACKGUARD, CLASS_MAGE, CLASS_PALADIN, CLASS_PRIEST, CLASS_RANGER, CLASS_ROGUE, CLASS_WARRIOR } from "../trait/trait-index.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import type { BorgContext } from "../context.js";
import { borgNeedsRecover } from "./flow-misc.js";

/** A character at full HP, unhurt, with SP at 1 of 20 (below a quarter). */
function lowSp(cls: number): BorgContext {
  const world = new BorgWorld();
  const ctx: BorgContext = { world, view: makeScenarioView({}), act: makeFakeActions(), rng: makeBorgRng() };
  borgNotice(ctx);
  const t = world.self.trait;
  t[BI.CLASS] = cls;
  t[BI.CURHP] = 50;
  t[BI.MAXHP] = 50;
  t[BI.CURSP] = 1;
  t[BI.MAXSP] = 20;
  t[BI.ISCUT] = 0;
  t[BI.ISSTUN] = 0;
  t[BI.ISHEAVYSTUN] = 0;
  t[BI.ISAFRAID] = 0;
  return ctx;
}

describe("borg_flow_recover's need to recover", () => {
  it("makes a primary caster recover for SP", () => {
    expect(borgNeedsRecover(lowSp(CLASS_MAGE))).toBe(true);
    expect(borgNeedsRecover(lowSp(CLASS_PRIEST))).toBe(true);
  });

  it("does not make a hybrid with spell points recover for SP: they are not primary casters", () => {
    for (const cls of [CLASS_PALADIN, CLASS_ROGUE, CLASS_RANGER, CLASS_BLACKGUARD]) {
      expect(borgNeedsRecover(lowSp(cls)), `class ${String(cls)}`).toBe(false);
    }
  });

  it("still makes every class recover when hurt", () => {
    for (const cls of [CLASS_WARRIOR, CLASS_MAGE, CLASS_PALADIN, CLASS_BLACKGUARD]) {
      const ctx = lowSp(cls);
      ctx.world.self.trait[BI.CURHP] = 10;
      expect(borgNeedsRecover(ctx), `class ${String(cls)}`).toBe(true);
    }
  });
});
