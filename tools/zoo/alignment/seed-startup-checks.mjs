// FORK: native observations, not draw counts copied from the adapter.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import fixture from './native-menu-rng.fixture.json' with {type:'json'};
import { nativeMenuBirth } from './seed-startup.mjs';
import { loadPack } from '../pack.ts';
if (!process.env.ALIGNMENT_ENGINE || !process.env.ALIGNMENT_PACK) throw new Error('Set ALIGNMENT_ENGINE and ALIGNMENT_PACK');
const core=await import(pathToFileURL(resolve(process.env.ALIGNMENT_ENGINE,'packages/core/dist/index.js')));
const pack=loadPack(process.env.ALIGNMENT_PACK);
for(const c of fixture.cases)test(`native birth menu RNG before HP: ${c.race}, seed ${c.seed}`,()=>{
 const rng=new core.Rng(c.seed);
 nativeMenuBirth(core,pack,rng,c.race);
 const actual=rng.getState();
 for(const key of ['state','stateI','quick'])assert.deepEqual(actual[key],c.beforeHp[key],key);
 // The inactive quick stream has its own representation: native starts at 0;
 // Core initializes its dormant value from the supplied seed. Neither is drawn.
 assert.equal(c.beforeHp.value,0);
 assert.equal(actual.value,c.seed);
});
test('missing race fails before consuming the game stream',()=>{
 const rng=new core.Rng(303),before=rng.getState();
 assert.throws(()=>nativeMenuBirth(core,pack,rng,'missing'),/Missing native menu birth race/);
 assert.deepEqual(rng.getState(),before);
});
