import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgThinkStore } from "../../../src/store/index.js";
import { buildStoreDeps } from "../../../src/think-session.js";
import { TV } from "../../../src/item/index.js";

it("An existing purchase goal expires at town level age 2000.", () => {
  const s = scene({ scenario: { player: { depth: 0, gold: 1000, hp: 300 } } });
  s.ctx.view = { ...s.view, stores: () => [{ feat: 0, featName: "General Store", isHome: false, owner: { name: "owner", purse: 1000 }, stock: [{ ...item({ tval: TV.FOOD }), index: 0, price: 5 }] }] };
  Object.assign(s.world.self.goal, { shop: 0, ware: 0, item: -1 });
  expect(borgThinkStore(s.ctx, 0, { ...buildStoreDeps(s.session), began: s.world.clock - 2000 })).toEqual({ code: "shop-exit" });
});
