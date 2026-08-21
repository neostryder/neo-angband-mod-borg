# neo-angband-mod-borg

The Borg (Angband's automatic player) for
[Neo Angband](https://github.com/neostryder/neo-angband), as a mod.

Install it from the game's **Install a mod...** row. Enabling the mod does **not**
hand it your character: switch on *Let the Borg play* and it takes the keyboard
from the next turn.

## What it is

A faithful port of Angband 4.2.6's `borg/`: the same priority ladder, the same
danger model, the same power scoring, by the original's rules rather than by a
fresh set of heuristics that merely look similar.

> ### What is ported and what is CONNECTED are not the same thing
>
> Measured 2026-08-21, stated here rather than left for you to find, and **being
> closed one seam at a time**. All of the above is true of the code in `src/`.
> Not all of it is yet true of the mod you install, because `plugin.ts` builds
> the Borg from host-supplied resolvers and only some of them exist.
>
> **Wired (2026-08-21): danger vision, activation identity, the in-shop signal.**
> The plugin reads the game's bound registries from `ctx.registries` and the
> live state from `ctx.state`, and builds real resolvers from them: `borg_danger`
> runs on actual blows, spell frequencies and race flags rather than on zeroes,
> the Borg can tell whether a worn item grants the activation it wants and
> whether it is charged, and it knows which shop it is standing in. **A mod's
> monsters and items are covered on exactly the same terms as core's**: every
> registry is bound after mods compose their content, and each resolver reads it
> by index (`ridx`, `tval`/`sval`, ego and artifact name) without consulting
> provenance, so content a mod added is treated identically to core's.
>
> **Still on the conservative default: the power of an unevaluated swap, buy or
> sell.** The Borg still hoards, because valuing a hypothetical loadout needs the
> engine to re-derive `PlayerView`-level facts (speed, AC, skills) for gear it is
> not actually wearing, and the frozen view can only ever answer for the gear you
> have on - there is no "what if" version of it to read. This is a host-and-core
> change, not a wiring one, and it is the one seam of the four still open. The
> Borg also **does not start a new character when it dies**, which is the single
> most requested behaviour and a separate piece of work from the resolver seams.
>
> The target is full functionality watched over several runs, and the remaining
> work is written down in [PLANNED.md](PLANNED.md). Until it is done, do not take
> a green test suite for evidence: the suite covers dispatch, ladder ordering and
> now the resolver wiring itself, and not one test in it plays a game to its end.

It is a **mod**, not part of the engine, and that division is decided rather than
incidental:

- **It is not core.** Putting an automatic player inside the parity target would
  put an AI control surface inside the thing being kept faithful to Angband 4.2.6.
  Upstream's borg is a compile-time option precisely because it is not the game.
- **It reaches the game through a published API**, the same one any third-party
  automation would use: perceive through a read-only view of the game state, act
  through the command queue. No private path, no test hook. If the borg could only
  be written against internals, then the modding API would not be finished, and
  that is worth finding out.

That second point is the real reason it is worth having: it is the most demanding
mod anyone could write against this API, so it is the best available test of
whether the API is honest. Two of the things found while wiring it up were engine
bugs rather than Borg bugs.

## Two things it does not do

- **It cannot cheat.** Upstream's borg reads the game's own structures directly
  (its comments call these "cheats") and scrapes the terminal for the rest. This
  one sees exactly what the perceive facade grants it, and acts only through
  commands a player could issue.
- **It does not flag your save.** The Borg is deterministic: it draws only its own
  seeded generator and never the game's, so a Borg game stays replayable. An
  autoplayer that used a wall clock or a network would trip the save's determinism
  ratchet, and would have to declare that in its manifest.

Only one autoplayer can hold the keyboard at a time. If another agent mod already
has it, this one is refused by name rather than silently taking over.

## Layout

    manifest.json    what the game reads: id, engine range, capabilities, toggles
    plugin.js        the built artefact the game fetches and hashes; committed
    plugin.ts        the entry point: takes ctx.core, returns a controller
    src/             the port itself

`src/core-api.ts` is worth reading before anything else under `src/`: it is the
one place the Borg touches the engine at runtime, and its header explains the
single rule that arrangement imposes on every other file.

## Building and testing

    npm ci
    npm run verify     # typecheck, test, and prove plugin.js is a current build

`plugin.js` is committed, because an install fetches it from a pinned tag and runs it
as it is; nothing rebuilds it on the way in. So a stale artefact passes every other
check and is the file players actually run. `npm run check` is what stops that.

The suite runs the port **and** drives the built `plugin.js`, which is a different
artefact: the engine arrives through ESM live bindings, and whether those survive
bundling is a separate question from whether they work in TypeScript.

To develop against an unreleased engine:

    NEO_ANGBAND_LOCAL_CORE=1 npm test

## Questions, or something wrong

[**The RPGM Tools Discord**](https://discord.gg/YegtwbHTBQ) is the fastest way
to ask anything - whether a behaviour is intended, how to get this installed,
or what you should try next. No GitHub account needed.

[Open an issue here](../../issues/new/choose) for a bug in **this mod**. Two
things belong against the game instead, and the forms will point you there: the
mod **system** (an install that fails, a load order that will not stick, a
conflict report that looks wrong), and the game **not matching Angband 4.2.6**
once this mod is switched off - changing the game is what a mod is for.

For anything that should not be public, including a security report:
**strider-angband (at) rpgm.tools**. See
[SECURITY.md](https://github.com/neostryder/neo-angband/blob/master/SECURITY.md).

Asking about AI use in this project? [AI_USAGE_POLICY.md](https://github.com/neostryder/neo-angband/blob/master/AI_USAGE_POLICY.md)
in the main repository is the complete answer.

## Licence

Same dual licence as Neo Angband and Angband: GPL v2 or the Angband licence. See
[LICENSE.md](LICENSE.md).

## Credits

Angband is the work of Ben Harrison, James E. Wilson, Robert A. Koeneke and the
Angband contributors. The borg is Ben Harrison's, extensively developed by Dr
Andrew White and maintained since by the Angband contributors; this is a port of
**their** work to TypeScript, not a new autoplayer that resembles it. Where it
differs from 4.2.6 it says so in the source, beside the C function it came from.
The port is by neostryder / RPGM Tools.
