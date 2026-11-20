// Serve only the selected report and its explicitly selected raw-evidence tree.
import { createServer } from 'node:http';
import { readFileSync,realpathSync,statSync,existsSync,readdirSync,readlinkSync } from 'node:fs';
import { resolve,join,dirname,relative,sep,extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
const types={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.jsonl':'text/plain; charset=utf-8','.log':'text/plain; charset=utf-8'};
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const attr=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
function browserOpen(url) {
 const child=spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});
 child.on('error',()=>console.log('Open the report URL above in your browser.'));child.unref();
}
export function inheritedValidationLock(lockPath='/tmp/angband-validation.lock') {
 if(process.platform!=='linux')return false;
 let pid=process.pid;
 for(let depth=0;pid>0&&depth<16;depth++) {
  try {
   for(const fd of readdirSync(`/proc/${pid}/fd`))try{if(readlinkSync(`/proc/${pid}/fd/${fd}`)===lockPath)return true;}catch{}
   const match=readFileSync(`/proc/${pid}/status`,'utf8').match(/^PPid:\s+(\d+)/m);pid=match?Number(match[1]):0;
  }catch{return false;}
 }
 return false;
}
export function autoServe(options,{tty=process.stdout.isTTY,ci=process.env.CI,locked=inheritedValidationLock()}={}) {
 if(locked&&options.serve==='true')throw Error('Cannot serve while inheriting the validation lock; export with --serve false and serve after releasing it');
 if(options.open!==undefined&&!['true','false'].includes(options.open))throw Error('--open must be true or false');
 if(options.serve!==undefined&&!['true','false'].includes(options.serve))throw Error('--serve must be true or false');
 return options.serve===undefined?!!tty&&!ci&&!locked:options.serve==='true';
}
export async function serveReport({dir,experiment,port=0,openBrowser=true}) {
 if(!Number.isInteger(port)||port<0||port>65535||(port>0&&port<1024))throw Error('Invalid report port');
 const report=realpathSync(resolve(dir));if(!statSync(report).isDirectory()||!existsSync(join(report,'index.html')))throw Error('Report directory must contain index.html');
 const mounts=[{prefix:'/report/',root:report}];
 if(experiment)mounts.push({prefix:'/evidence/',root:realpathSync(join(resolve(experiment),'runs'))});
 function webPath(file){for(const m of mounts)if(inside(m.root,file))return m.prefix+relative(m.root,file).split(sep).map(encodeURIComponent).join('/');return null;}
 function links(source,file) {
  return source.replace(/\b(href|src)="([^"]*)"/g,(all,key,value)=>{
   const decoded=value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");
   if(!decoded||decoded.startsWith('#')||decoded.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(decoded))return all;
   const [path,suffix='']=decoded.split(/(?=[?#])/s,2);let target;try{target=resolve(dirname(file),decodeURIComponent(path));if(existsSync(target))target=realpathSync(target);}catch{return all;}
   const url=webPath(target);return url?`${key}="${attr(url+suffix)}"`:all;
  });
 }
 let localPort;
 const server=createServer((req,res)=>{
  const host=req.headers.host;
  if(host!==`127.0.0.1:${localPort}`&&host!==`localhost:${localPort}`){res.writeHead(403).end('Local report host required');return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;}
  let url,path;try{url=new URL(req.url,'http://127.0.0.1');path=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(path==='/'){res.writeHead(302,{'Location':'/report/index.html'}).end();return;}
  const mount=mounts.find(m=>path.startsWith(m.prefix));if(!mount){res.writeHead(404).end('Not found');return;}
  const part=path.slice(mount.prefix.length);if(part.split('/').some(p=>p==='..'||p==='.')||part.includes('\\')||part.includes('\0')){res.writeHead(403).end();return;}
  try {
   let file=realpathSync(resolve(mount.root,part));if(!inside(mount.root,file)){res.writeHead(403).end();return;}
   if(statSync(file).isDirectory()){
    if(!path.endsWith('/')){res.writeHead(302,{'Location':url.pathname+'/'}).end();return;}
    file=realpathSync(join(file,'index.html'));if(!inside(mount.root,file)){res.writeHead(403).end();return;}
   }
   if(!statSync(file).isFile()){res.writeHead(404).end();return;}
   const extension=extname(file).toLowerCase(),type=types[extension]??'application/octet-stream';
   let data=readFileSync(file);if(extension==='.html')data=Buffer.from(links(data.toString('utf8'),file));
   res.writeHead(200,{'Content-Type':type,'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
   res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404).end('Not found');}
 });
 await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});localPort=server.address().port;
 const url=`http://127.0.0.1:${localPort}/report/index.html`;
 console.log(`Death reports: ${url}\nServing ${report}\nCtrl-C stops the local report server.`);
 const stop=()=>server.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);server.once('close',()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);});
 if(openBrowser)browserOpen(url);
 return {server,url};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try {
  const args={};const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i+=2){if(!['--dir','--experiment','--port','--open'].includes(argv[i])||!argv[i+1]||args[argv[i]])throw Error('Usage: pnpm report:serve --dir REPORT --experiment EXPERIMENT [--port 8765] [--open false]');args[argv[i]]=argv[i+1];}
  if(!args['--dir'])throw Error('Missing --dir');
  await serveReport({dir:args['--dir'],experiment:args['--experiment'],port:Number(args['--port']??0),openBrowser:args['--open']!=='false'});
 }catch(error){console.error(error.message);process.exitCode=1;}
}
