import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { ContentIdResolver, EFFECT_ENTRIES, LOOP_STATUS, installController, runGameLoop, startGame } from "@rpgm-tools/neo-angband-core";
import type { AgentCommand, AgentView, GamePack } from "@rpgm-tools/neo-angband-core";
import { createBorg } from "./controller.js";
import { makeCoreResolvers } from "./resolvers.js";
import { BI } from "./trait/index.js";

const CLASSES = ["Warrior", "Mage", "Druid", "Priest", "Necromancer", "Paladin", "Rogue", "Ranger", "Blackguard"];
const TRAITS = ["CLEVEL", "MAXCLEVEL", "CDEPTH", "MAXHP", "CURHP", "LIGHT", "FOOD", "AFUEL", "APHASE", "ATELEPORT", "AESCAPE", "ATELEPORTLVL", "ACLW", "ACSW", "ACCW"] as const;

interface Decision {
  tick: number;
  turn: number;
  player: ReturnType<AgentView["player"]>;
  inventory: ReturnType<AgentView["inventory"]>;
  equipment: ReturnType<AgentView["equipment"]>;
  quiver: ReturnType<NonNullable<AgentView["quiver"]>>;
  monsters: ReturnType<AgentView["monsters"]>;
  command: AgentCommand | null;
  messages: string[];
  traits: Record<string, number>;
  goal: object;
}

interface Failure {
  tick: number;
  category: "stuck in a loop" | "other";
  evidence: string;
  lastDecisions: Decision[];
}

interface Life {
  class: string;
  seed: number;
  decisionCap: number;
  decisions: number;
  gameTurns: number;
  maximumDepth: number;
  level: number;
  alive: boolean;
  deathCause: string | null;
  firstDescent: number | null;
  firstBuy: number | null;
  boughtBeforeFirstDescent: boolean | null;
  buys: number;
  sells: number;
  townTrips: number;
  stalls: Failure[];
  death: Failure | null;
  exception: { message: string; stack: string | null; tick: number } | null;
  descents: Decision[];
  lastDecisions: Decision[];
  elapsedMs: number;
}

