# neo-angband-mod-borg

The Borg — an automatic player — for
[Neo Angband](https://github.com/neostryder/neo-angband), as a mod.

## Status: not released. This repository holds the name and the plan.

There is nothing to install here yet, and nothing here pretends otherwise. What exists
today is the engine half, in the main repository at `packages/borg`; what does not exist
is the mod that drives the game with it.

If you are looking for something to run, come back when this page lists a release.

## What it will be

Angband's borg plays the game on its own — descends, fights, shops, dies instructively.
In this project it is a **mod**, not part of the engine, and that division is decided
rather than incidental:

- **It is not core.** Putting an automatic player inside the parity target would put an
  AI control surface inside the thing being kept faithful to Angband 4.2.6. Upstream's
  borg is a compile-time option precisely because it is not the game.
- **It reaches the game through a published API**, the same one any third-party
  automation would use — perceive through the game state, act through the command
  queue. No private path, no test hook. If the borg can only be written against
  internals, then the modding API is not finished, and that is worth finding out.

That second point is the real reason it is worth building: it is the most demanding mod
anyone could write against this API, so it is the best available test of whether the API
is honest.

## Why the name is reserved now

Because names are first-come, and a mod that arrives later under a different name breaks
every link written before it. The repository is public and empty on purpose.

## Licence

Same dual licence as Neo Angband and Angband — GPL v2 or the Angband licence. See
[LICENSE.md](LICENSE.md).

## Credits

Angband is the work of Ben Harrison, James E. Wilson, Robert A. Koeneke and the Angband
contributors; the borg concept and its long history belong to them and to APWborg's
maintainers. This will be a fresh implementation for Neo Angband by neostryder / RPGM
Tools, not a port of theirs.
