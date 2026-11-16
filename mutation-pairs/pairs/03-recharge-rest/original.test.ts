import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgRecover, SVAL, TV } from "../../../src/item/index.js";
import { buildItemDeps } from "../../../src/think-session.js";

it("A safe character rests 100 turns to recharge a recall rod.", () => {
  const s = scene({ inventory: [item({ tval: TV.ROD, sval: SVAL.rod.recall!, pval: 0 })] });
  expect(borgRecover(s.ctx, buildItemDeps(s.session))).toEqual({ code: "rest", args: { count: 100 } });
});
