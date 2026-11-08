/**
 * Borg controller: an AgentController (the frozen decision seam) backed by
 * the Borg's world model, private RNG, and think ladder. This is what a host
 * installs via installController to hand the game over to the Borg.
 *
 * Per-think cycle (mirrors borg_think, borg-think.c:138-467):
 *   1. advance the Borg clock exactly once and the panel clock (:446).
 *   2. borgNotice: fill self.trait[] / power inputs from the view (:453).
 *   3. perceive: fold the current view into the world model, incl. the message
 *      stream and staleness/expiry (borg_update, :456), then run borg_update's
 *      own tail - forget monsters that are demonstrably not where the Borg left
 *      them (:2902), and re-stamp the monster fear cache (:2990).
 *   4. borgPower: score the current world (:459).
 *   5. track MAXCLEVEL / MAXDEPTH and the per-level "began" clock (:438).
 *   6. prime the wiring session (danger globals, flow avoidance) and think:
 *      run the store or dungeon ladder, returning one command (or null).
 *
 * The controller is deterministic: it draws only its own private RNG, so a host
 * installs it WITHOUT nondeterministic:true and the save's determinism ratchet
 * stays untripped - a faithful, replayable autoplayer. Determinism comes from
 * the stream being private and seeded, not from restarting it: the stream runs
 * continuously across thinks, exactly as borg_rand_local does (see rng.ts).
 */

import type { AgentController } from "@rpgm-tools/neo-angband-core";
import { BorgWorld } from "./world/model.js";
import { makeBorgRng, type Rng } from "./rng.js";
import { perceive, makePerceiveMemo, borgForgetGoalWhileImpaired } from "./perceive.js";
import { buildHitByTable, buildSpellTable } from "./perceive-messages.js";
import { borgUpdateMonsterFear } from "./danger/index.js";
import { borgFollowMissingKills } from "./flow/index.js";
import { borgTrackStep } from "./flow/flow.js";
import { borgTrackStairs } from "./flow/flow-stairs.js";
import { think } from "./think.js";
import { borgNotice, borgPower, borgCfg, setBorgCfg, BI, type BorgCfg } from "./trait/index.js";
import { getFightState } from "./fight/index.js";
import type { BorgContext } from "./context.js";
import { hostController } from "./core-api.js";
import {
  buildThinkSession,
  installThinkSession,
  primeSession,
  type BorgResolvers,
} from "./think-session.js";

/** Options for building a Borg. */
export interface BorgOptions {
  /**
   * Starting seed for the Borg's private simulation RNG (default
   * BORG_LOCAL_SEED). The stream then runs continuously for the life of the
   * Borg, matching borg_rand_local; it is never restarted mid-session.
   */
  rngSeed?: number;
  /**
   * Host-supplied resolver seams for engine data the frozen AgentView cannot
   * surface: the monster-race danger resolver, artifact activation identity, the
   * "am I in shop N" signal, and the birth_force_descend option. All optional;
   * each defaults to faithful conservative behavior (see BorgResolvers).
   */
  resolvers?: BorgResolvers;
  /**
   * The player's `borg_cfg[]` settings, over the stock borg.txt defaults. Every
   * key is optional and an unsupplied one keeps upstream's own default, so a
   * caller that passes nothing gets a stock Borg.
   *
   * Installed into the module-level active settings (`setBorgCfg`) rather than
   * carried on the Borg, because the ported decision code reads them the way the
   * C does - see src/trait/config.ts. One Borg per session, so one set of
   * settings per session.
   */
  cfg?: Partial<BorgCfg>;
}

/** A live Borg: its world model, RNG, and the controller to install. */
export interface Borg {
  /** Borg's remembered world (inspectable by tests / a debug HUD). */
  world: BorgWorld;
  /** Borg's private simulation RNG. */
  rng: Rng;
  /** The controller to hand to installController. */
  controller: AgentController;
  /**
   * Undo what the last decision did to the Borg's own counters (the clocks and
   * the arrival latch) and mark its retry as sharing the same position entry.
   * A host whose reads arrive after the decision that wanted them
   * (API 2 loadout simulations) decides again with the answers in hand; without
   * this each extra pass would age the Borg's clock by one more turn.
   */
  rewind(): void;
}

const CONTROLLER_WORLDS = new WeakMap<AgentController, BorgWorld>();

/** The controller owns its recall prompt answer (borg-escape.c:63-115). */
export function recallDepthAnswer(controller: AgentController): boolean {
  return CONTROLLER_WORLDS.get(controller)?.resetRecallDepth ?? false;
}

/**
 * Build a Borg. The returned controller is stateful (owns the world model,
 * perception memo, and wiring session), so build one Borg per game session.
 */
