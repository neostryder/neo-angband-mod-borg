import { describe, expect, it } from "vitest";
import { BorgWorld, GOAL_DARK, GOAL_KILL } from "./world/model.js";
import { makeScenarioView, makeFakeActions } from "./harness.js";
import { perceive, makePerceiveMemo } from "./perceive.js";
import { getThinkSession, primeSession } from "./think-session.js";
import { borgFlowClear, borgFlowEnqueueGrid, dataIdx } from "./flow/flow.js";
import { BI } from "./trait/trait-index.js";
import { makeBorgRng } from "./rng.js";
import { borgThinkDungeon } from "./think-ladder.js";
import { FEAT } from "./core-api.js";
import { getDangerGlobals } from "./danger/state.js";

function scene() {
  const world = new BorgWorld(), memo = makePerceiveMemo();
  const session = getThinkSession(world), flow = session.flow.state;
  const view = makeScenarioView({ player: { grid: { x: 10, y: 10 }, depth: 1 } });
  const ctx = { world, view, act: makeFakeActions(), rng: makeBorgRng(1) };
  perceive(world, view, memo);
  world.self.trait[BI.LIGHT] = 2;
  world.self.goal.type = GOAL_DARK;
  const warm = () => { flow.know.fill(1); flow.icky.fill(0); flow.borgDangerWipe = false; };
  warm();
  const see = (x: number, raceIndex = 27, asleep = false) => perceive(world, makeScenarioView({
    player: { grid: { x: 10, y: 10 }, depth: 1 },
    monsters: [{ id: 1, raceIndex, race: "floating eye", grid: { x, y: 10 }, raceFlags: ["NEVER_MOVE"], asleep }],
  }), memo);
  return { world, ctx, flow, session, memo, warm, see };
}

describe("C danger cache invalidation", () => {
  it("rejects a newly dangerous cached-safe route when a monster appears", () => {
    const { world, ctx, flow, see } = scene();
    flow.hooks.danger = () => 400;
    flow.avoidance = 12;
    see(13);
    expect(world.self.goal.type).toBe(0); // new lit LOS monster cancels the old flow
    borgFlowClear(flow);
    borgFlowEnqueueGrid(ctx, flow, 10, 12);
    expect(flow.icky[dataIdx(12, 10)]).toBe(1);
    expect(flow.cost[dataIdx(12, 10)]).toBe(255);
  });
  it("invalidates on motion and race conversion, but not an unchanged sighting", () => {
    const { world, flow, warm, see } = scene();
    see(13); warm(); see(13);
    expect(flow.borgDangerWipe).toBe(false);
    see(12); expect(flow.borgDangerWipe).toBe(true);
    warm(); world.self.goal.type = GOAL_DARK;
    see(12, 28); expect(flow.borgDangerWipe).toBe(true);
    expect(world.self.goal.type).toBe(0);
  });
  it("invalidates a deletion and cancels only the matching kill flow", () => {
    const { world, flow, see, warm } = scene();
    see(13); warm();
    world.self.goal.type = GOAL_KILL;
    flow.flowX[0] = 13; flow.flowY[0] = 10;
    world.kills.delete(1);
    expect(flow.borgDangerWipe).toBe(true);
    expect(world.self.goal.type).toBe(0);
    expect(world.map.at(13, 10).kill).toBe(0);
  });
  it("forgets cached safety on an empty new level", () => {
    const { world, flow, memo } = scene();
    perceive(world, makeScenarioView({ player: { depth: 2 } }), memo);
    expect(flow.borgDangerWipe).toBe(true);
    borgFlowClear(flow);
    expect(flow.know[dataIdx(12, 10)]).toBe(0);
  });
  it("retains the previous avoidance across priming so the dungeon rung can detect HP loss", () => {
    const { world, ctx, session, flow } = scene();
    const g = getDangerGlobals(world);
    g.avoidance = flow.avoidance = 16;
    world.self.trait[BI.CURHP] = 4;
    primeSession(session, ctx);
    primeSession(session, ctx); // controller and think both prime
    expect(g.avoidance).toBe(16);
    expect(flow.avoidance).toBe(16);
  });
  it("replaces avoidance and invalidates at the C dungeon rung after priming", () => {
    const { world, ctx, session, flow } = scene();
    const g = getDangerGlobals(world);
    g.avoidance = flow.avoidance = 16;
    world.self.trait[BI.CURHP] = 4;
    world.self.trait[BI.MAXHP] = 16;
    world.self.trait[BI.CLEVEL] = world.self.trait[BI.MAXCLEVEL] = 1;
    world.self.trait[BI.CDEPTH] = 1;
    flow.less.add(10, 10);
    world.map.at(10, 10).feat = FEAT.LESS;
    primeSession(session, ctx);
    expect(borgThinkDungeon(ctx, session)).toEqual({ code: "ascend" });
    expect(g.avoidance).toBe(4);
    expect(flow.avoidance).toBe(4);
    expect(flow.borgDangerWipe).toBe(true);
  });
  it("invalidates a new dark encounter without cancelling its old goal", () => {
    const { world, flow, see } = scene();
    world.self.trait[BI.LIGHT] = 0;
    see(13);
    expect(flow.borgDangerWipe).toBe(true);
    expect(world.self.goal.type).toBe(GOAL_DARK);
  });

  it("clears the goal when a tracked monster falls asleep", () => {
    const { world, flow, see, warm } = scene();
    see(13); warm(); world.self.goal.type = GOAL_DARK;
    see(13, 27, true);
    expect(flow.borgDangerWipe).toBe(true);
    expect(world.self.goal.type).toBe(0);
  });

});
