import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
for(const [mode,want] of [['death','death'],['timeout','wall_timeout'],['wrong-birth','config_error'],['wrong-seed','config_error'],['crash','harness_failure']])test(`child ${mode} is retained as ${want}`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-harness-'));
 try{
  mkdirSync(join(dir,'ci'));for(const file of ['run.mjs','suite.mjs'])copyFileSync(new URL(file,import.meta.url),join(dir,'ci',file));
  const build={exactTickCap:true,cSeedStartup:true,cGccCoordinateOrder:true,bundleSha256:'fixture',engine:{commit:'a'.repeat(40)},borg:{commit:'b'.repeat(40)},appliedPatches:[]};writeFileSync(join(dir,'build.json'),JSON.stringify(build));writeFileSync(join(dir,'bundle.mjs'),'');
  writeFileSync(join(dir,'suite.json'),JSON.stringify({schema:'neo-headless-suite@1',id:'fixture',birthProfile:'c-seeded-point-buy-v2',turns:100,wallSeconds:1,cases:[{seed:7,race:'Human',class:'Warrior'}]}));
  writeFileSync(join(dir,'run.mjs'),`import{mkdirSync,writeFileSync,readFileSync}from'node:fs';import{join}from'node:path';const mode=${JSON.stringify(mode)};const a=Object.fromEntries(process.argv.slice(2).reduce((r,v,i,all)=>i%2?r:r.concat([[v.slice(2),all[i+1]]]),[]));if(mode==='timeout')await new Promise(r=>setTimeout(r,10000));if(mode==='crash')process.exit(2);mkdirSync(a.out);writeFileSync(join(a.out,'run.json'),JSON.stringify({schema:'neo-original/run@1',outcome:'death',turn:42,causeOfDeath:'a rat',inputs:{seed:mode==='wrong-seed'?999:Number(a.seed),birthProfile:a['birth-profile']},birth:{race:mode==='wrong-birth'?'Elf':a.race,class:a.class},provenance:JSON.parse(readFileSync(new URL('build.json',import.meta.url)))}));`);
  const child=spawnSync(process.execPath,[join(dir,'ci/run.mjs'),'--bundle',join(dir,'bundle.mjs'),'--suite',join(dir,'suite.json'),'--shard','0','--shards','1','--out',join(dir,'out')],{encoding:'utf8',timeout:5000});
  const [row]=JSON.parse(readFileSync(join(dir,'out/cells.json'),'utf8'));assert.equal(row.outcome,want,child.stderr);assert.equal(child.status,mode==='death'?0:1);assert.equal(row.seed,7);assert.ok(readFileSync(join(dir,'out/0-7/stdout.log')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
