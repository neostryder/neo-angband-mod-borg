/**
 * The title screen's "New Borg character" row (neostryder/neo-angband#327).
 *
 * An autoplayer's games want their own options, mod settings and roster, so
 * the row offers a separate profile first and this profile second, and starts
 * character creation with the Borg armed in either. The armed controller is
 * the player's consent for that one character, which is why plugin.ts returns
 * a controller on `ctx.controllerArmed` without the Ctrl-Z confirm.
 *
 * The row needs three host seams: `ctx.title` (ui:title), `ctx.profiles`
 * (profiles:manage), and `ctx.saves` (saves:manage), because the host refuses
 * a create-character action from a mod without it. With any of them missing
 * nothing is registered and the Borg starts only from Ctrl-Z, as before.
 */

import type { ModPluginContext, ModProfile, ModProfileAction } from "@rpgm-tools/neo-angband-core";

/** The parts of the plugin context the row reads. */
export type TitleCtx = Partial<Pick<ModPluginContext, "id" | "title" | "profiles" | "saves">>;

/** The ids of the profiles the Borg made, kept outside every profile. */
export interface ProfileMemory {
  read(): readonly string[];
  write(ids: readonly string[]): void;
}

export const TITLE_LABEL = "New Borg character";
/** Core keeps P, N, O, R, M, I, U and Q for its own rows, and Squire uses S. */
export const TITLE_KEY = "B";

export const WHERE_PROMPT = "Choose where the new Borg character plays";
export const WHERE_SEPARATE = "In a separate profile, with its own options, mods and characters";
export const WHERE_HERE = "In this profile";
export const WHICH_PROMPT = "Choose a profile for the Borg";
export const WHICH_FRESH = "Start a fresh profile";
export const WHICH_COPY = "Copy an existing profile";
export const COPY_PROMPT = "Choose a profile to copy. Its options, mods and mod settings come across, and its characters stay behind.";
export const FALLBACK_HERE = "Start the character in this profile";
export const GIVE_UP = "Back to the title";

/** `prefs` is copied with a profile, so the list lives in page storage that every profile shares. */
export const MEMORY_KEY = "neo-angband-borg/profiles";
const MEMORY_FORMAT = "neo-angband/borg/profiles";

const ARMED: ModProfileAction = { kind: "create-character", armController: true };

interface PageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function idsFrom(stored: unknown): string[] | null {
  if (stored === null || typeof stored !== "object") return null;
  const env = stored as Record<string, unknown>;
  if (env["format"] !== MEMORY_FORMAT) return null;
  const data = env["data"] as Record<string, unknown> | undefined;
  const ids = data?.["profileIds"];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : null;
}

/**
 * The install-level list in page storage. A page that cannot reach storage
 * still remembers for the session, so the row works and only forgets on reload.
 */
export function installMemory(storage?: PageStorage): ProfileMemory {
  /* Looked up on use, so registering the row on every boot touches no storage. */
  const page = (): PageStorage | undefined => storage ?? (globalThis as { localStorage?: PageStorage }).localStorage;
  let session: readonly string[] = [];
  return {
    read() {
      try {
        const raw = page()?.getItem(MEMORY_KEY);
        if (raw !== null && raw !== undefined) return idsFrom(JSON.parse(raw)) ?? session;
      } catch {
        /* Unreadable storage falls back to this session's list. */
      }
      return session;
    },
    write(ids) {
      session = [...ids];
      try {
        page()?.setItem(MEMORY_KEY, JSON.stringify({ format: MEMORY_FORMAT, schemaVersion: 1, data: { profileIds: session } }));
      } catch {
        /* Kept for this session only. */
      }
    },
  };
}

/** "Borg", then "Borg 2" and onward, skipping names already in use. */
export function freshName(taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has("borg")) return "Borg";
  for (let n = 2; ; n++) if (!used.has(`borg ${String(n)}`)) return `Borg ${String(n)}`;
}

/** Register the row when the host offers all three seams. Returns whether it did. */
export function registerBorgTitle(ctx: TitleCtx, memory: ProfileMemory): boolean {
  const title = ctx.title;
  const profiles = ctx.profiles;
  if (title === undefined || profiles === undefined || ctx.saves === undefined) return false;
  const self = ctx.id ?? "borg";

  async function here(): Promise<void> {
    const listed = profiles!.list();
    const id = listed.ok ? listed.value.find((profile) => profile.active)?.id ?? null : null;
    const started = profiles!.switchTo(id, ARMED);
    if (!started.ok) await title!.choose(`The Borg could not start the character: ${started.reason}`, [GIVE_UP]);
  }

  async function refused(reason: string): Promise<void> {
    const answer = await title!.choose(`The Borg could not use a separate profile: ${reason}`, [FALLBACK_HERE]);
    if (answer === 0) await here();
  }

  async function separate(): Promise<void> {
    const listed = profiles!.list();
    if (!listed.ok) return refused(listed.reason);
    const all = listed.value;
    const ours = new Set(memory.read());
    const made = all.filter((profile) => profile.id !== null && ours.has(profile.id));
    const which = await title!.choose(WHICH_PROMPT, [WHICH_FRESH, WHICH_COPY, ...made.map((profile) => `Use ${profile.name}`)]);
    if (which === null) return;
    let target: ModProfile;
    if (which >= 2) {
      const chosen = made[which - 2];
      if (chosen === undefined) return;
      target = chosen;
    } else {
      let copyFrom: string | null | undefined;
      if (which === 1) {
        const source = await title!.choose(COPY_PROMPT, all.map((profile) => profile.name));
        if (source === null) return;
        const picked = all[source];
        if (picked === undefined) return;
        copyFrom = picked.id;
      }
      const created = profiles!.create(freshName(all.map((profile) => profile.name)), copyFrom === undefined ? {} : { copyFrom });
      if (!created.ok) return refused(created.reason);
      target = created.value;
      const id = target.id;
      if (id === null) return refused("the new profile has no id");
      /* Stale ids are dropped here, and the new one is kept even if a later step is refused, so "Use" offers it next time. */
      memory.write([...made.map((profile) => profile.id as string), id]);
      /* A copy keeps the loadout it was copied for. A fresh profile needs only the Borg, which depends on no other mod. */
      if (copyFrom === undefined) {
        const enabled = profiles!.setEnabledMods(id, [self]);
        if (!enabled.ok) return refused(enabled.reason);
      }
    }
    const switched = profiles!.switchTo(target.id, ARMED);
    if (!switched.ok) return refused(switched.reason);
  }

  title.registerRow({
    label: TITLE_LABEL,
    key: TITLE_KEY,
    async run() {
      const where = await title.choose(WHERE_PROMPT, [WHERE_SEPARATE, WHERE_HERE]);
      if (where === 0) await separate();
      else if (where === 1) await here();
    },
  });
  return true;
}
