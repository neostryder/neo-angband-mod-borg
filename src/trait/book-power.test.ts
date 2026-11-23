/** C borg-trait.c:2244-2256 and borg-power.c:1768-1829; no engine games. */
import { describe, expect, it } from 'vitest';
import type { ItemView, SpellbookView, LoadoutSimulation } from '@rpgm-tools/neo-angband-core';
import type { BorgContext } from '../context.js';
import { makeScenarioView, makeFakeActions } from '../harness.js';
import { BorgWorld } from '../world/model.js';
import { makeBorgRng } from '../rng.js';
import { makeCoreResolvers } from '../resolvers.js';
import { buildThinkSession, buildStoreDeps } from '../think-session.js';
import { borgThinkHomeSellUseful } from '../store/sell.js';
import { borgBookPossessed } from '../item/magic.js';
import { magicRecords } from '../api2/records.js';
import { borgNotice } from './trait.js';
import { borgPower } from './power.js';
import { borgSimulatePower } from './simulate.js';
import { getDerived } from './state.js';
import { BI } from './trait-index.js';

function item(over: Partial<ItemView> = {}): ItemView {
  return { handle: 1, kindKey: '', aware: true, nameColor: '', label: '[First Spells]',
    tval: 30, sval: 1, pval: 0, number: 1, weight: 30, ac: 0, toA: 0, toH: 0, toD: 0,
    dd: 1, ds: 1, ego: false, artifact: false, flags: [], modifiers: [], brands: [], slays: [],
    resists: [], curses: [], egoName: null, artifactName: null, activation: false, inscription: null, timeout: 0, value: 25, ...over };
}
function book(name = '[First Spells]', level = 1, mana = 1): SpellbookView {
  return { tval: 30, name, realm: 'arcane', spells: [{name: 'Magic Missile', sidx: 0, bidx: 0,
    level, mana, fail: 22, learned: true, worked: false, forgotten: false, studyEligible: false, infoLine: ''}] };
}
function setup(inventory: ItemView[] = [item()], books = [book()], dungeon = false) {
  const base = makeScenarioView({ player: { cls: 'Mage', level: 1, maxLevel: 1, depth: 0,
    maxDepth: 0, hp: 10, maxHp: 10, sp: 2, maxSp: 2 } });
  const kinds = new Map(books.map((b, i) => [b.name, {tval: b.tval, sval: i + 1, dungeon}]));
  const resolvers = makeCoreResolvers({ bookKind: (_tval, name) => kinds.get(name) ?? null });
  const before = {player: base.player(), equipment: Array<ItemView | null>(12).fill(null), inventory, stats: {} as LoadoutSimulation["before"]["stats"]};
  const view = { ...base, inventory: () => inventory, equipment: () => Array<ItemView | null>(12).fill(null),
    spellbooks: () => books, stores: () => [{feat: 0, featName: 'Home', isHome: true,
      owner: {name: 'you', purse: 0}, stock: []}],
    simulateLoadout: (change: Parameters<typeof borgSimulatePower>[1]) => ({before, after: {
      ...before,
      inventory: inventory.flatMap(entry => {
        const removed = change.release?.filter(r => r.handle === entry.handle).reduce((n, r) => n + (r.number ?? entry.number), 0) ?? 0;
        return removed >= entry.number ? [] : [{...entry, number: entry.number - removed}];
      }),
    }, delta: {} as LoadoutSimulation["delta"], placements: [], unresolved: []}),
  };
  const ctx: BorgContext = {world: new BorgWorld(), view, act: makeFakeActions(), rng: makeBorgRng(1), bookKind: resolvers.bookKind};
  borgNotice(ctx); borgPower(ctx);
  const session = buildThinkSession(resolvers); session.ctx = ctx;
  return {ctx, deps: buildStoreDeps(session)};
}
function reward(ctx: BorgContext): number {
  const withBook = borgPower(ctx);
  const counts = getDerived(ctx.world).amtBook;
  const saved = [...counts]; counts.fill(0);
  const withoutBookReward = borgPower(ctx);
  counts.splice(0, counts.length, ...saved); borgPower(ctx);
  return withBook - withoutBookReward;
}

describe('carried class book counts', () => {
  it('counts a shared global sval at its current-class book index; excludes foreign, unaware, empty and cursed non-artifacts', () => {
    const inventory = [item({sval: 2, number: 2}), item({handle: 2, sval: 2, number: 1}),
      item({handle: 3, sval: 9}), item({handle: 4, tval: 31, sval: 2}),
      item({handle: 5, sval: 2, aware: false}), item({handle: 6, sval: 2, number: 0}),
      item({handle: 7, sval: 2, curses: ['CURSED']})];
    const {ctx} = setup(inventory, [book('foreign class-local first'), book('shared second')]);
    expect(getDerived(ctx.world).amtBook).toEqual([0, 3, 0, 0, 0, 0, 0, 0, 0]);
    borgNotice(ctx); expect(getDerived(ctx.world).amtBook[1]).toBe(3);
  });
  it('does not infer a book identity without registered content', () => {
    const {ctx} = setup(); ctx.bookKind = undefined; borgNotice(ctx);
    expect(getDerived(ctx.world).amtBook.every(n => n === 0)).toBe(true);
    expect(reward(ctx)).toBe(0);
  });
});

