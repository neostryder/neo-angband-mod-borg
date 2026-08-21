# Planned: make the Borg actually play

**Opened 2026-08-21. Owner's target, verbatim: full functionality, validated by
several successful runs, where a successful run means it tries its best and gets
as far as it can.**

This file exists because the mod's tests are green, its port is faithful, and the
thing a player installs does not play properly. Nothing below is a bug in the
ported code. Every item is a seam that was built, documented and never connected,
which is a failure mode this project has now hit four times, so the shape is worth
naming: a capability that exists in the tree and not in the product.

## What is actually wrong

`plugin.ts` calls `createBorg()` with no argument. `src/controller.ts` then does
`buildThinkSession(opts.resolvers ?? {})`, and `src/think-session.ts` says in its
own header what an empty resolver set means: the four seams "default to faithful
conservative behavior (zero-magnitude danger, no activations, never in a shop, no
power gain from an unevaluated swap/buy/sell) so the Borg is correct-but-cautious
until a host wires real engine data."

**No host wires them.** So the shipped Borg plays with no danger perception, never
shops, never uses an activation, and cannot evaluate an equipment swap.

The resolver factory is not missing either. `src/resolvers.ts` already exports
`makeCoreResolvers`, which bridges core's `MonsterRace` records into the
`MonsterFacts` the ported `borg_danger` math needs, and its own comment says the
numbers "match upstream verbatim" once it is installed. It has never had a caller.

## Definition of done

Three claims, and the third is the one that decides it:

1. All four resolver seams are wired from real engine data, or a seam that cannot
   be is documented as unreachable with the reason.
2. There is a restart-on-death loop, because "plays itself over and over" is what
   was asked for and no loop exists anywhere in the mod.
3. **It has been WATCHED playing, in the installed build, over several runs**, and
   what it did is written down: what depth it reached, whether it fled, whether it
   shopped, whether it used an activation, how it died, and whether it started
   again. A green test suite is not this claim and cannot become it - the tests
   cover `borg_think` dispatch, ladder determinism and ladder priorities, and not
   one of them plays a turn.

Until 3 is done, nothing here says the Borg plays properly. See the README's own
Status section, which was narrowed on 2026-08-21 for exactly this reason.

## The work, in order

### 1. A route from the plugin to the bound registries

`makeCoreResolvers` needs `readonly MonsterRace[]`, the whole registry indexed by
`ridx`, because `FactsResolver` is `(ctx, killIndex) => MonsterFacts` and resolves
a race the Borg is tracking rather than one it is looking at.

The host's `ModPluginContext` (`packages/web/src/mod-plugin.ts`) carries `id`,
`api`, `engine`, `flags`, `core`, `state`, `assetUrl` and `data`. `controller()`
runs after `register()` and after boot, so the game is live by then - but
`GameState` carries the LIVE monsters (`state.monsters`, each with its own
`.race`), not the registry. A monster the Borg has not met has no entry there, so
walking the level is not a substitute.

So this is a host change first: give `ModPluginContext` the bound registries, or a
narrower accessor for the race registry. That decision belongs in the game
repository and it is the gate on everything below.

### 2. Wire the four seams and say which are real

Once the registries are reachable, `plugin.ts` becomes
`createBorg({ resolvers: makeCoreResolvers({ races }) })` - and then each of the
four has to be checked individually rather than assumed, because
`makeCoreResolvers` today wires the monster-race facts and leaves activation
identity and the in-shop signal on their conservative defaults, which its own
docstring says.

- **Monster facts** - `makeCoreResolvers` already does this. Needs a caller.
- **Activation identity** - the Borg cannot use an activation it cannot name.
- **In a shop** - the Borg never shops while this answers "no".
- **Power of an unevaluated swap/buy/sell** - the Borg cannot judge an item it has
  not been told the value of, so it hoards.

### 3. The restart loop

A death has to start a new character. This is what turns the mod into the thing
that was asked for on r/angband: something that plays itself over and over,
fullscreen, as a screensaver.

### 4. Watch it, several times, and write down what happened

Driven in the installed desktop build over CDP, because that is the only
instrument here that proves pixels and a running game rather than a populated data
structure. The main repository's `CLAUDE.md` has the procedure and the four traps.

## What is deliberately NOT here

Making the Borg WIN. The target is that it tries its best and gets as far as it
can, by the original's rules. Upstream's borg dies, and a port that dies the same
way for the same reasons is faithful; one that survives longer than upstream's
would is a different program wearing its name.
