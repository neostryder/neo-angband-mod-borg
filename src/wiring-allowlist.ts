/** Known wiring gaps. Factory defaults do not supply changing game state. */
export const WIRING_ALLOWLIST: readonly {
  name: string;
  kind: "bug" | "constant";
  reason: string;
  c: string;
}[] = [
  { name: "BI.ALL_NEED_ID", kind: "bug", reason: "The port never counts unidentified equipment or inventory for identification scoring.", c: "borg-trait.c:1436, borg-trait.c:2228" },
  { name: "BI.EMPTY", kind: "bug", reason: "The port never counts empty pack slots for the inventory power bonus.", c: "borg-trait.c:2211" },
  { name: "BI.FOOD_CURE_BLIND", kind: "bug", reason: "The port never counts food effects that cure blindness.", c: "borg-trait.c:2322" },
  { name: "BI.FOOD_CURE_CONF", kind: "bug", reason: "The port never counts food effects that cure confusion.", c: "borg-trait.c:2320" },
  { name: "BI.IPOIS", kind: "constant", reason: "Upstream also leaves poison immunity zero; it has readers but no per-trait writer.", c: "borg-trait.c:2829 (blanket zeroing only); borg-danger.c:1209 (read)" },
  { name: "BI.ISENCUMB", kind: "constant", reason: "Upstream also leaves the encumbrance flag zero; weight changes speed without setting it.", c: "borg-trait.c:2829 (blanket zeroing only); borg-item-wear.c:836 (read)" },
  { name: "BI.ISFIXALL", kind: "constant", reason: "Upstream also leaves the all-stat repair flag zero and sets individual stat flags instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-recover.c:210 (read)" },
  { name: "BI.NEED_BRAND_WEAPON", kind: "bug", reason: "The port never counts ammunition needing a brand; its branding action is also a stub.", c: "borg-trait.c:1173, borg-trait.c:1211" },
  { name: "BI.SAURON_DEAD", kind: "bug", reason: "The port never copies Sauron's recorded death into the trait used by power and shopping.", c: "borg-trait.c:3136" },
  { name: "BI.WK_DEMON", kind: "constant", reason: "Upstream also leaves the demon kill flag zero and writes the WS_DEMON slay trait instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-fight-attack.c:148 (read)" },
  { name: "BI.WK_DRAGON", kind: "constant", reason: "Upstream also leaves the dragon kill flag zero and writes the WS_DRAGON slay trait instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-fight-attack.c:149 (read)" },
  { name: "BI.WK_UNDEAD", kind: "constant", reason: "Upstream also leaves the undead kill flag zero and writes the WS_UNDEAD slay trait instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-fight-attack.c:147 (read)" },
  { name: "BI.WORN_NEED_ID", kind: "bug", reason: "The port never counts unidentified worn gear for the equipment power bonus.", c: "borg-trait.c:1437" },
  { name: "facts.vaultOnLevel", kind: "bug", reason: "The port never marks a vault after perceiving interior permanent walls.", c: "borg-update.c:420" },
  { name: "self.goal.doBest", kind: "bug", reason: "The port never requests the best home loadout when the best-item list is cleared.", c: "borg-item-wear.c:1441" },
  { name: "self.goal.fleeingLunal", kind: "constant", reason: "Lunal mode is deliberately disabled in think-ladder.ts, so its fleeing flag stays false.", c: "borg-think-dungeon.c:230 (disabled mode)" },
  { name: "self.goal.fleeingMunchkin", kind: "constant", reason: "Munchkin mode is deliberately disabled in think-ladder.ts, so its fleeing flag stays false.", c: "borg-think-dungeon.c:583 (disabled mode)" },
  { name: "self.lunalMode", kind: "constant", reason: "The port deliberately omits the optional lunal-mode entry block in think-ladder.ts.", c: "borg-think-dungeon.c:1476 (disabled mode)" },
  { name: "self.munchkinMode", kind: "constant", reason: "The port deliberately omits the optional munchkin-mode entry block in think-ladder.ts.", c: "borg-think-dungeon.c:1488 (disabled mode)" },
  { name: "self.oldchp", kind: "bug", reason: "The port never saves current HP for the next turn's unseen-spell damage estimate.", c: "borg-update.c:3029" },
];
