import { expect, it } from "vitest";
import { scene } from "../../fixture.js";
import { perceive, makePerceiveMemo } from "../../../src/perceive.js";
import { borgPlayStep } from "../../../src/flow/index.js";

it("A level-4 character avoids walking into a unique monster in town.", () => {
  const s = scene({ scenario: { player: { depth: 0, level: 4, maxLevel: 4 }, monsters: [{ race: "Farmer Maggot", raceFlags: ["UNIQUE"], grid: { x: 11, y: 10 } }] } });
  perceive(s.world, s.view, makePerceiveMemo());
  expect(borgPlayStep(s.ctx, s.flow, 10, 11)).toEqual(null);
});
