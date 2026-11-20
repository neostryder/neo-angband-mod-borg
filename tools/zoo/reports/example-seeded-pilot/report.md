# Headless Borg death report: experiment-b354ae489f539654

Assigned: 2; recorded: 2. Every assignment is counted.

Profile: c-seeded-point-buy-v2; cap: 2000 game ticks; per-game watchdog: 600 seconds.

| Outcome | Count |
| --- | ---: |
| turn cap | 2 |

Deaths / assigned: 0/2 (0.00%). Deaths / death-or-cap endpoints: 0/2 (0.00%). All other outcomes remain in the assigned denominator.

## Deaths

| Seed | Race | Class | Turn | Level | Max depth | Cause |
| --- | --- | --- | ---: | ---: | ---: | --- |

## By class

| Class | Assigned | Deaths | Caps | Other outcomes |
| --- | ---: | ---: | ---: | ---: |
| Warrior | 1 | 0 | 1 | 0 |
| Mage | 1 | 0 | 1 | 0 |

Measured Borg settings (raw run records retain the full birth/options observations):

```json
{
  "borg.playsRisky": false,
  "borg.worshipsDamage": false,
  "borg.worshipsSpeed": false,
  "borg.worshipsHp": false,
  "borg.worshipsMana": false,
  "borg.worshipsAc": false,
  "borg.worshipsGold": false,
  "borg.selfScum": true,
  "borg.munchkinStart": false
}
```

## Measurement limits

Birth/profile and adapter choices are recorded in the suite and build identities. Seeded-v2 requests C recommended point buy/no-selling/native-menu and GCC coordinate adapters with an exact tick cap; ordinary-rolled-v1 uses engine-default rolled birth and the historical after-loop cap, which can overshoot. Engine behavior depends on the recorded commit; clock equivalence was unresolved in the historical measurements. These counts describe this cohort; they do not establish C parity or improvement over differently configured runs. Stalls, timeouts and harness/configuration failures remain separate outcomes.

## Source and bundle identities

- Engine: neostryder/neo-angband @ d27ed50f9e3b650a43cceda5a0c007d03cc321df; Borg: diegoami/neo-angband-borg-mod-tracker @ 5c3e09953423778eeebe95d8d0de738b313c8f62; bundle SHA256: 4d7a437662d4292c7d14696065cdc4baf03d38dfad8317dce8ef333eb30df4d6; adapters: c-native-menu-birth-and-borg-startup-v2, gcc14-native-rand-loc-y-before-x.
