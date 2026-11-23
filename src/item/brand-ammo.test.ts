import {expect,it} from "vitest";
import type {ItemView,SpellbookView} from "@rpgm-tools/neo-angband-core";
import {BorgWorld} from "../world/model.js";
import {makeScenarioView,makeFakeActions} from "../harness.js";
import {makeBorgRng} from "../rng.js";
import {BI,CLASS_RANGER} from "../trait/trait-index.js";
import {TV} from "./svals.js";
import {borgEnchanting} from "./item-enchant.js";
import {Spell,ratingsForClass} from "./magic.js";
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

function scene(ammo:ItemView[],spell=false){
 const world=new BorgWorld(),t=world.self.trait;
 t[BI.LIGHT]=1;t[BI.NEED_BRAND_WEAPON]=1;t[BI.ABRAND]=1;t[BI.AMMO_TVAL]=TV.ARROW;t[BI.CLASS]=CLASS_RANGER;t[BI.CLEVEL]=50;t[BI.MAXSP]=t[BI.CURSP]=100;
 const sidx=ratingsForClass(CLASS_RANGER)!.findIndex(x=>x.spell===Spell.BRAND_AMMUNITION);
 const book:SpellbookView={tval:TV.NATURE_BOOK,name:"Nature's Gifts",realm:"nature",spells:[{name:"Brand Ammunition",sidx,bidx:0,level:1,mana:1,fail:0,learned:true,worked:true,forgotten:false,studyEligible:false,infoLine:""}]};
 const ctx={world,view:{...makeScenarioView({player:{cls:"Ranger",level:50,sp:100,maxSp:100}}),inventory:()=>spell?[...ammo,item({handle:8,tval:TV.NATURE_BOOK,sval:1})]:ammo,equipment:()=>[],quiver:()=>ammo,spellbooks:()=>spell?[book]:[]},act:makeFakeActions(),rng:makeBorgRng(1),bookKind:(tval:number)=>({tval,sval:1})};
 return {ctx,t,sidx};
}
const arrow=(handle=10,toH=5)=>item({handle,tval:TV.ARROW,number:20,toH});
const activation={activateItem:(act:string)=>act==="act_firebrand"?9:null};
it("brands a quiver stack using firebrand and carries its item target",()=>{const {ctx}=scene([arrow()]);expect(borgEnchanting(ctx,activation)).toEqual({code:"activate",args:{handle:9,tgtitem:{handle:10}}});expect(ctx.world.itemChoice).toBe(10);});
it("chooses the highest to-hit stack, last on ties",()=>{const {ctx}=scene([arrow(10,4),arrow(11,7),arrow(12,7)]);expect(borgEnchanting(ctx,activation)?.args?.tgtitem).toEqual({handle:12});});
it("uses the real class spell mapping when activation is unavailable",()=>{const {ctx,sidx}=scene([arrow()],true);expect(borgEnchanting(ctx)).toEqual({code:"cast",args:{spell:sidx,tgtitem:{handle:10}}});});
it("prefers activation before an available spell",()=>{const {ctx}=scene([arrow()],true);expect(borgEnchanting(ctx,activation)?.code).toBe("activate");});
it.each(["small","unidentified","foreign","ego","empty","pack-only","no-need","no-means","dungeon"])("keeps the C branding guard %s",guard=>{const a=arrow();if(guard==="small")a.number=19;if(guard==="unidentified")a.aware=false;if(guard==="foreign")a.tval=TV.BOLT;if(guard==="ego")a.ego=true;if(guard==="empty")a.number=0;const {ctx,t}=scene([a]);if(guard==="pack-only")ctx.view.quiver=()=>[];if(guard==="no-need")t[BI.NEED_BRAND_WEAPON]=0;if(guard==="no-means")t[BI.ABRAND]=0;if(guard==="dungeon")t[BI.CDEPTH]=1;expect(borgEnchanting(ctx,activation)).toBeNull();});
