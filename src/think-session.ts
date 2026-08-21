/**
 * The think session: the per-Borg wiring hub that binds the abstract subsystem
 * seams (flow hooks, danger globals, item/store deps, the monster-race and
 * activation resolvers) to the concrete ported subsystems, exactly as the C
 * borg's file-scope globals connected borg_flow / borg_danger / borg_item* /
 * borg_store* to one another.
 *
 * It owns the single persistent Flow (borg_init_flow's scratch state, reused
 * across thinks so track_less/more/glyph and the boredom clock survive), the
 * store anti-loop memory, and the injected resolvers. A ctx holder lets the
 * FlowHooks - whose signatures predate the per-think ctx - reach the live view
 * during a flow; the controller refreshes it at the top of every think.
 *
 * RESOLVER SEAMS (see BorgResolvers). Four facts the ported decision code needs
 * that the frozen AgentView does not carry on its own: a monster race's
 * blow[]/freq/spell_power, an artifact's activation identity, the exact "am I
 * standing in shop N" signal, and borg.power for a loadout the character is not
 * wearing. Each is injected via createBorg's options and defaults to faithful
 * conservative behavior (zero-magnitude danger, no activations, never in a shop,
 * no gain from an unevaluated swap/buy/sell) so the Borg is correct-but-cautious
 * until a host wires real engine data. `makeCoreResolvers` (resolvers.ts) is the
 * host side of all four.
 *
 * The fourth one fans out here rather than at the seam, because ONE hypothetical
 * -loadout evaluator answers seven different questions the ported subsystems ask
 * in seven different shapes (wearEval, buyShopEval, buyHomeEval, sellEval,
 * sellHomeBadEval, and the two swap valuations that this port has nothing to
 * value). Translating each into a loadout change belongs beside the wiring, not
 * in every host that wires it.
 */

import type { ItemView } from "@rpgm-tools/neo-angband-core";
import type { BorgLoadoutChange, BorgLoadoutRef } from "./trait/simulate.js";
import type { BorgContext } from "./context.js";
import type { FactsResolver } from "./danger/index.js";
import {
  borgDanger,
  borgLos,
  getDangerGlobals,
  getFearCaches,
  getDangerState,
} from "./danger/index.js";
import type { Flow, FlowHooks } from "./flow/index.js";
import type { WearDeps } from "./item/index.js";
import { createFlow } from "./flow/index.js";
import { BI } from "./trait/index.js";
import { borgPrepared } from "./trait/index.js";
import {
  borgCountSell,
  borgFirstEmptyInventorySlot,
  createStoreMemory,
  type StoreDeps,
  type StoreMemory,
} from "./store/index.js";
import {
  Spell,
  borgReadScroll,
  borgSpell,
  borgSpellLegal,
  borgSpellOkayFail,
  SVAL,
} from "./item/index.js";
import type { BorgWorld } from "./world/model.js";

/**
 * Injection points a host supplies via createBorg. All optional; each defaults
 * to the faithful conservative behavior documented on the field.
 */
export interface BorgResolvers {
  /**
   * Resolve a tracked kill index to its full MonsterFacts (r_info blow[]/freq/
   * spell_power/...). Default: MonsterView-derived facts with zero blows/freq
   * (borg_danger sees no melee/spell threat). Wire this for real danger.
   */
  resolveMonsterFacts?: FactsResolver;
  /**
   * borg_equips_item(act, checkCharge): does the borg wear an item granting the
   * named activation (a charged one when checkCharge). Default: false.
   */
  resolveActivation?: (
    ctx: BorgContext,
    act: string,
    checkCharge: boolean,
  ) => boolean;
  /** borg_activate_item(act) -> the gear handle to activate, or null. */
  activateHandle?: (ctx: BorgContext, act: string) => number | null;
  /**
   * square_shopnum: the shop number (0..7, 7 = home) the borg is standing in,
   * or null when not in a shop. The frozen view has no in-shop signal, so this
   * defaults to null (the borg never enters shop-interaction mode without a
   * host-supplied signal). Town flow-to-shop still works from the ladder.
   */
  inShop?: (ctx: BorgContext) => number | null;
  /**
   * borg.power for a loadout the borg is NOT wearing: the wear / buy / sell
   * decisions all diff borg.power across a hypothetical change, which upstream
   * gets by wielding the candidate and recomputing. Returns null when the engine
   * cannot describe such a loadout, which is what "conservative default" means
   * here - the callers then see no improvement and the borg wears, buys and sells
   * nothing on the player-power path. See trait/simulate.ts.
   */
  loadoutPower?: (
    ctx: BorgContext,
    change: BorgLoadoutChange,
  ) => number | null;
  /** OPT(player, birth_force_descend): the level cannot be climbed. */
  forceDescend?: boolean;
}