export function createBorg(opts: BorgOptions = {}): Borg {
  const world = new BorgWorld();
  const rng = makeBorgRng(opts.rngSeed);
  const memo = makePerceiveMemo();

  /* The player's settings, before anything reads them. borg_init.c does the same
   * thing in the same order: read the config, then build the borg. */
  setBorgCfg(opts.cfg ?? {});

  /* borg_plays_risky reaches the two tactical arms through the fight state
   * rather than through resolveOpts, because borg_caution and borg_escape read
   * the live struct upstream too. Copied once here, at the only moment the
   * setting can change, so a think cannot see it move. */
  getFightState(world).playsRisky = borgCfg().playsRisky;

  /* Install the wiring session carrying the host resolvers so think() picks it
   * up (getThinkSession) with real seams instead of the inert defaults. */
  const session = buildThinkSession(opts.resolvers ?? {});
  installThinkSession(world, session);

  /* suffix_hit_by, built once (borg_init_messages runs at borg start-up, not per
   * think). Empty when the host supplied no blow methods. */
  const blows = buildHitByTable(session.resolvers.blowActions ?? []);
  const spells = buildSpellTable(session.resolvers.spellMessages ?? []);
  const tables = { hitBy: blows.hitBy, spell: spells.spell, spellInvisible: spells.spellInvisible };

  let lastDepth = -1;
  let retry = false;
  let before = { lastGrid: session.lastGrid, arrival: session.arrivalPickup,
    rechargeRest: session.rechargeRest ?? false, ringTakeoff: session.ringTakeoff ?? false,
    panel: 0, store: false, resetLevel: world.resetLevel, junked: new Set(session.junked),
    needAlter: false, noAlter: false };

  /* The host's view and actions arrive wrapped by the adapter (core-api.ts). */
  const controller: AgentController = hostController((view, act) => {
    const ctx: BorgContext = { world, view, act, rng, bookKind: session.resolvers.bookKind, spellEffect: session.resolvers.spellEffect };
    const recordStep = !retry;
    retry = false;
    before = { lastGrid: session.lastGrid, arrival: session.arrivalPickup,
      rechargeRest: session.rechargeRest ?? false, ringTakeoff: session.ringTakeoff ?? false,
      panel: world.self.timeThisPanel, store: false, resetLevel: world.resetLevel, junked: new Set(session.junked),
      needAlter: world.self.needAlter, noAlter: world.self.noAlter };

    /* Unknown recall effects keep the depth (borg-messages-react.c:229-242). */
    world.resetRecallDepth = false;

    /* A store decision returns before borg_update (borg-think.c:324-369): the C notices
     * the character and scores the world, then runs the store ladder. The clocks, the
     * map, and the monster and object records stay as they were, because the screen the
     * Borg is looking at is the store, not the level. */
    const shopNum = session.resolvers.inShop?.(ctx) ?? null;
    if (shopNum !== null && shopNum >= 0) {
      before.store = true;
      borgNotice(ctx);
      world.self.power = borgPower(ctx);
      return think(ctx);
    }

    /* 1. Advance the clocks exactly once (borg-think.c:447). */
    world.clock += 1;
    world.self.timeThisPanel += 1;

    /* 1b. Handle new levels (borg-update.c:2009-2190). This runs BEFORE
     * perception, because everything perception writes is stamped with the
     * clock and the clock is one of the things a new level resets. */
    const depth = view.player().depth;
    if (world.resetLevel || depth !== lastDepth) {
      const fs = getFightState(world);
      /* borg_time_town: time since the last visit to town, accumulated across
       * every level in between (:2011-2014). Leaving town zeroes it. Nothing
       * had ever written it, so the two arms that read it - the restock grace
       * in borg_caution and the bravery boost in borg_attack - were measuring
       * time on the current level instead. */
      if (!world.resetLevel && lastDepth <= 0) fs.timeTown = 0;
      else fs.timeTown += world.clock - fs.began;

      /* Restart the clock (:2017). Upstream's borg_t is a PER-LEVEL counter,
       * and every absolute test against it is written for that: the 12000 and
       * 25000 message-flush hacks, the 20000 monster-record purge, and
       * borg_think_dungeon's own "clock overflow" panic at 30000, which hands
       * the game back to a human. A clock that only ever climbs turns the last
       * of those into a Borg that stops deciding for good after 30000
       * decisions, and the others into events that fire once and never again. */
      world.clock = 1000;
      session.flow.state.borgTAntisummon = 0;
      fs.tAntisummon = 0;
      fs.began = world.clock;
      session.flow.state.borgBegan = world.clock;

      /* Nothing is known about this level yet (:2165-2183). The location
       * tracks live on the flow rather than on the world, so wipeLevel cannot
       * reach them; left standing they hold the PREVIOUS level's coordinates,
       * and the short-leash rung measures the distance from the character to a
       * staircase on a level it is no longer on. At character level one that
       * leash is seventeen grids, so the Borg decided it had wandered too far
       * on its first think of every level and turned straight back. */
      const st = session.flow.state;
      st.less.wipe();
      st.more.wipe();
      st.step.wipe();
      st.door.wipe();
      st.closed.wipe();
      st.glyph.wipe();
      st.vein.wipe();
      /* Level updates clear purchase and sale records (borg-update.c:2040-2056). */
      const mem = session.storeMem;
      mem.soldNum = mem.boughtNum = 0;
      mem.soldNxt = mem.boughtNxt = 1;
      for (const records of [mem.soldTval, mem.soldSval, mem.soldPval, mem.soldStore,
        mem.boughtTval, mem.boughtSval, mem.boughtPval, mem.boughtStore]) {
        records.length = 10;
        records.fill(0);
      }
      session.junked.clear();
      before.junked.clear();
      before.panel = 0;
      before.resetLevel = false;

      lastDepth = depth;
    }

    /* 2. Fill the self-model traits (borg_notice, :453). */
    borgNotice(ctx);

    /* 3. Fold the view (map/monsters/objects/messages) into the world (:456). */
    perceive(world, view, memo, tables, {
      kindCost: session.resolvers.kindCost,
      junked: session.junked,
    }, (i) => session.resolvers.resolveMonsterFacts?.(ctx, i).dChar);

    /* borg-update.c:491-525 tracks newly known stairs on every decision. */
    borgTrackStairs(world, session.flow.state);

    /* borg-update.c:2466-2479 records after the map update. Loadout retries
     * share the decision's entry, matching one borg_update per dungeon decision
     * (borg-think.c:455-456). Store decisions return before borg_update
     * (borg-think.c:324-369). */
    if (recordStep) {
      borgTrackStep(session.flow.state.step, world.self.c.y, world.self.c.x);
    }

    /* 3b. The tail of borg_update, in its own order. The wiring session is
     * primed first because both steps need the host's monster-race resolver;
     * think() primes it again, which is idempotent.
     *  - :2902 forget or follow monsters the Borg can now see are not where it
     *    left them, which is the only thing that removes a phantom.
     *  - :2990 re-stamp the monster fear cache from the surviving records.
     * Nothing may read borg_danger between perceive and here. */
    primeSession(session, ctx);
    borgFollowMissingKills(ctx, session.flow.state);
    borgUpdateMonsterFear(ctx);
    borgForgetGoalWhileImpaired(world);

    /* Messages must compare damage with the preceding update's HP. */
    world.self.oldchp = world.self.trait[BI.CURHP] ?? 0;

    /* 4. Score the world (borg_power, :459). */
    world.self.power = borgPower(ctx);

    /* 5. Running maxima (:438, borg_update). The per-level clocks are reset in
     * step 1b, before perception stamps anything with them. */
    const t = world.self.trait;
    if ((t[BI.CLEVEL] ?? 0) > (t[BI.MAXCLEVEL] ?? 0)) t[BI.MAXCLEVEL] = t[BI.CLEVEL]!;
    if ((t[BI.CDEPTH] ?? 0) > (t[BI.MAXDEPTH] ?? 0)) t[BI.MAXDEPTH] = t[BI.CDEPTH]!;

    /* 5b. The arrival latch the pickup rung rides on (see borgPickUpHere).
     * Stepping somewhere new opens it; any command other than a pickup closes
     * it, so collecting can only ever happen on arrival, which is the one thing
     * upstream's pickup_always guarantees and a standing rung does not. */
    const at = `${String(world.facts.depth)}:${String(world.self.c.x)},${String(world.self.c.y)}`;
    if (at !== session.lastGrid) {
      session.lastGrid = at;
      session.arrivalPickup = true;
    }

    /* 6. Decide (store or dungeon ladder). */
    const cmd = think(ctx);
    if (cmd?.code !== "pickup") session.arrivalPickup = false;
    return cmd;
  });

  const rewind = (): void => {
    retry = true;
    /* A retry keeps the level transition and repeats the decision at the same
     * level clock. The panel snapshot also covers borg_dump_quiver's increment.
     * A store decision never advanced the clock, so there is nothing to give back. */
    if (!before.store) world.clock -= 1;
    world.self.timeThisPanel = before.panel;
    world.self.needAlter = before.needAlter;
    world.self.noAlter = before.noAlter;
    session.lastGrid = before.lastGrid;
    session.arrivalPickup = before.arrival;
    /* borg-junk.c:1224-1241 and borg-item-wear.c:1516-1528 queue side
     * effects with their commands. A discarded decision restores them. */
    session.rechargeRest = before.rechargeRest;
    world.resetLevel = before.resetLevel;
    session.ringTakeoff = before.ringTakeoff;
    session.junked.clear();
    for (const key of before.junked) session.junked.add(key);
  };

  CONTROLLER_WORLDS.set(controller, world);
  return { world, rng, controller, rewind };
}
