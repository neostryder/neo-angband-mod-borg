# Borg API 2 migration

The shipped entry stays on API 1. The schema 2 manifest declares `>=1.0.0 <2.0.0` and keeps all 13 capabilities. `src/core-adapter-api2.ts` is an unwired twin of `createAdapter` and five reads from `borgView`. The twin provides no controller or engine group. Its calls return `Api2Result` promises, so replacing the import also requires the controller wiring in R2.

The table counts grouped rows: 1 moved, 16 with an API 2 home but not wired, and 23 Core requests. Seven home rows have implementations in the twin: own flags, log, map bounds, inventory, equipment, stores and spellbooks. One row groups the 28 command builders. Each target setter has its own row.

| Old member | Status | API 2 home or Core request | Notes |
| --- | --- | --- | --- |
| `ctx.core.Rng`, `Rng`, `makeBorgRng`, `reseedBorgRng` | Moved | Local `src/rng.ts` | The private quick LCRNG no longer reads the engine class. Its draw and reseed sequences match Core in the foundation tests. |
| `ctx.flags` / `BorgMeta.flags` | Home | `meta.flags` | The twin exposes own rule flags. The injected Bug Fixes flag has a separate row. |
| `ctx.log` / `BorgMeta.log` | Home | `meta.log` | The twin delegates diagnostic messages. |
| `ctx.id` | Home | `meta.id` | The title row uses the id when enabling the Borg in a new profile. |
| `plugin.api` | Home | Definition `api` range | The entry keeps integer API 1. The schema 2 manifest keeps the API 1 range. |
| `plugin.register(_host, ctx)` | Request | Core request R3 | The registry host argument is unused. Registration adds only the title row. `start(mod)` cannot register that row. |
| `plugin.controller(ctx)`, `hostController(decide)` | Request | Core request R2 | API 2 can manage an existing controller through `act.controller`, but cannot install one or call its decision loop. |
| `ctx.core`, `bindCore`, `coreIsBound`, `engine.bind`, `engine.missing` | Request | Core request R4 | The versioned P-tier engine domain is absent. API 1 still binds the live namespace and checks required context fields. |
| `FEAT`, `TV`, `RSF`, `MON_RACE_FLAG_ENTRIES`, `MON_SPELL_ENTRIES` | Request | Core request R4 | These content lookups need numeric code tables and composed records, including mod-added entries. |
| `REST_COMPLETE` | Request | Core request R5 | The recovery ladder passes the engine rest sentinel to the command builder. |
| `ctx.registries`, `ctx.state`, `engine.resolverInput()` | Request | Core requests R4, R7, R8, R9 | The resolver input mixes truth races, content records and view fields. API 2 has no equivalent bound-registry object. |
| `ctx.state.actor.player.noscore`, `engine.noscore()` | Request | Core request R2 | This view field determines whether Ctrl-Z has permanently marked the character for autoplay. |
| `ctx.controllerArmed`, `engine.controllerArmed` | Request | Core request R2 | This declaration records consent from the New Borg character row. Current ownership does not establish that consent. |
| `borgView().player()` | Request | Core request R6 | The read is mixed view/truth: vitals and timers are known along with position. Speed, to-hit and AC use live worn-rune derives. |
| `borgView().mapBounds()` | Home | `view.level()` width/height | The twin returns the same dimensions inside an asynchronous result. |
| `borgView().inventory()` | Home | `view.world().inventory` | The twin copies known items into the existing mutable item shape. |
| `borgView().equipment()` | Home | `view.world().equipment` | The twin keeps equipment slots and null entries. |
| `borgView().messages()` | Home | `events.on("message", ...)` | A future controller loop buffers event text and drains it once per decision. This export remains absent from the twin until lifecycle wiring exists. |
| `borgView().floorItems(x, y)` | Request | Core request R8 | This view read returns the live pile filtered by memory, so removed objects disappear. Remembered cell objects omit item details, and `floorHere` covers only the player grid. |
| `borgView().stores()` | Home | `view.world().stores` | The twin preserves all live store stock, including prices. R10 records the knowledge policy needed for dungeon reads. |
| `borgView().spellbooks()` | Home | `view.world().spellbooks` | The twin preserves spell indices, learned state and failure rates. |
| `borgView().constants()` | Request | Core request R4 | This content lookup returns bound z_info constants. API 2 exposes no matching field. |
| `borgView().monsters()` | Request | Core request R7 | This truth read includes only obvious monsters, with exact hit points, speed, statuses and every race flag and spell. |
| `borgView().cell(x, y)` | Request | Core request R8 | The live terrain fields feat, passable and glow are truth. The known, inView, monster, objectCount and trap fields follow perception. |
| `borgView().simulateLoadout(change)` | Request | Core request R6 | This truth derive evaluates real objects and includes unlearned runes. |
| `racesByIndex`, `raceRecord`, `resolverInput().races` | Request | Core request R7 | These truth reads supply race flags, spell ordinals, blow dice, level, sleep, spellPower, frequencies and friends after a monster leaves view. |
| `ctx.registries.objects`, `artifactActivation`, `egoActivation`, `kindActivation` | Request | Core request R9 | These content lookups resolve kind, ego and artifact activations by known identity and return engine records with effects. |
| `ctx.registries.monsters.blowMethods`, `resolverInput().blowMethods` | Home | `content.records("blow_methods")` | Message templates are ordinary composed content. The twin does not yet decode this resolver input. |
| `ctx.registries.monsters.spells`, `resolverInput().monsterSpells` | Home | `content.records("monster_spell")` | Message templates have an API 2 home. Race membership and spell ordinals remain truth under R7. |
| `kindPrice`, `ctx.state.isAware(kind)` | Request | Core request R9 | The content cost affects floor valuation only when the character knows the flavour. The aware bit is a view read. |
| `shopnumHere`, `ctx.state.actor.grid`, `ctx.state.chunk.feature(grid).shopnum` | Request | Core request R8 | This view field locates the store entrance under the player. |
| `ctx.title.registerRow`, `ctx.title.choose` | Request | Core request R3 | No API 2 title-row or host-drawn choice/confirmation member exists. |
| `ctx.profiles.list`, `create`, `setEnabledMods` | Home | `manage.profiles` | The types and host implementation exist, but the loader supplies no first-party allowlist. R1 enables them. |
| `ctx.profiles.switchTo(id, { kind: "create-character", armController: true })` | Request | Core requests R2, R3 | API 2 `switchTo(id)` drops the create-character action and arming declaration. |
| `ctx.saves` presence check | Request | Core request R3 | The title action requires the save-management grant even though the Borg calls no save methods. |
| `installMemory`, page `localStorage` | Request | Core request R11 | Profile ids live outside profiles. Per-profile `store.prefs` would copy the list and change its lifetime. |
| `meta.flags["bugfix.borgFixes"]` | Request | Core request R12 | API 1 injects this flag from Bug Fixes. API 2 exposes only own flags. `meta.mods()` lists only flags the other mod makes public. |
| `borgActions().move`, `borgActions().melee`, `borgActions().hold`, `borgActions().rest`, `borgActions().descend`, `borgActions().ascend`, `borgActions().tunnel`, `borgActions().open`, `borgActions().close`, `borgActions().disarm`, `borgActions().quaff`, `borgActions().read`, `borgActions().eat`, `borgActions().wear`, `borgActions().takeoff`, `borgActions().drop`, `borgActions().pickup`, `borgActions().aimWand`, `borgActions().zapRod`, `borgActions().useStaff`, `borgActions().activate`, `borgActions().fire`, `borgActions().throw`, `borgActions().cast`, `borgActions().shopBuy`, `borgActions().shopSell`, `borgActions().shopExit`, `borgActions().raw` | Home | `act.submit(token, { kind: "command", command })` | The 28 API 1 builders return commands synchronously. The twin omits this facade until R2 supplies the decision loop. R5 also supplies the named default rest mode. `raw` accepts unknown argument types on API 1, while the Borg currently sends JSON-compatible fields. |
| `borgActions().setTargetMonster` | Home | `act.submit(token, { kind: "target", midx })` | API 1 mutates the target immediately. R2 must preserve target-before-command ordering and refresh the input token. |
| `borgActions().setTargetLocation` | Home | `act.submit(token, { kind: "target", x, y })` | API 1 mutates the target immediately. R2 must preserve target-before-command ordering and refresh the input token. |

