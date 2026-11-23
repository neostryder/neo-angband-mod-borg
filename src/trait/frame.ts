/**
 * The race/class frame borg_notice and borg_power read from the player's race
 * and class records (borg-trait.c:1795-1834 r_adj + c_adj; class->magic
 * spell_first / spell_weight / total_spells in borg-trait.c and
 * borg-power.c). The C reads them through player->race and player->class; the
 * port builds them from the same content records the game composes
 * (p_race.json, class.json), by race and class name.
 */

import type { BorgFrame } from "./config.js";

type Json = Readonly<Record<string, unknown>>;

const STAT_KEYS = ["str", "int", "wis", "dex", "con"] as const;

function statsOf(record: Json | undefined): number[] {
  const stats = record?.["stats"];
  const obj = stats !== null && typeof stats === "object" && !Array.isArray(stats) ? (stats as Json) : {};
  return STAT_KEYS.map((key) => (typeof obj[key] === "number" ? obj[key] : 0));
}

/** SKILL order (player.h), keyed as the p_race / class records name them. */
const SKILL_KEYS = [
  "skill-disarm-phys", "skill-disarm-magic", "skill-device", "skill-save", "skill-search",
  "skill-stealth", "skill-melee", "skill-shoot", "skill-throw", "skill-dig",
] as const;

/** A race skill is a number; a class skill is { base, incr }. */
function skillPart(record: Json | undefined, key: string, part: "base" | "incr"): number {
  const v = record?.[key];
  if (typeof v === "number") return part === "base" ? v : 0;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const n = (v as Json)[part];
    return typeof n === "number" ? n : 0;
  }
  return 0;
}

/** "SUST_DEX | FREE_ACT" entries, as the records list object flags. */
function flagsOf(record: Json | undefined): string[] {
  const v = record?.["obj-flags"];
  if (!Array.isArray(v)) return [];
  return v.flatMap((entry) => (typeof entry === "string" ? entry.split("|").map((f) => f.trim()).filter(Boolean) : []));
}

function numberOf(record: Json | undefined, key: string): number | undefined {
  const v = record?.[key];
  return typeof v === "number" ? v : undefined;
}

/** The frame for one race/class pair, from their records. */
export function frameFromRecords(race: Json | undefined, cls: Json | undefined): BorgFrame {
  const r = statsOf(race);
  const c = statsOf(cls);
  const values = Array.isArray(race?.["values"]) ? (race["values"] as unknown[]) : [];
  const maxAttacks = numberOf(cls, "max-attacks");
  const minWeight = numberOf(cls, "min-weight");
  const attMultiply = numberOf(cls, "strength-multiplier");
  const frame: BorgFrame = {
    statAdj: r.map((v, i) => v + (c[i] ?? 0)),
    skills: SKILL_KEYS.map((key) => skillPart(race, key, "base") + skillPart(cls, key, "base")),
    skillsPerTen: SKILL_KEYS.map((key) => skillPart(cls, key, "incr")),
    infra: numberOf(race, "infravision") ?? 0,
    playerFlags: [...new Set([...flagsOf(race), ...flagsOf(cls)])],
    raceResistDisen: values.some((v) => typeof v === "string" && /^RES_DISEN\[[1-9]/.test(v)),
    ...(maxAttacks !== undefined ? { maxAttacks } : {}),
    ...(minWeight !== undefined ? { minWeight } : {}),
    ...(attMultiply !== undefined ? { attMultiply } : {}),
  };
  const magic = cls?.["magic"];
  if (magic !== null && typeof magic === "object" && !Array.isArray(magic)) {
    const m = magic as Json;
    /* class->magic.total_spells: every spell in every class book. */
    let total = 0;
    for (const book of Array.isArray(cls?.["book"]) ? (cls["book"] as unknown[]) : []) {
      if (book === null || typeof book !== "object" || Array.isArray(book)) continue;
      const spells = (book as Json)["spell"];
      if (Array.isArray(spells)) total += spells.length;
    }
    return {
      ...frame,
      ...(typeof m["first"] === "number" ? { spellFirst: m["first"] } : {}),
      ...(typeof m["weight"] === "number" ? { spellWeight: m["weight"] } : {}),
      totalSpells: total,
    };
  }
  /* A class with no magic block: total_spells 0, as the C's zeroed magic. */
  return { ...frame, totalSpells: 0 };
}

/** A frame lookup by race and class name over the composed records. */
export function frameBook(
  races: readonly Json[],
  classes: readonly Json[],
): (race: string, cls: string) => BorgFrame | null {
  const byName = (records: readonly Json[]) =>
    new Map(records.filter((r) => typeof r["name"] === "string").map((r) => [r["name"] as string, r]));
  const raceRecords = byName(races);
  const classRecords = byName(classes);
  const memo = new Map<string, BorgFrame | null>();
  return (race, cls) => {
    const key = `${race}\u0000${cls}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const r = raceRecords.get(race);
    const c = classRecords.get(cls);
    const frame = r && c ? frameFromRecords(r, c) : null;
    memo.set(key, frame);
    return frame;
  };
}
