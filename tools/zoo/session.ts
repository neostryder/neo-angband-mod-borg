// Headless Core/API2 session, originally copied from
// diegoami/neo-angband-tracker 2668adc5ab3e, tools/original-borg/session.ts.
//
// The "ENGINE/" and "BORG/" import prefixes are placeholders that build.mjs
// replaces with the engine checkout and the Borg checkout (here: this
// repository's root). This file is bundled by build.mjs, not compiled by tsc
// (tsconfig.json includes only *.ts and src/**/*.ts).
//
// FORK: message-host.mjs supplies the browser-equivalent event/message host.
// Optional birth/final saves and standalone orchestration extend that host. The host description strings below
// (e.g. "original-source-developer-api2", "Original Borg refused armed birth")
// are kept as-is because borg-zoo's parser reads this record format; they
// describe the host adapter's origin in the tracker toolkit, not this Borg,
// which is whatever commit of this repository --borg-dir points at.
import * as core from "ENGINE/packages/core/dist/index.js";
import {
	createApi2Host,
	disposeApi2Host,
} from "ENGINE/packages/web/src/mod-api2-host.ts";
import { createIntentGate } from "ENGINE/packages/web/src/intent-gate.ts";
import {
	modPluginContext,
	setModComposedRecords,
	setModRegistries,
	setModDriverControl,
} from "ENGINE/packages/web/src/mod-context.ts";
import definition from "BORG/plugin.ts";
import { borgCfg, buffTimerSafetyNetEnabled } from "BORG/src/trait/config.ts";
import { loadPack } from "./pack.ts";
import { installMessageHost } from "./message-host.mjs";
import { installTruthHost } from "./truth-host.mjs";
import * as truthConsent from "ENGINE/packages/web/src/mod-truth-consent.ts";
import { alignedBirth, C_POINT_BUY_PROFILE } from "./alignment/profile.mjs";
import { nativeMenuBirth, C_SEEDED_PROFILE_ID } from "./alignment/seed-startup.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const canonical = (v: any): string =>
	v === null || typeof v !== "object"
		? JSON.stringify(v)
		: Array.isArray(v)
			? "[" + v.map(canonical).join(",") + "]"
			: "{" +
				Object.keys(v)
					.sort()
					.filter((k) => v[k] !== undefined)
					.map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
					.join(",") +
				"}";
