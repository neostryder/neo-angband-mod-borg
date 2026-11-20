// Standalone experiment orchestration. Each game runs in an isolated process.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { classes, races, loadSuite } from './ci/suite.mjs';
import { aggregate } from './ci/report.mjs';
import { writeReport } from './report.mjs';
import { autoServe,serveReport } from './serve-report.mjs';

const tool = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const usage = `Usage: node tools/zoo/experiment.mjs --bundle BUILD/bundle.mjs --out DIRECTORY
  [--games 18] [--max-ticks 5000] [--wall-seconds 120] [--workers 1]
  [--seed 3000] [--race Human] [--class Warrior] [--save-games true]
  [--birth-profile c-seeded-point-buy-v2|ordinary-rolled-v1]
  [--suite tools/zoo/ci/suites/classes-1800.json] [--plan-only]
  [--record true] [--serve true|false] [--open false] [--port N]

The output directory must be new. A frozen suite supplies assigned seeds/births;
--games selects its first N games. Overrides create a distinct saved plan.
The bundle's startup adapters must match the selected birth profile.
`;
const allowed = new Set(['bundle','out','games','max-ticks','wall-seconds','workers','seed','race','class','save-games','birth-profile','suite','serve','open','port','record']);
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (argv[i] === '--help') { args.help = true; continue; }
    if (argv[i] === '--plan-only') { args.planOnly = true; continue; }
    if (!argv[i].startsWith('--') || !allowed.has(key) || args[key] !== undefined || argv[i+1] === undefined || argv[i+1].startsWith('--')) throw Error(`Invalid or repeated argument ${argv[i]}`);
    args[key] = argv[++i];
  }
  return args;
}
function integer(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid --${name}: expected ${min}..${max}`);
  return n;
}
export function makePlan(args) {
  const source = args.suite ? loadSuite(resolve(args.suite)) : null;
  const count = integer(args.games, source?.cases.length ?? 18, 1, source?.cases.length ?? 1800, 'games');
  const seed = integer(args.seed, 3000, 0, 0xffffffff, 'seed');
  const workers = integer(args.workers, 1, 1, 8, 'workers');
  if (source && ['seed','race','class','birth-profile'].some(k => args[k] !== undefined)) throw Error('A frozen suite cannot override assigned seeds, births or profile');
  if (args.race && !races.includes(args.race)) throw Error('Unknown race');
  if (args.class && !classes.includes(args.class)) throw Error('Unknown class');
  if (args['save-games'] !== undefined && !['true','false'].includes(args['save-games'])) throw Error('Invalid --save-games');
  if(args.record!==undefined&&!['true','false'].includes(args.record))throw Error('Invalid --record');
  const cases = source ? source.cases.slice(0,count) : Array.from({length:count}, (_,i) => ({
    seed: Number(BigInt('0x'+hash(`neo-experiment:${seed}:${i}`).slice(0,16)) % 4294967296n),
    race: args.race ?? races[Math.floor(i/classes.length)%races.length],
    class: args.class ?? classes[i%classes.length],
  }));
  const suite = {
    schema: 'neo-headless-suite@1',
    birthProfile: source?.birthProfile ?? args['birth-profile'] ?? 'c-seeded-point-buy-v2',
    turns: integer(args['max-ticks'], source?.turns ?? 5000, 1, 200000, 'max-ticks'),
    wallSeconds: integer(args['wall-seconds'], source?.wallSeconds ?? 120, 1, 3600, 'wall-seconds'),
    saveGames: args['save-games'] === 'true',
    record: args.record==='true',
    cases: cases.map(({seed,race,class:cls}) => ({seed,race,class:cls})),
  };
  if (!['ordinary-rolled-v1','c-seeded-point-buy-v2'].includes(suite.birthProfile)) throw Error('Unknown birth profile');
  return {suite: {...suite, id: `experiment-${hash(JSON.stringify(suite)).slice(0,16)}`}, workers, sourceSuite: source?.id ?? null};
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }
  if (!args.out || (!args.bundle && !args.planOnly)) throw Error(usage);
  const serve=autoServe(args);
  const plan = makePlan(args), out = resolve(args.out);
  // Fail before launching anything if an existing directory could be overwritten.
  mkdirSync(out, {recursive:false});
  const suiteFile = join(out,'suite.json');
  writeFileSync(suiteFile, JSON.stringify(plan.suite,null,2)+'\n', {flag:'wx'});
  const suite = loadSuite(suiteFile);
  const manifest = {schema:'neo-experiment@1', startedAt:new Date().toISOString(), cwd:process.cwd(),
    locations:{bundle:args.bundle?resolve(args.bundle):null,tools:resolve(tool,'../..')},
    argv:process.argv.slice(2), node:process.version, platform:process.platform,
    suiteSha256:hash(readFileSync(suiteFile)), sourceSuite:plan.sourceSuite,
    workers:plan.workers, toolingSha256:Object.fromEntries(['experiment.mjs','ci/run.mjs','ci/suite.mjs','ci/report.mjs','run.mjs','report.mjs','replay-paths.mjs','source-integrity.mjs','serve-report.mjs'].map(file=>[file,hash(readFileSync(join(tool,file)))])), build:args.bundle ? JSON.parse(readFileSync(join(dirname(resolve(args.bundle)),'build.json'),'utf8')) : null};
  writeFileSync(join(out,'experiment.json'), JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  if (args.planOnly) { console.log(`Saved ${suite.cases.length}-game plan: ${suiteFile}`); return; }
  const runs = join(out,'runs'); mkdirSync(runs);
  const count = Math.min(plan.workers,suite.cases.length);
  const results = await Promise.all(Array.from({length:count}, (_,shard) => new Promise(resolveChild => {
    const child = spawn(process.execPath,[join(tool,'ci/run.mjs'),'--bundle',resolve(args.bundle),'--suite',suiteFile,'--shard',String(shard),'--shards',String(count),'--out',join(runs,`worker-${shard}`)],{stdio:'inherit'});
    child.on('error', error => resolveChild({shard,error:String(error)}));
    child.on('exit', (code,signal) => resolveChild({shard,code,signal}));
  })));
  const rows = [];
  for (let shard=0;shard<count;shard++) {
    const dir=join(runs,`worker-${shard}`);
    try { for (const row of JSON.parse(readFileSync(join(dir,'cells.json'),'utf8'))) rows.push({...row,evidencePath:join(dir,row.evidence)}); }
    catch { /* aggregate accounts for every missing assignment. */ }
  }
  const report=aggregate(suite,rows); report.execution=results;
  const reportDir=join(out,'report');
  writeReport(report,{out:reportDir,runsRoot:runs,experimentRoot:out,portable:!!process.env.CI});
  console.log(`Report: ${join(reportDir,'report.md')}\n${JSON.stringify(report.counts)}`);
  if (report.errors.length || report.recorded!==report.assigned || results.some(r=>r.code!==0) || ['harness_failure','config_error','wall_timeout'].some(k=>report.counts[k])) process.exitCode=1;
  if(serve)await serveReport({dir:reportDir,experiment:out,port:Number(args.port??0),openBrowser:args.open!=='false'});
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) main().catch(error=>{console.error(error.message);process.exitCode=1;});
