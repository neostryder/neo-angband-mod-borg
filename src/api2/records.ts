/**
 * The game's content records, read once and turned into the plain data the
 * decision code takes.
 *
 * Every table here is composed content the running game binds at boot, so a
 * mod's own monster, blow method or spell is read on the same terms as the
 * game's. None of it changes during a session, so the bridge reads each table
 * once when the mod starts.
 */

import type { JsonRecord, KnownPlayer, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { GameConstants, ItemView } from "@rpgm-tools/neo-angband-core";
import type { ItemAnalysis } from "../item/deps.js";
import { RSF } from "../core-api.js";
import type { BorgContext } from "../context.js";

type Content = Pick<ModApi2, "content">;

/** The value of a successful call, or null for any failure. */
export async function valueOf<T>(call: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>): Promise<T | null> {
  const result = await call;
  return result.ok ? result.value : null;
}

/** The flag names in a record's `flags` field, which lists them as lines such as "LOS | PROJECT | PASSABLE". */
export function recordFlags(value: unknown): Set<string> {
  const lines: readonly unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const names = new Set<string>();
  for (const line of lines) {
    if (typeof line !== "string") continue;
    for (const name of line.split("|")) {
      const trimmed = name.trim();
      if (trimmed !== "") names.add(trimmed);
    }
  }
  return names;
}

/** A record field that lists lines of text, joined the way the game binds them. */
function joined(value: unknown): string {
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string").join("") : "";
}

/** Whether each trap kind, by its index, is a trap in the disarm command's sense (it carries TRAP; a door lock, web or glyph does not). */
export async function trapKinds(api: Content): Promise<readonly boolean[]> {
  const records = (await valueOf(api.content.records("trap"))) ?? [];
  return records.map((record) => recordFlags(record["flags"]).has("TRAP"));
}

/** Every monster blow action template in the data ("hits {target}"), for the attack-message table. */
export async function blowActions(api: Content): Promise<string[]> {
  const records = (await valueOf(api.content.records("blow_methods"))) ?? [];
  const out: string[] = [];
  for (const record of records) {
    const act = record["act"];
    if (!Array.isArray(act)) continue;
    for (const line of act) if (typeof line === "string") out.push(line);
  }
  return out;
}

/** One monster spell with the messages each of its power levels prints. */
export interface SpellMessages {
  readonly index: number;
  readonly levels: readonly { readonly message: string; readonly blindMessage: string; readonly missMessage: string }[];
}

/** Monster spell messages by spell index, for recognizing a spell cast out of sight. */
export async function spellMessages(api: Content): Promise<SpellMessages[]> {
  const records = (await valueOf(api.content.records("monster_spell"))) ?? [];
  const table = RSF as unknown as Readonly<Record<string, number>>;
  const out: SpellMessages[] = [];
  for (const record of records) {
    const name = record["name"];
    const index = typeof name === "string" ? table[name] : undefined;
    if (index === undefined) continue;
    const level = (rec: JsonRecord) => ({ message: joined(rec["message-vis"]), blindMessage: joined(rec["message-invis"]), missMessage: joined(rec["message-miss"]) });
    const cutoffs = Array.isArray(record["power-cutoff"]) ? record["power-cutoff"] : [];
    out.push({
      index,
      levels: [level(record), ...cutoffs.filter((cut): cut is JsonRecord => cut !== null && typeof cut === "object" && !Array.isArray(cut)).map(level)],
    });
  }
  return out;
}

/** The cost of each object kind, by the kind's index in the object records. */
export async function kindCosts(api: Content): Promise<readonly number[]> {
  const records = (await valueOf(api.content.records("object"))) ?? [];
  return records.map((record) => (typeof record["cost"] === "number" ? record["cost"] : 0));
}

export type ItemAnalyzer = (item: ItemView) => ItemAnalysis;
const ITEM_ANALYZERS = new WeakMap<Content["content"], Promise<ItemAnalyzer>>();

/** borg-item-analyze.c:43-259,413-425,646-655 reads costs, dice and flag properties. */
export function itemAnalyzer(api: Content): Promise<ItemAnalyzer> {
  const cached = ITEM_ANALYZERS.get(api.content);
  if (cached) return cached;
  const read = async (): Promise<ItemAnalyzer> => {
    const [objects, egos, artifacts, properties] = await Promise.all([
      valueOf(api.content.records("object")), valueOf(api.content.records("ego_item")),
      valueOf(api.content.records("artifact")), valueOf(api.content.records("object_property")),
    ]);
    /* ItemView names identify static entries; duplicate names keep the stack estimate. */
    const byName = (records: readonly JsonRecord[] | null) => {
      const names = new Map<unknown, JsonRecord | null>();
      for (const record of records ?? []) names.set(record["name"], names.has(record["name"]) ? null : record);
      return names;
    };
    const egoNames = byName(egos);
    const artifactNames = byName(artifacts);
    const negative = new Set((properties ?? []).filter((record) => record["type"] === "flag"
      && typeof record["power"] === "number" && record["power"] < 0).map((record) => record["code"]));
    const number = (value: unknown): number | null => typeof value === "number" ? value : null;
    const field = (value: unknown, key: string): unknown => value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord)[key] : undefined;
    return (item) => {
      const index = /^kind:(\d+)$/.exec(item.kindKey);
      const kind = index ? objects?.[Number(index[1])] : undefined;
      const ego = egoNames.get(item.egoName);
      const artifact = artifactNames.get(item.artifactName);
      const dice = /^(\d+)d(\d+)$/.exec(String(field(kind?.["attack"], "hd") ?? ""));
      const flags = recordFlags(ego?.["flags"]);
      return {
        cost: kind ? number(kind["cost"]) ?? 0 : null,
        egoCost: ego ? number(field(ego["info"], "cost")) ?? 0 : null,
        artifactCost: artifact ? number(artifact["cost"]) ?? 0 : null,
        dd: dice ? Number(dice[1]) : item.dd, ds: dice ? Number(dice[2]) : item.ds,
        cursed: item.curses.length > 0 || item.flags.some((flag) => negative.has(flag)),
        oneRing: artifact ? artifact["act"] === "BIZARRE" : item.artifactName === "'The One Ring'",
        randomPower: item.ego && (!ego || ["RAND_POWER", "RAND_SUSTAIN", "RAND_BASE_RES", "RAND_HI_RES", "RAND_RES_POWER"].some((flag) => flags.has(flag))),
      };
    };
  };
  const result = read();
  ITEM_ANALYZERS.set(api.content, result);
  return result;
}

