import {afterEach,expect,it} from "vitest";
import type {ItemView} from "@rpgm-tools/neo-angband-core";
import {BorgWorld} from "../world/model.js";
import {makeScenarioView,makeFakeActions} from "../harness.js";
import {makeBorgRng} from "../rng.js";
import {BI} from "../trait/trait-index.js";
import {setBorgCfg,resetBorgCfg} from "../trait/config.js";
import {TV,SVAL} from "./svals.js";
import {borgEnchanting} from "./item-enchant.js";
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

afterEach(resetBorgCfg);
function scene(axis:"armor"|"hit"|"damage",bonus:number,star=true){
 const world=new BorgWorld(),t=world.self.trait;
 const armor=axis==="armor";
 t[BI.LIGHT]=1;t[armor?BI.NEED_ENCHANT_TO_A:axis==="hit"?BI.NEED_ENCHANT_TO_H:BI.NEED_ENCHANT_TO_D]=1;
 t[armor?(star?BI.AENCH_SARM:BI.AENCH_ARM):(star?BI.AENCH_SWEP:axis==="hit"?BI.AENCH_TOH:BI.AENCH_TOD)]=1;
 const gear=item({handle:2,tval:armor?TV.HARD_ARMOR:TV.SWORD,toA:bonus,toH:bonus,toD:bonus});
 const sval=armor?(star?SVAL.scroll.star_enchant_armor!:SVAL.scroll.enchant_armor!):(star?SVAL.scroll.star_enchant_weapon!:axis==="hit"?SVAL.scroll.enchant_weapon_to_hit!:SVAL.scroll.enchant_weapon_to_dam!);
 const ctx={world,view:{...makeScenarioView(),inventory:()=>[item({handle:3,tval:TV.SCROLL,sval})],equipment:()=>[gear]},act:makeFakeActions(),rng:makeBorgRng(1)};
 return ctx;
}
it.each(["armor","hit","damage"] as const)("honors configured limit above stock for %s",axis=>{
 setBorgCfg({enchantLimit:20});expect(borgEnchanting(scene(axis,13))).toEqual({code:"read",args:{handle:3,tgtitem:{handle:2}}});
});
it.each(["armor","hit","damage"] as const)("honors configured lower limit and equality for %s",axis=>{
 setBorgCfg({enchantLimit:6});expect(borgEnchanting(scene(axis,6))).toBeNull();
 expect(borgEnchanting(scene(axis,5))?.code).toBe("read");
});
it.each(["armor","hit","damage"] as const)("keeps the C ordinary-scroll cap of eight for %s",axis=>{
 setBorgCfg({enchantLimit:20});expect(borgEnchanting(scene(axis,8,false))).toBeNull();
 expect(borgEnchanting(scene(axis,7,false))?.code).toBe("read");
});
it("keeps the stock limit twelve",()=>{expect(borgEnchanting(scene("armor",12))).toBeNull();expect(borgEnchanting(scene("armor",11))?.code).toBe("read");});
