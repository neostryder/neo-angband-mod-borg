import { beforeEach, describe, expect, it, vi } from "vitest";
import { BorgWorld, GOAL_FLEE } from "../world/model.js";
import { makeScenarioView, makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import { BI } from "../trait/trait-index.js";
import { FEAT } from "../core-api.js";
import { BORG_VIEW } from "../world/grid.js";
import { getThinkSession } from "../think-session.js";
import { getDangerGlobals } from "../danger/state.js";
import { getFightState } from "./state.js";
import { borgCaution } from "./caution.js";
import { borgEscape } from "./escape.js";
import { borgDanger } from "../danger/index.js";
vi.mock("../danger/index.js", async (original) => ({ ...await original<object>(), borgDanger: vi.fn() }));
vi.mock("./escape.js", async (original) => ({ ...await original<object>(), borgEscape: vi.fn(() => ({ code: "read", args: { handle: 99 } })) }));

function scene() {
  const world = new BorgWorld(), flow = getThinkSession(world).flow.state;
  const ctx = { world, view: makeScenarioView(), act: makeFakeActions(), rng: makeBorgRng(1) };
  const t = world.self.trait;
  for (const [key, value] of [[BI.CURHP, 10], [BI.MAXHP, 16], [BI.CLEVEL, 2], [BI.MAXCLEVEL, 2],
    [BI.CDEPTH, 1], [BI.MAXDEPTH, 1], [BI.LIGHT, 2], [BI.FOOD, 7], [BI.SPEED, 110]] as const) t[key] = value;
  world.self.c = { x: 10, y: 10 };
  world.self.goal.fleeing = true;
  world.clock = 1000;
  flow.avoidance = getDangerGlobals(world).avoidance = 10;
  flow.hooks.danger = () => 0;
  flow.hooks.preparedToDescend = () => false;
  flow.hooks.countSell = () => 0;
  for (let y = 0; y < world.map.height; y++) for (let x = 0; x < world.map.width; x++) world.map.at(x, y).feat = FEAT.GRANITE;
  for (const x of [10, 11, 12]) { const a = world.map.at(x, 10); a.feat = FEAT.FLOOR; a.info = BORG_VIEW; }
  flow.step.add(10, 11);
  vi.mocked(borgDanger).mockImplementation((_ctx, _y, x) => x === 10 ? 8 : 0);
  return { world, flow, ctx, t };
}
beforeEach(() => vi.clearAllMocks());
describe("C caution retreats before teleport escape", () => {
  it("takes a reachable happy grid before spending a phase scroll", () => {
    const { ctx, world } = scene();
    expect(borgCaution(ctx, getThinkSession(world).flow.state)).toEqual({ code: "walk", dir: 6 });
    expect(borgEscape).not.toHaveBeenCalled();
    expect(world.self.goal.type).toBe(0);
  });
  it.each(["confused", "no retreat", "recent antisummon", "not worth the step", "trap", "occupied", "morgoth", "high HP", "looping"])("keeps the C strategic guard: %s", (guard) => {
    const { ctx, world, flow, t } = scene();
    if (guard === "confused") t[BI.ISCONFUSED] = 1;
    if (guard === "no retreat") world.self.noRetreat = 1;
    if (guard === "recent antisummon") getFightState(world).tAntisummon = 990;
    if (guard === "not worth the step") vi.mocked(borgDanger).mockImplementation((_ctx, _y, x) => x === 10 ? 8 : 4);
    if (guard === "trap") world.map.at(11, 10).trap = true;
    if (guard === "occupied") world.map.at(11, 10).kill = 1;
    if (guard === "morgoth") getDangerGlobals(world).morgothPosition = true;
    if (guard === "high HP") t[BI.CURHP] = 500;
    if (guard === "looping") world.self.timeThisPanel = 300;
    expect(borgCaution(ctx, flow)?.code).toBe("read");
  });
  it("heads for adjacent up stairs desperately, including against a dog", () => {
    const { ctx, world, flow } = scene();
    world.facts.scaryGuyOnLevel = true;
    world.facts.uniqueOnLevel = 1;
    world.map.at(12, 10).feat = FEAT.LESS;
    flow.less.add(10, 12);
    flow.hooks.danger = () => 100;
    expect(borgCaution(ctx, flow)).toEqual({ code: "walk", dir: 6 });
    expect(world.self.goal.type).toBe(GOAL_FLEE);
    expect(flow.borgDesperate).toBe(false);
    expect(borgEscape).not.toHaveBeenCalled();
  });
  it("takes nearby down stairs when no up stairs are known", () => {
    const { ctx, world, flow } = scene();
    world.map.at(12, 10).feat = FEAT.MORE;
    flow.more.add(10, 12);
    flow.hooks.danger = () => 100;
    expect(borgCaution(ctx, flow)).toEqual({ code: "walk", dir: 6 });
    expect(world.self.goal.type).toBe(GOAL_FLEE);
    expect(flow.borgDesperate).toBe(false);
  });
  it("preserves C's farthest-stair scan instead of silently choosing the nearest", () => {
    const { ctx, world, flow } = scene();
    world.map.at(12, 10).feat = FEAT.LESS;
    flow.less.add(10, 12);
    flow.less.add(10, 30);
    world.map.at(30, 10).feat = FEAT.LESS;
    // Suppress strategic retreat; danger then tests only the stair pass.
    world.self.noRetreat = 1;
    expect(borgCaution(ctx, flow)?.code).toBe("read");
    expect(borgEscape).toHaveBeenCalled();
  });
  it("does not reject a strategic step merely for a fast monster within two grids", () => {
    const { ctx, world, flow } = scene();
    const i = world.kills.alloc(), kill = world.kills.at(i);
    kill.rIdx = 47; kill.pos = { x: 12, y: 10 }; kill.speed = 120; kill.when = world.clock;
    // C's inner fast-monster scan does not break the simulated path.
    expect(borgCaution(ctx, flow)).toEqual({ code: "walk", dir: 6 });
  });
  it("keeps the first-step integer threshold strict at floor(HP*4/10)", () => {
    const { ctx, flow, t } = scene();
    t[BI.CURHP] = 9;
    vi.mocked(borgDanger).mockImplementation((_ctx, _y, x) => x === 10 ? 8 : 3);
    expect(borgCaution(ctx, flow)?.code).toBe("read");
    vi.mocked(borgDanger).mockImplementation((_ctx, _y, x) => x === 10 ? 8 : 2);
    expect(borgCaution(ctx, flow)).toEqual({ code: "walk", dir: 6 });
  });

  it("preserves C's last-wins view order on equally close happy grids", () => {
    const { ctx, world, flow } = scene();
    world.map.at(9, 10).feat = FEAT.FLOOR;
    world.map.at(9, 10).info = BORG_VIEW;
    flow.step.add(10, 9);
    // C view order: east axis, then west axis. Both are one step and safe.
    expect(borgCaution(ctx, flow)).toEqual({ code: "walk", dir: 4 });
  });

});
