/** Known wiring gaps. Factory defaults do not supply changing game state. */
export const WIRING_ALLOWLIST: readonly {
  name: string;
  kind: "bug" | "constant";
  reason: string;
  c: string;
}[] = [
  { name: "BI.IPOIS", kind: "constant", reason: "Upstream also leaves poison immunity zero; it has readers but no per-trait writer.", c: "borg-trait.c:2829 (blanket zeroing only); borg-danger.c:1209 (read)" },
  { name: "BI.ISENCUMB", kind: "constant", reason: "Upstream also leaves the encumbrance flag zero; weight changes speed without setting it.", c: "borg-trait.c:2829 (blanket zeroing only); borg-item-wear.c:836 (read)" },
  { name: "BI.ISFIXALL", kind: "constant", reason: "Upstream also leaves the all-stat repair flag zero and sets individual stat flags instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-recover.c:210 (read)" },
  { name: "BI.SAURON_DEAD", kind: "bug", reason: "AgentView and API 2 world/truth expose no race death counter or killed-unique record. Character history has display text without race identity, so it cannot supply Sauron's recorded death.", c: "borg-trait.c:3136" },
  { name: "BI.WK_DEMON", kind: "constant", reason: "Upstream also leaves the demon kill flag zero and writes the WS_DEMON slay trait instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-fight-attack.c:148 (read)" },
  { name: "BI.WK_DRAGON", kind: "constant", reason: "Upstream also leaves the dragon kill flag zero and writes the WS_DRAGON slay trait instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-fight-attack.c:149 (read)" },
  { name: "BI.WK_UNDEAD", kind: "constant", reason: "Upstream also leaves the undead kill flag zero and writes the WS_UNDEAD slay trait instead.", c: "borg-trait.c:2829 (blanket zeroing only); borg-fight-attack.c:147 (read)" },
  { name: "self.goal.fleeingLunal", kind: "constant", reason: "Lunal mode is deliberately disabled in think-ladder.ts, so its fleeing flag stays false.", c: "borg-think-dungeon.c:230 (disabled mode)" },
  { name: "self.goal.fleeingMunchkin", kind: "constant", reason: "Munchkin mode is deliberately disabled in think-ladder.ts, so its fleeing flag stays false.", c: "borg-think-dungeon.c:583 (disabled mode)" },
  { name: "self.lunalMode", kind: "constant", reason: "The port deliberately omits the optional lunal-mode entry block in think-ladder.ts.", c: "borg-think-dungeon.c:1476 (disabled mode)" },
  { name: "self.munchkinMode", kind: "constant", reason: "The port deliberately omits the optional munchkin-mode entry block in think-ladder.ts.", c: "borg-think-dungeon.c:1488 (disabled mode)" },
];
