/**
 * ISSUES #3 AND #4: DOES THE BORG'S OWN LADDER TRIGGER THESE, NOT JUST THE
 * ENGINE COMMAND.
 *
 * Both `rest(count?: number)` (a real multi-turn rest, Neo Angband 0.27.0) and
 * `shop-buy` / `shop-sell` / `shop-exit` (real store command handlers, same
 * release) are shipped and unit-tested against the published engine - but only
 * for being INVOKED directly. Nobody had confirmed the Borg's own decision
 * ladder (avoid death, recover, fight, improve gear, take loot, explore,
 * descend) ever reaches the point of choosing either one in an unscripted run.
 * PLANNED.md symptom 9 and item 5 track this as issues #3 and #4.
 *
 * Built on src/play.test.ts's proven pattern (packRoot/loadPack/startGame/
 * installController/runGameLoop against the real published engine, 6/6 green)
 * rather than a new harness. Two differences from it, both load-bearing:
 *
 * - loadPack here ALSO reads store.json. play.test.ts's own loadPack does not,
 *   and without it `state.stores` is never populated (session/game.ts's
 *   startGame only calls createTownStores when the pack supplies store
 *   records), so `view.stores()` is permanently `[]` and the engine's own
 *   store_at lookup can never resolve a door - the store ladder could not be
 *   exercised at all under the old loadPack. Confirmed by hand: without this,
 *   even standing on a real shop door, `shop-sell` answers "You cannot sell
 *   items when not in a store".
 * - Both scenarios START from a directly-set GameState field (chp, grid, gold)
 *   rather than from birth defaults, because a fresh level-1 character is
 *   never hurt and never inside a shop by chance within a short decision
 *   budget. Only the SETUP is engineered; every command below is the Borg's
 *   own, unscripted choice.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import type { JsonRecord, KnownStoreItem, KnownWorldData, LoadoutSimulation } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  ContentIdResolver,
  FEAT,
  TV,
  LOOP_STATUS,
  createAgentView,
  installController,
  runGameLoop,
  startGame,
} from "@rpgm-tools/neo-angband-core";
import type { AgentCommand, GamePack, GameState } from "@rpgm-tools/neo-angband-core";
import { createBorg } from "./controller.js";
import { makeCoreResolvers } from "./resolvers.js";
import { storeScreen } from "../test/fixtures/store-screen.js";
import { makeScenarioView, makeFakeActions } from "./harness.js";
import { fakeGame, knownWorld } from "./harness-api2.js";
import { createBridge } from "./api2/host.js";
import { createTick } from "./api2/controller.js";
import { playerView } from "./api2/world.js";
import { borgNotice, BI } from "./trait/index.js";
import { playerHas } from "./trait/player-flags.js";
import { buildItemDeps, getThinkSession, primeSession } from "./think-session.js";
import { perceive, makePerceiveMemo } from "./perceive.js";
import { syncStairsFromMap } from "./flow/flow-stairs.js";
import { borgThinkDungeon } from "./think-ladder.js";

/** The game's checkout, holding the content pack a real boot needs. */
function packRoot(): string | null {
  const roots = [
    process.env["NEO_ANGBAND_REPO"],
    fileURLToPath(new URL("../../neo-angband/", import.meta.url)),
  ].filter((r): r is string => typeof r === "string" && r.length > 0);
  for (const root of roots) {
    const dir = join(root, "packages", "content", "pack");
    if (existsSync(join(dir, "constants.json"))) return dir;
  }
  /* FORK: installed content must exercise these scenarios in CI. */
  try {
    return dirname(createRequire(import.meta.url).resolve("@rpgm-tools/neo-angband-content/pack/constants.json"));
  } catch {
    const message = "Play/rest tests require @rpgm-tools/neo-angband-content or NEO_ANGBAND_REPO with a built content pack.";
    if (process.env["CI"]) throw new Error(message);
    process.stderr.write(message + " Skipping play/rest cases locally.\n");
    return null;
  }
}

const PACK_DIR = packRoot();

