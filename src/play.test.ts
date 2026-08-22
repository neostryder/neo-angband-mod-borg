/**
 * THE TEST THAT PLAYS A TURN.
 *
 * Every other test in this repository asks a subsystem a question and checks the
 * answer. Not one of them plays the game, and PLANNED.md is the record of what
 * that cost: a mod whose suite was green, whose port was faithful, and which
 * wedged against the first locked door it met. Three separate infinite loops
 * (disarm, wield, stair-shuttle) were all invisible to unit tests, because each
 * one is a decision that is individually correct and collectively a hang.
 *
 * So this boots a REAL game against the engine, installs the Borg as its command
 * provider, and drives the loop for thousands of decisions. It does not check
 * that the Borg plays WELL - "it tries its best and gets as far as it can" is the
 * target, and a level-1 character dying on depth 2 is upstream's own outcome. It
 * checks that the Borg is still PLAYING: that no single command has run away with
 * the session, and that the character has been to more than a handful of squares.
 *
 * Both assertions are cheap to state and were each false at some point on
 * 2026-08-21.
 *
 * WHY THIS SKIPS WITHOUT THE GAME'S CHECKOUT. The content pack is the game's, not
 * this repository's, and there is no copy here to fall back on. `NEO_ANGBAND_REPO`
 * (or the sibling checkout the other tools already assume) is what makes this
 * runnable, exactly as it is for the plugin builder. A skip says so out loud
 * rather than passing on nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ContentIdResolver,
  LOOP_STATUS,
  installController,
  runGameLoop,
  startGame,
} from "@rpgm-tools/neo-angband-core";
import type { GamePack, GameState } from "@rpgm-tools/neo-angband-core";
import { createBorg } from "./controller.js";
import { makeCoreResolvers } from "./resolvers.js";

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
  return null;
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

/** What a run did, in the terms a stall shows up in. */
interface RunReport {
  /** Decisions taken before the run ended. */
  decisions: number;
  /** Game turns elapsed. A stall that costs no energy leaves this flat. */
  turns: number;
  /** Every depth the character stood on. */
  depths: number[];
  /** How many times each command code was issued. */
  commands: Record<string, number>;
  /** Distinct depth+grid the character occupied. A loop leaves this tiny. */
  places: number;
  /** Whether the character died (an ending, not a failure). */
  dead: boolean;
}

/**
 * Play one game. The turn tail is the host's job in the real shell (main.ts);
 * here it is the three lines below, which is all a level change needs when
 * nothing has to be drawn.
 */
function playRun(pack: GamePack, seed: number, decisions: number): RunReport {
  const game = startGame(pack, { seed, depth: 0 });
  const state: GameState = game.state;
  const resolver = new ContentIdResolver({
    objects: game.booted.registries.objects,
    playerRaces: game.players.races,
    playerClasses: game.players.classes,
  });
  const borg = createBorg({
    resolvers: makeCoreResolvers({
      races: game.booted.registries.monsters.races,
      objects: game.booted.registries.objects,
      state: state as never,
    }),
  });

  /* The latch the host installs for the same reason (main.ts): runGameLoop asks
   * nextCommand for as long as the player has energy, so a controller that
   * always answers never lets the loop return. */
  let armed = false;
  const commands: Record<string, number> = {};
  installController(
    state,
    (view, act) => {
      if (!armed) return null;
      armed = false;
      const cmd = borg.controller(view, act);
      if (cmd) commands[cmd.code] = (commands[cmd.code] ?? 0) + 1;
      return cmd;
    },
    { viewDeps: { resolver, reg: game.booted.registries.objects } },
  );

  const places = new Set<string>();
  const depths = new Set<number>([state.chunk.depth]);
  let dead = false;
  let taken = 0;

  for (; taken < decisions; taken++) {
    armed = true;
    const status = runGameLoop(state, game.registry);
    places.add(
      `${String(state.chunk.depth)}:${String(state.actor.grid.x)},${String(state.actor.grid.y)}`,
    );
    depths.add(state.chunk.depth);
    if (status === LOOP_STATUS.DEAD) {
      dead = true;
      break;
    }
    if (status === LOOP_STATUS.DEATH_CONFIRM) {
      state.pendingDeath?.resolve(true);
      continue;
    }
    if (status === LOOP_STATUS.LEVEL_CHANGE) {
      game.changeLevel(state.targetDepth ?? state.chunk.depth + 1);
      state.generateLevel = false;
      depths.add(state.chunk.depth);
    }
  }

  return {
    decisions: taken,
    turns: state.turn,
    depths: [...depths].sort((a, b) => a - b),
    commands,
    places: places.size,
    dead,
  };
}

/**
 * Does this engine tell the truth about a locked door?
 *
 * `CellView.trap` used to mean "this grid holds any trap record", and a closed
 * door's lock IS a trap record (`square_set_door_lock`). So every locked door
 * arrived as something to disarm, `disarm` refused it for free, and the Borg
 * looped against one door for as long as it was left running. The fix is
 * `square_isdisarmabletrap` in the engine's own perceive facade; nothing this
 * repository can do reproduces it, because the frozen view carries no other
 * field that separates a door lock from a trap.
 *
 * MEASURED, not read off a version string. Lock a door and ask the view. A
 * version comparison would pass on any build somebody had renumbered, and the
 * whole reason this file exists is that facts about behaviour kept being taken
 * from something other than the behaviour.
 */
