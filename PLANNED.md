# Planned: make the Borg actually play

**Opened 2026-08-21. Target: full functionality, validated by several successful
runs, where a successful run means it tries its best and gets as far as it can.**

This file exists because the mod's tests are green, its port is faithful, and the
thing a player installs does not play properly. Nothing below is a bug in the
ported code. Every item is a seam that was built, documented and never connected,
which is a failure mode this project has now hit four times, so the shape is worth
naming: a capability that exists in the tree and not in the product.

## What was actually wrong

**Written 2026-08-21 before any of it was fixed, and kept in the past tense rather
than deleted: the diagnosis is the useful part, and a file that erases what was
wrong as soon as it is fixed teaches nobody the shape of the failure.** Every
seam described below is now wired; see Progress.

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
   be is documented as unreachable with the reason. **DONE 2026-08-21.** The
   fourth needed an engine capability rather than host wiring; it landed as
   `AgentView.simulateLoadout` in Neo Angband 0.25.0.
2. There is a restart-on-death loop. Playing itself over and over is the point of
   the mod, and no loop exists anywhere in it. **DONE 2026-08-21.** It needed no
   code in this repository at all: the whole thing is host-side, because
   `AgentCommand` is `PlayerCommand` and birth has no representation in it. It
   landed as `StartedGame.reincarnate` plus the game loop's death handler in Neo
   Angband 0.25.0.
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
| 2026-08-21 | **Step 2, three of four seams done.** `makeCoreResolvers` now also takes `objects` (`ctx.registries.objects`) and `state` (`ctx.state`), each independently optional. Activation identity walks an equipped `ItemView` back through its ego/artifact/kind to the `Activation` record that grants it (mirroring `obj-make.c`'s own artifact-then-ego-then-kind precedence) and compares `act_<name lowercased>` against the token the ported trait/item code already passes. The in-shop signal reads `state.chunk.feature(state.actor.grid).shopnum` directly - no new host plumbing needed, because `Chunk` already carries the bound `FeatureRegistry` it was built with. Both are covered on the same terms as danger vision: a mod's ego, artifact or store entrance is resolved by the same lookup, not a vanilla-only table. The fourth seam (swap/buy/sell power) is NOT wired; see the entry below it. |
| 2026-08-21 | **Step 2 complete: all four seams wired.** The fourth needed an engine capability rather than host plumbing, and it landed with Neo Angband 0.25.0 as `AgentView.simulateLoadout`: the engine's own `calc_bonuses` over a hypothetical set of worn objects, with nothing in the live game written. `src/trait/simulate.ts` runs the ported `borg_notice` and `borg_power` over the loadout it describes, which is the wield / recompute / revert shape upstream uses, against a scratch copy of the self-model so a ladder can score a dozen candidates without disturbing the Borg's view of itself. `think-session.ts` fans that one seam out into the five questions the ported subsystems ask (`wearEval`, `buyShopEval`, `buyHomeEval`, `sellEval`, `sellHomeBadEval`); the two swap valuations are unreachable rather than pending, because this port has no swap subsystem and both contribute zero to `borg_power`. It landed behind a probe on `ctx.core.simulateLoadout`, so an older game degraded instead of throwing; the probe came out again the same day, when the engine range was pinned (see Releasing this). |
| 2026-08-21 | **Step 3 done: the restart loop.** Not one line of it is in this repository, and that is the finding rather than an accident of scheduling - `AgentCommand` is `PlayerCommand`, so there is no value a controller could return that means "roll me a new character", and the death handler lives in the host's game loop. Neo Angband 0.25.0 gained `StartedGame.reincarnate` (upstream's `reincarnate_borg`, over this port's own `generatePlayer` / `outfitPlayer` rather than a second copy of the birth pipeline) and the host's `LOOP_STATUS.DEAD` branch calls it, ahead of every step of the human death flow, whenever a mod holds the keyboard. The gate is the one autoplayer slot the host already had, so there is no second toggle and no mod id written into the engine. `NOSCORE_BORG` is set at upstream's own activation gate and again on each respawn. |

## Releasing this

**0.4.0 IS TAGGED, released with Neo Angband 0.23.0 (2026-08-20).** It was held
back for a few hours first, and the reason is worth keeping: the game installs a
mod from a TAG and a tag must never be moved, so tagging is the release event and
the version field is not. Danger vision needs a host that supplies
`ctx.registries`, and until 0.23.0 shipped, no released game had it - a tag before
that would have pinned a digest on a change inert on every game a player could
actually be running.

**The engine range is `>=0.25.0`, and 0.6.1 is where it stopped being permissive.**
Up to 0.6.0 it was `>=0.12.0` and the mod degraded: on an older host
`ctx.registries` was absent, `createBorg()` took its conservative defaults, and
the plugin said "playing blind" in its own log. That was written down as a
deliberate difference from how neo-linoleum 0.15.0 handled the same dependency,
on the grounds that a mod which can still do most of its job should not refuse to
load.

**The reversal, and the reasoning that changed.** That argument assumed a
partially-working Borg was worth protecting. It was not, and the evidence is this
file: until 2026-08-21 the shipped mod had no danger vision, never shopped, never
used an activation, could not evaluate a swap and never started a new character
when it died. On no engine version, ever, had it been an autoplayer. So there was
no installed base of "the Borg working acceptably on an older game" for a hard
floor to break, and the permissive range was protecting an experience that did
not exist.

What the floor buys is that the two things the word "Borg" means are no longer
conditional. The restart-on-death loop and `AgentView.simulateLoadout` both
arrived in 0.25.0; without the first it plays one character and stops, and
without the second it wears nothing it finds. A refusal names the problem and
tells a player to update the game. A degraded load produces a Borg that walks
around losing, which is indistinguishable from a Borg that is simply bad at
Angband - the exact confusion this whole file was opened to end.

The comparison with neo-linoleum now goes the other way: both refuse, for the
same reason, and the difference is that neo-linoleum's floor was obvious from the
start because its fill visibly does nothing without the seam.

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

### 2. Wire the four seams and say which are real - DONE 2026-08-21

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
- **Activation identity** - **DONE 2026-08-21.** `borg_equips_item(act, checkCharge)`
  and `borg_activate_item(act)` both resolve `act` (the port's `"act_<name>"`
  token, e.g. `"act_light"`) by walking an equipped item's `artifactName` /
  `egoName` / `tval`+`sval` back through `ctx.registries.objects` to the
  `Activation` record that grants it, mirroring `obj-make.c`'s own precedence
  (an artifact's or ego's activation overrides its base kind's). `ItemView` only
  exposes "has an activation" as a boolean, not which one, which is why this
  needed the registry rather than the frozen view alone.
- **In a shop** - **DONE 2026-08-21.** `Chunk` already carries the
  `FeatureRegistry` it was bound with, so `state.chunk.feature(state.actor.grid)
  .shopnum` (`square_shopnum`, cave-square.c:1512) needed no new host plumbing -
  `ctx.state` alone was enough once it existed. A mod-added store entrance is
  covered the same way, since `shopnum` is derived from the feature's `SHOP` flag
  at bind time regardless of which pack defined it.
- **Power of an unevaluated swap/buy/sell** - **DONE 2026-08-21**, and it was
  never a wiring problem like the other three. `borg_wear_stuff` /
  `borg_think_shop_buy_useful` / `borg_think_shop_sell_useless` all need
  `borg.power` for a HYPOTHETICAL loadout (an item worn, bought or sold that the
  Borg is not actually carrying), which means re-running `borg_notice` on gear
  the character does not have on. `borgNotice` (`src/trait/trait.ts`) takes
  values it cannot re-derive - net speed, AC-less skills, blows/shots - straight
  from the live `PlayerView`, which the engine computed for the REAL equipped
  loadout only, so there was no "what if I wore this instead" version of that
  view to read.

  The gap was in the game repository and is closed there: `simulateLoadout`
  (`packages/core/src/agent/loadout.ts`, Neo Angband 0.25.0) runs the engine's
  OWN `calc_bonuses` over a hypothetical equipment array and returns the
  `PlayerView`, the `ItemView`s and the whole derived-stat surface that loadout
  would produce, before / after / delta, without writing anything. It reuses the
  real derive rather than reimplementing it, which is what keeps it from drifting
  from the loadout the character is actually in - and a test asserts the
  simulated answer field-for-field against really equipping the item.

  This mod's half is `borgSimulatePower` (`src/trait/simulate.ts`): the ported
  `borg_notice` and `borg_power`, over that view, against a scratch copy of the
  self-model. Five of the seven questions the ported subsystems ask are wired
  from it; `weapon_swap_value` and `armour_swap_value` are unreachable, because
  this port has no swap subsystem and both contribute zero to `borg_power`.

  It shipped for one day behind a fourth `makeCoreResolvers` input, `loadout`,
  which carried a capability answer rather than a datum: `plugin.ts` probed
  `ctx.core.simulateLoadout` so an older game degraded instead of throwing. The
  input and the probe are gone in 0.6.1 along with the permissive engine range
  they existed for. The seam is installed unconditionally now, and the null it can
  still return belongs to a view with no live derive behind it rather than to an
  engine that cannot answer.

**Mod items and creatures must work with the Borg the same as vanilla ones**
(a hard requirement). Reading the registry rather than shipping a
table is what makes that free, and it is the standard every remaining seam is held
to: an activation table keyed by core's svals, or a shop check that knows only
core's store list, would each reintroduce the inert-default bug restricted to
modded content, where it is much harder to notice.

### 3. The restart loop - DONE 2026-08-21

**Landed in Neo Angband 0.25.0 as `StartedGame.reincarnate`, called from the game
loop's `LOOP_STATUS.DEAD` branch. Nothing in this repository changed.** The spec
below was read off `borg-reincarnate.c` before any of it was built and is kept as
written; what it got right and what it got wrong are both worth having.

What it got right: the shape. An in-session reincarnation, the live player wiped
and regenerated in place, race and class rolled, a one-way mark on the character.

What it got wrong, and the correction is upstream's own code: the saved-off dungeon
is NOT what the reincarnated character wakes up on. `reincarnate_borg` restores
`cave` so nothing downstream of the wipe holds a null pointer, and in the same
breath sets `player->depth = 0` and `player->upkeep->generate_level = true` - which
`run_game_loop` (`game-world.c:1168`) consumes on its next pass by generating the
level at depth 0. So the character starts in a freshly generated TOWN, which is
also the only sane place to put a level-1 character whose predecessor died on
dungeon level 30. The port saves and restores the level for the same reason
upstream does and then asks for the town, which is one call to the level changer it
already had.

Three other corrections, recorded because each was a guess in the text below:

- **`NOSCORE_BORG` already existed here**, at upstream's value, in the
  score-invalidating mask, persisted in the savefile and read at death to print
  "Score not registered for borgs." Nothing had ever SET it. So the work was not
  "find or add an equivalent" - it was filling an inert seam of exactly the shape
  this file's own header describes.
- **The mark rides the ACTIVATION, not only the respawn.** Upstream sets it in
  `do_cmd_try_borg` (`cmd-misc.c:140`) when the borg is switched on, and again at
  the tail of `reincarnate_borg` because `player_generate` zeroes the field. Both
  are needed: without the first, the character that was already alive when the mod
  took over is never marked; without the second, only the first respawn is.
- **Two of upstream's steps are deliberately skipped**: the `seed_flavor` reseed
  and the `seed_randart` reroll. This port's savefile re-derives the flavour
  assignment and the randart set FROM those seeds, so moving either mid-session
  makes the save describe a world the game is not in. The flavour KNOWLEDGE is
  reset instead, which is the half a player can observe.

The original spec follows.

A death has to start a new character. This is what turns the mod into the thing
that was asked for on r/angband: something that plays itself over and over,
fullscreen, as a screensaver. **No deviation from upstream's own behaviour is
wanted here** - reference `src/borg/borg-reincarnate.c` is the exact spec, not
just prior art:

- **It is a reincarnation, not a new save.** Upstream never exits to a menu or
  writes a new savefile. `reincarnate_borg()` wipes the live `player` struct in
  place (`player_init`, then `player_generate` with a freshly rolled race and
  class), keeps the same session, restores the dungeon it saved off first, and
  carries straight on. The host-level gap this mod hit (`AgentCommand` has no
  birth-flow command, and death handling lives entirely in `main.ts`'s game
  loop) is real, but the fix is an in-session reincarnation hook, not a
  restart-the-process or a fresh-save design.
- **Race and class are RANDOM by default, matching `borg_cfg[BORG_RESPAWN_RACE
  /_CLASS] == -1`.** Upstream only pins a fixed race/class when its own config
  sets one. A stacked mod (with a dependency on this one) is the right place to
  add a pinned-race/class option later - this mod's own default follows
  upstream's own default, which is a reroll, not a repeat.
- **The character is marked, the same way upstream marks it.** `reincarnate_borg`
  sets `NOSCORE_BORG` on the player so a borg-touched character can never read as
  a legitimate high-score run. Whatever this port's equivalent of that flag is
  (or a new one, if none exists yet) needs the same one-way, can't-be-cleared
  property, so a save that has run the Borg is never mistaken for a save that
  earned its result unattended.
- Everything else upstream does around the reroll (starting gold, starting
  gear via `borg_outfit_player`, HP rolled within the class's min/max range via
  `borg_roll_hp`, a random name) is scenery for a screensaver and does not need
  a byte-for-byte port - the three bullets above are the ones that decide
  whether this looks like "Core + Borg indistinguishable from the original game
  running its own borg," which is the bar for this item.

### 4. Watch it, several times, and write down what happened

Driven in the installed desktop build over CDP, because that is the only
instrument here that proves pixels and a running game rather than a populated data
structure. The main repository's `CLAUDE.md` has the procedure and the four traps.

## What is deliberately NOT here

Making the Borg WIN. The target is that it tries its best and gets as far as it
can, by the original's rules. Upstream's borg dies, and a port that dies the same
way for the same reasons is faithful; one that survives longer than upstream's
would is a different program wearing its name.
