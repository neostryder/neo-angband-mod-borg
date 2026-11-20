import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportExperiment,stableBoundary,knownMapSvg } from './report.mjs';
import { replayMatches,displayBundle } from './replay.mjs';
function fixture(run) {
  const root=mkdtempSync(join(tmpdir(),'neo-dossiers-'));
  const put=(p,data)=>{mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),typeof data==='string'?data:JSON.stringify(data));};
  const c={seed:7,race:'Human',class:'Mage'},suite={schema:'neo-headless-suite@1',id:'fixture',birthProfile:'c-seeded-point-buy-v2',turns:100,wallSeconds:2,cases:[c]};
  put('suite.json',suite);put('original build/bundle.mjs','');put('original build/build.json',{sourcePaths:{engine:join(root,'engine')}});put('engine/package.json',{});put('experiment.json',{workers:1,argv:['--bundle',join(root,'original build/bundle.mjs')]});
  put('runs/worker-0/cells.json',[{...c,id:'0-7',suite:'fixture',outcome:'death',turn:40,hp:-1,level:1,depth:1,maxDepth:1,cause:'a rat <script>alert(1)</script>',evidence:'0-7/run'}]);
  const player={...c,cls:'Mage',hp:10,maxHp:10,sp:2,maxSp:3,level:1,depth:1,grid:{x:5,y:5}};
  const known={player,inventory:[{number:1,name:'Potion <unknown>'}],equipment:[],quiver:[],spellbooks:[{name:'First spells',spells:[{name:'Phase Door',learned:true,mana:1,chance:5,forgotten:false}]}],level:{cells:[{x:5,y:5,remembered:{featCode:'FLOOR',passable:true}}]},monsters:[]};
  const dir='runs/worker-0/0-7/run/';
  put(dir+'run.json',{seed:7,turn:40,outcome:'death',birth:{race:'Human',class:'Mage'},finalKnownWorld:{...known,player:{...player,hp:-1}}});
  put(dir+'states.jsonl',[0,10,20,30,40].map((turn,i)=>JSON.stringify({turn,hp:i===4?-1:10,maxHp:10})).join('\n'));
  put(dir+'observations.jsonl',[0,10,20,30,40].map((turn,i)=>JSON.stringify({...known,turn,player:{...player,hp:i===4?-1:10}})).join('\n'));
  put(dir+'messages.jsonl','{"turn":30,"text":"A rat bites you."}\n{"turn":40,"text":"You die."}\n{"turn":');
  put(dir+'commands.jsonl','{"turn":20,"type":"intent","accepted":true,"intent":{"kind":"command","command":{"code":"cast","args":{"spell":0}}}}\n');
  try {run({root,put,dir:join(root,dir)});} finally {rmSync(root,{recursive:true,force:true});}
}
test('episode boundaries use distinct high-HP observations and never claim threat safety',()=>{
 const s=[0,1,2,3].map(turn=>({turn,hp:10,maxHp:10}));assert.equal(stableBoundary(s).turn,3);
 assert.equal(stableBoundary([s[0],s[0],s[0],{turn:4,hp:1,maxHp:10}]).turn,0);
 assert.match(stableBoundary(s).threat,/does not establish safety/);
});
test('old run can be reported without execution; dossiers have chronology, inventory, map and both replay commands',()=>fixture(({root,dir})=>{
 const before=readFileSync(join(dir,'run.json'),'utf8');const out=join(root,'cemetery');const result=reportExperiment(root,out);
 assert.equal(result.deaths,1);assert.equal(result.complete,true);
 const report=readFileSync(join(out,'deaths/0-7/report.md'),'utf8');
 assert.match(report,/Exact game seed: \*\*7\*\*/);assert.match(report,/--mode watch/);assert.match(report,/--mode game/);assert.ok(report.includes("--bundle '"+join(root,'original build/bundle.mjs')+"'"));assert.match(report,/100 engine ticks/);
 assert.match(report,/Relative ordering.*unresolved/);assert.match(report,/incomplete or invalid JSON/);
 const inventory=readFileSync(join(out,'deaths/0-7/inventory.md'),'utf8');assert.match(inventory,/Phase Door/);assert.match(inventory,/Potion/);
 const html=readFileSync(join(out,'deaths/0-7/index.html'),'utf8');assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/&lt;script&gt;/);
 assert.match(readFileSync(join(out,'deaths/0-7/README.md'),'utf8'),/No checkpoint near/);
 assert.match(readFileSync(join(out,'index.html'),'utf8'),/0-7\/index.html/);
 assert.equal(readFileSync(join(dir,'run.json'),'utf8'),before);assert.throws(()=>reportExperiment(root,out),/EEXIST/);
}));
test('missing raw traces stay unavailable and do not turn a death into a new run',()=>fixture(({root,dir})=>{
 rmSync(dir,{recursive:true});const out=join(root,'report-missing');reportExperiment(root,out);
 assert.match(readFileSync(join(out,'deaths/0-7/report.md'),'utf8'),/Raw evidence directory unavailable/);
 assert.equal(JSON.parse(readFileSync(join(out,'report.json'))).assigned,1);
}));
test('evidence traversal and outside-directory symlinks are rejected',()=>fixture(({root,put})=>{
 const outside=mkdtempSync(join(tmpdir(),'neo-outside-'));try {
  symlinkSync(outside,join(root,'runs/worker-0/other'));
  const rows=JSON.parse(readFileSync(join(root,'runs/worker-0/cells.json')));rows[0].evidence='../outside';put('runs/worker-0/cells.json',rows);
  assert.throws(()=>reportExperiment(root,join(root,'bad-report')),/Invalid evidence path/);
  rows[0].evidence='0-7/run';put('runs/worker-0/cells.json',rows);rmSync(join(root,'runs/worker-0/0-7/run'),{recursive:true});symlinkSync(outside,join(root,'runs/worker-0/0-7/run'));
  assert.throws(()=>reportExperiment(root,join(root,'symlink-report')),/Evidence escapes/);
 } finally {rmSync(outside,{recursive:true,force:true});}
}));
test('map ignores actual hidden terrain and labels only remembered observations',()=>{
 const svg=knownMapSvg({player:{grid:{x:1,y:1}},level:{cells:[{x:2,y:1,remembered:{featCode:'FLOOR',passable:true},actual:{featCode:'SECRET'}}]}});
 assert.ok(!svg.includes('SECRET'));assert.match(svg,/>\.<\/text>/);assert.equal(knownMapSvg(null),null);
});
test('command hash, birth and endpoint must all match before calling a visible replay verified',()=>{
 const r={seed:1,birth:{race:'Human',class:'Mage',stats:[10]},inputs:{birthProfile:'c-seeded-point-buy-v2',turns:100},settings:{a:true},turn:40,outcome:'death',playSha256:'abc'};
 assert.equal(replayMatches(r,structuredClone(r)),true);
 for(const change of [{playSha256:'other'},{seed:2},{turn:41},{outcome:'turn_cap'},{birth:{...r.birth,stats:[11]}}])assert.equal(replayMatches(r,{...r,...change}),false);
});
test('legacy display adaptation refuses an ambiguous observer site and preserves new bundles',()=>{
 const source='const result = originalGate.submit(token, intent);\nconst finalKnownWorld = buildKnownWorld(state, deps, grants);';
 assert.equal(displayBundle(source).adapted,true);assert.match(displayBundle(source).source,/o.onFrame/);
 assert.throws(()=>displayBundle(source+source),/no supported command display observer site/);
 assert.equal(displayBundle('o.onFrame?.(known)').adapted,false);
});
test('earlier runs without rich observations still produce final inventory and a qualified chronology',()=>fixture(({root,put})=>{
 put('runs/worker-0/0-7/run/observations.jsonl','');
 const out=join(root,'legacy-report');reportExperiment(root,out);
 const sequence=JSON.parse(readFileSync(join(out,'deaths/0-7/sequence.json')));
 assert.equal(sequence.boundary.threat,'not recorded; HP alone does not establish safety');
 assert.ok(sequence.sequence.some(r=>r.source==='messages.jsonl'));
 assert.match(readFileSync(join(out,'deaths/0-7/inventory.md'),'utf8'),/run.json finalKnownWorld/);
 assert.match(readFileSync(join(out,'deaths/0-7/report.md'),'utf8'),/Sparse older traces/);
}));
test('copyable repeat commands use retained paths and create fresh /tmp output',()=>fixture(({root})=>{
 const out=join(root,'commands-report');reportExperiment(root,out);
 for(const file of ['report.md','deaths/0-7/README.md','deaths/0-7/report.md','deaths/0-7/index.html']) {
  const text=readFileSync(join(out,file),'utf8');assert.ok(!text.includes('BUILD/bundle.mjs'),file);assert.ok(!text.includes('NEW-REPLAY-DIRECTORY'),file);
 }
 const text=readFileSync(join(out,'deaths/0-7/index.html'),'utf8');assert.match(text,/mktemp -d \/tmp\/borg-game-7-/);assert.match(text,/--seed 7/);assert.match(text,/--mode game/);
}));
test('invalid wall-clock delays are rejected before preparing a game or writing files',async()=>{
 const {launchGame}=await import('./game-launch.mjs');
 for(const options of [{autodelay:-1},{autodelay:NaN},{autodelay:10001},{startDelay:-1},{startDelay:600001}])await assert.rejects(launchGame(options),/milliseconds/);
});

