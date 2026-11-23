// Recorded/reconstructed known-state frames, with inventory and message context.
const esc=value=>String(value??'unknown').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cut=(s,n)=>String(s??'').slice(0,n);
export function monsterGlyph(monster) {return typeof monster.glyph==='string'&&monster.glyph.length?[...monster.glyph][0]:'?';}
const itemName=i=>i.name??i.description??i.baseName??i.label??'unidentified item';
function content(frame,index,total) {
 const p=frame.player??{},g=p.grid??{x:0,y:0},cell=18,radius=12;
 let out='<rect width="1050" height="750" fill="#111b2b"/>';
 const line=(x,y,text,color='#e4ebf5',size=16)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}">${esc(text)}</text>`;
 out+=line(18,28,`${p.race??'?'} ${p.cls??'?'} · tick ${frame.turn??'?'} · frame ${index+1}/${total}`,'#91e9c5',21);
 out+=line(18,55,`HP ${p.hp??'?'}/${p.maxHp??'?'}   SP ${p.sp??'?'}/${p.maxSp??'?'}   Level ${p.level??'?'}   Depth ${p.depth??'?'}   Gold ${p.gold??'?'}   Position ${g.x},${g.y}`);
 const status=Object.entries(p.status??{}).filter(([k,v])=>k!=='timed'&&k!=='countdown'&&v&&typeof v!=='object').map(([k,v])=>`${k}: ${v}`).join(', ');
 out+=line(18,79,cut(status||'No disabling status recorded',100),'#ffcf8e',14);
 for(const c of frame.level?.cells??[]) {
  const x=c.x-g.x+radius,y=c.y-g.y+radius;if(x<0||y<0||x>24||y>24)continue;
  const code=c.remembered?.featCode??'';
  const glyph=/LESS/.test(code)?'<':/MORE/.test(code)?'>':/GRANITE|PERM|WALL/.test(code)?'#':/CLOSED|DOOR/.test(code)?'+':c.remembered?.passable?'.':'?';
  out+=line(20+x*cell,110+y*cell,glyph,c.visible?'#e3eaf4':'#70839c');
 }
 for(const m of frame.monsters??[]) {
  const x=m.grid?.x-g.x+radius,y=m.grid?.y-g.y+radius;if(x<0||y<0||x>24||y>24)continue;
  out+=`<g><title>${esc(m.race??m.name??'Observed monster')}</title>${line(20+x*cell,110+y*cell,monsterGlyph(m),'#ff9d7d')}</g>`;
 }
 out+=line(20+radius*cell,110+radius*cell,'@','#6ef0b7');
 let y=108;out+=line(510,y,'Equipment','#91e9c5');y+=22;
 for(const i of (frame.equipment??[]).filter(Boolean).slice(0,9)){out+=line(510,y,cut(itemName(i),58),'#d5e2f3',13);y+=18;}
 out+=line(510,y+10,'Pack / quiver','#91e9c5');y+=34;
 const items=[...(frame.inventory??[]),...(frame.quiver??[])].filter(Boolean);
 for(const i of items.slice(0,14)){out+=line(510,y,cut(itemName(i),58),'#d5e2f3',13);y+=18;}
 if(items.length>14){out+=line(510,y,`${items.length-14} more items: full inventory.md / last-actions.json`, '#aabbd0',12);y+=18;}
 out+=line(18,585,`Action: ${frame.action?.code??(frame.kind==='terminal'?'terminal state':'observation')} ${JSON.stringify(frame.action?.args??(frame.action?.dir!==undefined?{dir:frame.action.dir}:{}))} ${frame.accepted===false?'(refused)':''}`,'#ffcf8e',14);
 out+=line(18,608,cut((frame.monsters??[]).map(m=>`${monsterGlyph(m)} ${m.race??m.name??'unknown'} (${m.health??'health unknown'})`).join(' · ')||'No perceived monster recorded',130),'#ffb39a',13);
 let my=634;for(const m of (frame.messages??[]).slice(-5)){out+=line(18,my,cut(m.text??m.message??m,125),'#e4ebf5',13);my+=19;}
 return `<g font-family="monospace">${out}</g>`;
}
export function frameSvg(frame,index=0,total=1) {return `<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="750" viewBox="0 0 1050 750" role="img" aria-label="Observed game frame">${content(frame,index,total)}</svg>`;}
export function animatedSvg(frames) {
 const n=frames.length,duration=n*0.4;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="750" viewBox="0 0 1050 750" role="img" aria-label="Last 30 Borg actions and terminal state">${frames.map((f,i)=>`<g visibility="hidden"><animate attributeName="visibility" values="visible;hidden;hidden" keyTimes="0;${1/n};1" dur="${duration}s" begin="${i*0.4}s" repeatCount="indefinite" calcMode="discrete"/>${content(f,i,n)}</g>`).join('')}</svg>`;
}
export function playerMarkup(frames,qualification) {
 const slides=JSON.stringify(frames.map((f,i)=>frameSvg(f,i,frames.length))).replaceAll('<','\\u003c');
 return `<section class="card"><h2>Last ${Math.max(0,frames.length-1)} actions and endpoint</h2><p>${esc(qualification)}</p><button id="clip-play">Pause</button> <button id="clip-prev">Previous</button> <button id="clip-next">Next</button> <input id="clip-frame" aria-label="Action frame" type="range" min="0" max="${frames.length-1}" value="0"><span id="clip-count"></span><div id="clip-screen" style="width:100%;max-width:1050px"></div><script>const slides=${slides};let current=0,playing=true;function draw(){document.querySelector('#clip-screen').innerHTML=slides[current];document.querySelector('#clip-screen svg').style.width='100%';document.querySelector('#clip-screen svg').style.height='auto';document.querySelector('#clip-frame').value=current;document.querySelector('#clip-count').textContent=(current+1)+' / '+slides.length}document.querySelector('#clip-frame').oninput=e=>{current=Number(e.target.value);playing=false;draw()};document.querySelector('#clip-play').onclick=()=>{playing=!playing;document.querySelector('#clip-play').textContent=playing?'Pause':'Play'};document.querySelector('#clip-prev').onclick=()=>{playing=false;current=(current+slides.length-1)%slides.length;draw()};document.querySelector('#clip-next').onclick=()=>{playing=false;current=(current+1)%slides.length;draw()};setInterval(()=>{if(playing){current=(current+1)%slides.length;draw()}},400);draw()</script></section>`;
}
