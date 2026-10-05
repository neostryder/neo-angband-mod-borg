import { describe, expect, it } from "vitest";
import type { Api2Result, KnownItem, KnownLevel, KnownWorldData, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { borgView as api1View, createAdapter as api1Adapter, type ControllerCtx } from "./core-api.js";
import { borgView, createAdapter } from "./core-adapter-api2.js";
import { makeScenarioView } from "./harness.js";

const known: KnownItem = {
  handle: 7, kindKey: "flavor:3", itemKey: "gear:7", nameColor: "white", label: "Blue", aware: false,
  tval: 75, sval: -3, pval: 0, number: 2, weight: 1, ac: 0, toA: 0, toH: 0, toD: 0,
  dd: 0, ds: 0, ego: false, artifact: false, flags: ["LIGHT"], modifiers: [{ code: "SPEED", value: 1 }],
  brands: ["FIRE"], slays: ["ORC"], resists: [{ element: "FIRE", level: 1 }], curses: ["weakness"],
  egoName: null, artifactName: null, activation: false, timeout: 0, inscription: null,
};
const level: KnownLevel = { token: { epoch: 1, revision: 2 }, levelId: 4, depth: 2, width: 40, height: 25, cells: [] };
const facts: KnownWorldData = {
  version: 1, token: level.token, turn: 10, player: null, inventory: [known], equipment: [null, known],
  quiver: [], floorHere: [], monsters: [], target: null, targetReadable: true, level,
  stores: [{ feat: 1, featName: "General Store", isHome: false, owner: { name: "Owner", purse: 100 }, stock: [{ ...known, index: 2, price: 11 }] }],
  spellbooks: [{ tval: 90, name: "Book", realm: "arcane", spells: [{ name: "Light", sidx: 3, bidx: 0, level: 1, mana: 2, fail: 10, chance: 5, learned: true, worked: false, forgotten: false, studyEligible: false, infoLine: "radius 2" }] }],
};

function fake(world: Api2Result<KnownWorldData> = { ok: true, value: facts }, map: Api2Result<KnownLevel> = { ok: true, value: level }): { mod: ModApi2; logs: string[] } {
  const logs: string[] = [];
  const unused = async (): Promise<never> => { throw new Error("The test called an unused domain."); };
  const mod: ModApi2 = {
    meta: { id: "borg", api: "2.0.0", engine: "test", tier: "first-party", flags: { "borg.playsRisky": true }, newCharacter: false, granted: () => true, log: (message) => logs.push(message), settings: unused, setSetting: unused, mods: unused },
    view: { world: async () => world, level: async () => map, player: unused, monsters: unused, input: unused, isCurrent: unused },
    act: { submit: unused, answer: unused, controller: { owns: unused, setStatus: unused, markNondeterministic: unused, release: unused } },
    events: { on: unused, off: unused }, hooks: { available: [], active: [] },
    content: { own: unused, asset: unused, records: unused, lookup: unused },
    ui: { mount: unused, patch: unused, keys: { bind: unused, list: unused, remove: unused } },
    store: { prefs: { get: unused, set: unused }, character: { get: unused, set: unused } },
  };
  return { mod, logs };
}

describe("the API 2 adapter twin", () => {
  it("keeps the mod's own flags and diagnostic messages", () => {
    const { mod, logs } = fake();
    const api1Logs: string[] = [];
    const old = api1Adapter({
      flags: mod.meta.flags,
      log: (message) => { api1Logs.push(message); },
      get core(): ControllerCtx["core"] { throw new Error("The metadata read reached Core."); },
      get registries(): ControllerCtx["registries"] { throw new Error("The metadata read reached registries."); },
      get state(): ControllerCtx["state"] { throw new Error("The metadata read reached state."); },
    });
    const twin = createAdapter(mod);
    expect(twin.meta.flags).toEqual(old.meta.flags);
    twin.meta.log("The Borg has the keyboard.");
    old.meta.log("The Borg has the keyboard.");
    expect(logs).toEqual(api1Logs);
    expect(twin).not.toHaveProperty("engine");
  });

  it.each(["mapBounds", "inventory", "equipment", "stores", "spellbooks"] as const)("matches the API 1 %s read on the same facts", async (name) => {
    const { mod } = fake();
    const old = api1View({
      ...makeScenarioView(),
      inventory: () => structuredClone(facts.inventory) as ReturnType<ReturnType<typeof api1View>["inventory"]>,
      equipment: () => structuredClone(facts.equipment) as ReturnType<ReturnType<typeof api1View>["equipment"]>,
      stores: () => structuredClone(facts.stores) as ReturnType<ReturnType<typeof api1View>["stores"]>,
      spellbooks: () => structuredClone(facts.spellbooks) as ReturnType<ReturnType<typeof api1View>["spellbooks"]>,
    });
    expect(await borgView(mod)[name]()).toEqual({ ok: true, value: old[name]() });
  });

  it.each([
    { ok: false, reason: "unavailable", message: "There is no game." },
    { ok: false, reason: "not-granted", capability: "state:map.read", message: "The map grant is absent." },
    { ok: false, reason: "refused", code: "stale", message: "The input wait changed." },
  ] satisfies Api2Result<never>[])("preserves the $reason result", async (failure) => {
    const { mod } = fake(failure, failure);
    for (const read of Object.values(borgView(mod))) expect(await read()).toBe(failure);
  });

  it.each([
    ["inventory", "state:inventory.read"], ["equipment", "state:inventory.read"],
    ["stores", "state:stores.read"], ["spellbooks", "state:spells.read"],
  ] as const)("reports an unreadable %s part", async (part, capability) => {
    const { mod } = fake({ ok: true, value: { ...facts, [part]: null } });
    expect(await borgView(mod)[part]()).toMatchObject({ ok: false, reason: "not-granted", capability });
  });

  it("keeps permitted empty lists distinct from missing grants", async () => {
    const { mod } = fake({ ok: true, value: { ...facts, inventory: [], equipment: [], stores: [], spellbooks: [] } });
    for (const name of ["inventory", "equipment", "stores", "spellbooks"] as const) {
      expect(await borgView(mod)[name]()).toEqual({ ok: true, value: [] });
    }
  });

  it("keeps item edits inside the Borg's copy", async () => {
    const { mod } = fake();
    const result = await borgView(mod).inventory();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("The inventory read failed.");
    result.value[0]!.flags.push("FREE_ACT");
    result.value[0]!.modifiers[0]!.value = 99;
    expect(known.flags).toEqual(["LIGHT"]);
    expect(known.modifiers[0]!.value).toBe(1);
  });
});
