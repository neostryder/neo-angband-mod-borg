/**
 * FORK: headless equivalent of the pinned browser's message sink
 * (engine main.ts:3115-3137,12995-12999). Install BEFORE modPluginContext:
 * API2 takes its event subscription facade from GameState.events at creation.
 */
export function installMessageHost(core, state, record) {
  // A fresh startGame has neither. If Core grows its own host, review its
  // forwarding instead of silently delivering every message twice.
  if (state.events || state.msg) throw new Error("Zoo message host requires a fresh unhosted game");
  const events = new core.GameEvents();
  state.events = events;
  state.msg = (raw, type) => {
    const text = state.modHooks?.messageText?.(raw) ?? raw;
    const code = core.messageTypeCode(type);
    state.messages?.add(text, code);
    events.emit("message", { msg: text, type: code });
    record({ turn: state.turn, text });
  };
}