/** Default resolvers: every seam inert / conservative. */
export function defaultResolvers(): BorgResolvers {
  return {};
}

/** The per-Borg wiring hub. */
export interface ThinkSession {
  /** The single persistent flow (track lists + boredom clock live here). */
  readonly flow: Flow;
  /** The store anti-loop memory (recordSold / recordBought). */
  readonly storeMem: StoreMemory;
  /** The injected host resolvers. */
  readonly resolvers: BorgResolvers;
  /** The live decision context for this think (refreshed by the controller). */
  ctx: BorgContext | null;
}

/** Build the persistent flow hooks, closing over the session's ctx holder. */
function buildFlowHooks(session: ThinkSession): FlowHooks {
  const ctx = (): BorgContext => {
    if (!session.ctx) throw new Error("borg flow hook used outside a think");
    return session.ctx;
  };
  return {
    danger: (_world, y, x) => borgDanger(ctx(), y, x, 1, true, false),
    canDigMagic: (_world, checkFail) => {
      const c = ctx();
      if (checkFail) {
        return (
          borgSpellOkayFail(c, Spell.TURN_STONE_TO_MUD, 40) ||
          borgSpellOkayFail(c, Spell.SHATTER_STONE, 40)
        );
      }
      return (
        borgSpellLegal(c, Spell.TURN_STONE_TO_MUD) ||
        borgSpellLegal(c, Spell.SHATTER_STONE)
      );
    },
    hasDistanceAttack: (_world) => {
      // Proxy for borg_has_distance_attack: the borg can shoot if it has shots
      // (a launcher + ammo). A real ranged-damage evaluator can replace this.
      return (ctx().view.player().shots ?? 0) > 0;
    },
    layGlyph: (c) =>
      borgSpell(c, Spell.GLYPH_OF_WARDING) ??
      borgReadScroll(c, SVAL.scroll.rune_of_protection!),
    forceDescend: session.resolvers.forceDescend ?? false,
    preparedToDescend: (world) =>
      borgPrepared(ctx(), (world.self.trait[BI.CDEPTH] ?? 0) + 1) === null,
    countSell: (_world) => borgCountSell(ctx(), buildStoreDeps(session)),
    packFull: (_world) => borgFirstEmptyInventorySlot(ctx()) < 0,
    monsterHasFlag: (_world, killIndex, flag) => {
      const facts = getDangerState(ctx().world).globals.resolveFacts(
        ctx(),
        killIndex,
      );
      return facts.flags.has(flag);
    },
    los: (world, y1, x1, y2, x2) => borgLos(world, y1, x1, y2, x2),
  };
}

/**
 * The gear reference for a store ware: the shop's index in `view.stores()` and
 * the ware's own index in that shop's stock. A ware is NOT in the gear, so it has
 * no handle - this is its only address (see BorgLoadoutRef).
 */
function wareRef(store: number, item: ItemView & { index: number }): BorgLoadoutRef {
  return { from: "store", store, index: item.index };
}

/**
 * borg.power for a loadout change, or the CURRENT power when this engine cannot
 * answer. Every eval below funnels through here, because "no answer" and "no
 * improvement" have to look the same to the ported decision code: each of those
 * decisions compares the result against borg.power and acts only on a gain, so
 * handing back the current power is exactly the conservative default the seam
 * documents.
 */
function powerOf(
  session: ThinkSession,
  ctx: BorgContext,
  change: BorgLoadoutChange,
): number {
  const answer = session.resolvers.loadoutPower?.(ctx, change);
  return answer ?? ctx.world.self.power;
}

/**
 * Build the item/consumable deps for this think from ctx + danger state.
 *
 * WearDeps rather than ItemDeps, because `wearEval` is declared on the wear
 * subsystem's own extension of the bundle and this builder fills it. Typing the
 * return as the narrower ItemDeps would leave the field present at runtime and
 * invisible to every call site, which is the shape of the bug this whole file is
 * closing rather than one to add.
 */
export function buildItemDeps(session: ThinkSession): WearDeps {
  const c = session.ctx;
  if (!c) throw new Error("buildItemDeps outside a think");
  const w = c.world;
  const py = w.self.c.y;
  const px = w.self.c.x;
  const dangerHere = borgDanger(c, py, px, 1, true, false);
  const fear = getFearCaches(w);
  const res = session.resolvers;
  return {
    danger: dangerHere,
    avoidance: w.self.trait[BI.CURHP] ?? 0,
    canRest: true,
    clock: w.clock,
    fearRegion: fear.region(py, px),
    ...(res.resolveActivation
      ? {
          equipsItem: (act: string, checkCharge: boolean) =>
            res.resolveActivation!(c, act, checkCharge),
        }
      : {}),
    ...(res.activateHandle
      ? { activateItem: (act: string) => res.activateHandle!(c, act) }
      : {}),
    ...(res.loadoutPower
      ? {
          /* borg_wear_stuff (wear.c:858): the power if this pack item were worn.
           * The engine picks the slot, so a ring goes to the hand wield_slot
           * would put it in rather than to a hand this code guessed at. */
          wearEval: (item: ItemView) =>
            powerOf(session, c, {
              wield: [{ from: "gear", handle: item.handle }],
            }),
        }
      : {}),
  };
}

