/** Port41: real beta.3 public loadout frames; retain C238's separate modifier bug. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import { simulationView } from "../api2/world.js";
import { bindCore } from "../core-api.js";
import { makeFakeActions } from "../harness.js";
import { makeBorgRng } from "../rng.js";
import { BorgWorld } from "../world/model.js";
import { borgNotice } from "./trait.js";
import { BI } from "./trait-index.js";
import type { BorgContext } from "../context.js";

const root = dirname(createRequire(import.meta.url).resolve("@rpgm-tools/neo-angband-content/pack/constants.json"));
const json = (name: string) => JSON.parse(readFileSync(join(root, name + ".json"), "utf8"));
const rec = (name: string) => json(name).records;
const pack = {
  constants: json("constants"), terrain: rec("terrain"), roomTemplates: rec("room_template"), vaults: rec("vault"),
  dungeonProfiles: rec("dungeon_profile"), projection: rec("projection"), trap: rec("trap"), names: rec("names"), quest: rec("quest"), store: rec("store"),
  obj: Object.fromEntries(Object.entries({ objectBase: "object_base", object: "object", egoItem: "ego_item", artifact: "artifact", curse: "curse", brand: "brand", slay: "slay", activation: "activation", objectProperty: "object_property", flavor: "flavor" }).map(([key, file]) => [key, json(file)])),
  mon: Object.fromEntries(Object.entries({ pain: "pain", blowMethods: "blow_methods", blowEffects: "blow_effects", monsterSpells: "monster_spell", monsterBases: "monster_base", monsters: "monster", summons: "summon", pits: "pit" }).map(([key, file]) => [key, rec(file)])),
  player: Object.fromEntries(Object.entries({ races: "p_race", classes: "class", properties: "player_property", timed: "player_timed", shapes: "shape", bodies: "body", history: "history", realms: "realm" }).map(([key, file]) => [key, rec(file)])),
} as Core.GamePack;

type Light = "none" | "torch" | "spent-torch" | "phial";
function frame(cls: "Warrior" | "Necromancer", light: Light) {
  bindCore(Core);
  const game = Core.startGame(pack, { seed: 441, depth: 1, raceName: "Human", className: cls });
  const { state } = game;
  const reg = game.booted.registries.objects;
  const remove = state.actor.player.equipment.map((_, i) => i);
  let handle: number | undefined;
  if (light !== "none") {
    const artifact = light === "phial" ? reg.artifacts.find(a => a?.name === "of Galadriel") : undefined;
    if (light === "phial") expect(artifact).toBeDefined();
    const kind = artifact ? reg.lookupKind(artifact.tval, artifact.sval) : reg.kinds.find(k => k.name === "& Wooden Torch~");
    expect(kind).toBeDefined();
    const obj = Core.objectPrep(state.rng, reg, game.booted.registries.constants, kind!, 1, "maximise");
    if (artifact) { obj.artifact = artifact; Core.copyArtifactData(state.rng, reg, obj, artifact); }
    obj.number = 1;
    obj.notice |= Core.OBJ_NOTICE.ASSESSED;
    if (!artifact) obj.timeout = light === "spent-torch" ? 0 : 5000;
    handle = Core.gearAdd(state.gear!, obj);
    state.gear!.pack.push(handle);
    state.actor.player.upkeep.totalWeight = Core.gearTotalWeight(state.gear!);
  }
  Core.playerLearnAllRunes(state.actor.player, state.runeEnv);
  const sim = Core.simulateLoadout(state, { remove, ...(handle === undefined ? {} : { wield: [{ from: "gear" as const, handle }] }) }, { viewDeps: { reg, describe: obj => Core.describeObject(state, obj, Core.ODESC.PREFIX | Core.ODESC.FULL) } });
  expect(sim).not.toBeNull();
  const known = Core.knownLoadoutSimulation(state, sim!);
  expect(known.unresolved).toEqual([]);
  const publicFrame = simulationView(new Map())({ ...known, unresolved: [] }).after;
  // Both player and gear come from the same real registered public loadout.
  expect(publicFrame.player.light).toBe(publicFrame.stats.light);
  const base = Core.createAgentView(state);
  const ctx: BorgContext = { world: new BorgWorld(), act: makeFakeActions(), rng: makeBorgRng(),
    view: { ...base, player: () => publicFrame.player, equipment: () => [...publicFrame.equipment], inventory: () => [...publicFrame.inventory] } };
  borgNotice(ctx);
  console.info(JSON.stringify({ cls, light, publicLight: publicFrame.player.light, derivedLight: publicFrame.stats.light, borgLight: ctx.world.self.trait[BI.LIGHT], equipment: publicFrame.equipment.filter(Boolean).map(i => ({ label: i!.label, flags: i!.flags, modifiers: i!.modifiers, timeout: i!.timeout, tval: i!.tval })) }));
  return { ctx, publicFrame };
}

describe("light base from actual known loadouts (port41)", () => {
  it.each([
    ["Warrior", "none", 0, 0],
    ["Warrior", "torch", 2, 2],
    ["Warrior", "spent-torch", 0, 0],
    ["Warrior", "phial", 4, 8],
    ["Necromancer", "none", 0, 1],
    ["Necromancer", "torch", 2, 2],
    ["Necromancer", "spent-torch", 0, 1],
    ["Necromancer", "phial", 3, 7],
  ] as const)("%s with %s preserves C equipment-light calculation", (cls, light, derived, expected) => {
    const { ctx, publicFrame } = frame(cls, light);
    expect(publicFrame.player.light).toBe(derived);
    if (light === "torch") {
      const torch = publicFrame.equipment.find(i => i?.flags.includes("LIGHT_2"));
      expect(torch).toBeDefined();
      expect(torch!.timeout).toBe(5000);
    }
    if (light === "phial") {
      const item = publicFrame.equipment.find(i => i?.artifactName === "of Galadriel");
      expect(item).toBeDefined();
      expect(item!.modifiers).toContainEqual({ code: "LIGHT", value: 4 });
    }
    expect(ctx.world.self.trait[BI.LIGHT]).toBe(expected);
  });
});
