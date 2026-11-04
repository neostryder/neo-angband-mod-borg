import { describe, expect, it } from "vitest";
import { BorgKills } from "./kill.js";

describe("BorgKills, read as the C's fixed borg_kills array", () => {
  it("reads a slot the wipe dropped as an empty record, not undefined", () => {
    /* borg-flow.c:738-742 reads &borg_kills[ag->kill] and abandons the step
     * on r_idx == 0. The C array is fixed, so a wiped slot is a zeroed
     * record; a goal grid still naming it must read empty, not crash. */
    const kills = new BorgKills();
    const i = kills.alloc();
    kills.at(i).rIdx = 7;
    kills.wipe();
    expect(kills.at(i).rIdx).toBe(0);
    expect(kills.has(i)).toBe(false);
  });

  it("reads a slot never allocated as an empty record too", () => {
    const kills = new BorgKills();
    expect(kills.at(42).rIdx).toBe(0);
  });
});
