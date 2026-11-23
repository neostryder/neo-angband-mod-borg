import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, makePlan } from './experiment.mjs';
import { loadSuite, shardCases } from './ci/suite.mjs';
import { render,aggregate } from './ci/report.mjs';
test('rejects ambiguous flags and invalid budgets before launching games',()=>{
 for(const args of [['--games'],['--typo','3'],['--games','2','--games','3']])assert.throws(()=>parseArgs(args));
 for(const args of [{games:'0'},{workers:'9'},{'max-ticks':'NaN'},{'save-games':'yes'},{race:'unknown'}])assert.throws(()=>makePlan(args));
});
test('frozen zoo assignments remain intact when selecting a shorter pilot',()=>{
 const file=new URL('./ci/suites/neo-seeded-v2-classes-1800.json',import.meta.url).pathname;
 const all=loadSuite(file),plan=makePlan({suite:file,games:'10','max-ticks':'1000',workers:'2'});
 assert.deepEqual(plan.suite.cases,all.cases.slice(0,10).map(({seed,race,class:cls})=>({seed,race,class:cls})));
 assert.notEqual(plan.suite.id,all.id);assert.equal(plan.suite.turns,1000);
 assert.throws(()=>makePlan({suite:file,race:'Human'}));
 assert.equal(all.cases[0].seed,2125085038);assert.equal(all.cases[9].race,'Half-Elf');
 assert.equal(shardCases(all,35,36).length,50);
});
test('custom plans are deterministic; changing a budget changes the plan identity',()=>{
 const p=makePlan({games:'99'}),q=makePlan({games:'99'});assert.deepEqual(p,q);
 assert.equal(new Set(p.suite.cases.map(c=>c.seed)).size,99);
 assert.equal(p.suite.cases[9].race,'Half-Elf');
 assert.notEqual(p.suite.id,makePlan({games:'99','max-ticks':'6000'}).suite.id);
});
test('historical suite keeps rolled-birth/cap semantics and both denominators',()=>{
 const s=loadSuite(new URL('./ci/suites/classes-1800.json',import.meta.url));
 assert.equal(s.cases[0].seed,884072154);assert.equal(s.wallSeconds,2700);
 const small={...s,cases:s.cases.slice(0,3)};
 const r=aggregate(small,small.cases.map((c,i)=>({...c,suite:s.id,outcome:['death','turn_cap','wall_timeout'][i]})));
 const md=render(r);assert.match(md,/1\/3 \(33.33%\)/);assert.match(md,/1\/2 \(50.00%\)/);assert.match(md,/can overshoot/);
 assert.ok(!md.includes('--birth-profile ordinary-rolled-v1'));
});
test('plan-only creates a portable frozen plan and refuses to overwrite runs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-plan-'));try {
  const out=join(dir,'new experiment');const argv=[new URL('./experiment.mjs',import.meta.url).pathname,'--games','2','--max-ticks','100','--out',out,'--plan-only'];
  const first=spawnSync(process.execPath,argv,{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  assert.equal(JSON.parse(readFileSync(join(out,'suite.json'))).cases.length,2);
  const before=readFileSync(join(out,'suite.json'),'utf8');
  assert.notEqual(spawnSync(process.execPath,argv).status,0);assert.equal(readFileSync(join(out,'suite.json'),'utf8'),before);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('two workers retain every game, diagnostic saves and an aggregated death rate',()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-workers-'));try {
  const bundle=join(dir,'bundle.mjs');
  const source=`export async function run(o){o.onState({turn:100});o.onSave?.('birth',{fixture:true});o.onSave?.('final',{fixture:true});return {outcome:o.class==='Warrior'?'death':'turn_cap',turn:o.turns,level:1,maxDepth:1,causeOfDeath:o.class==='Warrior'?'a rat':null,birth:{race:o.race,class:o.class}}}`;
  writeFileSync(bundle,source);
  writeFileSync(join(dir,'build.json'),JSON.stringify({contentFiles:{},exactTickCap:true,cSeedStartup:true,cGccCoordinateOrder:true,bundleSha256:createHash('sha256').update(source).digest('hex'),engine:{commit:'a'.repeat(40)},borg:{commit:'b'.repeat(40),manifest:{data:{}}},appliedPatches:[]}));
  const out=join(dir,'results');
  const child=spawnSync(process.execPath,[new URL('./experiment.mjs',import.meta.url).pathname,'--bundle',bundle,'--games','3','--max-ticks','100','--workers','2','--save-games','true','--out',out],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(readFileSync(join(out,'report/report.json')));
  assert.equal(report.assigned,3);assert.equal(report.recorded,3);assert.deepEqual(report.counts,{death:1,turn_cap:2});
  for(const c of report.cells){const evidence=join(out,'runs',c.evidencePath);assert.equal(JSON.parse(readFileSync(join(evidence,'birth.save.json'))).fixture,true);assert.equal(JSON.parse(readFileSync(join(evidence,'final.save.json'))).fixture,true);}
 } finally {rmSync(dir,{recursive:true,force:true});}
});
