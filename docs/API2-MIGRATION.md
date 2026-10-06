# Borg API 2 migration

The Borg ships on API 1 with all 13 capabilities and the manifest range `>=1.0.0 <2.0.0`. The unused adapter in `src/core-adapter-api2.ts` reads metadata, map bounds and spellbooks. Its view reads return `Api2Result` promises. The remaining exports and controller loop need implementations before an import swap can run the Borg on API 2.

The 40 rows contain 1 local move, 9 API 2 homes and 30 Core requests. The twin implements 4 home rows: own flags, logging, map bounds and spellbooks. The 5 pending homes have no twin implementation. The command row groups 28 builders; the target setters each occupy a row.

| Old member | Status | API 2 home or Core request | Notes |
| --- | --- | --- | --- |
| `ctx.core.Rng`, `Rng`, `makeBorgRng`, `reseedBorgRng` | Moved | Local `src/rng.ts` | The private quick LCRNG no longer reads the engine class. Its draw and reseed sequences match Core in the foundation tests. |
| `ctx.flags` / `BorgMeta.flags` | Home (twin) | `meta.flags` | These flags belong to the Borg. The Bug Fixes flag appears separately under R12. |
| `ctx.log` / `BorgMeta.log` | Home (twin) | `meta.log` | Diagnostic lines go to the host log. |
| `ctx.id` | Home (pending) | `meta.id` | New-profile setup uses this id to enable the Borg. |
| `plugin.api` | Home (pending) | Definition `api` range | The shipped entry uses the API 1 integer; the manifest uses its range. |
| `plugin.register(_host, ctx)` | Request | Core request R3 | The registry host argument is unused. Registration adds only the title row. `start(mod)` cannot register that row. |
| `plugin.controller(ctx)`, `hostController(decide)` | Request | Core request R2 | API 2 can manage an existing controller through `act.controller`, but cannot install one or call its decision loop. |
| `ctx.core`, `bindCore`, `coreIsBound`, `engine.bind`, `engine.missing` | Request | Core request R4 | The versioned P-tier engine domain is absent. API 1 still binds the live namespace and checks required context fields. |
| `FEAT`, `TV`, `RSF`, `MON_RACE_FLAG_ENTRIES`, `MON_SPELL_ENTRIES` | Request | Core request R4 | These content lookups need numeric code tables and composed records, including mod-added entries. |
| `REST_COMPLETE` | Request | Core request R5 | The recovery ladder passes the engine rest sentinel to the command builder. |
| `ctx.registries`, `ctx.state`, `engine.resolverInput()` | Request | Core requests R4, R7, R8, R9 | The resolver input mixes truth races, content records and view fields. API 2 has no equivalent bound-registry object. |
| `ctx.state.actor.player.noscore`, `engine.noscore()` | Request | Core request R2 | This view field determines whether Ctrl-Z has permanently marked the character for autoplay. |
| `ctx.controllerArmed`, `engine.controllerArmed` | Request | Core request R2 | This declaration records consent from the New Borg character row. Current ownership does not establish that consent. |
| `borgView().player()` | Request | Core request R6 | The read is mixed view/truth: vitals and timers are known along with position. Speed, to-hit and AC use live worn-rune derives. |
| `borgView().mapBounds()` | Home (twin) | `view.level()` width/height | The result contains the level dimensions. |
| `borgView().inventory()` | Request | Core request R9 | Borg decisions need timeout in turns. Known items give a count of charging items, so this export has no twin. |
| `borgView().equipment()` | Request | Core request R9 | The light code uses timeout as fuel. Known equipment lacks that number. |
| `borgView().messages()` | Request | Core request R2 | Message events provide text. The missing controller loop needs a subscription and a buffer drained at each decision, plus cleanup on stop. |
| `borgView().floorItems(x, y)` | Request | Core request R8 | This view read returns the live pile filtered by memory, so removed objects disappear. Remembered cell objects omit item details, and `floorHere` covers only the player grid. |
| `borgView().stores()` | Request | Core requests R9, R10 | The known stock includes prices but lacks item timeout. R10 covers stock reads from the dungeon. |
| `borgView().spellbooks()` | Home (twin) | `view.world().spellbooks` | The copy keeps spell indices and learned state, including failure rates. |
| `borgView().constants()` | Request | Core request R4 | This content lookup returns bound z_info constants. API 2 exposes no matching field. |
| `borgView().monsters()` | Request | Core request R7 | This truth read includes only obvious monsters, with exact hit points, speed, statuses and every race flag and spell. |
| `borgView().cell(x, y)` | Request | Core request R8 | The live terrain fields feat, passable and glow are truth. The known, inView, monster, objectCount and trap fields follow perception. |
| `borgView().simulateLoadout(change)` | Request | Core request R6 | This truth derive evaluates real objects and includes unlearned runes. |
| `racesByIndex`, `raceRecord`, `resolverInput().races` | Request | Core request R7 | These truth reads supply race flags, spell ordinals, blow dice, level, sleep, spellPower, frequencies and friends after a monster leaves view. |
| `ctx.registries.objects`, `artifactActivation`, `egoActivation`, `kindActivation` | Request | Core request R9 | These content lookups resolve kind, ego and artifact activations by known identity and return engine records with effects. |
| `ctx.registries.monsters.blowMethods`, `resolverInput().blowMethods` | Home (pending) | `content.records("blow_methods")` | Composed content contains the templates. The resolver decoder remains unwritten. |
| `ctx.registries.monsters.spells`, `resolverInput().monsterSpells` | Home (pending) | `content.records("monster_spell")` | Content supplies message templates. R7 covers the hidden spell membership of a race and its numeric spell ordinals. |
| `kindPrice`, `ctx.state.isAware(kind)` | Request | Core request R9 | The content cost affects floor valuation only when the character knows the flavour. The aware bit is a view read. |
| `shopnumHere`, `ctx.state.actor.grid`, `ctx.state.chunk.feature(grid).shopnum` | Request | Core request R8 | This view field locates the store entrance under the player. |
| `ctx.title.registerRow`, `ctx.title.choose` | Request | Core request R3 | No API 2 title-row or host-drawn choice/confirmation member exists. |
| `ctx.profiles.list`, `create`, `setEnabledMods` | Home (pending) | `manage.profiles` | These calls exist in the SDK and host. The Borg needs the management access in R1 before its title code can use them. |
| `ctx.profiles.switchTo(id, { kind: "create-character", armController: true })` | Request | Core requests R2, R3 | API 2 `switchTo(id)` drops the create-character action and arming declaration. |
| `ctx.saves` presence check | Request | Core request R3 | The title action requires the save-management grant even though the Borg calls no save methods. |
| `installMemory`, page `localStorage` | Request | Core request R11 | Profile ids live outside profiles. Per-profile `store.prefs` would copy the list and change its lifetime. |
| `meta.flags["bugfix.borgFixes"]` | Request | Core request R12 | API 1 injects this flag from Bug Fixes. API 2 exposes only own flags. `meta.mods()` lists only flags the other mod makes public. |
| `borgActions().move`, `borgActions().melee`, `borgActions().hold`, `borgActions().rest`, `borgActions().descend`, `borgActions().ascend`, `borgActions().tunnel`, `borgActions().open`, `borgActions().close`, `borgActions().disarm`, `borgActions().quaff`, `borgActions().read`, `borgActions().eat`, `borgActions().wear`, `borgActions().takeoff`, `borgActions().drop`, `borgActions().pickup`, `borgActions().aimWand`, `borgActions().zapRod`, `borgActions().useStaff`, `borgActions().activate`, `borgActions().fire`, `borgActions().throw`, `borgActions().cast`, `borgActions().shopBuy`, `borgActions().shopSell`, `borgActions().shopExit`, `borgActions().raw` | Request | Core requests R2, R5 | All 28 builders remain on API 1. The API 2 command path is `act.submit(token, { kind: "command", command })`; R2 connects it to decisions and R5 adds the default rest mode. |
| `borgActions().setTargetMonster` | Request | Core request R2 | The proposed loop submits `{ kind: "target", midx }` before the command and obtains a fresh token. This setter remains on API 1. |
| `borgActions().setTargetLocation` | Request | Core request R2 | Location targeting uses `{ kind: "target", x, y }` before the command, then refreshes the token. The twin has no setter. |

