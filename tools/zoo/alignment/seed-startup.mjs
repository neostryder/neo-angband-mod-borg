// FORK measurement startup: perform the pinned native harness's actual birth
// menu operations. Do not pad or reset the RNG to an observed state.
export const C_SEEDED_PROFILE_ID = 'c-seeded-point-buy-v2';
export function nativeMenuBirth(core, pack, rng, raceName, observe = () => {}) {
  const players = core.bindPlayer(pack.player);
  const human = players.raceByName('Human');
  const chosen = players.raceByName(raceName);
  if (!human || !chosen) throw new Error('Missing native menu birth race');
  let accepted;
  for (const [stage, race] of [['birth-init', human], ['birth-reset', human], ['choose-race', chosen], ['choose-class', chosen]]) {
    observe(stage + '-before', rng);
    const ahw = core.rollAhw(race, rng);
    const history = core.generateHistory(players.historyChart(race), rng);
    accepted = { ahw, history };
    observe(stage + '-after', rng);
  }
  return accepted;
}