The Borg uses no `hooks`, `hud`, `menu`, `screen`, `birth`, `frontend`, `regions`, registry declarations or registry overrides. Its `register` argument supplies no engine reads. `ctx.title`, `ctx.profiles`, `ctx.saves` and `ctx.id` remain in `title.ts`, whose existing direct-call tests depend on that interface. The boundary scan permits those four title members and forbids the raw runtime reads handled by `src/core-api.ts` everywhere else. The twin forbids any `ctx` identifier.

## Core requests

### R1

The folder loader does not run API 2 definitions. R1 requests a call to the existing in-process shim for an admitted API 2 range, plus a build-owned list that grants the Borg access to `truth` and `manage`. API 2 loading applies to public mods too. The list of trusted mods is P-tier only. Both optional domains already have SDK types and host implementations, although the brief describes `manage` as absent.

### R2

The Borg installs a controller only after Ctrl-Z marks the character or the title row arms it. R2 requests a P-tier `controller` declaration that receives each input wait and returns the Borg decision. Core keeps target changes ahead of the command and supplies a current token. A known view field `{ noscore }` and an `armed` declaration preserve both consent paths. `owns()` and `newCharacter` do not describe that consent. This addition replaces `hostController`, the action wrapper and both autoplay checks. Core draws the Ctrl-Z confirmation.

