import { expect, it } from "vitest";
import { scene } from "../../fixture.js";
import { borgEscape } from "../../../src/fight/index.js";
import { FEAT } from "../../../src/core-api.js";

it("A level-20 character standing on up stairs can escape by ascending.", () => {
  const s = scene({ scenario: { cells: { "10,10": { feat: FEAT.LESS } }, player: { hp: 100, maxHp: 100 } } });
  expect(borgEscape(s.ctx, 105)).toEqual({ code: "ascend" });
});
