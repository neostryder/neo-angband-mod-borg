import { expect, it } from "vitest";
import { scene } from "../../fixture.js";
import { borgThinkDungeon } from "../../../src/think-ladder.js";

it("The bouncing-Borg check starts forgetting tracked floor objects at panel age 501.", () => {
  const s = scene();
  const index = s.world.takes.alloc();
  Object.assign(s.world.takes.at(index), { kIdx: 1, pos: { x: 18, y: 18 }, value: 0 });
  s.world.map.at(18, 18).take = index;
  s.world.self.timeThisPanel = 500;
  expect(borgThinkDungeon(s.ctx, s.session)).toEqual({ code: "rest", args: { count: -2 } });
  expect(s.world.takes.has(index)).toBe(true);
});
