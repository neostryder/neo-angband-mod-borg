import { describe, expect, it } from "vitest";
import type { BorgContext } from "./context.js";
import { BorgWorld } from "./world/model.js";
import { BI } from "./trait/index.js";
import { timeToStayOnLevel } from "./think-ladder.js";

function ctxWith(traits: Partial<Record<BI, number>>): BorgContext {
  const world = new BorgWorld();
  for (const [key, value] of Object.entries(traits)) world.self.trait[Number(key)] = value as number;
  return { world } as unknown as BorgContext;
}

describe("time to stay on a level (borg_time_to_stay_on_level)", () => {
  // The port has no level-feeling stream, so borg_feeling_stuff is always 0 and
  // the C's "clevel < 5 || !borg_feeling_stuff" guard always holds.
  it("stays 50 turns per character level below level 10", () => {
    expect(timeToStayOnLevel(ctxWith({ [BI.CLEVEL]: 7, [BI.MAXCLEVEL]: 7, [BI.FOOD]: 5 }), false)).toBe(350);
  });

  it("applies the low-level limits above level 5 while no feeling is known", () => {
    // Level 12 with little food and no regeneration: 2500 turns.
    expect(timeToStayOnLevel(ctxWith({ [BI.CLEVEL]: 12, [BI.MAXCLEVEL]: 12, [BI.FOOD]: 2 }), false)).toBe(2500);
    // The same character with regeneration: 2000 turns.
    expect(timeToStayOnLevel(ctxWith({ [BI.CLEVEL]: 12, [BI.MAXCLEVEL]: 12, [BI.FOOD]: 2, [BI.REG]: 1 }), false)).toBe(2000);
  });

  it("stays long enough to hope for a feeling while the max level is under 20", () => {
    expect(timeToStayOnLevel(ctxWith({ [BI.CLEVEL]: 17, [BI.MAXCLEVEL]: 17, [BI.FOOD]: 5 }), false)).toBe(100);
  });

  it("waits for a level feeling at 50000 turns once the max level reaches 20, a tenth of that when bored", () => {
    const strong = ctxWith({ [BI.CLEVEL]: 25, [BI.MAXCLEVEL]: 25, [BI.FOOD]: 5 });
    expect(timeToStayOnLevel(strong, false)).toBe(50000);
    expect(timeToStayOnLevel(strong, true)).toBe(5000);
  });
});
