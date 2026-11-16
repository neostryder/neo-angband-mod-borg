import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgCrushJunk } from "../../../src/item/index.js";

it("At depth 5, known gear worth 16 is kept by the value threshold.", () => {
  const s = scene({ inventory: [item({ value: 16 })] });
  expect(borgCrushJunk(s.ctx, { simDrop: () => true })).toEqual(null);
});