The Borg uses no `hooks`, `hud`, `menu`, `screen`, `birth`, `frontend`, `regions`, registry declarations or registry overrides. Its `register` argument supplies no engine reads. `ctx.title`, `ctx.profiles`, `ctx.saves` and `ctx.id` remain in `title.ts`, whose existing direct-call tests depend on that interface. The boundary scan permits those four title members and forbids the raw runtime reads handled by `src/core-api.ts` everywhere else. The twin forbids any `ctx` identifier.

## Core requests

### R1

Core already loads in-process API 2 definitions with `api2Plugin`. Grant handling controls the optional domains, and the SDK and host implement `manage.profiles`, `manage.session`, `truth.monsters()` and `truth.level()`. Core's Borg list entry names the real-map and profile seams. The Borg manifest has no real-map grant, and Core blocks management in an in-process mod. R1 needs a P-tier path that can run the Borg's existing truth reads and title/profile code under those grant rules.

### R2

The controller starts after Ctrl-Z marks the character or the title row arms it. R2 needs a P-tier `controller` declaration that calls the Borg at each input wait and accepts its decision. Target submissions run before the command, with a fresh token afterward. Message events need a subscription before play and a buffer drained at each decision; stopping the controller ends the subscription. A known `{ noscore }` field and an `armed` declaration keep the two consent paths. Current `owns()` and `newCharacter` fields cannot answer either consent check. Core continues to draw the Ctrl-Z confirmation.

