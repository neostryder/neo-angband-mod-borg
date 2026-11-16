import { expect, it } from "vitest";
import { scene, item } from "../../fixture.js";
import { TV } from "../../../src/item/index.js";
import { borgPlayMagic } from "../../../src/item/magic-play.js";

it("An untried spell can be practiced on dungeon depth 1.", () => {
  const s = scene({ scenario: { player: { cls: "Mage", depth: 1, level: 5, maxLevel: 5, sp: 10, maxSp: 10 } }, inventory: [item({ tval: TV.MAGIC_BOOK, sval: 1 })], books: [{ tval: TV.MAGIC_BOOK, realm: "arcane", name: "Magic for Beginners", spells: [{ name: "Magic Missile", sidx: 0, bidx: 0, level: 1, mana: 1, fail: 0, learned: true, worked: false, forgotten: false, studyEligible: false, infoLine: "" }] }], borg: { resolvers: { bookKind: (tval) => ({ tval, sval: 1 }), spellEffect: () => ({ name: "BOLT_OR_BEAM", aim: true }) } } });
  expect(borgPlayMagic(s.ctx, true)).toEqual({ code: "cast", args: { spell: 0 } });
});
