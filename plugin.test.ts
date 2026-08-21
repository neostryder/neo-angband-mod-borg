/**
 * The SHIPPED ARTEFACT plays the game.
 *
 * Every other test in this repository imports TypeScript out of src/. plugin.js
 * is what a player downloads: a single bundled file, built by esbuild, with the
 * engine deliberately NOT in it. Those are different artefacts, and the
 * difference is exactly where this mod's design could fail silently.
 *
 * Specifically: src/core-api.ts hands out FEAT, TV and four other engine symbols
 * as ESM live bindings that `bindCore` fills. That works in TypeScript under
 * vitest. Whether it still works after esbuild has hoisted every module into one
 * scope is a separate question, and the failure mode if it does not is not an
 * exception - it is FEAT reading `undefined` inside a decision ladder, which
 * looks like the Borg playing badly. So this test drives the bundle.
 *
 * It also pins the two things the host relies on and the type system cannot
 * check across the bundle boundary: that the default export really is a plugin,
 * and that declining is `undefined` rather than a controller that does nothing.
 */

import { describe, expect, it } from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { AgentController } from "@rpgm-tools/neo-angband-core";
import { makeScenarioView, makeFakeActions } from "./src/harness.js";

interface BuiltPlugin {
  readonly api: number;
  readonly hooks?: unknown;
  readonly register?: unknown;
  controller(ctx: {
    flags: Record<string, boolean>;
    core: typeof Core;
    log: (m: string) => void;
    registries?: unknown;
    state?: unknown;
  }): AgentController | undefined;
}

/* The BUILT file, on purpose. If plugin.js is stale or missing this fails, which
 * is correct: `npm run check` proves it is a current build of the source, and
 * this proves the thing that check blessed actually runs. */
const built = ((await import("./plugin.js")) as { default: BuiltPlugin }).default;

function install(
  flags: Record<string, boolean>,
  registries?: unknown,
  state?: unknown,
): {
  controller: AgentController | undefined;
  logs: string[];
} {
  const logs: string[] = [];
  const controller = built.controller({
    flags,
    core: Core,
    log: (m) => logs.push(m),
    ...(registries === undefined ? {} : { registries }),
    ...(state === undefined ? {} : { state }),
  });
  return { controller, logs };
}

/**
 * A `ctx.registries`-shaped host fact carrying one core race and one a mod added.
 *
 * Only the field the plugin reads is real. That is deliberate: the claim under
 * test is "the shipped bundle reaches for the registry and reports what it
 * found", and a fuller fixture would only make the test slower at asserting the
 * same thing. Whether the facts it derives are CORRECT is src/resolvers.test.ts.
 */
function hostRegistries(): unknown {
  return {
    monsters: {
      races: [
        { ridx: 0, name: "soldier ant", blows: [], flags: [], spellFlags: [], friends: [] },
        {
          ridx: 1,
          name: "joiner ant",
          from: { owner: "tutorial-03" },
          blows: [],
          flags: [],
          spellFlags: [],
          friends: [],
        },
      ],
    },
    objects: {
      lookupKind: () => null,
      findEgo: () => null,
      findArtifact: () => null,
    },
  };
}

/** A `ctx.state`-shaped host fact: the player standing on the general store. */
function hostState(): unknown {
  return {
    actor: { grid: { x: 5, y: 5 } },
    chunk: { feature: () => ({ shopnum: 1 }) },
  };
}

