// Evidence-only death dossiers inspired by borg-cemetery; never reruns a game.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregate, render, portableReport } from './ci/report.mjs';
import { recordedSourcesClean } from './source-integrity.mjs';
import { replayPaths } from './replay-paths.mjs';
import { autoServe,serveReport } from './serve-report.mjs';
import { animatedSvg,playerMarkup } from './frames.mjs';
import { loadSuite } from './ci/suite.mjs';
const html = value => String(value ?? 'unknown').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const md = value => String(value ?? 'unknown').replace(/[|<>`\r\n\[\]]/g,' ');
const json = (file, data) => writeFileSync(file, JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const text = (file, data) => writeFileSync(file,data,{flag:'wx'});
const link = (from,to) => relative(from,to).split(sep).map(encodeURIComponent).join('/');
const number = value => Number.isFinite(value) ? value : null;
function scoped(root,path) {
  const base=realpathSync(root), target=realpathSync(resolve(root,path));
  if(target!==base && !target.startsWith(base+sep)) throw Error('Evidence escapes the experiment directory');
  return target;
}
function readJson(file) { return existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : null; }
function stream(dir,name,warnings) {
  const file=join(dir,name); if(!existsSync(file)) return [];
  scoped(dir,name);
  const lines=readFileSync(file,'utf8').split('\n'), rows=[];
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim()) continue;
    try { const row=JSON.parse(lines[i]); if(Number.isFinite(row.turn)) rows.push({...row,source:name,line:i+1}); }
    catch { warnings.push(`${name}:${i+1}: incomplete or invalid JSON; retained raw evidence was not changed`); }
  }
  return rows;
}
export function stableBoundary(states) {
  const unique=[...new Map(states.filter(s=>Number.isFinite(s.turn)&&Number.isFinite(s.hp)&&s.maxHp>0).map(s=>[s.turn,s])).values()].sort((a,b)=>a.turn-b.turn);
  let streak=0,boundary=null;
  for(const s of unique) {
    streak=s.hp/s.maxHp>=0.7 ? streak+1 : 0;
    if(streak>=3) boundary=s.turn;
  }
  return {turn:boundary??unique[0]?.turn??0,method:boundary===null?'first available HP observation':'last of at least three distinct observations with HP at least 70%',threat:'not recorded; HP alone does not establish safety'};
}
function observation(row) {
  if(row.source==='commands.jsonl') {
    if(row.type==='intent') return `Requested ${row.intent?.command?.code??row.intent?.kind??'intent'} ${JSON.stringify(row.intent?.command?.args??(row.intent?.command?.dir!==undefined?{dir:row.intent.command.dir}:{}))}; accepted: ${row.accepted??'unknown'}`;
    return `${row.type??'command'}: ${JSON.stringify(row)}`;
  }
  if(row.source==='messages.jsonl') return row.text??row.message??'Message text unavailable';
  const p=row.player??row;
  return `HP ${p.hp??'?'}/${p.maxHp??'?'}; SP ${p.sp??'?'}/${p.maxSp??'?'}; depth ${p.depth??'?'}; level ${p.level??'?'}; position ${p.grid?`${p.grid.x},${p.grid.y}`:'not captured'}`;
}
export function episode(cell,dir) {
  const warnings=[],record=existsSync(join(dir,'run.json'))?readJson(scoped(dir,'run.json')):null;
  const states=stream(dir,'states.jsonl',warnings),views=stream(dir,'observations.jsonl',warnings);
  const messages=stream(dir,'messages.jsonl',warnings),commands=stream(dir,'commands.jsonl',warnings);
  const boundary=stableBoundary(views.length?views.map(v=>({...v.player,turn:v.turn})):states);
  const end=number(cell.turn)??states.at(-1)?.turn??null;
  const sequence=[...states,...views,...messages,...commands].filter(r=>r.turn>=boundary.turn&&(end===null||r.turn<=end)).sort((a,b)=>a.turn-b.turn||a.source.localeCompare(b.source)||a.line-b.line);
  const inventory=[];
  for(const v of views.filter(v=>v.turn>=boundary.turn)) inventory.push({turn:v.turn,source:`${v.source}:${v.line}`,inventory:v.inventory,equipment:v.equipment,quiver:v.quiver,spellbooks:v.spellbooks});
  const before=views.filter(v=>v.turn<=boundary.turn).at(-1);
  if(before && !inventory.some(v=>v.turn===before.turn)) inventory.unshift({turn:before.turn,source:`${before.source}:${before.line}`,inventory:before.inventory,equipment:before.equipment,quiver:before.quiver,spellbooks:before.spellbooks});
  const final=record?.finalKnownWorld;
  if(final) inventory.push({turn:record.turn,source:'run.json finalKnownWorld',inventory:final.inventory,equipment:final.equipment,quiver:final.quiver,spellbooks:final.spellbooks});
  return {schema:'neo-death-episode@1',id:cell.id,seed:cell.seed,outcome:cell.outcome,endpoint:end,boundary,warnings,sequence,inventory,known:views.at(-1)??final??null,record,
    unavailable:['Borg private reasoning, danger estimates and alternative action scores were not recorded','Original terminal screenshots/GIF and human-play recorder are unavailable','Saved-position playback/comparison is not implemented; a fresh-birth replay is a new diagnostic run']};
}
function inventoryMarkdown(episode) {
  let out='# Inventory, equipment and spells\n\nThese are observed items; unknown properties and missing snapshots remain unknown. Casting also requires the book, mana and a legal target.\n';
  if(!episode.inventory.length) return out+'\nNo inventory or spell observation was retained.\n';
  let previous='';
  for(const snapshot of episode.inventory) {
    const signature=JSON.stringify([snapshot.inventory,snapshot.equipment,snapshot.quiver,snapshot.spellbooks]);
    if(signature===previous) continue; previous=signature;
    out+=`\n## Turn ${snapshot.turn??'unknown'} (${md(snapshot.source)})\n`;
    for(const [key,label] of [['inventory','Pack'],['equipment','Equipment'],['quiver','Quiver']]) {
      const items=snapshot[key];out+=`\n${label}:\n\n`;
      out+=items===null||items===undefined?'Not captured.\n':items.filter(Boolean).map(item=>`- ${item.number??'?'} × ${md(item.name??item.description??item.baseName??item.label??'unidentified item')}`).join('\n')+'\n';
      if(Array.isArray(items)&&!items.filter(Boolean).length)out+='(none)\n';
    }
    out+='\nLearned spells:\n\n';
    if(snapshot.spellbooks===null||snapshot.spellbooks===undefined)out+='Not captured.\n';
    else {
      const spells=snapshot.spellbooks.flatMap(b=>(b.spells??[]).filter(s=>s.learned).map(s=>({...s,book:b.name})));
      out+=spells.length?'| Spell | Book | Mana | Failure chance | Forgotten |\n| --- | --- | ---: | ---: | --- |\n'+spells.map(s=>`| ${md(s.name)} | ${md(s.book)} | ${s.mana??'?'} | ${s.chance??s.fail??'?'} | ${s.forgotten??'?'} |`).join('\n')+'\n':'(none observed)\n';
    }
  }
  return out;
}
export function knownMapSvg(known) {
  const grid=known?.player?.grid,level=known?.level;
  if(!grid||!Number.isInteger(grid.x)||!Number.isInteger(grid.y)||!Array.isArray(level?.cells))return null;
  const radius=12,size=20,cells=level.cells.filter(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&Math.abs(c.x-grid.x)<=radius&&Math.abs(c.y-grid.y)<=radius);
  const x0=grid.x-radius,y0=grid.y-radius;
  let body='';
  for(const c of cells) {
    const code=c.remembered?.featCode??'',glyph=/LESS/.test(code)?'<':/MORE/.test(code)?'>':/GRANITE|PERM|WALL/.test(code)?'#':/DOOR|CLOSED/.test(code)?'+':c.remembered?.passable?'.':'?';
    body+=`<text x="${(c.x-x0)*size+10}" y="${(c.y-y0)*size+15}" fill="${c.visible?'#e4e9f1':'#7d8ba0'}">${html(glyph)}</text>`;
  }
  for(const m of known.monsters??[]) if(m.grid&&Math.abs(m.grid.x-grid.x)<=radius&&Math.abs(m.grid.y-grid.y)<=radius) body+=`<text x="${(m.grid.x-x0)*size+10}" y="${(m.grid.y-y0)*size+15}" fill="#ff9c7c"><title>${html(m.name??m.race??'Observed monster')}</title>${html(m.glyph??'?')}</text>`;
  body+=`<text x="${radius*size+10}" y="${radius*size+15}" fill="#7be6c0">@</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" role="img" aria-label="Last observed known map"><rect width="500" height="500" fill="#121b2b"/><g font-family="monospace" font-size="17" text-anchor="middle">${body}</g></svg>`;
}
function page(title,body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px;color:#202d41;background:#f6f8fb}h1,h2{line-height:1.2}a{color:#1257a1}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #d9e1ec}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:20px;border:1px solid #d9e1ec}.card{background:white;padding:20px;margin:20px 0;border-radius:10px}.map{max-width:500px}.muted{color:#58687e}input{font:inherit;padding:10px;width:90%}</style><body>${body}</body></html>`;
}
function sourceLines(cell) {
  const b=cell.build;return b?`Engine: ${b.engine?.repository??'unknown'} @ ${b.engine?.commit??'unknown'}; Borg: ${b.borg?.repository??'unknown'} @ ${b.borg?.commit??'unknown'}; bundle SHA256: ${b.bundleSha256??'unknown'}.`:'Build identity unavailable.';
}
export function writeReport(report,{out,runsRoot,experimentRoot=dirname(runsRoot),capturesRoot=null,bundle:bundleOverride,engine:engineOverride,portable=false}) {
  mkdirSync(out,{recursive:false});

  const deaths=report.cells.filter(c=>c.outcome==='death'),index=[];
  const paths=replayPaths(experimentRoot,{bundle:bundleOverride,engine:engineOverride,portable});
  const bundle=paths.bundle??'UNRESOLVED-BUNDLE';

  const quote=value=>"'"+String(value).replaceAll("'","'\"'\"'")+"'";

  text(join(out,'report.md'),render(report,{bundle,commands:paths.bundleAvailable,runner:join(paths.tools,'tools/zoo/run.mjs')})+'\n\n## Death dossiers\n\n'+report.cells.filter(c=>c.outcome==='death').map(c=>`- [Seed ${c.seed}: chronological report, inventory and in-game replay commands](deaths/${c.id}/README.md)`).join('\n')+'\n');json(join(out,'report.json'),portableReport(report,runsRoot));
  mkdirSync(join(out,'deaths'));
  for(const cell of deaths) {
    if(!/^\d+-\d+$/.test(cell.id))throw Error('Invalid death identifier');
    const folder=join(out,'deaths',cell.id);mkdirSync(folder);
    let evidence;
    if(cell.evidencePath&&existsSync(cell.evidencePath))evidence=scoped(runsRoot,relative(runsRoot,cell.evidencePath));
    const ep=evidence?episode(cell,evidence):{schema:'neo-death-episode@1',id:cell.id,boundary:{turn:null,method:'unavailable',threat:'unknown'},sequence:[],inventory:[],warnings:['Raw evidence directory unavailable'],unavailable:['No retained raw trace to reconstruct'],known:null};
    let clip=evidence?readJson(join(evidence,'last-actions.json')):null;
    let clipQualification='Recorded command-boundary observations, not original frontend screenshots.';
    if(!clip?.frames?.some(f=>f.action)&&capturesRoot) {
      const capture=join(capturesRoot,cell.id),verification=readJson(join(capture,'verification.json'));
      if(verification?.verified){clip=readJson(join(capture,'run/last-actions.json'));clipQualification='Reconstructed from a diagnostic replay whose complete command hash, birth, endpoint and outcome match the original. These are known-state views, not original frontend screenshots.';}
    }
    const frames=clip?.frames?.some(f=>f.action)?clip.frames:[];
    if(frames.length){json(join(folder,'last-actions.json'),clip);text(join(folder,'last-30-actions.svg'),animatedSvg(frames));}
    const title=`${cell.race} ${cell.class} · seed ${cell.seed}`;
    let account=`# Death: ${title}\n\nRecorded cause: **${md(cell.cause)}**. Endpoint: tick ${cell.turn??'unknown'}, level ${cell.level??'unknown'}, depth ${cell.depth??'unknown'}.\n\n${md(sourceLines(cell))}\n\n## Observed sequence\n\nBoundary: tick ${ep.boundary.turn??'unknown'} (${ep.boundary.method}). Threat estimates are unavailable; this is an HP-based observation boundary, not proof of safety. Sparse older traces cannot establish unobserved choices.\n\nRows are ordered by engine tick. Relative ordering between different streams at the same tick is unresolved. A requested command does not prove its effect succeeded.\n\n| Tick | Evidence | Observation |\n| ---: | --- | --- |\n`;
    const displayed=ep.sequence.slice(0,5000);
    account+=displayed.map(r=>`| ${r.turn} | ${r.source}:${r.line} | ${md(observation(r))} |`).join('\n')+'\n';
    if(ep.sequence.length>displayed.length)account+=`\nShowing ${displayed.length} of ${ep.sequence.length} rows. Complete chronology is in sequence.json.\n`;
    account+='\n## Evidence limits\n\n'+[...ep.warnings,...ep.unavailable].map(s=>`- ${s}`).join('\n')+'\n';
    if(!recordedSourcesClean(cell.build??{}))account+='\n**Graphical provenance warning:** this artifact lacks clean-source receipts. The pinned game launcher will refuse it. Verified headless replay remains available with the retained bundle; `--allow-unpinned true` is an explicitly unverified graphical diagnostic only.\n';
    account+='\n## Investigating this death\n\nThe recorded killer is not a causal diagnosis. Compare available HP/resources, known monsters and requested actions; distinguish observed facts from hypotheses and missing instrumentation. No automatic gameplay fix or survival claim is generated.\n';
    const watchCommand=paths.bundleAvailable?`pnpm --dir ${quote(paths.tools)} replay --experiment ${quote(experimentRoot)} --case ${cell.id} --bundle ${quote(bundle)} --out ${quote(join(experimentRoot,'replay-'+cell.id))} --mode watch`:'# Relocate the retained build using pnpm report --bundle /absolute/build/bundle.mjs';
    const gameCommand=paths.available?`borg_game_dir=$(mktemp -d /tmp/borg-game-${cell.seed}-XXXXXX) &&\npnpm --dir ${quote(paths.tools)} replay --experiment ${quote(experimentRoot)} --case ${cell.id} --seed ${cell.seed} --bundle ${quote(bundle)} --engine-dir ${quote(paths.engine??'UNRESOLVED-ENGINE')} --out "$borg_game_dir/game" --mode game --autodelay 1000 --start-delay 3000`:`# ${paths.reason}\n# Regenerate with pnpm report --bundle /absolute/build/bundle.mjs --engine-dir /absolute/engine`;
    const commandPrefix=paths.available?'':`# Replay paths need relocation: ${paths.reason}\n# Regenerate this report with --bundle /absolute/build/bundle.mjs --engine-dir /absolute/engine\n`;
    const nearCommand=commandPrefix+gameCommand.replace('/tmp/borg-game-','/tmp/borg-before-death-').replace('--mode game','--mode game --before-death 100');
    account+=`\n## Start 100 turns before death\n\nThese turns use the engine counter shown by the death report, not a count of player actions. A command-boundary engine save at or before death minus100 is reconstructed and accepted only if the complete diagnostic replay matches the original command hash. The launcher prints the actual start turn and lead. The engine RNG is preserved; Borg private memory starts fresh, so this is a saved-position experiment rather than uninterrupted continuation.\n\n\`\`\`sh\n${nearCommand}\n\`\`\`\n`;
    account+=`\n## Repeat this complete run\n\nExact game seed: **${cell.seed}**. Assigned birth: **${cell.race} ${cell.class}**. Full requested cap: **${report.suite.turns} engine ticks**. Use the original retained build; the first command displays a real fresh-birth replay and checks the complete command hash.\n\n\`\`\`sh\n${watchCommand}\n\`\`\`\n\nOpen the local URL it prints and press Start full replay. Verification remains pending until the full command hash, birth, outcome and endpoint match. Legacy bundles use an explicitly recorded display-observer copy; the original is unchanged.\n\nLaunch the normal Neo browser game with this seed:\n\n\`\`\`sh\n${gameCommand}\n\`\`\`\n\nThis launches the actual Neo frontend using a turn-zero birth exported from the recorded seed and bundle, and automatically installs the recorded Borg into the isolated diagnostic session. It preserves recorded birth/RNG/options; frontend and headless decision streams can still diverge and are not declared equal without verification.\n`;
    if(!paths.available)account+='\nReplay commands are unavailable until the source/artifact paths are relocated.\n';
    text(join(folder,'report.md'),account);json(join(folder,'sequence.json'),{...ep,record:undefined,known:undefined});
    text(join(folder,'inventory.md'),inventoryMarkdown(ep));
    const map=knownMapSvg(ep.known);if(map)text(join(folder,'known-map.svg'),map);
    const saveLinks=[];
    for(const name of ['birth.save.json','final.save.json'])if(evidence&&existsSync(join(evidence,name)))saveLinks.push(`[${name}](${link(folder,join(evidence,name))})`);
    const raw=evidence?`[Raw observations and run record](${link(folder,evidence)}/)`:'Raw evidence unavailable.';
    const replay=paths.bundleAvailable?`borg_repeat_dir=$(mktemp -d /tmp/borg-${cell.seed}-XXXXXX) &&\nnode ${quote(join(paths.tools,'tools/zoo/run.mjs'))} --bundle ${quote(bundle)} --seed ${cell.seed} --race '${cell.race}' --class '${cell.class}' ${report.suite.birthProfile==='ordinary-rolled-v1'?'':`--birth-profile ${report.suite.birthProfile}`} --turns ${report.suite.turns} --out "$borg_repeat_dir/run"`:'# Relocate the retained build before generating a copyable replay command.';
    const readme=`# Death · ${title}\n\nRecorded cause: **${md(cell.cause)}**, tick **${cell.turn??'unknown'}**.\n\n[Chronological report](report.md) · [Inventory and learned spells](inventory.md) · [Complete chronology](sequence.json)\n\n${map?'![Last observed known map](known-map.svg)\n\nThis is a diagram of retained known-state data, not a terminal screenshot.':'Known map unavailable: no suitable observation was retained.'}\n\n## Start 100 turns before death\n\n\`\`\`sh\n${nearCommand}\n\`\`\`\n\nThe actual checkpoint turn is reported by the launcher; engine state/RNG are saved, while Borg private memory starts fresh. One life only: death stops the Borg without rerolling.\n\n## Watch or launch in game\n\n\`\`\`sh\n${watchCommand}\n${gameCommand}\n\`\`\`\n\nThe first command verifies a visible replay; the second starts the ordinary browser game with this seed and documented startup limits.\n\n## Reproduce headless\n\nUse the original retained build and pack (identities are in report.md):\n\n\`\`\`sh\n${replay}\n\`\`\`\n\nThis reruns from birth. It does not restore private Borg memory or provide a saved-position comparison. Replays are not additional independent lives.\n\n## Retained engine snapshots\n\n${saveLinks.length?saveLinks.join(' · '):'Unavailable: this run did not retain engine snapshots.'}\n\nNo checkpoint near the inferred boundary is selected. A birth/final save is not a verified episode-start scenario.\n\n${raw}\n\n[All deaths](../../README.md)\n`;
    text(join(folder,'README.md'),readme);
    const rawLinks=evidence?['run.json','messages.jsonl','commands.jsonl','states.jsonl','observations.jsonl','last-actions.json'].filter(name=>existsSync(join(evidence,name))).map(name=>`<a href="${html(link(folder,join(evidence,name)))}">${html(name)}</a>`).join(' · '):'Raw logs unavailable';
    const clipBody=frames.length?playerMarkup(frames,clipQualification):'<p>Last-30-action frames were not retained. Re-run the report with --reconstruct true to derive them through a command-hash-verified replay. No frames are invented.</p>';
    text(join(folder,'index.html'),page(title,`<p><a href="../../index.html">← All results</a></p><h1>${html(title)}</h1><p>${html(cell.cause)} · tick ${cell.turn??'unknown'}</p><h2>Start 100 turns before death</h2><pre>${html(nearCommand)}</pre><p>Verified engine checkpoint at or before death minus100; actual turn is printed. Fresh Borg private memory. The diagnostic stops at the first death; no automatic reroll.</p><h2>Start the actual game at turn 0 with this Borg</h2><pre>${html(gameCommand)}</pre><p>This opens Neo’s full frontend and automatically starts the recorded Borg in an isolated session. The command creates its own fresh /tmp output directory.</p><h2>Complete headless repeat</h2><pre>${html(replay)}</pre><div class="card"><a href="report.md">Chronological report</a> · <a href="inventory.md">Equipment, pack, quiver and spells</a> · <a href="sequence.json">Full chronology</a><p>${rawLinks}</p></div>${clipBody}<h2>Observed account and logs</h2><pre>${html(account)}</pre><h2>Inventory, equipment and spells</h2><pre>${html(inventoryMarkdown(ep))}</pre>`));
    index.push({...cell,folder:`deaths/${cell.id}`,boundary:ep.boundary});
  }
  const registry=`# Borg death registry\n\n[Open the browsable report](index.html) · [Full statistics](report.md) · [Machine-readable results](report.json)\n\n${report.assigned} assigned games; ${deaths.length} deaths. Caps and abnormal outcomes remain separate in the statistics.\n\n| Seed | Character | Cause | Tick | Report |\n| --- | --- | --- | ---: | --- |\n`+index.map(c=>`| ${c.seed} | ${c.race} ${c.class} | ${md(c.cause)} | ${c.turn??'?'} | [Read](${c.folder}/README.md) |`).join('\n')+'\n';
  text(join(out,'README.md'),registry);
  text(join(out,'index.html'),page('Borg experiment report',`<h1>Borg experiment report</h1><p>${report.assigned} games · ${deaths.length} deaths · ${(report.counts.turn_cap??0)+(report.counts.decision_cap??0)} caps · ${report.assigned-deaths.length-((report.counts.turn_cap??0)+(report.counts.decision_cap??0))} other outcomes</p><p><a href="report.md">Full statistics and provenance</a> · <a href="report.json">JSON</a></p><input id="filter" aria-label="Filter deaths" placeholder="Filter by seed, class, race or cause"><h2>Death registry</h2><table><thead><tr><th>Seed</th><th>Character</th><th>Cause</th><th>Tick</th></tr></thead><tbody>${index.map(c=>`<tr><td><a href="${c.folder}/index.html">${c.seed}</a></td><td>${html(c.race)} ${html(c.class)}</td><td>${html(c.cause)}</td><td>${c.turn??'?'}</td></tr>`).join('')}</tbody></table><p class="muted">Each death is one recorded birth. Traces describe observations, not unlogged reasoning. All raw results stay unchanged.</p><script>document.querySelector('#filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))})</script>`));
  return {deaths:deaths.length,index:join(out,'index.html')};
}
export function reportExperiment(experiment,out,options={}) {
  const root=resolve(experiment),runs=join(root,'runs'),suite=loadSuite(join(root,'suite.json')),rows=[];
  // Read only the expected worker records, never arbitrary recursive directories.
  const manifest=readJson(join(root,'experiment.json'));
  const workers=manifest?.workers;
  if(!Number.isInteger(workers)||workers<1||workers>8)throw Error('Missing or invalid experiment worker count');
  for(let i=0;i<Math.min(workers,suite.cases.length);i++) {
    const file=join(runs,`worker-${i}`,'cells.json');if(!existsSync(file))continue;
    for(const cell of JSON.parse(readFileSync(scoped(runs,relative(runs,file)),'utf8'))) {
      if(!/^\d+-\d+\/run$/.test(cell.evidence??''))throw Error('Invalid evidence path');
      rows.push({...cell,evidencePath:join(dirname(file),cell.evidence)});
    }
  }
  const report=aggregate(suite,rows),result=writeReport(report,{out:resolve(out),runsRoot:runs,experimentRoot:root,...options});
  return {...result,errors:report.errors,complete:report.recorded===report.assigned};
}
async function mainReport() {
 const argv=process.argv.slice(2),args={};
 if(argv.includes('--help')){console.log('pnpm report --experiment DIR --out NEW-DIR [--reconstruct true] [--bundle ORIGINAL-BUNDLE] [--engine-dir PINNED-ENGINE] [--serve true|false] [--open false] [--port N]');return;}
 for(let i=0;i<argv.length;i+=2){if(!['--experiment','--out','--reconstruct','--bundle','--engine-dir','--serve','--open','--port'].includes(argv[i])||!argv[i+1]||args[argv[i]])throw Error('Expected flag/value pairs');args[argv[i]]=argv[i+1];}
 if(!args['--experiment']||!args['--out'])throw Error('Expected --experiment DIR --out NEW-DIR');
 const serve=autoServe({serve:args['--serve'],open:args['--open']});
 let capturesRoot=null;
 if(args['--reconstruct']==='true') {
  const root=resolve(args['--experiment']),manifest=readJson(join(root,'experiment.json')),source=readJson(join(root,'report/report.json'));
  if(!source?.cells)throw Error('Original report.json is required for reconstruction');
  const deaths=source.cells.filter(c=>c.outcome==='death');if(deaths.length>20)throw Error('At most 20 death replays per reconstruction command; use per-case replay for larger cohorts');
  const locations=replayPaths(root,{bundle:args['--bundle'],engine:args['--engine-dir']});const bundle=locations.bundle;if(!locations.bundleAvailable)throw Error(locations.reason??'Original --bundle is required');
  capturesRoot=resolve(args['--out'])+'.replays';mkdirSync(capturesRoot,{recursive:false});
  const {spawnSync}=await import('node:child_process');const replay=new URL('./replay.mjs',import.meta.url);
  for(const cell of deaths) {
   if(!/^\d+-\d+$/.test(cell.id))throw Error('Invalid death identifier');
   console.log(`Reconstructing last actions for ${cell.id}; this diagnostic is not an additional cohort life`);
   const child=spawnSync(process.execPath,[replay.pathname,'--experiment',root,'--case',cell.id,'--bundle',bundle,'--out',join(capturesRoot,cell.id),'--mode','capture'],{stdio:'inherit'});
   if(child.status!==0)console.error(`Replay ${cell.id} is not verified; its frames will not be displayed`);
  }
 }
 const result=reportExperiment(args['--experiment'],args['--out'],{capturesRoot,bundle:args['--bundle'],engine:args['--engine-dir'],portable:!!process.env.CI});console.log(`Browsable report: ${result.index}`);if(!result.complete||result.errors.length)process.exitCode=1;
 if(serve)await serveReport({dir:args['--out'],experiment:args['--experiment'],port:Number(args['--port']??0),openBrowser:args['--open']!=='false'});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)mainReport().catch(error=>{console.error(error.message);process.exitCode=1;});
