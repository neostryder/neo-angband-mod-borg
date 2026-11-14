/** The two retreat passes before borg_escape (borg-caution.c:1280-1649). */
import type { AgentCommand } from "@rpgm-tools/neo-angband-core";
import type { BorgContext } from "../context.js";
import { BI } from "../trait/trait-index.js";
import { trait } from "../item/deps.js";
import { borgDanger, getDangerGlobals } from "../danger/index.js";
import { distance } from "../danger/geometry.js";
import { GOAL_FLEE } from "../world/model.js";
import { BORG_VIEW } from "../world/grid.js";
import type { FlowState, BorgTrack } from "../flow/flow.js";
import { FEAT, borgCaveFloorGrid, borgGotoDir, ddx, ddy, ddx_ddd, ddy_ddd } from "../flow/flow-consts.js";
import { borgFlowStairLess, borgFlowStairMore } from "../flow/flow-stairs.js";
import { borgHappyGridBold } from "../flow/flow-misc.js";
import { getFightState, idiv } from "./state.js";

export function borgDesperateStairs(ctx: BorgContext, flow: FlowState, posDanger: number): AgentCommand | null {
  const w = ctx.world, self = w.self;
  if (!(flow.less.num || flow.more.num) || !(self.goal.fleeing || w.facts.scaryGuyOnLevel ||
      (posDanger > getDangerGlobals(w).avoidance && trait(ctx, BI.CLEVEL) < 35))) return null;

  const stairDistance = (track: BorgTrack): number => {
    let best = -1;
    for (let i = 0; i < track.num; i++) {
      const x = track.x[i]!, y = track.y[i]!;
      if (w.map.at(x, y).kill) continue;
      const d = distance(self.c.y, self.c.x, y, x);
      /* C says "nearest" but retains the FARTHEST unoccupied stair. */
      if (best >= d) continue;
      best = d;
    }
    return best;
  };
  const up = stairDistance(flow.less), down = stairDistance(flow.more);
  const attempt = (less: boolean): AgentCommand | null => {
    flow.borgDesperate = true;
    try {
      return less ? borgFlowStairLess(ctx, flow, GOAL_FLEE, false) :
        borgFlowStairMore(ctx, flow, GOAL_FLEE, false, false);
    } finally {
      flow.borgDesperate = false;
    }
  };
  if (up < 3 && up !== -1 && posDanger < trait(ctx, BI.CURHP)) {
    const cmd = attempt(true); if (cmd) return cmd;
  }
  if (up <= 2 && up !== -1) {
    const cmd = attempt(true); if (cmd) return cmd;
  }
  if (up < 20 && up !== -1 && w.facts.scaryGuyOnLevel && trait(ctx, BI.CLEVEL) < 20) {
    let safe = true;
    for (let i = 0; i < 8; i++) {
      const x = self.c.x + ddx_ddd[i]!, y = self.c.y + ddy_ddd[i]!;
      if (!w.map.inBounds(x, y)) continue;
      const kill = w.map.at(x, y).kill;
      if (kill && w.kills.at(kill).speed > trait(ctx, BI.SPEED)) safe = false;
    }
    // This exception belongs to this arm only; nearby stairs still take priority.
    if (!(trait(ctx, BI.CDEPTH) <= 5 && trait(ctx, BI.CDEPTH) !== 0 && getFightState(w).fightingUnique) && safe) {
      const cmd = attempt(true); if (cmd) return cmd;
    }
  }
  if (down <= 2 && down !== -1) return attempt(false);
  return null;
}

/**
 * FORK: perception uses the host's inView instead of recomputing C's view over
 * screen-scraped terrain. Enumerate those cells in borg_update_view's diagonal,
 * axis, then parallel-strip order (borg-cave-view.c:230-550), so equal-distance
 * retreat candidates retain C's last-wins tie order. The host's visibility and
 * C's own reconstructed visibility can differ. C's declared max_sight is 20;
 * the public constants facade currently has no max_sight field.
 */