function positive(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

function loadPack(): GamePack {
  const dir = dirname(createRequire(import.meta.url).resolve("@rpgm-tools/neo-angband-content/pack/constants.json"));
  const json = <T,>(name: string): T => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as T;
  const records = <T,>(name: string): T[] => json<{ records: T[] }>(name).records;
  return {
    constants: json("constants"), terrain: records("terrain"), roomTemplates: records("room_template"),
    vaults: records("vault"), dungeonProfiles: records("dungeon_profile"), projection: records("projection"),
    trap: records("trap"), names: records("names"), quest: records("quest"),
    obj: {
      objectBase: json("object_base"), object: json("object"), egoItem: json("ego_item"), artifact: json("artifact"),
      curse: json("curse"), brand: json("brand"), slay: json("slay"), activation: json("activation"),
      objectProperty: json("object_property"), flavor: json("flavor"),
    },
    mon: {
      pain: records("pain"), blowMethods: records("blow_methods"), blowEffects: records("blow_effects"),
      monsterSpells: records("monster_spell"), monsterBases: records("monster_base"), monsters: records("monster"),
      summons: records("summon"), pits: records("pit"),
    },
    mon2: undefined,
    player: {
      races: records("p_race"), classes: records("class"), properties: records("player_property"), timed: records("player_timed"),
      shapes: records("shape"), bodies: records("body"), history: records("history"), realms: records("realm"),
    },
  } as unknown as GamePack;
}

function runLife(pack: GamePack, cls: string, seed: number, cap: number): Life {
  const started = Date.now();
  const r: Life = {
    class: cls, seed, decisionCap: cap, decisions: 0, gameTurns: 0, maximumDepth: 0, level: 1, alive: true,
    deathCause: null, firstDescent: null, firstBuy: null, boughtBeforeFirstDescent: null,
    buys: 0, sells: 0, townTrips: 0, stalls: [], death: null, exception: null, descents: [], lastDecisions: [], elapsedMs: 0,
  };
  try {
    const game = startGame(pack, { seed, className: cls, raceName: "Human", depth: 0 });
    if (game.state.actor.player.cls.name !== cls) throw new Error(`Birth selected ${game.state.actor.player.cls.name}, expected ${cls}`);
    const state = game.state;
    const books = game.players.classes.flatMap((playerClass) => playerClass.magic.books);
    const borg = createBorg({
      rngSeed: (seed * 2654435761) >>> 0 || 1,
      resolvers: makeCoreResolvers({
        races: game.booted.registries.monsters.races, objects: game.booted.registries.objects, state: state as never,
        blowMethods: game.booted.registries.monsters.blowMethods.values(),
        monsterSpells: game.booted.registries.monsters.spells.values(),
        bookKind: (tval, name) => {
          const book = books.find((book) => book.tvalIdx === tval && book.name === name);
          return book ? { tval: book.tvalIdx, sval: book.sval } : null;
        },
        spellEffect: (className, sidx) => {
          const spell = game.players.classByName(className)?.magic.books.flatMap((book) => book.spells).find((spell) => spell.sidx === sidx);
          const raw = spell?.effectsRaw[0] as { eff?: unknown } | undefined;
          if (typeof raw?.eff !== "string") return null;
          return { name: raw.eff, aim: EFFECT_ENTRIES.find((effect) => effect.name === raw.eff)?.aim ?? false };
        },
        frame: (raceName, className) => {
          const race = game.players.raceByName(raceName);
          const playerClass = game.players.classByName(className);
          if (!race || !playerClass) return null;
          return {
            statAdj: race.statAdj.map((value, index) => value + (playerClass.statAdj[index] ?? 0)),
            spellFirst: playerClass.magic.spellFirst, spellWeight: playerClass.magic.spellWeight, totalSpells: playerClass.magic.totalSpells,
          };
        },
      }),
    });
    let armed = false;
    let current: Decision | null = null;
    let signature = "";
    let unchanged = 0;
    let previousDepth = 0;
    const checkpoint = (phase: string): void => {
      if (process.env["BORG_SOAK_CHECKPOINT"] !== "1") return;
      writeFileSync(join(resolve(process.env["BORG_SOAK_OUTPUT"] ?? ".soak-results"), "checkpoint.json"), JSON.stringify({
        class: cls, seed, tick: r.decisions, turn: state.turn, phase, updated: new Date().toISOString(), lastDecisions: r.lastDecisions,
      }, null, 2) + "\n");
    };
    const session = installController(state, (view, act) => {
      if (!armed) return null;
      armed = false;
      r.decisions += 1;
      current = {
        tick: r.decisions, turn: state.turn, player: view.player(), inventory: view.inventory(), equipment: view.equipment(),
        quiver: view.quiver?.() ?? [], monsters: view.monsters(), command: null, messages: [], traits: {}, goal: {},
      };
      r.lastDecisions.push(current);
      if (r.lastDecisions.length > 20) r.lastDecisions.shift();
      checkpoint("deciding");
      current.command = borg.controller(view, act);
      current.traits = Object.fromEntries(TRAITS.map((name) => [name, borg.world.self.trait[BI[name]] ?? 0]));
      current.goal = structuredClone(borg.world.self.goal);
      if (current.command?.code === "descend") r.descents.push(structuredClone(current));
      checkpoint("executing");
      return current.command;
    }, { viewDeps: { resolver: new ContentIdResolver({
      objects: game.booted.registries.objects, playerRaces: game.players.races, playerClasses: game.players.classes,
    }), reg: game.booted.registries.objects } });
    const previousMsg = state.msg;
    state.msg = (text) => {
      previousMsg?.(text);
      current?.messages.push(text);
      if (/^You bought .+ for \d+ gold\.$/.test(text)) {
        r.buys += 1;
        r.firstBuy ??= r.decisions;
      }
      if (/^You sold .+ for \d+ gold\.$/.test(text) || (current?.command?.code === "shop-sell" && /^You had .+\.$/.test(text))) r.sells += 1;
    };
    try {
      while (r.decisions < cap) {
        const before = r.decisions;
        armed = true;
        const status = runGameLoop(state, game.registry);
        if (status === LOOP_STATUS.DEATH_CONFIRM) state.pendingDeath?.resolve(true);
        if (status === LOOP_STATUS.LEVEL_CHANGE) {
          game.changeLevel(state.targetDepth ?? state.chunk.depth + 1);
          state.generateLevel = false;
        }
        const p = session.view.player();
        r.gameTurns = state.turn;
        r.maximumDepth = Math.max(r.maximumDepth, p.depth);
        r.level = p.level;
        r.alive = !p.dead && status !== LOOP_STATUS.DEAD;
        if (previousDepth === 0 && p.depth > 0 && r.firstDescent === null) {
          r.firstDescent = r.decisions;
          r.boughtBeforeFirstDescent = r.buys > 0;
        }
        if (previousDepth > 0 && p.depth === 0) r.townTrips += 1;
        previousDepth = p.depth;
        if (!r.alive) {
          r.deathCause = state.actor.player.diedFrom || null;
          r.death = { tick: r.decisions, category: "other", evidence: r.deathCause ?? "The engine reported death without a cause.", lastDecisions: structuredClone(r.lastDecisions) };
          break;
        }
        if (r.decisions !== before) {
          /* Fuel countdowns belong in inventory, so refueling progress cannot look like a stall. */
          const next = JSON.stringify([p.grid, p.depth, p.level, p.hp, session.view.inventory(), session.view.equipment(), session.view.quiver?.() ?? []]);
          unchanged = next === signature ? unchanged + 1 : 0;
          signature = next;
          if (unchanged === 2000) r.stalls.push({
            tick: r.decisions, category: "stuck in a loop", evidence: "Position, depth, level, inventory, equipment, quiver, and HP remained unchanged for 2000 decisions.", lastDecisions: structuredClone(r.lastDecisions),
          });
        } else if (status === LOOP_STATUS.INPUT) {
          throw new Error("The loop requested input without calling the armed controller");
        }
      }
    } finally {
      session.uninstall();
    }
  } catch (error) {
    r.exception = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null, tick: r.decisions };
  }
  r.elapsedMs = Date.now() - started;
  return r;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2;
}