### R3

The title row creates or copies a profile, enables the Borg and starts character creation there. R3 requests P-tier title actions declared as `{ id, label, key, run }`, a Core-drawn `choose(label, choices)` call and `manage.profiles.switchTo(id, { kind: "create-character", armController: true })`. The host checks the existing profile and save grants before registering the row. These additions preserve the choices already implemented in `title.ts`.

### R4

Numeric terrain, item and spell codes still come from the bound engine. R4 requests a versioned P-tier `engine` alias of `ctx.core` while these reads move to content lookups. The proposed content shape is `{ terrainCodes, itemClassCodes, monsterSpellCodes, monsterFlagEntries, monsterSpellEntries, constants }`, built from composed content so it includes mod-added entries. Public code tables can replace these lookups later. The engine alias also preserves `bindCore`, `coreIsBound` and the binding checks. The Borg uses no registry overrides.

### R5

The recovery ladder uses the rest-as-needed sentinel and the command builder supplies it by default. R5 requests the public act argument `{ mode: "complete" }` in place of that number. Core interprets the named mode, so the Borg can remove `REST_COMPLETE` without importing a constant.

### R6

Gear scoring evaluates worn objects and hypothetical loadouts through the live player derive. R6 requests a P-tier derive policy `engine.deriveLoadout({ wear, takeoff }, { knowledge: "actual" })` that returns the existing player fields together with inventory and equipment. A known policy can use only learned runes. The actual policy keeps current play while the knowledge audit traces those values to decisions. The current unlearned rune effects are truth and have no player-known source.

### R7

Danger evaluation uses combat records for obvious monsters and for races tracked after a monster leaves view. R7 requests a P-tier `perceived` field based on `monsterIsObvious`, the existing status fields and `truth.race(index)`. The race record supplies flags, numeric spell ordinals, blow `{ dice, sides, effect }`, level, sleep, spellPower, frequencies and friends. Current `truth.monsters()` includes unseen monsters, and `visible` cannot reconstruct the old membership rule. Reads of unknown race facts through `content.records("monster")` still count as truth.

### R8

Map and floor tracking combine current terrain with player perception. R8 requests a P-tier `engine.borgCell(x, y)` returning `{ feat, passable, glow, known, inView, monster, objectCount, trap }` until remembered terrain replaces the truth fields. A view call for known item details at any grid keeps the current live-pile filter. A `view.player().shopnum` field replaces the lookup under the player. Current `truth.level()` has no passable or glow fields, and its object and monster lists do not reconstruct the old perception fields.

### R9

The activation resolvers use decoded object records. R9 requests a content lookup by `{ tval, sval }` or known ego/artifact name that returns `{ activation: { name, effect }, cost }`, plus a view field for flavour awareness. Core supplies the decoded effect and lookup types before the twin implements these reads. P-tier engine lookups keep them available in the meantime. A public lookup still gates hidden item identity.

### R10

The Borg reads every shop from the dungeon, and API 2 already returns that stock. The upstream Borg keeps only its last visit. R10 requests a P-tier table that states whether current remote stock can guide a decision. Core can instead return visit snapshots if play changes later. This pass keeps the current stock reads.

### R11

