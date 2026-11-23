# Standalone headless Borg experiments

Run the checked-out Borg source against an explicit engine checkout, without a
borg-zoo checkout, Python runner, catalogue service, or deployment. Node 26 and
pnpm are required. The host uses the game's API2 host, intent gate and real
message/event bus. Gameplay source and the committed plugin are unchanged.

## Install Node and pnpm

The build requires Node 26 and pnpm. If they are already installed, check
`node --version` before continuing. With an existing `npm`, this installs both
under your user directory without sudo:

```sh
npm install --prefix "$HOME/.local/share/neo-borg-tools" \
  node@26.13.1 pnpm@12.16.1
export PATH="$HOME/.local/share/neo-borg-tools/node_modules/.bin:$PATH"
node --version
pnpm --version
```

Keep using that terminal, or add the PATH export to your shell profile. pnpm may
select the engine's declared 12.3.4 or the Borg's declared 12.16.1 automatically;
leave each repository's packageManager and lockfile unchanged.

## Build and run

Start from a workspace directory. These commands create explicit sibling
checkouts named `borg` and `engine`; your existing tracker checkout can keep its
current name and is not modified. While upstream PR109 is open, the harness lives
on the fork branch shown below. After it lands upstream, the official mod
repository can be cloned into the same `borg` directory instead.

Build the clean engine checkout (Core, SDK and composed content), then the Borg.
Actual repositories, commits, content and bundle hashes are recorded. Use a full
SHA when choosing a version; keep the built bundle and pack with results.

```sh
git clone --branch task/standalone-experiments \
  https://github.com/diegoami/neo-angband-borg-mod-tracker.git borg
git clone https://github.com/neostryder/neo-angband.git engine
cd engine
git checkout d27ed50f9e3b650a43cceda5a0c007d03cc321df
pnpm install --frozen-lockfile
pnpm exec tsc -b packages/core packages/mod-sdk packages/content
cd ../borg
pnpm install --frozen-lockfile
node tools/zoo/build.mjs --engine-dir ../engine --borg-dir . --out /tmp/borg-build \
  --exact-tick-cap true --c-seed-startup true --c-gcc-coordinate-order true
pnpm experiment --bundle /tmp/borg-build/bundle.mjs --games 18 \
  --max-ticks 5000 --wall-seconds 120 --workers 2 --out /tmp/borg-experiment
```

### If the engine is already built, or you are in the tracker checkout

An older tracker/default checkout may not contain `tools/zoo/build.mjs` or the
`experiment` script yet. `Cannot find module .../tools/zoo/build.mjs` or
`Command "experiment" not found` means you need the proposed harness checkout;
installing dependencies in the old checkout does not add it. Leave that checkout
unchanged and create `borg` next to the existing `engine`:

```sh
cd ~/projects/angband &&
git clone --branch task/standalone-experiments \
  https://github.com/diegoami/neo-angband-borg-mod-tracker.git borg &&
cd borg &&
pnpm install --frozen-lockfile &&
node tools/zoo/build.mjs --engine-dir ../engine --borg-dir . \
  --out /tmp/borg-build --exact-tick-cap true \
  --c-seed-startup true --c-gcc-coordinate-order true &&
pnpm experiment --bundle /tmp/borg-build/bundle.mjs --games 18 \
  --max-ticks 5000 --wall-seconds 120 --workers 2 \
  --out /tmp/borg-experiment
```

Replace `~/projects/angband` with your workspace path. This assumes `borg` does
not already exist, the pinned `engine` is already built, and Node/pnpm are on
PATH as described above. If you already cloned this branch into `borg`, start
with `cd ~/projects/angband/borg` and continue at the install step. The `&&`
operators stop after the first failed step. Build and experiment output paths
must be new: choose fresh paths for another attempt rather than overwriting
previous evidence.