/** Book kinds follow global registration order; shared names reuse a kind (borg-magic.c:689-694). */
export async function magicRecords(
  api: Content,
  effects: readonly { name: string; aim: boolean }[],
): Promise<{ bookKind: NonNullable<BorgContext["bookKind"]>; spellEffect: NonNullable<BorgContext["spellEffect"]> }> {
  const [objects, classes] = await Promise.all([valueOf(api.content.boundRecords("object")), valueOf(api.content.records("class"))]);
  const kinds = new Map<string, { tval: number; sval: number }>();
  const counts = new Map<number, number>();
  const spells = new Map<string, { name: string; aim: boolean }>();
  const effectAim = new Map(effects.map((effect) => [effect.name, effect.aim]));
  /* Bound kinds include class books and artifact bases. Each tval's ordinal is
   * its sval, as assigned by the engine's object and book registration. */
  for (const object of [...(objects ?? [])].sort((a, b) => a.index - b.index)) {
    const tval = object.tval;
    if (tval === undefined) continue;
    const sval = (counts.get(tval) ?? 0) + 1;
    counts.set(tval, sval);
    kinds.set(`${String(tval)}:${object.name}`, { tval, sval });
  }
  for (const cls of classes ?? []) {
    let sidx = 0;
    for (const book of Array.isArray(cls["book"]) ? cls["book"] : []) {
      if (book === null || typeof book !== "object" || Array.isArray(book)) continue;
      for (const spell of Array.isArray(book["spell"]) ? book["spell"] : []) {
        if (spell === null || typeof spell !== "object" || Array.isArray(spell)) continue;
        /* The C stores the first effect, including RANDOM (borg-magic.c:759). */
        const effect = Array.isArray(spell["effect"]) ? spell["effect"][0] : null;
        if (effect !== null && typeof effect === "object" && !Array.isArray(effect) && typeof effect["eff"] === "string") {
          const name = effect["eff"];
          spells.set(`${String(cls["name"])}:${String(sidx)}`, { name, aim: effectAim.get(name) ?? false });
        }
        sidx++;
      }
    }
  }
  return {
    bookKind: (tval, name) => kinds.get(`${String(tval)}:${name}`) ?? null,
    spellEffect: (cls, sidx) => spells.get(`${cls}:${String(sidx)}`) ?? null,
  };
}

