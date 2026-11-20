import type {ItemView} from "@rpgm-tools/neo-angband-core";
import {expect,it,vi} from 'vitest';
import {BorgWorld} from '../world/model.js';
import {makeScenarioView,makeFakeActions} from '../harness.js';
import {makeBorgRng} from '../rng.js';
import {BI} from '../trait/trait-index.js';
import {TV,SVAL} from '../item/svals.js';
import {getThinkSession} from '../think-session.js';
import {getDangerGlobals} from '../danger/state.js';
import {FEAT} from '../core-api.js';
import {borgCaution,borgHeal} from './caution.js';
import {borgQuaffCrit} from '../item/item-use.js';
vi.mock('../danger/index.js',async original=>({...await original<object>(),borgDanger:()=>0}));
vi.mock('./escape.js',async original=>({...await original<object>(),borgEscape:()=>null}));
function setup(inventory:ItemView[]=[]){
 const world=new BorgWorld();const rng=makeBorgRng(1);rng.randint0=()=>0;rng.randint1=()=>1;const ctx={world,view:{...makeScenarioView(),inventory:()=>inventory},act:makeFakeActions(),rng};
 const t=world.self.trait;
 for(const [key,value] of [[BI.CURHP,80],[BI.MAXHP,100],[BI.CLEVEL,10],[BI.MAXCLEVEL,10],[BI.CDEPTH,0],[BI.MAXDEPTH,1],[BI.LIGHT,1],[BI.FOOD,5],[BI.SPEED,110],[BI.CLASS,1],[BI.MAXSP,2],[BI.CURSP,2]] as const)t[key]=value;
 world.self.c={x:10,y:10};world.clock=100;getDangerGlobals(world).avoidance=100;
 const session=getThinkSession(world);session.ctx=ctx;const flow=session.flow.state;
 flow.hooks.preparedToDescend=()=>false;flow.hooks.countSell=()=>0;flow.hooks.danger=()=>0;
 for(let y=0;y<world.map.height;y++)for(let x=0;x<world.map.width;x++)world.map.at(x,y).feat=FEAT.GRANITE;
 world.map.at(10,10).feat=FEAT.FLOOR;
 return {ctx,world,t,flow};
}
function item(p: Partial<ItemView>): ItemView {
  return {
    handle: p.handle ?? 1,
    kindKey: p.kindKey ?? "",
    aware: p.aware ?? true,
    nameColor: p.nameColor ?? "",
    label: p.label ?? "item",
    tval: p.tval ?? 0,
    sval: p.sval ?? 0,
    pval: p.pval ?? 0,
    number: p.number ?? 1,
    weight: p.weight ?? 0,
    ac: p.ac ?? 0,
    toA: p.toA ?? 0,
    toH: p.toH ?? 0,
    toD: p.toD ?? 0,
    dd: p.dd ?? 0,
    ds: p.ds ?? 0,
    ego: p.ego ?? false,
    artifact: p.artifact ?? false,
    flags: p.flags ?? [],
    modifiers: p.modifiers ?? [],
    brands: p.brands ?? [],
    slays: p.slays ?? [],
    resists: p.resists ?? [],
    curses: p.curses ?? [],
    egoName: p.egoName ?? null,
    artifactName: p.artifactName ?? null,
    activation: p.activation ?? false,
    timeout: p.timeout ?? 0,
    inscription: p.inscription ?? null,
    ...(p.value !== undefined ? { value: p.value } : {}),
  };
}

function packItem(handle:number,tval:number,sval:number,number=1){return item({handle,tval,sval,number});}
it('control: normal confusion healing selects the carried serious cure',()=>{
 const {ctx,t}=setup([packItem(4,TV.POTION,SVAL.potion.cure_serious!)]);t[BI.ISCONFUSED]=1;
 expect(borgHeal(ctx,0)).toEqual({code:'quaff',args:{handle:4}});
});

it.each([0,1,2,3,4,5,6,7,8])('C late confusion cure still runs when already fleeing, class %s',(cls)=>{
 const {ctx,world,t,flow}=setup([packItem(4,TV.POTION,SVAL.potion.cure_serious!)]);world.self.goal.fleeing=true;t[BI.ISCONFUSED]=1;
 t[BI.CLASS]=cls;expect(borgCaution(ctx,flow)).toEqual({code:'quaff',args:{handle:4}});
});

it.each([0,1,2,3,4,5,6,7,8])('C late fear cure consumes boldness rather than yielding, class %s',(cls)=>{
 const {ctx,world,t,flow}=setup([packItem(5,TV.POTION,SVAL.potion.boldness!)]);world.self.goal.fleeing=true;t[BI.ISAFRAID]=1;
 t[BI.CLASS]=cls;expect(borgCaution(ctx,flow)).toEqual({code:'quaff',args:{handle:5}});
});

it("does not cure absent confusion/fear",()=>{const {ctx,flow}=setup([packItem(4,TV.POTION,SVAL.potion.cure_serious!)]);expect(borgCaution(ctx,flow)).toBeNull();});
it("does not spend fear cures on a fear curse",()=>{const {ctx,world,t,flow}=setup([packItem(5,TV.POTION,SVAL.potion.boldness!)]);world.self.goal.fleeing=true;t[BI.ISAFRAID]=t[BI.CRSFEAR]=1;expect(borgCaution(ctx,flow)).toBeNull();});
it("honors the fear chance gate for a caster",()=>{const {ctx,world,t,flow}=setup([packItem(5,TV.POTION,SVAL.potion.boldness!)]);world.self.goal.fleeing=true;t[BI.ISAFRAID]=1;ctx.rng.randint0=()=>70;expect(borgCaution(ctx,flow)).toBeNull();});
it("cures a missile-less Warrior despite the chance gate",()=>{const {ctx,world,t,flow}=setup([packItem(5,TV.POTION,SVAL.potion.boldness!)]);world.self.goal.fleeing=true;t[BI.CLASS]=0;t[BI.ISAFRAID]=1;ctx.rng.randint0=()=>99;expect(borgCaution(ctx,flow)?.code).toBe("quaff");});
it("keeps the chance gate for a Warrior with missiles",()=>{const {ctx,world,t,flow}=setup([packItem(5,TV.POTION,SVAL.potion.boldness!)]);world.self.goal.fleeing=true;t[BI.CLASS]=0;t[BI.ISAFRAID]=1;t[BI.AMISSILES]=1;ctx.rng.randint0=()=>99;expect(borgCaution(ctx,flow)).toBeNull();});