`--max-ticks` counts engine ticks, not controller decisions or wall seconds.
A normal player action usually uses ten ticks. Limits: 1–1,800 games,
1–200,000 ticks, 1–3,600 seconds per game, 1–8 isolated worker processes.
`--race 'Half-Elf' --class Mage` restricts custom births; otherwise all nine
classes are dealt in order and eleven races cycle once per class round.
`--seed` selects a deterministic custom seed namespace (default 3000).
Every numeric game seed and assigned birth is materialized in `suite.json`.
`--help` lists arguments. `--plan-only` writes the plan without starting games.

`--out` can be any new directory, including a mounted persistent volume. Existing
directories are refused, preserving previous attempts. Retain the entire output:

- `experiment.json`: UTC start, exact arguments, Node/platform, source-suite ID,
  worker count, suite and orchestration-tool SHA256 hashes, and full build provenance;
- `suite.json`: immutable effective assignments, birth protocol and limits;
- `runs/worker-N/INDEX-SEED/run/`: per-game `run.json`, command, message and state
  JSONL streams; stdout/stderr are alongside it. Streams survive watchdog kills;
- `report/report.md` and `report/report.json`: death and class tables, both
  assigned and death-or-cap death rates, all abnormal outcomes, source identities,
  recent death traces, and commands to reproduce individual seeds.

`--save-games true` additionally writes the engine's `birth.save.json` and
`final.save.json` for completed games. A watchdog retains the birth save and
partial traces; there may be no final save. These are diagnostic engine snapshots;
they do not capture the full controller continuation or promise identical resumed
Borg play. Deterministic replay starts a new game with the recorded inputs.

Deaths are measured endpoints, not a failed harness. Timeout, crash/configuration
failure and missing/duplicate assignments fail the command while retaining their
records and producing the report. Stalls and caps are reported separately; neither
is counted as a death. No outcome is silently excluded from the assigned count.

## Reproduce the zoo protocols

Two frozen 1,800-game assignment files are checked in. No seed generator or zoo
installation is needed to use them. Select fewer games or a lower tick cap for a
pilot; overrides get a distinct saved plan ID and never rewrite the source suite.

```sh
pnpm experiment --bundle /tmp/borg-build/bundle.mjs \
  --suite tools/zoo/ci/suites/neo-seeded-v2-classes-1800.json \
  --games 18 --max-ticks 2000 --workers 2 --out /tmp/seeded-pilot
# Full protocol (explicit, potentially several hours):
pnpm experiment --bundle /tmp/borg-build/bundle.mjs \
  --suite tools/zoo/ci/suites/neo-seeded-v2-classes-1800.json \
  --workers 8 --out /data/seeded-1800
```

[The protocol record](reports/zoo-protocols.md) records both the last completed
report and the newer seeded-v2 cohort, including source pins, watchdogs, class/race
allocation, parallelism and observed limitations. Current upstream source is a new
measurement arm: selecting the same seeds does not reproduce old code's outcomes.

The default `c-seeded-point-buy-v2` profile explicitly selects recommended C point
buy, no-selling, native-menu startup RNG order, game-stream Borg RNG initialization
and a GCC 14.2 coordinate-evaluation adapter. These are **FORK measurement
adapters**, applied only to the headless bundle and named in provenance. They do
not modify the checkout. Adapter-site mismatches fail the build. No engine clock
correction or hidden perception refresh is applied. The historical rolled profile
uses an unadapted build and the engine's defaults, with an after-loop cap that may
overshoot; it cannot be mixed with a seeded-v2 bundle.

## Validation and CI

`pnpm test:headless` exercises actual Core event delivery plus worker death,
watchdog, wrong-birth and crash controls, aggregation completeness, frozen
assignments and CLI argument/output preservation. `pnpm verify` keeps the normal
Borg typecheck/test/plugin gate. A separate workflow runs these harness controls
on PRs and offers manually requested headless runs with retained artifacts.
There is no scheduled cohort, write token or automatic issue publication.

## Cemetery-style reports and replay

Each new experiment also writes `report/index.html` and a death registry. In an
interactive terminal the command serves it on localhost and opens your browser. Filter by seed, race, class or cause;
each death links to a chronological account, inventory/equipment/learned-spell
observations, a known-map diagram, source identities and replay commands. The
Markdown landing page is `report/README.md`; raw evidence remains unchanged.