function loadPack(dir: string): GamePack {
  const json = <T,>(name: string): T =>
    JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as T;
  const records = <T,>(name: string): T[] => json<{ records: T[] }>(name).records;
  return {
    constants: json("constants"),
    terrain: records("terrain"),
    roomTemplates: records("room_template"),
    vaults: records("vault"),
    dungeonProfiles: records("dungeon_profile"),
    projection: records("projection"),
    trap: records("trap"),
    names: records("names"),
    quest: records("quest"),
    /* The 8 town stores. See the file header - without this, state.stores is
     * never populated and the store half of this file cannot run at all. */
    store: records("store"),
    obj: {
      objectBase: json("object_base"),
      object: json("object"),
      egoItem: json("ego_item"),
      artifact: json("artifact"),
      curse: json("curse"),
      brand: json("brand"),
      slay: json("slay"),
      activation: json("activation"),
      objectProperty: json("object_property"),
      flavor: json("flavor"),
    } as GamePack["obj"],
    mon: {
      pain: records("pain"),
      blowMethods: records("blow_methods"),
      blowEffects: records("blow_effects"),
      monsterSpells: records("monster_spell"),
      monsterBases: records("monster_base"),
      monsters: records("monster"),
      summons: records("summon"),
      pits: records("pit"),
    },
    mon2: undefined,
    player: {
      races: records("p_race"),
      classes: records("class"),
      properties: records("player_property"),
      timed: records("player_timed"),
      shapes: records("shape"),
      bodies: records("body"),
      history: records("history"),
      realms: records("realm"),
    },
  } as unknown as GamePack;
}

function makeGame(pack: GamePack, seed: number, className?: string) {
  const game = startGame(pack, { seed, depth: 0, ...(className ? { className } : {}) });
  const state: GameState = game.state;
  const resolver = new ContentIdResolver({
    objects: game.booted.registries.objects,
    playerRaces: game.players.races,
    playerClasses: game.players.classes,
  });
  /* The host's store screen, on the same terms play.test.ts uses it. */
  const screen = storeScreen(state);
  const borg = createBorg({
    /* Vary the Borg's own stream with the seed, on the same terms
     * play.test.ts does, so ten "different" seeds are not driving one
     * identical decision sequence. */
    rngSeed: (seed * 2654435761) >>> 0 || 1,
    resolvers: makeCoreResolvers({
      races: game.booted.registries.monsters.races,
      objects: game.booted.registries.objects,
      state: state as never,
      shopnum: () => screen.shopnum(),
      blowMethods: game.booted.registries.monsters.blowMethods.values(),
    }),
  });
  return { game, state, resolver, borg, screen };
}

interface Decision {
  turnBefore: number;
  turnAfter: number;
  cmd: string;
  args: unknown;
  gold: number;
  inv: string;
}

/** Drive N decisions, gated by an armed latch exactly as play.test.ts does. */
function drive(
  built: ReturnType<typeof makeGame>,
  decisions: number,
): Decision[] {
  const { game, state, resolver, borg, screen } = built;
  const log: Decision[] = [];
  let armed = false;
  installController(
    state,
    (view, act) => {
      if (!armed) return null;
      armed = false;
      const turnBefore = state.turn;
      const cmd = borg.controller(view, act);
      screen.issued(cmd);
      log.push({
        turnBefore,
        turnAfter: -1,
        cmd: cmd?.code ?? "none",
        args: (cmd as { args?: unknown })?.args,
        gold: view.player().gold,
        inv: view
          .inventory()
          .map((it) => `${String(it.tval)}x${String(it.number)}`)
          .join(","),
      });
      return cmd;
    },
    { viewDeps: { resolver, reg: game.booted.registries.objects } },
  );

  for (let i = 0; i < decisions; i++) {
    armed = true;
    const before = log.length;
    const status = runGameLoop(state, game.registry);
    if (log.length > before) log[log.length - 1]!.turnAfter = state.turn;
    if (log[log.length - 1]?.cmd === "shop-exit") break;
    if (status === LOOP_STATUS.DEAD) break;
    if (status === LOOP_STATUS.DEATH_CONFIRM) {
      state.pendingDeath?.resolve(true);
      continue;
    }
    if (status === LOOP_STATUS.LEVEL_CHANGE) {
      game.changeLevel(state.targetDepth ?? state.chunk.depth + 1);
      state.generateLevel = false;
    }
  }
  return log;
}

