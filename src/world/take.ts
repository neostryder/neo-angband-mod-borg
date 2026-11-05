/**
 * Object tracking - a faithful port of struct borg_take and the borg_takes[]
 * list (reference/src/borg/borg-flow-take.h).
 *
 * As with monsters, the Borg tracks floor objects in its own list with
 * staleness, re-deriving identity from what it perceives. This is the target
 * set for borg_flow_take (flow-to-item).
 */

import { GOAL_TAKE, type BorgWorld } from "./model.js";

/** Estimated floor-object record (struct borg_take). */
export interface BorgTake {
  /** Object kind index (k_idx), 0 for none. */
  kIdx: number;
  /** Object tval (broad category), for quick filtering. */
  tval: number;
  sval: number;
  aware: boolean;
  /** Verified kind (not just guessed from a symbol). */
  known: boolean;
  /**
   * Estimated value (borg_take.value, set in borg_new_take,
   * borg-flow-take.c:251-271). Everything that flows to an object gates on
   * `value > 0`, so a record left at zero is a record the Borg will never walk
   * to. See takeValue in perceive.ts for how it is derived.
   */
  value: number;
  /** Location. */
  pos: { x: number; y: number };
  /** When last seen (borg clock). */
  when: number;
  /** The game's object index, when known. */
  oIdx: number;
}

/** A fresh, empty take record. */
export function makeBorgTake(): BorgTake {
  return {
    kIdx: 0,
    tval: 0,
    sval: 0,
    aware: false,
    known: false,
    value: 0,
    pos: { x: 0, y: 0 },
    when: 0,
    oIdx: 0,
  };
}

/**
 * The object-tracking list. Index 0 is an unused sentinel (nonzero grid.take
 * means "object present"), matching borg_takes.
 */
export class BorgTakes {
  constructor(private readonly world?: BorgWorld) {}

  private readonly list: BorgTake[] = [makeBorgTake()];
  /** borg_takes_cnt: highest allocated index + 1. */
  count = 1;
  /** borg_takes_nxt: next slot to consider reusing. */
  next = 1;

  /** The record at index i (i >= 1). */
  at(i: number): BorgTake {
    return this.list[i]!;
  }

  /** True when index i holds a live record. */
  has(i: number): boolean {
    return i >= 1 && i < this.count && this.list[i]!.kIdx !== 0;
  }

  /** Allocate (or reuse) a slot and return its index. */
  alloc(): number {
    for (let i = 1; i < this.count; i++) {
      if (this.list[i]!.kIdx === 0) return i;
    }
    const i = this.count;
    this.list[i] = makeBorgTake();
    this.count += 1;
    return i;
  }

  /** Clear the record at index i (borg_delete_take). */
  delete(i: number): void {
    if (!this.has(i)) return;
    const take = this.list[i]!;
    if (this.world) {
      /* borg-flow-take.c:105-118 clears the grid and every take goal. */
      this.world.map.at(take.pos.x, take.pos.y).take = 0;
      if (this.world.self.goal.type === GOAL_TAKE) this.world.self.goal.type = 0;
    }
    this.list[i] = makeBorgTake();
  }

  /** Reset tracking slots; level changes zero records (borg-update.c:2192). */
  wipe(deleteRecords = true): void {
    /* borg-think-dungeon.c:1315-1321 deletes records before resetting slots. */
    if (deleteRecords) for (const [i] of this.entries()) this.delete(i);
    this.list.length = 1;
    this.list[0] = makeBorgTake();
    this.count = 1;
    this.next = 1;
  }

  /** Iterate live records with their indices. */
  *entries(): IterableIterator<[number, BorgTake]> {
    for (let i = 1; i < this.count; i++) {
      const t = this.list[i]!;
      if (t.kIdx !== 0) yield [i, t];
    }
  }
}
