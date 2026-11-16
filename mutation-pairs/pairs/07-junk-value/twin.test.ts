import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgCrushJunk } from "../../../src/item/index.js";

it("At depth 5, known gear worth 16 can be dropped when power is preserved.", () => {
  const s = scene({ inventory: [item({ value: 16 })] });
  expect(borgCrushJunk(s.ctx, { simDrop: () => true })).toEqual({ code: "drop", args: { handle: 42, quantity: 1 } });
});
