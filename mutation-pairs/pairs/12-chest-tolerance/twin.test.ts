import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgPlayStep } from "../../../src/flow/index.js";
import { BI } from "../../../src/trait/index.js";
import { TV } from "../../../src/item/index.js";

it("A known trapped chest is disarmed only when device skill minus trap strength exceeds 7.", () => {
  const chest = { ...item({ tval: TV.CHEST, label: "wooden chest", pval: 10 }), trapKnown: true };
  const s = scene({ scenario: { floor: { "11,10": [chest] } } });
  s.world.self.trait[BI.DEV] = 17;
  expect(borgPlayStep(s.ctx, s.flow, 10, 11)).toEqual({ code: "walk", dir: 6 });
});
