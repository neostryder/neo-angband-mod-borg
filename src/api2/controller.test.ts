import { registeredTorchFixture } from "../../test/fixtures/known-light.js";
/**
 * The decision tick and the verbs it submits through.
 *
 * plugin.test.ts shows the built file playing a turn. These pin the parts that
 * file cannot reach with one scenario: the intent each verb becomes, targets
 * going ahead of their command under a refreshed token, loadout questions read
 * and the decision run again, and what the Borg says to a prompt.
 */

import { describe, expect, it, vi } from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { AgentCommand, AgentController, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Api2Prompt } from "@rpgm-tools/neo-angband-mod-sdk";
import { fakeGame, knownWorld } from "../harness-api2.js";
import { createActFacade, intentOf, REST_COMPLETE } from "./act.js";
import { createTick, promptAnswer, IDLE_BEFORE_RELEASE, REFUSALS_BEFORE_RELEASE, STALLS_BEFORE_FORGET, STALLS_BEFORE_RELEASE, type Decider } from "./controller.js";
import { createBridge, type Bridge } from "./host.js";
import type { World } from "./world.js";
import { createBorg } from "../controller.js";
import * as Think from "../think.js";
import { buildItemDeps, getThinkSession } from "../think-session.js";
import { borgWearRecharge } from "../item/item-wear.js";
import { TV, SVAL } from "../item/svals.js";

describe("the act verbs", () => {
  it("turn a command into the intent the game takes", () => {
    const { act } = createActFacade();
    expect(intentOf(act.move(3))).toEqual({ kind: "command", command: { code: "walk", dir: 3 } });
    expect(intentOf(act.quaff(5))).toEqual({ kind: "command", command: { code: "quaff", args: { handle: 5 } } });
    expect(intentOf(act.rest())).toEqual({ kind: "command", command: { code: "rest", args: { count: REST_COMPLETE } } });
    expect(intentOf(act.drop(2, 3))).toEqual({ kind: "command", command: { code: "drop", args: { handle: 2, quantity: 3 } } });
    expect(intentOf(act.wear(4))).toEqual({ kind: "command", command: { code: "wield", args: { handle: 4 } } });
    expect(intentOf(act.hold())).toEqual({ kind: "command", command: { code: "hold" } });
  });

  it("record a target choice for submitting ahead of the command, and hand each over once", () => {
    const facade = createActFacade();
    facade.act.setTargetMonster(12);
    facade.act.setTargetLocation(4, 9);
    expect(facade.take()).toEqual([{ kind: "target", midx: 12 }, { kind: "target", x: 4, y: 9 }]);
    expect(facade.take()).toEqual([]);
  });
});

describe("what the Borg says to a prompt", () => {
  const prompt = (over: Record<string, unknown>): Api2Prompt => ({ promptId: 1, ...over }) as unknown as Api2Prompt;

  it("acknowledges, confirms, takes the default, and cancels what it cannot answer", () => {
    expect(promptAnswer(prompt({ kind: "ack" }))).toEqual({ action: "acknowledge" });
    expect(promptAnswer(prompt({ kind: "confirm" }))).toBe(true);
    expect(promptAnswer(prompt({ kind: "quantity", defaultValue: 3 }))).toBe(3);
    expect(promptAnswer(prompt({ kind: "text", defaultValue: "x" }))).toBe("x");
    expect(promptAnswer(prompt({ kind: "menu" }))).toEqual({ action: "cancel" });
  });
});

/** A bridge with nothing behind it, and a world the decision code is never shown the inside of. */
function bridge(over: Partial<Bridge> = {}): Bridge {
  const quiet = { player: () => ({ grid: { x: 1, y: 1 } }), monsters: () => [] };
  const world = { view: quiet as never, facts: { shopnum: null, kinds: new Map() } } as World;
  return {
    hasTruth: false,
    prime: () => Promise.resolve(),
    readWorld: () => Promise.resolve(world),
    setInput: () => undefined,
    input: () => null,
    loadoutsPending: () => false,
    settleLoadouts: () => Promise.resolve(0),
    resolverInput: () => ({}),
    dispose: () => Promise.resolve(),
    ...over,
  };
}

function decider(controller: AgentController, rewinds: { count: number } = { count: 0 }): Decider {
  return { controller, rewind: () => void (rewinds.count += 1) };
}

const WALK: AgentCommand = { code: "walk", dir: 6 } as AgentCommand;

