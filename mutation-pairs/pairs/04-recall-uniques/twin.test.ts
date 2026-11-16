import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgRecall } from "../../../src/fight/index.js";
import { SVAL, TV } from "../../../src/item/index.js";

it("Recall can reset its maximum depth of 99 when four uniques remain alive.", () => {
  const s = scene({ scenario: { player: { depth: 40, maxDepth: 99 } }, inventory: [item({ tval: TV.SCROLL, sval: SVAL.scroll.word_of_recall! })] });
  s.world.depthHuntedUnique = 40;
  s.world.liveUniques = 4;
  expect(borgRecall(s.ctx)).toEqual({ code: "read", args: { handle: 42 } });
  expect(s.world.resetRecallDepth).toBe(true);
});