describe('C book power weights', () => {
  it.each([[1, 6, 500000], [2, 6, 510000], [3, 6, 510000], [2, 5, 500000]])(
    '%i copies with STR%i yield %i', (copies, strength, expected) => {
      const {ctx} = setup([item({number: copies})]); ctx.world.self.trait[BI.STR] = strength;
      expect(reward(ctx)).toBe(expected);
    });
  it.each([[5, 1, 500000], [6, 4, 0], [6, 5, 500000], [6, 6, 500000]])(
    'normal-book minimum level%i at max level%i yields %i', (level, maxLevel, expected) => {
      const {ctx} = setup([item()], [book('[First Spells]', level)]);
      ctx.world.self.trait[BI.MAXCLEVEL] = maxLevel; expect(reward(ctx)).toBe(expected);
    });
  it('rewards each affordable dungeon spell once, without a duplicate-copy reward or a learned requirement', () => {
    const b = book(); b.spells = [b.spells[0]!, {...b.spells[0]!, level: 2},
      {...b.spells[0]!, mana: 3}, {...b.spells[0]!, learned: false}];
    const {ctx} = setup([item({number: 2})], [b], true);
    expect(reward(ctx)).toBe(30000);
    ctx.world.self.trait[BI.MAXCLEVEL] = 2; expect(reward(ctx)).toBe(45000);
    ctx.world.self.trait[BI.MAXSP] = 3; expect(reward(ctx)).toBe(60000);
  });
});

describe('HOME and hypothetical release', () => {
  it('keeps the sole usable book: power falls, HOME refuses, and spell access requires possession', () => {
    const b = item(); const {ctx, deps} = setup([b]);
    expect(borgBookPossessed(ctx, 0)).toBe(true);
    expect(deps.sellHomeBadEval!(ctx, b)).toBeLessThan(ctx.world.self.power);
    expect(borgThinkHomeSellUseful(ctx, deps).chosen).toBe(false);
    expect(getDerived(ctx.world).amtBook[0]).toBe(1); // simulation must not mutate live counts
    expect(borgBookPossessed(setup([]).ctx, 0)).toBe(false);
  });
  it('retains the valued second copy but permits stashing a surplus third', () => {
    const two = item({number: 2}), three = item({number: 3});
    const a = setup([two]);
    expect(reward(a.ctx)).toBe(510000);
    expect(a.deps.sellHomeBadEval!(a.ctx, two)).toBeLessThan(a.ctx.world.self.power);
    expect(borgThinkHomeSellUseful(a.ctx, a.deps).chosen).toBe(false);
    const b = setup([three]);
    expect(b.deps.sellHomeBadEval!(b.ctx, three)).toBe(b.ctx.world.self.power);
    expect(borgThinkHomeSellUseful(b.ctx, b.deps).chosen).toBe(true);
  });
  it('foreign books remain eligible for HOME storage', () => {
    const foreign = item({sval: 8}); const {ctx, deps} = setup([foreign]);
    expect(getDerived(ctx.world).amtBook[0]).toBe(0);
    expect(borgThinkHomeSellUseful(ctx, deps).chosen).toBe(true);
  });
});

it('carries composed dungeon quality through the production content resolver', async () => {
  const api = {content: {
    boundRecords: async () => ({ok: true as const, value: [
      {index: 0, tval: 30, name: '[First Spells]'}, {index: 1, tval: 30, name: '[Arcane Control]'}]}),
    records: async () => ({ok: true as const, value: [{name: 'Mage', book: [
      {name: '[First Spells]', quality: 'town', spell: []}, {name: '[Arcane Control]', quality: 'dungeon', spell: []}]}]}),
  }};
  const records = await magicRecords(api as unknown as Parameters<typeof magicRecords>[0], []);
  expect(records.bookKind(30, '[First Spells]')).toEqual({tval: 30, sval: 1});
  expect(records.bookKind(30, '[Arcane Control]', 'Mage')).toEqual({tval: 30, sval: 2, dungeon: true});
  expect(records.bookKind(30, '[Arcane Control]', 'Other')).toEqual({tval: 30, sval: 2});
  expect(records.bookKind(31, '[Arcane Control]', 'Mage')).toBeNull();
});