Generate the same report for an **existing** experiment without rerunning games:

```sh
pnpm report --experiment /tmp/borg-experiment --out /tmp/borg-cemetery-report

```

The output directory must be new. This works with earlier harness runs, including
your completed 18-game smoke. Older traces have sparse state samples and final
inventory; absent observations are explicitly unavailable. With `--record true`, new bundles record
known-state inventory, spells, nearby remembered terrain and HP/SP at least every
100 ticks at a command boundary, plus health/resource/depth changes and endpoints.
They do not record unlogged Borg thoughts or fabricate terminal screenshots.
The episode boundary is the last sustained high-HP observation, with threat data
explicitly unknown; it is a navigation heuristic, not proof of safety or cause.

Every death report contains the exact numeric seed and these two commands,
filled with that death's actual case ID and retained paths:

```sh
# Visible full-run replay in a local game viewer:
pnpm replay --experiment /tmp/borg-experiment --case INDEX-SEED \
  --bundle /tmp/borg-build/bundle.mjs --out /tmp/borg-visible-replay --mode watch
# Launch the ordinary Neo browser game with the recorded seed:
pnpm replay --experiment /tmp/borg-experiment --case INDEX-SEED \
  --engine-dir ../engine --out /tmp/borg-game-launch --mode game
```

For visible replay, open the printed local URL and press **Start full replay**.
The original engine/Borg bundle runs from birth. The viewer shows known-map and
HP/SP/depth observations, and checks the complete command hash, birth metadata,
settings, outcome and endpoint against the original. Only a matching completed
run is labelled verified. For older bundles, a derived display-observer copy is
made in the new output directory; the adapter and both bundle hashes are recorded,
and the original stays untouched. A mismatch stays unverified. This is a live
Core/Borg replay with a diagnostic map display, rather than Neo's normal UI.

Game mode launches **the actual Neo frontend**, not the custom viewer. It
exports a fresh turn-zero birth from the original seed/bundle, loads it into the
pinned engine, restores recorded startup options/RNG, and automatically starts
the exact recorded Borg plugin. Inventory, equipment, messages and monster panels
are enabled in this isolated session. Escape takes the keyboard back; Ctrl-C
closes the server. The engine checkout and content hashes are checked; missing
renderer support is built once from that checkout. No game source or existing
browser profile is rewritten. Browser and headless hosts can still make different
choices; the graphical run is not declared command-equivalent without checking.
Historical runs also retain their recorded monster-truth permission contract.

For your original two deaths, after switching to this follow-up branch:

```sh
borg_game_dir=$(mktemp -d /tmp/borg-crow-305119160-XXXXXX) &&
pnpm replay --experiment /tmp/borg-experiment --case 11-305119160 \
  --seed 305119160 --bundle /tmp/borg-build/bundle.mjs \
  --engine-dir ../engine --out "$borg_game_dir/game" --mode game
```

For the wild cat use case `2-1746645326` / seed `1746645326` with another fresh
output directory. Each generated death report contains its **complete** command,
including these original local paths and a `mktemp` step. No BUILD/NEW placeholders
are emitted for a retained experiment. The launcher opens your browser when available (or prints the local URL); `--open false` suppresses automatic opening. The game starts
at turn 0 and the Borg takes the keyboard automatically.

To reconstruct the last thirty actions of an older run for the written report:

```sh
pnpm report --experiment /tmp/borg-experiment \
  --out /tmp/borg-cemetery-report-v2 --reconstruct true
```

This performs diagnostic replays of at most twenty deaths, accepts frames only
when the full original command hash/birth/endpoint match, and leaves the original
statistics and records unchanged. The last-action display includes HP/SP/status,
inventory, game messages and actual recorded monster glyphs (`f` for the wild cat,
`B` for the crow). It is labelled reconstructed known-state data; the game-launch
command above is the path to the real full Neo screen. Unknown glyphs use `?`,
not a generic monster `M`.