/** Build the store deps for this think (shares the anti-loop memory). */
export function buildStoreDeps(session: ThinkSession): StoreDeps {
  const res = session.resolvers;
  if (!res.loadoutPower) return { mem: session.storeMem };
  return {
    mem: session.storeMem,
    /* borg_think_shop_buy_useful (borg-store-buy.c:363/388). A ware the borg
     * would WIELD is worn; anything else joins the pack. Both cost their weight,
     * which is what makes plate armour read as the speed loss it is. */
    buyShopEval: (ctx, sim) => {
      const ref = wareRef(sim.store, sim.item);
      if (!sim.wields) {
        return powerOf(session, ctx, { carry: [{ item: ref, number: sim.qty }] });
      }
      return powerOf(session, ctx, {
        wield: [ref],
        ...(sim.qty > 1
          ? { carry: [{ item: ref, number: sim.qty - 1 }] }
          : {}),
      });
    },
    /* borg_think_home_buy_useful: the same question about the home's shelves,
     * which are a store like any other (index BORG_HOME in view.stores()). */
    buyHomeEval: (ctx, sim) => {
      const ref = wareRef(sim.store, sim.item);
      if (!sim.wields) {
        return powerOf(session, ctx, { carry: [{ item: ref, number: sim.qty }] });
      }
      return powerOf(session, ctx, { wield: [ref] });
    },
    /* borg_think_shop_sell_useless: the power once `qty` of this stack is gone.
     * `release` empties a body slot when the handle names worn gear, so selling
     * the amulet the borg has on is one change rather than a remove and a sale. */
    sellEval: (ctx, item, qty) =>
      powerOf(session, ctx, {
        release: [{ handle: item.handle, number: qty }],
      }),
    /* borg_think_home_sell_bad (borg-store-sell.c:376) asks about ONE of a
     * stack, not the whole stack. */
    sellHomeBadEval: (ctx, item) =>
      powerOf(session, ctx, {
        release: [{ handle: item.handle, number: 1 }],
      }),
    /* weaponSwapEval / armourSwapEval are deliberately NOT wired. They value a
     * home ware as the borg's SWAP weapon or armour, and this port has no swap
     * subsystem: weapon_swap_value and armour_swap_value contribute 0 to
     * borgPower (trait/power.ts), so an evaluator here would compare two numbers
     * that are equal by construction and buy on the tiebreak. Unreachable until
     * the swap subsystem is ported, not merely unwired. */
  };
}

/** Create a fresh think session with the given resolvers. */
export function buildThinkSession(resolvers: BorgResolvers = {}): ThinkSession {
  const session: ThinkSession = {
    flow: undefined as unknown as Flow,
    storeMem: createStoreMemory(),
    resolvers,
    ctx: null,
  };
  (session as { flow: Flow }).flow = createFlow(buildFlowHooks(session));
  return session;
}

const SESSIONS = new WeakMap<BorgWorld, ThinkSession>();

/**
 * The think session for a world, created lazily with default (inert) resolvers.
 * The controller pre-installs one carrying the host resolvers via
 * installThinkSession; direct test calls to think() get this default.
 */
export function getThinkSession(world: BorgWorld): ThinkSession {
  let s = SESSIONS.get(world);
  if (!s) {
    s = buildThinkSession();
    SESSIONS.set(world, s);
  }
  return s;
}

/** Install a pre-built session for a world (controller wiring). */
export function installThinkSession(
  world: BorgWorld,
  session: ThinkSession,
): void {
  SESSIONS.set(world, session);
}

/**
 * Set the per-think danger globals the C toggles around maneuvers
 * (avoidance = current HP, the facts resolver, the flow avoidance mirror), then
 * refresh the session ctx holder. Call at the top of every think.
 */
export function primeSession(session: ThinkSession, ctx: BorgContext): void {
  session.ctx = ctx;
  const w = ctx.world;
  const g = getDangerGlobals(w);
  const curhp = w.self.trait[BI.CURHP] ?? 0;
  g.avoidance = curhp;
  if (session.resolvers.resolveMonsterFacts) {
    g.resolveFacts = session.resolvers.resolveMonsterFacts;
  }
  session.flow.state.avoidance = curhp;
  session.flow.state.hooks.forceDescend = session.resolvers.forceDescend ?? false;
}