const AFFLICTION_GRADES = [
  { field: "blind", name: "BLIND", grade: [{ name: "Blind", max: 10000 }] },
  { field: "confused", name: "CONFUSED", grade: [{ name: "Confused", max: 10000 }] },
  { field: "afraid", name: "AFRAID", grade: [{ name: "Afraid", max: 10000 }] },
  { field: "poisoned", name: "POISONED", grade: [{ name: "Poisoned", max: 10000 }] },
  { field: "paralyzed", name: "PARALYZED", grade: [{ name: "Paralyzed!", max: 10000 }] },
  { field: "cut", name: "CUT", grade: [{ name: "Graze", max: 10 }, { name: "Light Cut", max: 25 }] },
  { field: "stun", name: "STUN", grade: [{ name: "Stun", max: 50 }, { name: "Heavy Stun", max: 150 }] },
] as const;

async function publishedGame() {
  const game = fakeGame({ scenario: { player: { grid: { x: 5, y: 5 }, depth: 2 } }, engine: { core: Core } });
  const known = knownWorld(game.view);
  const player = known.player!;
  const status = { ...player.status };
  (game.mod.view as { world: unknown }).world = () => Promise.resolve({ ok: true, value: { ...known, player: { ...player, status } } });
  (game.mod.content as { records: unknown }).records = (file: string) => Promise.resolve({ ok: true, value: file === "player_timed" ? AFFLICTION_GRADES.map(({ name, grade }) => ({ name, grade })) : [] });
  const host = createBridge(game.mod);
  await host.prime();
  return { game, host, status };
}

describe("recharge continuation across API2 retries", () => {
  it.each([false, true])("preserves wear/rest order when a loadout retry starts with pending rest=%s", async (pendingRest) => {
    const game = fakeGame();
    const amulet: ItemView = {
      handle: 7, kindKey: "", aware: true, nameColor: "", label: "charging amulet",
      tval: TV.AMULET, sval: 1, pval: 0, number: 1, weight: 1, ac: 0, toA: 0,
      toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false, flags: [],
      modifiers: [], brands: [], slays: [], resists: [], curses: [], egoName: null,
      artifactName: null, activation: true, timeout: 10, inscription: null,
    };
    const food = { ...amulet, handle: 8, tval: TV.FOOD, sval: SVAL.food.ration!, number: 5, timeout: 0 };
    const lit = registeredTorchFixture();
    const equipment = Array<ItemView | null>(12).fill(null); equipment[5] = lit.torch;
    if (pendingRest) equipment[2] = amulet;
    const view = { ...game.view, player: () => ({ ...game.view.player(), light: lit.light }),
      inventory: () => pendingRest ? [food] : [food, amulet], equipment: () => equipment };
    const borg = createBorg({ rngSeed: 1 });
    const session = getThinkSession(borg.world);
    session.rechargeRest = pendingRest ? amulet.handle : false;
    const decide = Think.think;
    // The controller and queued-rest consumer share the production item deps.
    const selection = vi.spyOn(Think, "think").mockImplementation((ctx) => {
      const state = getThinkSession(ctx.world);
      return state.rechargeRest ? decide(ctx)
        : borgWearRecharge(ctx, buildItemDeps(state));
    });
    let pending = true;
    let rounds = 0;
    const tick = createTick(bridge({
      readWorld: () => Promise.resolve({ view, facts: { shopnum: null, kinds: new Map() } } as World),
      loadoutsPending: () => pending,
      settleLoadouts: () => { pending = false; rounds++; return Promise.resolve(1); },
    }), borg);
    try {
      await tick(game.mod, game.input());
      expect(rounds).toBe(1);
      expect(game.submitted.map((entry) => entry.intent)).toEqual([
        { kind: "command", command: pendingRest
          ? { code: "rest", args: { count: 75 } }
          : { code: "wield", args: { handle: 7 } } },
      ]);
      if (!pendingRest) {
        view.inventory = () => [food];
        view.equipment = () => [amulet];
        await tick(game.mod, game.input());
        expect(game.submitted[1]!.intent).toEqual({ kind: "command", command: { code: "rest", args: { count: 75 } } });
      }
      expect(session.rechargeRest).toBe(false);
    } finally {
      selection.mockRestore();
    }
  });
});