/** The constants the game reads from its constants records; every other one keeps its built-in value. */
const DEFAULT_CONSTANTS: GameConstants = {
  moveEnergy: 100,
  maxSight: 20,
  maxRange: 20,
  fleeRange: 5,
  turnRange: 5,
  reproMonsterMax: 100,
  reproMonsterRate: 8,
  glyphHardness: 550,
  dayLength: 10000,
  foodValue: 100,
  foodStarve: 100,
  foodFaint: 400,
  foodWeak: 800,
  foodHungry: 1500,
  allocMonsterChance: 500,
  storeTurns: 1000,
  lifeDrainPercent: 2,
  levelMonsterMax: 1024,
  floorSize: 23,
  maxDepth: 128,
  stairSkip: 1,
};

/** Section and label of each constant the game takes from its records. */
const CONSTANT_SOURCES: Readonly<Partial<Record<keyof GameConstants, readonly [string, string]>>> = {
  maxSight: ["player", "max-sight"],
  maxRange: ["player", "max-range"],
  floorSize: ["carry-cap", "floor-size"],
  maxDepth: ["world", "max-depth"],
  stairSkip: ["world", "stair-skip"],
  dayLength: ["world", "day-length"],
  foodValue: ["player", "food-value"],
  allocMonsterChance: ["mon-gen", "chance"],
  storeTurns: ["store", "turns"],
  lifeDrainPercent: ["mon-play", "life-drain"],
  levelMonsterMax: ["level-max", "monsters"],
};

export async function gameConstants(api: Content): Promise<GameConstants> {
  const records = (await valueOf(api.content.records("constants"))) ?? [];
  const lookup = (section: string, label: string): number | undefined => {
    for (const record of records) {
      const entries = record[section];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry["label"] === label && typeof entry["value"] === "number") return entry["value"];
      }
    }
    return undefined;
  };
  const out: GameConstants = { ...DEFAULT_CONSTANTS };
  for (const [field, source] of Object.entries(CONSTANT_SOURCES) as [keyof GameConstants, readonly [string, string]][]) {
    const value = lookup(source[0], source[1]);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/** The timed effect record behind each status field, by its name in the game's player_timed file. */
export const TIMED_RECORDS: Readonly<Record<Exclude<keyof KnownPlayer["status"], "timed" | "food" | "foodGrade" | "fearful">, string>> = {
  blind: "BLIND",
  confused: "CONFUSED",
  afraid: "AFRAID",
  poisoned: "POISONED",
  cut: "CUT",
  stun: "STUN",
  paralyzed: "PARALYZED",
  fast: "FAST",
  sprint: "SPRINT",
  protEvil: "PROTEVIL",
  hero: "HERO",
  shero: "SHERO",
  shield: "SHIELD",
  stoneskin: "STONESKIN",
  blessed: "BLESSED",
  fastcast: "FASTCAST",
  resAcid: "OPP_ACID",
  resElec: "OPP_ELEC",
  resFire: "OPP_FIRE",
  resCold: "OPP_COLD",
  resPois: "OPP_POIS",
  terror: "TERROR",
  amnesia: "AMNESIA",
  image: "IMAGE",
};

/** The lowest duration in each named grade of each timed effect, from the player_timed records. */
export type GradeFloors = ReadonlyMap<string, ReadonlyMap<string, number>>;

export async function gradeFloors(api: Content): Promise<GradeFloors> {
  const records = (await valueOf(api.content.records("player_timed"))) ?? [];
  const out = new Map<string, Map<string, number>>();
  for (const record of records) {
    const name = record["name"];
    const grades = record["grade"];
    if (typeof name !== "string" || !Array.isArray(grades)) continue;
    const floors = new Map<string, number>();
    let floor = 1;
    for (const grade of grades) {
      if (grade === null || typeof grade !== "object" || Array.isArray(grade)) continue;
      const label = grade["name"];
      if (typeof label === "string" && label !== "" && !floors.has(label)) floors.set(label, floor);
      if (typeof grade["max"] === "number") floor = grade["max"] + 1;
    }
    out.set(name, floors);
  }
  return out;
}