The Borg profile list lives outside profiles so that profile switches and copies do not change it. R11 requests a P-tier JSON slot such as `store.install` with that lifetime. A later public slot can isolate install data by mod. The existing per-profile `store.prefs` does not supply this storage.

### R12

Bug Fixes supplies the resolved `bugfix.borgFixes` flag used by the buff-timer safety net. R12 requests that flag through `meta.mods()` or the existing P-tier metadata injection. `meta.mods()` already exists, but it lists only flags another mod publishes. A public shared flag or P-tier injection keeps the absent-flag default true.

## Knowledge and action audit

The Borg can receive a whole map, but its decisions must use facts the player can know. This pass keeps play unchanged and records the gaps under [neostryder/neo-angband#415](https://github.com/neostryder/neo-angband/issues/415). P-tier truth access still needs a rule for how each hidden fact affects a decision.

`perceive.ts` folds `cell().feat` into known cells. A secret door therefore enters the Borg map as `FEAT.SECRET` where the player sees granite. `flow/flow-dark.ts:59` and `flow/flow-misc.ts:366`, `:627`, `:637` compare that secret-door value when choosing paths. R8 needs a remembered feat policy before this read can become view-only.

`item/light.ts:168-169` counts live passability on known diagonal grids when choosing whether to illuminate the area. `item/light.ts:254` counts `passable && glow` over a 5x5 area without checking known or inView, then chooses Create Darkness for a necromancer. R8 must supply remembered passability and known light for those choices. The current reads remain truth even when the grid's position is known.

`monsters()` supplies only obvious monsters, so position and membership follow perception. Exact hit points and speed feed injury estimates and danger. Statuses affect fighting and escape. Race flags such as MULTIPLY and the full spell count affect danger and target choices. `racesByIndex` and `raceRecord` let those calculations continue for tracked races after sight is lost. Monster recall supplies only learned flags and spells, and a health band supplies no exact hit points. R7 keeps those reads available while Core adds rules for using each hidden fact. The current code has no player-known source for the remaining hidden race facts.

`player()` uses visible vitals and timers alongside live worn-rune derives. `simulateLoadout()` feeds gear power and wear, buy and sell decisions using real objects. Unlearned runes have no matching known fact, so R6 needs a derive policy before those calculations can move to a known-only view.

Floor objects come from known twins, but the live-pile filter drops objects that vanished out of sight. Store stock is readable from the dungeon. R8 and R10 preserve those current policies until the host provides a declared knowledge rule. Activation lookups use names known from equipment, and `kindPrice` applies base cost only for an aware flavour. R9 keeps those identity gates.

## Removal list

The runtime read of `ctx.core.Rng` and the Core RNG type dependency in the decision context and controller are removed. `src/rng.ts` carries only the quick LCRNG operations the Borg calls. The foundation tests compare its stream with Core across seeds, rejection-prone bounds, mixed calls and reseeding, and check that a separate game generator stays unchanged.

No manifest grant can be removed without changing play. `command:add` gates controller installation and every API 1 action, despite its name. The nine state grants cover player, monsters, map, inventory/equipment, floor items, messages, stores, spells and constants. The remaining three grants cover the title row, profiles and the save permission required to start a character. The required core content dependency and the development Core/SDK dependencies remain. No new grant or package dependency is added.

Engine vocabularies and constants wait on R4, rest mode on R5, live derives on R6, monster/race truth on R7, map/floor/shop fields on R8, and decoded object records on R9. Controller arming and noscore wait on R2, title/profile actions on R3, first-party domains on R1, install storage on R11, and the cross-mod flag on R12. R10 records the remote-store knowledge decision. The API 1 adapter keeps all of these reads.

## Validation scope

The twin tests compare metadata and all five implemented reads with the API 1 adapter on the same facts. The cases include unavailable and refused results, denied grants, missing world parts, empty lists, null equipment slots and copied item arrays. The boundary tests parse TypeScript. They reject assertions and casts around context reads, spacing and bracket access, exports from Core and imports of Core. The scan also rejects identifiers ending in engine and handles URLs inside strings.

The repository's plugin tests drive the committed bundle, exercise marked and armed characters, and check that an unmarked character declines before binding the engine. The foundation tests cover deterministic decision and RNG behavior. These tests do not establish a complete game-on/game-off replay comparison or rendered Electron parity.
