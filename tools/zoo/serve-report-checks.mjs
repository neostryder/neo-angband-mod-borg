import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { serveReport,autoServe } from './serve-report.mjs';
test('interactive report commands serve automatically; batch and CI remain finite',()=>{
 assert.equal(autoServe({}, {tty:true,ci:'',locked:false}),true);assert.equal(autoServe({}, {tty:false,ci:'',locked:false}),false);assert.equal(autoServe({}, {tty:true,ci:'true'}),false);assert.equal(autoServe({}, {tty:true,ci:'',locked:true}),false);
 assert.equal(autoServe({serve:'false'},{tty:true}),false);assert.equal(autoServe({serve:'true'},{tty:false,ci:'true',locked:false}),true);assert.throws(()=>autoServe({serve:'typo'}));assert.throws(()=>autoServe({serve:'true'},{locked:true}),/validation lock/);
});
test('HTTP report serves death pages, images and explicitly mounted raw logs with working rewritten links',async()=>{
 const root=mkdtempSync(join(tmpdir(),'neo-report-http-'));let server;
 try {
  const report=join(root,'report'),raw=join(root,'experiment/runs/worker-0/0-7/run');mkdirSync(join(report,'deaths/0-7'),{recursive:true});mkdirSync(raw,{recursive:true});
  writeFileSync(join(report,'index.html'),'<a href="deaths/0-7/index.html">Death</a>');
  writeFileSync(join(report,'deaths/0-7/index.html'),'<a href="../../../experiment/runs/worker-0/0-7/run/messages.jsonl">Messages</a><img src="map.svg">');
  writeFileSync(join(report,'deaths/0-7/map.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');writeFileSync(join(raw,'messages.jsonl'),'actual messages');
  const started=await serveReport({dir:report,experiment:join(root,'experiment'),openBrowser:false});server=started.server;const base=new URL(started.url).origin;
  const index=await(await fetch(started.url)).text();assert.match(index,/\/report\/deaths\/0-7\/index.html/);
  const page=await(await fetch(base+'/report/deaths/0-7/index.html')).text();assert.match(page,/\/evidence\/worker-0\/0-7\/run\/messages.jsonl/);assert.match(page,/\/report\/deaths\/0-7\/map.svg/);
  assert.equal(await(await fetch(base+'/evidence/worker-0/0-7/run/messages.jsonl')).text(),'actual messages');
  const head=await fetch(base+'/report/deaths/0-7/map.svg',{method:'HEAD'});assert.equal(head.status,200);assert.match(head.headers.get('content-type'),/image\/svg/);assert.equal(await head.text(),'');
  assert.equal((await fetch(base+'/report/index.html',{method:'POST'})).status,405);
  assert.equal(await new Promise((done,fail)=>{const req=request(base+'/report/index.html',{headers:{Host:'untrusted.example'}},res=>{res.resume();done(res.statusCode)});req.on('error',fail);req.end()}),403);
  writeFileSync(join(root,'private.txt'),'not a report');symlinkSync(join(root,'private.txt'),join(report,'escape.txt'));
  assert.equal((await fetch(base+'/report/escape.txt')).status,403);assert.equal((await fetch(base+'/report/%2e%2e/private.txt')).status,404);
  assert.equal((await fetch(base+'/report/missing')).status,404);
 }finally{if(server)await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
