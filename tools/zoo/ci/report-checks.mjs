import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate,render,portableReport } from './report.mjs';
import { loadSuite,shardCases } from './suite.mjs';
const suite=loadSuite(new URL('./suites/smoke-v1.json',import.meta.url));
const row=c=>({...c,suite:suite.id,outcome:'death',turn:42,level:1,maxDepth:1,cause:'a rat | <tag> `text`'});
test('shards partition the frozen suite exactly once',()=>{
 assert.deepEqual(Array.from({length:4},(_,i)=>shardCases(suite,i,4)).flat().map(c=>c.id).sort(),suite.cases.map(c=>c.id).sort());
 assert.throws(()=>shardCases(suite,4,4));
});
test('missing cells are counted as failures rather than dropped',()=>{
 const report=aggregate(suite,[row(suite.cases[0])]);assert.equal(report.assigned,18);assert.equal(report.recorded,1);assert.equal(report.counts.death,1);assert.equal(report.counts.harness_failure,17);
});
test('duplicate and wrong-birth rows cannot create successful coverage',()=>{
 const a=row(suite.cases[0]);const r=aggregate(suite,[a,a,{...row(suite.cases[1]),race:'wrong'}]);assert.equal(r.recorded,1);assert.equal(r.errors.length,2);
});
test('death, timeout, stall and cap remain distinct with reproduction details',()=>{
 const rows=suite.cases.map(row);rows[1].outcome='wall_timeout';rows[2].outcome='stalled';rows[3].outcome='turn_cap';const r=aggregate(suite,rows);
 assert.equal(r.counts.death,15);assert.equal(r.counts.wall_timeout,1);assert.equal(r.counts.stalled,1);assert.equal(r.counts.turn_cap,1);const md=render(r);assert.match(md,/Profile: c-seeded-point-buy-v2; cap: 5000 game ticks/);assert.match(md,/--seed 3000/);assert.match(md,/--birth-profile c-seeded-point-buy-v2/);assert.ok(!md.includes('<tag>'));
});

test('exported reports use portable artifact-relative evidence paths',()=>{
 const r={cells:[{id:'case',evidencePath:'/tmp/artifacts/shard/case/run'}]};
 assert.equal(portableReport(r,'/tmp/artifacts').cells[0].evidencePath,'shard/case/run');
 assert.equal(r.cells[0].evidencePath,'/tmp/artifacts/shard/case/run');
});

test('frozen suites fit their per-shard workflow time budgets',()=>{
 const smoke=loadSuite(new URL('./suites/smoke-v1.json',import.meta.url));
 const survey=loadSuite(new URL('./suites/death-survey-v1.json',import.meta.url));
 assert.ok(Math.ceil(smoke.cases.length/4)*smoke.wallSeconds<15*60);
 assert.ok(Math.ceil(survey.cases.length/4)*survey.wallSeconds<240*60);
});
test('both tick and decision caps count in endpoint and class statistics',()=>{
 const small={...suite,cases:suite.cases.slice(0,3).map(c=>({...c,class:'Warrior'}))};
 const rows=small.cases.map((c,i)=>({...c,suite:small.id,outcome:['death','turn_cap','decision_cap'][i],turn:42}));
 const r=aggregate(small,rows),md=render(r);
 assert.match(md,/1\/3 \(33.33%\)/);assert.match(md,/Warrior \| 3 \| 1 \| 2 \| 0/);
 const allCaps=render(aggregate(small,rows.map(c=>({...c,outcome:'decision_cap'}))));
 assert.match(allCaps,/0\/3 \(0.00%\)/);
});
