// Optional real-frontend regression; requires a built engine and its Chromium.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve,join } from 'node:path';
import { launchGame } from './game-launch.mjs';
const a=Object.fromEntries(process.argv.slice(2).reduce((r,v,i,all)=>i%2?r:r.concat([[v.replace(/^--/,''),all[i+1]]]),[]));
for(const key of ['engine-dir','experiment','case','bundle','out'])if(!a[key])throw Error('Required --'+key);
const engine=resolve(a['engine-dir']);
const playwright=await import(createRequire(join(engine,'package.json')).resolve('playwright'));
const chromium=playwright.chromium??playwright.default?.chromium;
let browser,game;
try {
 game=await launchGame({engine,experiment:a.experiment,caseId:a.case,bundle:a.bundle,out:a.out,openBrowser:false,autodelay:250,startDelay:3000,allowUnpinned:a['allow-unpinned']==='true'});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(game.url);await page.waitForFunction(()=>!!window.__neoReport,{timeout:30000});
 assert.deepEqual(await page.evaluate(()=>({turn:window.__neo.turn,running:window.__neoReport.isRunning(),delay:window.__neoReport.autodelay,start:window.__neoReport.startDelay})),{turn:0,running:false,delay:250,start:3000});
 await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__neo.turn),0);
 await page.waitForFunction(()=>window.__neoReport.isRunning(),{timeout:6000});assert.equal(await page.evaluate(()=>window.__neoReport.deathPolicy()),'end');await page.waitForFunction(()=>window.__neo.turn>0,{timeout:5000});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__neoReport.isRunning());await page.waitForTimeout(500);
 const stopped=await page.evaluate(()=>window.__neo.turn);await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.__neo.turn),stopped);
 await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.__neoReport.isRunning(),{timeout:3000});await page.waitForFunction(t=>window.__neo.turn>t,stopped,{timeout:5000});
 assert.deepEqual(errors,[]);await page.screenshot({path:join(resolve(a.out),'browser-check.png')});
 console.log(JSON.stringify({seed:game.config?.seed??Number(a.case.split('-')[1]),startTurn:0,stopped,resumed:await page.evaluate(()=>window.__neo.turn),errors}));
} finally {await browser?.close();await game?.server.close();}
