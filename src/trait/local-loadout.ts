/**
 * A hypothetical loadout, built from the item views the Borg already holds.
 *
 * borg_best_stuff and the buy/sell/wear decisions score a loadout by swapping
 * borg_items[] and re-running borg_notice + borg_power in-process
 * (borg-item-wear.c:1221-1224, borg-store-buy.c:363-388). With the item-derived
 * notice (the race/class frame), the port can do the same: apply the change to
 * the equipment and pack views and notice that. The player view stays as it is,
 * as the C's player struct does - max HP and SP are the current ones.
 *
 * Changes apply release -> remove -> wield -> carry, as the engine's
 * simulateLoadout composes them.
 */

import type { ItemView } from "@rpgm-tools/neo-angband-core";
import type { BorgContext } from "../context.js";
import type { BorgLoadoutChange, BorgLoadoutRef } from "./simulate.js";
import { wieldSlot, type Slot } from "../item/item-wear.js";

/** The body slot index each wield_slot answer lands in (rings: left, then right). */
const SLOT_INDEX: Record<Exclude<Slot, "ring">, number> = {
  weapon: 0, bow: 1, amulet: 4, light: 5, body: 6, cloak: 7, shield: 8, helm: 9, gloves: 10, boots: 11,
};
const RING_SLOTS = [2, 3] as const;

export interface LocalLoadout {
  readonly equipment: readonly (ItemView | null)[];
  readonly inventory: readonly ItemView[];
}

/** Handles for wares taken into the pack: negative, so they never meet a real one. */
let wareHandle = -1;

export function applyLoadoutChange(ctx: BorgContext, change: BorgLoadoutChange): LocalLoadout | null {
  const equipment: (ItemView | null)[] = [...ctx.view.equipment()];
  const inventory: ItemView[] = [...ctx.view.inventory()];

  const take = (ref: BorgLoadoutRef, number: number): ItemView | null => {
    if (ref.from === "store") {
      const ware = ctx.view.stores()[ref.store]?.stock[ref.index];
      if (!ware) return null;
      return { ...(ware as ItemView), handle: wareHandle--, number };
    }
    const slot = equipment.findIndex((item) => item?.handle === ref.handle);
    if (slot >= 0) {
      const worn = equipment[slot]!;
      equipment[slot] = null;
      return worn;
    }
    const at = inventory.findIndex((item) => item.handle === ref.handle);
    if (at < 0) return null;
    const stack = inventory[at]!;
    if (stack.number <= number) {
      inventory.splice(at, 1);
      return stack;
    }
    inventory[at] = { ...stack, number: stack.number - number };
    return { ...stack, number };
  };

  for (const { handle, number } of change.release ?? []) {
    const slot = equipment.findIndex((item) => item?.handle === handle);
    if (slot >= 0) {
      equipment[slot] = null;
      continue;
    }
    const at = inventory.findIndex((item) => item.handle === handle);
    if (at < 0) return null;
    const stack = inventory[at]!;
    const n = number ?? stack.number;
    if (n >= stack.number) inventory.splice(at, 1);
    else inventory[at] = { ...stack, number: stack.number - n };
  }

  for (const slot of change.remove ?? []) {
    const worn = equipment[slot];
    if (worn) inventory.push(worn);
    equipment[slot] = null;
  }

  const wearAt = (item: ItemView, slot: number): void => {
    const displaced = equipment[slot];
    if (displaced) inventory.push(displaced);
    equipment[slot] = item;
  };
  if (change.copyInto) {
    /* borg_best_stuff_aux (borg-item-wear.c:1304): memcpy the candidate into
     * the slot. The original stays in the pack or home, and what the slot held
     * is not carried - the C restores it after scoring. */
    for (const { item: ref, slot } of change.wieldAt ?? []) {
      const source = ref.from === "store"
        ? (ctx.view.stores()[ref.store]?.stock[ref.index] as ItemView | undefined)
        : [...ctx.view.equipment(), ...ctx.view.inventory()].find((item) => item?.handle === ref.handle) ?? undefined;
      if (!source) return null;
      equipment[slot] = { ...source, number: 1 };
    }
    return { equipment, inventory };
  }

  /* Take every item first, so a swap between slots sees the original wearer. */
  const placed: Array<{ item: ItemView; slot: number }> = [];
  for (const { item: ref, slot } of change.wieldAt ?? []) {
    const item = take(ref, 1);
    if (!item) return null;
    placed.push({ item: { ...item, number: 1 }, slot });
  }
  for (const { item, slot } of placed) wearAt(item, slot);
  for (const ref of change.wield ?? []) {
    const item = take(ref, 1);
    if (!item) return null;
    const kind = wieldSlot(item);
    if (kind === null) return null;
    const slot = kind === "ring"
      ? (RING_SLOTS.find((s) => !equipment[s]) ?? RING_SLOTS[0])
      : SLOT_INDEX[kind];
    wearAt({ ...item, number: 1 }, slot);
  }

  for (const { item: ref, number } of change.carry ?? []) {
    const item = take(ref, number ?? 1);
    if (!item) return null;
    inventory.push(item);
  }

  return { equipment, inventory };
}