function* retreatView(ctx: BorgContext): Generator<{ x: number; y: number }> {
  const { x, y } = ctx.world.self.c;
  const full = 20, over = idiv(full * 3, 2);
  const visible = (xx: number, yy: number) => ctx.world.map.inBounds(xx, yy) &&
    (ctx.world.map.at(xx, yy).info & BORG_VIEW) !== 0;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let d = 1; d <= idiv(full * 2, 3); d++) {
      const xx = x + sx! * d, yy = y + sy! * d;
      if (visible(xx, yy)) yield { x: xx, y: yy };
    }
  }
  for (const [sx, sy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (let d = 1; d <= full; d++) {
      const xx = x + sx! * d, yy = y + sy! * d;
      if (visible(xx, yy)) yield { x: xx, y: yy };
    }
  }
  for (let n = 1; n <= idiv(over, 2); n++) {
    let z = Math.min(over - n - n, full - n);
    while (z + n + (n >> 1) > full) z--;
    for (const [sx, sy, vertical] of [[1, 1, true], [-1, 1, true], [1, -1, true], [-1, -1, true],
      [1, 1, false], [1, -1, false], [-1, 1, false], [-1, -1, false]] as const) {
      for (let d = 1; d <= z; d++) {
        const xx = x + sx * (vertical ? n : n + d), yy = y + sy * (vertical ? n + d : n);
        if (visible(xx, yy)) yield { x: xx, y: yy };
      }
    }
  }
}

export function borgStrategicRetreat(
  ctx: BorgContext, flow: FlowState, posDanger: number, nasty: boolean, surrounded: boolean,
): AgentCommand | null {
  const w = ctx.world, self = w.self, g = getDangerGlobals(w);
  if (!((posDanger > idiv(g.avoidance, 3) && !nasty && !self.noRetreat) || (surrounded && posDanger !== 0)) ||
      g.morgothPosition || w.clock - getFightState(w).tAntisummon < 50 || trait(ctx, BI.ISCONFUSED) ||
      trait(ctx, BI.CURHP) >= 500) return null;
  /* FORK: the public CellView exposes no square_isvault bit. As in borgBackAway,
   * do not substitute the level-wide vaultOnLevel fact for this per-grid test;
   * retreat can therefore be attempted inside a vault where C suppresses it. */

  const bouncing = (x: number, y: number) => {
    const st = flow.step;
    return (trait(ctx, BI.CURHP) >= idiv(trait(ctx, BI.MAXHP) * 7, 10) && st.num > 2 &&
      st.y[st.num - 2] === y && st.x[st.num - 2] === x &&
      st.y[st.num - 3] === self.c.y && st.x[st.num - 3] === self.c.x) ||
      // FORK: the port's existing back-away anti-loop proxy; no distinct C antibounce counter is exposed.
      self.timeThisPanel >= 300;
  };
  let bestRange = -1, bestX = self.c.x, bestY = self.c.y;
  for (const target of retreatView(ctx)) {
    if (!borgCaveFloorGrid(w.map.at(target.x, target.y)) || bouncing(target.x, target.y) ||
        !borgHappyGridBold(ctx, flow, target.y, target.x)) continue;
    if (bestRange >= 0 && (Math.abs(target.x - self.c.x) > bestRange || Math.abs(target.y - self.c.y) > bestRange)) continue;
    let x = self.c.x, y = self.c.y, r = 0;
    while (true) {
      const d = borgGotoDir(w, y, x, target.y, target.x);
      if (d === 0 || d === 5) break;
      r++;
      x += ddx[d]!; y += ddy[d]!;
      if (!w.map.inBounds(x, y) || bouncing(x, y)) break;
      const ag = w.map.at(x, y);
      if (!borgCaveFloorGrid(ag) || (ag.feat === FEAT.LAVA && !trait(ctx, BI.IFIRE)) || r >= 10) break;
      const danger = borgDanger(ctx, y, x, 1, true, false);
      if (danger >= posDanger) break;
      if (r === 1) {
        if (!surrounded || self.goal.ignoring) {
          if (danger >= idiv(trait(ctx, BI.CURHP) * 4, 10) || danger > idiv(posDanger * 5, 10)) break;
        } else if (trait(ctx, BI.CLEVEL) >= 20) {
          if (danger >= (bestRange <= 5 ? idiv(trait(ctx, BI.CURHP) * 15, 10) : trait(ctx, BI.CURHP))) break;
        } else if (danger >= trait(ctx, BI.CURHP) * 4) break;
        /* C's fast-adjacent-monster loop breaks only its INNER loop, then
         * continues the path. It does not reject the grid. Preserve that quirk
         * rather than importing borgBackAway's different fast-monster rule. */
      }
      if (ag.kill || (ag.trap && !ag.glyph)) break;
      if (x === target.x && y === target.y) {
        bestRange = r; bestX = x; bestY = y;
        break;
      }
    }
  }
  if (bestRange < 0) return null;
  const d = borgGotoDir(w, self.c.y, self.c.x, bestY, bestX);
  self.goal.g.x = self.c.x + ddx[d]!;
  self.goal.g.y = self.c.y + ddy[d]!;
  self.goal.type = 0;
  return ctx.act.move(d);
}
