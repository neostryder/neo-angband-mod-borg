import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "@rpgm-tools/neo-angband-core";
import { installMessageHost } from "./message-host.mjs";

test("installs the real bus before context creation and forwards repeated messages once each", () => {
  const state = { turn: 10 }, recorded = [], received = [];
  installMessageHost(core, state, (row) => recorded.push(row));
  assert.ok(state.events instanceof core.GameEvents);
  state.events.on("message", (_type, event) => received.push(event));
  state.msg("Something touches you.");
  state.turn = 20;
  state.msg("Something touches you.");
  assert.deepEqual(received, [
    { msg: "Something touches you.", type: core.messageTypeCode() },
    { msg: "Something touches you.", type: core.messageTypeCode() },
  ]);
  assert.deepEqual(recorded, [
    { turn: 10, text: "Something touches you." },
    { turn: 20, text: "Something touches you." },
  ]);
});
test("keeps typed messages and the rolling log consistent with the browser sink", () => {
  const stored = [], received = [];
  const state = { turn: 7, messages: { add: (...args) => stored.push(args) } };
  installMessageHost(core, state, () => {});
  state.events.on("message", (_type, event) => received.push(event));
  state.msg("You miss the orc.", "MISS");
  assert.deepEqual(stored, [["You miss the orc.", core.messageTypeCode("MISS")]]);
  assert.deepEqual(received, [{ msg: "You miss the orc.", type: core.messageTypeCode("MISS") }]);
});
test("uses the same rendered message for the event and evidence", () => {
  const recorded = [], received = [];
  const state = { turn: 8, modHooks: { messageText: (raw) => raw + "!" } };
  installMessageHost(core, state, (row) => recorded.push(row));
  state.events.on("message", (_type, event) => received.push(event.msg));
  state.msg("A message");
  assert.deepEqual(received, ["A message!"]);
  assert.deepEqual(recorded, [{ turn: 8, text: "A message!" }]);
});
test("refuses an already hosted state instead of overwriting or duplicating it", () => {
  for (const state of [{ events: new core.GameEvents() }, { msg: () => {} }]) {
    const original = { ...state };
    assert.throws(() => installMessageHost(core, state, () => {}), /fresh unhosted/);
    assert.deepEqual(state, original);
  }
});
