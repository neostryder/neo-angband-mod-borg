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
  }): AgentController | undefined;
}

/* The BUILT file, on purpose. If plugin.js is stale or missing this fails, which
 * is correct: `npm run check` proves it is a current build of the source, and
 * this proves the thing that check blessed actually runs. */
const built = ((await import("./plugin.js")) as { default: BuiltPlugin }).default;

function install(flags: Record<string, boolean>): {
  controller: AgentController | undefined;
  logs: string[];
} {
  const logs: string[] = [];
  const controller = built.controller({ flags, core: Core, log: (m) => logs.push(m) });
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

  it("yields when the player is dead", () => {
    const controller = install({ "borg.autoplay": true }).controller!;
    expect(controller(makeScenarioView({ player: { dead: true } }), makeFakeActions())).toBeNull();
  });
});
