import {expect,it} from "vitest";
import type {ItemView} from "@rpgm-tools/neo-angband-core";
import {BorgWorld} from "../world/model.js";
import {makeScenarioView,makeFakeActions} from "../harness.js";
import {makeBorgRng} from "../rng.js";
import {BI} from "../trait/trait-index.js";
import {TV,SVAL} from "./svals.js";
import {borgDecurseAny} from "./item-decurse.js";
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

const cursed=(handle:number,tval=TV.HARD_ARMOR)=>item({handle,tval,curses:["clumsiness"]});
function scene(pack:ItemView[]=[],equipment:Array<ItemView|null>=[],quiver:ItemView[]=[]){
 const world=new BorgWorld();world.self.trait[BI.LIGHT]=1;world.self.trait[BI.FIRST_CURSED]=1;
 const scroll=item({handle:3,tval:TV.SCROLL,sval:SVAL.scroll.remove_curse!});
 const ctx={world,view:{...makeScenarioView(),inventory:()=>[scroll,...pack,...quiver],equipment:()=>equipment,quiver:()=>quiver},act:makeFakeActions(),rng:makeBorgRng(1)};return ctx;
}
it.each(["pack","equipment","quiver"])("carries the cursed %s item's real handle",where=>{const c=cursed(10);const ctx=scene(where==="pack"?[c]:[],where==="equipment"?[null,c]:[],where==="quiver"?[c]:[]);expect(borgDecurseAny(ctx)).toEqual({code:"read",args:{handle:3,tgtitem:{handle:10}}});expect(ctx.world.itemChoice).toBe(10);});
it("prefers C pack order, then equipment, then quiver without equating FIRST_CURSED with a handle",()=>{const ctx=scene([cursed(10)],[cursed(11)],[cursed(12)]);ctx.world.self.trait[BI.FIRST_CURSED]=7;expect(borgDecurseAny(ctx)?.args?.tgtitem).toEqual({handle:10});});
it("uses equipment before quiver when the pack has no curse",()=>{expect(borgDecurseAny(scene([],[cursed(11)],[cursed(12)]))?.args?.tgtitem).toEqual({handle:11});});
it("does not emit a bare command if the curse flag has become stale",()=>{const ctx=scene();expect(borgDecurseAny(ctx)).toBeNull();expect(ctx.world.itemChoice).toBeNull();});
it("does not use curse removal without the notice flag",()=>{const ctx=scene([cursed(10)]);ctx.world.self.trait[BI.FIRST_CURSED]=0;expect(borgDecurseAny(ctx)).toBeNull();});
it("does not emit when no removal means exists",()=>{const ctx=scene([cursed(10)]);ctx.view.inventory=()=>[cursed(10)];expect(borgDecurseAny(ctx)).toBeNull();});
it("does not select an empty or non-carried handle",()=>{const ctx=scene([{...cursed(-1)},{...cursed(10),number:0}]);expect(borgDecurseAny(ctx)).toBeNull();});
