/** Opt-in test-only registered public light fixture. Never imported by the plugin. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { ItemView } from "@rpgm-tools/neo-angband-core";
import { simulationView } from "../../src/api2/world.js";

type PublicLight = ItemView & { readonly unknownRunes: boolean };
const cache = new Map<string, { light: number; item: PublicLight }>();
function registeredLightFixture(which: "torch" | "lantern"): { light: number; item: PublicLight } {
  let cached = cache.get(which);
  if (!cached) {
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
    const game = Core.startGame(pack, { seed: 441, depth: 1, raceName: "Human", className: "Warrior" });
    const { state } = game, reg = game.booted.registries.objects;
    const kind = reg.kinds.find(k => k.name === (which === "torch" ? "& Wooden Torch~" : "& Lantern~"));
    if (!kind) throw Error("registered light kind is required");
    const obj = Core.objectPrep(state.rng, reg, game.booted.registries.constants, kind, 1, "maximise");
    obj.number = 1; obj.timeout = 5000; obj.notice |= Core.OBJ_NOTICE.ASSESSED;
    const handle = Core.gearAdd(state.gear!, obj); state.gear!.pack.push(handle);
    state.actor.player.upkeep.totalWeight = Core.gearTotalWeight(state.gear!);
    Core.playerLearnAllRunes(state.actor.player, state.runeEnv);
    const sim = Core.simulateLoadout(state, { remove: state.actor.player.equipment.map((_, i) => i), wield: [{ from: "gear", handle }] },
      { viewDeps: { reg, describe: o => Core.describeObject(state, o, Core.ODESC.PREFIX | Core.ODESC.FULL) } });
    if (!sim) throw Error("registered Torch loadout must resolve");
    const known = Core.knownLoadoutSimulation(state, sim);
    if (known.unresolved.length) throw Error("Torch loadout must have no unresolved inputs");
    const frame = simulationView(new Map())({ ...known, unresolved: [] }).after;
    const flag = which === "torch" ? "LIGHT_2" : "LIGHT_3";
    const radius = which === "torch" ? 2 : 3;
    const item = frame.equipment.find(i => i?.flags.includes(flag));
    const knownItem = known.after.equipment.find(i => i?.flags.includes(flag));
    if (!item || !knownItem || item.timeout !== 5000 || frame.player.light !== radius || frame.stats.light !== radius || knownItem.unknownRunes) throw Error("registered light public contract changed");
    // These are unit-controller view identities, not live engine commands.
    // Reserve handles outside the other fake gear range to prevent aliasing.
    cached = { light: frame.player.light, item: { ...item, handle: which === "torch" ? 9900 : 9901, unknownRunes: knownItem.unknownRunes } };
    cache.set(which, cached);
  }
  return structuredClone(cached);
}

export function registeredTorchFixture() { const frame = registeredLightFixture("torch"); return { light: frame.light, torch: frame.item }; }
export function registeredLanternFixture() { const frame = registeredLightFixture("lantern"); return { light: frame.light, lantern: frame.item }; }