function engineSeparatesDoorLocksFromTraps(pack: GamePack): boolean {
  const game = startGame(pack, { seed: 5, depth: 1 });
  const state: GameState = game.state;
  const grid = { x: state.actor.grid.x + 1, y: state.actor.grid.y };
  const closed = game.booted.registries.features.byCodeName("CLOSED");
  state.chunk.setFeat(grid, closed.fidx);
  state.setDoorLock?.(grid, 5);
  const session = installController(state, () => null, {});
  const cell = session.view.cell(grid.x, grid.y);
  session.uninstall();
  /* A door that reports no trap is the fixed engine. A door that reports one is
   * the engine that hangs, and there is no point measuring play on it. */
  return cell !== null && cell.trap === false;
}

const suite = PACK_DIR ? describe : describe.skip;

suite("the Borg plays a real game", () => {
  const pack = PACK_DIR ? loadPack(PACK_DIR) : null;
  const engineReady = pack ? engineSeparatesDoorLocksFromTraps(pack) : false;
  const when = engineReady ? it : it.skip;

  /* The one assertion that runs on ANY engine: an engine that reports a locked
   * door as a trap cannot be played on, and saying so out loud is the point.
   * Every play test below is skipped on such an engine rather than failing,
   * because the defect is not in this repository and a red suite here would send
   * the next reader looking in the wrong place. */
  it("names the engine fix its play tests depend on", () => {
    if (!engineReady) {
      // eslint-disable-next-line no-console
      console.warn(
        "[borg] the installed engine still reports a locked door as a disarmable " +
          "trap, so the live-play tests are skipped. They need the engine release " +
          "that narrows CellView.trap to square_isdisarmabletrap; raise the engine " +
          "floor in manifest.json to that version before tagging this mod.",
      );
    }
    expect(typeof engineReady).toBe("boolean");
  });

  /* Four seeds rather than one: each of the three loops this test was written
   * for showed on some seeds and not others, and the wield loop was the only one
   * that showed on all four. */
  for (const seed of [1, 7, 42, 99]) {
    when(`keeps playing for 1500 decisions (seed ${String(seed)})`, () => {
      const r = playRun(pack!, seed, 1500);

      /* NO COMMAND RUNS AWAY WITH THE SESSION. This is the shape all three
       * loops had, and it is the only assertion that could have caught them:
       * 559 disarms against one door, 3964 wields between two torches, 215
       * descend/ascend pairs between the town and level 1. Movement is exempt
       * from nothing - `walk` is also how the Borg attacks, and a Borg that
       * walks 1200 times over 1500 decisions is exploring. The cap is on any
       * OTHER single verb. */
      const total = Object.values(r.commands).reduce((a, b) => a + b, 0);
      for (const [code, count] of Object.entries(r.commands)) {
        if (code === "walk" || code === "rest") continue;
        expect(
          count,
          `"${code}" was issued ${String(count)} of ${String(total)} times: ` +
            `a single command taking over is what a stall looks like from outside`,
        ).toBeLessThan(Math.max(60, Math.trunc(total / 2)));
      }

      /* AND IT GOES SOMEWHERE. A decision loop passes the check above when two
       * verbs alternate, so count the ground covered as well. Both the
       * stair-shuttle and the two-square oscillation left this in single
       * figures.
       *
       * Only for a run that was still going. A DEATH IS AN ENDING, and dying on
       * depth 1 after 77 decisions is upstream's own outcome for a level-1
       * character that met something it could not see - the target for this mod
       * is that it tries its best, not that it survives. It is also the cleanest
       * possible evidence that it was not stuck: every stall this test exists to
       * catch ran for as long as it was left running and never died. */
      if (!r.dead) {
        expect(
          r.places,
          `the character stood on ${String(r.places)} squares in ${String(r.decisions)} decisions`,
        ).toBeGreaterThan(30);
      }

      /* AND GAME TIME PASSES. A command the engine refuses costs no energy, so a
       * borg looping on one runs forever with the world frozen - the disarm hang
       * exactly. Ten turns per decision is the cost of one move at normal speed. */
      expect(r.turns).toBeGreaterThan(r.decisions * 2);
    }, 120_000);
  }

  when("gets into the dungeon and back out under its own steam", () => {
    /* The town half was never in doubt; leaving a dungeon level was, because
     * nothing in the port used a staircase it was standing on until the
     * caution.c:1169 block was ported. */
    const r = playRun(pack!, 1, 1500);
    expect(r.depths).toContain(0);
    expect(r.depths.some((d) => d >= 1)).toBe(true);
    expect(r.commands["descend"] ?? 0).toBeGreaterThan(0);
    expect(r.commands["ascend"] ?? 0).toBeGreaterThan(0);
  }, 120_000);
});
