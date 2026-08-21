# Changelog

All notable changes to this mod are recorded here. Versions follow the mod's own
`manifest.json`, which is what the game reads, and each released version has a
matching git tag that an install pins itself to.

An entry has to matter to somebody running the mod. Documentation wording,
internal refactoring and test-only additions are not recorded here. Bug fixes
are, however small.

## 0.6.3

### Fixed

- **The README claimed more than the mod does, and a player reads it before
  deciding to install.** `plugin.js` is byte-identical to 0.6.2, and this is a
  release rather than a commit because the README ships inside the payload the
  game fetches at a tag: a correction that stays on `master` is a correction
  nobody installing this can see.

  What it now says is what was measured. Watched in the released 0.25.0 desktop
  build over two characters, the Borg took the keyboard, shopped, wore what it
  bought, found the town's down staircase and descended - and then stalled on the
  first dungeon level both times without dying, so it never started a new
  character. Two of the three stalls are this mod's and one is the game's. All
  three are named, with their mechanisms and their owners, in `PLANNED.md`.

## 0.6.2

### Fixed

- **The Borg threw on its first perceived turn, and the game blamed itself.** The
  manifest declared one capability, `command:add`, and the frozen `AgentView` is
  gated per DOMAIN: reading the player without `state:player.read` raises
  `AgentCapabilityError`. So the mod installed cleanly, logged that it had the
  keyboard and all four resolver seams, and then threw the moment it looked at
  the character. The manifest now declares the nine read domains the port
  actually uses: player, monsters, map, inventory, floor, messages, stores,
  spells and constants. It asks for no `state:*.read` wildcard, so the consent
  screen still names what it reads.

  Three things made this survive to a release, and all three are worth knowing.
  The install-time check wants `command:add` alone, so nothing refused it. The
  throw unwound out of the game loop, which reports a fault with no mod attached
  to it, so a player was told the GAME had hit a bug and pointed at the game's
  issue tracker; the session also stopped saving, and the autoplayer's own clock
  kept ticking and re-throwing behind a notice that is shown once. And no test
  here could see it: every test drives the port through a fake view with no
  capability gate, so the suite was green.

  `src/manifest-capabilities.test.ts` now derives the required set from the
  source - it scans for the accessors the port calls, maps each to the domain the
  engine gates it on, and requires the manifest to declare exactly that set. It
  also fails when a newer engine adds an accessor nothing has classified.

- Found by installing 0.6.1 from its tag into the released 0.25.0 desktop build
  and watching it, which is the only instrument that could have found it.

## 0.6.1

### Changed

- **This version requires Neo Angband 0.25.0 or newer.** `manifest.json`'s engine
  range moves from `>=0.12.0` to `>=0.25.0`, and for a mod that ships code an
  out-of-range engine is a refusal rather than a warning: an older game declines
  to load this and says why, instead of loading a Borg with two of its parts
  missing. Both of those parts are what make it an autoplayer rather than a
  library. The restart-on-death loop arrived in 0.25.0, and playing itself over
  and over is the entire point of a Borg. `AgentView.simulateLoadout` arrived in
  0.25.0, and without it the Borg wears nothing it finds, buys nothing it needs
  and sells nothing it is finished with. No earlier version of this mod ran a
  working autoplayer on any engine, so a hard floor breaks no installation that
  was playing properly.
- The plugin no longer probes for that capability, and no longer has a degraded
  path to fall back to. It reads `ctx.registries` and `ctx.state` as facts it is
  entitled to, wires all four resolver seams from them unconditionally, and
  refuses a context missing either one by name rather than playing on blind. That
  refusal cannot be reached through the game's own loader, which rejects an
  out-of-range engine before it imports a mod's code. It is there because the
  alternative failure is silent: a Borg with no resolvers still issues a legal
  command every turn and looks exactly like a Borg making bad choices.
- `makeCoreResolvers` no longer takes a `loadout` input. The seam is installed
  unconditionally, and the null it can still answer with is a property of the view
  it is handed rather than of the engine version.

### Fixed

