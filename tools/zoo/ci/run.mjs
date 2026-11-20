// FORK: bounded child processes retain partial evidence after timeout/crash.
import { mkdirSync,readFileSync,writeFileSync,openSync,closeSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadSuite,shardCases,flags } from './suite.mjs';
const a=flags(process.argv.slice(2)),suite=loadSuite(resolve(a.suite)),out=resolve(a.out),bundle=resolve(a.bundle);
mkdirSync(out,{recursive:false});
const build=JSON.parse(readFileSync(join(dirname(bundle),'build.json'),'utf8'));
const aligned=suite.birthProfile==='c-seeded-point-buy-v2';
if(!['exactTickCap','cSeedStartup','cGccCoordinateOrder'].every(k=>(build[k]===true)===aligned))throw Error('Build adapters differ from suite profile');
const rows=[];
for(const c of shardCases(suite,Number(a.shard),Number(a.shards))){
 const dir=join(out,c.id);mkdirSync(dir);const stdout=openSync(join(dir,'stdout.log'),'wx'),stderr=openSync(join(dir,'stderr.log'),'wx');
 const argv=[fileURLToPath(new URL('../run.mjs',import.meta.url)),'--bundle',bundle,'--seed',String(c.seed),'--race',c.race,'--class',c.class,...(aligned?['--birth-profile',suite.birthProfile]:[]),'--turns',String(suite.turns),'--out',join(dir,'run')];
 if(suite.record===true)argv.push('--record','true');
 if(suite.saveGames===true)argv.push('--save-games','true');
 const start=performance.now();let child;
 try{child=spawnSync(process.execPath,argv,{timeout:suite.wallSeconds*1000,killSignal:'SIGKILL',stdio:['ignore',stdout,stderr]});}finally{closeSync(stdout);closeSync(stderr);}
 let record,error;try{record=JSON.parse(readFileSync(join(dir,'run/run.json'),'utf8'));}catch(e){error=String(e);}
 let outcome=record?.outcome;
 if(child.error?.code==='ETIMEDOUT')outcome='wall_timeout';
 else if(child.status!==0||record?.schema!=='neo-original/run@1'||!['death','turn_cap','stalled','decision_cap','borg_stopped','harness_failure'].includes(outcome)){outcome='harness_failure';error??=String(child.error??`child status ${child.status}`);}
 else if(record.inputs?.seed!==c.seed||record.birth?.race!==c.race||record.birth?.class!==c.class||(record.inputs?.birthProfile??'ordinary-rolled-v1')!==suite.birthProfile){outcome='config_error';error='Assigned birth/profile differs from played birth';}
 else if(record.provenance?.bundleSha256!==build.bundleSha256||record.provenance?.engine?.commit!==build.engine.commit||record.provenance?.borg?.commit!==build.borg.commit){outcome='config_error';error='Build provenance mismatch';}
 else if(!Number.isSafeInteger(record.turn)||record.turn<0||(aligned&&record.turn>suite.turns)){outcome='harness_failure';error='Exact tick cap exceeded';}
 const row={...c,suite:suite.id,outcome,error:error??record?.error??null,turn:record?.turn??null,level:record?.level??null,depth:record?.depth??null,maxDepth:record?.maxDepth??null,hp:record?.hp??null,cause:record?.causeOfDeath??null,wallSeconds:(performance.now()-start)/1000,build:{engine:build.engine,borg:build.borg,bundleSha256:build.bundleSha256,appliedPatches:build.appliedPatches},evidence:`${c.id}/run`};
 row.settings=record?.settings??null;row.birth=record?.birth??null;
 rows.push(row);writeFileSync(join(out,'cells.json'),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify({id:c.id,outcome,turn:row.turn,cause:row.cause}));
}
if(rows.some(r=>['harness_failure','config_error','wall_timeout'].includes(r.outcome)))process.exitCode=1;
