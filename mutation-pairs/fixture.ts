import type { AgentView, ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { createBorg, type BorgOptions } from "../src/controller.js";
import { makeScenarioView, type Scenario } from "../src/harness.js";
import { createActFacade } from "../src/api2/act.js";
import { getThinkSession, primeSession } from "../src/think-session.js";
import { BI } from "../src/trait/index.js";
import { TV } from "../src/item/index.js";

export function item(over: Partial<ItemView> = {}): ItemView {
  return {
    handle: 42, kindKey: "", aware: true, nameColor: "", label: "item",
    tval: TV.AMULET, sval: 1, pval: 0, number: 1, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0,
    ego: false, artifact: false, flags: [], modifiers: [], brands: [],
    slays: [], resists: [], curses: [], egoName: null, artifactName: null,
    activation: false, timeout: 0, inscription: null, ...over,
  };
}

export function scene(options: {
  scenario?: Scenario;
  inventory?: ItemView[];
  books?: SpellbookView[];
  borg?: BorgOptions;
} = {}) {
  const base = makeScenarioView({
    width: 22, height: 22,
    ...options.scenario,
    player: {
      grid: { x: 10, y: 10 }, depth: 5, maxDepth: 5,
      level: 20, maxLevel: 20, hp: 200, maxHp: 300,
      ...options.scenario?.player,
    },
  });
  const view: AgentView = {
    ...base,
    inventory: () => options.inventory ?? [],
    spellbooks: () => options.books ?? [],
  };
  const borg = createBorg(options.borg);
  const facade = createActFacade();
  borg.controller(view, facade.act);
  const world = borg.world;
  const session = getThinkSession(world);
  const ctx = session.ctx!;
  // Policy cases supply light independently of the equipment scan.
  world.self.trait[BI.LIGHT] = 2;
  world.self.trait[BI.FOOD] = 7;
  world.self.goal.type = 0;
  world.self.goal.fleeing = false;
  world.self.goal.leaving = false;
  world.self.goal.less = false;
  world.self.noRestPrep = 0;
  primeSession(session, ctx);
  return { borg, world, session, ctx, view, flow: session.flow.state };
}
