/**
 * The store screen a host opens and closes, for tests that drive the engine
 * directly.
 *
 * The engine has no store screen: stepping onto a shop door, or holding still
 * on one, disturbs the player and stops there (player_handle_post_move,
 * cmd-cave.c:1599-1607), and opening the screen is the host's (enterStoreModal
 * in the web shell). `shop-exit` closes it again and leaves the character on
 * the door. The Borg takes its store branch only while that screen is up
 * (borg-think.c:322-327), so a driver without a screen would have to answer
 * "in a shop" for every turn spent on a door, including the turns after
 * leaving one. This plays the host's part: open on arrival or hold, closed by
 * `shop-exit` or by walking away.
 */

interface ScreenState {
  actor: { grid: { x: number; y: number } };
  chunk: { feature(grid: { x: number; y: number }): { shopnum: number } };
}

interface Issued {
  code: string;
}

export interface StoreScreen {
  /** The store index (0..7, 7 = home) whose screen is open, or null. */
  shopnum(): number | null;
  /** Call with each command the controller issues, before the engine runs it. */
  issued(command: Issued | null): void;
  /** Open the screen for a character placed straight onto a door, as a host does on arrival. */
  enter(): void;
}

export function storeScreen(state: ScreenState): StoreScreen {
  let open = false;
  let pending: { code: string; x: number; y: number } | null = null;

  const doorHere = (): number => state.chunk.feature(state.actor.grid).shopnum;

  /** Settle the last command now that the engine has run it. */
  const settle = (): void => {
    if (pending === null) return;
    const { code, x, y } = pending;
    pending = null;
    const here = state.actor.grid;
    const moved = here.x !== x || here.y !== y;
    if (code === "shop-exit") open = false;
    else if (doorHere() <= 0) open = false;
    else if ((code === "walk" && moved) || code === "hold") open = true;
  };

  return {
    shopnum() {
      settle();
      const shop = doorHere();
      return open && shop > 0 ? shop - 1 : null;
    },
    issued(command) {
      settle();
      if (command) pending = { code: command.code, x: state.actor.grid.x, y: state.actor.grid.y };
    },
    enter() {
      pending = null;
      open = doorHere() > 0;
    },
  };
}