test('death reports include the complete before-death launch command',()=>fixture(({root})=>{
 const out=join(root,'before-death-report');reportExperiment(root,out);
 for(const file of ['deaths/0-7/report.md','deaths/0-7/README.md','deaths/0-7/index.html']){
  const text=readFileSync(join(out,file),'utf8');assert.match(text,/--before-death 100/);assert.match(text,/--autodelay 1000/);assert.match(text,/\/tmp\/borg-before-death-/);assert.match(text,/private memory/);
 }
}));
test('checkpoint selection validates death endpoints and refuses unsupported observer sites',async()=>{
 const {requestedCheckpoint,checkpointBundle}=await import('./checkpoint.mjs');
 assert.equal(requestedCheckpoint({outcome:'death',turn:2442},100),2342);
 assert.equal(requestedCheckpoint({outcome:'death',turn:40},100),0);
 assert.throws(()=>requestedCheckpoint({outcome:'turn_cap',turn:2442},100),/death endpoint/);
 assert.throws(()=>requestedCheckpoint({outcome:'death',turn:2442},0),/1..200000/);
 const source='const result = originalGate.submit(token, intent); saveGame(game);';
 assert.match(checkpointBundle(source),/checkpointCommandOrdinal/);assert.throws(()=>checkpointBundle(source+source),/checkpoint site/);
});
