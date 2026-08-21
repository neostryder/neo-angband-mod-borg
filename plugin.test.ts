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
    registries: unknown;
    state: unknown;
  }): AgentController | undefined;
}

/* The BUILT file, on purpose. If plugin.js is stale or missing this fails, which
 * is correct: `npm run check` proves it is a current build of the source, and
 * this proves the thing that check blessed actually runs. */
const built = ((await import("./plugin.js")) as { default: BuiltPlugin }).default;

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

/**
 * Install the built plugin against a COMPLETE host context: every field the
 * host's own `controller()` call site is guaranteed to carry. Since manifest.json
 * declares `engine: ">=0.25.0"` that is all of them, so there is no longer a
 * half-supplied context to parameterise over.
 *
 * `omit` builds a defective context on purpose, for the one test that pins what
 * the plugin does with one.
 */
function install(
  flags: Record<string, boolean>,
  omit: readonly ("registries" | "state")[] = [],
): {
  controller: AgentController | undefined;
  logs: string[];
} {
  const logs: string[] = [];
  const ctx: Record<string, unknown> = {
    flags,
    core: Core,
    log: (m: string) => logs.push(m),
    registries: hostRegistries(),
    state: hostState(),
  };
  for (const key of omit) delete ctx[key];
  const controller = built.controller(
    ctx as unknown as Parameters<BuiltPlugin["controller"]>[0],
  );
  return { controller, logs };
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

  it("wires all four seams from the host context, and says what it got", () => {
    /* THE ANTI-INERT TEST. Every other test in this file passed for months while
     * the plugin built its Borg with no resolvers at all, because a Borg with no
     * danger vision still returns a command every turn. What that proves is that
     * "it decided a move" cannot detect this class of bug, so the wiring needs an
     * assertion of its own. The race count is in the message so a player's log
     * says whether the Borg could see, not just that it started - an empty
     * registry is the one remaining way to get a blind Borg. */
    const { controller, logs } = install({ "borg.autoplay": true });
    expect(typeof controller).toBe("function");
    const said = logs.join(" ");
    expect(said).toMatch(/danger vision over 2 races/u);
    expect(said).toMatch(/activation identity/u);
    expect(said).toMatch(/in-shop signal/u);
    expect(said).toMatch(/loadout evaluation/u);
  });

  it("refuses a host context missing a required fact, and names it", () => {
    /* The engine floor is what makes this unreachable through the game's own
     * loader: `engine: ">=0.25.0"` in manifest.json is a hard refusal for a mod
     * that ships code, so a game without `ctx.registries` or `ctx.state` never
     * imports this bundle. It is asserted anyway because the loader is not the
     * only caller a plugin ABI can have, and because the alternative failure is
     * silent - a Borg with no resolvers plays on, badly, and looks from the
     * outside exactly like a Borg making bad choices. */
    expect(() => install({ "borg.autoplay": true }, ["registries"])).toThrow(
      /ctx\.registries/u,
    );
    expect(() => install({ "borg.autoplay": true }, ["state"])).toThrow(/ctx\.state/u);
    expect(() => install({ "borg.autoplay": true }, ["registries", "state"])).toThrow(
      /ctx\.registries and no ctx\.state/u,
    );
  });

  it("declines before it can refuse anything, when the flag is off", () => {
    /* Order matters: the flag check runs first, so a host that never enables the
     * Borg is never told its context is short. Otherwise browsing the mod list
     * on a defective host would raise from a mod nobody switched on. */
    expect(install({}, ["registries", "state"]).controller).toBeUndefined();
  });

  it("yields when the player is dead", () => {
    const controller = install({ "borg.autoplay": true }).controller!;
    expect(controller(makeScenarioView({ player: { dead: true } }), makeFakeActions())).toBeNull();
  });
});
