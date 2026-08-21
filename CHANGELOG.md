# Changelog

All notable changes to this mod are recorded here. Versions follow the mod's own
`manifest.json`, which is what the game reads, and each released version has a
matching git tag that an install pins itself to.

An entry has to matter to somebody running the mod. Documentation wording,
internal refactoring and test-only additions are not recorded here. Bug fixes
are, however small.

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
