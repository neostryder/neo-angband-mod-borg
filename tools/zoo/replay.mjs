// Visible diagnostic replay from the retained build; never reseeds a saved game.
import { createServer } from 'node:http';
import { createHash,randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync,mkdirSync,cpSync,existsSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { replayPaths } from './replay-paths.mjs';
import { spawn,execFileSync } from 'node:child_process';
const tool=dirname(fileURLToPath(import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function replayMatches(original,replayed) {
  return original.seed===replayed.seed && original.birth?.race===replayed.birth?.race && original.birth?.class===replayed.birth?.class && original.inputs?.birthProfile===replayed.inputs?.birthProfile && original.inputs?.turns===replayed.inputs?.turns && JSON.stringify(original.birth)===JSON.stringify(replayed.birth) && JSON.stringify(original.settings)===JSON.stringify(replayed.settings) && original.outcome===replayed.outcome && original.turn===replayed.turn && typeof original.playSha256==='string' && original.playSha256===replayed.playSha256;
}
export function displayBundle(source) {
  if(source.includes('o.onFrame'))return {source,adapted:false};
  const needle='const result = originalGate.submit(token, intent);';
  if(source.split(needle).length!==2 || !source.includes('const finalKnownWorld = buildKnownWorld(state, deps, grants);'))throw Error('This bundle has no supported command display observer site');
  const addition=needle+`
    if(intent.kind === "command" && o.onFrame) {
      const __k=buildKnownWorld(state,deps,grants),__g=__k.player?.grid;
      o.onFrame({...__k,turn:state.turn,action:intent.command,accepted:result.accepted,messages:messages.slice(-5),level:__k.level&&{...__k.level,cells:__k.level.cells.filter(c=>__g&&Math.abs(c.x-__g.x)<=12&&Math.abs(c.y-__g.y)<=12)}});
    }`;
  return {source:source.replace(needle,addition),adapted:true};
}
const viewer=token=>`<!doctype html><html lang="en"><meta charset="utf-8"><title>Borg visible replay</title><style>body{font:16px system-ui;background:#111b2b;color:#e9f0fa;max-width:1100px;margin:30px auto}button,input{font:inherit;margin:8px}pre{font:17px/1.1 monospace;white-space:pre}#layout{display:flex;gap:30px}#status{color:#82e5bd}aside{max-width:400px}</style><h1>Visible Borg replay</h1><p>The pinned Core engine and Borg are running locally. This map uses observed known-state data, not the ordinary Neo browser UI.</p><button id="start">Start full replay</button><button id="pause">Pause display</button><label>Display interval <input id="speed" type="range" min="20" max="500" value="80">ms</label><p id="status">Command-hash verification: pending</p><div id="layout"><pre id="map"></pre><aside><pre id="stats"></pre><p id="command"></p></aside></div><script>
const token=${JSON.stringify(token)},queue=[];let paused=false,done=null;
function show(k){const p=k.player;if(!p)return;document.querySelector('#stats').textContent='Tick '+k.turn+'\\n'+p.race+' '+p.cls+'\\nHP '+p.hp+'/'+p.maxHp+'  SP '+p.sp+'/'+p.maxSp+'\\nDepth '+p.depth+'  Level '+p.level+'\\nGold '+p.gold;const g=p.grid;if(!g)return;const r=12,rows=Array.from({length:25},()=>Array(25).fill(' '));for(const c of k.level?.cells??[]){const x=c.x-g.x+r,y=c.y-g.y+r;if(x<0||y<0||x>24||y>24)continue;const code=c.remembered?.featCode??'';rows[y][x]=/LESS/.test(code)?'<':/MORE/.test(code)?'>':/GRANITE|PERM|WALL/.test(code)?'#':/CLOSED|DOOR/.test(code)?'+':c.remembered?.passable?'.':'?'}for(const m of k.monsters??[]){const x=m.grid?.x-g.x+r,y=m.grid?.y-g.y+r;if(x>=0&&x<25&&y>=0&&y<25)rows[y][x]=[...(m.glyph??'?')][0]}rows[r][r]='@';document.querySelector('#map').textContent=rows.map(r=>r.join('')).join('\\n');}
function tick(){if(!paused&&queue.length)show(queue.shift());setTimeout(tick,Number(document.querySelector('#speed').value))}tick();
document.querySelector('#pause').onclick=()=>paused=!paused;
const events=new EventSource('/events?token='+token);events.onmessage=e=>{const data=JSON.parse(e.data);if(data.frame)queue.push(data.frame);if(data.result){done=data.result;document.querySelector('#status').textContent=done.verified?'VERIFIED: complete command hash, seed, birth, endpoint and outcome match the original':'NOT VERIFIED: '+done.reason;}};
document.querySelector('#start').onclick=async()=>{document.querySelector('#start').disabled=true;const response=await fetch('/start?token='+token,{method:'POST'});if(!response.ok)document.querySelector('#status').textContent=await response.text()};
</script></html>`;
function argsOf(argv) {
  const args={};for(let i=0;i<argv.length;i+=2){if(!['--experiment','--case','--bundle','--out','--mode','--engine-dir','--prepare-only','--seed','--open','--autodelay','--start-delay','--before-death','--allow-unpinned'].includes(argv[i])||!argv[i+1]||args[argv[i]])throw Error('Expected flag/value pairs; see --help');args[argv[i]]=argv[i+1];}return args;
}
async function main() {
  if(process.argv.includes('--help')){console.log('pnpm replay --experiment DIR --case INDEX-SEED --bundle BUILD/bundle.mjs --out NEW-DIR --mode watch\npnpm replay --experiment DIR --case INDEX-SEED --engine-dir ../engine --out NEW-DIR --mode game');return;}
  const a=argsOf(process.argv.slice(2));
  if(!a['--experiment']||!/^\d+-\d+$/.test(a['--case']??'')||!a['--out']||!['watch','game','capture'].includes(a['--mode']??'watch'))throw Error('Expected --experiment DIR --case INDEX-SEED --out NEW-DIR and --mode watch|game');
  const root=resolve(a['--experiment']),manifest=JSON.parse(readFileSync(join(root,'experiment.json'))),suite=JSON.parse(readFileSync(join(root,'suite.json'))),index=Number(a['--case'].split('-')[0]),assigned=suite.cases[index];
  if(!assigned||String(assigned.seed)!==a['--case'].split('-')[1]||(a['--seed']!==undefined&&Number(a['--seed'])!==assigned.seed))throw Error('Case does not match the frozen assignment');
  const worker=index%Math.min(manifest.workers,suite.cases.length),original=JSON.parse(readFileSync(join(root,'runs',`worker-${worker}`,a['--case'],'run/run.json')));
  if(original.seed!==assigned.seed||original.birth?.race!==assigned.race||original.birth?.class!==assigned.class)throw Error('Original run differs from assignment');
  const out=resolve(a['--out']);
  if(a['--mode']==='game') {
    if(!a['--engine-dir'])throw Error('Actual game launch requires --engine-dir');
    const locations=replayPaths(root,{bundle:a['--bundle'],engine:a['--engine-dir']});const bundle=locations.bundle;
    if(!bundle)throw Error('Actual game launch requires the original --bundle');
    const {launchGame}=await import('./game-launch.mjs');
    await launchGame({experiment:root,caseId:a['--case'],bundle,engine:a['--engine-dir'],out,prepareOnly:a['--prepare-only']==='true',openBrowser:a['--open']!=='false',autodelay:Number(a['--autodelay']??1000),startDelay:Number(a['--start-delay']??1000),beforeDeath:a['--before-death']===undefined?undefined:Number(a['--before-death']),allowUnpinned:a['--allow-unpinned']==='true'});return;
  }
  mkdirSync(out,{recursive:false});
  if(!a['--bundle'])throw Error('Visible replay requires the original --bundle');
  const bundle=resolve(a['--bundle']),build=JSON.parse(readFileSync(join(dirname(bundle),'build.json'))),source=readFileSync(bundle,'utf8');
  if(hash(source)!==original.provenance?.bundleSha256||build.bundleSha256!==original.provenance.bundleSha256)throw Error('Replay requires the original recorded bundle hash');
  const display=displayBundle(source),work=join(out,'build');mkdirSync(work);cpSync(join(dirname(bundle),'pack'),join(work,'pack'),{recursive:true});
  textFile(join(work,'bundle.mjs'),display.source);
  const derived={...build,bundleSha256:hash(display.source),derivedFromBundleSha256:build.bundleSha256,displayAdapter:display.adapted?'legacy-known-state-observer-v1':null};
  textFile(join(work,'build.json'),JSON.stringify(derived,null,2)+'\n');
  const runArgs=[join(tool,'run.mjs'),'--bundle',join(work,'bundle.mjs'),'--seed',String(original.seed),'--race',original.birth.race,'--class',original.birth.class,'--turns',String(original.inputs.turns),'--decisions',String(original.inputs.decisions??10000000),'--out',join(out,'run'),'--record','true'];
  if(original.inputs.birthProfile)runArgs.push('--birth-profile',original.inputs.birthProfile);
  if(a['--mode']==='capture') {
    const {spawnSync}=await import('node:child_process');
    const run=spawnSync(process.execPath,runArgs,{encoding:'utf8',timeout:Math.max(120000,(original.wallSeconds??120)*3000),maxBuffer:4*1024*1024});
    let replayed;try{replayed=JSON.parse(readFileSync(join(out,'run/run.json')));}catch{}
    const result={schema:'neo-visible-replay@1',verified:run.status===0&&!!replayed&&replayMatches(original,replayed),originalPlaySha256:original.playSha256,replayPlaySha256:replayed?.playSha256,displayAdapter:derived.displayAdapter};
    textFile(join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.verified)process.exitCode=1;return;
  }
  const token=randomBytes(20).toString('hex'),clients=new Set();let child=null,last=null,result=null;
  const send=data=>{if(data.frame)last=data;for(const response of clients)response.write(`data: ${JSON.stringify(data)}\n\n`);};
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    if(url.searchParams.get('token')!==token){response.writeHead(403).end('Open the complete URL printed by the replay command');return;}
    if(url.pathname==='/'&&request.method==='GET'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(viewer(token));return;}
    if(url.pathname==='/events'&&request.method==='GET'){response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});response.flushHeaders();clients.add(response);if(last)response.write(`data: ${JSON.stringify(last)}\n\n`);if(result)response.write(`data: ${JSON.stringify({result})}\n\n`);request.on('close',()=>clients.delete(response));return;}
    if(url.pathname!=='/start'||request.method!=='POST'||child){response.writeHead(404).end();return;}
    response.end('Started');
    const argv=[join(tool,'run.mjs'),'--bundle',join(work,'bundle.mjs'),'--seed',String(original.seed),'--race',original.birth.race,'--class',original.birth.class,'--turns',String(original.inputs.turns),'--decisions',String(original.inputs.decisions??10000000),'--out',join(out,'run'),'--watch','true','--record','true'];
    if(original.inputs.birthProfile)argv.push('--birth-profile',original.inputs.birthProfile);
    child=spawn(process.execPath,argv,{stdio:['ignore','pipe','inherit']});
    let partial='';child.stdout.on('data',data=>{partial+=data;let end;while((end=partial.indexOf('\n'))>=0){const line=partial.slice(0,end);partial=partial.slice(end+1);try{const event=JSON.parse(line);if(event.frame)send(event);}catch{console.log(line);}}});
    let finished=false;const finish=(code,error)=>{if(finished)return;finished=true;let replayed;try{replayed=JSON.parse(readFileSync(join(out,'run/run.json')));}catch{}result={schema:'neo-visible-replay@1',verified:code===0&&!!replayed&&replayMatches(original,replayed),reason:error??(code!==0?`child exit ${code}`:'Compare the retained command hashes, outcomes and birth metadata'),originalPlaySha256:original.playSha256,replayPlaySha256:replayed?.playSha256,displayAdapter:derived.displayAdapter};textFile(join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');send({result});console.log(JSON.stringify(result));};
    child.on('error',e=>finish(null,e.message));child.on('exit',code=>finish(code));
  });
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  console.log(`Open http://127.0.0.1:${server.address().port}/?token=${token}\nPress Start full replay. Ctrl-C closes the viewer.`);
  const cleanup=()=>{child?.kill('SIGTERM');for(const c of clients)c.end();server.close();};process.once('SIGINT',cleanup);process.once('SIGTERM',cleanup);
}
function textFile(file,s) {writeFileSync(file,s,{flag:'wx'});}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
