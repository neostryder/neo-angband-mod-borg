import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { borgThinkDungeon } from "../../../src/think-ladder.js";

it("An item with zero to-hit and no negative plusses remains worth picking up on arrival.", () => {
  const s = scene({ scenario: { floor: { "10,10": [item()] } } });
  s.session.arrivalPickup = true;
  s.session.pickupTried = "";
  expect(borgThinkDungeon(s.ctx, s.session)?.code).toEqual("pickup");
});
