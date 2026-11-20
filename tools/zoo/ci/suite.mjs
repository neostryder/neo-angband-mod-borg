// FORK: immutable assigned-birth measurement plans; no Borg policy is changed.
import { readFileSync } from 'node:fs';
export const classes = ['Warrior','Mage','Druid','Priest','Necromancer','Paladin','Rogue','Ranger','Blackguard'];
export const races = ['Human','Half-Elf','Elf','Hobbit','Gnome','Dwarf','Half-Orc','Half-Troll','Dunadan','High-Elf','Kobold'];
export function loadSuite(file) {
 const s=JSON.parse(readFileSync(file,'utf8'));
 if(s.schema!=='neo-headless-suite@1'||!/^[-a-z0-9]+$/.test(s.id)||!['c-seeded-point-buy-v2','ordinary-rolled-v1'].includes(s.birthProfile)||!Number.isSafeInteger(s.turns)||s.turns<1||s.turns>200000||!Number.isSafeInteger(s.wallSeconds)||s.wallSeconds<1||s.wallSeconds>3600||!Array.isArray(s.cases)||!s.cases.length||s.cases.length>1800)throw Error('Invalid headless suite');
 if(s.record!==undefined&&typeof s.record!=='boolean')throw Error('Invalid suite recording flag');
 const seen=new Set();
 s.cases=s.cases.map((c,index)=>{
  if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff||!classes.includes(c.class)||!races.includes(c.race))throw Error('Invalid assigned birth');
  const identity=JSON.stringify([c.seed,c.race,c.class]);if(seen.has(identity))throw Error('Duplicate assigned birth');seen.add(identity);
  return {...c,id:`${index}-${c.seed}`,index};
 });return s;
}
export function shardCases(s,index,count){if(!Number.isInteger(index)||!Number.isInteger(count)||count<1||count>256||index<0||index>=count)throw Error('Invalid shard');return s.cases.filter(c=>c.index%count===index);}
export function flags(argv){if(argv.length%2)throw Error('Expected flag/value pairs');return Object.fromEntries(Array.from({length:argv.length/2},(_,i)=>[argv[2*i].replace(/^--/,''),argv[2*i+1]]));}