### R3

The title row creates or copies a profile, enables the Borg and starts character creation there. R3 requests P-tier title actions declared as `{ id, label, key, run }`, a Core-drawn `choose(label, choices)` call and `manage.profiles.switchTo(id, { kind: "create-character", armController: true })`. The host checks the existing profile and save grants before registering the row. These additions preserve the choices already implemented in `title.ts`.

### R4

Numeric terrain, item and spell codes still come from the bound engine. R4 requests a versioned P-tier `engine` alias of `ctx.core` while these reads move to content lookups. The proposed content shape is `{ terrainCodes, itemClassCodes, monsterSpellCodes, monsterFlagEntries, monsterSpellEntries, constants }`, built from composed content so it includes mod-added entries. Public code tables can replace these lookups later. The engine alias also preserves `bindCore`, `coreIsBound` and the binding checks. The Borg uses no registry overrides.

### R5

The recovery ladder relies on the rest-as-needed sentinel, which the command builder supplies by default. R5 asks for the public act argument `{ mode: "complete" }` to take that number's place. Core would interpret the named mode itself, so the Borg can drop `REST_COMPLETE` and has no constant to import.

### R6

Gear scoring runs worn objects and hypothetical loadouts through the live player derive. R6 asks for a P-tier derive policy, `engine.deriveLoadout({ wear, takeoff }, { knowledge: "actual" })`, that returns the existing player fields along with inventory and equipment. Under a known policy, only learned runes count. The actual policy keeps play as it is today while the knowledge audit traces those values to decisions. Right now the effects of unlearned runes come from truth, and there is no player-known source for them.

### R7

Danger evaluation uses combat records for obvious monsters and for races tracked after a monster leaves view. R7 requests a P-tier `perceived` field based on `monsterIsObvious`, the existing status fields and `truth.race(index)`. The race record supplies flags, numeric spell ordinals, blow `{ dice, sides, effect }`, level, sleep, spellPower, frequencies and friends. Current `truth.monsters()` includes unseen monsters, and `visible` cannot reconstruct the old membership rule. Reads of unknown race facts through `content.records("monster")` still count as truth.

### R8

Map and floor tracking combine current terrain with player perception. R8 requests a P-tier `engine.borgCell(x, y)` returning `{ feat, passable, glow, known, inView, monster, objectCount, trap }` until remembered terrain replaces the truth fields. A view call for known item details at any grid keeps the current live-pile filter. A `view.player().shopnum` field replaces the lookup under the player. Current `truth.level()` has no passable or glow fields, and its object and monster lists do not reconstruct the old perception fields.

### R9

Activation lookups need decoded records keyed by `{ tval, sval }` or a known ego/artifact name, returning `{ activation: { name, effect }, cost }`. R9 covers that lookup and the item fields still missing from API 2. Known items have `aware` and a count named `charging`. They lack exact `timeout`, which the Borg uses for light thresholds in `item/light.ts` and stacking checks in `store/sell.ts`. A P-tier item read needs to keep timeout for inventory, equipment and store stock, with a rule for using that hidden value. The twin has no exports for these reads. Public content lookups still need to hide unknown item identities.

### R10

The Borg uses `stores()` from the dungeon to read the store index, feature, home marker and owner, plus each stock item's index and price. Those fields exist at `view.world().stores`. R10 needs one row per shop from a P-tier `truth.storeKnowledge()` call: `{ storeIndex, feat, depth, lastVisitTurn, snapshotTurn, stalenessRule, remoteStockUsable }`. The depth names the level where the Borg uses the stock. Current play uses `stalenessRule: "current"` and `remoteStockUsable: true`; the snapshot turn matches the world turn. Returning only last-visit stock would change play. The current stock reads remain in place.

### R11

The Borg keeps its profile list outside the profiles, so switching or copying a profile leaves the list alone. R11 asks for a P-tier JSON slot with that lifetime, such as `store.install`. A public slot could come later and keep each mod's install data separate. The per-profile `store.prefs` that exists today can't hold this.

