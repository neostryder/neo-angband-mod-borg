/** FORK #100: main.ts's durable truth-use gate, backed by this run's
 * synchronous evidence journal instead of a browser save slot. No map grant. */
export function installTruthHost({ state, grants, identity, record, consent }) {
  if (!identity?.id || !identity.version || !identity.digest || !identity.installation)
    throw new Error("Truth host requires the measured bundle identity");
  const manifest = {};
  let active = true;
  const recorded = new Set();
  consent.setTruthSaveWriter((id, capability, current) => {
    if (!active || current !== state || id !== identity.id ||
        capability !== "state:monsters-actual.read" || !grants.has(capability)) return false;
    if (recorded.has(capability)) return true;
    consent.recordTruthUse(manifest, state.actor.player, identity, capability,
      { turn: state.turn, depth: state.chunk.depth });
    // The engine catches a failed write and refuses the read. Retry is possible;
    // never mark it recorded before the journal has accepted the receipt.
    record({ kind: "truth-use", turn: state.turn, depth: state.chunk.depth,
      playerNoscore: state.actor.player.noscore, manifest: structuredClone(manifest) });
    recorded.add(capability);
    return true;
  });
  return { manifest, dispose() { active = false; consent.setTruthSaveWriter(undefined); } };
}