Snapshots retained with `--save-games true` are linked when present, but no
near-boundary checkpoint or saved-position controller continuation is invented.
Screenshots/GIF capture, human alternatives and shared-save candidate trials are
not provided by this report generator. Replay runs are diagnostic continuations,
not additional independent births in the death statistics.

The report layout was informed by
[borg-cemetery](https://github.com/diegoami/borg-cemetery), inspected at
`42e0647fbbb08393b97128c78142c7759760fd9d`. This harness has no dependency on that repository or its Borgs.

## Review corrections and host provenance

The death-or-cap denominator includes both `turn_cap` and `decision_cap`.
Pinned-engine alignment and production truth-host controls run in the automated
engine-contracts job, in addition to lightweight host/report controls. The merged
fork PR101 truth-writer correction is carried here: new measurements synchronize
a durable capability-use receipt before monster/race truth is released; actual
map truth remains denied. Old pre-correction runs stay historical and are not
relabelled as browser-equivalent measurements.

The primary death-page command now starts the actual game at turn 0 and starts
the recorded Borg automatically; it does not ask you to navigate birth menus or
install a mod manually. It exports the recorded birth from the retained bundle,
uses the recorded plugin from Git, and applies a diagnostic boot adapter in memory
while serving the unchanged pinned Neo frontend. No engine source is rewritten.
This follows angband-recorder's pinned-runtime/fresh-start approach; the native C
recorder cannot be linked directly into the TypeScript engine. The separate
`watch` mode is still a diagnostic known-map viewer, not the normal game screen.

### Delay, pause and resume in the real game

Add `--autodelay 1000` for a 1000-millisecond interval between Borg controller
polls, and `--start-delay 5000` to leave the initial turn-zero screen visible for
five seconds before autoplay begins. These are wall-clock delays, not engine
ticks. Defaults are1000ms/1000ms; accepted ranges are0–10000ms and0–600000ms.

```sh
borg_game_dir=$(mktemp -d /tmp/borg-crow-305119160-XXXXXX) &&
pnpm replay --experiment /tmp/borg-experiment --case 11-305119160 \
  --seed 305119160 --bundle /tmp/borg-build/bundle.mjs --engine-dir ../engine \
  --out "$borg_game_dir/game" --mode game --autodelay 1000 --start-delay 5000
```

Escape stops the Borg. **Ctrl-Z resumes it** in this diagnostic session, using
the same running Borg object/private memory; it does not reload the game or
reseed it. Normal key handling and game rendering remain in the real frontend.
The resume hook is part of the isolated diagnostic boot adapter; the engine
checkout is unchanged. You can also press Ctrl-Z during the initial delay to
start immediately, which cancels the scheduled start.

The real-screen delay/pause/resume check can be repeated with the pinned
engine's Playwright installation (install its Chromium first if needed):

```sh
node tools/zoo/game-launch-browser-checks.mjs --engine-dir ../engine \
  --experiment /tmp/borg-experiment --case 11-305119160 \
  --bundle /tmp/borg-build/bundle.mjs --out /tmp/borg-browser-check
```

That check keeps the game at turn0 during its startup delay, verifies normal
Borg play, pauses with Escape, confirms the clock remains stopped, then resumes
with Ctrl-Z and saves a real frontend screenshot. It is optional and separate
from lightweight headless controls because it requires a browser installation.

### Start shortly before a recorded death

Every death page also includes a complete command with `--before-death 100`:

```sh
borg_game_dir=$(mktemp -d /tmp/borg-crow-near-death-XXXXXX) &&
pnpm replay --experiment /tmp/borg-experiment --case 11-305119160 \
  --seed 305119160 --bundle /tmp/borg-build/bundle.mjs --engine-dir ../engine \
  --out "$borg_game_dir/game" --mode game --before-death 100 --autodelay 1000
```

The requested target is death minus100 in the engine counter used by the report
(100 ticks is not necessarily100 player actions). The original run is replayed
with a read-only save observer; its full command hash/birth/outcome must match.
The latest command boundary at or before the target is retained, and the actual
start turn/lead are written to `checkpoint.json`. The real game loads that engine
state and RNG and starts a fresh Borg; original private Borg memory is not restored.
This is a saved-position experiment, not an assertion that the original controller
will make identical subsequent decisions. No later checkpoint silently skips the
danger, and no mismatch is accepted as a valid original checkpoint.

`--autodelay 0` now removes the intentional controller wait. The game's **base
delay factor** controls animation timing separately. Rendering, AI work and browser
scheduling still cost time; near-death launch avoids watching the entire birth run.

Diagnostic game launches run **one life only**. On death, the Borg stops and Neo
shows the ordinary death screen instead of automatically reincarnating. The
launcher sets the API2 controller's standard `onDeath: end` policy only for this
diagnostic session; the recorded plugin and engine source stay unchanged.

The default Borg autodelay is1000ms, also written explicitly in generated replay commands. An explicit `--autodelay` can still select another pace for a diagnostic check.

## Reports open automatically over localhost

When run in an interactive terminal, `pnpm experiment` and `pnpm report` now
start a local HTTP server and open the generated report in your browser. The
printed URL links to the death pages, animations, inventory and original raw
logs. Keep the command running; Ctrl-C stops the server. No public hosting or
extra Python server is required. CI/non-interactive exports finish normally.
Use `--serve false` for an interactive export without a server, or `--serve true`
to explicitly serve even when output is redirected; `--open false` suppresses
browser opening. `--port 8765` selects a fixed local port when desired.

Serve an existing report without generating it or replaying anything:

```sh
pnpm report:serve --dir /tmp/borg-death-reports-current-cyjz_dgo/report \
  --experiment /tmp/borg-experiment
```

The server binds only127.0.0.1 and exposes only the selected report and its
explicit raw-run tree. It does not expose all of/tmp or your repository. Your
original measurements are unchanged.

## Review corrections: cost, replay locations and locked runs

Full per-command frames and sampled inventory/spell observations are **off by
default**, including frozen survey suites and manual CI runs. Ordinary games do
not receive those callbacks, so they do not build a known-world snapshot on every
command or write the large observations stream. Commands, messages, sparse state
observations and the final known state remain available for statistics/reports.
Use `--record true` on `pnpm experiment` (or the single-game runner) only when
requesting that detailed capture. It adds measurable CPU and disk cost; it is not
a free survey default. Diagnostic `watch`/`capture` replays explicitly enable it.
You can reconstruct selected deaths afterward without counting them as new lives.

New experiment records include their working directory and normalized bundle
path. New builds record engine/Borg locations. Locally generated commands quote
absolute tool, bundle and engine paths and work from another directory. After
moving/downloading CI artifacts, regenerate the report with their new locations:

```sh
pnpm report --experiment /path/to/downloaded/experiment \
  --bundle /path/to/downloaded/build/bundle.mjs \
  --engine-dir /path/to/pinned/engine --out /tmp/relocated-death-report
```

CI exports explain relocation instead of presenting a runner-temp path as a
working local replay command. A legacy relative path without a recorded working
directory requires an explicit `--bundle`; the tool does not guess today's cwd.
The original generated entry can locate a legacy engine only if that checkout
still exists. No `../engine` assumption is made in regenerated death commands.

Pinned graphical launch refuses a measured dirty Borg or an unaudited dirty
engine build, and rejects current uncommitted/untracked engine inputs. New build
receipts distinguish the two pnpm-created SDK executable bits from source-content
changes and record that narrow exception explicitly. Some old artifacts contain
only `dirty: true` without enough detail to audit its origin: their original
bundle still supports verified **headless** replay, but a graphical source-based
run is not silently called pinned. An explicit `--allow-unpinned true` permits an
unverified graphical diagnostic, clearly labelled in its console/title/receipt;
it does not weaken the current-engine content checks or claim equivalence.

Under the shared validation lock, default interactive serving is suppressed so
the completed heavy command exits and releases the lock. Export with
`--serve false` when scripting or when using another lock mechanism, then run
`pnpm report:serve` outside the lock. Ordinary unlocked interactive report commands
still serve/open automatically. An explicit `--serve true` under the detected validation lock is rejected; serve
the exported directory after releasing it.
