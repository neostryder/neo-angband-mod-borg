/**
 * The manifest must declare every perceive domain the port actually reads.
 *
 * WHY THIS NEEDS A TEST. The frozen AgentView is capability-gated per DOMAIN:
 * a view built for a mod is wrapped so that `view.player()` throws
 * `AgentCapabilityError` unless the manifest declared `state:player.read`. A
 * manifest that declares `command:add` and nothing else installs cleanly,
 * reports success, and then throws on the FIRST perceive of the first turn.
 *
 * That is what shipped in 0.6.1, and the way it presented is the reason this
 * file exists rather than a careful reading of the manifest. Every layer above
 * the throw made it look like somebody else's bug:
 *
 *   - The install succeeded, because the install-time check wants `command:add`
 *     alone. Borg logged that it had the keyboard and all four seams.
 *   - The throw unwound out of the game loop, which reports a fault with no mod
 *     attached to it - so the player was told the GAME hit a bug, and pointed at
 *     the game's issue tracker.
 *   - The session stopped saving, and the autoplayer's own clock kept ticking
 *     and re-throwing behind a notice that is only ever shown once.
 *
 * Nothing in this repository could have caught it either: every test here drives
 * the port through `src/harness.ts`, whose fake view has no capability gate at
 * all, and the one test that drives the built `plugin.js` hands over its own
 * context rather than a real one. A green suite and a broken mod, which is the
 * shape PLANNED.md was opened about.
 *
 * So the check is derived from the source rather than restated: scan for the
 * accessors the port calls, map each to the domain the engine gates it on, and
 * require the manifest to declare exactly that set. Reading a new domain now
 * fails here instead of on somebody's first turn, and a domain that stops being
 * read has to be dropped from the manifest rather than lingering as a permission
 * nobody uses.
 */

import { describe, expect, it } from "vitest";
import { AGENT_STATE_DOMAINS } from "@rpgm-tools/neo-angband-core";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeScenarioView } from "./harness.js";

const srcRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(srcRoot);

/**
 * Which perceive domain each AgentView accessor is gated on, from the engine's
 * own binding table (`packages/core/src/agent/perceive.ts`). Three of these are
 * not one-to-one and are the reason this map is written out rather than derived
 * from the accessor name:
 *
 *   - `cell` and `mapBounds` share the `map` domain.
 *   - `equipment` is read under `inventory`, not a domain of its own.
 *   - `spellbooks` is read under `spells`.
 *   - `simulateLoadout` answers a question about the player, so it is gated on
 *     `player` rather than on anything of its own.
 */
const ACCESSOR_DOMAIN: Readonly<Record<string, string>> = {
  turn: "turn",
  player: "player",
  monsters: "monsters",
  cell: "map",
  mapBounds: "map",
  inventory: "inventory",
  equipment: "inventory",
  floorItems: "floor",
  target: "target",
  messages: "messages",
  stores: "stores",
  spellbooks: "spells",
  constants: "constants",
  simulateLoadout: "player",
};

/** Capabilities that are not perceive domains. `command:add` is the only one. */
const ACTION_CAPABILITIES = ["command:add"] as const;

interface Manifest {
  readonly capabilities: readonly string[];
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")) as Manifest;
}

/** Every shipped .ts in the port, plus the plugin entry point. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "harness.ts") {
      out.push(p);
    }
  }
  return out;
}

/**
 * The accessors the port calls on the live view.
 *
 * `harness.ts` is excluded above, because it BUILDS a fake view rather than
 * reading one: its `player: () => ...` would otherwise read as a call. The scan
 * matches `.<accessor>(` on any expression, not just `view.`, so a view held
 * under another name is still counted; the cost is that an unrelated method with
 * one of these names would be counted too, which over-declares rather than
 * under-declares and is the safer direction here.
 */
function accessorsUsed(): Set<string> {
  const names = Object.keys(ACCESSOR_DOMAIN);
  const re = new RegExp(`\\.(${names.join("|")})\\s*[(?]`, "gu");
  const used = new Set<string>();
  for (const file of [...sourceFiles(srcRoot), join(repoRoot, "plugin.ts")]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (name !== undefined) used.add(name);
    }
  }
  return used;
}

describe("manifest capabilities", () => {
  it("names a real engine domain for every accessor in the map", () => {
    /* The map above is a copy of the engine's binding table, so it can drift.
       A domain that was renamed or removed fails here rather than turning into a
       capability string the gate will never match. */
    const domains = new Set<string>(Object.values(AGENT_STATE_DOMAINS));
    for (const [accessor, domain] of Object.entries(ACCESSOR_DOMAIN)) {
      expect(domains, `${accessor} -> ${domain}`).toContain(domain);
    }
  });

  it("classifies every accessor the frozen view offers", () => {
    /* A new accessor in a newer engine is a new domain to declare, and the way
       to find out is not to wait for it to throw. Every function on a real view
       has to be in the map above; `simulateLoadout` is the one that is optional
       on the view type, so the harness does not build it and it is in the map by
       hand. */
    const view = makeScenarioView() as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(view)) {
      if (typeof value !== "function") continue;
      expect(ACCESSOR_DOMAIN, `view.${key} is not classified`).toHaveProperty(key);
    }
  });

  it("declares exactly the domains the port reads, and no others", () => {
    const used = accessorsUsed();
    /* Non-vacuity: the scan has to be finding things. The port reads the player
       and the monsters on every single think. */
    expect(used).toContain("player");
    expect(used).toContain("monsters");

    const wanted = new Set<string>(ACTION_CAPABILITIES);
    for (const accessor of used) {
      const domain = ACCESSOR_DOMAIN[accessor];
      if (domain !== undefined) wanted.add(`state:${domain}.read`);
    }

    expect([...manifest().capabilities].sort()).toEqual([...wanted].sort());
  });

  it("asks for no wildcard read", () => {
    /* `state:*.read` would cover every domain in one line and would have made
       0.6.1's defect impossible - and it would also grant a domain the Borg does
       not read today and any domain a newer engine adds. The consent screen a
       player reads before handing over a character lists these, so the list is
       worth keeping honest. */
    expect(manifest().capabilities).not.toContain("state:*.read");
  });
});
