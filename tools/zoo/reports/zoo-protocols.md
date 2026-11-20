# Zoo protocol receipts for standalone reproduction

The standalone runner saves the same game-level evidence without needing the zoo.
The original runs remain authoritative; this PR does not rerun their cohorts.

| Parameter | Last completed corrected-event report | New seeded-v2 cohort |
| --- | --- | --- |
| Run | [43617859717](https://github.com/diegoami/borg-zoo/actions/runs/43617859717) | [43670231534](https://github.com/diegoami/borg-zoo/actions/runs/43670231534) |
| Borg | `9c17cb0c582fe129008899491372787e91abdade` | `76f25aa70b912f12005ef3cd612e4133bd16c279` |
| Engine fork | `06a2321ce30a414df20d1b20d486446e7688171c` | `b4af703493d314aa35cb719604f06103aa4918f4` |
| Toolkit in the same fork | `02c33cf1871b86ea8e8d7bf8cbc870cf177b736b` | `2fd45fffe04b472286dbe0991a4320c5c9972c98` |
| Suite | `classes-1800` | `neo-seeded-v2-classes-1800` |
| Assigned games | 1,800; 200 per class | 1,800; 200 per class |
| Births | assigned race/class, default rolled stats | recommended C point buy / no-selling |
| Startup | historical game/Borg defaults | native-menu RNG, game-stream Borg seed, GCC coordinate adapter |
| Engine tick cap | 100,000, after-loop boundary | 100,000, exact tick observer |
| Per-game wall watchdog | 2,700 seconds | 600 seconds |
| Distributed execution | 180 shards, two processes/job, at most eight jobs | 36 shards, two processes/job, at most four jobs |
| Job ceiling | 300 minutes | 300 minutes |
| Full resumable controller saves | not collected | not collected |

The preset assignments are expanded using the pinned zoo catalogue rules: classes
cycle every seed, races once per nine-class round; SHA256-derived seeds reserve
all earlier catalogue assignments. The expanded lists are checked in here, so
catalogue changes cannot silently change the suite. Sources: zoo `35a139c`
(completed run) and `6fd7666` (seeded cohort). Original experiment definitions are
retained beside this file. All Borg/engine/toolkit pins above are from
`diegoami/neo-angband-borg-mod-tracker` / `diegoami/neo-angband-tracker`, not official
upstream commits. Their source repositories must be used to obtain those pins.

The [completed report](https://github.com/diegoami/borg-zoo/blob/e24de5b/reports/neo-9c17cb0-events-43617859717/README.md)
records **1,352 deaths, 415 caps, 32 stalls and one timeout**, all 1,800 assignments.
That is 75.11% deaths among assigned games and 76.51% among death-or-cap endpoints.
An earlier host did not deliver game messages to the Borg; its outcomes are kept
as historical measurements, not controls isolating source improvements.

The newer cohort was queued/running when its protocol was recorded. Its separate
18-game, 120-second acceptance retained 10 deaths, seven timeouts and one tunnel
stall. A distinct 600-second repeat completed the two advancing Warrior cases
(death at 65,338 and alive cap at 100,000); it did not relabel the old timeouts.
[Original protocol and receipts](https://github.com/diegoami/borg-zoo/blob/6e1a784/docs/neo-merged-seeded-v2/README.md).

For the historical rolled profile, build without adapters:

```sh
node tools/zoo/build.mjs --engine-dir ENGINE --borg-dir BORG --out BUILD
node tools/zoo/experiment.mjs --bundle BUILD/bundle.mjs \
  --suite tools/zoo/ci/suites/classes-1800.json --out RESULTS
```

For the newer profile use the three `true` build flags in the parent README.
A local worker pool changes resource scheduling; it retains every assignment.
Use the original pins/toolkit to reproduce old command hashes. Using this PR and
current upstream is an explicitly different arm even with identical inputs.
Historical C 619/1,800 and Neo 1,352/1,800 were not aligned in birth/options/host/RNG.
Neither those figures nor the newer profile establish complete C fidelity or a
causal survival improvement. The engine-clock difference was unresolved in these
protocols; record the actual engine commit for every new measurement.