### R12

The buff-timer safety net relies on the resolved `bugfix.borgFixes` flag, which Bug Fixes supplies. R12 asks for that flag through `meta.mods()` or the existing P-tier metadata injection. `meta.mods()` is already there, though it only lists flags that another mod publishes. With either a public shared flag or P-tier injection, the flag still defaults to true when it is absent.

## Knowledge and action audit

The Borg can receive a whole map, but its decisions must use facts the player can know. This pass keeps play unchanged and records the gaps under [neostryder/neo-angband#415](https://github.com/neostryder/neo-angband/issues/415). P-tier truth access still needs a rule for how each hidden fact affects a decision.

`perceive.ts` folds `cell().feat` into known cells. A secret door therefore enters the Borg map as `FEAT.SECRET` where the player sees granite. `flow/flow-dark.ts:59` and `flow/flow-misc.ts:366`, `:627`, `:637` compare that secret-door value when choosing paths. R8 needs a remembered feat policy before this read can become view-only.

`item/light.ts:168-169` counts live passability on known diagonal grids when choosing whether to illuminate the area. `item/light.ts:254` counts `passable && glow` over a 5x5 area without checking known or inView, then chooses Create Darkness for a necromancer. R8 must supply remembered passability and known light for those choices. The current reads remain truth even when the grid's position is known.

`monsters()` supplies only obvious monsters, so position and membership follow perception. Exact hit points and speed feed injury estimates and danger. Statuses affect fighting and escape. Race flags such as MULTIPLY and the full spell count affect danger and target choices. `racesByIndex` and `raceRecord` let those calculations continue for tracked races after sight is lost. Monster recall supplies only learned flags and spells, and a health band supplies no exact hit points. R7 keeps those reads available while Core adds rules for using each hidden fact. The current code has no player-known source for the remaining hidden race facts.

`player()` uses visible vitals and timers alongside live worn-rune derives. `simulateLoadout()` feeds gear power and wear, buy and sell decisions using real objects. Unlearned runes have no matching known fact, so R6 needs a derive policy before those calculations can move to a known-only view.

Floor objects come from known twins, but the live-pile filter drops objects that vanished out of sight. Store stock is readable from the dungeon. R8 and R10 preserve those current policies until the host provides a declared knowledge rule. Activation lookups use names known from equipment, and `kindPrice` applies base cost only for an aware flavour. R9 keeps those identity gates.

## Removal list

The decision context and controller no longer read `ctx.core.Rng` at runtime, and they no longer depend on the Core RNG type. `src/rng.ts` holds just the quick LCRNG operations the Borg calls. The foundation tests compare its stream with Core's across seeds, bounds prone to rejection, mixed calls and reseeding, and they check that a separate game generator is left unchanged.

Every manifest grant is still needed, since removing any of them would change play. Despite its name, `command:add` gates installing the controller and every API 1 action. Nine state grants cover the player, monsters, map, inventory/equipment, floor items, messages, stores, spells and constants. The other three cover the title row, profiles, and the save permission a character needs before it can start. The required core content dependency stays, as do the development Core/SDK dependencies, and no grant or package dependency is added.

The API 1 adapter still supplies the pieces covered by R4 to R9. R4 is for the code tables and constants, R5 for rest mode, R6 for loadout derives, R7 for monster/race facts, R8 for map/floor/shop fields, and R9 for object records and item timeout. What's left is connecting the Borg's domains (R1) and its controller (R2), adding title/profile actions (R3) and install storage (R11), and supplying the shared flag (R12). R10 covers the rule for remote store stock.

## Validation scope

The twin tests check metadata, map bounds and spellbooks against API 1. Each adapter gets its own flag and spellbook objects with the same contents, and both map reads see the same level dimensions. Result tests cover failures, missing spellbooks and empty lists, and editing a copied spell leaves the source as it was. The TypeScript boundary scan finds context aliases, destructuring and contexts held in members, and a cast won't hide a read of a member that isn't listed. Reads still count when they use spacing or bracket access, and so do Core exports, CommonJS imports and package subpaths. Members with an engine suffix count too, except for the Borg's delegated `host.engine` group. Text inside comments and strings never counts as a read.

The repository's plugin tests drive the committed bundle with marked and armed characters, and they check that an unmarked character declines before the engine is bound. Deterministic decision and RNG behavior is covered by the foundation tests. None of these tests amounts to a complete game-on/game-off replay comparison, and they don't show rendered Electron parity.