- The README said the Borg "does not flag your save". Handing the keyboard over
  sets the save's `NOSCORE_BORG` flag, which keeps the character off the
  high-score table for the rest of its life, so the sentence was answering a
  narrower question (determinism) with a wider claim. Both facts are now stated
  separately: the Borg costs nothing in reproducibility, and it does mark the
  character. That mark is upstream's own behaviour and it cannot be cleared, which
  is exactly the sort of thing a player should not discover from the score screen.
- The README said the Borg does not start a new character when it dies. It does,
  and from this version that is a requirement rather than a bonus. **The
  restart-on-death loop is entirely the engine's**, and needed no code here: a
  controller can only return a `PlayerCommand`, and birth has no representation in
  that set, so there is nothing this mod could return that means "roll me a new
  character". The game's own death handler reincarnates the player in place
  whenever a mod holds the keyboard - same session, same save slot, a rolled race
  and class each time.

## 0.6.0

### Added

- **The Borg evaluates gear it is not wearing**, the fourth and last
  `BorgResolvers` seam from `PLANNED.md`. `borg_wear_stuff`,
  `borg_think_shop_buy_useful` and `borg_think_shop_sell_useless` all decide by
  comparing `borg.power` now against `borg.power` with a candidate worn, bought
  or sold, and every one of them was reading a default that reported no gain from
  anything. So the Borg wore nothing it picked up, bought nothing it needed and
  sold nothing it was finished with, on any host.
- `makeCoreResolvers` takes a fourth input, `loadout`. It is a capability rather
  than a datum: scoring a loadout the character is not in means re-running the
  engine's own `calc_bonuses` over a hypothetical set of worn objects, which only
  the engine can do. Neo Angband 0.25.0 adds `AgentView.simulateLoadout` for
  exactly that, and `plugin.ts` probes for it rather than assuming it.
- `borgSimulatePower` (`src/trait/simulate.ts`) runs the ported `borg_notice` and
  `borg_power` over the loadout the engine describes, which is the same wield /
  recompute / revert shape upstream uses. It scores against a scratch copy of the
  self-model, so evaluating a dozen candidates in one turn leaves the Borg's own
  view of itself untouched.
- **A mod's items are evaluated on exactly the same terms as core's.** The
  simulated loadout arrives as ordinary `ItemView`s and the ported scoring reads
  their properties, never their provenance. A test pins that, the same way the
  monster-facts test does.

### Changed

- On an engine older than 0.25.0 the swap / buy / sell seam stays on its
  conservative default and the Borg's log says "no loadout evaluation" instead of
  "loadout evaluation". The engine range stays permissive (`>=0.12.0`): a mod that
  can still do most of its job should not refuse to load.
- The two SWAP valuations (`weapon_swap_value`, `armour_swap_value`) are
  deliberately left unwired. This port has no swap subsystem, so both contribute
  zero to `borg_power` and an evaluator would compare two numbers that are equal
  by construction. Recorded as unreachable rather than pending.

## 0.5.0

### Added

- **Activation identity and the in-shop signal**, two of the three remaining
  `BorgResolvers` seams from `PLANNED.md`. `makeCoreResolvers` now also takes
  `objects` (`ctx.registries.objects`) and `state` (`ctx.state`), each
  independently optional so an older host still gets whichever seams it can
  supply data for.
- The Borg can now tell whether a worn item grants a named activation and
  whether it is charged (`borg_equips_item` / `borg_activate_item`), by walking
  the item's artifact, ego or kind back to the `Activation` record that grants
  it - the same precedence `obj-make.c` applies when the object was created. A
  mod's ego or artifact is resolved by the same lookup as core's.
- The Borg can now tell which shop it is standing in (`square_shopnum`), which
  is what lets the town-flow ladder's shop-interaction steps actually fire.
  Reads `ctx.state` directly; needed no new host plumbing, because a level's
  `Chunk` already carries the bound feature registry it was generated with.
- Still open: the power of an unevaluated swap, buy or sell, which needs a core
  capability (hypothetical player-state simulation) that does not exist yet.
  See `PLANNED.md`.

## 0.4.1

### Fixed

- The build section said the game's catalogue pins this mod's SHA-256. The game
  ships no catalogue. An install fetches the committed `plugin.js` from a pinned
  tag and runs it as it is, and nothing rebuilds it on the way in, so a stale
  artefact passes every other check and is the file players run. The reason to
  keep `plugin.js` committed is unchanged; the mechanism named for it was wrong.
