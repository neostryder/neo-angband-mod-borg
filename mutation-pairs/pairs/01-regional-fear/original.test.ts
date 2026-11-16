import { expect, it } from "vitest";
import { scene } from "../../fixture.js";
import { borgRecover } from "../../../src/item/index.js";
import { buildItemDeps } from "../../../src/think-session.js";
import { getFearCaches } from "../../../src/danger/index.js";

it("Rest remains legal when regional fear equals floor(current HP / 20).", () => {
  const s = scene();
  getFearCaches(s.world).region2d[0]![0] = 10;
  expect(borgRecover(s.ctx, buildItemDeps(s.session))).toEqual({ code: "rest", args: { count: -2 } });
});