function summarize(lives: Life[]): string {
  const rows = ["| Class | Lives | Median depth | Best depth | Deaths | Lives stalled | Stall episodes | Exceptions | Bought before descent | No descent |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const cls of [...new Set(lives.map((life) => life.class))]) {
    const group = lives.filter((life) => life.class === cls);
    rows.push(`| ${cls} | ${group.length} | ${median(group.map((life) => life.maximumDepth))} | ${Math.max(...group.map((life) => life.maximumDepth))} | ${group.filter((life) => !life.alive).length} | ${group.filter((life) => life.stalls.length).length} | ${group.reduce((n, life) => n + life.stalls.length, 0)} | ${group.filter((life) => life.exception).length} | ${group.filter((life) => life.boughtBeforeFirstDescent === true).length}/${group.length} | ${group.filter((life) => life.firstDescent === null).length} |`);
  }
  const bought = lives.filter((life) => life.boughtBeforeFirstDescent === true).length;
  return [
    "# Borg class soak", "", ...rows, "",
    `The port bought before descent in ${bought}/${lives.length} lives (${(100 * bought / lives.length).toFixed(2)}%). Lives without a descent stay in the denominator and have a null per-life result.`, "",
    "The supplied C baseline is 1798/1800 (99.89%), with purchases by tick 10000. This run uses the published TypeScript engine and content, Human characters, the engine's default stat roller and birth options, the direct controller seam from play.test.ts, and distinct game and Borg seeds. It does not exercise the desktop API 2 bridge. The baseline's class, race, birth, seed, and stopping details were not supplied; these shares are descriptive rather than a controlled comparison.", "",
    "Town trips count returns from the dungeon and exclude the initial town birth. Buy and sell totals count successful engine transaction messages and exclude home transfers. Decision ticks count controller calls, including store calls and null answers; game-loop calls and autonomous resting turns do not consume decision ticks. A stall records the first 2000-decision interval in each uninterrupted unchanged-state streak and does not end the life.", "",
    "## Failure evidence", "",
    ...lives.flatMap((life) => [
      ...life.stalls.map((failure) => `- ${life.class}, seed ${life.seed}, tick ${failure.tick}: ${failure.category}. ${failure.evidence} The JSON contains the last 20 decisions. C fidelity requires review.`),
      ...(life.death ? [`- ${life.class}, seed ${life.seed}, tick ${life.death.tick}: other (unreviewed). ${life.death.evidence} The JSON contains the last 20 decisions. C fidelity requires review.`] : []),
      ...(life.exception ? [`- ${life.class}, seed ${life.seed}, tick ${life.exception.tick}: exception: ${life.exception.message}. The JSON contains the stack.`] : []),
    ]), "",
  ].join("\n");
}

it.skipIf(process.env["BORG_SOAK"] !== "1")("records an opt-in class soak against the published engine", () => {
  const classes = (process.env["BORG_SOAK_CLASSES"] ?? CLASSES.join(",")).split(",").map((name) => name.trim());
  if (classes.some((name) => !CLASSES.includes(name)) || new Set(classes).size !== classes.length) throw new Error("BORG_SOAK_CLASSES must contain distinct supported class names");
  const count = positive("BORG_SOAK_LIVES", 20);
  const cap = positive("BORG_SOAK_DECISIONS", 30000);
  const baseSeed = positive("BORG_SOAK_SEED", 140000);
  const output = resolve(process.env["BORG_SOAK_OUTPUT"] ?? ".soak-results");
  const pack = loadPack();
  const lives: Life[] = [];
  const started = new Date().toISOString();
  mkdirSync(output, { recursive: true });
  const save = (): void => {
    writeFileSync(join(output, "results.json"), JSON.stringify({ started, updated: new Date().toISOString(), engine: "1.23.0-beta.4", classes, livesPerClass: count, decisionCap: cap, baseSeed, complete: lives.length === classes.length * count, lives }, null, 2) + "\n");
    writeFileSync(join(output, "summary.md"), summarize(lives));
  };
  for (const cls of classes) {
    for (let n = 0; n < count; n++) {
      const seed = baseSeed + CLASSES.indexOf(cls) * count + n;
      if (seed > 0xffffffff) throw new Error("The seed range exceeds uint32");
      const life = runLife(pack, cls, seed, cap);
      lives.push(life);
      save();
      process.stdout.write(`${cls} ${n + 1}/${count}: seed=${seed} decisions=${life.decisions} depth=${life.maximumDepth} alive=${life.alive} buys=${life.buys} stalls=${life.stalls.length} exception=${life.exception?.message ?? "none"} ms=${life.elapsedMs}\n`);
    }
  }
  expect(lives).toHaveLength(classes.length * count);
}, 7_200_000);
