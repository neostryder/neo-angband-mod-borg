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
it('C short circuit does not mark an unused critical cure as drunk',()=>{
 const {ctx,world,t}=setup([packItem(3,TV.MUSHROOM,SVAL.mush.cure_mind!),packItem(4,TV.POTION,SVAL.potion.cure_critical!,3)]);t[BI.ISCONFUSED]=1;t[BI.ACCW]=3;
 expect(borgHeal(ctx,0)).toEqual({code:'eat',args:{handle:3}});
 world.clock=101;t[BI.ISCONFUSED]=0;
 expect(borgQuaffCrit(ctx,false)).toEqual({code:'quaff',args:{handle:4}});
});

it('control: a critical cure without the earlier mushroom branch is available',()=>{
 const {ctx,t}=setup([packItem(4,TV.POTION,SVAL.potion.cure_critical!,3)]);t[BI.ACCW]=3;
 expect(borgQuaffCrit(ctx,false)).toEqual({code:'quaff',args:{handle:4}});
});
