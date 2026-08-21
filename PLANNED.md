# Planned: make the Borg actually play

**Opened 2026-08-21. Owner's target, verbatim: full functionality, validated by
several successful runs, where a successful run means it tries its best and gets
as far as it can.**

This file exists because the mod's tests are green, its port is faithful, and the
thing a player installs does not play properly. Nothing below is a bug in the
ported code. Every item is a seam that was built, documented and never connected,
which is a failure mode this project has now hit four times, so the shape is worth
naming: a capability that exists in the tree and not in the product.

## What was actually wrong

**Written 2026-08-21 before any of it was fixed, and kept in the past tense rather
than deleted: the diagnosis is the useful part, and a file that erases what was
wrong as soon as it is fixed teaches nobody the shape of the failure.** The first
item below is now closed; see Progress.

`plugin.ts` called `createBorg()` with no argument. `src/controller.ts` then does
`buildThinkSession(opts.resolvers ?? {})`, and `src/think-session.ts` says in its
own header what an empty resolver set means: the four seams "default to faithful
conservative behavior (zero-magnitude danger, no activations, never in a shop, no
power gain from an unevaluated swap/buy/sell) so the Borg is correct-but-cautious
until a host wires real engine data."

**No host wired any of them.** So the shipped Borg played with no danger
perception, never shopped, never used an activation, and could not evaluate an
equipment swap.

The resolver factory was not missing either. `src/resolvers.ts` has always
exported `makeCoreResolvers`, which bridges core's `MonsterRace` records into the
`MonsterFacts` the ported `borg_danger` math needs, and its own comment says the
numbers "match upstream verbatim" once it is installed. **It had never had a
caller**, for a reason worth keeping: the thing it needed was not in the mod at
all. Nothing here could have fixed it.

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

## Progress

| Date | What landed |
|---|---|
| 2026-08-21 | **Step 1 done.** The host gained `ctx.registries` (the whole bound `CoreRegistries`, latched once at boot in `main.ts` and reaching every plugin context). `plugin.ts` now calls `createBorg({ resolvers: makeCoreResolvers({ races }) })`, so `makeCoreResolvers` has a caller for the first time. The Borg has danger vision, including over monsters a mod added. Three tests assert the wiring rather than the dispatch, one of them against the built `plugin.js`. |

## Releasing this

**0.4.0 IS TAGGED, released with Neo Angband 0.23.0 (2026-08-20).** It was held
back for a few hours first, and the reason is worth keeping: the game installs a
mod from a TAG and a tag must never be moved, so tagging is the release event and
the version field is not. Danger vision needs a host that supplies
`ctx.registries`, and until 0.23.0 shipped, no released game had it - a tag before
that would have pinned a digest on a change inert on every game a player could
actually be running.

**The engine range stays permissive (`>=0.12.0`) rather than moving to
`>=0.23.0`,** which is a deliberate difference from how neo-linoleum 0.15.0 handled
the same dependency. The Borg degrades: on an older host `ctx.registries` is
absent, `createBorg()` takes its conservative defaults, and the plugin says
"playing blind" in its own log. neo-linoleum's fill has no such fallback, so it
refuses the older game outright. A mod that can still do most of its job should
not refuse to load.

## The work, in order

### 1. A route from the plugin to the bound registries - DONE 2026-08-21

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

**Resolved: the whole `CoreRegistries`, not a narrower accessor.** Two mods wanted
this within a day of each other and wanted different halves - the Borg wants races
by `ridx`, a tile pack wants races and object kinds with their `base`/`tval` and
provenance - so a curated slice was already two fields behind before it was
written. That is the same argument `ctx.core` settled (MOD_COMPATIBILITY.md
decision 18: a curated list is the thing that drifts).

It is a LATCH (`setModRegistries`, called once from `main.ts`) rather than an
argument threaded through the seven places that build a context. A new call site
that forgot to pass it would hand its mod `registries: undefined`, which is a
legal state during content composition and therefore indistinguishable from a
call site that forgot - a mod reading no monsters and reporting nothing. A test
asserts `main.ts` actually makes the call, because every other test in this file's
history passed against a seam nothing filled.

### 2. Wire the four seams and say which are real

Once the registries are reachable, `plugin.ts` becomes
`createBorg({ resolvers: makeCoreResolvers({ races }) })` - and then each of the
four has to be checked individually rather than assumed, because
`makeCoreResolvers` today wires the monster-race facts and leaves activation
identity and the in-shop signal on their conservative defaults, which its own
docstring says.

- **Monster facts** - **DONE 2026-08-21.** `makeCoreResolvers({ races })` is
  called from `plugin.ts` with `ctx.registries.monsters.races`. A mod's creature is
  covered by the same code path: binding runs after composition, so it is a
  `MonsterRace` at a real `ridx`, and the resolver never consults `from`. A test
  pins that, so that nobody adds a provenance check later.
- **Activation identity** - the Borg cannot use an activation it cannot name.
  `ctx.registries.objects` now reaches the object kinds, so the data is in hand;
  what is not yet decided is how `borg_equips_item(act, checkCharge)` maps a named
  activation onto the gear the Borg is wearing.
- **In a shop** - the Borg never shops while this answers "no". Needs the player's
  grid against the town's store entrance features, which is `ctx.state` plus
  `ctx.registries.features`, so this is now also unblocked.
- **Power of an unevaluated swap/buy/sell** - the Borg cannot judge an item it has
  not been told the value of, so it hoards.

**Mod items and creatures must work with the Borg the same as vanilla ones**
(owner's requirement, 2026-08-21). Reading the registry rather than shipping a
table is what makes that free, and it is the standard every remaining seam is held
to: an activation table keyed by core's svals, or a shop check that knows only
core's store list, would each reintroduce the inert-default bug restricted to
modded content, where it is much harder to notice.

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
