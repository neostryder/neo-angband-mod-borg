/**
 * Hallucination and amnesia: the two traits the Borg reads (ISIMAGE, ISFORGET)
 * and the borg_update branches that depend on them. The player view comes from
 * the same function the game's mod host uses, so a status the producer never
 * fills would fail here and not only in a hand-built fixture.
 */

import { describe, expect, it } from "vitest";
import type { KnownPlayer } from "@rpgm-tools/neo-angband-mod-sdk";
import { BorgWorld } from "./world/model.js";
import { GOAL_KILL } from "./world/model.js";
import { perceive, makePerceiveMemo, borgForgetGoalWhileImpaired } from "./perceive.js";
import { borgNotice, BI } from "./trait/index.js";
import { borgFollowMissingKills, createFlowState } from "./flow/index.js";
import { makeScenarioView, makeFakeActions } from "./harness.js";
import { makeBorgRng } from "./rng.js";
import { playerView } from "./api2/world.js";
import type { GradeFloors } from "./api2/records.js";
import type { BorgContext } from "./context.js";
import { BORG_LIGHT, BORG_VIEW } from "./world/grid.js";

function ctxFor(scenario: Parameters<typeof makeScenarioView>[0], world = new BorgWorld()): BorgContext {
  return { world, view: makeScenarioView(scenario), act: makeFakeActions(), rng: makeBorgRng() };
}

describe("the traits come from the status", () => {
  it("playerView reports hallucination and amnesia as timers the Borg can read", () => {
    const clear = {
      timed: {},
      blind: null,
      confused: null,
      afraid: null,
      poisoned: null,
      cut: null,
      stun: null,
      paralyzed: null,
      food: 50,
      foodGrade: null,
      fast: null,
      sprint: null,
      protEvil: null,
      hero: null,
      shero: null,
      shield: null,
      stoneskin: null,
      blessed: null,
      fastcast: null,
      resAcid: null,
      resElec: null,
      resFire: null,
      resCold: null,
      resPois: null,
      fearful: false,
      terror: null,
      amnesia: "Amnesiac",
      image: "Halluc",
    };
    const floors: GradeFloors = new Map([
      ["IMAGE", new Map([["Halluc", 1]])],
      ["AMNESIA", new Map([["Amnesiac", 1]])],
    ]);
    const known = { status: clear, recall: false, descent: false } as unknown as KnownPlayer;
    const status = playerView(known, floors).status;
    expect(status.image).toBe(1);
    expect(status.amnesia).toBe(1);
  });

  it("borgNotice sets ISIMAGE and ISFORGET, and clears them again", () => {
    const on = ctxFor({ player: { status: { image: 12, amnesia: 7 } } });
    borgNotice(on);
    expect(on.world.self.trait[BI.ISIMAGE]).toBe(1);
    expect(on.world.self.trait[BI.ISFORGET]).toBe(1);

    const off = ctxFor({ player: { status: { image: 0, amnesia: 0 } } }, on.world);
    borgNotice(off);
    expect(off.world.self.trait[BI.ISIMAGE]).toBe(0);
    expect(off.world.self.trait[BI.ISFORGET]).toBe(0);
  });
});

describe("while hallucinating", () => {
  const halluc = { player: { grid: { x: 5, y: 5 }, status: { image: 1 } } };

  it("records no monster and no object, new or already tracked", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(world, makeScenarioView({ player: { grid: { x: 5, y: 5 } }, monsters: [{ id: 9, grid: { x: 8, y: 5 } }], floor: { "6,5": [{ tval: 5 } as never] } }), memo);
    expect([...world.kills.entries()]).toHaveLength(1);
    expect([...world.takes.entries()]).toHaveLength(1);

    const ctx = ctxFor({ ...halluc, monsters: [{ id: 10, grid: { x: 9, y: 5 } }], floor: { "7,5": [{ tval: 5 } as never] } }, world);
    borgNotice(ctx);
    world.clock = 5;
    perceive(world, ctx.view, memo);
    /* The old object is deleted (:1585); the old monster is kept, recently seen. */
    expect([...world.takes.entries()]).toHaveLength(0);
    expect([...world.kills.entries()]).toHaveLength(1);
    expect([...world.kills.entries()][0]![1].mIdx).toBe(9);
  });

  it("drops even a recently seen monster when it is also afraid", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(world, makeScenarioView({ monsters: [{ id: 9, grid: { x: 8, y: 5 } }] }), memo);
    expect([...world.kills.entries()]).toHaveLength(1);

    const ctx = ctxFor({ ...halluc, player: { ...halluc.player, status: { image: 1, afraid: 1 } } }, world);
    borgNotice(ctx);
    world.clock = 5;
    perceive(world, ctx.view, memo);
    expect([...world.kills.entries()]).toHaveLength(0);
  });

  it("does not run the missing-monster pass", () => {
    /* A tracked monster out of view that the Borg is standing next to. Left
     * alone the pass follows or deletes it, which the baseline proves. */
    const run = (status: { image?: number }): { moved: boolean; gone: boolean } => {
      const world = new BorgWorld();
      const memo = makePerceiveMemo();
      perceive(world, makeScenarioView({ player: { grid: { x: 5, y: 5 } }, monsters: [{ id: 9, grid: { x: 6, y: 5 } }] }), memo);
      const [i, kill] = [...world.kills.entries()][0]!;
      const start = { x: kill.pos.x, y: kill.pos.y };
      kill.seen = false;
      kill.awake = true;
      kill.when = 0;
      world.clock = 3;
      /* Its grid is lit and in line of sight, and the monster is not there. */
      world.map.at(start.x, start.y).info |= BORG_VIEW | BORG_LIGHT;
      const ctx = ctxFor({ player: { grid: { x: 5, y: 5 }, status } }, world);
      borgNotice(ctx);
      borgFollowMissingKills(ctx, createFlowState());
      const after = world.kills.at(i);
      const gone = ![...world.kills.entries()].some(([j]) => j === i);
      return { gone, moved: !gone && (after.pos.x !== start.x || after.pos.y !== start.y) };
    };
    const baseline = run({});
    expect(baseline.gone || baseline.moved).toBe(true);
    const halluc = run({ image: 1 });
    expect(halluc).toEqual({ gone: false, moved: false });
  });
});

describe("goals are forgotten while impaired", () => {
  const impaired = [
    ["blind", { blind: 1 }],
    ["confused", { confused: 1 }],
    ["afraid", { afraid: 1 }],
    ["hallucinating", { image: 1 }],
    ["poisoned", { poisoned: 1 }],
    ["bleeding", { cut: 1 }],
    ["stunned", { stun: 10 }],
  ] as const;

  for (const [name, status] of impaired) {
    it(`drops the goal when ${name}`, () => {
      const ctx = ctxFor({ player: { status } });
      borgNotice(ctx);
      ctx.world.self.goal.type = GOAL_KILL;
      borgForgetGoalWhileImpaired(ctx.world);
      expect(ctx.world.self.goal.type).toBe(0);
    });
  }

  it("keeps the goal when nothing is wrong", () => {
    const ctx = ctxFor({});
    borgNotice(ctx);
    ctx.world.self.goal.type = GOAL_KILL;
    borgForgetGoalWhileImpaired(ctx.world);
    expect(ctx.world.self.goal.type).toBe(GOAL_KILL);
  });
});