describe("one tick", () => {
  it("submits the targets, under a fresh token, and then the command", async () => {
    const game = fakeGame();
    const order: string[] = [];
    const real = game.mod.act.submit;
    (game.mod.act as { submit: unknown }).submit = (token: never, intent: { kind: string }) => {
      order.push(`${intent.kind}@${String((token as { revision: number }).revision)}`);
      return real(token, intent as never);
    };
    (game.mod.view as { input: unknown }).input = () => Promise.resolve({ ok: true, value: game.input({ token: { epoch: 1, revision: 2 } }) });
    const tick = createTick(
      bridge(),
      decider((_view, act) => {
        act.setTargetMonster(7);
        return act.move(6);
      }),
    );
    await tick(game.mod, game.input());
    expect(order).toEqual(["target@1", "command@2"]);
  });

  it("reads the loadout questions it asked and decides again, up to a limit", async () => {
    const game = fakeGame();
    let pending = true;
    let settled = 0;
    let decisions = 0;
    const rewinds = { count: 0 };
    const tick = createTick(
      bridge({
        loadoutsPending: () => pending,
        settleLoadouts: () => {
          settled += 1;
          pending = settled < 2;
          return Promise.resolve(1);
        },
      }),
      decider(() => {
        decisions += 1;
        return WALK;
      }, rewinds),
    );
    await tick(game.mod, game.input());
    expect(decisions).toBe(3);
    expect(rewinds.count).toBe(2);
    expect(game.submitted).toHaveLength(1);

    const stuck = createTick(bridge({ loadoutsPending: () => true, settleLoadouts: () => Promise.resolve(1) }), decider(() => WALK));
    const again = fakeGame();
    await stuck(again.mod, again.input());
    expect(again.submitted).toHaveLength(1);
  });

  it("stops reading loadout questions when none are answered", async () => {
    const game = fakeGame();
    let decisions = 0;
    const tick = createTick(bridge({ loadoutsPending: () => true, settleLoadouts: () => Promise.resolve(0) }), decider(() => ((decisions += 1), WALK)));
    await tick(game.mod, game.input());
    expect(decisions).toBe(1);
  });

  it("says once that it is playing", async () => {
    const game = fakeGame();
    const tick = createTick(bridge(), decider(() => WALK));
    await tick(game.mod, game.input());
    await tick(game.mod, game.input());
    expect(game.logs.filter((line) => line === "the Borg is playing")).toHaveLength(1);
  });

  it("hands the keyboard back after a run of idle decisions, then starts counting again", async () => {
    const game = fakeGame();
    const tick = createTick(bridge(), decider(() => null));
    for (let n = 0; n < IDLE_BEFORE_RELEASE * 2; n++) await tick(game.mod, game.input());
    expect(game.released).toHaveLength(2);
  });

  it("does not count an idle decision between two commands against the run", async () => {
    const game = fakeGame();
    let n = 0;
    const tick = createTick(bridge(), decider(() => (++n % 2 === 0 ? null : WALK)));
    for (let i = 0; i < IDLE_BEFORE_RELEASE * 3; i++) await tick(game.mod, game.input());
    expect(game.released).toEqual([]);
  });

  it("hands the keyboard back after a run of refusals, and logs the first", async () => {
    const game = fakeGame({ submit: () => false });
    const tick = createTick(bridge(), decider(() => WALK));
    for (let n = 0; n < REFUSALS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(game.released).toHaveLength(1);
    expect(game.logs.filter((line) => line.includes("was refused"))).toHaveLength(3);
  });

  it("forgets the grid an accepted command keeps aiming at when the scene never changes", async () => {
    const game = fakeGame({ scenario: { player: { grid: { x: 5, y: 5 }, depth: 2 } } });
    const forgotten: string[] = [];
    const open = { code: "open", dir: 2 } as AgentCommand;
    const tick = createTick(bridge({ readWorld: () => Promise.resolve({ view: game.view, facts: { shopnum: null, kinds: new Map() } } as unknown as World) }), {
      controller: () => open,
      rewind: () => undefined,
      forget: (x, y) => void forgotten.push(`${String(x)},${String(y)}`),
    });
    for (let n = 0; n <= STALLS_BEFORE_FORGET; n++) await tick(game.mod, game.input());
    expect(forgotten).toEqual(["5,6"]);
    expect(game.logs.filter((line) => line.includes("forgot"))).toHaveLength(1);
    expect(game.released).toEqual([]);
  });

  it("hands the keyboard back when the same command changes nothing for a long run", async () => {
    const game = fakeGame({ scenario: { player: { grid: { x: 5, y: 5 }, depth: 2 } } });
    const tick = createTick(bridge({ readWorld: () => Promise.resolve({ view: game.view, facts: { shopnum: null, kinds: new Map() } } as unknown as World) }), decider(() => WALK));
    for (let n = 0; n <= STALLS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(game.released).toHaveLength(1);
  });

  it("does not count a command whose scene changes between decisions", async () => {
    const game = fakeGame({ scenario: { player: { grid: { x: 5, y: 5 }, depth: 2 } } });
    let x = 5;
    const world = () => {
      x += 1;
      const view = Object.create(game.view) as typeof game.view;
      (view as { player: unknown }).player = () => ({ ...game.view.player(), grid: { x, y: 5 } });
      return Promise.resolve({ view, facts: { shopnum: null, kinds: new Map() } } as unknown as World);
    };
    const forgotten: string[] = [];
    const tick = createTick(bridge({ readWorld: world }), { controller: () => ({ code: "open", dir: 2 }) as AgentCommand, rewind: () => undefined, forget: (a, b) => void forgotten.push(`${String(a)},${String(b)}`) });
    for (let n = 0; n < STALLS_BEFORE_RELEASE * 2; n++) await tick(game.mod, game.input());
    expect(forgotten).toEqual([]);
    expect(game.released).toEqual([]);
  });

  it.each(AFFLICTION_GRADES)("resets the stall count when $field clears in the published view", async ({ field, grade }) => {
    const { game, host, status } = await publishedGame();
    status[field] = grade[0].name;
    const seen: number[] = [];
    const tick = createTick(host, decider((view) => {
      seen.push(view.player().status[field]);
      return { code: "open", dir: 2 } as AgentCommand;
    }));
    for (let n = 0; n < STALLS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(seen).toEqual(Array<number>(STALLS_BEFORE_RELEASE).fill(1));
    status[field] = null;
    for (let n = 0; n < STALLS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(seen.slice(STALLS_BEFORE_RELEASE)).toEqual(Array<number>(STALLS_BEFORE_RELEASE).fill(0));
    expect(game.released).toEqual([]);
    await tick(game.mod, game.input());
    expect(game.released).toHaveLength(1);
    await host.dispose();
  });

  it.each([
    { field: "cut", higher: "Light Cut", lower: "Graze", floor: 11 },
    { field: "stun", higher: "Heavy Stun", lower: "Stun", floor: 51 },
  ] as const)("resets the stall count when $field crosses a published grade boundary", async ({ field, higher, lower, floor }) => {
    const { game, host, status } = await publishedGame();
    status[field] = higher;
    const seen: number[] = [];
    const tick = createTick(host, decider((view) => {
      seen.push(view.player().status[field]);
      return { code: "open", dir: 2 } as AgentCommand;
    }));
    for (let n = 0; n < STALLS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(seen).toEqual(Array<number>(STALLS_BEFORE_RELEASE).fill(floor));
    status[field] = lower;
    for (let n = 0; n < STALLS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(seen.slice(STALLS_BEFORE_RELEASE)).toEqual(Array<number>(STALLS_BEFORE_RELEASE).fill(1));
    expect(game.released).toEqual([]);
    await tick(game.mod, game.input());
    expect(game.released).toHaveLength(1);
    await host.dispose();
  });

  it.each(AFFLICTION_GRADES)("counts identical commands while $field stays in one published grade", async ({ field, grade }) => {
    const { game, host, status } = await publishedGame();
    status[field] = grade[0].name;
    const forgotten: string[] = [];
    const tick = createTick(host, {
      controller: (view) => {
        expect(view.player().status[field]).toBe(1);
        return { code: "open", dir: 2 } as AgentCommand;
      },
      rewind: () => undefined,
      forget: (x, y) => void forgotten.push(`${String(x)},${String(y)}`),
    });
    for (let n = 0; n < STALLS_BEFORE_RELEASE; n++) await tick(game.mod, game.input());
    expect(game.released).toEqual([]);
    expect(forgotten).toHaveLength(Math.floor((STALLS_BEFORE_RELEASE - 1) / STALLS_BEFORE_FORGET));
    await tick(game.mod, game.input());
    expect(game.released).toHaveLength(1);
    expect(game.submitted).toHaveLength(STALLS_BEFORE_RELEASE);
    await host.dispose();
  });

  it("counts identical commands when only the published food percentage changes", async () => {
    const { game, host, status } = await publishedGame();
    const tick = createTick(host, decider((view) => {
      expect(view.player().status.food).toBe(status.food * 100);
      return { code: "open", dir: 2 } as AgentCommand;
    }));
    for (let n = 0; n <= STALLS_BEFORE_RELEASE; n++) {
      status.food = 90 - n;
      await tick(game.mod, game.input());
    }
    expect(game.released).toHaveLength(1);
    await host.dispose();
  });

  it("reads no world at a wait with a prompt, and waits out a death or other phase", async () => {
    const game = fakeGame();
    let reads = 0;
    const tick = createTick(bridge({ readWorld: () => ((reads += 1), Promise.resolve(null)) }), decider(() => WALK));
    await tick(game.mod, game.input({ prompt: { promptId: 2, kind: "ack" } as unknown as Api2Prompt }));
    await tick(game.mod, game.input({ phase: "death" as never }));
    expect(reads).toBe(0);
    await tick(game.mod, game.input());
    expect(reads).toBe(1);
    expect(game.submitted).toEqual([]);
  });
});