- The builder's own documentation had its resolution order backwards, describing
  a sibling checkout of the game as preferred. `npm ci` is the whole setup, and
  the checkout is an override for developing against an engine change that has
  not reached the registry yet.

### Changed

- Tested against engine 0.24.0 rather than 0.13.0.
- `plugin.js` is byte-identical to 0.4.0, so an installed copy plays identically.

## 0.4.0 - 2026-08-20

### Added

- **The Borg can see danger.** `plugin.ts` built the Borg with no resolvers, so
  every seam fell back to its conservative default, and the one that mattered was
  the facts resolver: zero blows and zero spell frequency meant `borg_danger`
  reported no threat, so nothing was ever worth fleeing from. It now binds the
  host's monster race registry, which is what `borg_danger` needs to reason about
  a monster it is tracking rather than one it can currently see.
- **A mod's monsters are dangerous on the same terms as core's.** Binding happens
  after mods compose, so a modded creature is an ordinary monster race at a real
  index and the resolver never asks where it came from. A test pins that, so the
  behaviour cannot be narrowed to core content later by accident.
- On a host with no registry the Borg still plays and writes "playing blind" to
  its log. A Borg playing badly and a Borg handed no monster data look identical
  from outside and have completely different causes, so it says which it is.

### Changed

- Three of the four resolver seams are still on their defaults: no activations,
  never in a shop, and no power credited for an item whose value it has not been
  told. The README now names which seams are live and which are not.

### Requires

- A game carrying `ctx.registries`, which is Neo Angband 0.23.0 or newer. On
  anything older the mod loads and plays without danger vision rather than
  refusing to load, because a mod that can still do most of its job should not
  lock a player out of the rest of it.

## 0.3.1 - 2026-08-15

### Fixed

- Line endings normalised to LF and pinned with `.gitattributes`. Seven files
  were CRLF in the index while the rest of the repository was LF, and nothing
  stopped a Windows checkout drifting back.

## 0.3.0 - 2026-08-06

### Added

- `manifest.json` declares its `repository`. This is the field an import reads:
  install the mod from a `.zip` and the copy on disk pins itself to the
  repository its own manifest names. Without it an imported copy binds to
  `file:import`, and the update check has no repository to ask, so the one
  install route that does not start at a repository produced the one copy that
  could never be updated.

### Changed

- `author` is `neostryder` rather than `neostryder (RPGM Tools)`. The mod list
  already trimmed the parenthesis, and the detail pane printed the full string,
  where it read as two names for one person.

## 0.2.0 - 2026-08-01

### Changed

- The description is rewritten as short paragraphs. The previous one was long
  enough to squeeze the mod manager's list down to a single visible row with no
  way to scroll it. Nothing about what the mod does changed. The manager's own
  half of that problem is fixed in the game: the pane is capped, and a "Read the
  full description" row opens the whole thing in a viewer that scrolls.

## 0.1.0 - 2026-08-01

### Added

- **The Borg arrives and can be played.** Angband 4.2.6's `borg/` ported to 86
  files, driving the game through the published perceive and act API rather than
  through engine internals. It takes the keyboard only when "Let the Borg play"
  is switched on, and it draws from its own seeded generator, so handing it a
  character does not flag the save as non-reproducible.
- Written against the same API a third-party automation would use, deliberately.
  It is the most demanding mod anyone could write against that API, so if the
  Borg cannot be written without reaching into internals then the modding API is
  not finished.

### Fixed

- Two things had to be repaired before it ran at all. The per-think reseed went
  through the savefile path, which forces quick mode off and leaves an all-zero
  generator table, and an all-zero table emits zero forever; that was fixed in
  the engine at 0.13.0. Its two hanging test files were also excluded from CI, so
  `think()` had never been executed by anything.
- The plugin no longer bundles the engine. A bundled copy would give the plugin
  its own registries while the game ran on another set, so every non-relative
  import is external and the build refuses a survivor. The six symbols that were
  the whole runtime coupling arrive as live bindings filled from `ctx.core`.

## 0.0.0 - 2026-07-30

- The repository reserved the name and carried the plan. Nothing was installable,
  and the README said so rather than reading like a release.
