import type { Api2Call, Api2Result, KnownWorldData, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { BorgAdapter, BorgKnownReads } from "./core-api.js";

export function createAdapter(mod: ModApi2): Pick<BorgAdapter, "meta"> {
  return {
    meta: {
      get flags() {
        return mod.meta.flags;
      },
      log: (message) => mod.meta.log(message),
    },
  };
}

type Reads = Pick<BorgKnownReads, "mapBounds" | "spellbooks">;
type AsyncReads = { [K in keyof Reads]: () => Api2Call<ReturnType<Reads[K]>> };

export function borgView(mod: ModApi2): AsyncReads {
  async function world<K extends "spellbooks", T>(
    part: K,
    capability: string,
    convert: (value: NonNullable<KnownWorldData[K]>) => T,
  ): Api2Call<T> {
    const result = await mod.view.world();
    if (!result.ok) return result;
    const value = result.value[part];
    if (value === null) {
      return { ok: false, reason: "not-granted", capability, message: `The Borg needs ${capability}.` };
    }
    return { ok: true, value: convert(value) };
  }

  return {
    async mapBounds(): Promise<Api2Result<ReturnType<Reads["mapBounds"]>>> {
      const result = await mod.view.level();
      if (!result.ok) return result;
      return { ok: true, value: { width: result.value.width, height: result.value.height } };
    },
    spellbooks: () => world("spellbooks", "state:spells.read", (books) => books.map((book) => ({
      ...book,
      spells: book.spells.map((spell) => ({ ...spell })),
    }))),
  };
}
