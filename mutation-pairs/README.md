# Mutation pairs

A mutation pair asks one scenario two different questions. The original check pins a requirement that the reference Borg meets. The twin changes one number, condition, comparison, or exemption, and its check fails on the reference source. A small source patch makes the twin pass and the original fail.

The reference source is commit 7eb4b78, and the suite has 12 pairs. Each case creates a Borg through createBorg and the scenario harness, runs a controller decision, and checks a command or the resulting world state. Cases that isolate a decision rung call the controller's session and public subsystem entry points after that first decision. The fixture supplies light and food as policy inputs. These checks do not validate equipment-derived light.

The runner executes all four checks for every pair. Each patch gets its own copied tree under .scratch/, where the runner applies it with git apply. The copy shares the installed dependencies through a junction, and the runner removes it afterward, so the working src tree stays unchanged. An assertion failure counts as a failed check. Import errors, missing tests, and runtime exceptions abort the matrix. A valid pair produces pass/fail/pass/fail in the order original, twin, patched twin, patched original. Patch size is added lines plus removed lines, so a one-line replacement counts as two changed lines.

PowerShell 7 (pwsh):

```pwsh
node mutation-pairs/run-pairs.mjs
```

The runner prints its table and writes [RESULTS.md](RESULTS.md) and [results.json](results.json). It exits nonzero when an expectation breaks or the matrix is incomplete. The spread is the original pass rate minus the twin pass rate on the reference source, in percentage points. These results describe the suite's scenarios and do not measure an outside worker.

The default Vitest configuration runs every test except the mutation-pairs folder. Setting BORG_MUTATION_PAIRS=1 selects only the pair tests, and the runner sets it for its child processes. pnpm verify therefore excludes both the original and twin pair checks. The repository typecheck includes the pair tests and the fixture. Imports from pairs/<id>/ use ../../../src because the pair directories sit three levels below the repository root.

## Requirements

The C source root for every citation is D:/Repositories/neo-angband/reference/src/borg/. The table gives the function definition and the specific rule line; pair.json records both. Each twin.patch changes one source line and one requirement.

| ID | Area | C function (definition; rule) | Original requirement | Twin requirement |
| --- | --- | --- | --- | --- |
| 01-regional-fear | danger and fear | borg_check_rest (borg-flow-misc.c:1212; 1273) | Rest remains legal when regional fear equals floor(current HP / 20). | Rest becomes illegal when regional fear equals floor(current HP / 20). |
| 02-escape-stairs | retreat and escape | borg_escape_stair (borg-escape.c:520; 526) | A level-20 character standing on up stairs can escape by ascending. | A character can escape by ascending from up stairs only above level 20. |
| 03-recharge-rest | rest and recovery | borg_recover (borg-recover.c:59; 340) | A safe character rests 100 turns to recharge a recall rod. | A safe character rests 101 turns to recharge a recall rod. |
| 04-recall-uniques | recall and stairs | borg_recall (borg-escape.c:54; 97) | Recall keeps its old maximum depth of 99 when four uniques remain alive. | Recall can reset its maximum depth of 99 when four uniques remain alive. |
| 05-shopping-age | shopping and store choice | borg_choose_shop (borg-think-store.c:87; 97) | An existing purchase goal remains actionable at town level age 2000. | An existing purchase goal expires at town level age 2000. |
| 06-pickup-plusses | item pickup | borg_new_take (borg-flow-take.c:193; 268) | An item with zero to-hit and no negative plusses remains worth picking up on arrival. | An item with zero to-hit is rejected for pickup on arrival. |
| 07-junk-value | drop-junk | borg_drop_junk (borg-junk.c:248; 396) | At depth 5, known gear worth 16 is kept by the value threshold. | At depth 5, known gear worth 16 can be dropped when power is preserved. |
| 08-spell-practice | spell and device use | borg_play_magic (borg-magic-play.c:87; 164) | An untried spell is not practiced on dungeon depth 1. | An untried spell can be practiced on dungeon depth 1. |
| 09-town-attack | fight and attack choice | borg_play_step (borg-flow.c:619; 751) | A level-4 character avoids walking into a unique monster in town. | A level-4 character can walk into a unique monster in town. |
| 10-town-fear | town fear fix (#501) | borg_fear_grid (borg-update.c:614; 621) | A visible monster adds no monster-grid fear in town. | A visible monster can add monster-grid fear in town. |
| 11-stall-forget | stall check | borg_think_dungeon (borg-think-dungeon.c:1155; 1314) | The bouncing-Borg check forgets tracked floor objects at panel age 500. | The bouncing-Borg check starts forgetting tracked floor objects at panel age 501. |
| 12-chest-tolerance | chest rule | borg_play_step (borg-flow.c:619; 794) | A known trapped chest is disarmed when device skill minus trap strength equals 7. | A known trapped chest is disarmed only when device skill minus trap strength exceeds 7. |

## Fidelity and scope

The checks pin existing port behavior and add no production behavior. The recall pair checks the emitted scroll command and the queued depth answer. In the fear pair, recovery runs through the session's own rest policy. The shopping pair drives the store decision and checks the purchase or exit command that follows. To isolate the value cutoff, the junk pair supplies the existing power-preserving simulation seam.

The pickup pair traces to the negative-plusses valuation in borg_new_take. The C uses pickup_always, while the port emits a pickup command on arrival. The port also reads the plusses its view supplies instead of the C's object_fully_known gate. The chest pair uses the public trapKnown field. The spell pair runs in stock mode, where the C's munchkin exemption is inactive. The escape pair uses normal descent rules and does not test birth_force_descend.

The town fear pair covers the town exemption in borg_fear_grid from #501. It observes the resulting fear grid and checks an attack step, with its monster facts coming through the existing resolver seam. The stall pair covers the C bouncing-Borg object-forgetting timer at panel age 500. It does not cover the separate API 2 accepted-command stall counters, which have no direct C rule.

[SCORING.md](SCORING.md) describes how to evaluate outside workers.
