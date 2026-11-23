/** One registered caster/item command, not a gameplay cohort. */
import {expect,it} from "vitest";
import * as Core from "@rpgm-tools/neo-angband-core";
import {registeredPack} from "../../test/fixtures/registered-items.js";
import {BorgWorld} from "../world/model.js";
import {makeFakeActions} from "../harness.js";
import {makeBorgRng} from "../rng.js";
import {BI,CLASS_RANGER} from "../trait/trait-index.js";
import {borgEnchanting} from "./item-enchant.js";
it.each([99,0])("the registered Ranger brand command preserves target/consumption with failure roll %s",roll=>{
 const game=Core.startGame(registeredPack(),{seed:441,depth:0,raceName:"Human",className:"Ranger",rolledStats:[18,18,18,18,18,18]});
 const {state}=game,p=state.actor.player,reg=game.booted.registries.objects,z=game.booted.registries.constants;
 state.turn=z.dayLength*5;state.updateBonuses?.();Core.playerExpGain(p,100000000,{rng:state.rng,onLevelChange:()=>state.updateBonuses?.()});// Legal trained Wisdom (18/100) supplies the C Ranger reserve as well as spell cost.
 p.statCur[2]=p.statMax[2]=118;state.updateBonuses?.();Core.calcMana(p,state.playerState!.statInd,[6,7,8,9,10,11].reduce((w,slot)=>w+(state.gear!.store.get(p.equipment[slot]!)?.weight??0),0));Core.calcSpells(p,state.playerState!.statInd);p.csp=p.msp;p.chp=p.mhp;
 const spell=Core.createAgentView(state).spellbooks().flatMap(b=>b.spells).find(s=>s.name==="Brand Ammunition")!;expect(spell).toBeDefined();
 const book=p.cls.magic.books[spell.bidx]!,bk=reg.lookupKind(book.tvalIdx,book.sval)!;
 const ob=Core.objectPrep(state.rng,reg,z,bk,p.lev,"average");game.flavor.objectFlavorAware(bk,state.flavorAwareDeps??Core.NOOP_FLAVOR_AWARE_DEPS);const bh=Core.invenCarry(state.gear!,p,ob,z)!;
 expect(game.registry.get("study")!(state,{code:"study",args:{handle:bh,spell:spell.sidx}})).toBeGreaterThan(0);
 const ak=reg.kinds.find(k=>k.tval===Core.TV.ARROW)!;const add=(bonus:number)=>{const o=Core.objectPrep(state.rng,reg,z,ak,1,"average");o.number=20;o.toH=bonus;o.notice|=Core.OBJ_NOTICE.ASSESSED;const h=Core.invenCarry(state.gear!,p,o,z)!;return h;};
 const low=add(3),high=add(5);Core.playerLearnAllRunes(p,state.runeEnv);Core.calcInventory(state.gear!,z);
 const view=Core.createAgentView(state,undefined,{reg});expect(view.quiver?.().some(i=>i.handle===high)).toBe(true);
 const world=new BorgWorld(),t=world.self.trait;t[BI.CLASS]=CLASS_RANGER;t[BI.CLEVEL]=p.lev;t[BI.LIGHT]=1;t[BI.MAXSP]=p.msp;t[BI.CURSP]=p.csp;t[BI.NEED_BRAND_WEAPON]=1;t[BI.ABRAND]=1;t[BI.AMMO_TVAL]=Core.TV.ARROW;
 const ctx={world,view,act:makeFakeActions(),rng:makeBorgRng(1),bookKind:(tval:number,name:string)=>{const b=p.cls.magic.books.find(b=>b.tvalIdx===tval&&b.name===name);return b?{tval,sval:b.sval}:null;}};

 const cmd=borgEnchanting(ctx);expect(cmd).toEqual({code:"cast",args:{spell:spell.sidx,tgtitem:{handle:high}}});
 // Pin just the spell-failure branch; consume the normal draw and leave effect RNG unchanged.
 const randint0=state.rng.randint0.bind(state.rng);let pinned=false;state.rng.randint0=(n:number)=>{const result=randint0(n);if(!pinned&&n===100){pinned=true;return roll;}return result;};
 expect(game.registry.get("cast")!(state,cmd!)).toBe(z.moveEnergy);expect(state.itemRequest).toBeFalsy();
 expect(pinned).toBe(true);if(roll===99)expect(state.gear!.store.get(high)?.ego).not.toBeNull();else expect(state.gear!.store.get(high)?.ego).toBeNull();expect(state.gear!.store.get(low)?.ego).toBeNull();
});
