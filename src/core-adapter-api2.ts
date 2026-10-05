import type { Api2Call, Api2Result, KnownItem, KnownWorldData, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
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

type Reads = Pick<BorgKnownReads, "mapBounds" | "inventory" | "equipment" | "stores" | "spellbooks">;
type AsyncReads = { [K in keyof Reads]: () => Api2Call<ReturnType<Reads[K]>> };

function item(known: KnownItem): ReturnType<BorgKnownReads["inventory"]>[number] {
  return {
    ...known,
    flags: [...known.flags],
    modifiers: known.modifiers.map((modifier) => ({ ...modifier })),
    brands: [...known.brands],
    slays: [...known.slays],
    resists: known.resists.map((resist) => ({ ...resist })),
    curses: [...known.curses],
  };
}

export function borgView(mod: ModApi2): AsyncReads {
  async function world<K extends "inventory" | "equipment" | "stores" | "spellbooks", T>(
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
    inventory: () => world("inventory", "state:inventory.read", (items) => items.map(item)),
    equipment: () => world("equipment", "state:inventory.read", (items) => items.map((known) => known && item(known))),
    stores: () => world("stores", "state:stores.read", (stores) => stores.map((store) => ({
      ...store,
      owner: { ...store.owner },
      stock: store.stock.map((known) => ({ ...item(known), index: known.index, ...(known.price === undefined ? {} : { price: known.price }) })),
    }))),
    spellbooks: () => world("spellbooks", "state:spells.read", (books) => books.map((book) => ({
      ...book,
      spells: book.spells.map((spell) => ({ ...spell })),
    }))),
  };
}