export async function run(o: any) {
	const pack = loadPack(o.packDir);
	const birthInputs = alignedBirth(core, pack, o.birthProfile, o.race, o.class);
	const alignmentRng = o.birthProfile ? new core.Rng(o.seed) : null;
	const rngObservations: any[] = [];
	if (alignmentRng) {
		(globalThis as any).__observeBirthRng = (stage: string, rng: any) =>
			rngObservations.push({ stage, ...rng.getState() });
		(globalThis as any).__observeBirthRng("seeded", alignmentRng);
	}
	const seededStartup = o.birthProfile === C_SEEDED_PROFILE_ID;
	if (seededStartup) {
		if (!o.cSeedStartup) throw new Error("Seeded birth requires compiled C startup adapter");
		(globalThis as any).__cSeedBirth = nativeMenuBirth(core, pack, alignmentRng, o.race,
			(globalThis as any).__observeBirthRng);
	}
	let game: ReturnType<typeof core.startGame>;
	try {
	game = core.startGame(pack, {
			...birthInputs,
			...(alignmentRng ? { rng: alignmentRng } : {}),
			seed: o.seed,
			depth: 0,
			...(o.race ? { raceName: o.race } : {}),
			...(o.class ? { className: o.class } : {}),
		});
	} finally {
		if (seededStartup) delete (globalThis as any).__cSeedBirth;
	}
	const state = game.state,
		p = state.actor.player;
	if (o.race && p.race.name !== o.race)
		throw new Error("Assigned race was not born: " + o.race);
	if (o.class && p.cls.name !== o.class)
		throw new Error("Assigned class was not born: " + o.class);
	state.actor.player.noscore |= core.NOSCORE.BORG;
	const flags = Object.fromEntries(
		o.manifest.rules.map((r: any) => [r.flag, r.default]),
	);
	// Same hidden-data grants as original Borg: perceived-monster truth only, never actual map/store stock.
	const grants = {
		has: (name: string) =>
			name === "engine:access" || o.manifest.capabilities.includes(name),
	};
	const records = Object.fromEntries(
		readdirSync(o.packDir)
			.filter((f) => f.endsWith(".json"))
			.flatMap((f) => {
				const v = JSON.parse(readFileSync(join(o.packDir, f), "utf8"));
				return Array.isArray(v.records)
					? [[f.slice(0, -5), v.records]]
					: [];
			}),
	);
	const deps = {
		...state.knownWorldDeps,
		resolver: new core.ContentIdResolver({
			objects: game.booted.registries.objects,
			monsters: game.booted.registries.monsters,
			playerRaces: game.players.races,
			playerClasses: game.players.classes,
		}),
		reg: game.booted.registries.objects,
		describe: (obj: any) =>
			core.describeObject(
				state,
				obj,
				core.ODESC.PREFIX | core.ODESC.FULL,
			),
		describeStore: (obj: any) =>
			core.describeObject(
				state,
				obj,
				core.ODESC.PREFIX | core.ODESC.FULL | core.ODESC.STORE,
			),
		ignored: (obj: any) => state.isIgnored?.(obj) ?? false,
		glyphs: new core.GlyphTable({
			features: game.booted.registries.features.allFeatures(),
			kinds: game.booted.registries.objects.kinds,
			races: game.booted.registries.monsters.races,
			traps: game.booted.registries.traps,
			flavors: game.booted.registries.objects.flavors,
		}).agentGlyphs(),
	};
	let queued: any = null,
		consumed: any = null,
		inputNeeded = false,
		store: number | null = null,
		released: string | null = null,
		callbacks = 0,
		decisions = 0,
		loopCalls = 0,
		maxDepth = 0,
		maxLevel = p.lev,
		commandEvents = 0;
	const messages: any[] = [],
		logs: string[] = [],
		tail: any[] = [],
		census: any = {},
		firstDepthTurns: any = { "0": state.turn },
		hash = createHash("sha256");
	const event = (row: any) => {
		const line = canonical(row) + "\n";
		hash.update(line);
		o.onCommand(line);
		tail.push(row);
		if (tail.length > 100) tail.shift();
		commandEvents++;
	};
	state.nextCommand = () => {
		if (queued) {
			const held = queued;
			queued = null;
			if (core.tokenIsCurrent(state, held.token)) {
				consumed = held.command;
				return consumed;
			}
		}
		inputNeeded = true;
		return null;
	};
	installMessageHost(core, state, (row: { turn: number; text: string }) => {
    messages.push(row);
    o.onMessage?.(row);
    if (messages.length > 200) messages.shift();
  });
	const phase = () =>
		state.isDead ? "dead" : store === null ? "play" : "store";
	const source = {
		state: () => state,
		viewDeps: () => deps,
		phase,
		messagePending: () => false,
		prompt: () => null,
		frame: () => null,
		driver: () => ({ kind: "controller", owner: "borg" }),
		knownLevel: () =>
			core.createAgentView(state, undefined, deps, grants).knownLevel!(),
	};
	const originalGate = createIntentGate({
		state,
		registry: game.registry,
		snapshotSource: source,
		push: (command: any) => {
			queued = { command, token: core.inputToken(state) };
		},
		advance: () => {},
		storeCommand: (command: any) => {
			queued = { command, token: core.inputToken(state) };
			return true;
		},
	});
	const gate = {
		...originalGate,
		submit: (token: any, intent: any) => {
			const result = originalGate.submit(token, intent);
			event({
				type: "intent",
				turn: state.turn,
				intent,
				accepted: result.accepted,
				...(result.accepted
					? {}
					: { reason: result.reason ?? result.code }),
			});
            if (intent.kind === "command" && o.onFrame) {
                const known = core.buildKnownWorld(state, deps, grants), grid = known.player?.grid;
                o.onFrame({ ...known, turn: state.turn, action: intent.command, accepted: result.accepted,
                    messages: messages.slice(-5),
                    level: known.level && { ...known.level, cells: known.level.cells.filter((c: any) =>
                        grid && Math.abs(c.x-grid.x)<=12 && Math.abs(c.y-grid.y)<=12) } });
            }
			if (intent.kind === "command") {
				decisions++;
				census[intent.command.code] =
					(census[intent.command.code] ?? 0) + 1;
			}
			return result;
		},
	};
	let memory: any = null;
	setModRegistries(game.booted.registries);
	setModComposedRecords(records);
	setModDriverControl({
		current: () => ({ kind: "controller", owner: "borg" }),
		setStatus: () => {},
		release: (_id: string) => {},
	});
	const context: any = {
		...modPluginContext(
			"borg",
			flags,
			state,
			{},
			{
				newCharacter: true,
				capabilities: grants,
				prefs: { get: () => memory, set: (v: any) => (memory = v) },
				registries: game.booted.registries,
				snapshotSource: source,
			},
		),
		controllerArmed: true,
		intent: gate,
		log: (s: string) => logs.push(s),
		controller: {
			setStatus: () => {},
			markNondeterministic: () => {
				throw new Error("Unexpected nondeterministic controller");
			},
			release: (reason: string) => {
				released = reason;
				event({ type: "release", turn: state.turn, reason });
			},
		},
	};
	const mod = createApi2Host(context, {
		execution: "in-process",
		developerInProcess: true,
		grants,
		firstParty: { truth: true },
		viewDeps: deps,
		intent: gate,
		installStorage: { get: () => memory, set: (v: any) => (memory = v) },
	});
	const gear = () =>
		[...state.gear.store.entries()].map(([handle, obj]) => ({
			handle,
			location: p.equipment.includes(handle)
				? "equipped"
				: state.gear.quiver?.includes(handle)
					? "quiver"
					: "pack",
			slot: p.equipment.indexOf(handle),
			description: core.describeObject(
				state,
				obj,
				core.ODESC.PREFIX | core.ODESC.FULL,
			),
			tval: obj.tval,
			sval: obj.sval,
			number: obj.number,
			weight: obj.weight,
			timeout: obj.timeout, dd: obj.dd, ds: obj.ds,
			toH: obj.toH, toD: obj.toD, toA: obj.toA,
		}));

	const birth = {
		race: p.race.name,
		class: p.cls.name,
		method: o.birthProfile ? C_POINT_BUY_PROFILE.birth_method : "ordinary startGame roller; assigned race/class only",
		profile: o.birthProfile ?? null,
		stats: [...p.statBirth],
		options: state.options?.snapshot().birth ?? {},
		inventory: gear(),
		gold: p.au,
		hp: p.chp,
		maxHp: p.mhp,
		sp: p.csp, maxSp: p.msp, grid: { ...state.actor.grid },
	};
	if (alignmentRng) {
		const terrain = [];
		for (let y = 0; y < state.chunk.height; y++)
			for (let x = 0; x < state.chunk.width; x++)
				terrain.push(state.chunk.feat({ x, y }));
		o.onState({ kind: "alignment", profile: o.birthProfile, birth,
			options: state.options.snapshot(), rngObservations,
			worldRng: alignmentRng.getState(),
			terrain: { height: state.chunk.height, width: state.chunk.width, terrain } });
		delete (globalThis as any).__observeBirthRng;
	}
	o.onSave?.('birth', core.saveGame(game));
	let lastPeriodic = 0,
		lastDepth = 0;
	const snapshot = (kind: string) => {
		maxDepth = Math.max(maxDepth, state.chunk.depth);
		maxLevel = Math.max(maxLevel, p.lev, p.maxLev);
		firstDepthTurns[state.chunk.depth] ??= state.turn;
		return {
			kind,
			turn: state.turn,
			decisions,
			callbacks,
			loopCalls,
			depth: state.chunk.depth,
			maxDepth,
			level: p.lev,
			maxLevel,
			hp: p.chp,
			maxHp: p.mhp,
			energy: state.actor.energy,
		};
	};
	let lastObservationTurn = -Infinity, lastVitals = "";
    const observeKnown = (kind: string, force = false) => {
        if (!o.onObservation) return;
        const vitals = JSON.stringify([p.chp, p.csp, state.chunk.depth]);
        if (!force && state.turn < lastObservationTurn + 100 && vitals === lastVitals) return;
        const known = core.buildKnownWorld(state, deps, grants);
        const grid = known.player?.grid;
        o.onObservation({ kind, turn: state.turn, player: known.player,
            inventory: known.inventory, equipment: known.equipment, quiver: known.quiver,
            spellbooks: known.spellbooks, monsters: known.monsters,
            level: known.level && { ...known.level, cells: known.level.cells.filter((c: any) =>
                grid && Math.abs(c.x-grid.x)<=12 && Math.abs(c.y-grid.y)<=12) } });
        lastObservationTurn = state.turn; lastVitals = vitals;
    };
    const observe = () => {
        observeKnown("decision-boundary");
		const s = snapshot("periodic");
		if (decisions >= lastPeriodic + 100) {
			o.onState(s);
			lastPeriodic = decisions;
		}
		if (s.depth !== lastDepth) {
			o.onState({ ...s, kind: "depth" });
			lastDepth = s.depth;
		}
	};
	// FORK measurement profile only: match C borg-init.c:418/427's effective
	// pickup options on activation. Historical/default runs remain unchanged.
	if (o.birthProfile)
		for (const [name, value] of Object.entries(C_POINT_BUY_PROFILE.activeOptions))
			state.options.set(name, value);
	// Same observer boundary as native measure_tick: immediately after turn++.
	// Unwind only this isolated measurement, without changing live game state.
	let seededBorgSeed: number | null = null;
	if (seededStartup) (globalThis as any).__cSeedBorg = () => {
		if (seededBorgSeed !== null) throw new Error("Duplicate seeded Borg construction");
		seededBorgSeed = alignmentRng!.randint1(0x10000000);
		return seededBorgSeed;
	};
	const capStop = {};
	if (o.birthProfile && o.exactTickCap)
		(globalThis as any).__alignmentTickCap = (current: any) => {
			if (current === state && state.turn >= o.turns) throw capStop;
		};
	const truthHost = installTruthHost({ state, grants, consent: truthConsent, identity: o.truthIdentity, record: o.onState });
	let error: any = null,
		started = false;
	try {
		const truthReady = await mod.truth?.monsters();
		if (!truthReady?.ok) throw new Error("Zoo monster truth unavailable: " + JSON.stringify(truthReady));
		if (
			!definition.armed?.({
				id: "borg",
				flags,
				armed: true,
				engine: { core, state },
			})
		)
			throw new Error("Original Borg refused armed birth");
		await definition.start?.(mod);
		started = true;
		const failure = logs.find((s) =>
			s.startsWith("the Borg could not start:"),
		);
		if (failure) throw new Error(failure);
		o.onState(snapshot("birth"));
        observeKnown("birth", true);
		if (o.birthProfile) o.onState({ kind: "alignment-active", options: state.options.snapshot(), seededBorgSeed, worldRng: alignmentRng!.getState() });
		while (
			loopCalls < o.decisions &&
			state.turn < o.turns &&
			!state.isDead &&
			released === null
		) {
			consumed = null;
			inputNeeded = false;
			const before = { ...state.actor.grid };
			let status;
			try { status = core.runGameLoop(state, game.registry); }
			catch (e) { if (e === capStop) break; throw e; }
			loopCalls++;
			if (status === core.LOOP_STATUS.LEVEL_CHANGE) {
				game.changeLevel(state.targetDepth ?? state.chunk.depth + 1);
				state.generateLevel = false;
			}
			if (consumed?.code === "shop-exit") store = null;
			else if (
				before.x !== state.actor.grid.x ||
				before.y !== state.actor.grid.y ||
				consumed?.code === "hold"
			) {
				const shop = state.chunk.feature(state.actor.grid).shopnum;
				store =
					shop > 0 && !core.playerIsShapechanged(state)
						? shop - 1
						: null;
			}
			if (store !== null && state.stores?.[store])
				core.observeKnownStore(state, state.stores[store]!, deps);
			observe();
			/* FORK diegoami/neo-angband-borg-mod-tracker#85: an item-choice request
			 * (state.itemRequest) is what a host turns into an API2 "item" prompt.
			 * The Borg names its item on the command (args.tgtitem), so a request
			 * reaches here only for a command that named none, and the Borg's
			 * answer to that prompt is cancel (src/api2/controller.ts promptAnswer).
			 * Record it and cancel, as a host relaying that answer would. */
			if (state.itemRequest) {
				event({
					type: "prompt",
					turn: state.turn,
					kind: "item",
					label: state.itemRequest.prompt,
					answer: "cancel",
				});
				state.itemRequest = null;
			}
			if (
				state.isDead ||
				status === core.LOOP_STATUS.DEAD ||
				status === core.LOOP_STATUS.DEATH_CONFIRM
			)
				break;
			if (status === core.LOOP_STATUS.STOPPED)
				throw new Error("Engine stopped without controller release");
			if (state.turn >= o.turns || loopCalls >= o.decisions) break;
			if (inputNeeded) {
				callbacks++;
				const input = await mod.view.input();
				if (!input.ok) throw new Error(input.message);
				await definition.controller?.(mod, input.value);
			}
		}
	} catch (e) {
		error = String((e as Error).stack ?? e);
	} finally {
		if (seededStartup) delete (globalThis as any).__cSeedBorg;
		if (o.birthProfile && o.exactTickCap) delete (globalThis as any).__alignmentTickCap;
		truthHost.dispose();
		if (started) await definition.stop?.();
		disposeApi2Host(mod);
	}
    observeKnown("final", true);
	o.onSave?.('final', core.saveGame(game));
	const finalKnownWorld = core.buildKnownWorld(state, deps, grants);
	const stop = snapshot("stop");
	o.onState(stop);
	const stall =
		released &&
		(released === "The Borg had no command to give." ||
			released === "The game kept refusing the Borg's commands." ||
			/^The Borg's .+ times running.$/.test(released))
			? { reason: released, turn: state.turn, decisions }
			: null;
	const outcome = error
		? "harness_failure"
		: state.isDead
			? "death"
			: stall
				? "stalled"
				: released
					? "borg_stopped"
					: state.turn >= o.turns
						? "turn_cap"
						: "decision_cap";
	return {
		outcome,
		error,
		seed: o.seed,
		birth,
		settings: flags,
		cfg: { ...borgCfg() },
		crossModFlags: { "bugfix.borgFixes": buffTimerSafetyNetEnabled() },
		...stop,
		causeOfDeath: state.isDead ? p.diedFrom : null,
		stall,
		stopped: stall ? null : released,
		firstDepthTurns,
		commands: census,
		playSha256: hash.digest("hex"),
		commandEvents,
		lastCommands: tail,
		messages,
		logs,
		finalKnownWorld,
		truthUse: truthHost.manifest,
		finalInventory: gear(),
		turnCap: {
			requested: o.turns,
			actual: state.turn,
			overshoot: Math.max(0, state.turn - o.turns),
			unit: "core_game_tick",
			boundary: o.birthProfile && o.exactTickCap ? "exact-tick" : "after-loop",
			normalActionTicks: 10,
			exact: state.turn === o.turns,
			guaranteedExact: Boolean(o.birthProfile && o.exactTickCap),
		},
		profile: {
			name: "original-source-developer-api2",
			host: "original createApi2Host/createIntentGate/buildInputSnapshot",
			store: "Core transaction commands; adapter modal lifecycle",
			unsupported:
				"frontend rendering and browser modal flows; an item-choice request is recorded and cancelled",
			grants: [...o.manifest.capabilities, "engine:access"],
			truth: "original perceived monster/race truth only; no actual map/store stock",
		},
	};
}
