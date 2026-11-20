import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,unlinkSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync,execFileSync } from 'node:child_process';
import { replayPaths } from './replay-paths.mjs';
import { sourceIntegrity,recordedSourcesClean } from './source-integrity.mjs';
const put=(root,path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value));};
test('relative measured paths use recorded cwd; local relocation overrides stale CI paths',()=>{
 const root=mkdtempSync(join(tmpdir(),'neo-locations-'));try{
  put(root,'experiment/experiment.json',{cwd:join(root,'work'),argv:['--bundle','build/bundle.mjs']});
  put(root,'work/build/bundle.mjs','');put(root,'work/build/build.json',{sourcePaths:{engine:join(root,'engine')}});put(root,'engine/package.json',{});
  const p=replayPaths(join(root,'experiment'));assert.equal(p.bundle,join(root,'work/build/bundle.mjs'));assert.equal(p.engine,join(root,'engine'));assert.equal(p.available,true);
  put(root,'experiment/experiment.json',{argv:['--bundle','/tmp/ci-artifacts-stale/bundle.mjs']});assert.equal(replayPaths(join(root,'experiment')).available,false);
  assert.equal(replayPaths(join(root,'experiment'),{bundle:p.bundle,engine:p.engine}).available,true);
  assert.equal(replayPaths(join(root,'experiment'),{bundle:p.bundle,engine:p.engine,portable:true}).available,false);
  put(root,'experiment/experiment.json',{argv:['--bundle','relative-without-cwd.mjs']});assert.equal(replayPaths(join(root,'experiment')).bundle,null);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('graphical provenance rejects dirty measured source; allowed SDK mode-only metadata is explicit',()=>{
 assert.equal(recordedSourcesClean({borg:{dirty:true},engine:{dirty:false}}),false);
 assert.equal(recordedSourcesClean({borg:{dirty:false},engine:{dirty:true}}),false);
 assert.equal(recordedSourcesClean({borg:{dirty:false},engine:{dirty:true,commit:'pin',sourceIntegrity:{commit:'pin',verifiedClean:true,approvedModeChanges:['mode change 100644 => 100755 packages/mod-sdk/bin/neo-angband-mod-build.mjs']}}}),true);
});
test('current engine changes and untracked inputs are rejected; approved SDK bits stay byte-clean',()=>{
 const root=mkdtempSync(join(tmpdir(),'neo-clean-source-'));const git=(...a)=>execFileSync('git',['-C',root,...a],{stdio:'pipe',encoding:'utf8'});
 try {
  git('init','-b','main');git('config','core.fileMode','true');put(root,'source.ts','original');put(root,'packages/mod-sdk/bin/neo-angband-mod-build.mjs','original');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
  assert.equal(sourceIntegrity(root,{engine:true}).verifiedClean,true);
  put(root,'source.ts','changed');assert.throws(()=>sourceIntegrity(root,{engine:true}),/Uncommitted/);put(root,'source.ts','original');
  put(root,'untracked.ts','extra');assert.throws(()=>sourceIntegrity(root,{engine:true}),/untracked/);unlinkSync(join(root,'untracked.ts'));
  chmodSync(join(root,'packages/mod-sdk/bin/neo-angband-mod-build.mjs'),0o755);assert.equal(sourceIntegrity(root,{engine:true}).approvedModeChanges.length,1);
  assert.throws(()=>sourceIntegrity(root),/Unapproved/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('recording hooks are absent by default and enabled only by explicit flag',()=>{
 const root=mkdtempSync(join(tmpdir(),'neo-record-opt-'));try{
  const source=`export async function run(o){o.onState({turn:100});o.onObservation?.({turn:100,player:{hp:10,maxHp:10}});o.onFrame?.({turn:100,player:{hp:10,maxHp:10}});return {outcome:'turn_cap',turn:100,frameHook:typeof o.onFrame==='function',observationHook:typeof o.onObservation==='function'}}`;
  put(root,'bundle.mjs',source);put(root,'build.json',{bundleSha256:createHash('sha256').update(source).digest('hex'),contentFiles:{},borg:{manifest:{data:{id:'borg',version:'test'}}}});
  for(const [label,record] of [['default',null],['recorded','true']]){
   const args=[new URL('./run.mjs',import.meta.url).pathname,'--bundle',join(root,'bundle.mjs'),'--seed','1','--turns','100','--out',join(root,label)];if(record)args.push('--record',record);
   const child=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
   const result=JSON.parse(readFileSync(join(root,label,'run.json')));assert.equal(result.frameHook,!!record);assert.equal(result.observationHook,!!record);
   assert.equal(readFileSync(join(root,label,'observations.jsonl'),'utf8').length>0,!!record);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('an inherited validation lock disables default serving and can be released by the caller',()=>{
 if(process.platform!=='linux')return;
 const root=mkdtempSync(join(tmpdir(),'neo-lock-serve-'));try{
  const lock=join(root,'validation.lock'),script=join(root,'probe.mjs'),module=new URL('./serve-report.mjs',import.meta.url).href;
  writeFileSync(script,`import{autoServe,inheritedValidationLock}from${JSON.stringify(module)};if(!inheritedValidationLock(${JSON.stringify(lock)})||autoServe({},{tty:true,ci:'',locked:inheritedValidationLock(${JSON.stringify(lock)})}))process.exit(2);`);
  const child=spawnSync('flock',[lock,process.execPath,script],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);
  assert.equal(spawnSync('flock',['-n',lock,'true']).status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
