// Actual Neo frontend launcher: scratch browser session, recorded turn-0 birth.
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync,spawn } from 'node:child_process';
import { sourceIntegrity,recordedSourcesClean } from './source-integrity.mjs';
import { pathToFileURL } from 'node:url';
const sha=s=>createHash('sha256').update(s).digest('hex');
export async function launchGame({experiment,caseId,bundle,engine,out,prepareOnly=false,openBrowser=true,autodelay=1000,startDelay=1000,beforeDeath=undefined,allowUnpinned=false}) {
 if(!Number.isInteger(autodelay)||autodelay<0||autodelay>10000)throw Error('autodelay must be 0..10000 milliseconds');
 if(!Number.isInteger(startDelay)||startDelay<0||startDelay>600000)throw Error('start-delay must be 0..600000 milliseconds');
 const root=resolve(experiment),buildPath=resolve(bundle),engineRoot=resolve(engine),output=resolve(out);
 const manifest=JSON.parse(readFileSync(join(root,'experiment.json'))),suite=JSON.parse(readFileSync(join(root,'suite.json')));
 if(!/^\d+-\d+$/.test(caseId))throw Error('Invalid case identifier');
 const index=Number(caseId.split('-')[0]),c=suite.cases[index];
 if(!c||String(c.seed)!==caseId.split('-')[1])throw Error('Case differs from frozen assignment');
 const worker=index%Math.min(manifest.workers,suite.cases.length),raw=join(root,'runs',`worker-${worker}`,caseId,'run');
 const original=JSON.parse(readFileSync(join(raw,'run.json'))),build=JSON.parse(readFileSync(join(dirname(buildPath),'build.json')));
 if(sha(readFileSync(buildPath))!==original.provenance.bundleSha256)throw Error('Use the original recorded bundle');
 const sourceVerified=recordedSourcesClean(build);
 if(!sourceVerified&&!allowUnpinned)throw Error('Recorded build is marked dirty or lacks a clean-source receipt. The retained bundle remains headless-replayable; rebuild clean sources, or explicitly use --allow-unpinned true for an unverified graphical diagnostic.');
 if(!sourceVerified)console.log('UNVERIFIED GRAPHICAL DIAGNOSTIC: recorded source dirtiness is not resolved; this is not a pinned reproduction.');
 const currentIntegrity=sourceIntegrity(engineRoot,{engine:true});
 const git=(...a)=>execFileSync('git',['-C',engineRoot,...a],{encoding:'utf8'}).trim();
 if(git('rev-parse','HEAD')!==build.engine.commit)throw Error('Engine checkout differs from recorded pin');
 for(const [file,hash] of Object.entries(build.contentFiles))if(sha(readFileSync(join(engineRoot,'packages/content/pack',file)))!==hash)throw Error('Engine content differs from retained build');
 mkdirSync(output,{recursive:false});
 let birth,checkpoint=null;
 if(beforeDeath!==undefined) {
  const {captureCheckpoint}=await import('./checkpoint.mjs');
  console.log(`Reconstructing ${beforeDeath} engine ticks before death; verifying the original complete run`);
  checkpoint=await captureCheckpoint({original,build,bundle:buildPath,out:output,beforeDeath,commandFile:join(raw,'commands.jsonl')});birth=checkpoint.save;
 } else {
  const captured={},runtime=await import(pathToFileURL(buildPath));
  try {
   await runtime.run({...original.inputs,packDir:join(dirname(buildPath),'pack'),manifest:build.borg.manifest.data,
    exactTickCap:build.exactTickCap,cSeedStartup:build.cSeedStartup,
    onState:()=>{},onCommand:()=>{},onMessage:()=>{},onSave:(stage,save)=>{if(stage==='birth'){birth=save;throw captured;}},
    truthIdentity:{id:'borg',version:build.borg.manifest.data.version,digest:build.bundleSha256,installation:'headless:'+build.bundleSha256}});
  } catch(error){if(error!==captured)throw error;}
 }
 if(!birth)throw Error('This retained bundle cannot export the requested initial state');
 const states=readFileSync(join(raw,'states.jsonl'),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s));
 const initial=states.find(s=>s.kind==='alignment'),active=states.find(s=>s.kind==='alignment-active');
 const options=active?.options?.values??{};
 const config={sourceVerified,currentIntegrity,singleLife:true,autodelay,startDelay,startTurn:checkpoint?.receipt.actualTurn??0,checkpoint:checkpoint?.receipt??null,seed:c.seed,birth:original.birth,options,birthRng:checkpoint?null:initial?.worldRng??null,borgSeed:active?.seededBorgSeed??null,
  seeded:build.cSeedStartup===true,truth:!!original.truthUse?.capabilityUse?.entries?.length,settings:original.settings,engine:build.engine,borg:build.borg};
 writeFileSync(join(output,'birth.save.json'),JSON.stringify(birth));writeFileSync(join(output,'launch.json'),JSON.stringify(config,null,2));
 const borgRoot=resolve(dirname(new URL(import.meta.url).pathname),'../..');
 let plugin=execFileSync('git',['-C',borgRoot,'show',`${build.borg.commit}:plugin.js`],{encoding:'utf8',maxBuffer:8*1024*1024});
 if(config.seeded){const needle='createBorg({ resolvers:';if(plugin.split(needle).length!==2)throw Error('Unsupported Borg startup site');plugin=plugin.replace(needle,'createBorg({ rngSeed: globalThis.__neoReportBorgSeed(), resolvers:');}
 writeFileSync(join(output,'recorded-borg.mjs'),plugin);writeFileSync(join(output,'manifest.json'),JSON.stringify(build.borg.manifest.data));
 if(prepareOnly)return {output,config};
 if(!existsSync(join(engineRoot,'packages/linoleum/dist/targets.js')))execFileSync('pnpm',['--dir',engineRoot,'exec','tsc','-b','packages/linoleum'],{stdio:'inherit'});
 const {createServer}=await import(createRequire(join(engineRoot,'packages/web/package.json')).resolve('vite'));
 const imports=`import __reportDefinition from ${JSON.stringify(join(output,'recorded-borg.mjs'))};\nimport __reportManifest from ${JSON.stringify(join(output,'manifest.json'))};\nimport __reportBirth from ${JSON.stringify(join(output,'birth.save.json'))};\nimport {api2Plugin as __reportShim} from './mod-api2-shim';\nconst __reportConfig=${JSON.stringify(config)};\n`;
 const append=`
// FORK diagnostic launcher only: keep the normal screen, input gate and Borg pump.
const __reportStart = async () => {
  if(!gameScreenLive || birthPending) {setTimeout(__reportStart,50);return;}
  if(state.turn!==__reportConfig.startTurn)throw Error('Replay start turn differs from retained checkpoint');
  for(const [name,value] of Object.entries(__reportConfig.options))state.options.set(name,value);
  if(__reportConfig.birthRng)state.rng.setState(__reportConfig.birthRng);
  globalThis.__neoReportBorgSeed=()=>{if(__reportConfig.checkpoint)return __reportConfig.borgSeed;const seed=state.rng.randint1(0x10000000);if(__reportConfig.borgSeed!==null&&seed!==__reportConfig.borgSeed)throw Error('Recorded Borg startup RNG mismatch');return seed;};
  const caps={has:(name)=>name==='engine:access'||__reportManifest.capabilities.includes(name)};
  // Reuse the real synchronous save writer and retain the original host contract.
  setTruthSaveWriter(__reportConfig.truth?(id,cap,current)=>{
    if(id!=='borg'||cap!=='state:monsters-actual.read'||current!==state||!caps.has(cap))return false;
    recordTruthUse(game.manifest,state.actor.player,{id:'borg',version:__reportManifest.version,digest:${JSON.stringify(build.bundleSha256)},installation:'report-game'},cap,{turn:state.turn,depth:state.chunk.depth});
    return persistSave(false,true);
  }:undefined);
  const ctx={...modPluginContext('borg',__reportConfig.settings,state,{}, {newCharacter:true,capabilities:caps,snapshotSource:modSnapshotSource}),controllerArmed:true};
  const opts=()=>({grants:caps,tier:'first-party',execution:'in-process',developerInProcess:true,firstParty:{truth:true}});
  const api=createApi2Host(ctx,{...opts(),viewDeps:modSnapshotSource.viewDeps()});
  await __reportDefinition.start?.(api);
  const engineRngMatchedAtStart=!__reportConfig.checkpoint||Object.keys(__reportBirth.rng).every(key=>JSON.stringify(__reportBirth.rng[key])===JSON.stringify(state.rng.getState()[key]));
  if(!engineRngMatchedAtStart)throw Error('Loaded checkpoint RNG differs from the retained engine state');
  const wrapper=__reportShim({...__reportDefinition,onDeath:'end'},opts);
  const loaded={id:'borg',api:2,manifest:__reportManifest,plugin:wrapper,tier:{trust:'first-party',execution:'in-process'}};
  let autoTimer;
  const resume=()=>{
    clearTimeout(autoTimer);
    if(state.isDead||installedController)return false;
    const answer=wrapper.controller?.(ctx);if(!answer)throw Error('Recorded Borg refused to resume');
    MOD_AUTOPLAYER_TICK_MS=__reportConfig.autodelay;
    finishAutoplayerInstall(loaded,controllerInstallOf(answer));
    return installedController?.id==='borg';
  };
  window.__neoReport={seed:__reportConfig.seed,startTurn:state.turn,started:false,engineRngMatchedAtStart,resume,isRunning:()=>!dead&&installedController?.id==='borg',lifeEnded:()=>dead,deathPolicy:()=>installedController?.onDeath,autodelay:__reportConfig.autodelay,startDelay:__reportConfig.startDelay,actualBirth:{turn:state.turn,race:state.actor.player.race.name,class:state.actor.player.cls.name,hp:state.actor.player.chp,sp:state.actor.player.csp,gold:state.actor.player.au,stats:[...state.actor.player.statBirth],grid:{...state.actor.grid}},speed:(value)=>installedControllerSpeed?.(value),birth:__reportConfig.birth,hostTruth:__reportConfig.truth};
  if(!__reportConfig.sourceVerified)document.title='Unverified Neo graphical diagnostic';
  panelCues.setEnabled(false);
  for(const id of ['inventory','equipment','messages','monsters'])setSubwindowEnabledLive(id,true);
  render();
  autoTimer=setTimeout(()=>{window.__neoReport.started=resume();},__reportConfig.startDelay);
};
void __reportStart().catch(error=>{console.error(error);document.body.insertAdjacentHTML('beforeend','<pre id="report-launch-error"></pre>');document.querySelector('#report-launch-error').textContent=String(error);});
`;
 let sites=0;
 const server=await createServer({root:join(engineRoot,'packages/web'),configFile:false,define:{__NEO_BUILD_ID__:JSON.stringify('recorded-borg-run'),__NEO_LAB_BUILD__:'false'},
  server:{host:'127.0.0.1',port:0,strictPort:true,fs:{allow:[engineRoot,output]}},plugins:[{name:'recorded-birth-borg-launch',enforce:'pre',transform(code,id){
   if(id.split('?')[0]!==join(engineRoot,'packages/web/src/main.ts'))return;
   const needle='function bootGame(): ReturnType<typeof startGame> {';if(code.split(needle).length!==2)throw Error('Unsupported normal-game boot site');sites++;
   code=code.replace(needle,needle+`\nlookStore.choose('Vanilla');bootedNew=true;setActiveId(newCharId());attachSlot(getActiveId());reloadStorage.setItem(SKIP_TITLE_KEY,'1');reloadStorage.setItem(BIRTH_DONE_KEY,'1');return loadGame(pack,__reportBirth);\n`);
   const resumeSite='function tryBorgCommand(): void {';
   if(code.split(resumeSite).length!==2)throw Error('Unsupported Borg resume command site');
   code=code.replace(resumeSite,resumeSite+`\nif(!installedController&&window.__neoReport?.resume){window.__neoReport.resume();return;}\n`);
   const deathSite='if (holder.onDeath === "end") return false;';
   if(code.split(deathSite).length!==2)throw Error('Unsupported single-life death policy site');
   code=code.replace(deathSite,`if(holder.onDeath === "end"){stopInstalledController?.("recorded life ended", "Borg stopped: this recorded life has ended.");return false;}`);
   return imports+code+append;
  }}]});
 await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/?new=1&seed=${c.seed}`;
 console.log(`Open the actual Neo game: ${url}\nSeed ${c.seed}; ${c.race} ${c.class}; turn ${config.startTurn}. The recorded Borg starts after ${startDelay}ms, with ${autodelay}ms controller polls. Escape pauses it; Ctrl-Z resumes it. Ctrl-C closes this isolated server.\nRetained launch: ${output}`);
 if(openBrowser){const opener=spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});opener.on('error',()=>console.log('Open the printed URL in your browser.'));opener.unref();}
 const stop=()=>server.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);return {server,url,output};
}
