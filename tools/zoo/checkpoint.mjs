// Reconstruct an engine checkpoint, qualified against the original full run.
import { readFileSync,writeFileSync,openSync,writeSync,closeSync,fsyncSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function checkpointBundle(source) {
 const needle='const result = originalGate.submit(token, intent);';
 if(source.split(needle).length!==2||!source.includes('saveGame(game)'))throw Error('Retained bundle has no supported checkpoint site');
 return source.replace(needle,needle+`\nif(intent.kind==='command'){o.__checkpointCommands=(o.__checkpointCommands??0)+1;if(o.__checkpointCommands===o.checkpointCommandOrdinal)o.onCheckpoint?.({turn:state.turn,save:saveGame(game)});}`);
}
export function requestedCheckpoint(original,beforeDeath) {
 if(!Number.isSafeInteger(beforeDeath)||beforeDeath<1||beforeDeath>200000)throw Error('before-death must be 1..200000 engine ticks');
 if(original.outcome!=='death'||!Number.isSafeInteger(original.turn))throw Error('before-death requires a recorded death endpoint');
 return Math.max(0,original.turn-beforeDeath);
}
export async function captureCheckpoint({original,build,bundle,out,beforeDeath,commandFile}) {
 const target=requestedCheckpoint(original,beforeDeath),source=checkpointBundle(readFileSync(bundle,'utf8'));
 let ordinal=0,selected=0;
 for(const line of readFileSync(commandFile,'utf8').split('\n').filter(Boolean)){const row=JSON.parse(line);if(row.type==='intent'&&row.intent?.kind==='command'){ordinal++;if(row.turn<=target)selected=ordinal;}}
 const derived=join(out,'checkpoint-bundle.mjs');writeFileSync(derived,source,{flag:'wx'});
 const runtime=await import(pathToFileURL(derived)),journal=openSync(join(out,'checkpoint-states.jsonl'),'wx');
 let candidate=null,result;
 try {
  result=await runtime.run({...original.inputs,packDir:join(dirname(bundle),'pack'),manifest:build.borg.manifest.data,
   exactTickCap:build.exactTickCap,cSeedStartup:build.cSeedStartup,checkpointBefore:target,checkpointCommandOrdinal:selected,
   truthIdentity:{id:build.borg.manifest.data.id,version:build.borg.manifest.data.version,digest:sha(source),installation:'checkpoint:'+sha(source)},
   onState:row=>{writeSync(journal,JSON.stringify(row)+'\n');if(row.kind==='truth-use')fsyncSync(journal);},onCommand:()=>{},onMessage:()=>{},
   onSave:(stage,save)=>{if(stage==='birth'&&save.turn<=target)candidate={turn:save.turn,save:structuredClone(save)};},
   onCheckpoint:row=>{if(row.turn<=target&&(!candidate||row.turn>=candidate.turn))candidate=structuredClone(row);}});
 } finally {closeSync(journal);}
 const {replayMatches}=await import('./replay.mjs');
 const verified=replayMatches(original,{...result,inputs:original.inputs});
 const receipt={schema:'neo-before-death-checkpoint@1',verified,requestedBeforeDeath:beforeDeath,targetTurn:target,
  selectedCommandOrdinal:selected,actualTurn:candidate?.turn??null,actualLead:candidate?original.turn-candidate.turn:null,
  originalCommandSha256:original.playSha256,replayCommandSha256:result.playSha256,
  originalBundleSha256:build.bundleSha256,observerBundleSha256:sha(source),
  startupContract:'saved engine state/RNG with fresh Borg private memory; not uninterrupted controller continuation'};
 writeFileSync(join(out,'checkpoint.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 if(!verified)throw Error('Checkpoint replay does not match the full original command hash/birth/outcome; refusing to launch');
 if(!candidate)throw Error('No checkpoint at or before requested target was retained');
 if(candidate.turn>target||candidate.save.turn!==candidate.turn||candidate.save.isDead)throw Error('Checkpoint is not a valid living engine state at the selected boundary');
 return {save:candidate.save,receipt};
}
