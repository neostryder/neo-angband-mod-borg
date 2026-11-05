import { describe, expect, it, vi } from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import { createBorg } from "./controller.js";
import { createTick } from "./api2/controller.js";
import { createBridge } from "./api2/host.js";
import { fakeGame, knownWorld } from "./harness-api2.js";
import { makeScenarioView } from "./harness.js";
import { getThinkSession } from "./think-session.js";
import { makeCoreResolvers } from "./resolvers.js";

async function historyGame(refuse = false) {
  const game = fakeGame({ engine: { core: Core }, submit: () => !refuse });
  let known = knownWorld(makeScenarioView());
  vi.spyOn(game.mod.view, "world").mockImplementation(() => Promise.resolve({ ok: true, value: known }));
  const bridge = createBridge(game.mod);
  await bridge.prime();
  const borg = createBorg({ resolvers: makeCoreResolvers(bridge.resolverInput()) });
  const step = getThinkSession(borg.world).flow.state.step;
  const history = () => step.x.slice(0, step.num).map((x, i) => [x, step.y[i]!]);
  let pending = 0;
  const passes: number[][][] = [];
  const tick = createTick({
    ...bridge,
    loadoutsPending: () => pending > 0,
    settleLoadouts: () => {
      pending -= 1;
      return Promise.resolve(1);
    },
  }, {
    controller: (view, act) => {
      const command = borg.controller(view, act);
      passes.push(history());
      return command;
    },
    rewind: borg.rewind,
  });

  return {
    game,
    borg,
    history,
    passes,
    async decide(x: number, y: number, depth = 1, retries = 0, shopnum: number | null = null) {
      const snapshot = knownWorld(makeScenarioView({
        width: 90,
        height: 7,
        player: { grid: { x, y }, depth },
        cells: { "80,3": { feat: Core.FEAT.MORE } },
      }));
      known = { ...snapshot, player: { ...snapshot.player!, shopnum } };
      pending = retries;
      await tick(game.mod, game.input());
    },
  };
}

describe("position history through the controller", () => {
  it("records each decision once across loadout retries and keeps the bounce pattern", async () => {
    const run = await historyGame();
    await run.decide(10, 3, 1, 2);
    expect(run.passes).toEqual([[[10, 3]], [[10, 3]], [[10, 3]]]);
    await run.decide(9, 3);
    await run.decide(10, 3, 1, 2);
    const bounce = [[10, 3], [9, 3], [10, 3]];
    expect(run.passes.slice(-3)).toEqual([bounce, bounce, bounce]);
    expect(run.borg.world.clock).toBe(1002);
    expect(run.borg.world.self.timeThisPanel).toBe(3);
    await run.decide(10, 3);
    expect(run.history()).toEqual([...bounce, [10, 3]]);
  });

  it("records the new level entry once across retries after clearing the previous level", async () => {
    const run = await historyGame();
    await run.decide(10, 3);
    await run.decide(9, 3);
    await run.decide(20, 4, 2, 2);
    expect(run.passes.slice(-3)).toEqual([[[20, 4]], [[20, 4]], [[20, 4]]]);
    await run.decide(21, 4, 2);
    expect(run.history()).toEqual([[20, 4], [21, 4]]);
  });

  it("compacts at 75 once per decision, including the first zero-filled tail", async () => {
    const run = await historyGame();
    for (let x = 1; x <= 74; x++) await run.decide(x, 3);
    const first = Array.from({ length: 74 }, (_, i) => [i + 1, 3]);
    expect(run.history()).toEqual(first);
    await run.decide(75, 3, 1, 2);
    /* The zero-filled tail follows the C's inclusive shift (borg-update.c:2472-2479). */
    const compacted = [...first.slice(1), [75, 3], [0, 0]];
    expect(run.passes.slice(-3)).toEqual([compacted, compacted, compacted]);
    await run.decide(76, 3, 1, 2);
    const next = [...compacted.slice(1), [76, 3]];
    expect(run.passes.slice(-3)).toEqual([next, next, next]);
    expect(run.borg.world.clock).toBe(1075);
  });

  it("records a fresh decision at the same position after a refused command", async () => {
    const run = await historyGame(true);
    await run.decide(10, 3);
    await run.decide(10, 3);
    expect(run.game.submitted).toHaveLength(2);
    expect(run.game.logs.some((line) => line.includes("was refused"))).toBe(true);
    expect(run.history()).toEqual([[10, 3], [10, 3]]);
  });

  it("keeps history across store decisions and resumes recording on exit", async () => {
    const run = await historyGame();
    await run.decide(10, 3, 0);
    await run.decide(10, 3, 0, 2, 0);
    expect(run.borg.world.self.inShop).toBe(true);
    expect(run.passes.slice(-3)).toEqual([[[10, 3]], [[10, 3]], [[10, 3]]]);
    await run.decide(10, 3, 0);
    expect(run.borg.world.self.inShop).toBe(false);
    expect(run.history()).toEqual([[10, 3], [10, 3]]);
  });
});
