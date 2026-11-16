import { expect, it } from "vitest";
import { scene } from "../../fixture.js";
import { perceive, makePerceiveMemo } from "../../../src/perceive.js";
import { borgPlayStep } from "../../../src/flow/index.js";
import { borgUpdateMonsterFear, getFearCaches, MONBLOW } from "../../../src/danger/index.js";

it("A visible monster can add monster-grid fear in town.", () => {
  const s = scene({ scenario: { player: { depth: 0 }, monsters: [{ race: "rogue", grid: { x: 11, y: 10 } }] }, borg: { resolvers: { resolveMonsterFacts: (_ctx, index) => ({ rIdx: index, flags: new Set(), level: 20, sleep: 0, spellPower: 0, freqInnate: 0, freqSpell: 0, hasFriends: false, blows: [{ dice: 10, sides: 10, effect: MONBLOW.HURT }], spells: [] }) } } });
  perceive(s.world, s.view, makePerceiveMemo());
  borgUpdateMonsterFear(s.ctx);
  expect(borgPlayStep(s.ctx, s.flow, 10, 11)).toEqual({ code: "walk", dir: 6 });
  expect(getFearCaches(s.world).monsters(10, 10)).toBeGreaterThan(0);
});