/** The real grid the town generator placed a given store's door on. */
function findDoor(state: GameState, feat: number): { x: number; y: number } | null {
  for (let y = 0; y < state.chunk.height; y++) {
    for (let x = 0; x < state.chunk.width; x++) {
      if (state.chunk.feat({ x, y }) === feat) return { x, y };
    }
  }
  return null;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const suite = PACK_DIR ? describe : describe.skip;

suite("the Borg's ladder reaches rest and the store", () => {
  const pack = PACK_DIR ? loadPack(PACK_DIR) : null;

  it.each(["Warrior", "Mage", "Priest", "Rogue", "Ranger", "Paladin", "Druid", "Necromancer", "Blackguard"])("buys supplies before descending from an unseen-stock town as a %s", async (cls) => {
    const { game, state, resolver } = makeGame(pack!, 441, cls);
    const reg = game.booted.registries.objects;
    const deps = { reg, resolver };
    state.actor.player.au = 100;
    /* The safe-town fixture isolates shopping from borg_caution's danger escape. */
    for (let i = 1; i < state.monsters.length; i++) if (state.monsters[i]) Core.deleteMonster(state, i);
    /* A nearby home keeps the initial equipment visit from revealing retail stock en route. */
    const home = findDoor(state, FEAT.HOME)!;
    const start = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: home.x + dx!, y: home.y + dy! }))
      .find((grid) => state.chunk.feat(grid) === FEAT.FLOOR);
    expect(start).toBeDefined();
    state.actor.grid = start!;
    let inStore = false;
    let bought: KnownStoreItem | undefined;
    const commands: AgentCommand[] = [];
    const host = fakeGame({ engine: { core: Core }, submit: (intent) => {
      if (intent.kind !== "command") return true;
      const command = intent.command as AgentCommand;
      commands.push(command);
      expect(command.code, JSON.stringify(commands.slice(-20))).not.toBe("descend");
      const before = Core.buildKnownWorld(state, deps);
      const shop = before.player!.shopnum;
      const ware = command.code === "shop-buy" && shop !== null
        ? before.stores![shop]!.stock.find((item) => item.index === command.args?.["index"])
        : undefined;
      const gold = state.actor.player.au;
      const handler = game.registry.get(command.code);
      expect(handler, command.code).toBeDefined();
      const energy = handler!(state, command);
      if (energy > 0) state.turn += 10;
      if (command.code === "shop-buy") {
        expect(ware).toBeDefined();
        expect(state.actor.player.au).toBeLessThan(gold);
        bought = ware;
      }
      if (command.code === "shop-exit") inStore = false;
      else if (command.code === "walk" || command.code === "hold") {
        inStore = Core.buildKnownWorld(state, deps).player!.shopnum !== null;
      }
      state.updateBonuses?.();
      return true;
    } });
    host.mod.content.records = async (file) => ({ ok: true, value: (JSON.parse(readFileSync(join(PACK_DIR!, `${file}.json`), "utf8")) as { records: JsonRecord[] }).records });
    host.mod.content.boundRecords = async (file) => ({ ok: true, value: file === "object" ? reg.kinds.map((kind) => ({ key: kind.name, name: kind.name, index: kind.kidx, tval: kind.tval, owner: "core" })) : [] });
    host.mod.view.world = async () => ({ ok: true, value: Core.buildKnownWorld(state, deps) as KnownWorldData });
    host.mod.view.simulateLoadout = async (change) => {
      const refs = [...(change.wield ?? []), ...(change.wieldAt ?? []).map((entry) => entry.item), ...(change.carry ?? []).map((entry) => entry.item)];
      if (refs.some((ref) => ref.from === "store" && state.chunk.feat(state.actor.grid) !== state.stores![ref.store]!.feat)) {
        return { ok: false, reason: "refused", code: "unobserved-item", message: "The store item is not currently seen." };
      }
      const simulation = createAgentView(state, undefined, deps).simulateLoadout!(change);
      expect(simulation).not.toBeNull();
      return { ok: true, value: Core.knownLoadoutSimulation(state, simulation!) as LoadoutSimulation };
    };
    expect(Core.buildKnownWorld(state, deps).stores!.every((store) => store.stock.length === 0)).toBe(true);
    const bridge = createBridge(host.mod);
    await bridge.prime();
    const borg = createBorg({ resolvers: makeCoreResolvers(bridge.resolverInput()) });
    const tick = createTick(bridge, borg);
    try {
      for (let decision = 0; decision < 300 && bought === undefined; decision++) {
        await tick(host.mod, host.input({ phase: inStore ? "store" : "play" }));
      }
      expect(bought, JSON.stringify(commands.slice(-20))).toBeDefined();
      expect([Core.TV.FOOD, Core.TV.LIGHT, Core.TV.FLASK, Core.TV.POTION, Core.TV.SCROLL]).toContain(bought!.tval);
      expect(commands.some((command) => command.code === "walk")).toBe(true);
      expect(host.released).toEqual([]);
      expect(host.truthCalls).toEqual([]);
    } finally {
      await bridge.dispose();
    }
  }, 60_000);

  it.each([false, true])("uses class flags for SP recovery with stairs=%s", (onStairs) => {
    for (const cls of ["Blackguard", "Mage"]) {
      const { game, state, borg } = makeGame(pack!, 1);
      const player = state.actor.player;
      player.cls = game.players.classes.find((c) => c.name === cls)!;
      player.mhp = player.chp = 60;
      player.msp = 20;
      player.csp = 0;
      state.actor.grid = { x: 10, y: 10 };

      /* The bound class supplies PF_COMBAT_REGEN to the published player view. */
      const engine = createAgentView(state);
      const known = knownWorld(engine).player!;
      const p = playerView(known, new Map());
      const base = makeScenarioView({
        player: p,
        cells: { "10,10": { feat: onStairs ? FEAT.MORE : FEAT.FLOOR } },
      });
      /* Empty supplies make borg_check_rest reject the grid (borg-flow-misc.c:1288).
       * The town stair then reaches borg-think-dungeon.c:1652-1707 directly. */
      const view = { ...base, equipment: () => engine.equipment(), inventory: () => onStairs ? [] : engine.inventory().filter((item) => item.tval === TV.FOOD) };
      const session = getThinkSession(borg.world);
      const act = makeFakeActions();
      const ctx = { world: borg.world, view, act, rng: borg.rng };
      /* The stair rung reads the tracks filled from the perceived map. */
      if (onStairs) {
        borg.world.clock = 1000;
        borgNotice(ctx);
        perceive(borg.world, view, makePerceiveMemo());
        primeSession(session, ctx);
        syncStairsFromMap(ctx, session.flow.state);
      }
      const cmd = onStairs ? borgThinkDungeon(ctx, session) : borg.controller(view, act);
      expect(playerHas(session.ctx!, "COMBAT_REGEN"), cls).toBe(cls === "Blackguard");
      expect(borg.world.self.trait[BI.CURSP], cls).toBe(0);
      expect(borg.world.self.trait[BI.MAXSP], cls).toBe(20);
      expect(cmd, cls).not.toBeNull();
      expect(cmd?.code === "rest", `${cls}: ${JSON.stringify(cmd)}`).toBe(cls === "Mage");
      if (onStairs) {
        expect(buildItemDeps(session).canRest, cls).toBe(false);
      } else {
        expect(borg.world.self.trait[BI.FOOD], cls).toBeGreaterThanOrEqual(2);
      }
    }
  });

  /**
   * Issue #3. A level-one character starts at some fraction of max HP - a
   * safe town, nothing to fight, nothing cut or poisoned or hungry about it,
   * just short of full health, which is the ordinary post-fight state
   * `borg_recover`'s "rest until healed" branch exists for. What happens next
   * is entirely the ladder's own call.
   *
   * Not every seed gets the chance: `borgCaution`'s own "take the stairs I am
   * standing on" rung outranks recovery, and a character who happens to spawn
   * on the town's staircase descends before recovery is ever evaluated - a
   * different, correctly-functioning decision, not a failure to rest. Both
   * outcomes are counted and reported; only "it never rests at all" would be a
   * finding against the issue.
   */
  it("issue #3: HP below max, in a safe town, triggers a real multi-turn rest", () => {
    const rested: Array<{ seed: number; turnDelta: number; mode: number }> = [];
    const notRested: number[] = [];
    for (const seed of SEEDS) {
      const built = makeGame(pack!, seed);
      built.state.actor.player.chp = Math.max(
        1,
        Math.floor(built.state.actor.player.mhp * 0.6),
      );
      const log = drive(built, 60);
      const restIdx = log.findIndex((d) => d.cmd === "rest");
      if (restIdx === -1) {
        notRested.push(seed);
        continue;
      }
      const d = log[restIdx]!;
      const args = d.args as { count?: number } | undefined;
      rested.push({ seed, turnDelta: d.turnAfter - d.turnBefore, mode: args?.count ?? NaN });
    }

    // eslint-disable-next-line no-console
    console.log(
      `[rest] ${String(rested.length)}/${String(SEEDS.length)} seeds rested; ` +
        `not-rested (took a higher-priority action first): ${JSON.stringify(notRested)}`,
    );

    /* A strong majority has to rest, or this is not confirmed at all. */
    expect(rested.length).toBeGreaterThanOrEqual(6);
    for (const r of rested) {
      /* REST_COMPLETE (-2, core-api.ts): "rest as needed", the same mode every
       * ctx.act.rest() call site in this repository passes. */
      expect(r.mode, `seed ${String(r.seed)}`).toBe(-2);
      /* One command turn producing far more than one game turn is the whole
       * point: it proves the engine's multi-turn continuation fired rather
       * than a single-turn hold. Ten turns is one ordinary move. */
      expect(r.turnDelta, `seed ${String(r.seed)}`).toBeGreaterThan(100);
    }
  }, 60_000);

  /**
   * Issue #4. Does the store LADDER, once physically inside a shop, actually
   * issue shop-buy/shop-sell, and does something real change as a result?
   * The character is placed on a shop door and the host's store screen is
   * opened for it (test/fixtures/store-screen.ts), one fresh game per store.
   *
   * Before the shop doors were recorded (borg-update.c track_shop_x/y) and
   * the shop goals started cleared (borg-update.c:2128), the Borg could not
   * walk to any shop, and goal.shop/ware started at 0, which borg_choose_shop
   * reads as a goal already in flight, so its own buy/sell steps were skipped
   * and the store ladder acted on that phantom goal. With thirty decisions
   * that yielded purchases; with the goals cleared it yields none, because
   * borg_choose_shop now runs its real steps and the ware it wants is
   * often in another shop, so it leaves, walks there, sells or buys, and
   * moves on. Eighty decisions cover such a trip; thirty covered one store.
   *
   * The door has to be a REAL one: state.stores[].feat, matched against the
   * grid the town generator actually placed it on. A synthetic terrain write
   * using the registry's shopFeats() fidx satisfies the Borg's OWN in-shop
   * resolver (which reads the terrain feature's shopnum directly) but not the
   * engine's own store_at lookup the shop-buy/-sell handlers use - confirmed
   * by hand: it answered "You cannot sell items when not in a store" while
   * the Borg believed it was in one.
   *
   * Sales can net zero gold under birth_no_selling, so inventory changes prove
   * a sale while gold loss proves a purchase under either option value.
   */
  it("issue #4: physically in a real shop, the store ladder trades with a real effect", () => {
    const bought: Array<{ seed: number; goldBefore: number; goldAfter: number }> = [];
    const sold: Array<{ seed: number; invBefore: string; invAfter: string }> = [];
    const neither: number[] = [];

    for (const seed of SEEDS) {
      const built = makeGame(pack!, seed);
      const nonHomeFeats = (built.state.stores ?? [])
        .filter((s) => s.feat !== FEAT.HOME)
        .map((s) => s.feat);

      let sawTrade = false;
      /* borg_choose_shop sells before buying, so the same character visits each store. */
      built.state.actor.grid = findDoor(built.state, FEAT.HOME)!;
      drive(built, 30);
      for (const feat of [...nonHomeFeats, ...nonHomeFeats]) {
        const grid = findDoor(built.state, feat);
        if (!grid) continue;
        built.state.actor.grid = grid;
        built.state.actor.player.au = 5000;
        /* Placed on the door: the host opens the store screen. */
        built.screen.enter();

        const log = drive(built, 80);
        for (let i = 0; i < log.length; i++) {
          const d = log[i]!;
          if (d.cmd !== "shop-buy" && d.cmd !== "shop-sell") continue;
          const before = i > 0 ? log[i - 1]! : d;
          const after = i + 1 < log.length ? log[i + 1]! : d;
          if (d.cmd === "shop-buy" && after.gold < before.gold) {
            bought.push({ seed, goldBefore: before.gold, goldAfter: after.gold });
            sawTrade = true;
          } else if (d.cmd === "shop-sell" && after.inv !== before.inv) {
            sold.push({ seed, invBefore: before.inv, invAfter: after.inv });
            sawTrade = true;
          }
        }
      }
      if (!sawTrade) neither.push(seed);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[store] bought=${String(bought.length)} sold=${String(sold.length)} ` +
        `neither=${JSON.stringify(neither)}`,
    );

    /* A strong majority has to show a real, verified trade - buy (gold down)
     * or sell (inventory changed) - or this is not confirmed. */
    expect(bought.length + sold.length).toBeGreaterThanOrEqual(8);
    /* At least one real purchase, specifically: birth_no_selling makes every
     * sell net zero gold in this game's own default options, so a buy is the
     * only place gold-changing-hands is checkable at all. */
    expect(bought.length, JSON.stringify({ bought, sold, neither })).toBeGreaterThan(0);
  }, 300_000);
});