describe("the built plugin.js", () => {
  it("is a plugin whose only member is a controller", () => {
    expect(built.api).toBe(1);
    expect(built.hooks).toBeUndefined();
    expect(built.register).toBeUndefined();
    expect(typeof built.controller).toBe("function");
  });

  it("declines the keyboard unless the player asked for it", () => {
    // Installing and enabling the Borg must not hand it your character. An
    // autoplayer that starts because the mod is present is a mod that eats a
    // save the first time someone browses the mod list.
    expect(install({}).controller).toBeUndefined();
    expect(install({ "borg.autoplay": false }).controller).toBeUndefined();
  });

  it("takes the keyboard when the flag is on, and says so", () => {
    const { controller, logs } = install({ "borg.autoplay": true });
    expect(typeof controller).toBe("function");
    expect(logs.join(" ")).toContain("keyboard");
  });

  it("decides a real move through the bundle, with the engine passed in", () => {
    /* The whole point. If the live bindings did not survive bundling, FEAT and
     * TV would be undefined here and the ladder would still return SOMETHING -
     * so asserting "not null" alone would pass against the bug. The commands
     * below are what a Borg standing next to a monster actually issues, and
     * every one of them requires a real FEAT/TV read on the way. */
    const controller = install({ "borg.autoplay": true }).controller!;
    const view = makeScenarioView({
      player: { grid: { x: 5, y: 5 }, depth: 3 },
      monsters: [{ grid: { x: 6, y: 5 }, raceIndex: 42, hp: 10, maxHp: 10 }],
    });
    const cmd = controller(view, makeFakeActions());
    expect(cmd).not.toBeNull();
    expect(typeof cmd?.code).toBe("string");
  });

  it("keeps deciding, turn after turn", () => {
    // One decision can succeed on stale state; a stuck Borg shows up over turns.
    const controller = install({ "borg.autoplay": true }).controller!;
    const view = makeScenarioView({ player: { grid: { x: 5, y: 5 }, depth: 2 } });
    const codes = Array.from(
      { length: 8 },
      () => controller(view, makeFakeActions())?.code ?? null,
    );
    expect(codes.every((c) => c !== null)).toBe(true);
  });

  it("takes the registry when the host offers one, and says how much it saw", () => {
    /* THE ANTI-INERT TEST. Every other test in this file passed for months while
     * the plugin built its Borg with no resolvers at all, because a Borg with no
     * danger vision still returns a command every turn. What that proves is that
     * "it decided a move" cannot detect this class of bug, so the wiring needs an
     * assertion of its own. The count is in the message so a player's log says
     * whether the Borg could see, not just that it started. */
    const { controller, logs } = install({ "borg.autoplay": true }, hostRegistries());
    expect(typeof controller).toBe("function");
    expect(logs.join(" ")).toMatch(/danger vision over 2 races/u);
  });

  it("reports activation identity and the in-shop signal when the host offers them", () => {
    /* The same anti-inert guard as the danger-vision test above, for the two
     * seams landed alongside it: a Borg that received `ctx.registries.objects`
     * and `ctx.state` but built its resolvers without them would still decide a
     * move every turn, so the log line is the only thing that can catch it. */
    const { controller, logs } = install(
      { "borg.autoplay": true },
      hostRegistries(),
      hostState(),
    );
    expect(typeof controller).toBe("function");
    expect(logs.join(" ")).toMatch(/activation identity/u);
    expect(logs.join(" ")).toMatch(/in-shop signal/u);
    expect(logs.join(" ")).not.toMatch(/no activation identity|no in-shop signal/u);
  });

  it("says which of activation identity and the in-shop signal it did not get", () => {
    const { logs } = install({ "borg.autoplay": true }, hostRegistries());
    expect(logs.join(" ")).toMatch(/no in-shop signal/u);
    expect(logs.join(" ")).not.toMatch(/no activation identity/u);
  });

  it("says plainly when the host supplies no registry, instead of playing quietly", () => {
    /* An older game, which is a real case: this mod installs into any host whose
     * engine range it declares, and `ctx.registries` did not exist before
     * 2026-08-21. It must still play - and it must not look the same as a wired
     * one, because "the Borg plays badly" and "the Borg was given no monster
     * data" have completely different fixes. */
    const { controller, logs } = install({ "borg.autoplay": true });
    expect(typeof controller).toBe("function");
    expect(logs.join(" ")).toMatch(/playing blind/u);
  });

  it("yields when the player is dead", () => {
    const controller = install({ "borg.autoplay": true }).controller!;
    expect(controller(makeScenarioView({ player: { dead: true } }), makeFakeActions())).toBeNull();
  });
});
