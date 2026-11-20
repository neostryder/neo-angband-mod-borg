// Resolve saved relative arguments against their recorded cwd, never today's cwd.
import { readFileSync,existsSync } from 'node:fs';
import { resolve,dirname,isAbsolute,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const read=file=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
export function replayPaths(experiment,{bundle,engine,portable=false}={}) {
 const root=resolve(experiment),manifest=read(join(root,'experiment.json'))??{},args=manifest.argv??[];
 const saved=manifest.locations?.bundle??(args.indexOf('--bundle')>=0?args[args.indexOf('--bundle')+1]:null);
 let bundlePath=bundle?resolve(bundle):saved?(isAbsolute(saved)?saved:manifest.cwd?resolve(manifest.cwd,saved):null):null;
 const build=bundlePath?read(join(dirname(bundlePath),'build.json')):null;
 let enginePath=engine?resolve(engine):build?.sourcePaths?.engine??null;
 // Compatibility locator for original bundles whose generated entry has absolute imports.
 if(!enginePath&&bundlePath&&existsSync(join(dirname(bundlePath),'entry.ts'))) {
  const entry=readFileSync(join(dirname(bundlePath),'entry.ts'),'utf8'),m=entry.match(/from\s+("(?:[^"\\]|\\.)*\/packages\/core\/dist\/index\.js")/);
  if(m)enginePath=JSON.parse(m[1]).slice(0,-'/packages/core/dist/index.js'.length);
 }
 if(enginePath&&!isAbsolute(enginePath))enginePath=build?.sourcePaths?.cwd?resolve(build.sourcePaths.cwd,enginePath):null;
 const tools=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 const bundleAvailable=!!bundlePath&&existsSync(bundlePath)&&!portable;
 return {bundleAvailable,bundle:bundlePath,engine:enginePath,tools,root,
  available:bundleAvailable&&!!enginePath&&existsSync(join(enginePath,'package.json')),
  reason:portable?'Downloaded CI artifacts need local --bundle and --engine-dir locations; regenerate the report in your current checkout':!bundlePath?'Original bundle path is relative without a recorded cwd; pass --bundle':!enginePath?'No engine location was recorded; pass --engine-dir':!existsSync(bundlePath)||!existsSync(join(enginePath,'package.json'))?'Artifact/source locations have moved; regenerate here with --bundle and --engine-dir':null};
}
